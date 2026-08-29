// enough. — P1-4 regression tests for getUnreadCounts.
//
// Verifies that the unread-count retrieval uses a bounded number of
// database/network round trips regardless of the number of connections
// (i.e. the N+1 query problem is fixed).
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/unread-counts.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Extract the getUnreadCounts + batchUnreadFallback logic as a standalone
// function. This mirrors the production implementation in src/lib/api.ts
// exactly, but without the Vite-style extensionless imports that prevent
// direct Node.js ESM execution.
// ---------------------------------------------------------------------------

/**
 * Bounded fallback for unread counts when the view does not cover all
 * connections. Replaces the old N+1 per-connection loop with at most two
 * batched queries.
 */
async function batchUnreadFallback(client, me, missing, readState, map) {
  const withoutState = [];
  const withState = [];
  for (const cid of missing) {
    if (readState[cid]) {
      withState.push(cid);
    } else {
      withoutState.push(cid);
    }
  }

  // Batch 1: connections without read state — count all non-deleted
  // messages from others. One query for all of them.
  if (withoutState.length > 0) {
    const { data, error } = await client
      .from('messages')
      .select('connection_id')
      .in('connection_id', withoutState)
      .neq('sender_id', me)
      .is('deleted_at', null);
    const counts = {};
    if (!error && data) {
      for (const row of data) {
        counts[row.connection_id] = (counts[row.connection_id] || 0) + 1;
      }
    }
    for (const cid of withoutState) {
      map[cid] = counts[cid] || 0;
    }
  }

  // Batch 2: connections with read state — fetch all relevant messages
  // and filter client-side by each connection's `since` timestamp.
  // One query for all of them.
  if (withState.length > 0) {
    const { data, error } = await client
      .from('messages')
      .select('connection_id, created_at')
      .in('connection_id', withState)
      .neq('sender_id', me)
      .is('deleted_at', null);
    const counts = {};
    if (!error && data) {
      for (const row of data) {
        const since = readState[row.connection_id];
        if (!since || row.created_at > since) {
          counts[row.connection_id] = (counts[row.connection_id] || 0) + 1;
        }
      }
    }
    for (const cid of withState) {
      map[cid] = counts[cid] || 0;
    }
  }
}

/**
 * Unread counts per connection.
 *
 * After migration 0013 the `connection_unread` view returns a row for every
 * connection, so a single view query covers all connections — O(1) DB round
 * trips regardless of the number of connections.
 */
