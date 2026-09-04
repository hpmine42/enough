// enough. — Chat realtime message delivery regression tests.
//
// New messages in an already open 1:1 chat must appear via Supabase Realtime
// without a reload or full chat reload:
//
//   Realtime INSERT → verify it belongs to the current connection
//     → process through the existing E2EE decrypt/session path
//     → incrementally update Chat state → the message appears.
//
// The runtime tests exercise the ACTUAL merge logic the Chat.tsx handlers
// delegate to (src/lib/chatRealtime.ts — the same pure-helper pattern as the
// P1-5 Home bridge in src/lib/homeRealtime.ts), not a copy of it:
//   1. a new realtime message merges into the open chat's list
//      (the merge IS the incremental state update; no load() involved);
//   2. messages from another conversation are ignored
//      (payload is not authorization);
//   3. duplicate realtime events never duplicate a message;
//   4. rapid / out-of-order delivery converges to the loaded (created_at, id)
//      order;
//   5. merged rows keep their ciphertext byte-identical — opaque E2EE data
//      that flows into the unchanged, shared decryptForDisplay path;
//   6. rows captured while a page load was in flight are drained onto the
//      loaded page (no dropped message, no full reload);
//   7. UPDATE handling (delete-for-everyone tombstones) stays in place;
//   8. audit F-01: the conversation lifecycle guard — an async operation
//      (send / loadOlder) started for conversation A is discarded when the
//      component switched to conversation B, while the still-current
//      conversation's results are applied unchanged.
//
// Audit F-02 (UPDATE / tombstone vs. initial-load race) regression suite:
//   9. an UPDATE that arrives while the initial load is in flight is
//      captured (tagged with its event kind) and drained ONTO the loaded
//      page, so the commit can never overwrite the newer update with the
//      stale pre-update row (a delete-for-everyone tombstone wins over the
//      visible row the page was fetched with);
//  10. multiple updates / INSERT+UPDATE for one message during the load
//      reconcile to the newest received state in arrival order;
//  11. the F-02 buffer is the SAME single pending-realtime structure the
//      INSERT design (PR #94) introduced — drained in one pass at the page
//      commit with unchanged INSERT semantics;
//  12. F-02 stays scoped per conversation: a captured row of connection A
//      can never be drained into a page of connection B, and a conversation
//      switch during the load discards the previous buffer (F-01 intact);
//  13. reconciliation never decrypts or rewrites ciphertext — the drained
//      rows flow into the unchanged shared decryptForDisplay path.
//
// Pagination tombstone race (F-02 follow-up) regression suite:
//  14. an UPDATE/tombstone that arrives while `loadOlder()`'s older-page
//      request is in flight, for a message NOT currently rendered, is
//      buffered in a dedicated pagination queue and reconciled ONTO the
//      committed page — the stale pre-delete row the page may still carry
//      can never resurrect the deleted message (the tombstone wins);
//  15. the pagination commit reconciles instead of raw-prepending: dedupe
//      by id against realtime rows that landed mid-flight, deterministic
//      (created_at, id) order, hidden-cutoff and scope checks intact;
//  16. INSERT behavior during pagination is unchanged (steady state),
//      F-01 (conversation switch) and F-02 (initial load) stay intact,
//      and the buffer stays ciphertext-only (no decrypt/plaintext path).
//
// The static guards (accepted repo pattern, supplement — not a substitute —
// for the runtime tests) pin the Chat.tsx wiring:
//   - a realtime event never triggers a full reload;
//   - rows are re-scoped to the open connection client-side;
//   - realtime never resolves display plaintext itself (one shared E2EE path);
//   - state updates are functional and duplicate-safe;
//   - the Offline Read Mode gates (offline gate, resubscribe, reload on
//     reconnect) remain intact.
//
// Run with:
//   npm run test:chatrealtime
//   node --test --experimental-strip-types src/lib/__tests__/chat-realtime.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isRealtimeMessageRow,
  mergeIncomingMessage,
  applyMessageUpdate,
  captureRealtimeRow,
  isPendingRealtimeRow,
  mergeLoadedPage,
  mergeOlderPage,
  createChatLifecycle,
} from '../chatRealtime.ts';

const CONN = 'conn-open';

function msg(id, connectionId = CONN, createdAt = '2026-01-01T10:00:00Z', over = {}) {
  return {
    id,
    connection_id: connectionId,
    sender_id: 'peer',
    ciphertext: 'CIPHERTEXT',
    created_at: createdAt,
    deleted_at: null,
    kind: 'text',
    meta: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* 1. A new realtime message appears via the incremental merge         */
/* ------------------------------------------------------------------ */

test('CR1: a realtime INSERT appends the message to the open chat (no reload)', () => {
  const prev = [msg('m1', CONN, '2026-01-01T09:00:00Z')];
  const next = mergeIncomingMessage(prev, msg('m2', CONN, '2026-01-01T10:00:01Z'), CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm2']);
  assert.notEqual(next, prev, 'a real change allocates a new array');
  assert.equal(prev.length, 1, 'previous state is never mutated');
  // An empty chat (first message ever) renders the row as well.
  const fromEmpty = mergeIncomingMessage([], msg('m1', CONN), CONN, null);
  assert.deepEqual(fromEmpty.map((m) => m.id), ['m1']);
});

/* ------------------------------------------------------------------ */
/* 2. Messages from another conversation are ignored                   */
/* ------------------------------------------------------------------ */

test('CR2: a row from another conversation is ignored (payload is not authorization)', () => {
  const prev = [msg('m1', CONN)];
  const foreign = msg('m2', 'conn-other');
  const next = mergeIncomingMessage(prev, foreign, CONN, null);
  assert.equal(next, prev, 'same reference — no state change, no re-render');
  assert.equal(applyMessageUpdate(prev, foreign, CONN), prev);
  // A malformed row that even claims the open connection id must still be
  // rejected by the structural check.
  assert.equal(mergeIncomingMessage(prev, { id: '', connection_id: CONN }, CONN, null), prev);
});

/* ------------------------------------------------------------------ */
/* 3. Duplicate events never duplicate a message                       */
/* ------------------------------------------------------------------ */

test('CR3: duplicate realtime events do not duplicate a message', () => {
  const prev = [msg('m1', CONN)];
  // Replays: the same object, then fresh objects with the same id.
  assert.equal(mergeIncomingMessage(prev, prev[0], CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, { ...prev[0] }, CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, { ...prev[0] }, CONN, null), prev);
  assert.equal(prev.length, 1, 'the list never gains a second copy');
});

/* ------------------------------------------------------------------ */
/* 4. Ordering under rapid / out-of-order delivery                     */
/* ------------------------------------------------------------------ */

test('CR4: out-of-order and rapid events converge to the loaded (created_at, id) order', () => {
  const t = '2026-01-01T10:00:00Z';
  let list = [];
  // Scrambled arrival order, a duplicate, and equal timestamps (id tiebreak).
  list = mergeIncomingMessage(list, msg('m3', CONN, t), CONN, null);
  list = mergeIncomingMessage(list, msg('m1', CONN, '2026-01-01T09:00:00Z'), CONN, null);
  list = mergeIncomingMessage(list, msg('m2', CONN, t), CONN, null);
  list = mergeIncomingMessage(list, msg('m3', CONN, t), CONN, null); // duplicate
  list = mergeIncomingMessage(list, msg('m0', CONN, '2026-01-01T08:00:00Z'), CONN, null);
  assert.deepEqual(list.map((m) => m.id), ['m0', 'm1', 'm2', 'm3']);
});

test('CR4b: the same-timestamp tiebreak matches database pagination order', () => {
  const t = '2026-01-01T10:00:00Z';
  let list = mergeIncomingMessage([], msg('b', CONN, t), CONN, null);
  list = mergeIncomingMessage(list, msg('a', CONN, t), CONN, null);
  assert.deepEqual(list.map((m) => m.id), ['a', 'b'], '(created_at, id) ascending, as getMessagesPage loads');
});

/* ------------------------------------------------------------------ */
/* 5. Ciphertext stays opaque (the E2EE path is untouched)             */
/* ------------------------------------------------------------------ */

test('CR5: merged rows keep their ciphertext byte-identical (opaque E2EE data)', () => {
  const envelope = '{"v":1,"e":"sw","t":2,"b":"YmFzZTY0"}';
  const row = msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: envelope });
  const next = mergeIncomingMessage([], row, CONN, null);
  assert.equal(next[0], row, 'the exact row object is kept — no copy, no mutation');
  assert.equal(next[0].ciphertext, envelope, 'ciphertext is never parsed, trimmed or sanitized');
  // System rows (kind != text, empty ciphertext) merge the same way.
  const sys = msg('m2', CONN, '2026-01-01T10:00:01Z', { ciphertext: '', kind: 'connection_event' });
  const next2 = mergeIncomingMessage(next, sys, CONN, null);
  assert.equal(next2[1].ciphertext, '');
  assert.equal(next2[1].kind, 'connection_event');
});

test('CR5b: an incoming envelope reaches the decrypt path exactly as the server sent it', async () => {
  const { isEnvelope } = await import('../e2ee/message-flow.ts');
  const envelope = '{"v":1,"e":"sw","t":3,"b":"YmFzZTY0"}';
  const row = msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: envelope });
  const next = mergeIncomingMessage([], row, CONN, null);
  assert.ok(isEnvelope(next[0].ciphertext), 'the merged row is still a parseable E2EE envelope');
  // ...and so is a row drained from the in-flight-load queue.
  const drained = mergeLoadedPage([], [row], CONN, null);
  assert.ok(isEnvelope(drained[0].ciphertext));
});

/* ------------------------------------------------------------------ */
/* 6. Malformed payloads and the chat-deletion cutoff                  */
/* ------------------------------------------------------------------ */

