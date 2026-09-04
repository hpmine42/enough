import type { Connection, Message, Profile } from './types';
import { effectiveStatus, isHiddenByChatDeletion } from './helpers.ts';

/**
 * Pure helpers for the Home screen's realtime reconciliation (audit P1-5).
 *
 * Home subscribes to `postgres_changes` for connections, messages, profiles,
 * message deletions and chat deletions. Instead of re-fetching every
 * connection, profile, last message, read state and unread count on each
 * event (the old behavior), the hot path applies the event to the
 * already-rendered list. Events that cannot be reconstructed from the
 * payload alone (e.g. a message for a conversation that is not currently in
 * the list, or a chat-deletion window change) route to a narrowly scoped
 * per-conversation reconciliation that re-derives only the affected row
 * through the RLS-scoped API path.
 *
 * Performance invariant (P1-5): a single realtime event must NOT cause an
 * unconditional full `load()` of the Home dataset. `Home.tsx` wires this
 * module into the Supabase channel and owns the React state application.
 *
 * Security note: a Realtime payload is never treated as proof that the
 * current user may see the record. The per-user tables are scoped by the
 * `user_id = auth.uid()` membership check below (mirroring their RLS
 * policies), connection rows by the `user_a/user_b = me` check, and data
 * that is not fully carried by the payload (profiles, last messages, unread,
 * visibility) is re-fetched through the same RLS-scoped queries the initial
 * load uses — never from the payload alone.
 *
 * Kept free of React and of the Supabase-bound `api.ts` module (only the
 * pure helpers are imported) so the Node test runner can import it directly
 * (see src/lib/__tests__/home-realtime.test.mjs).
 */

/* ------------------------------------------------------------------ */
/* message merge / unread counters                                     */
/* ------------------------------------------------------------------ */

/**
 * Message A is "newer" than message B when its timestamp is later, or — for
 * identical timestamps — when its id sorts later (matching the
 * `(created_at, id)` ordering used everywhere else).
 */
export function isMessageNewer(a: Message, b: Message): boolean {
  if (a.created_at === b.created_at) return a.id > b.id;
  return a.created_at > b.created_at;
}

/**
 * Merge a realtime message event into the Home `lastMessages` map.
 *
 * Home only displays the newest message per connection, so:
 *   - an INSERT for a connection without a last message adds it;
 *   - an INSERT of a message newer than the current last replaces it;
 *   - an INSERT of an older message (out-of-order delivery) is ignored;
 *   - an UPDATE replaces the entry only when it targets the currently
 *     displayed (newest) message — e.g. delete-for-everyone, which clears
 *     the ciphertext and sets `deleted_at`.
 *
 * Returns the same object reference when the event does not change the map,
 * so React can skip a re-render.
 */
export function mergeLastMessage(
  prev: Record<string, Message>,
  msg: Message,
): Record<string, Message> {
  const cur = prev[msg.connection_id];
  if (!cur) return { ...prev, [msg.connection_id]: msg };
  if (cur.id === msg.id) return { ...prev, [msg.connection_id]: msg };
  if (isMessageNewer(msg, cur)) return { ...prev, [msg.connection_id]: msg };
  return prev;
}

/**
 * Whether an incoming message event is a GENUINELY NEW latest message for its
 * connection (audit F-04).
 *
 * The unread badge must increment exactly once per new peer message. A
 * duplicate delivery of the currently-last message (a Realtime replay, or our
 * own send racing back from another device) is not new and must never
 * re-increment, and an out-of-order older message that `mergeLastMessage`
 * ignores is not new either.
 *
 * This is the determinate "should this count" predicate, so the caller can
 * gate the unread counter on it while `mergeLastMessage` still applies the
 * preview merge (the merge is idempotent, so running it unconditionally is
 * safe).
 */
export function isNewLastMessage(
  prev: Record<string, Message>,
  msg: Message,
): boolean {
  const cur = prev[msg.connection_id];
  if (!cur) return true;
  if (cur.id === msg.id) return false;
  return isMessageNewer(msg, cur);
}