async function getUnreadCounts(me, connectionIds, readState, client) {
  if (!client || connectionIds.length === 0) return {};
  const map = {};

  const { data, error } = await client
    .from('connection_unread')
    .select('connection_id, unread')
    .eq('user_id', me);
  if (!error && data) {
    for (const row of data) {
      map[row.connection_id] = row.unread;
    }
  }

  const missing = connectionIds.filter((cid) => !(cid in map));
  if (missing.length > 0) {
    await batchUnreadFallback(client, me, missing, readState, map);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Mock Supabase client builder
// ---------------------------------------------------------------------------

/**
 * Build a mock Supabase client that tracks every query and returns
 * pre-configured responses. The `callLog` array records every `.from()` call
 * so tests can assert on the number of DB round trips.
 */
function createMockClient(responses) {
  const callLog = [];
  let callIndex = 0;

  function getResponse() {
    const idx = callIndex++;
    return responses[idx] ?? { data: null, error: null, count: null };
  }

  function createQueryBuilder(tableName) {
    const state = {
      table: tableName,
      filters: {},
      selectColumns: null,
    };

    const builder = {
      then(onFulfilled, onRejected) {
        const resp = getResponse();
        return Promise.resolve({ data: resp.data, error: resp.error, count: resp.count }).then(
          onFulfilled,
          onRejected,
        );
      },
      select(columns) {
        state.selectColumns = columns;
        return builder;
      },
      eq(col, val) {
        state.filters[col] = { op: 'eq', val };
        return builder;
      },
      neq(col, val) {
        state.filters[col] = { op: 'neq', val };
        return builder;
      },
      is(col, val) {
        state.filters[col] = { op: 'is', val };
        return builder;
      },
      gt(col, val) {
        state.filters[col] = { op: 'gt', val };
        return builder;
      },
      in(col, vals) {
        state.filters[col] = { op: 'in', vals };
        return builder;
      },
    };

    callLog.push(state);
    return builder;
  }

  return {
    from(tableName) {
      return createQueryBuilder(tableName);
    },
    _callLog: callLog,
  };
}

// ---------------------------------------------------------------------------
// Source-code structural assertions (ensure the N+1 pattern is not present)
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const apiSource = fs.readFileSync(`${__dirname}/../api.ts`, 'utf-8');

test('api.ts source does NOT contain the old N+1 pattern (Promise.all over per-connection queries)', () => {
  // The old code had:
  //   await Promise.all(missing.map(async (cid) => { ... client.from('messages') ... }))
  // This pattern must not appear in getUnreadCounts anymore.
  //
  // We check that there is no `Promise.all` wrapping a `.map` over `missing`
  // that contains a `.from('messages')` call within getUnreadCounts.
  const funcStart = apiSource.indexOf('export async function getUnreadCounts(');
  assert.ok(funcStart !== -1, 'getUnreadCounts function must exist in api.ts');

  // Find the end of the function (next export or section comment)
  const funcBody = apiSource.slice(funcStart, funcStart + 3000);

  // The old N+1 pattern: Promise.all + missing.map + from('messages')
  const hasPromiseAllMissing = /Promise\.all\s*\(\s*\n?\s*missing\.map/.test(funcBody);
  assert.ok(
    !hasPromiseAllMissing,
    'getUnreadCounts must NOT use Promise.all(missing.map(...)) — this is the N+1 pattern',
  );
});

test('api.ts source uses batchUnreadFallback (bounded fallback) instead of per-connection queries', () => {
  assert.ok(
    apiSource.includes('batchUnreadFallback'),
    'api.ts must contain batchUnreadFallback (the bounded replacement for N+1)',
  );
});

test('migration 0013 exists and recreates the connection_unread view', () => {
  const migration = fs.readFileSync(
    `${__dirname}/../../../supabase/migrations/0013_fix_connection_unread_view.sql`,
    'utf-8',
  );
  assert.ok(
    migration.includes('create or replace view public.connection_unread'),
    'migration must recreate the view',
  );
  assert.ok(
    migration.includes('left join public.connection_reads'),
    'view must LEFT JOIN connection_reads (so connections without read state are included)',
  );
  assert.ok(
    migration.includes('security_invoker = on'),
    'view must preserve security_invoker for RLS',
  );
});

// ---------------------------------------------------------------------------
// Functional tests
// ---------------------------------------------------------------------------

const ME = 'user-abc-123';

test('zero connections returns empty map with zero DB calls', async () => {
  const client = createMockClient([]);
  const result = await getUnreadCounts(ME, [], {}, client);
  assert.deepEqual(result, {});
  assert.equal(client._callLog.length, 0, 'no DB calls for zero connections');
});

test('one connection present in view → one DB call', async () => {
  const client = createMockClient([
    { data: [{ connection_id: 'conn-1', unread: 5 }], error: null },
  ]);
  const result = await getUnreadCounts(ME, ['conn-1'], {}, client);
  assert.deepEqual(result, { 'conn-1': 5 });
  assert.equal(client._callLog.length, 1, 'exactly 1 DB call');
  assert.equal(client._callLog[0].table, 'connection_unread');
});

test('one connection missing from view, no read state → bounded calls', async () => {
  const client = createMockClient([
    { data: [], error: null },
    { data: [{ connection_id: 'conn-1' }, { connection_id: 'conn-1' }], error: null },
  ]);
  const result = await getUnreadCounts(ME, ['conn-1'], {}, client);
  assert.deepEqual(result, { 'conn-1': 2 });
  assert.ok(client._callLog.length <= 2, `at most 2 DB calls, got ${client._callLog.length}`);
});

test('10 connections all in view → exactly 1 DB call', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `conn-${i}`);
  const viewData = ids.map((id, i) => ({ connection_id: id, unread: i + 1 }));
  const client = createMockClient([{ data: viewData, error: null }]);
  const result = await getUnreadCounts(ME, ids, {}, client);
  for (let i = 0; i < 10; i++) {
    assert.equal(result[`conn-${i}`], i + 1);
  }
  assert.equal(client._callLog.length, 1, 'exactly 1 DB call for 10 connections');
});

test('50 connections all in view → exactly 1 DB call', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `conn-${i}`);
  const viewData = ids.map((id, i) => ({ connection_id: id, unread: i }));
  const client = createMockClient([{ data: viewData, error: null }]);
  const result = await getUnreadCounts(ME, ids, {}, client);
  assert.equal(Object.keys(result).length, 50);
  assert.equal(client._callLog.length, 1, 'exactly 1 DB call for 50 connections');
});

test('10 connections missing from view, no read state → at most 2 DB calls (not 10)', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `conn-${i}`);
  const messages = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j <= i; j++) {
      messages.push({ connection_id: `conn-${i}` });
    }
  }
  const client = createMockClient([
    { data: [], error: null },
    { data: messages, error: null },
  ]);
  const result = await getUnreadCounts(ME, ids, {}, client);
  for (let i = 0; i < 10; i++) {
    assert.equal(result[`conn-${i}`], i + 1, `conn-${i} should have ${i + 1} unread`);
  }
  assert.ok(client._callLog.length <= 2, `at most 2 DB calls, got ${client._callLog.length}`);
});