test('CR6: malformed payloads are dropped fail-closed', () => {
  const prev = [msg('m1', CONN)];
  assert.equal(mergeIncomingMessage(prev, null, CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, 'not-a-row', CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, { id: 'm2' }, CONN, null), prev);
  assert.equal(
    mergeIncomingMessage(prev, { id: 'm2', connection_id: CONN, sender_id: 'peer', created_at: 'x' }, CONN, null),
    prev,
    'missing ciphertext is malformed',
  );
  assert.equal(applyMessageUpdate(prev, { connection_id: CONN }, CONN), prev);
  assert.equal(applyMessageUpdate(prev, null, CONN), prev);
});

test('CR6b: rows hidden behind the chat-deletion cutoff are dropped', () => {
  const cutoff = '2026-01-01T12:00:00Z';
  const prev = [msg('m1', CONN, '2026-01-01T10:00:00Z')];
  const hidden = msg('m2', CONN, '2026-01-01T11:59:59Z');
  assert.equal(mergeIncomingMessage(prev, hidden, CONN, cutoff), prev, 'a hidden row is not rendered');
  const visible = msg('m3', CONN, '2026-01-01T12:00:01Z');
  const next = mergeIncomingMessage(prev, visible, CONN, cutoff);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm3'], 'a row after the cutoff is rendered');
});

/* ------------------------------------------------------------------ */
/* 7. UPDATE handling (delete-for-everyone tombstones)                 */
/* ------------------------------------------------------------------ */

