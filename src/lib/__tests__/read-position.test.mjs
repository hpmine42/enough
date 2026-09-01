// enough. — v0.3 R2: regression tests for the monotone read position.
//
// The bug this suite pins down: the chat read position used to be assigned
// from the newest *visible* message. Scrolling upward made that an OLDER
// message, so `connection_reads.last_read_at` moved backwards and messages the
// user had already seen reappeared as unread on Home ("phantom unread").
//
// Covered here:
//   1. `advanceReadPosition` — the pure monotone update helper.
//   2. A faithful replay of the old vs. new `computeUnreadBelow` assignment,
//      proving the backward move and its absence after the fix.
//   3. `saveReadState` — defensive monotone guard against regressed writes.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/read-position.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

// Minimal localStorage-backed `window` so api.ts's readStorage cache is real
// (it is the comparison value the monotone guard relies on).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  },
};

const { advanceReadPosition } = await import('../helpers.ts');
const api = await import('../api.ts');
const { __setSupabase } = await import('./supabase-mock.mjs');
const { createSupabaseMock } = await import('./supabase-test-client.mjs');

const ME = 'user-r2';
const T1 = '2026-03-01T10:00:00.000Z';
const T2 = '2026-03-01T10:05:00.000Z';
const T3 = '2026-03-01T10:09:00.000Z';

function upserts(client) {
  return client._log.filter(
    (op) => op.table === 'connection_reads' && op.method === 'upsert',
  );
}

// ---------------------------------------------------------------------------
// 1. Pure helper
// ---------------------------------------------------------------------------

test('advanceReadPosition accepts a newer candidate', () => {
  assert.equal(advanceReadPosition(T1, T2), T2);
});

test('advanceReadPosition refuses a regression (scroll-up case)', () => {
  assert.equal(advanceReadPosition(T3, T1), T3);
});

test('advanceReadPosition is idempotent for an equal timestamp', () => {
  assert.equal(advanceReadPosition(T2, T2), T2);
});

test('advanceReadPosition handles missing values', () => {
  assert.equal(advanceReadPosition(null, T1), T1);
  assert.equal(advanceReadPosition(T1, null), T1);
  assert.equal(advanceReadPosition(null, null), null);
  assert.equal(advanceReadPosition(undefined, undefined), null);
});

test('advanceReadPosition compares chronologically, not lexicographically', () => {
  // Same instant, different but valid ISO representations / offsets.
  const utc = '2026-03-01T10:00:00.000Z';
  const offset = '2026-03-01T11:30:00.000+01:30';
  assert.equal(advanceReadPosition(utc, offset), utc);
  const laterInOtherZone = '2026-03-01T12:00:00.000+01:00'; // 11:00Z
  assert.equal(advanceReadPosition(utc, laterInOtherZone), laterInOtherZone);
});

test('advanceReadPosition never regresses on unparsable input', () => {
  // An unparsable candidate is ignored; an unparsable stored value is
  // replaced by a valid one rather than blocking all future progress.
  assert.equal(advanceReadPosition(T3, 'not-a-date'), T3);
  assert.equal(advanceReadPosition('not-a-date', T3), T3);
});

// ---------------------------------------------------------------------------
// 2. Scroll-up replay: old (buggy) vs. new (monotone) assignment
// ---------------------------------------------------------------------------

// Mirrors the read-position assignment of Chat.tsx's `computeUnreadBelow`:
// `lastVisible` is the index of the newest message still inside the viewport.
function replayScroll(messages, lastVisibleIndices, { monotone }) {
  let lastRead = null;
  for (const lastVisible of lastVisibleIndices) {
    if (lastVisible < 0) continue;
    const msg = messages[lastVisible];
    if (!msg) continue;
    lastRead = monotone
      ? advanceReadPosition(lastRead, msg.created_at)
      : msg.created_at; // pre-fix behavior
  }
  return lastRead;
}

const HISTORY = [
  { id: 'm1', created_at: T1 },
  { id: 'm2', created_at: T2 },
  { id: 'm3', created_at: T3 },
];

test('OLD behavior: scrolling up moved the read position backwards', () => {
  // Open at the bottom (m3 visible), then scroll up until only m1 is visible.
  const result = replayScroll(HISTORY, [2, 1, 0], { monotone: false });
  assert.equal(result, T1, 'sanity: the old assignment regressed to m1');
  assert.ok(
    new Date(result) < new Date(T3),
    'the pre-fix read position ends up older than the newest read message',
  );
});

test('scrolling up never moves the read position backwards', () => {
  const result = replayScroll(HISTORY, [2, 1, 0], { monotone: true });
  assert.equal(result, T3);
});