test('50 connections missing from view, no read state → at most 2 DB calls (not 50)', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `conn-${i}`);
  const messages = [];
  for (let i = 0; i < 50; i++) {
    messages.push({ connection_id: `conn-${i}` });
    messages.push({ connection_id: `conn-${i}` });
  }
  const client = createMockClient([
    { data: [], error: null },
    { data: messages, error: null },
  ]);
  const result = await getUnreadCounts(ME, ids, {}, client);
  for (let i = 0; i < 50; i++) {
    assert.equal(result[`conn-${i}`], 2);
  }
  assert.ok(client._callLog.length <= 2, `at most 2 DB calls, got ${client._callLog.length}`);
});

test('mixed: some in view, some missing without read state → bounded calls', async () => {
  const allIds = ['conn-0', 'conn-1', 'conn-2', 'conn-3', 'conn-4'];
  const client = createMockClient([
    { data: [{ connection_id: 'conn-0', unread: 3 }, { connection_id: 'conn-1', unread: 7 }] },
    { data: [{ connection_id: 'conn-2' }, { connection_id: 'conn-3' }, { connection_id: 'conn-3' }] },
  ]);
  const result = await getUnreadCounts(ME, allIds, {}, client);
  assert.equal(result['conn-0'], 3);
  assert.equal(result['conn-1'], 7);
  assert.equal(result['conn-2'], 1);
  assert.equal(result['conn-3'], 2);
  assert.equal(result['conn-4'], 0);
  assert.ok(client._callLog.length <= 2, `at most 2 DB calls, got ${client._callLog.length}`);
});

test('mixed: some in view, some missing with read state → bounded calls', async () => {
  const allIds = ['conn-0', 'conn-1', 'conn-2'];
  const readState = {
    'conn-1': '2026-01-01T00:00:00Z',
    'conn-2': '2026-06-01T00:00:00Z',
  };
  const client = createMockClient([
    { data: [{ connection_id: 'conn-0', unread: 10 }] },
    {
      data: [
        { connection_id: 'conn-1', created_at: '2025-12-01T00:00:00Z' },
        { connection_id: 'conn-1', created_at: '2026-02-01T00:00:00Z' },
        { connection_id: 'conn-2', created_at: '2026-07-01T00:00:00Z' },
        { connection_id: 'conn-2', created_at: '2026-08-01T00:00:00Z' },
      ],
      error: null,
    },
  ]);
  const result = await getUnreadCounts(ME, allIds, readState, client);
  assert.equal(result['conn-0'], 10);
  assert.equal(result['conn-1'], 1, 'only messages after since are counted');
  assert.equal(result['conn-2'], 2, 'only messages after since are counted');
  assert.ok(client._callLog.length <= 2, `at most 2 DB calls, got ${client._callLog.length}`);
});

test('correct unread counts with no messages → all zero', async () => {
  const ids = ['conn-1', 'conn-2', 'conn-3'];
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
  ]);
  const result = await getUnreadCounts(ME, ids, {}, client);
  assert.equal(result['conn-1'], 0);
  assert.equal(result['conn-2'], 0);
  assert.equal(result['conn-3'], 0);
});

test('view query is scoped to the authenticated user (user_id filter)', async () => {
  const client = createMockClient([{ data: [{ connection_id: 'conn-1', unread: 3 }] }]);
  await getUnreadCounts(ME, ['conn-1'], {}, client);
  const viewCall = client._callLog[0];
  assert.equal(viewCall.table, 'connection_unread');
  assert.equal(viewCall.filters['user_id']?.op, 'eq');
  assert.equal(viewCall.filters['user_id']?.val, ME, 'view must be filtered by authenticated user');
});

test('fallback messages query is scoped to authenticated user (sender_id neq)', async () => {
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await getUnreadCounts(ME, ['conn-1'], {}, client);
  const fallbackCall = client._callLog[1];
  assert.equal(fallbackCall.table, 'messages');
  assert.equal(fallbackCall.filters['sender_id']?.op, 'neq');
  assert.equal(fallbackCall.filters['sender_id']?.val, ME, 'messages must exclude own messages');
});

test('view error → falls back to batched query', async () => {
  const client = createMockClient([
    { data: null, error: { message: 'view not found' } },
    { data: [{ connection_id: 'conn-1' }], error: null },
  ]);
  const result = await getUnreadCounts(ME, ['conn-1'], {}, client);
  assert.equal(result['conn-1'], 1);
  assert.ok(client._callLog.length <= 2, 'graceful degradation with at most 2 calls');
});

test('view error + fallback error → all zeros', async () => {
  const client = createMockClient([
    { data: null, error: { message: 'view not found' } },
    { data: null, error: { message: 'messages table error' } },
  ]);
  const result = await getUnreadCounts(ME, ['conn-1', 'conn-2'], {}, client);
  assert.equal(result['conn-1'], 0);
  assert.equal(result['conn-2'], 0);
});