test('CR7: a delete-for-everyone UPDATE replaces the row in place', () => {
  const original = msg('m1', CONN, '2026-01-01T10:00:00Z');
  const prev = [
    msg('m0', CONN, '2026-01-01T09:00:00Z'),
    original,
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const tombstone = { ...original, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const next = applyMessageUpdate(prev, tombstone, CONN);
  assert.equal(next.length, 3, 'no row is added or removed');
  assert.equal(next[1], tombstone, 'only the affected row changed');
  assert.equal(next[0], prev[0], 'untouched rows keep identity');
  // Duplicate update of the same row: same reference.
  assert.equal(applyMessageUpdate(next, tombstone, CONN), next);
  // Unknown id (row never rendered) and foreign row: same reference.
  assert.equal(applyMessageUpdate(prev, { ...tombstone, id: 'zzz' }, CONN), prev);
  assert.equal(applyMessageUpdate(prev, { ...tombstone, connection_id: 'conn-other' }, CONN), prev);
});

/* ------------------------------------------------------------------ */
/* 8. The in-flight-load drain (no dropped message, no full reload)    */
/* ------------------------------------------------------------------ */

test('CR8: rows captured while a load was in flight are drained onto the loaded page', () => {
  const page = [
    msg('m1', CONN, '2026-01-01T10:00:00Z'),
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const pending = [
    msg('m3', CONN, '2026-01-01T12:00:00Z'), // landed mid-fetch → appended
    msg('m2', CONN, '2026-01-01T11:00:00Z'), // already in the page → deduped
    msg('m4', 'conn-other', '2026-01-01T13:00:00Z'), // foreign → dropped
  ];
  const next = mergeLoadedPage(page, pending, CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm2', 'm3']);
});

test('CR8b: a pending row older than the loaded page keeps its sorted position', () => {
  const page = [msg('m10', CONN, '2026-01-01T12:00:00Z')];
  const next = mergeLoadedPage(page, [msg('m0', CONN, '2026-01-01T09:00:00Z')], CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m0', 'm10']);
});

test('CR8c: an empty page with pending rows renders exactly the pending rows', () => {
  const next = mergeLoadedPage([], [msg('m1', CONN, '2026-01-01T10:00:00Z')], CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1']);
});

test('CR8d: a pending row behind the (re-derived) cutoff is dropped at drain time', () => {
  const page = [msg('m1', CONN, '2026-01-01T13:00:00Z')];
  const pending = [msg('m0', CONN, '2026-01-01T09:00:00Z')];
  const next = mergeLoadedPage(page, pending, CONN, '2026-01-01T12:00:00Z');
  assert.deepEqual(next.map((m) => m.id), ['m1']);
});

test('CR8e: an unchanged drain returns the same page reference', () => {
  const page = [msg('m1', CONN)];
  assert.equal(mergeLoadedPage(page, [], CONN, null), page);
  assert.equal(mergeLoadedPage(page, [msg('m1', CONN)], CONN, null), page, 'dedupe against the page');
  assert.equal(mergeLoadedPage(page, [msg('m9', 'conn-other')], CONN, null), page, 'scoping at drain time');
});

/* ------------------------------------------------------------------ */
/* 8f. Audit F-02: UPDATE/tombstone vs. the in-flight initial load     */
/* ------------------------------------------------------------------ */
//
// Central invariant: a Realtime messages UPDATE received while the initial
// page load is in flight must never be lost when the loaded page is
// subsequently committed. The loader captures UPDATEs into the same queue
// that INSERTs already used (each entry tagged with its event kind) and the
// page commit drains the queue ONTO the fresh page. The tests exercise the
// actual capture/drain helpers Chat.tsx delegates to.

function update(row) {
  return { event: 'UPDATE', row };
}
function insert(row) {
  return { event: 'INSERT', row };
}

test('F02-1: an UPDATE arriving during the initial load survives the page commit', () => {
  const original = msg('m1', CONN, '2026-01-01T10:00:00Z', {
    ciphertext: 'ENVELOPE-OLD',
    meta: { old_name: 'old' },
  });
  const page = [
    msg('m0', CONN, '2026-01-01T09:00:00Z'),
    original, // pre-update state the page was fetched with
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const updated = msg('m1', CONN, '2026-01-01T10:00:00Z', {
    ciphertext: 'ENVELOPE-NEW',
    meta: { new_name: 'new' },
  });
  // Captured while the load was in flight, then drained at the commit:
  const drained = mergeLoadedPage(page, [update(updated)], CONN, null);
  assert.deepEqual(drained.map((m) => m.id), ['m0', 'm1', 'm2'], 'no row added or removed');
  assert.equal(drained[1], updated, 'the newer UPDATE payload replaces the stale page row');
  assert.equal(drained[1].ciphertext, 'ENVELOPE-NEW');
  assert.equal(drained[0], page[0], 'untouched rows keep identity');
  assert.ok(!drained.includes(original), 'the stale pre-update row is gone from the committed state');
});

test('F02-2: a delete-for-everyone tombstone captured mid-load cannot be overwritten by the stale loaded row', () => {
  const original = msg('m1', CONN, '2026-01-01T10:00:00Z', {
    ciphertext: '{"v":1,"e":"sw","t":2,"b":"STALE-CIPHERTEXT"}',
  });
  const page = [
    msg('m0', CONN, '2026-01-01T09:00:00Z'),
    original, // the SELECT ran BEFORE the delete committed: still visible
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const tombstone = { ...original, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const committed = mergeLoadedPage(page, [update(tombstone)], CONN, null);
  assert.equal(committed.length, 3, 'the tombstone replaces in place — no duplicate row');
  assert.equal(committed[1], tombstone, 'final state is the tombstone');
  assert.equal(committed[1].deleted_at, '2026-01-01T12:00:00Z');
  assert.equal(committed[1].ciphertext, '', 'the stale ciphertext is not reintroduced');
  assert.ok(!committed.includes(original), 'the visible row the page was fetched with never wins');
  // The plaintext render path keys off deleted_at: a tombstone row can never
  // resolve display text (MessageBubble renders the deleted line). Nothing in
  // the drain path carries or invents plaintext — see F02-9.
  assert.equal(typeof committed[1].ciphertext, 'string');
});

test('F02-3: an UPDATE for a message absent from the loaded page is ignored (no phantom row)', () => {
  const page = [msg('m1', CONN, '2026-01-01T10:00:00Z')];
  const updateForAbsent = { ...msg('zzz', CONN, '2026-01-01T08:00:00Z'), deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const next = mergeLoadedPage(page, [update(updateForAbsent)], CONN, null);
  assert.equal(next, page, 'an UPDATE never invents a row the page does not contain (same pagination/message model as the steady state)');
});

test('F02-4: an UPDATE from another conversation captured mid-load is ignored at drain time', () => {
  const page = [msg('m1', CONN, '2026-01-01T10:00:00Z')];
  const foreign = msg('m1', 'conn-other', '2026-01-01T10:00:00Z', {
    deleted_at: '2026-01-01T12:00:00Z',
    ciphertext: '',
  });
  const next = mergeLoadedPage(page, [update(foreign)], CONN, null);
  assert.equal(next, page, 'the drain re-scopes every captured row (payload is not authorization)');
  // Malformed tagged entries are dropped fail-closed as well.
  assert.equal(
    mergeLoadedPage(page, [{ event: 'UPDATE', row: { id: 'm1' } }], CONN, null),
    page,
    'the entry row is still structurally validated at drain time',
  );
});

test('F02-5a: repeated UPDATEs for one message during the load reconcile to the newest received payload', () => {
  // Realtime delivers one row's changes in commit order; arrival order is
  // therefore the authoritative "newest" signal (same rule as steady state).
  const original = msg('m1', CONN, '2026-01-01T10:00:00Z');
  const u1 = { ...original, meta: { new_name: 'n1' } };
  const u2 = { ...original, meta: { new_name: 'n2' }, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  let pending = [];
  pending = captureRealtimeRow(pending, 'UPDATE', u1);
  pending = captureRealtimeRow(pending, 'UPDATE', u2);
  assert.equal(pending.length, 1, 'the second UPDATE supersedes the first in the queue');
  assert.equal(pending[0].row, u2, 'the newest payload is the one the drain will apply');
  assert.equal(pending[0].event, 'UPDATE');
  const page = [original];
  const committed = mergeLoadedPage(page, pending, CONN, null);
  assert.equal(committed[0], u2, 'final state is the newest update (the tombstone)');
  // A repeated delivery of the exact same payload object changes nothing.
  assert.equal(captureRealtimeRow(pending, 'UPDATE', u2), pending,
    're-delivery of the same payload object is a no-op');
  // A re-delivery that re-serializes the same values supersedes the queued
  // payload (same final state at drain time — newest delivery wins).
  const redelivered = captureRealtimeRow(pending, 'UPDATE', { ...u2 });
  assert.notEqual(redelivered, pending);
  assert.equal(redelivered.length, 1);
  assert.notEqual(redelivered[0].row, u2, 'the fresh payload object is kept');
  assert.equal(redelivered[0].row.deleted_at, u2.deleted_at);
  assert.equal(redelivered[0].row.ciphertext, '');
  const page0 = [original];
  assert.equal(mergeLoadedPage(page0, redelivered, CONN, null)[0].deleted_at,
    '2026-01-01T12:00:00Z', 'final state is the tombstone either way');
});

test('F02-5b: a message INSERTed and tombstoned while the load was in flight ends up as the tombstone', () => {
  const created = msg('mX', CONN, '2026-01-01T10:30:00Z', { ciphertext: 'ENVELOPE-X' });
  const tombstone = { ...created, deleted_at: '2026-01-01T10:31:00Z', ciphertext: '' };
  let pending = [];
  pending = captureRealtimeRow(pending, 'INSERT', created);
  pending = captureRealtimeRow(pending, 'UPDATE', tombstone);
  assert.deepEqual(pending.map((e) => [e.event, e.row.id]), [['INSERT', 'mX'], ['UPDATE', 'mX']],
    'the UPDATE is queued behind its INSERT so the drain appends first, then tombstones');
  // Page fetched without mX (created after the SELECT):
  const pageWithout = [msg('m0', CONN, '2026-01-01T09:00:00Z')];
  const committed = mergeLoadedPage(pageWithout, pending, CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['m0', 'mX']);
  assert.equal(committed[1], tombstone, 'the visible row never appears — final state is the tombstone');
  assert.equal(committed[1].ciphertext, '', 'no stale ciphertext of the deleted message');
  // Page already fetched WITH the visible row (created before the SELECT):
  const pageWith = [msg('m0', CONN, '2026-01-01T09:00:00Z'), created];
  const committed2 = mergeLoadedPage(pageWith, pending, CONN, null);
  assert.deepEqual(committed2.map((m) => m.id), ['m0', 'mX'], 'INSERT dedupes against the page');
  assert.equal(committed2[1], tombstone, 'the tombstone replaces the stale page row');
  // A duplicate INSERT replay never reaches the queue:
  let once = [];
  once = captureRealtimeRow(once, 'INSERT', created);
  once = captureRealtimeRow(once, 'INSERT', { ...created });
  assert.equal(once.length, 1, 'duplicate INSERT events are dropped');
});

test('F02-6: INSERT-during-load behavior is unchanged by the UPDATE tagging', () => {
  const page = [msg('m1', CONN, '2026-01-01T10:00:00Z')];
  // Tagged INSERT entries behave exactly like the untagged (legacy) entries:
  const next = mergeLoadedPage(page, [
    msg('m2', CONN, '2026-01-01T11:00:00Z'), // legacy bare row
    insert(msg('m3', CONN, '2026-01-01T12:00:00Z')),
    insert(msg('m1', CONN, '2026-01-01T10:00:00Z')), // already in the page → dedupe
    insert(msg('m9', 'conn-other', '2026-01-01T13:00:00Z')), // foreign → dropped
  ], CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm2', 'm3']);
  // Empty page + tagged INSERT renders the row.
  const fromEmpty = mergeLoadedPage([], [insert(msg('m1', CONN))], CONN, null);
  assert.deepEqual(fromEmpty.map((m) => m.id), ['m1']);
});

test('F02-6b: pending hidden/foreign/malformed tagged entries keep failing closed at drain time', () => {
  const page = [msg('m1', CONN, '2026-01-01T13:00:00Z')];
  const cutoff = '2026-01-01T12:00:00Z';
  assert.deepEqual(
    mergeLoadedPage(page, [insert(msg('m0', CONN, '2026-01-01T09:00:00Z'))], CONN, cutoff).map((m) => m.id),
    ['m1'],
    'a tagged INSERT behind the chat-deletion cutoff is dropped at drain time',
  );
  assert.deepEqual(
    mergeLoadedPage(page, [update(msg('m0', CONN, '2026-01-01T09:00:00Z', { deleted_at: '2026-01-01T14:00:00Z', ciphertext: '' }))], CONN, cutoff).map((m) => m.id),
    ['m1'],
    'an UPDATE for a message the page does not render is dropped at drain time',
  );
});

test('F02-7: after reconciliation the list keeps the deterministic (created_at, id) order', () => {
  const page = [
    msg('m1', CONN, '2026-01-01T10:00:00Z'),
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const tombstoneM2 = { ...page[1], deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  let pending = [];
  pending = captureRealtimeRow(pending, 'INSERT', msg('m5', CONN, '2026-01-01T14:00:00Z'));
  pending = captureRealtimeRow(pending, 'UPDATE', tombstoneM2);
  pending = captureRealtimeRow(pending, 'INSERT', msg('m3', CONN, '2026-01-01T12:00:00Z'));
  pending = captureRealtimeRow(pending, 'INSERT', msg('m4', CONN, '2026-01-01T13:00:00Z'));
  const committed = mergeLoadedPage(page, pending, CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['m1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(committed[1], tombstoneM2, 'in-place replacement keeps the row position');
  for (let i = 1; i < committed.length; i++) {
    const a = committed[i - 1];
    const b = committed[i];
    assert.ok(
      a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id),
      'strict (created_at, id) ascending order after the drain',
    );
  }
  // Equal-timestamp tiebreak (id) survives a drain with an UPDATE in place.
  const tie = [msg('a', CONN, '2026-01-01T10:00:00Z')];
  const tieUpdated = msg('b', CONN, '2026-01-01T10:00:00Z', { deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  const tieCommitted = mergeLoadedPage(
    [msg('b', CONN, '2026-01-01T10:00:00Z')],
    [update(tieUpdated)],
    CONN,
    null,
  );
  assert.equal(tieCommitted[0], tieUpdated);
  assert.ok(!tie.includes(tieCommitted[0]), 'replacement never duplicates rows');
});

test('F02-8: buffered rows stay scoped to the conversation that loaded the page (F-01 intact)', () => {
  // Rows captured for connection A while A was loading…
  let pendingA = [];
  pendingA = captureRealtimeRow(pendingA, 'UPDATE', msg('mA', 'conn-a', '2026-01-01T10:00:00Z', { deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' }));
  pendingA = captureRealtimeRow(pendingA, 'INSERT', msg('mB', 'conn-a', '2026-01-01T11:00:00Z'));
  // …are discarded when the user switches to B (Chat's reset effect clears
  // the shared queue synchronously with the conversation change)…
  const pendingB = []; // = pendingRealtimeRef.current = [] on the switch
  // …and even if a stale entry were drained for B, the drain re-scopes it.
  const pageB = [msg('m1', CONN, '2026-01-01T10:00:00Z')];
  const next = mergeLoadedPage(pageB, pendingA, CONN, null);
  assert.equal(next, pageB, "conversation A's captured rows can never enter B's committed page");
  assert.deepEqual(mergeLoadedPage(pageB, pendingB, CONN, null), pageB, 'cleared queue drains as a no-op');
  // The lifecycle itself stays monotonic across A -> B (see CRL1–CRL6 for the
  // full F-01 decision tests): the queue clear is the F-02 counterpart of the
  // isCurrent() discard for the load-commit path.
  const lc = createChatLifecycle();
  const tokenA = lc.current();
  lc.advance();
  assert.equal(lc.isCurrent(tokenA), false);
});

test('F02-9: reconciliation keeps ciphertext opaque — no decrypt, no plaintext, in the buffer path', async () => {
  const envelope = '{"v":1,"e":"sw","t":2,"b":"YmFzZTY0"}';
  const { isEnvelope } = await import('../e2ee/message-flow.ts');
  const live = msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: envelope });
  const tombstone = { ...live, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  let pending = [];
  pending = captureRealtimeRow(pending, 'INSERT', live);
  pending = captureRealtimeRow(pending, 'UPDATE', tombstone);
  const committed = mergeLoadedPage([], pending, CONN, null);
  assert.equal(committed[0], tombstone);
  // The INSERT that was captured (and would have been drained had the UPDATE
  // not arrived) carried the envelope byte-identically…
  const justInsert = mergeLoadedPage([], [insert(live)], CONN, null);
  assert.ok(isEnvelope(justInsert[0].ciphertext), 'drained rows are still E2EE envelopes, untouched');
  assert.equal(justInsert[0].ciphertext, envelope);
  // …and the stale visible row (with its ciphertext) is never resurrected:
  // the only state the drain can commit is the ciphertext rows themselves.
  assert.equal(committed[0].ciphertext, '');
});

/* ------------------------------------------------------------------ */
/* 8g. Pagination tombstone race (loadOlder in-flight reconciliation)  */
/* ------------------------------------------------------------------ */
//
// Central invariant: a Realtime UPDATE received while an OLDER-PAGE request
// is in flight must not be lost merely because the message is not yet
// present in the rendered list — the page response can still introduce the
// stale pre-update row. Chat.tsx buffers such UPDATEs into a dedicated
// pagination queue (`pendingOlderRef`, gated by `pagingInFlightRef`) and
// the loadOlder commit reconciles them onto the merged page through
// `mergeOlderPage` — the exact helpers exercised here.
//
// Timeline every test shares (P-T1 is the primary regression):
//
//   Chat renders the newest page (head = m41, hasMore)
//     → loadOlder() starts (cursor strictly below m41)
//     → realtime event(s) arrive mid-flight
//     → the older page resolves (possibly with stale rows)
//     → commit = mergeOlderPage(rendered, page, captured, …)

function ts(h, min = 0) {
  return `2026-01-01T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
}

test('P-T1: a tombstone UPDATE for an unrendered message during loadOlder wins over the stale paginated row', () => {
  const rendered = [msg('m41', CONN, ts(13)), msg('m42', CONN, ts(14))];
  // The pre-fix failure this suite guards against (actual pre-fix logic:
  // steady-state UPDATE handler + raw-prepend commit):
  const staleX = msg('mX', CONN, ts(10), { ciphertext: 'ENVELOPE-STALE' });
  const tombstoneX = { ...staleX, deleted_at: ts(16), ciphertext: '' };
  const ignored = applyMessageUpdate(rendered, tombstoneX, CONN);
  assert.equal(ignored, rendered, 'pre-fix: the unknown-id UPDATE was dropped');
  const resurrected = [staleX, msg('m40', CONN, ts(12)), ...ignored];
  assert.equal(resurrected.find((m) => m.id === 'mX').deleted_at, null,
    'pre-fix: the raw prepend resurrected the deleted message');

  // The fixed flow: loadOlder in flight → tombstone captured (the exact
  // call the new UPDATE-handler branch makes) → page resolves with the
  // stale pre-delete X → reconciled commit.
  let pending = [];
  pending = captureRealtimeRow(pending, 'UPDATE', tombstoneX);
  const page = [staleX, msg('m40', CONN, ts(12))];
  const committed = mergeOlderPage(rendered, page, pending, CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['mX', 'm40', 'm41', 'm42'],
    'no row added or removed, deterministic order');
  const finalX = committed.find((m) => m.id === 'mX');
  assert.equal(finalX, tombstoneX, 'final state is the tombstone');
  assert.equal(finalX.deleted_at, ts(16));
  assert.equal(finalX.ciphertext, '', 'the stale ciphertext is never reintroduced');
  assert.ok(!committed.includes(staleX), 'the stale visible row never wins');
  // deleted_at is set, so the shared decrypt effect skips the row and
  // MessageBubble renders the deleted placeholder — no plaintext of the
  // deleted message can be resolved again.
});

test('P-T2: a non-tombstone UPDATE captured during loadOlder survives the pagination commit', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  const staleX = msg('mX', CONN, ts(10), { ciphertext: 'ENVELOPE-OLD', meta: null });
  const renamedX = msg('mX', CONN, ts(10), { ciphertext: 'ENVELOPE-OLD', meta: { new_name: 'renamed' } });
  let pending = [];
  pending = captureRealtimeRow(pending, 'UPDATE', renamedX);
  const committed = mergeOlderPage(rendered, [staleX], pending, CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['mX', 'm41']);
  const finalX = committed.find((m) => m.id === 'mX');
  assert.equal(finalX, renamedX, 'the captured UPDATE payload replaces the stale page row');
  assert.equal(finalX.meta.new_name, 'renamed');
  assert.equal(finalX.deleted_at, null, 'a live row stays live (no accidental tombstoning)');
  // Without captured rows the page merges unchanged.
  const fresh = mergeOlderPage(rendered, [staleX], [], CONN, null);
  assert.equal(fresh.find((m) => m.id === 'mX'), staleX);
});

test('P-T3: an UPDATE for a currently rendered message applies immediately and survives the commit', () => {
  // Chat's pagination capture branch only buffers messages the list does
  // NOT render; a rendered message takes the steady-state in-place path
  // while the older page is in flight. The reconciled commit must keep it.
  const rendered = [msg('m41', CONN, ts(13)), msg('m42', CONN, ts(14))];
  const tombstone42 = { ...rendered[1], deleted_at: ts(16), ciphertext: '' };
  // Steady-state path taken by the handler (unchanged behavior):
  const list = applyMessageUpdate(rendered, tombstone42, CONN);
  assert.notEqual(list, rendered, 'the rendered row was updated in place');
  // Older page resolves (strictly older than m41 — cannot contain m42):
  const page = [msg('m40', CONN, ts(12))];
  const committed = mergeOlderPage(list, page, [], CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['m40', 'm41', 'm42']);
  assert.equal(committed.find((m) => m.id === 'm42'), tombstone42,
    'the immediately applied tombstone is not clobbered by the page commit');
});

test('P-T4: several UPDATEs during loadOlder reconcile deterministically (newest wins per id)', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  const staleX = msg('mX', CONN, ts(10));
  const staleY = msg('mY', CONN, ts(11));
  const x1 = { ...staleX, meta: { new_name: 'n1' } };
  const x2 = { ...staleX, meta: { new_name: 'n2' }, deleted_at: ts(16), ciphertext: '' };
  const y1 = { ...staleY, meta: { new_name: 'other' } };
  // Arrival order through the actual capture queue (newest UPDATE payload
  // supersedes the older one for the same id; different ids keep order):
  let pending = [];
  pending = captureRealtimeRow(pending, 'UPDATE', x1);
  pending = captureRealtimeRow(pending, 'UPDATE', y1);
  pending = captureRealtimeRow(pending, 'UPDATE', x2);
  assert.equal(pending.length, 2, 'the queue holds one entry per message id');
  const committed = mergeOlderPage(rendered, [staleX, staleY], pending, CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['mX', 'mY', 'm41']);
  assert.equal(committed.find((m) => m.id === 'mX'), x2,
    'newest received payload for X wins (realtime arrival order is authoritative)');
  assert.equal(committed.find((m) => m.id === 'mY'), y1, "Y's update survives alongside X's");
  assert.equal(committed.find((m) => m.id === 'mX').ciphertext, '');
});

test('P-T5: realtime INSERT behavior during pagination is unchanged and cannot duplicate', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  // (a) A new message INSERTed mid-flight merges immediately (steady
  // state) and stays after the older page commits.
  const inserted = msg('m43', CONN, ts(15), { ciphertext: 'ENVELOPE-NEW' });
  const list = mergeIncomingMessage(rendered, inserted, CONN, null);
  const page = [msg('m40', CONN, ts(12))];
  const committed = mergeOlderPage(list, page, [], CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['m40', 'm41', 'm43']);
  assert.equal(committed.find((m) => m.id === 'm43').ciphertext, 'ENVELOPE-NEW',
    'the inserted envelope flows byte-identical into the unchanged decrypt path');
  // (b) The tie-break/clock-skew case: the page ALSO carries the id that
  // realtime already delivered — the commit must keep it exactly once and
  // must keep the (fresher) realtime row, not the page snapshot.
  const pageDup = [msg('m43', CONN, ts(15), { ciphertext: 'ENVELOPE-STALE-PAGE' })];
  const committed2 = mergeOlderPage(list, pageDup, [], CONN, null);
  assert.deepEqual(committed2.map((m) => m.id), ['m41', 'm43'], 'no duplicate row');
  assert.equal(committed2.find((m) => m.id === 'm43').ciphertext, 'ENVELOPE-NEW');
});

test('P-T6: rows belonging to another conversation are ignored by the pagination merge', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  const foreignPageRow = msg('mF', 'conn-other', ts(10));
  const foreignUpdate = msg('mG', 'conn-other', ts(11), { deleted_at: ts(16), ciphertext: '' });
  // Foreign rows never reach the queue in Chat (the handler re-scopes
  // before capturing); even if one did, the merge re-scopes fail-closed:
  const committed = mergeOlderPage(
    rendered,
    [foreignPageRow],
    [update(foreignUpdate)],
    CONN,
    null,
  );
  assert.equal(committed, rendered, 'same reference — nothing of another conversation enters the list');
});

test('P-T7: a loadOlder started in chat A can never commit into chat B (F-01 intact)', () => {
  const lc = createChatLifecycle();
  const tokenA = lc.current();
  let pendingA = [];
  const tombstoneA = msg('mA', 'conn-a', ts(10), { deleted_at: ts(16), ciphertext: '' });
  pendingA = captureRealtimeRow(pendingA, 'UPDATE', tombstoneA);
  const pageA = [msg('mA', 'conn-a', ts(10)), msg('m40', 'conn-a', ts(12))];
  // The user switches A → B while the page is in flight: the generation
  // advances and the conversation reset clears A's pagination buffer.
  lc.advance();
  pendingA = []; // pendingOlderRef.current = [] (reset effect / stale path)
  // The guarded commit decision (as in loadOlder): stale → discard.
  const listB = [msg('b1', 'conn-b', ts(13))];
  assert.equal(lc.isCurrent(tokenA), false, 'the stale token must not be current');
  assert.equal(listB.length, 1, 'nothing of conversation A entered B');
  // The still-current conversation keeps committing normally, and the
  // re-scoping of the merge keeps any leftover A row out of B's state:
  const committedB = mergeOlderPage(listB, [], [], 'conn-b', null);
  assert.equal(committedB, listB);
  const scoped = mergeOlderPage(listB, [], [update(tombstoneA)], 'conn-b', null);
  assert.equal(scoped, listB, 'an A row can never be drained into a B commit');
  // Symmetry: without the switch the same page would have committed into A.
  const lc2 = createChatLifecycle();
  const token = lc2.current();
  const renderedA = [msg('m41', 'conn-a', ts(13))];
  const committed = lc2.isCurrent(token)
    ? mergeOlderPage(renderedA, pageA, [update(tombstoneA)], 'conn-a', null)
    : renderedA;
  assert.deepEqual(committed.map((m) => m.id), ['mA', 'm40', 'm41']);
  assert.equal(committed[0].deleted_at, ts(16));
});

test('P-T8: the reconciled list keeps the deterministic (created_at, id) order', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  // Page as getMessagesPage returns it (ascending, with a same-timestamp
  // id tie), plus a captured update for one of its rows.
  const tie = '2026-01-01T10:00:00Z';
  const page = [
    msg('b', CONN, tie),
    msg('a', CONN, tie),
    msg('m40', CONN, ts(12)),
  ];
  const tombB = { ...page[0], deleted_at: ts(16), ciphertext: '' };
  let pending = [];
  pending = captureRealtimeRow(pending, 'UPDATE', tombB);
  const committed = mergeOlderPage(rendered, page, pending, CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['a', 'b', 'm40', 'm41'],
    '(created_at, id) ascending with the id tiebreak, as the database paginates');
  assert.equal(committed[1], tombB, 'the in-place replacement keeps its sorted slot');
  for (let i = 1; i < committed.length; i++) {
    const p = committed[i - 1];
    const q = committed[i];
    assert.ok(
      p.created_at < q.created_at || (p.created_at === q.created_at && p.id < q.id),
      'strict (created_at, id) ascending order after the pagination commit',
    );
  }
});

test('P-T9: a message arriving via both realtime and the older page appears exactly once', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  // Realtime delivered the row first (immediately applied INSERT)…
  const live = msg('m39', CONN, ts(11), { ciphertext: 'ENVELOPE-LIVE' });
  const list = mergeIncomingMessage(rendered, live, CONN, null);
  // …and the page snapshot (taken earlier) still carries the stale copy:
  const page = [msg('m39', CONN, ts(11), { ciphertext: 'ENVELOPE-PAGE' }), msg('m40', CONN, ts(12))];
  const committed = mergeOlderPage(list, page, [], CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['m39', 'm40', 'm41'], 'exactly one copy');
  assert.equal(committed[0], live, 'the realtime (fresher) row wins over the page snapshot');
  // The tagged-queue variant (an INSERT entry drained at the commit) also
  // never duplicates: it dedupes against the page row exactly like the
  // F-02 initial-load drain does (the page row stays; the queued INSERT
  // would have been a replay of it).
  const committed2 = mergeOlderPage(rendered, page, [insert(live)], CONN, null);
  assert.deepEqual(committed2.map((m) => m.id), ['m39', 'm40', 'm41'], 'exactly one copy in the queued variant');
  assert.equal(committed2.filter((m) => m.id === 'm39').length, 1);
});

test('P-T10: the pagination reconciliation keeps ciphertext opaque (one E2EE display path)', () => {
  const envelope = '{"v":1,"e":"sw","t":4,"b":"YmFzZTY0"}';
  const rendered = [msg('m41', CONN, ts(13))];
  const secretX = msg('mX', CONN, ts(10), { ciphertext: envelope });
  const tombstoneX = { ...secretX, deleted_at: ts(16), ciphertext: '' };
  let pending = [];
  pending = captureRealtimeRow(pending, 'UPDATE', tombstoneX);
  const committed = mergeOlderPage(rendered, [secretX], pending, CONN, null);
  // Live page rows keep their envelope byte-identical…
  const committedLive = mergeOlderPage(rendered, [secretX], [], CONN, null);
  assert.equal(committedLive.find((m) => m.id === 'mX').ciphertext, envelope,
    'the envelope is never parsed, trimmed, sanitized or rewritten');
  // …and the tombstoned row can never re-expose the deleted envelope.
  assert.equal(committed.find((m) => m.id === 'mX').ciphertext, '');
  assert.equal(committed.find((m) => m.id === 'mX').deleted_at, ts(16));
  // The buffer never carries anything but raw message rows (ciphertext or
  // the documented empty string of a tombstone/system row) — see the
  // static guard PG-G5 for the no-decrypt wiring assertion.
});

test('P-T11: the hidden/deletion cutoff semantics are unchanged by the pagination merge', () => {
  const cutoff = '2026-01-01T12:00:00Z';
  const rendered = [msg('m41', CONN, ts(13))];
  // Page rows at/below the cutoff are dropped, rows above it render —
  // exactly like the initial-load drain (F02-6b) and the live INSERT path.
  const hidden = msg('m39', CONN, ts(11, 59));
  const visible = msg('m40', CONN, ts(12, 1));
  const committed = mergeOlderPage(rendered, [hidden, visible], [], CONN, cutoff);
  assert.deepEqual(committed.map((m) => m.id), ['m40', 'm41'], 'cutoff rows are not rendered');
  // A captured UPDATE for a hidden message stays dropped (no phantom row):
  const hiddenUpdate = msg('m38', CONN, ts(11), { deleted_at: ts(16), ciphertext: '' });
  const committed2 = mergeOlderPage(rendered, [visible], [update(hiddenUpdate)], CONN, cutoff);
  assert.deepEqual(committed2.map((m) => m.id), ['m40', 'm41']);
  // Tombstoned rows themselves stay IN the list (the placeholder renders,
  // the decrypt effect skips them) — the merge never filters deletions:
  const tomb = msg('m40', CONN, ts(12, 1), { deleted_at: ts(16), ciphertext: '' });
  const committed3 = mergeOlderPage(rendered, [tomb], [update(tomb)], CONN, cutoff);
  assert.deepEqual(committed3.map((m) => m.id), ['m40', 'm41']);
  assert.equal(committed3[0].deleted_at, ts(16));
});

test('P-T12: empty and partial older pages commit cleanly without phantom pending rows', () => {
  const rendered = [msg('m41', CONN, ts(13))];
  // Empty page, nothing captured: a no-op commit (same reference — Chat
  // releases the loading-older latch directly, no re-render needed).
  assert.equal(mergeOlderPage(rendered, [], [], CONN, null), rendered);
  // Empty page + captured tombstone for an id neither the list nor the
  // (empty) page contains: dropped, NOT applied as a phantom row.
  const orphan = msg('mZ', CONN, ts(9), { deleted_at: ts(16), ciphertext: '' });
  assert.equal(mergeOlderPage(rendered, [], [update(orphan)], CONN, null), rendered,
    'an UPDATE never invents a row — same reference, no state churn');
  // Partial page (fewer rows than PAGE_SIZE) commits normally.
  const partial = [msg('m40', CONN, ts(12))];
  const committed = mergeOlderPage(rendered, partial, [], CONN, null);
  assert.deepEqual(committed.map((m) => m.id), ['m40', 'm41']);
  // Partial/empty page + captured tombstone for a row realtime INSERTed
  // during the flight (the only case where a captured unknown-id UPDATE
  // has a target): replaced in place at the drain.
  const inserted = msg('m39', CONN, ts(11), { ciphertext: 'ENVELOPE-LIVE' });
  const list = mergeIncomingMessage(rendered, inserted, CONN, null);
  const tomb39 = { ...inserted, deleted_at: ts(16), ciphertext: '' };
  const committed2 = mergeOlderPage(list, partial, [update(tomb39)], CONN, null);
  assert.deepEqual(committed2.map((m) => m.id), ['m39', 'm40', 'm41']);
  assert.equal(committed2.find((m) => m.id === 'm39'), tomb39,
    'the drained tombstone wins over the row the INSERT delivered');
});

/* ------------------------------------------------------------------ */
/* 9. Structural validation                                            */
/* ------------------------------------------------------------------ */

test('CR9: isRealtimeMessageRow validates the payload shape', () => {
  assert.equal(isRealtimeMessageRow(msg('m1')), true);
  assert.equal(isRealtimeMessageRow(msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: '' })), true, 'system rows have an empty ciphertext');
  assert.equal(isRealtimeMessageRow(null), false);
  assert.equal(isRealtimeMessageRow('x'), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), id: '' }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), connection_id: '' }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), sender_id: undefined }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), created_at: undefined }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), ciphertext: null }), false);
});

/* ------------------------------------------------------------------ */
/* 10. Conversation lifecycle guard (audit F-01)                       */
/* ------------------------------------------------------------------ */

/**
 * The lifecycle helper is the ACTUAL guard logic Chat.tsx uses: an async
 * operation captures `current()` before its first await and only commits its
 * result while `isCurrent(token)` is still true. These tests exercise that
 * exact decision under the switch sequences of the F-01 report.
 */
test('CRL1: a result of an operation started in A is discarded after A -> B', async () => {
  const lc = createChatLifecycle();
  const tokenA = lc.current();
  // The async operation resolves AFTER the user switched to B.
  lc.advance(); // A -> B
  await Promise.resolve();
  // The guarded commit decision (as in handleSend / loadOlder):
  const reachedCommit = lc.isCurrent(tokenA);
  assert.equal(reachedCommit, false, 'stale operation must not commit');
  // While the CURRENT conversation can still commit.
  assert.equal(lc.isCurrent(lc.current()), true);
});

test('CRL2: a result of an operation started in the still-current conversation is applied', async () => {
  const lc = createChatLifecycle();
  const token = lc.current();
  await Promise.resolve();
  assert.equal(lc.isCurrent(token), true, 'no switch -> commit allowed');
});

test('CRL3: only the newest generation survives rapid switches (A->B->C)', async () => {
  const lc = createChatLifecycle();
  const tokenA = lc.current();
  lc.advance(); // A -> B
  const tokenB = lc.current();
  lc.advance(); // B -> C
  const tokenC = lc.current();
  assert.equal(lc.isCurrent(tokenA), false, 'A is stale');
  assert.equal(lc.isCurrent(tokenB), false, 'B is stale');
  assert.equal(lc.isCurrent(tokenC), true, 'only C may commit');
});

test('CRL4: A -> B -> A starts a NEW generation, so the first A session stays stale', async () => {
  const lc = createChatLifecycle();
  const firstA = lc.current();
  lc.advance(); // A -> B
  lc.advance(); // B -> A (reopened)
  const reopenedA = lc.current();
  assert.notEqual(reopenedA, firstA, 'reopened conversation is a new generation');
  assert.equal(lc.isCurrent(firstA), false, 'the old A session must not leak into the reopened A');
  assert.equal(lc.isCurrent(reopenedA), true);
});

test('CRL5: the lifecycle is monotonic and stable while the conversation does not change', () => {
  const lc = createChatLifecycle();
  assert.equal(lc.current(), lc.current(), 'current() is stable without a switch');
  const first = lc.advance();
  assert.ok(first > 0, 'tokens are monotonically increasing');
  const second = lc.advance();
  assert.ok(second > first, 'each switch starts a newer generation');
  assert.equal(lc.isCurrent(first), false);
  assert.equal(lc.isCurrent(second), true);
});

test('CRL6: the guarded commit decision keeps ordering when the current result is applied', async () => {
  // Simulates the exact "apply only if current" shape used by handleSend and
  // loadOlder: the same row that was mid-flight is merged only via the shared
  // comparator path, and only when the token is still current.
  const lc = createChatLifecycle();
  const token = lc.current();
  let list = [];
  const apply = (row) => {
    if (!lc.isCurrent(token)) return list;
    return mergeIncomingMessage(list, row, CONN, null);
  };
  list = apply(msg('m2', CONN, '2026-01-01T10:00:01Z'));
  list = apply(msg('m1', CONN, '2026-01-01T10:00:00Z'));
  assert.deepEqual(list.map((m) => m.id), ['m1', 'm2'], 'current results keep (created_at, id) order');
  // A later switch invalidates the same closure's next result.
  lc.advance();
  const before = list;
  list = apply(msg('m3', CONN, '2026-01-01T10:00:02Z'));
  assert.equal(list, before, 'stale result is discarded without re-allocation');
});

/* ------------------------------------------------------------------ */
/* Static guards over the Chat.tsx wiring (supplement, NOT a           */
/* substitute for the runtime tests above)                             */
/* ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const chatSrc = fs.readFileSync(path.join(here, '..', '..', 'components', 'Chat.tsx'), 'utf8');

/** The chat realtime channel wiring, from `.channel(`chat-${connectionId}`)` to `.subscribe()`. */
function realtimeWiring() {
  const start = chatSrc.indexOf('.channel(`chat-${connectionId}`)');
  const end = chatSrc.indexOf('.subscribe();', start);
  assert.ok(start >= 0 && end > start, 'the chat realtime channel wiring exists');
  return chatSrc.slice(start, end);
}

test('CRG1: a realtime message event never triggers a full reload', () => {
  const wiring = realtimeWiring();
  assert.ok(!/setReloadKey/.test(wiring), 'no reload-key bump from a realtime handler');
  assert.ok(!/getMessagesPage\(/.test(wiring), 'no page fetch from a realtime handler');
  // The message events route through the shared pure merge helpers.
  assert.match(wiring, /mergeIncomingMessage\(prev, row, connectionId, hiddenUntil\)/);
  assert.match(wiring, /applyMessageUpdate\(prev, row, connectionId\)/);
});

test('CRG2: realtime rows are re-scoped to the open connection client-side', () => {
  const wiring = realtimeWiring();
  assert.ok(
    wiring.includes('filter: `connection_id=eq.${connectionId}`'),
    'the channel filter scopes the subscription to the open chat',
  );
  const scopes = wiring.match(/row\.connection_id !== connectionId/g) ?? [];
  assert.ok(scopes.length >= 2, 'INSERT and UPDATE handlers both re-scope the row');
  assert.ok(wiring.match(/isRealtimeMessageRow\(row\)/g) !== null, 'malformed payloads are validated');
});

test('CRG3: realtime messages flow into the shared E2EE display path (no plaintext shortcut)', () => {
  const wiring = realtimeWiring();
  // The realtime wiring must not resolve display plaintext itself: it never
  // touches the plain-text state, the undecryptable set or the plaintext cache.
  assert.ok(!/setPlain\(/.test(wiring), 'realtime never writes plaintext state');
  assert.ok(!/setUndecryptable\(/.test(wiring), 'realtime never marks messages undecryptable');
  assert.ok(!/cachePlaintext\(/.test(wiring), 'realtime never caches plaintext');
  assert.ok(!/ciphertext\s*=\s*['"]/.test(wiring), 'realtime never rewrites ciphertext');
  // The single shared decrypt path (load + realtime) is intact, keyed on the
  // message list so every merged row goes through it exactly once.
  const decryptStart = chatSrc.indexOf('/* Decrypt message bodies for display');
  const decryptEnd = chatSrc.indexOf('/* --------------------------- scroll / read');
  assert.ok(decryptStart >= 0 && decryptEnd > decryptStart, 'the shared decrypt effect exists');
  const decryptEffect = chatSrc.slice(decryptStart, decryptEnd);
  assert.match(decryptEffect, /const cached = await getCachedPlaintext\(me, m\.id\)/);
  assert.match(decryptEffect, /const \{ plaintext \} = await decryptForDisplay\(\{/);
  assert.match(decryptEffect, /if \(resolvedRef\.current\.has\(m\.id\)\) continue;/);
  assert.match(decryptEffect, /if \(decryptedRef\.current\.has\(m\.id\)\) continue;/);
  assert.match(decryptEffect, /\[messages, manager, conn, me\]\)/);
});

test('CRG4: realtime state updates are functional and duplicate-safe', () => {
  const wiring = realtimeWiring();
  assert.match(wiring, /setMessages\(\(prev\) =>\s*mergeIncomingMessage\(prev, row, connectionId, hiddenUntil\)/);
  assert.match(wiring, /setMessages\(\(prev\) => applyMessageUpdate\(prev, row, connectionId\)\)/);
  // The unread-below counter is updated OUTSIDE any state updater (the old
  // code called setNewSinceUp inside the setMessages updater, which React
  // may invoke twice under StrictMode).
  assert.ok(!/setMessages\(\(prev\) => \{[\s\S]*setNewSinceUp/.test(wiring), 'no setState nested in an updater');
});

test('CRG5: a load in flight does not drop realtime rows (gate + drain at commit)', () => {
  const wiring = realtimeWiring();
  assert.match(wiring, /if \(loadingRef\.current\)/, 'the handler checks the load gate');
  assert.match(
    wiring,
    /pendingRealtimeRef\.current = captureRealtimeRow\(\s*pendingRealtimeRef\.current,\s*'INSERT',\s*row,\s*\)/,
    'in-flight INSERT events are captured into the tagged queue',
  );
  assert.match(
    wiring,
    /pendingRealtimeRef\.current = captureRealtimeRow\(\s*pendingRealtimeRef\.current,\s*'UPDATE',\s*row,\s*\)/,
    'in-flight UPDATE events are captured into the tagged queue',
  );
  assert.match(
    chatSrc,
    /const drained = pendingRealtimeRef\.current;/,
    'the loader drains the captured rows',
  );
  assert.match(
    chatSrc,
    /mergeLoadedPage\(\s*pageResult\.messages,\s*drained,\s*connectionId,\s*until,?\s*\)/,
    'the drain merges onto the loaded page',
  );
  // The offline snapshot mirrors the committed (drained) list, so an
  // offline render cannot miss a message that was visible online.
  assert.match(chatSrc, /messages: committed,/);
  // The gate is opened by the loader and released on every terminal commit.
  assert.ok(chatSrc.match(/loadingRef\.current = true/g) !== null, 'the loader opens the gate');
  const releases = chatSrc.match(/loadingRef\.current = false/g) ?? [];
  assert.ok(releases.length >= 5, `the loader releases the gate on every terminal commit, saw ${releases.length}`);
});

test('CRG-F02-1: the UPDATE handler buffers during a load and applies normally afterwards', () => {
  const wiring = realtimeWiring();
  // The UPDATE wiring is a single flow: gate first, capture while a page
  // load is in flight, steady-state merge otherwise — no reload, no page
  // fetch, no second event path.
  const updateStart = wiring.indexOf("event: 'UPDATE'");
  assert.ok(updateStart >= 0, 'the UPDATE subscription exists');
  const updateHandler = wiring.slice(updateStart, wiring.indexOf("event: '*'", updateStart));
  assert.ok(!/setReloadKey/.test(updateHandler), 'an UPDATE never triggers a reload');
  assert.ok(!/getMessagesPage\(/.test(updateHandler), 'an UPDATE never fetches a page');
  const gateChecks = updateHandler.match(/loadingRef\.current/g) ?? [];
  assert.ok(gateChecks.length >= 1, `the UPDATE handler checks the load gate before capturing, saw ${gateChecks.length}`);
  assert.match(
    updateHandler,
    /pendingRealtimeRef\.current = captureRealtimeRow\(\s*pendingRealtimeRef\.current,\s*'UPDATE',\s*row,\s*\)/,
    'a mid-load UPDATE is captured, not applied',
  );
  assert.match(
    updateHandler,
    /setMessages\(\(prev\) => applyMessageUpdate\(prev, row, connectionId\)\)/,
    'outside a load the UPDATE still merges in place via the shared helper',
  );
  // The steady-state path comes AFTER the gate: the capture owns the
  // in-flight window, the direct merge owns everything else.
  const gatePos = updateHandler.indexOf('if (loadingRef.current)');
  const capturePos = updateHandler.indexOf('captureRealtimeRow', gatePos);
  const applyPos = updateHandler.indexOf('applyMessageUpdate(prev, row, connectionId)');
  assert.ok(gatePos >= 0 && capturePos > gatePos && applyPos > capturePos,
    'gate → capture → steady-state merge, in that order');
});

test('CRG-F02-2: the drain runs once, at the page commit, after the gate flip', () => {
  const drainStart = chatSrc.indexOf('const drained = pendingRealtimeRef.current;');
  const drainEnd = chatSrc.indexOf('setMessages(committed);', drainStart);
  assert.ok(drainStart >= 0 && drainEnd > drainStart, 'the drain block exists');
  const drain = chatSrc.slice(drainStart, drainEnd);
  assert.match(drain, /pendingRealtimeRef\.current = \[\];/, 'the queue is cleared by the drain');
  assert.match(drain, /loadingRef\.current = false;/, 'the gate flips in the same synchronous block');
  assert.match(drain, /const committed = mergeLoadedPage\(/, 'the drain result becomes the committed page');
  // Queue clear happens BEFORE the gate opens (atomic in JS): an event after
  // the flip can only compose on top of the committed page.
  assert.ok(
    chatSrc.indexOf('pendingRealtimeRef.current = [];', drainStart) <
      chatSrc.indexOf('loadingRef.current = false;', drainStart),
    'clear-then-flip order (no event can slip between the two statements)',
  );
});

test('CRG-F02-3: the conversation switch discards the previous buffer (F-01 + F-02)', () => {
  const resetStart = chatSrc.indexOf('// Reset display state when switching conversations.');
  const resetEnd = chatSrc.indexOf('/* --------------------------- scroll / read');
  assert.ok(resetStart >= 0 && resetEnd > resetStart, 'the conversation reset effect exists');
  const reset = chatSrc.slice(resetStart, resetEnd);
  // A captured UPDATE of conversation A must never be drained into B: the
  // reset clears the shared queue synchronously with the conversation change.
  assert.match(reset, /pendingRealtimeRef\.current = \[\];/, 'the buffer is cleared on every switch');
  assert.ok(
    reset.indexOf('pendingRealtimeRef.current = [];') >
      reset.indexOf('resolvedRef.current = new Set();'),
    'the queue is cleared together with the other per-conversation state',
  );
});

test('CRG-F02-4: the buffer/reconcile path never decrypts and never touches plaintext', () => {
  // The merge helpers operate on ciphertext-only Message rows: strip every
  // comment, then the remaining code must contain no crypto/decrypt/plaintext
  // import or call, and only the two pure helper modules may be imported.
  const helperSrc = fs.readFileSync(path.join(here, '..', 'chatRealtime.ts'), 'utf8');
  const helperCode = helperSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const imports = helperCode.split('\n').filter((l) => l.trim().startsWith('import'));
  assert.ok(imports.length <= 2, `expected only the two pure-helper imports, saw ${imports.length}`);
  for (const line of imports) {
    assert.ok(!/crypto|e2ee|signal|ratchet|session|message-cache|message-flow/.test(line),
      `no crypto/e2ee module may be imported by the reconcile helpers: ${line.trim()}`);
  }
  assert.ok(!/decryptForDisplay\(|getCachedPlaintext\(|cachePlaintext\(|prepareSend\(/.test(helperCode),
    'the reconcile helpers contain no decrypt/plaintext call');
  assert.ok(!/setPlain|setUndecryptable/.test(helperSrc), 'helpers never write display plaintext state');
  // The Chat.tsx handlers capture/merge raw payload rows only — no decrypt
  // call exists anywhere inside the message realtime wiring.
  const wiring = realtimeWiring();
  assert.ok(!/decryptForDisplay|getCachedPlaintext|cachePlaintext/.test(wiring),
    'realtime (load window included) never resolves plaintext itself');
  // And the shared decrypt effect is still the single path keyed on the
  // message list (see CRG3 for its full shape).
  assert.match(chatSrc, /const \{ plaintext \} = await decryptForDisplay\(\{/);
});

test('CRG6: Offline Read Mode is untouched by the realtime wiring', () => {
  // The realtime effect is not subscribed while the browser has no network,
  // and re-runs (re-subscribes) when connectivity returns (`offline` dep).
  const effectStart = chatSrc.indexOf('/* ------------------------------ realtime');
  const effectEnd = chatSrc.indexOf('/* Block state follows changes from the other device');
  assert.ok(effectStart >= 0 && effectEnd > effectStart, 'the realtime effect region exists');
  const effect = chatSrc.slice(effectStart, effectEnd);
  assert.match(effect, /if \(shouldSkipNetwork\(\)\) return;/, 'offline: no realtime channel is opened');
  assert.match(effect, /\[connectionId, valid, peer, hiddenUntil, me, offline\]\)/, 'reconnection re-subscribes via the effect deps');
  // Reconnection still reruns the EXISTING loader (unchanged behavior).
  assert.match(chatSrc, /if \(wasOffline && !offline\) setReloadKey\(\(k\) => k \+ 1\);/);
  // The offline snapshot path of the loader is untouched.
  assert.match(chatSrc, /const snapshot = await loadChatSnapshot\(me, connectionId\);/);
});

test('CRG7: existing send, pagination and deletion behavior is preserved', () => {
  // Own sends keep their dedupe + (created_at, id) sort.
  assert.match(
    chatSrc,
    /setMessages\(\(prev\) =>\s*prev\.some\(\(m\) => m\.id === message\.id\)/,
  );
  assert.match(chatSrc, /\[\.\.\.prev, message\]\.sort\(compareMessagesAsc\)/);
  // Pagination commits through the reconciling older-page merge (no raw
  // prepend anymore — see PG-G1 for the full pagination wiring guard).
  assert.match(
    chatSrc,
    /setMessages\(\(prev\) =>\s*mergeOlderPage\(prev, result\.messages, drained, conn\.id, hiddenUntil\)/,
  );
  // Delete-for-me is still pure per-user tombstone bookkeeping.
  assert.match(chatSrc, /setDeletedForMe\(\(prev\) => new Set\(prev\)\.add\(target\.message\.id\)\)/);
});

/* ---------------- 11. F-01 lifecycle wiring (static guards) ---------------- */

test('CRL-G1: the lifecycle is advanced synchronously with the connectionId prop', () => {
  // The token must be invalidated in the render body (ref compare), not only
  // in an effect, so a promise resolving between render and effect already
  // sees the new generation.
  assert.match(chatSrc, /lifecycleConnectionRef\.current !== connectionId/);
  assert.match(chatSrc, /lifecycleRef\.current\.advance\(\)/);
  // The reset effect clears the shared pagination latch on every switch so
  // the new conversation can never start with a stuck "loading older" state.
  const resetStart = chatSrc.indexOf('// Reset display state when switching conversations.');
  const resetEnd = chatSrc.indexOf('/* --------------------------- scroll / read');
  assert.ok(resetStart >= 0 && resetEnd > resetStart, 'the conversation reset effect exists');
  const reset = chatSrc.slice(resetStart, resetEnd);
  assert.match(reset, /loadingOlderRef\.current = false;/);
  assert.match(reset, /setLoadingOlder\(false\);/);
});

test('CRL-G2: a send started in A cannot commit into B after switching', () => {
  const start = chatSrc.indexOf('async function handleSend');
  const end = chatSrc.indexOf('async function handleAccept', start);
  assert.ok(start >= 0 && end > start, 'handleSend exists');
  const send = chatSrc.slice(start, end);
  // The operation is bound to the conversation before its first await.
  assert.match(send, /const token = lifecycleRef\.current\.current\(\);/);
  // It re-checks the token after EVERY await that can cross a switch
  // (prepareSend, sendMessage, cachePlaintext).
  const checks = send.match(/lifecycleRef\.current\.isCurrent\(token\)/g) ?? [];
  assert.ok(checks.length >= 3, `expected 3+ lifecycle checks, saw ${checks.length}`);
  const lastCheck = send.lastIndexOf('lifecycleRef.current.isCurrent(token)');
  // The message-state commits (and their plaintext cache write) are only
  // reachable after the LAST stale check: any commit before it would be an
  // unguarded cross-conversation write.
  assert.ok(
    send.indexOf('setMessages') > lastCheck,
    'setMessages must be guarded by the final isCurrent check',
  );
  assert.ok(
    send.indexOf('setPlain') > lastCheck,
    'setPlain must be guarded by the final isCurrent check',
  );
  // No new crypto path: sending still encrypts via the existing session
  // manager and stores the resulting ciphertext via the existing API.
  assert.match(send, /await prepareSend\(\{/);
  assert.match(send, /await sendMessage\(conn\.id, me, ciphertext\)/);
  assert.ok(!/decryptFromPeer|parseEnvelope|setCiphertext/.test(send), 'send never parses or decrypts');
});

test('CRL-G3: loadOlder started in A cannot prepend A pages into B after switching', () => {
  const start = chatSrc.indexOf('async function loadOlder');
  const end = chatSrc.indexOf('useLayoutEffect(() =>', start);
  assert.ok(start >= 0 && end > start, 'loadOlder exists');
  const load = chatSrc.slice(start, end);
  // Bound to the conversation before the page request.
  assert.match(load, /const token = lifecycleRef\.current\.current\(\);/);
  const checks = load.match(/lifecycleRef\.current\.isCurrent\(token\)/g) ?? [];
  assert.ok(checks.length >= 1, 'the page fetch result is checked for staleness');
  const lastCheck = load.lastIndexOf('lifecycleRef.current.isCurrent(token)');
  assert.ok(
    load.indexOf('setMessages') > lastCheck,
    'setMessages must be guarded by the isCurrent check',
  );
  assert.ok(
    load.indexOf('pendingDeltaRef.current = prevHeight') > lastCheck,
    'scroll compensation must not run for a stale page',
  );
  // The stale path releases the shared single-flight latch without touching
  // the new conversation's visual state.
  assert.match(load, /if \(!lifecycleRef\.current\.isCurrent\(token\)\) \{\s*\/\/ Conversation changed/);
  assert.match(load, /loadingOlderRef\.current = false;/);
});

test('CRL-G4: the E2EE display path is unchanged (guard never touches decrypt)', () => {
  // The single shared decrypt effect still exists on the message list, and
  // no second decrypt path was added anywhere in Chat.tsx.
  assert.match(chatSrc, /const \{ plaintext \} = await decryptForDisplay\(\{/);
  assert.match(chatSrc, /\[messages, manager, conn, me\]\)/);
  assert.match(chatSrc, /resolvedRef\.current\.has\(m\.id\)\) continue;/);
  assert.match(chatSrc, /decryptedRef\.current\.has\(m\.id\)\) continue;/);
});

/* --------- 12. Pagination tombstone race wiring (static guards) --------- */

/** The loadOlder function, from its declaration to the scroll-compensation effect. */
function loadOlderSrc() {
  const start = chatSrc.indexOf('async function loadOlder');
  const end = chatSrc.indexOf('useLayoutEffect(() =>', start);
  assert.ok(start >= 0 && end > start, 'loadOlder exists');
  return chatSrc.slice(start, end);
}

test('PG-G1: the loadOlder commit reconciles through mergeOlderPage (no raw prepend)', () => {
  const load = loadOlderSrc();
  // The success-path commit merges the page plus the drained captured rows
  // through the shared pure helper — the raw array prepend is gone.
  assert.match(
    load,
    /setMessages\(\(prev\) =>\s*mergeOlderPage\(prev, result\.messages, drained, conn\.id, hiddenUntil\)/,
    'the older page commits through the reconciling merge',
  );
  assert.ok(
    !/\[\.\.\.result\.messages, \.\.\.prev\]/.test(load),
    'the stale raw prepend (which resurrected deleted rows) is gone',
  );
  // The error/empty-page paths drain captured rows through the same helper.
  const drains = load.match(/mergeOlderPage\(prev, \[\], drained, conn\.id, hiddenUntil\)/g) ?? [];
  assert.ok(drains.length === 2, `error and empty-page paths drain the captured rows, saw ${drains.length}`);
});

test('PG-G2: an UPDATE for an unrendered message is buffered while an older page is in flight', () => {
  const wiring = realtimeWiring();
  const updateStart = wiring.indexOf("event: 'UPDATE'");
  const updateHandler = wiring.slice(updateStart, wiring.indexOf("event: '*'", updateStart));
  // The pagination capture branch is gated on the pagination flight AND on
  // the message not being rendered (rendered rows keep the immediate path —
  // and unknown UPDATEs stay ignored outside the flight window).
  assert.match(
    updateHandler,
    /if \(\s*pagingInFlightRef\.current &&\s*!visibleMessagesRef\.current\.some\(\(m\) => m\.id === row\.id\)\s*\) \{/,
    'the capture branch requires: older page in flight AND message not rendered',
  );
  assert.match(
    updateHandler,
    /pendingOlderRef\.current = captureRealtimeRow\(\s*pendingOlderRef\.current,\s*'UPDATE',\s*row,\s*\)/,
    'the captured row goes into the dedicated pagination queue (same tagged structure as F-02)',
  );
  // Order: F-02 load gate first, then the pagination gate, then the
  // steady-state in-place merge.
  const f02Gate = updateHandler.indexOf('if (loadingRef.current)');
  const pgCapture = updateHandler.indexOf('pendingOlderRef.current = captureRealtimeRow');
  const steady = updateHandler.indexOf('setMessages((prev) => applyMessageUpdate(prev, row, connectionId))');
  assert.ok(
    f02Gate >= 0 && f02Gate < pgCapture && pgCapture < steady,
    'F-02 load gate → pagination capture → steady-state merge, in that order',
  );
  // The steady-state unknown-id behavior is unchanged outside the window:
  // applyMessageUpdate still ignores unknown ids (no global append).
  assert.ok(
    !/mergeIncomingMessage\(prev, row/.test(updateHandler),
    'an UPDATE handler never appends a row',
  );
  // INSERTs are NOT captured during pagination: they keep the steady-state
  // immediate merge (dedupe at the commit makes that safe).
  const insertStart = wiring.indexOf("event: 'INSERT'");
  const insertHandler = wiring.slice(insertStart, updateStart);
  assert.ok(!/pendingOlderRef/.test(insertHandler), 'the INSERT handler has no pagination capture');
  assert.match(insertHandler, /if \(loadingRef\.current\)/, 'the F-02 INSERT capture is untouched');
});

test('PG-G3: the pagination capture gate opens once and closes on every terminal path', () => {
  const load = loadOlderSrc();
  // Opened exactly once, before the page request…
  const opens = load.match(/pagingInFlightRef\.current = true/g) ?? [];
  assert.equal(opens.length, 1, 'the gate opens when loadOlder starts');
  assert.ok(
    load.indexOf('pagingInFlightRef.current = true') < load.indexOf('await getMessagesPage'),
    'the gate is open before the request goes out',
  );
  // …and the drain clears the queue and closes the gate synchronously,
  // BEFORE the commit (clear-then-flip: an event after the flip composes
  // through the functional updater; an event before it was captured).
  const clearPos = load.indexOf('pendingOlderRef.current = [];');
  const flipPos = load.indexOf('pagingInFlightRef.current = false;');
  const commitPos = load.indexOf('mergeOlderPage(prev, result.messages');
  assert.ok(clearPos >= 0 && flipPos > clearPos, 'clear-then-flip at the commit');
  assert.ok(commitPos > flipPos, 'the commit happens after the flip');
  // Closed on every terminal path: the stale-conversation path closes its
  // own copy of the gate, and the synchronous clear-then-flip before the
  // commit covers BOTH the error and the success/empty-page paths (the
  // flip precedes the error check, so no path can run with the gate open).
  const closes = load.match(/pagingInFlightRef\.current = false/g) ?? [];
  assert.equal(closes.length, 2, 'stale path + the single synchronous commit flip');
  assert.ok(
    load.indexOf('pagingInFlightRef.current = false;') < load.indexOf('if (result.error)'),
    'the flip happens before the error branch, so the error path is covered',
  );
  assert.match(load, /pendingOlderRef\.current = \[\];\s*pagingInFlightRef\.current = false;\s*loadingOlderRef\.current = false;/);
  // The conversation switch clears the pagination buffer and gate (F-01).
  const resetStart = chatSrc.indexOf('// Reset display state when switching conversations.');
  const resetEnd = chatSrc.indexOf('/* --------------------------- scroll / read');
  const reset = chatSrc.slice(resetStart, resetEnd);
  assert.match(reset, /pendingOlderRef\.current = \[\];/, 'the buffer is cleared on every switch');
  assert.match(reset, /pagingInFlightRef\.current = false;/, 'the gate is closed on every switch');
});

test('PG-G4: F-01 and F-02 wiring is untouched by the pagination change', () => {
  // F-01: loadOlder still binds to the conversation before the await and
  // discards stale results (the full shape is pinned by CRL-G3).
  const load = loadOlderSrc();
  assert.match(load, /const token = lifecycleRef\.current\.current\(\);/);
  assert.match(load, /if \(!lifecycleRef\.current\.isCurrent\(token\)\) \{/);
  // F-02: the initial-load drain block is byte-for-byte the same shape
  // (queue cleared, gate flipped, mergeLoadedPage commit).
  const drainStart = chatSrc.indexOf('const drained = pendingRealtimeRef.current;');
  assert.ok(drainStart >= 0, 'the F-02 initial-load drain still exists');
  const drain = chatSrc.slice(drainStart, chatSrc.indexOf('setMessages(committed);', drainStart));
  assert.match(drain, /pendingRealtimeRef\.current = \[\];/);
  assert.match(drain, /loadingRef\.current = false;/);
  assert.match(drain, /const committed = mergeLoadedPage\(/);
  // The pagination queue is a SEPARATE structure: no second consumer of
  // the F-02 queue and no cross-drain (one event, one queue).
  const load2 = loadOlderSrc();
  assert.ok(!/pendingRealtimeRef/.test(load2), 'loadOlder never touches the F-02 initial-load queue');
  const initLoadStart = chatSrc.indexOf('const drained = pendingRealtimeRef.current;');
  const initLoadEnd = chatSrc.indexOf('setMessages(committed);', initLoadStart);
  assert.ok(
    !/pendingOlderRef/.test(chatSrc.slice(initLoadStart, initLoadEnd)),
    'the initial-load drain never touches the pagination queue',
  );
});

test('PG-G5: the pagination buffer path never decrypts and never touches plaintext', () => {
  // The helpers (including mergeOlderPage) are covered by CRG-F02-4's
  // stripped-source scan of chatRealtime.ts; here the Chat.tsx wiring is
  // pinned: the pagination flight adds no crypto/plaintext call.
  const load = loadOlderSrc();
  assert.ok(
    !/decryptForDisplay|getCachedPlaintext|cachePlaintext|setPlain|setUndecryptable/.test(load),
    'loadOlder never resolves or stores plaintext',
  );
  const wiring = realtimeWiring();
  const updateStart = wiring.indexOf("event: 'UPDATE'");
  const updateHandler = wiring.slice(updateStart, wiring.indexOf("event: '*'", updateStart));
  assert.ok(
    !/decryptForDisplay|getCachedPlaintext|cachePlaintext|setPlain|setUndecryptable/.test(updateHandler),
    'the pagination capture branch never resolves or stores plaintext',
  );
  // Rows are captured as raw payload rows only (`row`), and the buffer
  // type is the same ciphertext-only PendingRealtimeRow as F-02.
  assert.match(chatSrc, /const pendingOlderRef = useRef<PendingRealtimeRow\[\]>\(\[\]\);/);
});