/**
 * True when a message counts toward the unread badge. Mirrors the
 * `connection_unread` view (migration 0013), which counts only non-deleted
 * `text` messages: system events (`connection_event`, `name_change`,
 * `deleted_account`) must NOT inflate the badge on arrival, otherwise the
 * badge goes backwards on the next full load.
 */
export function countsTowardUnread(
  msg: Pick<Message, 'kind' | 'deleted_at'>,
): boolean {
  return (msg.kind ?? 'text') === 'text' && msg.deleted_at == null;
}

/**
 * Increment the unread counter for one connection after an incoming message
 * from the peer. Own messages (sent from another device) are never counted,
 * so the caller must gate `fromPeer` (and the message kind) beforehand.
 */
export function unreadAfterInsert(
  prev: Record<string, number>,
  connectionId: string,
  fromPeer: boolean,
): Record<string, number> {
  if (!fromPeer) return prev;
  return { ...prev, [connectionId]: (prev[connectionId] ?? 0) + 1 };
}

/* ------------------------------------------------------------------ */
/* connection-list membership maps                                     */
/* ------------------------------------------------------------------ */

/**
 * Insert-or-replace a connection row in the Home list, keyed by id.
 * Dedupe is mandatory: realtime events and `load()` races can deliver the
 * same row twice, and the list must never show a duplicate entry. The new
 * row is prepended for unknown ids; display order is re-derived by `Home`
 * from latest activity, so the array position is not load-bearing.
 */
export function upsertConnectionById(
  prev: Connection[],
  conn: Connection,
): Connection[] {
  const idx = prev.findIndex((c) => c.id === conn.id);
  if (idx === -1) return [conn, ...prev];
  if (prev[idx] === conn) return prev;
  const next = prev.slice();
  next[idx] = conn;
  return next;
}

/** Remove one connection by id. Same reference when the id is not present. */
export function removeConnectionById(
  prev: Connection[],
  id: string,
): Connection[] {
  if (!prev.some((c) => c.id === id)) return prev;
  return prev.filter((c) => c.id !== id);
}

/** Remove one key from a per-connection map. Same reference when absent. */
export function withoutKey<T>(
  prev: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in prev)) return prev;
  const next = { ...prev };
  delete next[key];
  return next;
}

/**
 * Drop the `lastMessages` entry of one connection when the currently shown
 * message falls at or before the chat-deletion cutoff. A newer message (e.g.
 * one that raced in after the cutoff was read) survives — this keeps a
 * concurrent event from being clobbered by a slightly stale reconciliation.
 */
export function removeHiddenLastMessage(
  prev: Record<string, Message>,
  connectionId: string,
  hiddenUntil: string | null | undefined,
): Record<string, Message> {
  const cur = prev[connectionId];
  if (!cur || !isHiddenByChatDeletion(cur.created_at, hiddenUntil)) return prev;
  return withoutKey(prev, connectionId);
}

/**
 * Add or remove a "deleted for me" tombstone id. Pure set operation: the
 * underlying message row is untouched (delete-for-me never alters the
 * sender's row), which preserves the PR #85 preview semantics — the row's
 * preview switches to the tombstone at render time via `deletedMessagePreview`.
 */
export function withTombstone(
  prev: Set<string>,
  messageId: string,
  added: boolean,
): Set<string> {
  if (added) {
    // Duplicate add: same reference, React skips the re-render.
    if (prev.has(messageId)) return prev;
    const next = new Set(prev);
    next.add(messageId);
    return next;
  }
  if (!prev.has(messageId)) return prev;
  const next = new Set(prev);
  next.delete(messageId);
  return next;
}

/* ------------------------------------------------------------------ */
/* visibility derivation (shared by load() and realtime)               */
/* ------------------------------------------------------------------ */

/**
 * Whether a connection belongs in the Home list given the chat-deletion
 * state. `status` must be the effective status (client-side expiry applied)
 * and is passed in so this module stays free of anything but pure helpers.
 *
 * This is the single source of truth for the filter `load()` applies after
 * fetching; the realtime path uses the same predicate so an incrementally
 * applied row can never disagree with a reloaded one.
 */