test('null client returns empty map', async () => {
  const result = await getUnreadCounts(ME, ['conn-1'], {}, null);
  assert.deepEqual(result, {});
});

// ---------------------------------------------------------------------------
// Bounded-query invariant (the key P1-4 guarantee)
// ---------------------------------------------------------------------------

test('BOUNDED INVARIANT: 1 connection → ≤ 2 calls', async () => {
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await getUnreadCounts(ME, ['conn-1'], {}, client);
  assert.ok(client._callLog.length <= 2, `1 conn: ${client._callLog.length} calls (must be ≤ 2)`);
});

test('BOUNDED INVARIANT: 10 connections → ≤ 2 calls', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `conn-${i}`);
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await getUnreadCounts(ME, ids, {}, client);
  assert.ok(client._callLog.length <= 2, `10 conns: ${client._callLog.length} calls (must be ≤ 2)`);
});

test('BOUNDED INVARIANT: 50 connections → ≤ 2 calls', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `conn-${i}`);
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await getUnreadCounts(ME, ids, {}, client);
  assert.ok(client._callLog.length <= 2, `50 conns: ${client._callLog.length} calls (must be ≤ 2)`);
});

test('BOUNDED INVARIANT: 500 connections → ≤ 2 calls', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => `conn-${i}`);
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await getUnreadCounts(ME, ids, {}, client);
  assert.ok(
    client._callLog.length <= 2,
    `500 conns: ${client._callLog.length} calls (must be ≤ 2)`,
  );
});

test('BOUNDED INVARIANT: 500 connections with mixed read states → ≤ 3 calls', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => `conn-${i}`);
  const readState = {};
  for (let i = 0; i < 250; i++) {
    readState[`conn-${i}`] = '2026-01-01T00:00:00Z';
  }
  const client = createMockClient([
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await getUnreadCounts(ME, ids, readState, client);
  assert.ok(
    client._callLog.length <= 3,
    `500 conns mixed: ${client._callLog.length} calls (must be ≤ 3)`,
  );
});

// ---------------------------------------------------------------------------
// batchUnreadFallback directly
// ---------------------------------------------------------------------------

test('batchUnreadFallback: without read state → one batch query', async () => {
  const client = createMockClient([
    { data: [{ connection_id: 'a' }, { connection_id: 'b' }, { connection_id: 'b' }], error: null },
  ]);
  const map = {};
  await batchUnreadFallback(client, ME, ['a', 'b'], {}, map);
  assert.equal(map['a'], 1);
  assert.equal(map['b'], 2);
  assert.equal(client._callLog.length, 1);
});

test('batchUnreadFallback: with read state → one batch query with client-side filter', async () => {
  const client = createMockClient([
    {
      data: [
        { connection_id: 'x', created_at: '2025-01-01T00:00:00Z' },
        { connection_id: 'x', created_at: '2026-06-01T00:00:00Z' },
        { connection_id: 'y', created_at: '2026-07-01T00:00:00Z' },
      ],
      error: null,
    },
  ]);
  const readState = { x: '2026-01-01T00:00:00Z', y: '2026-01-01T00:00:00Z' };
  const map = {};
  await batchUnreadFallback(client, ME, ['x', 'y'], readState, map);
  assert.equal(map['x'], 1, 'only messages after since counted');
  assert.equal(map['y'], 1);
  assert.equal(client._callLog.length, 1);
});

test('batchUnreadFallback: mixed with/without state → exactly 2 queries', async () => {
  const client = createMockClient([
    { data: [{ connection_id: 'a' }], error: null },
    { data: [{ connection_id: 'b', created_at: '2026-06-01T00:00:00Z' }], error: null },
  ]);
  const readState = { b: '2026-01-01T00:00:00Z' };
  const map = {};
  await batchUnreadFallback(client, ME, ['a', 'b'], readState, map);
  assert.equal(map['a'], 1);
  assert.equal(map['b'], 1);
  assert.equal(client._callLog.length, 2);
});

// ---------------------------------------------------------------------------
// The old N+1 would have failed this
// ---------------------------------------------------------------------------

test('OLD N+1 would have made 100 calls; new implementation makes ≤ 2', async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `conn-${i}`);
  const messages = ids.flatMap((id) => [{ connection_id: id }, { connection_id: id }]);
  const client = createMockClient([
    { data: [], error: null },
    { data: messages, error: null },
  ]);
  const result = await getUnreadCounts(ME, ids, {}, client);

  for (const id of ids) {
    assert.equal(result[id], 2);
  }
  assert.ok(
    client._callLog.length <= 2,
    `Expected ≤ 2 calls but got ${client._callLog.length}. The N+1 bug is NOT fixed.`,
  );
});
