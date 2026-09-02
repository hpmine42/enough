// enough. — P1-5 regression tests for the Home realtime reconciliation.
//
// Home.tsx applies realtime events to the already-rendered list through the
// pure bridge in src/lib/homeRealtime.ts instead of re-fetching everything.
// These tests exercise the ACTUAL routing/merge/reconcile logic the
// handlers delegate to (not a copy of it):
//   - message/profile merge logic;
//   - incremental connection-row application and removal;
//   - bridge routing decisions (which event touches which piece of state);
//   - the narrow per-conversation reconciliation (computeReconcileState)
//     and its stale-overwrite guards (event gate + bounded scheduler);
//   - static guard: Home's realtime wiring contains no unconditional
//     load() call.
//
// Run with:
//   npm run test:home
//   node --test --experimental-strip-types src/lib/__tests__/home-realtime.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isMessageNewer,
  mergeLastMessage,
  unreadAfterInsert,
  countsTowardUnread,
  upsertConnectionById,
  removeConnectionById,
  withoutKey,
  removeHiddenLastMessage,
  withTombstone,
  isConversationVisible,
  createHomeRealtimeBridge,
  createConversationEventGate,
  createReconcileScheduler,
  computeReconcileState,
} from '../homeRealtime.ts';

function msg(id, connectionId, createdAt) {
  return { id, connection_id: connectionId, sender_id: 'peer', ciphertext: 'x', created_at: createdAt };
}


test('isMessageNewer: later timestamp wins', () => {
  assert.equal(
    isMessageNewer(msg('a', 'c', '2026-01-01T10:00:00Z'), msg('b', 'c', '2026-01-01T09:00:00Z')),
    true,
  );
  assert.equal(
    isMessageNewer(msg('a', 'c', '2026-01-01T09:00:00Z'), msg('b', 'c', '2026-01-01T10:00:00Z')),
    false,
  );
});

test('isMessageNewer: equal timestamps are broken by id', () => {
  const t = '2026-01-01T10:00:00Z';
  assert.equal(isMessageNewer(msg('b', 'c', t), msg('a', 'c', t)), true);
  assert.equal(isMessageNewer(msg('a', 'c', t), msg('b', 'c', t)), false);
});

test('mergeLastMessage: empty map adds the message', () => {
  const m = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const next = mergeLastMessage({}, m);
  assert.equal(next['conn-1'], m);
});

test('mergeLastMessage: newer insert replaces the last message', () => {
  const older = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const newer = msg('m2', 'conn-1', '2026-01-01T11:00:00Z');
  const next = mergeLastMessage({ 'conn-1': older }, newer);
  assert.equal(next['conn-1'], newer);
});

test('mergeLastMessage: out-of-order older insert is ignored (same reference)', () => {
  const newer = msg('m2', 'conn-1', '2026-01-01T11:00:00Z');
  const older = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const prev = { 'conn-1': newer };
  const next = mergeLastMessage(prev, older);
  assert.equal(next, prev, 'unchanged event must not allocate a new map');
});

