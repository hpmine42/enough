// enough. — Chat realtime message merging (pure helpers).
// ---------------------------------------------------------------------------
// WHAT THIS IS
//   Pure helpers for the OPEN chat view's realtime message handling
//   (Chat.tsx). The chat subscribes to `postgres_changes` for the currently
//   open connection; when a messages INSERT/UPDATE arrives for that
//   conversation, the row is incrementally merged into the rendered message
//   list. A realtime event never re-runs the chat loader (no full reload):
//   the merge IS the state update, and the same semantics apply whether the
//   row comes from the live channel or from the queue of rows captured while
//   a page load was in flight.
//
// UPDATE BUFFERING (audit F-02)
//   An UPDATE that arrives while the initial page load is in flight is
//   captured into the same pending queue as INSERTs, tagged with the event
//   kind that produced it. The loader then drains the queue ONTO the freshly
//   loaded page: INSERTs append (dedupe by id), UPDATEs replace the page row
//   in place (e.g. a delete-for-everyone tombstone must win over the stale
//   pre-delete row the page was fetched with). Draining preserves arrival
//   order, so a message that was INSERTed and tombstoned while the load was
//   in flight ends up as the tombstone — exactly the state the steady-state
//   handlers would have produced had no load been running.
//
// SECURITY BOUNDARY
//   A Realtime payload is never treated as proof of authorization. The
//   subscription is scoped server-side (the channel is filtered to
//   connection_id = the open chat, and delivery respects RLS: only
//   connection participants can read a messages row). On top of that, every
//   row is re-scoped client-side: a row whose connection_id does not match
//   the open chat is dropped — mirroring the client-side scoping gate of
//   the Home realtime bridge (src/lib/homeRealtime.ts).
//
//   Merged rows are ciphertext-only. These helpers never parse, trim,
//   sanitize or otherwise mutate `ciphertext`: it is opaque E2EE data (or
//   the documented My Notes / legacy plaintext). Display plaintext is
//   resolved afterwards by the SAME shared E2EE display path (the
//   `decryptForDisplay` effect) that the initial load uses — one crypto
//   path for load and realtime alike, never a second one.
//
// Kept free of React and of the Supabase-bound `api.ts` module so the Node
// test runner can import it directly (see
// src/lib/__tests__/chat-realtime.test.mjs).

import type { Message } from './types';
import { compareMessagesAsc, isHiddenByChatDeletion } from './helpers.ts';

/**
 * Structural check of a realtime `messages` payload row.
 *
 * Malformed rows (missing id / connection_id / sender_id / created_at, or a
 * non-string ciphertext) are rejected fail-closed: they are dropped, never
 * applied and never crash the merge.
 */
export function isRealtimeMessageRow(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Message>;
  return (
    typeof m.id === 'string' &&
    m.id !== '' &&
    typeof m.connection_id === 'string' &&
    m.connection_id !== '' &&
    typeof m.sender_id === 'string' &&
    m.sender_id !== '' &&
    typeof m.created_at === 'string' &&
    m.created_at !== '' &&
    typeof m.ciphertext === 'string'
  );
}

/**
 * Merge a realtime messages INSERT into the open chat's rendered list.
 *
 *   - rows from another conversation are dropped (payload ≠ authorization);
 *   - rows hidden behind the chat-deletion cutoff are dropped;
 *   - a duplicate id (event replay, a racing own send from another device)
 *     returns the same array reference — the list never gains a second copy;
 *   - otherwise the row is appended and the list re-sorted by the same
 *     `(created_at, id)` order the database pagination uses, so rapid and
 *     out-of-order delivery converges to the freshly loaded order.
 *
 * Returns the same array reference when the event changes nothing, so
 * React can skip the re-render.
 */
export function mergeIncomingMessage(
  prev: Message[],
  row: unknown,
  connectionId: string,
  hiddenUntil: string | null | undefined,
): Message[] {
  if (!isRealtimeMessageRow(row)) return prev;
  if (row.connection_id !== connectionId) return prev;
  if (isHiddenByChatDeletion(row.created_at, hiddenUntil)) return prev;
  if (prev.some((m) => m.id === row.id)) return prev;
  return [...prev, row].sort(compareMessagesAsc);
}

/**
 * Merge a realtime messages UPDATE into the rendered list (e.g. a
 * delete-for-everyone tombstone: `deleted_at` set, ciphertext cleared).
 *
 * Only a row already present in the list is replaced in place; unknown ids
 * (the row was never rendered) and foreign rows are ignored. Same reference
 * when nothing changes.
 */
export function applyMessageUpdate(
  prev: Message[],
  row: unknown,
  connectionId: string,
): Message[] {
  if (!isRealtimeMessageRow(row)) return prev;
  if (row.connection_id !== connectionId) return prev;
  const idx = prev.findIndex((m) => m.id === row.id);
  if (idx === -1) return prev;
  if (prev[idx] === row) return prev;
  const next = prev.slice();
  next[idx] = row;
  return next;
}

/* ------------------------------------------------------------------ */
/* in-flight load buffer (INSERT + UPDATE, audit F-02)                 */
/* ------------------------------------------------------------------ */

/** The postgres_changes event kinds the open chat captures during a load. */
export type PendingRealtimeEvent = 'INSERT' | 'UPDATE';

/**
 * A row captured while the initial page load was in flight, tagged with the
 * event kind that delivered it. The tag is what lets the drain decide how
 * the row must be reconciled onto the loaded page: an INSERT is appended
 * (deduped by id), an UPDATE replaces the page's row in place.
 *
 * The queue is extended, not replaced: it is still the single buffer the
 * INSERT design (PR #94) introduced, and the drain still runs at the moment
 * the loader commits its page.
 */
