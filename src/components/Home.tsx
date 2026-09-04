import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { navigate, useHashRoute } from '../lib/router';
import {
  acceptConnection,
  blockUser,
  cancelConnectionRequest,
  declineConnection,
  deleteChatForMe,
  getBlockState,
  getConnection,
  getLastMessages,
  getMyConnections,
  getProfiles,
  getReadState,
  getUnreadCounts,
  CHAT_HIDDEN_EVENT,
  isHiddenByChatDeletion,
  loadDeletionsForUser,
  removeMyNotes,
  unblockUser,
} from '../lib/api';
import {
  displayName,
  effectiveStatus,
  formatDate,
  formatRelative,
  isSelfConnection,
  otherUserId,
} from '../lib/helpers';
import { supabase } from '../lib/supabase';
import { getLang, t } from '../i18n';
import { BlockState, Connection, Message, Profile } from '../lib/types';
import {
  computeReconcileState,
  createConversationEventGate,
  createHomeLoadLifecycle,
  createHomeRealtimeBridge,
  createReconcileScheduler,
  isConversationVisible,
  isNewLastMessage,
  mergeLastMessage,
  removeConnectionById,
  removeHiddenLastMessage,
  unreadAfterInsert,
  upsertConnectionById,
  withoutKey,
  withTombstone,
  type ConversationEventGate,
  type HomeLoadLifecycle,
  type RealtimeEventPayloadLike,
} from '../lib/homeRealtime';
import { deletedMessagePreview } from '../lib/homePreview';
import {
  reportNetworkSuccess,
  shouldSkipNetwork,
  useConnectivity,
} from '../lib/connectivity';
import { loadHomeSnapshot, saveHomeSnapshot } from '../lib/offlineStore';
import { getCachedPlaintextSync, warmMessageCache } from '../lib/e2ee/message-cache';
import { isEnvelope } from '../lib/e2ee/message-flow';
import Avatar from './Avatar';
import OfflineBanner from './OfflineBanner';
import ThemeButton from './ThemeButton';
import { GearIcon, NoteIcon } from './icons';
import ChatActionMenu from './ChatActionMenu';
import Dialog from './Dialog';

interface RowData {
  conn: Connection;
  status: Connection['status'];
  other: Profile | null;
  last: Message | null;
  unread: number;
}

/**
 * P1-5: if MORE than this many conversations changed while a full load()
 * was running, re-loading the whole Home dataset once is cheaper than one
 * narrow reconciliation per conversation. This is the ONLY remaining path
 * where a realtime event burst can lead to a full reload — it is bounded to
 * at most one extra load() per drain and cannot be triggered by a single
 * event (a single event queues a single narrow reconciliation instead).
 */
const LOAD_DRAIN_RECONCILE_CAP = 6;

/** Hold duration that turns a row press into the row action menu. */
const LONG_PRESS_MS = 550;

/** Target of the long-press row menu (mirrors the Chat trash menu). */
interface RowMenuTarget {
  conn: Connection;
  other: Profile | null;
  blockState: BlockState;
}

function previewOf(
  last: Message | undefined,
  lang: string,
  peerUsername: string,
  me: string,
  deletedForMe: ReadonlySet<string>,
): string | null {
  if (!last) return null;
  // Deleted (for me or for everyone) never reveals the original content.
  // For "delete for me" the actor is always the current user; for
  // "delete for everyone" only the sender may delete (RLS + trigger,
  // migration 0009), so the tombstone actor is the sender.
  const deleted = deletedMessagePreview(last, me, peerUsername, deletedForMe);
  if (deleted !== null) return deleted;
  if (last.kind === 'name_change') {
    return t('chat.nameChange', {
      old: last.meta?.old_name ?? '',
      new: last.meta?.new_name ?? '',
    });
  }
  if (last.kind === 'deleted_account') {
    return t('chat.deletedAccountMessage', {
      username: last.meta?.username ?? peerUsername,
    });
  }
  // E2EE: show cached plaintext if we have it; otherwise the envelope is
  // opaque, so show a placeholder. Legacy plaintext / My Notes show as-is.
  const cached = getCachedPlaintextSync(me, last.id);
  if (cached !== null) return cached;
  if (isEnvelope(last.ciphertext)) return t('chat.encryptedPreview');
  return last.ciphertext;
}