test('scrolling up cannot create phantom unread messages', () => {
  const lastRead = replayScroll(HISTORY, [2, 1, 0, 1, 0], { monotone: true });
  // `connection_unread` counts peer messages with created_at > last_read_at.
  const unread = HISTORY.filter((m) => m.created_at > lastRead).length;
  assert.equal(unread, 0);
});

test('a message arriving after the last read position still counts as unread', () => {
  const lastRead = replayScroll(HISTORY, [2, 1, 0], { monotone: true });
  const arrivedAfterLeaving = { id: 'm4', created_at: '2026-03-01T10:20:00.000Z' };
  const unread = [...HISTORY, arrivedAfterLeaving].filter(
    (m) => m.created_at > lastRead,
  ).length;
  assert.equal(unread, 1);
});

test('leaving the chat persists the newest known message, not the last visible one', () => {
  // Scrolled up (m1 visible) while m4 arrives via realtime; on unmount the
  // flush advances to the newest message known to the session.
  const withRealtime = [...HISTORY, { id: 'm4', created_at: '2026-03-01T10:20:00.000Z' }];
  let lastRead = replayScroll(HISTORY, [2, 1, 0], { monotone: true });
  const newestKnown = withRealtime[withRealtime.length - 1].created_at;
  lastRead = advanceReadPosition(lastRead, newestKnown);
  assert.equal(lastRead, '2026-03-01T10:20:00.000Z');
  assert.equal(withRealtime.filter((m) => m.created_at > lastRead).length, 0);
});

// ---------------------------------------------------------------------------
// 3. saveReadState monotone guard
// ---------------------------------------------------------------------------

test('saveReadState persists an advancing read position', async () => {
  store.clear();
  const client = createSupabaseMock([{ data: null, error: null }, { data: null, error: null }]);
  __setSupabase(client);

  await api.saveReadState(ME, 'c1', T1);
  await api.saveReadState(ME, 'c1', T3);

  assert.equal(upserts(client).length, 2);
  assert.equal(upserts(client)[1].args[0].last_read_at, T3);
  assert.equal(JSON.parse(store.get(`enough-read-${ME}`)).c1, T3);
});

test('saveReadState refuses a read position older than the cached one', async () => {
  store.clear();
  const client = createSupabaseMock([{ data: null, error: null }, { data: null, error: null }]);
  __setSupabase(client);

  await api.saveReadState(ME, 'c1', T3);
  await api.saveReadState(ME, 'c1', T1); // regression attempt (scroll-up)

  assert.equal(upserts(client).length, 1, 'no upsert is issued for a regression');
  assert.equal(upserts(client)[0].args[0].last_read_at, T3);
  assert.equal(
    JSON.parse(store.get(`enough-read-${ME}`)).c1,
    T3,
    'the local cache keeps the newer position',
  );
});

test('saveReadState keeps an equal timestamp idempotent (no regression)', async () => {
  store.clear();
  const client = createSupabaseMock([{ data: null, error: null }, { data: null, error: null }]);
  __setSupabase(client);

  await api.saveReadState(ME, 'c1', T2);
  await api.saveReadState(ME, 'c1', T2);

  // Re-writing the same position is allowed (it is self-healing if a previous
  // fire-and-forget upsert failed) but must never change the stored value.
  for (const op of upserts(client)) {
    assert.equal(op.args[0].last_read_at, T2);
  }
  assert.equal(JSON.parse(store.get(`enough-read-${ME}`)).c1, T2);
});

test('saveReadState guards each connection independently', async () => {
  store.clear();
  const client = createSupabaseMock([
    { data: null, error: null },
    { data: null, error: null },
    { data: null, error: null },
  ]);
  __setSupabase(client);

  await api.saveReadState(ME, 'c1', T3);
  await api.saveReadState(ME, 'c2', T1); // different connection: must be written
  await api.saveReadState(ME, 'c1', T1); // same connection: must be refused

  assert.equal(upserts(client).length, 2);
  const cached = JSON.parse(store.get(`enough-read-${ME}`));
  assert.deepEqual(cached, { c1: T3, c2: T1 });
});

// ---------------------------------------------------------------------------
// 4. Source-level guard against reintroducing the direct assignment
// ---------------------------------------------------------------------------

test('Chat.tsx never assigns the read ref without the monotone helper', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../../components/Chat.tsx', import.meta.url),
    'utf8',
  );
  const assignments = src.match(/lastReadRef\.current\s*=\s*[^;]+/g) ?? [];
  assert.ok(assignments.length > 0, 'expected read-ref assignments in Chat.tsx');
  for (const a of assignments) {
    assert.ok(
      a.includes('advanceReadPosition') || a.includes('= null'),
      `read position assigned without the monotone guard: ${a}`,
    );
  }
});