export interface PendingRealtimeRow {
  event: PendingRealtimeEvent;
  row: Message;
}

/** Structural check of a pending-queue entry (see {@link PendingRealtimeRow}). */
export function isPendingRealtimeRow(value: unknown): value is PendingRealtimeRow {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PendingRealtimeRow>;
  return (
    (entry.event === 'INSERT' || entry.event === 'UPDATE') &&
    !!entry.row &&
    typeof entry.row === 'object'
  );
}

/**
 * Capture a validated realtime row into the in-flight-load queue.
 *
 * The queue mirrors what steady-state application would have produced, so
 * drain order == arrival order:
 *
 *   - an INSERT whose id is already queued is a replay and is dropped;
 *   - an UPDATE for a queued INSERT is APPENDED after it, so the drain
 *     appends the new row first and then tombstones/replaces it (a message
 *     created and deleted while the load was in flight ends up as the
 *     delete-for-everyone tombstone, and never as the visible row);
 *   - an UPDATE for an already queued UPDATE replaces that entry's payload
 *     in place: when several updates for one message arrive during the
 *     load, the newest received payload is the one the drain applies
 *     (realtime delivers a row's changes in commit order, so arrival order
 *     is the authoritative "newest" signal — the same rule the steady-state
 *     handlers use);
 *   - entries for different messages keep their arrival order (no-op for
 *     correctness, but keeps the queue deterministic).
 *
 * The row must already have passed the caller's structural/scope checks (the
 * Chat.tsx handlers validate before capturing, exactly like the INSERT path
 * did before this helper existed). Returns the same array reference when
 * nothing changed.
 */
export function captureRealtimeRow(
  pending: PendingRealtimeRow[],
  event: PendingRealtimeEvent,
  row: Message,
): PendingRealtimeRow[] {
  const idx = pending.findIndex((p) => p.row.id === row.id);
  if (idx === -1) return [...pending, { event, row }];
  if (event === 'INSERT') return pending; // duplicate INSERT (replay): already queued
  if (pending[idx].event === 'INSERT') {
    // Newer state for a message whose INSERT is still queued: the INSERT must
    // run first at drain time, so the UPDATE is queued behind it.
    return [...pending, { event, row }];
  }
  if (pending[idx].row === row) return pending; // same delivery repeated
  const next = pending.slice();
  next[idx] = { event, row }; // newest UPDATE payload wins, arrival slot kept
  return next;
}

/**
 * Apply rows captured while a page load was in flight onto the freshly
 * loaded page.
 *
 * The loader commits a page snapshot fetched at one instant; realtime rows
 * that landed during the fetch must not be silently dropped by the commit
 * (nor may the commit be skipped for them — the page is authoritative for
 * everything it contains). Draining the captured rows through the same
 * merge semantics keeps order, dedupe and scoping identical to the steady
 * state:
 *
 *   - a bare `Message` entry (or an entry tagged INSERT) is merged as an
 *     INSERT: rows already in the page dedupe by id, new rows are appended
 *     and the list re-sorted;
 *   - an entry tagged UPDATE is applied as an UPDATE: the loaded page row is
 *     replaced in place by the captured row (a delete-for-everyone tombstone
 *     captured mid-load therefore wins over the stale pre-delete row the
 *     page was fetched with); unknown ids stay ignored, so an UPDATE never
 *     invents a message the loaded page does not contain.
 *
 * Entries are processed in arrival order. Malformed / foreign / hidden rows
 * are dropped as always (each entry is re-validated and re-scoped by the
 * same checks the live handlers use).
 *
 * Returns the same array reference when the pending rows change nothing.
 */
export function mergeLoadedPage(
  page: Message[],
  pending: Array<Message | PendingRealtimeRow>,
  connectionId: string,
  hiddenUntil: string | null | undefined,
): Message[] {
  let out = page;
  for (const entry of pending) {
    if (isPendingRealtimeRow(entry)) {
      out =
        entry.event === 'UPDATE'
          ? applyMessageUpdate(out, entry.row, connectionId)
          : mergeIncomingMessage(out, entry.row, connectionId, hiddenUntil);
    } else {
      // Untagged entry: legacy INSERT-style drain entry.
      out = mergeIncomingMessage(out, entry, connectionId, hiddenUntil);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* conversation lifecycle (audit F-01)                                 */
/* ------------------------------------------------------------------ */

/**
 * Monotonic conversation-lifecycle token for async Chat operations.
 *
 * `Chat` is a single component instance reused across `#/chat/<id>`
 * transitions, so an async operation started for conversation A (sending,
 * loading an older page) used to be able to resolve after the component had
 * switched to conversation B and write A's result into B's message state —
 * including E2EE ciphertext that would then be processed under B's
 * conversation/session context.
 *
 * The guard is a generation counter:
 *   - `advance()` is called by `Chat` synchronously when the `connectionId`
 *     prop changes (during render, so even an async continuation that
 *     resolves between render and effect sees the new generation);
 *   - every async message-state path captures `current()` before its first
 *     await and re-checks `isCurrent(token)` after every await;
 *   - as soon as the conversation changed, the stale result is discarded
 *     before it can enter React state — it is never applied to the new
 *     conversation and never reaches the E2EE decrypt path.
 */
export interface ChatLifecycle {
  /** Start a new conversation generation and return its token. */
  advance: () => number;
  /** Token of the current conversation generation. */
  current: () => number;
  /** True while `token` still belongs to the current generation. */
  isCurrent: (token: number) => boolean;
}

export function createChatLifecycle(): ChatLifecycle {
  let generation = 0;
  return {
    advance: () => ++generation,
    current: () => generation,
    isCurrent: (token) => token === generation,
  };
}