export default function Home() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [others, setOthers] = useState<Record<string, Profile>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [deletedForMe, setDeletedForMe] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Connection | null>(null);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // True while the rendered list came from the local offline snapshot rather
  // than a fresh server read. Never used to claim data is current.
  const [fromCache, setFromCache] = useState(false);

  const connectivity = useConnectivity();
  const offline = connectivity !== 'online';

  // Long-press row actions: the SAME shared menu component as the in-chat
  // trash icon (Block user / Delete chat for me) plus the My Notes
  // clear-and-disable dialog for the self-connection.
  const [menuTarget, setMenuTarget] = useState<RowMenuTarget | null>(null);
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);
  const [menuConfirm, setMenuConfirm] = useState<'block' | 'delete' | null>(
    null,
  );
  const [notesClearTarget, setNotesClearTarget] = useState<Connection | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const pressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const me = user?.id ?? '';

  // Mirrors the rendered state so the realtime bridge can decide between an
  // incremental update and a narrow reconciliation without re-subscribing on
  // every list change. (Writes are merge-safe, so the one-commit lag of
  // these mirrors is absorbed by upsert-dedupe and the retrying scheduler.)
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const lastMessagesRef = useRef<Record<string, Message>>({});
  const othersRef = useRef<Record<string, Profile>>({});
  useEffect(() => {
    visibleIdsRef.current = new Set(connections.map((c) => c.id));
    lastMessagesRef.current = lastMessages;
    othersRef.current = others;
  }, [connections, lastMessages, others]);

  /* Reconciliation bookkeeping (P1-5). */
  /* F-03: overlapping loads. The realtime gate stays closed while ANY load
     is in flight, and only the newest started load may commit its snapshot.
     See `createHomeLoadLifecycle`. */
  const lifecycleRef = useRef<HomeLoadLifecycle | null>(null);
  function lifecycle(): HomeLoadLifecycle {
    if (!lifecycleRef.current) lifecycleRef.current = createHomeLoadLifecycle();
    return lifecycleRef.current;
  }
  /* True while at least one full load() is running (realtime loading gate).
     Owned by the lifecycle above, mirrored into a ref so the realtime bridge
     reads it without re-subscribing. */
  const loadingRef = useRef(false);
  const aliveRef = useRef(true);
  const meRef = useRef(me);
  const eventGateRef = useRef<ConversationEventGate | null>(null);
  const pendingReconcileRef = useRef<Set<string>>(new Set());
  const schedulerRef = useRef<ReturnType<typeof createReconcileScheduler> | null>(null);
  const drainRef = useRef<(() => void) | null>(null);
  /* Offline Read Mode: monotonic token identifying the newest load attempt.
     A slower asynchronous result (offline hydration or a late online load)
     may only commit when it is still the newest one — this is what stops a
     stale snapshot from overwriting fresher server state during rapid
     online/offline transitions. Since F-03 the token is issued by the load
     lifecycle, which additionally keeps the gate closed while an older load
     is still running. */
  // The per-conversation event counter used to detect realtime events that
  // raced an in-flight reconciliation (stale-snapshot guard).
  function eventGate(): ConversationEventGate {
    if (!eventGateRef.current) eventGateRef.current = createConversationEventGate();
    return eventGateRef.current;
  }
  // Local mirror of the chat-deletion windows, kept in sync by load() and
  // by every narrow reconciliation; the incremental connection-row branch
  // uses it to decide visibility without another fetch.
  const deletionsRef = useRef<{ chatUntil: Map<string, string>; revealed: Set<string> }>({
    chatUntil: new Map(),
    revealed: new Set(),
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Account change: drop cross-account bookkeeping immediately.
    meRef.current = me;
    // A load started for the previous account can never commit afterwards:
    // `isCurrent` also compares `meRef.current`, and a fresh lifecycle
    // invalidates every outstanding token.
    lifecycleRef.current = createHomeLoadLifecycle();
    loadingRef.current = false;
    eventGateRef.current = createConversationEventGate();
    pendingReconcileRef.current = new Set();
    // F-06: deletion state (chat-deletion windows + revealed chats) and the
    // per-user message tombstones belong to one account. Reset them at the
    // account/session boundary so stale IDs from User A can never influence
    // User B (e.g. a realtime event processed before the new load commits
    // must not read A's chat-deletion window, and A's tombstones must not
    // mask B's previews). The next `load()` repopulates both from the
    // RLS-scoped query for the new user.
    deletionsRef.current = { chatUntil: new Map(), revealed: new Set() };
    setDeletedForMe(new Set());
  }, [me]);

  const load = useCallback(async () => {
    if (!me) return;
    // Ownership captured at START: the account-change effect installs a
    // fresh lifecycle, so a load left over from the previous account keeps
    // referencing its own (now detached) one and can neither commit nor
    // release the current account's realtime gate.
    const owner = lifecycle();
    const token = owner.start();
    const isCurrent = () =>
      lifecycleRef.current === owner && owner.isCurrent(token) && meRef.current === me;
    setLoadError(null);
    loadingRef.current = true;
    try {
      await warmMessageCache(me);
      if (shouldSkipNetwork()) {
        // The browser has no network: render what this account already has
        // locally instead of issuing requests that can only fail. No Supabase
        // call is made on this path at all.
        const snapshot = await loadHomeSnapshot(me);
        if (!isCurrent()) return;
        if (snapshot) {
          setConnections(snapshot.connections);
          setOthers(snapshot.profiles);
          setLastMessages(snapshot.lastMessages);
          setUnread(snapshot.unread);
          setDeletedForMe(new Set(snapshot.deletedForMe));
          setFromCache(true);
        }
        return;
      }
      const connsResult = await getMyConnections(me);
      if (!isCurrent()) return;
      if (connsResult.error) {
        setLoadError(connsResult.error);
        return;
      }
      const conns = connsResult.data;
      const deletions = await loadDeletionsForUser(me);
      deletionsRef.current = {
        chatUntil: deletions.chatUntil,
        revealed: deletions.revealed,
      };
      const lastAllResult = await getLastMessages(conns.map((c) => c.id));
      if (!isCurrent()) return;
      if (lastAllResult.error) {
        setLoadError(lastAllResult.error);
        return;
      }
      const lastAll = lastAllResult.data;
      // P1-5: the visibility filter is the shared `isConversationVisible`
      // predicate, so an incrementally applied row and a freshly loaded one
      // can never disagree about whether the conversation belongs in the list.
      const visible = conns.filter((c) =>
        isConversationVisible(
          c,
          effectiveStatus(c),
          lastAll[c.id],
          deletions.chatUntil.get(c.id),
          // A revealed chat reappears in the list (empty for the deleter,
          // old history stays hidden behind hidden_until).
          deletions.revealed.has(c.id),
        ),
      );
      setConnections(visible);
      setDeletedForMe(deletions.messages);

      const ids = visible.map((c) => otherUserId(c, me));
      const profilesResult = await getProfiles(ids);
      if (!isCurrent()) return;
      if (profilesResult.error) {
        setLoadError(profilesResult.error);
        return;
      }
      setOthers(profilesResult.data);

      const last: Record<string, Message> = {};
      for (const c of visible) {
        const msg = lastAll[c.id];
        const until = deletions.chatUntil.get(c.id);
        if (msg && !isHiddenByChatDeletion(msg.created_at, until)) last[c.id] = msg;
      }
      setLastMessages(last);

      const readState = await getReadState(me);
      const counts = await getUnreadCounts(
        me,
        visible.map((c) => c.id),
        readState,
      );
      if (!isCurrent()) return;
      setUnread(counts);
      // The full load succeeded, so the server is reachable and this data is
      // current: clear a previous "unreachable" latch and refresh the local
      // offline snapshot for exactly this account.
      reportNetworkSuccess();
      setFromCache(false);
      void saveHomeSnapshot(me, {
        connections: visible,
        profiles: profilesResult.data,
        lastMessages: last,
        unread: counts,
        deletedForMe: Array.from(deletions.messages),
      });
    } finally {
      // F-03: only the LAST active load releases the realtime gate. An older
      // load finishing first must not hand steady-state semantics to realtime
      // events while a newer load is still about to replace the whole Home
      // state (its snapshot would silently overwrite them).
      const last = owner.finish(token);
      if (last && lifecycleRef.current === owner && meRef.current === me) {
        setLoading(false);
        loadingRef.current = false;
        // Realtime events that arrived while a reload was in flight had their
        // conversations queued instead of being applied to state that was
        // about to be replaced; now re-derive exactly those, narrowly (P1-5).
        drainRef.current?.();
      }
    }
  }, [me]);

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    load();
  }, [me, load]);

  /* Reconnection: when connectivity returns, resume the normal online load
     path. `load()` is the existing loader — no separate synchronization
     system is introduced, and the token guard above makes the fresh result
     win over any in-flight offline hydration. */
  const wasOfflineRef = useRef(offline);
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = offline;
    if (wasOffline && !offline && me) load();
  }, [offline, me, load]);

  /* Home stays mounted behind the Settings overlay. Leaving Settings may have
     changed the chat list (e.g. My Notes toggled on/off), so reload it on the
     Settings → Home transition instead of waiting for a remount or reload. */
  const route = useHashRoute();
  const inSettingsRef = useRef(route.startsWith('#/settings'));
  useEffect(() => {
    const inSettings = route.startsWith('#/settings');
    const wasInSettings = inSettingsRef.current;
    inSettingsRef.current = inSettings;
    if (wasInSettings && !inSettings && me) {
      load();
    }
  }, [route, me, load]);

  /* Incrementally apply a connection row carried by a Realtime INSERT or
     UPDATE. The row only replaces data for a conversation already scoped to
     the current user (membership is re-checked client-side, mirroring RLS —
     the payload is never trusted as authorization). A profile for a
     previously unknown peer is fetched through the RLS-scoped profile query,
     never taken from the Realtime payload. */
  const applyConnectionRow = useCallback(
    (row: Connection) => {
      const deletions = deletionsRef.current;
      const until = deletions.chatUntil.get(row.id);
      const last = lastMessagesRef.current[row.id];
      const visible = isConversationVisible(
        row,
        effectiveStatus(row),
        last,
        until,
        deletions.revealed.has(row.id),
      );
      const isNew = !visibleIdsRef.current.has(row.id);
      setConnections((prev) =>
        visible
          ? upsertConnectionById(prev, row)
          : removeConnectionById(prev, row.id),
      );
      if (visible) {
        setLastMessages((prev) => removeHiddenLastMessage(prev, row.id, until));
      } else {
        // The row no longer belongs in the list: drop it together with its
        // preview/unread entries — exactly what a full load() rebuild does.
        setLastMessages((prev) => withoutKey(prev, row.id));
        setUnread((prev) => withoutKey(prev, row.id));
      }
      if (visible && isNew && row.user_a !== row.user_b) {
        const peerId = otherUserId(row, me);
        if (peerId && !(peerId in othersRef.current)) {
          void getProfiles([peerId]).then((res) => {
            const profile = res.data[peerId];
            if (!aliveRef.current || meRef.current !== me || res.error || !profile) return;
            // Attach only while the conversation is still rendered: a row
            // removed in the meantime never gains profile data, and a
            // profile fetch failure leaves the previous fallback display
            // (corrected by the next load()).
            if (!visibleIdsRef.current.has(row.id)) return;
            setOthers((prev) => (peerId in prev ? prev : { ...prev, [peerId]: profile }));
          });
        }
      }
    },
    [me],
  );

  const applyConnectionGone = useCallback((connectionId: string) => {
    setConnections((prev) => removeConnectionById(prev, connectionId));
    setLastMessages((prev) => withoutKey(prev, connectionId));
    setUnread((prev) => withoutKey(prev, connectionId));
  }, []);

  /* Narrow single-conversation reconciliation — the fallback for realtime
     events whose effect on the list cannot be reconstructed from the
     payload alone (message for a new/hidden conversation, chat-deletion
     window change). Every fetch goes through the same RLS-scoped API
     functions `load()` uses, bounded to this ONE conversation: at most a
     constant number of queries per event regardless of list size, so the
     P1-4 no-N+1 invariant stays intact. Returns whether a re-fetch is
     preferred (concurrent events, or a transient fetch failure); the
     scheduler retries a bounded number of times and the next full load
     converges anything left over. */
  const runReconcile = useCallback(
    async (connectionId: string, isFinalPass: boolean): Promise<boolean> => {
      if (!supabase || !me) return false;
      const seqAtStart = eventGate().read(connectionId);
      const result = await computeReconcileState(
        {
          fetchConnection: async (id) => (await getConnection(id)) ?? null,
          fetchLastMessage: async (id) => {
            const res = await getLastMessages([id]);
            return { message: res.data[id] ?? null, failed: Boolean(res.error) };
          },
          fetchChatDeletion: async (id) => {
            const deletions = await loadDeletionsForUser(me);
            deletionsRef.current = {
              chatUntil: deletions.chatUntil,
              revealed: deletions.revealed,
            };
            return {
              hiddenUntil: deletions.chatUntil.get(id) ?? null,
              revealed: deletions.revealed.has(id),
            };
          },
          fetchUnread: async (id) => {
            const readState = await getReadState(me);
            const counts = await getUnreadCounts(me, [id], readState);
            return id in counts ? counts[id] : null;
          },
          fetchPeerProfile: async (peerId) => {
            const res = await getProfiles([peerId]);
            if (res.error) return undefined;
            return res.data[peerId] ?? null;
          },
        },
        me,
        connectionId,
      );
      if (!aliveRef.current || meRef.current !== me) return false;
      const concurrent = eventGate().read(connectionId) !== seqAtStart;
      if (concurrent && !isFinalPass) return true;
      if (result.kind === 'transient') return !isFinalPass;
      if (result.kind === 'gone') {
        // With concurrent events the row may have re-appeared since the
        // fetch; never act on a stale removal — the retry/next load settles
        // it. A removal only ever narrows local display, so it cannot
        // expose data.
        if (!concurrent) applyConnectionGone(connectionId);
        return false;
      }
      setConnections((prev) =>
        result.visible
          ? upsertConnectionById(prev, result.conn)
          : removeConnectionById(prev, connectionId),
      );
      if (result.visible) {
        if (result.last) {
          const last = result.last;
          setLastMessages((prev) => mergeLastMessage(prev, last));
        }
        setLastMessages((prev) =>
          removeHiddenLastMessage(prev, connectionId, result.hiddenUntil),
        );
        if (result.unread !== null) {
          const unreadNow = result.unread;
          setUnread((prev) =>
            prev[connectionId] === unreadNow
              ? prev
              : { ...prev, [connectionId]: unreadNow },
          );
        }
        if (result.profile) {
          const profile = result.profile;
          const peerId = result.peerId;
          setOthers((prev) =>
            prev[peerId] === profile ? prev : { ...prev, [peerId]: profile },
          );
        }
      } else {
        setLastMessages((prev) => withoutKey(prev, connectionId));
        setUnread((prev) => withoutKey(prev, connectionId));
      }
      return false;
    },
    [me, applyConnectionGone],
  );

  /* Drain of conversations that changed WHILE a full load() was running:
     instead of applying state the reload is about to replace, their events
     were queued; re-derive exactly those narrowly once the reload landed.
     This is what makes a late event lose to fresh data instead of the
     reload overwriting it with a stale snapshot. */
  useEffect(() => {
    drainRef.current = () => {
      const ids = Array.from(pendingReconcileRef.current);
      pendingReconcileRef.current.clear();
      if (ids.length === 0) return;
      if (ids.length > LOAD_DRAIN_RECONCILE_CAP) {
        // Documented P1-5 fallback: MANY conversations changed mid-reload →
        // one full reload is cheaper than one narrow reconciliation each.
        // A single event can never reach this branch.
        void load();
        return;
      }
      for (const id of ids) schedulerRef.current?.request(id);
    };
  }, [load]);

  /* Realtime: connections, messages, profiles, deletions — one channel.
     P1-5 invariant: a realtime event never unconditionally reloads Home.
     Each payload routes through `createHomeRealtimeBridge` to the narrowest
     safe update — purely local application when the payload carries
     everything that changed, narrow per-conversation reconciliation when
     visibility/unread/profile must be re-derived through the RLS-scoped
     API, and load() is NOT referenced in any handler below. */
  useEffect(() => {
    if (!supabase || !me) return;
    // No network at all: do not open a realtime channel that can only fail.
    // The effect re-runs on reconnection (see the `offline` dependency), which
    // restores the unchanged P1-5 realtime wiring exactly as before.
    if (offline) return;
    const client = supabase;
    const scheduler = createReconcileScheduler((id, finalPass) =>
      runReconcile(id, finalPass),
    );
    schedulerRef.current = scheduler;
    const bridge = createHomeRealtimeBridge({
      me: () => me,
      isLoading: () => loadingRef.current,
      hasConnection: (id) => visibleIdsRef.current.has(id),
      noteEvent: (id) => {
        eventGate().bump(id);
        if (loadingRef.current) pendingReconcileRef.current.add(id);
      },
      onConnectionRow: applyConnectionRow,
      onConnectionGone: applyConnectionGone,
      onMessage: (msg, countUnread) => {
        // Hot path: the list order and the preview are derived from
        // `lastMessages`, so replacing the newest message of exactly this
        // conversation is enough to re-render and re-sort the row.
        setLastMessages((prev) => mergeLastMessage(prev, msg));
        // A peer message is unread while Home is on screen; own messages
        // (sent from another device) and non-text system events are never
        // counted (matches the connection_unread view, migration 0013).
        // F-04: a duplicate delivery of the same message (Realtime replay, or
        // our own send racing back from another device) is not a genuinely new
        // message and must never re-increment the unread badge — the badge is
        // incremented only when the message is the new latest for its
        // connection.
        if (countUnread && isNewLastMessage(lastMessagesRef.current, msg)) {
          setUnread((prev) => unreadAfterInsert(prev, msg.connection_id, true));
        }
      },
      onTombstone: (messageId, added) =>
        setDeletedForMe((prev) => withTombstone(prev, messageId, added)),
      onProfile: (row) =>
        setOthers((prev) =>
          row.id in prev ? { ...prev, [row.id]: row } : prev,
        ),
      onReconcile: (id) => scheduler.request(id),
    });
    const channel = client
      .channel('home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connections' },
        (payload) =>
          bridge.connections(payload as unknown as RealtimeEventPayloadLike),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) =>
          bridge.messageInsert(payload as unknown as RealtimeEventPayloadLike),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) =>
          bridge.messageUpdate(payload as unknown as RealtimeEventPayloadLike),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) =>
          bridge.profileUpdate(payload as unknown as RealtimeEventPayloadLike),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_deletions' },
        (payload) =>
          bridge.messageDeletions(payload as unknown as RealtimeEventPayloadLike),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_deletions' },
        (payload) =>
          bridge.chatDeletions(payload as unknown as RealtimeEventPayloadLike),
      )
      .subscribe();

    return () => {
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      client.removeChannel(channel);
    };
  }, [me, offline, applyConnectionRow, applyConnectionGone, runReconcile]);

  /* Rows sorted by latest activity (message time, else connection time). */
  const rows = useMemo<RowData[]>(() => {
    return connections
      .map((conn) => {
        const status = effectiveStatus(conn);
        const other = others[otherUserId(conn, me)] ?? null;
        return {
          conn,
          status,
          other,
          last: lastMessages[conn.id] ?? null,
          unread: unread[conn.id] ?? 0,
        };
      })
      .filter((r) => r.status !== 'expired')
      .sort((a, b) => {
        const ta =
          a.last?.created_at ?? a.conn.created_at ?? '';
        const tb =
          b.last?.created_at ?? b.conn.created_at ?? '';
        return tb.localeCompare(ta);
      });
  }, [connections, others, lastMessages, unread, me]);

  const hasChats = rows.length > 0;

  async function handleAccept(conn: Connection) {
    setBusyId(conn.id);
    setError(null);
    const err = await acceptConnection(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else load();
  }

  async function handleDecline(blockPeer = false) {
    if (!declineTarget) return;
    setDeclineBusy(true);
    setError(null);
    const err = await declineConnection(declineTarget.id, blockPeer);
    setDeclineBusy(false);
    setDeclineTarget(null);
    if (err) setError(err);
    else load();
  }

  async function handleCancelRequest(conn: Connection) {
    setBusyId(conn.id);
    setError(null);
    const err = await cancelConnectionRequest(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else load();
  }

  /* ---------------------- long-press row actions ---------------------- */

  // Clear the pending long-press timer when Home unmounts.
  useEffect(() => {
    return () => {
      if (pressTimerRef.current !== null) window.clearTimeout(pressTimerRef.current);
    };
  }, []);

  /** Open the shared chat action menu for this row. */
  async function openRowMenu(conn: Connection, other: Profile | null) {
    if (isSelfConnection(conn)) {
      // My Notes mirrors the Chat trash action: the clear-and-disable
      // dialog — never the block/delete sheet (there is no peer to block).
      setNotesClearTarget(conn);
      return;
    }
    // Mirror the Chat menu semantics: Unblock replaces Block user when the
    // current user already blocks this peer. The relation is re-read from
    // the database (RLS-scoped), never inferred from local UI state.
    const state = await getBlockState(me, otherUserId(conn, me));
    setMenuTarget({ conn, other, blockState: state });
    setMenuSheetOpen(true);
    setMenuConfirm(null);
  }

  function startRowPress(conn: Connection) {
    // Every action in the row menu (block/unblock, delete chat, clear notes)
    // is a server mutation. Offline it is not offered at all rather than
    // offered and silently failing — nothing is queued.
    if (offline) return;
    if (isSelfConnection(conn)) {
      // My Notes mirrors the Chat trash action: the clear-and-disable
      // dialog — never the block/delete sheet (there is no peer to block).
      if (pressTimerRef.current !== null) return;
      pressTimerRef.current = window.setTimeout(() => {
        pressTimerRef.current = null;
        suppressClickRef.current = true;
        setNotesClearTarget(conn);
      }, LONG_PRESS_MS);
      return;
    }
    if (pressTimerRef.current !== null) return;
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      // Swallow the click that follows the released long press so the
      // menu never races the normal open-chat navigation.
      suppressClickRef.current = true;
      const other = others[otherUserId(conn, me)] ?? null;
      void openRowMenu(conn, other);
    }, LONG_PRESS_MS);
  }

  function cancelRowPress() {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  function handleRowClick(conn: Connection) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    navigate(`#/chat/${conn.id}`);
  }

  /** Close the row menu and drop a stale click suppression: once the menu is
      gone the suppressed click can no longer arrive, and a lingering flag
      would swallow the next open-chat tap. */
  function closeRowMenu() {
    setMenuTarget(null);
    setMenuSheetOpen(false);
    setMenuConfirm(null);
    suppressClickRef.current = false;
  }

  /** Existing block flow (same API + confirmation the Chat menu uses). */
  async function handleMenuBlock() {
    if (!menuTarget) return;
    const conn = menuTarget.conn;
    const peerId = otherUserId(conn, me);
    setMenuBusy(true);
    setError(null);
    const err = await blockUser(me, peerId);
    setMenuBusy(false);
    setMenuConfirm(null);
    if (err) {
      setError(err);
      return;
    }
    setMenuTarget((prev) => (prev ? { ...prev, blockState: 'blockedByMe' } : prev));
    closeRowMenu();
  }

  async function handleMenuUnblock() {
    if (!menuTarget) return;
    const conn = menuTarget.conn;
    const peerId = otherUserId(conn, me);
    setError(null);
    const err = await unblockUser(me, peerId);
    if (err) {
      setError(err);
      return;
    }
    closeRowMenu();
  }

  /** Existing per-user chat deletion (never deletes for the peer). */
  async function handleMenuDelete() {
    if (!menuTarget) return;
    const conn = menuTarget.conn;
    setMenuBusy(true);
    setError(null);
    const err = await deleteChatForMe(me, conn.id);
    setMenuBusy(false);
    setMenuConfirm(null);
    if (err) {
      setError(err);
      return;
    }
    closeRowMenu();
    load();
  }

  /* My Notes long-press mirrors the Chat trash action: clear all notes and
     disable My Notes in one step (remove_my_notes() RPC). */
  async function handleClearMyNotes() {
    if (!notesClearTarget) return;
    setMenuBusy(true);
    setError(null);
    const err = await removeMyNotes(me, notesClearTarget.id);
    setMenuBusy(false);
    setNotesClearTarget(null);
    suppressClickRef.current = false;
    if (err) {
      setError(err);
      return;
    }
    load();
  }

  const menuOther = menuTarget?.other ?? null;

  return (
    <main className="home-screen">
      <header className="home-header">
        <button
          type="button"
          className="logo logo-button"
          onClick={() => navigate('#/')}
        >
          enough.
        </button>
        <div className="home-header-actions">
          <ThemeButton />
          <button
            type="button"
            className="icon-button"
            onClick={() => navigate('#/settings')}
            aria-label={t('home.settingsLabel')}
            title={t('home.settingsLabel')}
          >
            <GearIcon size={21} />
          </button>
        </div>
      </header>

      <OfflineBanner status={connectivity} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loadError && !loading ? (
        <section className="empty">
          <div className="empty-title" role="alert">
            {loadError}
          </div>
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            {t('errors.retry')}
          </button>
        </section>
      ) : !hasChats && !loading ? (
        <section className="empty">
          <div className="empty-title">{t('home.nothingHere')}</div>
          <div className="empty-text">{t('home.startChat')}</div>
        </section>
      ) : (
        <div
          className="chat-list"
          // Distinguishes "offline + locally stored" from "online + current
          // server data" for both styling and tests. Never set while online.
          data-offline-cached={offline && fromCache ? 'true' : undefined}
        >
          {rows.map(({ conn, status, other, last, unread: unreadCount }) => {
            const self = isSelfConnection(conn);
            const ended = status === 'ended';
            const name = self
              ? t('settingsScreen.myNotes')
              : ended
                ? t('chat.deletedAccount')
                : displayName(other);
            const sub = ended ? '' : `@${other?.username ?? '…'}`;
            const isRequest = status !== 'accepted' && status !== 'ended';
            const isIncoming = status === 'pending' && conn.user_b === me;
            const isOutgoing = status === 'pending' && conn.user_a === me;
            const declined = status === 'declined';
            const expiresAt = declined
              ? formatDate(
                  new Date(new Date(conn.created_at ?? '').getTime() + 14 * 24 * 60 * 60 * 1000),
                  getLang(),
                )
              : null;

            return (
              <div
                key={conn.id}
                className={`chat-row${isRequest ? ' request' : ''}${unreadCount > 0 ? ' unread' : ''}${self ? ' notes' : ''}`}
              >
                <button
                  type="button"
                  className="chat chat-overview-row"
                  onClick={() => handleRowClick(conn)}
                  onPointerDown={() => startRowPress(conn)}
                  onPointerUp={cancelRowPress}
                  onPointerLeave={cancelRowPress}
                  onPointerCancel={cancelRowPress}
                  onPointerMove={(e) => {
                    // Cancel the long-press when the pointer moves beyond a
                    // small slop (scrolling must not open the menu).
                    if (
                      pressTimerRef.current !== null &&
                      e.movementX * e.movementX + e.movementY * e.movementY > 36
                    ) {
                      cancelRowPress();
                    }
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <Avatar name={name} size={44} />
                  <div className="chat-text">
                    <div className="chat-topline">
                      <div className="chat-identity">
                        <span className="chat-name">{name}</span>
                        {self ? (
                          <span className="chat-notes-tag">
                            <NoteIcon size={12} />
                            {t('chat.myNotesTag')}
                          </span>
                        ) : (
                          sub && <span className="chat-username">{sub}</span>
                        )}
                      </div>
                      <span className="chat-time">
                        {last
                          ? formatRelative(last.created_at, getLang())
                          : conn.created_at
                            ? formatRelative(conn.created_at, getLang())
                            : ''}
                      </span>
                    </div>
                    <div className="chat-subline">
                      {isRequest ? (
                        <span className="chat-preview request-label">
                          {isIncoming
                            ? t('connection.requestTitle')
                            : isOutgoing
                              ? t('connection.requestSent')
                              : declined
                                ? `${t('connection.requestDeclined')} · ${expiresAt}`
                                : t('connection.requestExpired')}
                        </span>
                      ) : (
                        <>
                          {!(self && !last) && (
                            <span className="chat-preview">
                              {previewOf(
                                last ?? undefined,
                                getLang(),
                                other?.username ?? '',
                                me,
                                deletedForMe,
                              ) ?? ''}
                            </span>
                          )}
                          {unreadCount > 0 && (
                            // role="status" so the aria-label is an effective
                            // accessible name (a plain span's label is ignored
                            // by assistive tech) and count changes are
                            // announced politely.
                            <span className="unread-badge" role="status" aria-label={`${unreadCount} ${t('unread.unreadCount', { count: unreadCount })}`}>
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </button>
                {isIncoming && (
                  <div className="chat-row-actions">
                    <button
                      type="button"
                      className="btn-small"
                      disabled={busyId === conn.id || offline}
                      title={offline ? t('offline.actionUnavailable') : undefined}
                      onClick={() => handleAccept(conn)}
                    >
                      {t('connection.accept')}
                    </button>
                    <button
                      type="button"
                      className="btn-small ghost"
                      disabled={busyId === conn.id || offline}
                      title={offline ? t('offline.actionUnavailable') : undefined}
                      onClick={() => setDeclineTarget(conn)}
                    >
                      {t('connection.decline')}
                    </button>
                  </div>
                )}
                {isOutgoing && (
                  <div className="chat-row-actions">
                    <button
                      type="button"
                      className="btn-small ghost"
                      disabled={busyId === conn.id || offline}
                      title={offline ? t('offline.actionUnavailable') : undefined}
                      onClick={() => handleCancelRequest(conn)}
                    >
                      {t('connection.cancelRequest')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {declineTarget && (
        <Dialog
          title={t('connection.declinedTitle')}
          text={t('connection.declinedText')}
          confirmLabel={t('connection.decline')}
          cancelLabel={t('cancel')}
          busy={declineBusy}
          onConfirm={() => handleDecline(false)}
          extraAction={{
            label: t('block.declineAndBlock'),
            onClick: () => handleDecline(true),
          }}
          onCancel={() => setDeclineTarget(null)}
        />
      )}

      {menuTarget && (menuSheetOpen || menuConfirm !== null) && (
        <ChatActionMenu
          sheetOpen={menuSheetOpen}
          confirm={menuConfirm}
          title={menuOther ? displayName(menuOther) : undefined}
          peerUsername={menuOther?.username ?? ''}
          blockedByMe={menuTarget.blockState === 'blockedByMe'}
          busy={menuBusy}
          onSheetClose={() => setMenuSheetOpen(false)}
          onConfirmChange={(confirm) => {
            setMenuConfirm(confirm);
            // Canceling a confirmation closes the whole menu so the sheet
            // cannot reappear underneath it (same behavior as the in-chat
            // menu).
            if (confirm === null) closeRowMenu();
          }}
          onUnblock={() => handleMenuUnblock()}
          onBlock={handleMenuBlock}
          onDeleteChat={handleMenuDelete}
        />
      )}

      {notesClearTarget && (
        <Dialog
          title={t('chat.myNotesClearTitle')}
          text={t('chat.myNotesClearText')}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          danger
          busy={menuBusy}
          onConfirm={handleClearMyNotes}
          onCancel={() => {
            setNotesClearTarget(null);
            suppressClickRef.current = false;
          }}
        />
      )}
    </main>
  );
}