export function isConversationVisible(
  conn: Pick<Connection, 'created_at'>,
  status: Connection['status'],
  last: Pick<Message, 'created_at'> | undefined,
  hiddenUntil: string | null | undefined,
  revealed = false,
): boolean {
  if (!hiddenUntil) return true;
  if (revealed) return true;
  // Requests stay visible while hidden — accepting/declining must remain
  // possible, mirroring the previous filter in `load()`.
  if (status === 'pending' || status === 'declined' || status === 'expired') {
    return true;
  }
  if (last && !isHiddenByChatDeletion(last.created_at, hiddenUntil)) return true;
  return !isHiddenByChatDeletion(conn.created_at, hiddenUntil);
}

/* ------------------------------------------------------------------ */
/* realtime event routing (the decision core, fully testable)          */
/* ------------------------------------------------------------------ */

/**
 * Structural view of a Supabase Realtime `postgres_changes` payload. The
 * handlers only read `eventType`, `new` and `old` — with the documented
 * limitation that `old` carries at most the primary-key columns unless the
 * table uses REPLICA IDENTITY FULL.
 */
export interface RealtimeEventPayloadLike {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

export interface HomeRealtimeBridgeDeps {
  /** Id of the signed-in user. */
  me: () => string;
  /** True while a full `load()` is running. */
  isLoading: () => boolean;
  /** True when the connection is currently rendered in the Home list. */
  hasConnection: (connectionId: string) => boolean;
  /**
   * Bookkeeping for every event that identifies a conversation: bumps the
   * per-conversation event sequence used by reconciliation staleness
   * detection and queues the conversation for the post-load drain while a
   * full reload is running (state written now would be overwritten by the
   * reload's own `setState` calls).
   */
  noteEvent: (connectionId: string) => void;
  /** Apply a connection row that passed the membership scoping check. */
  onConnectionRow: (row: Connection) => void;
  /** Remove a locally known connection after a DELETE event. */
  onConnectionGone: (connectionId: string) => void;
  /**
   * Merge a message into the conversation preview. `countUnread` is true
   * exactly for an INSERT of a non-deleted text message from the peer.
   */
  onMessage: (msg: Message, countUnread: boolean) => void;
  /** Add/remove a per-user tombstone id ("delete for me"). */
  onTombstone: (messageId: string, added: boolean) => void;
  /** Update the cached profile map (Home applies it only for known peers). */
  onProfile: (row: Profile) => void;
  /** Request the narrow single-conversation reconciliation. */
  onReconcile: (connectionId: string) => void;
}

export interface HomeRealtimeBridge {
  connections: (payload: RealtimeEventPayloadLike) => void;
  messageInsert: (payload: RealtimeEventPayloadLike) => void;
  messageUpdate: (payload: RealtimeEventPayloadLike) => void;
  profileUpdate: (payload: RealtimeEventPayloadLike) => void;
  messageDeletions: (payload: RealtimeEventPayloadLike) => void;
  chatDeletions: (payload: RealtimeEventPayloadLike) => void;
}

function rowOf(
  payload: RealtimeEventPayloadLike,
): Record<string, unknown> | undefined {
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  return row ?? undefined;
}

/**
 * Route one realtime payload to the narrowest safe state update.
 *
 * No branch here calls a full reload: anything the payload cannot prove is
 * handed to `onReconcile` (per-conversation, RLS-scoped fetch) or applied as
 * a purely local operation (removals, tombstone ids). That is the P1-5
 * invariant: "realtime event → targeted state update → optional narrow
 * reconciliation", never "realtime event → load()".
 */
export function createHomeRealtimeBridge(
  deps: HomeRealtimeBridgeDeps,
): HomeRealtimeBridge {
  return {
    connections(payload) {
      const me = deps.me();
      if (payload.eventType === 'DELETE') {
        // `old` carries the primary key (id) under the default replica
        // identity. Removing an already-rendered row cannot expose foreign
        // data — a wrong removal self-heals on the next load — so the id is
        // sufficient and no fetch is needed.
        const id = (payload.old as { id?: string } | undefined)?.id;
        if (!id || !deps.hasConnection(id)) return;
        deps.noteEvent(id);
        if (deps.isLoading()) return;
        deps.onConnectionGone(id);
        return;
      }
      const row = payload.new as Connection | undefined;
      if (!row || typeof row.id !== 'string' || !row.id) return;
      // The payload is not authorization: rows not referencing the current
      // user are dropped client-side on top of RLS delivery filtering.
      if (row.user_a !== me && row.user_b !== me) return;
      deps.noteEvent(row.id);
      if (deps.isLoading()) return;
      // The connection row is fully carried by the payload, and visibility
      // is re-derived from the locally tracked deletion window with the same
      // predicate the full load uses. Profile/unread are only ever fetched
      // through the RLS-scoped API inside `onConnectionRow`.
      deps.onConnectionRow(row);
    },

    messageInsert(payload) {
      const msg = payload.new as Message | undefined;
      if (!msg || typeof msg.connection_id !== 'string' || !msg.connection_id) return;
      deps.noteEvent(msg.connection_id);
      if (deps.isLoading()) return;
      if (!deps.hasConnection(msg.connection_id)) {
        // Conversation not currently rendered (brand-new, or reappearing
        // behind a chat-deletion cutoff). Its connection row, peer profile,
        // visibility and unread state cannot be derived from the message
        // payload alone → narrow per-conversation reconciliation instead
        // of a full Home reload.
        deps.onReconcile(msg.connection_id);
        return;
      }
      // Hot path: the list order and the preview are derived from
      // `lastMessages`, so replacing the newest message of exactly this
      // conversation is enough to re-render and re-sort the row.
      const fromPeer = msg.sender_id !== deps.me();
      deps.onMessage(msg, fromPeer && countsTowardUnread(msg));
    },

    messageUpdate(payload) {
      const msg = payload.new as Message | undefined;
      if (!msg || typeof msg.connection_id !== 'string' || !msg.connection_id) return;
      if (!deps.hasConnection(msg.connection_id)) return;
      deps.noteEvent(msg.connection_id);
      if (deps.isLoading()) return;
      // E.g. a delete-for-everyone tombstone applied to the displayed
      // message; `mergeLastMessage` ignores updates of non-last messages.
      // Unread counts are deliberately untouched here (pre-existing
      // behavior): the next full load reconciles them from the view.
      deps.onMessage(msg, false);
    },

    profileUpdate(payload) {
      const row = payload.new as Profile | undefined;
      if (!row || typeof row.id !== 'string' || !row.id) return;
      // Display name changes only affect rows that already render this
      // profile; `onProfile` keeps the map untouched for unknown users so
      // no profile is attached to an ineligible row.
      deps.onProfile(row);
    },

    messageDeletions(payload) {
      const me = deps.me();
      const row = rowOf(payload) as
        | { user_id?: string; message_id?: string }
        | undefined;
      // Per-user rows (RLS `user_id = auth.uid()`); the client-side check is
      // kept as the belt-and-braces scoping gate the previous code used.
      if (!row || row.user_id !== me || typeof row.message_id !== 'string') return;
      // Tombstones are pure local set membership: the message row itself is
      // untouched by "delete for me", so the preview derivation picks the
      // tombstone up on the next render without any fetch.
      deps.onTombstone(row.message_id, payload.eventType !== 'DELETE');
    },

    chatDeletions(payload) {
      const me = deps.me();
      const row = rowOf(payload) as
        | { user_id?: string; connection_id?: string }
        | undefined;
      if (!row || row.user_id !== me || typeof row.connection_id !== 'string') return;
      deps.noteEvent(row.connection_id);
      if (deps.isLoading()) return;
      // Hiding, revealing or restoring a chat changes its visibility window
      // and preview cutoff; re-derive it for THIS conversation only from the
      // authoritative deletion state (narrow reconciliation).
      deps.onReconcile(row.connection_id);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Home load lifecycle (F-03)                                          */
/* ------------------------------------------------------------------ */

/**
 * Ownership tracker for overlapping Home `load()` calls (audit finding
 * F-03).
 *
 * Home can have more than one `load()` in flight at a time (initial load,
 * reconnect load, Settings→Home transition, connection accept/decline, the
 * P1-5 drain fallback). Two properties must hold:
 *
 *  - **Gate ownership**: the realtime loading gate must stay closed while
 *    ANY load is still running. An older load finishing first must not
 *    reopen the gate for a newer load that is still going to replace the
 *    whole Home state — otherwise a realtime event in between is treated as
 *    steady-state and then silently overwritten by the newer load's
 *    snapshot.
 *  - **State ownership**: Home loads are last-write-wins by START order.
 *    Only the most recently started load may commit its snapshot; an older
 *    load resolving later must discard its result.
 *
 * A plain boolean satisfies neither, and a plain counter of active loads
 * satisfies only the first. This tracker therefore keeps both a monotonic
 * generation (the token identifying the newest load) and the number of
 * loads that are still running.
 */
export interface HomeLoadLifecycle {
  /**
   * Register a newly started load. Returns its token, which the caller
   * passes to `isCurrent`/`finish`.
   */
  start: () => number;
  /**
   * True while `token` identifies the newest started load. Older loads get
   * `false` and must not commit any state.
   */
  isCurrent: (token: number) => boolean;
  /**
   * Mark one load as finished. Returns true when this was the last active
   * load, i.e. when the realtime gate may be released and the post-load
   * drain may run. Idempotent per token: a double `finish` for the same
   * token cannot release another load's gate.
   */
  finish: (token: number) => boolean;
  /** True while at least one load is still running (the realtime gate). */
  isLoading: () => boolean;
  /** Newest issued token (diagnostics/tests). */
  current: () => number;
  /** Number of loads currently in flight (diagnostics/tests). */
  active: () => number;
}

export function createHomeLoadLifecycle(): HomeLoadLifecycle {
  let token = 0;
  let active = 0;
  const running = new Set<number>();
  return {
    start: () => {
      token += 1;
      active += 1;
      running.add(token);
      return token;
    },
    isCurrent: (t) => t === token,
    finish: (t) => {
      if (!running.delete(t)) return false;
      active -= 1;
      return active === 0;
    },
    isLoading: () => active > 0,
    current: () => token,
    active: () => active,
  };
}

/* ------------------------------------------------------------------ */
/* convergence machinery for the narrow reconciliation                 */
/* ------------------------------------------------------------------ */

export interface ConversationEventGate {
  bump: (connectionId: string) => void;
  read: (connectionId: string) => number;
}

/**
 * Per-conversation event counter. A reconciliation snapshots the counter
 * before it fetches and skips (or retries) its state write when the counter
 * moved meanwhile, so a stale snapshot can never overwrite newer realtime
 * state.
 */
export function createConversationEventGate(): ConversationEventGate {
  const seq = new Map<string, number>();
  return {
    bump: (connectionId) => seq.set(connectionId, (seq.get(connectionId) ?? 0) + 1),
    read: (connectionId) => seq.get(connectionId) ?? 0,
  };
}

export interface ReconcileScheduler {
  request: (connectionId: string) => void;
}

/**
 * Single-flight, coalescing scheduler for per-conversation reconciliation.
 *
 * - concurrent requests for the same conversation never run in parallel;
 *   they raise the "rerun" flag instead (duplicate rapid events collapse
 *   into one follow-up pass);
 * - `run` returns true when it detected concurrent events and prefers its
 *   snapshot to be re-fetched; the scheduler retries, bounded by
 *   `maxPasses` so a message storm degrades to at most one bounded fetch
 *   burst per conversation instead of a full reload per event;
 * - requests arriving after the budget ran out start a fresh cycle, so the
 *   mechanism stays responsive without ever amplifying.
 */
export function createReconcileScheduler(
  run: (connectionId: string, isFinalPass: boolean) => Promise<boolean>,
  maxPasses = 3,
): ReconcileScheduler {
  const active = new Map<string, { rerun: boolean }>();
  const request = (connectionId: string): void => {
    const running = active.get(connectionId);
    if (running) {
      running.rerun = true;
      return;
    }
    void cycle(connectionId);
  };
  const cycle = async (connectionId: string): Promise<void> => {
    const state = { rerun: false };
    active.set(connectionId, state);
    try {
      for (let pass = 1; pass <= maxPasses; pass += 1) {
        state.rerun = false;
        const refetch = await run(connectionId, pass >= maxPasses);
        if (!refetch && !state.rerun) return;
      }
    } finally {
      active.delete(connectionId);
    }
    if (state.rerun) request(connectionId);
  };
  return { request };
}

/* ------------------------------------------------------------------ */
/* narrow per-conversation reconciliation                              */
/* ------------------------------------------------------------------ */

/**
 * Data sources for one conversation's reconciliation. Home implements them
 * with the existing RLS-scoped API functions — the same queries `load()`
 * uses, but bounded to the single affected conversation:
 * at most one query each for the connection row, the last message, the
 * per-user deletion state, the read state + unread counts and the peer
 * profile. No N+1: the count does not grow with the number of connections.
 */
export interface ReconcileFetchers {
  /** The connection row via SELECT under RLS, or `null` when not visible. */
  fetchConnection: (connectionId: string) => Promise<Connection | null>;
  /** Last message per the authoritative `getLastMessages` path. */
  fetchLastMessage: (
    connectionId: string,
  ) => Promise<{ message: Message | null; failed: boolean }>;
  /** Hidden-until cutoff + revealed flag for the current user. */
  fetchChatDeletion: (
    connectionId: string,
  ) => Promise<{ hiddenUntil: string | null; revealed: boolean }>;
  /** Unread count from the bounded `connection_unread` path; `null` = keep. */
  fetchUnread: (connectionId: string) => Promise<number | null>;
  /**
   * Peer profile via `getProfiles` (RLS-scoped). `undefined` means the fetch
   * failed or there is nothing to update — the caller keeps what it has.
   */
  fetchPeerProfile: (peerId: string) => Promise<Profile | null | undefined>;
}

export type ReconcileResult =
  /** A fetch failed transiently; do not apply, retry or defer to next load. */
  | { kind: 'transient' }
  /** The row is no longer visible to this user (RLS) — remove it locally. */
  | { kind: 'gone' }
  | {
      kind: 'state';
      conn: Connection;
      visible: boolean;
      /** Newest message, already hidden-cutoff-filtered; null = keep entry. */
      last: Message | null;
      hiddenUntil: string | null;
      unread: number | null;
      peerId: string;
      profile: Profile | null | undefined;
    };

/**
 * Re-derive the Home state of ONE conversation through the RLS-scoped
 * fetchers. This is the fallback for events whose effect on the list cannot
 * be reconstructed from the realtime payload alone (new or reappearing
 * conversations, chat-deletion window changes) — bounded to a single
 * conversation instead of the previous full Home reload.
 */
export async function computeReconcileState(
  deps: ReconcileFetchers,
  me: string,
  connectionId: string,
): Promise<ReconcileResult> {
  const conn = await deps.fetchConnection(connectionId);
  if (!conn) return { kind: 'gone' };
  const peerId = conn.user_a === me ? conn.user_b : conn.user_a;
  const [lastRes, deletion, unread, profile] = await Promise.all([
    deps.fetchLastMessage(connectionId),
    deps.fetchChatDeletion(connectionId),
    deps.fetchUnread(connectionId),
    // A self-connection (My Notes) renders no peer profile: skip the fetch.
    peerId === me ? Promise.resolve<Profile | null | undefined>(undefined) : deps.fetchPeerProfile(peerId),
  ]);
  if (lastRes.failed) return { kind: 'transient' };
  const visible = isConversationVisible(
    conn,
    effectiveStatus(conn),
    lastRes.message ?? undefined,
    deletion.hiddenUntil,
    deletion.revealed,
  );
  // A last message hidden behind the cutoff never becomes the preview
  // through the incremental path either; trim instead of set.
  const last =
    visible && lastRes.message && !isHiddenByChatDeletion(lastRes.message.created_at, deletion.hiddenUntil)
      ? lastRes.message
      : null;
  return {
    kind: 'state',
    conn,
    visible,
    last,
    hiddenUntil: deletion.hiddenUntil,
    unread,
    peerId,
    profile,
  };
}