test('mergeLastMessage: update of the currently displayed message replaces it', () => {
  const original = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const deleted = { ...original, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const next = mergeLastMessage({ 'conn-1': original }, deleted);
  assert.equal(next['conn-1'], deleted);
});

test('mergeLastMessage: update of a non-last message is ignored', () => {
  const last = msg('m2', 'conn-1', '2026-01-01T11:00:00Z');
  const nonLastUpdate = { ...msg('m1', 'conn-1', '2026-01-01T10:00:00Z'), deleted_at: '2026-01-01T12:00:00Z' };
  const prev = { 'conn-1': last };
  const next = mergeLastMessage(prev, nonLastUpdate);
  assert.equal(next, prev, 'non-last message update must not change the map');
});

test('mergeLastMessage: independent connections do not interfere', () => {
  const m1 = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const m2 = msg('m2', 'conn-2', '2026-01-01T11:00:00Z');
  const prev = { 'conn-1': m1 };
  const next = mergeLastMessage(prev, m2);
  assert.equal(next['conn-1'], m1);
  assert.equal(next['conn-2'], m2);
});

test('unreadAfterInsert: peer message increments', () => {
  assert.deepEqual(unreadAfterInsert({}, 'conn-1', true), { 'conn-1': 1 });
  assert.deepEqual(unreadAfterInsert({ 'conn-1': 2 }, 'conn-1', true), { 'conn-1': 3 });
});

test('unreadAfterInsert: own message leaves the map untouched (same reference)', () => {
  const prev = { 'conn-1': 2 };
  assert.equal(unreadAfterInsert(prev, 'conn-1', false), prev);
});


/* ------------------------------------------------------------------ */
/* unread gating: the badge must match the connection_unread view      */
/* ------------------------------------------------------------------ */

test('countsTowardUnread: plain text counts, nothing else', () => {
  assert.equal(countsTowardUnread({ kind: 'text', deleted_at: null }), true);
  assert.equal(countsTowardUnread({ kind: null, deleted_at: null }), true);
  assert.equal(countsTowardUnread({ kind: undefined, deleted_at: undefined }), true);
});

test('countsTowardUnread: system kinds never count (no badge regression)', () => {
  // The connection_unread view (migration 0013) counts only
  // `kind IS NULL OR kind = 'text'` and non-deleted rows. Incrementing the
  // badge for other kinds made it jump up on arrival and fall back down on
  // the next load — "unread counts going backwards" (audit P1-5 §8).
  assert.equal(countsTowardUnread({ kind: 'connection_event', deleted_at: null }), false);
  assert.equal(countsTowardUnread({ kind: 'name_change', deleted_at: null }), false);
  assert.equal(countsTowardUnread({ kind: 'deleted_account', deleted_at: null }), false);
  assert.equal(countsTowardUnread({ kind: 'text', deleted_at: '2026-01-01T12:00:00Z' }), false);
});

/* ------------------------------------------------------------------ */
/* connection-list membership maps (dedupe, targeted replacement)      */
/* ------------------------------------------------------------------ */

function conn(id, overrides = {}) {
  return {
    id,
    user_a: 'me',
    user_b: `peer-${id}`,
    status: 'accepted',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('upsertConnectionById: inserts a new connection without touching others', () => {
  const a = conn('a');
  const next = upsertConnectionById([a], conn('b'));
  assert.equal(next.length, 2);
  assert.equal(next[1], a, 'unaffected rows keep their exact identity');
  assert.equal(next[0].id, 'b');
});

test('upsertConnectionById: UPDATE replaces only the affected entry in place', () => {
  const a = conn('a');
  const b = conn('b');
  const c = conn('c');
  const bUpdated = { ...b, status: 'ended' };
  const next = upsertConnectionById([a, b, c], bUpdated);
  assert.equal(next.length, 3, 'no duplicate entry after racing INSERT/UPDATE');
  assert.equal(next[0], a);
  assert.equal(next[1], bUpdated, 'only the affected row changed');
  assert.equal(next[2], c);
});

test('upsertConnectionById: duplicate rapid events never create duplicates', () => {
  let list = [];
  const row = conn('a');
  for (let i = 0; i < 3; i += 1) list = upsertConnectionById(list, i === 2 ? { ...row } : row);
  assert.equal(list.length, 1);
});

test('upsertConnectionById: identical row returns the same reference', () => {
  const a = conn('a');
  const prev = [a];
  assert.equal(upsertConnectionById(prev, a), prev, 'no-op events must not re-render');
});

test('removeConnectionById: removes only the affected entry', () => {
  const b = conn('b');
  const next = removeConnectionById([conn('a'), b], 'a');
  assert.deepEqual(next.map((c) => c.id), ['b']);
  assert.equal(next[0], b, 'untouched rows keep identity');
});

test('removeConnectionById: unknown id returns the same reference', () => {
  const prev = [conn('a')];
  assert.equal(removeConnectionById(prev, 'zzz'), prev);
});

test('withoutKey: removes one map key, same reference when absent', () => {
  const prev = { a: 1, b: 2 };
  assert.deepEqual(withoutKey(prev, 'a'), { b: 2 });
  assert.equal(withoutKey(prev, 'zzz'), prev);
});

test('removeHiddenLastMessage: drops only the entry hidden behind the cutoff', () => {
  const hidden = msg('m1', 'c1', '2026-01-01T10:00:00Z');
  const visible = msg('m2', 'c2', '2026-01-02T10:00:00Z');
  const next = removeHiddenLastMessage({ c1: hidden, c2: visible }, 'c1', '2026-01-01T12:00:00Z');
  assert.deepEqual(Object.keys(next), ['c2']);
  assert.equal(next.c2, visible);
});

test('removeHiddenLastMessage: a newer concurrent message survives the trim', () => {
  // Message arriving after the hide cutoff during a reconciliation: the
  // stale trim must not remove the fresh (visible) preview.
  const fresh = msg('m3', 'c1', '2026-01-03T10:00:00Z');
  const prev = { c1: fresh };
  assert.equal(removeHiddenLastMessage(prev, 'c1', '2026-01-01T12:00:00Z'), prev);
});

test('withTombstone: add and remove delete-for-me ids', () => {
  const start = new Set(['old']);
  const added = withTombstone(start, 'm1', true);
  assert.ok(added.has('m1') && added.has('old'));
  assert.notEqual(added, start, 'a real change allocates a new set');
  assert.ok(!start.has('m1'), 'previous state is never mutated');
  assert.equal(withTombstone(added, 'm1', true), added, 'duplicate add is a no-op (same reference)');
  const removed = withTombstone(added, 'm1', false);
  assert.ok(!removed.has('m1') && removed.has('old'));
  assert.equal(withTombstone(removed, 'm1', false), removed, 'removing an unknown id is a no-op');
});

test('withTombstone: tombstoning does not touch the message row', () => {
  // PR #85 semantics: delete-for-me is pure per-user bookkeeping; the
  // sender's row (and hence the peer's view) is never modified here.
  const original = msg('m1', 'c1', '2026-01-01T10:00:00Z');
  const tombstones = withTombstone(new Set(), original.id, true);
  assert.ok(tombstones.has(original.id));
  assert.deepEqual(original, msg('m1', 'c1', '2026-01-01T10:00:00Z'));
});

/* ------------------------------------------------------------------ */
/* shared visibility predicate (load() semantics == realtime semantics) */
/* ------------------------------------------------------------------ */

test('isConversationVisible: no cutoff means visible', () => {
  assert.equal(isConversationVisible(conn('a'), 'accepted', undefined, null, false), true);
  assert.equal(isConversationVisible(conn('a'), 'accepted', undefined, undefined, false), true);
});

test('isConversationVisible: hidden cutoff with old history hides the row', () => {
  const last = msg('m1', 'a', '2026-01-01T10:00:00Z');
  assert.equal(
    isConversationVisible({ created_at: '2025-12-01T00:00:00Z' }, 'accepted', last, '2026-01-02T00:00:00Z', false),
    false,
  );
});

test('isConversationVisible: a newer message or a newer connection reappears', () => {
  const newer = msg('m2', 'a', '2026-01-05T10:00:00Z');
  assert.equal(
    isConversationVisible({ created_at: '2025-12-01T00:00:00Z' }, 'accepted', newer, '2026-01-02T00:00:00Z', false),
    true,
  );
  // No messages yet, but the connection itself was created after the cutoff.
  assert.equal(
    isConversationVisible({ created_at: '2026-02-01T00:00:00Z' }, 'accepted', undefined, '2026-01-02T00:00:00Z', false),
    true,
  );
});

test('isConversationVisible: requests and revealed chats stay visible while hidden', () => {
  const old = msg('m1', 'a', '2026-01-01T10:00:00Z');
  for (const status of ['pending', 'declined', 'expired']) {
    assert.equal(
      isConversationVisible({ created_at: '2025-12-01T00:00:00Z' }, status, old, '2026-01-02T00:00:00Z', false),
      true,
      `${status} requests must remain actionable`,
    );
  }
  assert.equal(
    isConversationVisible({ created_at: '2025-12-01T00:00:00Z' }, 'accepted', old, '2026-01-02T00:00:00Z', true),
    true,
    'a revealed chat reappears (old history still hidden behind the cutoff)',
  );
});


/* ------------------------------------------------------------------ */
/* bridge routing: the event → state decisions Home.tsx delegates to   */
/* ------------------------------------------------------------------ */

function setupBridge(overrides = {}) {
  const calls = { events: [], rows: [], gone: [], messages: [], reconciles: [], tombstones: [], profiles: [] };
  const deps = {
    me: () => 'me',
    isLoading: () => false,
    hasConnection: (id) => id === 'conn-1',
    noteEvent: (id) => calls.events.push(id),
    onConnectionRow: (row) => calls.rows.push(row),
    onConnectionGone: (id) => calls.gone.push(id),
    onMessage: (m, countUnread) => calls.messages.push({ m, countUnread }),
    onTombstone: (id, added) => calls.tombstones.push({ id, added }),
    onProfile: (row) => calls.profiles.push(row),
    onReconcile: (id) => calls.reconciles.push(id),
    ...overrides,
  };
  return { calls, bridge: createHomeRealtimeBridge(deps) };
}

test('connection INSERT of my row: targeted row application, no reconcile, no reload path', () => {
  const { calls, bridge } = setupBridge();
  const row = conn('conn-1');
  bridge.connections({ eventType: 'INSERT', new: row });
  assert.deepEqual(calls.rows, [row]);
  assert.deepEqual(calls.reconciles, []);
  assert.deepEqual(calls.gone, []);
  assert.deepEqual(calls.events, ['conn-1'], 'the conversation is tracked for staleness detection');
});

test('connection INSERT of another user row is dropped (payload is not authorization)', () => {
  const { calls, bridge } = setupBridge();
  bridge.connections({ eventType: 'INSERT', new: { id: 'x', user_a: 'u1', user_b: 'u2', status: 'pending' } });
  assert.deepEqual(calls.rows, []);
  assert.deepEqual(calls.events, [], 'foreign rows are dropped before any state/bookkeeping');
});

test('connection UPDATE replaces the row via the same targeted path', () => {
  const { calls, bridge } = setupBridge();
  const row = conn('conn-1', { status: 'accepted' });
  bridge.connections({ eventType: 'UPDATE', new: row });
  assert.deepEqual(calls.rows, [row]);
});

test('connection UPDATE whose new row no longer involves me is dropped', () => {
  const { calls, bridge } = setupBridge();
  bridge.connections({ eventType: 'UPDATE', new: { id: 'conn-1', user_a: 'u1', user_b: 'u2' } });
  assert.deepEqual(calls.rows, []);
  assert.deepEqual(calls.gone, []);
});

test('connection DELETE removes only the affected known row', () => {
  const { calls, bridge } = setupBridge();
  // DELETE payloads carry the primary key in `old` under the default
  // replica identity — removal needs nothing more and can never expose data.
  bridge.connections({ eventType: 'DELETE', old: { id: 'conn-1' } });
  assert.deepEqual(calls.gone, ['conn-1']);
  assert.deepEqual(calls.rows, []);
});

test('connection DELETE of an unknown id is a no-op', () => {
  const { calls, bridge } = setupBridge();
  bridge.connections({ eventType: 'DELETE', old: { id: 'other' } });
  assert.deepEqual(calls.gone, []);
  assert.deepEqual(calls.events, []);
});

test('connection DELETE without old record is ignored', () => {
  const { calls, bridge } = setupBridge();
  bridge.connections({ eventType: 'DELETE', old: {} });
  assert.deepEqual(calls.gone, []);
});

test('message INSERT on a rendered conversation: preview merge + unread, no reconcile', () => {
  const { calls, bridge } = setupBridge();
  const m = msg('m1', 'conn-1', '2026-01-05T10:00:00Z');
  bridge.messageInsert({ eventType: 'INSERT', new: m });
  assert.deepEqual(calls.messages, [{ m, countUnread: true }], 'peer text message counts as unread');
  assert.deepEqual(calls.reconciles, []);
});

test('message INSERT: own message and system kinds never bump the badge', () => {
  const { calls, bridge } = setupBridge();
  bridge.messageInsert({ eventType: 'INSERT', new: { ...msg('m2', 'conn-1', '2026-01-05T10:00:00Z'), sender_id: 'me' } });
  bridge.messageInsert({
    eventType: 'INSERT',
    new: { ...msg('m3', 'conn-1', '2026-01-05T10:00:00Z'), kind: 'connection_event' },
  });
  assert.deepEqual(calls.messages.map((c) => c.countUnread), [false, false]);
  assert.equal(calls.messages.length, 2, 'preview still updates for both');
});

test('message INSERT for a NOT rendered conversation: narrow reconcile, no local merge', () => {
  const { calls, bridge } = setupBridge();
  const m = msg('m1', 'conn-9', '2026-01-05T10:00:00Z');
  bridge.messageInsert({ eventType: 'INSERT', new: m });
  assert.deepEqual(calls.reconciles, ['conn-9']);
  assert.deepEqual(calls.messages, [], 'a row not in the list is not half-updated');
});

test('message UPDATE: preview of the rendered conversation only, never unread', () => {
  const { calls, bridge } = setupBridge();
  const tombstone = { ...msg('m1', 'conn-1', '2026-01-05T10:00:00Z'), deleted_at: 'now', ciphertext: '' };
  bridge.messageUpdate({ eventType: 'UPDATE', new: tombstone });
  assert.deepEqual(calls.messages, [{ m: tombstone, countUnread: false }]);
  // Unknown conversation → ignored (pre-existing behavior; nothing rendered
  // can change from it).
  bridge.messageUpdate({ eventType: 'UPDATE', new: { ...tombstone, connection_id: 'conn-9' } });
  assert.equal(calls.messages.length, 1);
  assert.deepEqual(calls.reconciles, []);
});

test('rapid message events across conversations touch ONLY the affected ones', () => {
  const { calls, bridge } = setupBridge();
  bridge.messageInsert({ eventType: 'INSERT', new: msg('a', 'conn-1', '2026-01-05T10:00:00Z') });
  bridge.messageInsert({ eventType: 'INSERT', new: msg('b', 'conn-1', '2026-01-05T10:00:01Z') });
  bridge.messageInsert({ eventType: 'INSERT', new: msg('c', 'conn-9', '2026-01-05T10:00:02Z') });
  assert.equal(calls.messages.length, 2, 'both messages of conn-1 route to its preview only');
  assert.deepEqual(calls.reconciles, ['conn-9'], 'only the unknown conversation is reconciled');
  assert.deepEqual(calls.events, ['conn-1', 'conn-1', 'conn-9']);
});

test('events arriving during a full load() are queued, never applied or reloaded', () => {
  const { calls, bridge } = setupBridge({ isLoading: () => true });
  bridge.messageInsert({ eventType: 'INSERT', new: msg('a', 'conn-1', '2026-01-05T10:00:00Z') });
  bridge.messageInsert({ eventType: 'INSERT', new: msg('b', 'conn-9', '2026-01-05T10:00:01Z') });
  bridge.connections({ eventType: 'UPDATE', new: conn('conn-1') });
  assert.deepEqual(calls.events, ['conn-1', 'conn-9', 'conn-1'], 'queued via noteEvent (drained post-load)');
  assert.deepEqual(calls.messages, []);
  assert.deepEqual(calls.reconciles, []);
  assert.deepEqual(calls.rows, []);
});

test('profile UPDATE routes to the profile map only', () => {
  const { calls, bridge } = setupBridge();
  const row = { id: 'peer-conn-1', username: 'peer', display_name: 'Renamed' };
  bridge.profileUpdate({ eventType: 'UPDATE', new: row });
  assert.deepEqual(calls.profiles, [row]);
  assert.deepEqual(calls.reconciles, []);
  assert.deepEqual(calls.messages, []);
  bridge.profileUpdate({ eventType: 'UPDATE', new: { username: 'no-id' } });
  assert.equal(calls.profiles.length, 1, 'malformed payloads are ignored');
});

test('message_deletions INSERT (mine): tombstone only — no fetch, no reload', () => {
  const { calls, bridge } = setupBridge();
  bridge.messageDeletions({ eventType: 'INSERT', new: { user_id: 'me', message_id: 'm1' } });
  assert.deepEqual(calls.tombstones, [{ id: 'm1', added: true }]);
  assert.deepEqual(calls.reconciles, []);
  assert.deepEqual(calls.messages, []);
  // Another user's deletion row (should never arrive; belt and braces):
  bridge.messageDeletions({ eventType: 'INSERT', new: { user_id: 'other', message_id: 'm9' } });
  assert.equal(calls.tombstones.length, 1);
});

test('message_deletions DELETE (restore): tombstone removal from old record', () => {
  const { calls, bridge } = setupBridge();
  bridge.messageDeletions({ eventType: 'DELETE', old: { user_id: 'me', message_id: 'm1' } });
  assert.deepEqual(calls.tombstones, [{ id: 'm1', added: false }]);
});

test('chat_deletions INSERT/UPDATE/DELETE (mine): narrow reconcile for that conversation', () => {
  const { calls, bridge } = setupBridge();
  bridge.chatDeletions({ eventType: 'INSERT', new: { user_id: 'me', connection_id: 'conn-1', hidden_until: '2026-01-05T00:00:00Z' } });
  bridge.chatDeletions({ eventType: 'UPDATE', new: { user_id: 'me', connection_id: 'conn-1', revealed: true } });
  bridge.chatDeletions({ eventType: 'DELETE', old: { user_id: 'me', connection_id: 'conn-1' } });
  assert.deepEqual(calls.reconciles, ['conn-1', 'conn-1', 'conn-1']);
  assert.deepEqual(calls.gone, [], 'the reconcile derives hide/reveal/restore from the DB, no guessing');
  bridge.chatDeletions({ eventType: 'INSERT', new: { user_id: 'other', connection_id: 'conn-2' } });
  assert.equal(calls.reconciles.length, 3, "another user's deletion rows never trigger anything");
});


/* ------------------------------------------------------------------ */
/* convergence machinery: coalescing scheduler + staleness gate        */
/* ------------------------------------------------------------------ */

const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('scheduler: concurrent requests coalesce into one bounded follow-up pass', async () => {
  const latches = [deferred(), deferred(), deferred()];
  let runs = 0;
  const scheduler = createReconcileScheduler(async () => {
    runs += 1;
    await latches[runs - 1].promise;
    return false;
  }, 2);
  scheduler.request('c1');
  await flush();
  scheduler.request('c1'); // racing duplicate while pass 1 is active
  scheduler.request('c1');
  assert.equal(runs, 1, 'single-flight: no parallel reconciliation for one conversation');
  latches[0].resolve();
  await flush();
  assert.equal(runs, 2, 'coalesced requests collapse into exactly one follow-up pass');
  latches[1].resolve();
  await flush();
  scheduler.request('c1'); // idle again → a fresh single pass
  assert.equal(runs, 3);
  latches[2].resolve();
  await flush();
});

test('scheduler: retries on concurrent events but is bounded under a storm', async () => {
  let runs = 0;
  const scheduler = createReconcileScheduler(async () => {
    runs += 1;
    return true; // always detects a concurrent event and prefers a refetch
  }, 3);
  scheduler.request('c1');
  await flush();
  await flush();
  assert.equal(runs, 3, 'retries stop at maxPasses — no unbounded fetch loop');
});

test('scheduler: events during the FINAL pass still get a fresh bounded cycle', async () => {
  const latches = [deferred(), deferred(), deferred()];
  let runs = 0;
  const scheduler = createReconcileScheduler(async () => {
    runs += 1;
    await latches[runs - 1].promise;
    return runs === 1; // pass 1 prefers a refetch, making pass 2 the final one
  }, 2);
  scheduler.request('c1');
  await flush();
  latches[0].resolve();
  await flush();
  assert.equal(runs, 2, 'a stale snapshot triggers the follow-up pass');
  scheduler.request('c1'); // arrives while the final pass is in flight
  latches[1].resolve();
  await flush();
  assert.ok(runs >= 3, `events after the final pass start a fresh cycle (runs=${runs})`);
  latches[2].resolve();
  await flush();
  await flush();
  assert.equal(runs, 3, '…and the follow-up stays bounded (no infinite storm)');
});

test('event gate: bumping marks in-flight reconciliations as stale', async () => {
  const gate = createConversationEventGate();
  let applied = 'INITIAL';
  async function fakeReconcile(id) {
    const seqAtStart = gate.read(id);
    await Promise.resolve(); // pretend network fetch
    if (gate.read(id) !== seqAtStart) return false; // stale → skip apply
    applied = 'SNAPSHOT';
    return true;
  }
  const pending = fakeReconcile('c1');
  gate.bump('c1'); // realtime event lands while the fetch is in flight
  const appliedNow = await pending;
  assert.equal(applied, 'INITIAL', 'a stale snapshot must not overwrite newer state');
  assert.equal(appliedNow, false);
});

/* ------------------------------------------------------------------ */
/* narrow per-conversation reconciliation (computeReconcileState)      */
/* ------------------------------------------------------------------ */

function fakeFetchers(base = {}) {
  const queries = [];
  const state = {
    conn: conn('conn-1', { user_a: 'me', user_b: 'peer' }),
    last: msg('m9', 'conn-1', '2026-01-05T10:00:00Z'),
    lastFailed: false,
    hiddenUntil: null,
    revealed: false,
    unread: 4,
    profile: { id: 'peer', username: 'peer', display_name: 'Peer' },
    ...base,
  };
  const fetchers = {
    fetchConnection: async (id) => {
      queries.push(`connection:${id}`);
      return state.conn ?? null;
    },
    fetchLastMessage: async (id) => {
      queries.push(`last:${id}`);
      return { message: state.last, failed: state.lastFailed };
    },
    fetchChatDeletion: async (id) => {
      queries.push(`deletion:${id}`);
      return { hiddenUntil: state.hiddenUntil, revealed: state.revealed };
    },
    fetchUnread: async (id) => {
      queries.push(`unread:${id}`);
      return state.unread;
    },
    fetchPeerProfile: async (peerId) => {
      queries.push(`profile:${peerId}`);
      return state.profile;
    },
  };
  return { fetchers, queries };
}

test('reconcile: connection not visible to me → gone (removed, nothing else fetched)', async () => {
  const { fetchers, queries } = fakeFetchers({ conn: null });
  const result = await computeReconcileState(fetchers, 'me', 'conn-1');
  assert.equal(result.kind, 'gone');
  assert.deepEqual(queries, ['connection:conn-1'], 'no follow-up queries for a foreign/removed row');
});

test('reconcile: only the affected conversation is queried (P1-4 bound, no reload)', async () => {
  const { fetchers, queries } = fakeFetchers();
  const result = await computeReconcileState(fetchers, 'me', 'conn-1');
  assert.equal(result.kind, 'state');
  assert.equal(result.visible, true);
  assert.equal(result.conn.id, 'conn-1');
  assert.equal(result.unread, 4);
  assert.deepEqual(queries, [
    'connection:conn-1',
    'last:conn-1',
    'deletion:conn-1',
    'unread:conn-1',
    'profile:peer',
  ], 'constant bounded fetch count for ONE conversation — independent of list size');
  for (const q of queries) assert.ok(!/all|list/i.test(q), 'no whole-list queries');
});

test('reconcile: last-message fetch failure is transient (never applied)', async () => {
  const { fetchers } = fakeFetchers({ lastFailed: true });
  const result = await computeReconcileState(fetchers, 'me', 'conn-1');
  assert.equal(result.kind, 'transient');
});

test('reconcile: hidden window is re-derived, hidden previews are trimmed', async () => {
  // Conversation hidden on 2026-01-06; the newest message is OLDER → row
  // must leave the list, and its preview entry must not be re-set.
  const old = fakeFetchers({ hiddenUntil: '2026-01-06T00:00:00Z' });
  const hidden = await computeReconcileState(old.fetchers, 'me', 'conn-1');
  assert.equal(hidden.kind, 'state');
  assert.equal(hidden.visible, false);
  assert.equal(hidden.last, null);

  // A NEWER peer message (created after the cutoff) reappears with preview.
  const fresh = fakeFetchers({
    hiddenUntil: '2026-01-06T00:00:00Z',
    last: msg('m10', 'conn-1', '2026-01-07T10:00:00Z'),
  });
  const reappeared = await computeReconcileState(fresh.fetchers, 'me', 'conn-1');
  assert.equal(reappeared.visible, true);
  assert.equal(reappeared.last?.id, 'm10');
});

test('reconcile: revealed chat reappears but old history stays trimmed', async () => {
  const { fetchers } = fakeFetchers({
    hiddenUntil: '2026-01-06T00:00:00Z',
    revealed: true,
  });
  const result = await computeReconcileState(fetchers, 'me', 'conn-1');
  assert.equal(result.visible, true);
  assert.equal(result.last, null, 'the hidden message must not become the preview');
  assert.equal(result.hiddenUntil, '2026-01-06T00:00:00Z', 'cutoff carried so the caller trims the entry');
});

test('reconcile: unread keeps the current badge when the view cannot answer', async () => {
  const { fetchers } = fakeFetchers({ unread: null });
  const result = await computeReconcileState(fetchers, 'me', 'conn-1');
  assert.equal(result.unread, null);
});

test('reconcile: profile fetch errors keep the current profile', async () => {
  const { fetchers } = fakeFetchers({ profile: undefined });
  const result = await computeReconcileState(fetchers, 'me', 'conn-1');
  assert.equal(result.profile, undefined, 'undefined = keep, null = peer gone');
});

test('reconcile: My Notes self-connection skips the profile query', async () => {
  const { fetchers, queries } = fakeFetchers({
    conn: conn('self-1', { user_a: 'me', user_b: 'me' }),
  });
  const result = await computeReconcileState(fetchers, 'me', 'self-1');
  assert.equal(result.kind, 'state');
  assert.equal(result.peerId, 'me');
  assert.equal(result.profile, undefined);
  assert.deepEqual(queries, [
    'connection:self-1',
    'last:self-1',
    'deletion:self-1',
    'unread:self-1',
  ], 'no profile fetch for a self connection');
});

/* ------------------------------------------------------------------ */
/* static guard: Home wiring (supplement, NOT a substitute for the     */
/* runtime tests above)                                                */
/* ------------------------------------------------------------------ */

test('Home.tsx realtime wiring never calls load() from a handler', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(dir, '../../components/Home.tsx'), 'utf8');
  const start = src.indexOf("/* Realtime: connections, messages, profiles, deletions");
  assert.ok(start >= 0, 'realtime effect region exists');
  const channelStart = src.indexOf(".channel('home')", start);
  const effectEnd = src.indexOf('.subscribe();', channelStart);
  assert.ok(channelStart > start && effectEnd > channelStart, 'channel wiring found');
  const wiring = src.slice(channelStart, effectEnd);
  assert.ok(!/\bload\(/.test(wiring), 'no realtime handler may call load() (P1-5 invariant)');
  assert.ok(!/\breload\b/i.test(wiring), 'no reload indirection either');
  assert.match(wiring, /bridge\.connections\(/);
  assert.match(wiring, /bridge\.messageInsert\(/);
  assert.match(wiring, /bridge\.messageUpdate\(/);
  assert.match(wiring, /bridge\.profileUpdate\(/);
  assert.match(wiring, /bridge\.messageDeletions\(/);
  assert.match(wiring, /bridge\.chatDeletions\(/);
  const cleanup = src.slice(effectEnd, src.indexOf('}, [me', effectEnd));
  assert.match(cleanup, /client\.removeChannel\(channel\);/, 'subscription cleanup preserved');
});
