// enough. — Behavioral regression tests for src/lib/api.ts (roadmap E2).
//
// Unlike the earlier "surface" and "unread" suites that split or re-implement
// production logic, this suite loads the ACTUAL api.ts module (via the test
// loader, which resolves Vite's extensionless imports and redirects
// `supabase.ts` to a controllable stub) and drives it with a chain-recording
// fake client. That lets us assert real behavior: authorization scoping, error
// surfacing, connection/message/deletion operations, and that ciphertext is
// transported untransformed.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/api.test.mjs
//
// (or via `npm run test:api`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The loader must be registered before any extensionless module is imported.
register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

const api = await import('../api.ts');
const { __setSupabase } = await import('./supabase-mock.mjs');
const { createSupabaseMock } = await import('./supabase-test-client.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ops(client, table, method) {
  return client._log.filter((op) => op.table === table && op.method === method);
}

function rpcOps(client, name) {
  return client._log.filter((op) => op.rpc === name);
}

const ME = 'user-abc-123';

// ---------------------------------------------------------------------------
// Authorization-sensitive client scoping
// ---------------------------------------------------------------------------

test('getMyConnections scopes the query to both sides of the connection', async () => {
  const rows = [
    { id: 'c1', status: 'accepted' },
    { id: 'c2', status: 'pending' },
  ];
  const client = createSupabaseMock([{ data: rows, error: null }]);
  __setSupabase(client);

  const res = await api.getMyConnections(ME);

  assert.deepEqual(res.data, rows);
  assert.equal(res.error, null);

  const select = ops(client, 'connections', 'select');
  const or = ops(client, 'connections', 'or');
  const order = ops(client, 'connections', 'order');
  assert.equal(select.length, 1);
  assert.equal(select[0].args[0], '*');
  assert.equal(or.length, 1);
  assert.match(or[0].args[0], new RegExp(`user_a\\.eq\\.${ME}`));
  assert.match(or[0].args[0], new RegExp(`user_b\\.eq\\.${ME}`));
  assert.equal(order[0].args[1].ascending, false);
});

test('getMyConnections surfaces a database error instead of an empty list', async () => {
  const client = createSupabaseMock([{ data: null, error: { message: 'fetch failed' } }]);
  __setSupabase(client);

  const res = await api.getMyConnections(ME);

  assert.deepEqual(res.data, []);
  assert.equal(res.error, 'No connection to the server.');
});

test('searchUsers excludes the caller and uses a prefix match', async () => {
  const client = createSupabaseMock([{ data: [{ id: 'u2', username: 'alice' }], error: null }]);
  __setSupabase(client);

  const res = await api.searchUsers('ali', ME);

  assert.equal(res.error, null);
  assert.equal(res.data.length, 1);

  const ilike = ops(client, 'profiles', 'ilike');
  const neq = ops(client, 'profiles', 'neq');
  const limit = ops(client, 'profiles', 'limit');
  assert.deepEqual(ilike[0].args, ['username', 'ali%']);
  assert.deepEqual(neq[0].args, ['id', ME], 'must exclude the calling user');
  assert.deepEqual(limit[0].args, [10]);
});

test('getProfiles fetches only the requested ids and builds a map', async () => {
  const client = createSupabaseMock([
    { data: [{ id: 'u1', username: 'a' }, { id: 'u2', username: 'b' }], error: null },
  ]);
  __setSupabase(client);

  const res = await api.getProfiles(['u1', 'u2']);

  assert.equal(res.error, null);
  assert.deepEqual(Object.keys(res.data).sort(), ['u1', 'u2']);
  const inOp = ops(client, 'profiles', 'in');
  assert.deepEqual(inOp[0].args, ['id', ['u1', 'u2']]);
});

test('getLastMessages deduplicates and keeps the newest message per connection', async () => {
  const client = createSupabaseMock([
    {
      data: [
        { connection_id: 'c1', created_at: '2026-03-02T00:00:00Z', id: 'm2' },
        { connection_id: 'c1', created_at: '2026-03-01T00:00:00Z', id: 'm1' },
        { connection_id: 'c2', created_at: '2026-03-03T00:00:00Z', id: 'm3' },
      ],
      error: null,
    },
  ]);
  __setSupabase(client);

  const res = await api.getLastMessages(['c1', 'c2']);

  assert.equal(res.error, null);
  assert.equal(res.data['c1'].id, 'm2', 'newest c1 message');
  assert.equal(res.data['c2'].id, 'm3');

  const inOp = ops(client, 'messages', 'in');
  assert.deepEqual(inOp[0].args, ['connection_id', ['c1', 'c2']]);
});

test('getBlockRelations scopes the block lookup to the caller', async () => {
  const client = createSupabaseMock([
    { data: [{ blocker_id: ME, blocked_id: 'x' }, { blocker_id: 'y', blocked_id: ME }], error: null },
  ]);
  __setSupabase(client);

  const res = await api.getBlockRelations(ME);

  assert.ok(res.blockedIds.has('x'));
  assert.ok(res.blockedByIds.has('y'));

  const or = ops(client, 'user_blocks', 'or');
  assert.match(or[0].args[0], new RegExp(`blocker_id\\.eq\\.${ME}`));
  assert.match(or[0].args[0], new RegExp(`blocked_id\\.eq\\.${ME}`));
});

test('getBlockedUsers lists only the caller-blocked relations', async () => {
  const client = createSupabaseMock([
    { data: [{ blocked_id: 'x', created_at: '2026-01-01T00:00:00Z' }], error: null },
  ]);
  __setSupabase(client);

  const res = await api.getBlockedUsers(ME);

  assert.equal(res.error, null);
  assert.deepEqual(res.data, [{ blockedId: 'x', createdAt: '2026-01-01T00:00:00Z' }]);
  const eq = ops(client, 'user_blocks', 'eq');
  assert.deepEqual(eq[0].args, ['blocker_id', ME]);
});

test('getReadState scopes the read-state query to the caller', async () => {
  const client = createSupabaseMock([
    { data: [{ connection_id: 'c1', last_read_at: '2026-01-01T00:00:00Z' }], error: null },
  ]);
  __setSupabase(client);

  const res = await api.getReadState(ME);

  assert.deepEqual(res, { c1: '2026-01-01T00:00:00Z' });
  const eq = ops(client, 'connection_reads', 'eq');
  assert.deepEqual(eq[0].args, ['user_id', ME]);
});

test('getMessagesPage is scoped to the connection id', async () => {
  const client = createSupabaseMock([
    {
      data: [
        { id: 'm2', created_at: '2026-03-02T00:00:00Z' },
        { id: 'm1', created_at: '2026-03-01T00:00:00Z' },
      ],
      error: null,
    },
  ]);
  __setSupabase(client);

  const res = await api.getMessagesPage('c1');

  assert.equal(res.error, null);
  const eq = ops(client, 'messages', 'eq');
  assert.deepEqual(eq[0].args, ['connection_id', 'c1']);
});

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

test('getMessagesPage marks hasMore and returns the correct page order', async () => {
  const limit = 2;
  // 3 rows -> limit+1 === 3 -> more pages exist; page = first `limit`, reversed.
  const rows = [
    { id: 'm3', created_at: '2026-03-03T00:00:00Z' },
    { id: 'm2', created_at: '2026-03-02T00:00:00Z' },
    { id: 'm1', created_at: '2026-03-01T00:00:00Z' },
  ];
  const client = createSupabaseMock([{ data: rows, error: null }]);
  __setSupabase(client);

  const res = await api.getMessagesPage('c1', undefined, undefined, limit);

  assert.equal(res.error, null);
  assert.equal(res.hasMore, true);
  assert.equal(res.messages.length, limit);
  // The page is the NEWEST `limit` messages, displayed oldest -> newest.
  assert.equal(res.messages[0].id, 'm2');
  assert.equal(res.messages[1].id, 'm3');

  const limitOp = ops(client, 'messages', 'limit');
  assert.deepEqual(limitOp[0].args, [limit + 1], 'limit+1 detects more pages');
});

test('getMessagesPage reports no more pages when rows <= limit', async () => {
  const rows = [
    { id: 'm2', created_at: '2026-03-02T00:00:00Z' },
    { id: 'm1', created_at: '2026-03-01T00:00:00Z' },
  ];
  const client = createSupabaseMock([{ data: rows, error: null }]);
  __setSupabase(client);

  const res = await api.getMessagesPage('c1', undefined, undefined, 2);

  assert.equal(res.hasMore, false);
  assert.equal(res.messages.length, 2);
});

test('getMessagesPage applies the pagination cursor (before + beforeId)', async () => {
  const client = createSupabaseMock([{ data: [], error: null }]);
  __setSupabase(client);

  await api.getMessagesPage('c1', '2026-03-02T00:00:00Z', 'm10');

  const or = ops(client, 'messages', 'or');
  assert.equal(or.length, 1);
  assert.match(or[0].args[0], /created_at\.lt\.2026-03-02T00:00:00Z/);
  assert.match(or[0].args[0], /id\.lt\.m10/);
});

test('getMessagesPage applies the hiddenUntil cutoff', async () => {
  const client = createSupabaseMock([{ data: [], error: null }]);
  __setSupabase(client);

  await api.getMessagesPage('c1', undefined, undefined, 40, '2026-01-01T00:00:00Z');

  const gt = ops(client, 'messages', 'gt');
  assert.deepEqual(gt[0].args, ['created_at', '2026-01-01T00:00:00Z']);
});

test('getMessagesPage surfaces a read error instead of returning empty silently', async () => {
  const client = createSupabaseMock([{ data: null, error: { code: '42501', message: 'row-level security' } }]);
  __setSupabase(client);

  const res = await api.getMessagesPage('c1');

  assert.equal(res.hasMore, false);
  assert.deepEqual(res.messages, []);
  assert.equal(res.error, 'You are not allowed to do that.');
});

test('sendMessage stores the exact ciphertext provided (no post-encryption mutation)', async () => {
  const ciphertext =
    'AnE2EEEnvelope==.with+base64/chars;and_nothing_else|very|opaque';
  const client = createSupabaseMock([
    { data: { id: 'm1', connection_id: 'c1', sender_id: ME, ciphertext }, error: null },
  ]);
  __setSupabase(client);

  const res = await api.sendMessage('c1', ME, ciphertext);

  assert.equal(res.error, null);
  assert.equal(res.message.id, 'm1');

  const insert = ops(client, 'messages', 'insert');
  assert.equal(insert.length, 1);
  const row = insert[0].args[0];
  assert.equal(row.connection_id, 'c1');
  assert.equal(row.sender_id, ME);
  assert.equal(row.ciphertext, ciphertext, 'ciphertext must be transported untransformed');
});

test('sendMessage maps an RLS write rejection to connectionFailed', async () => {
  const client = createSupabaseMock([
    { data: null, error: { code: '42501', message: 'row-level security' } },
  ]);
  __setSupabase(client);

  const res = await api.sendMessage('c1', ME, 'cipher');

  assert.equal(res.message, null);
  assert.equal(res.error, 'The request could not be sent.');
});

test('sendMessage surfaces a generic network error', async () => {
  const client = createSupabaseMock([{ data: null, error: { message: 'fetch failed' } }]);
  __setSupabase(client);

  const res = await api.sendMessage('c1', ME, 'cipher');

  assert.equal(res.message, null);
  assert.equal(res.error, 'No connection to the server.');
});

test('deleteMessageForEveryone blanks the ciphertext and stamps deleted_at', async () => {
  const client = createSupabaseMock([{ data: null, error: null }]);
  __setSupabase(client);

  const res = await api.deleteMessageForEveryone('m1');

  assert.equal(res, null);
  const update = ops(client, 'messages', 'update');
  const eq = ops(client, 'messages', 'eq');
  assert.equal(update.length, 1);
  assert.equal(update[0].args[0].ciphertext, '', 'deleted message ciphertext blanked');
  assert.ok(update[0].args[0].deleted_at);
  assert.deepEqual(eq[0].args, ['id', 'm1']);
});

test('deleteMessageForEveryone surfaces an error', async () => {
  const client = createSupabaseMock([{ data: null, error: { message: 'fetch failed' } }]);
  __setSupabase(client);

  const res = await api.deleteMessageForEveryone('m1');

  assert.equal(res, 'No connection to the server.');
});

// ---------------------------------------------------------------------------
// Connection operations
// ---------------------------------------------------------------------------

test('sendConnectionRequest preserves the chat for an existing accepted connection', async () => {
  const client = createSupabaseMock([
    { data: [], error: null }, // block state: none
    { data: { id: 'c1', status: 'accepted', user_a: ME, user_b: 'other' }, error: null }, // existing
    { data: [], error: null }, // message_deletions
    { data: [], error: null }, // chat_deletions
  ]);
  __setSupabase(client);

  const res = await api.sendConnectionRequest(ME, 'other');

  assert.equal(res, 'This connection already exists.');
  assert.equal(rpcOps(client, 'send_connection_request').length, 0, 'must not re-request an accepted chat');
});

test('sendConnectionRequest delegates to the RPC when no existing connection', async () => {
  const client = createSupabaseMock([
    { data: [], error: null }, // block state: none
    { data: null, error: null }, // existing: none
    { data: 'conn-new', error: null }, // RPC returns the id
  ]);
  __setSupabase(client);

  const res = await api.sendConnectionRequest(ME, 'other');

  assert.equal(res, null);
  const rpc = rpcOps(client, 'send_connection_request');
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0].params, { target: 'other' });
});

test('sendConnectionRequest falls back to an insert when the RPC is absent', async () => {
  const client = createSupabaseMock([
    { data: [], error: null }, // block state: none
    { data: null, error: null }, // existing: none
    { data: null, error: { code: 'PGRST202', message: 'function send_connection_request() does not exist' } }, // missing RPC
    { data: null, error: null }, // fallback insert
  ]);
  __setSupabase(client);

  const res = await api.sendConnectionRequest(ME, 'other');

  assert.equal(res, null);
  const insert = ops(client, 'connections', 'insert');
  assert.equal(insert.length, 1);
  assert.equal(insert[0].args[0].user_a, ME);
  assert.equal(insert[0].args[0].user_b, 'other');
  assert.equal(insert[0].args[0].status, 'pending');
});

test('acceptConnection updates only a still-pending connection', async () => {
  const client = createSupabaseMock([{ data: null, error: null }]);
  __setSupabase(client);

  const res = await api.acceptConnection('c1');

  assert.equal(res, null);
  const update = ops(client, 'connections', 'update');
  assert.deepEqual(update[0].args, [{ status: 'accepted' }]);
  const eq = ops(client, 'connections', 'eq');
  assert.deepEqual(eq[0].args, ['id', 'c1']);
  assert.deepEqual(eq[1].args, ['status', 'pending']);
});

test('acceptConnection surfaces an error', async () => {
  const client = createSupabaseMock([{ data: null, error: { message: 'fetch failed' } }]);
  __setSupabase(client);

  const res = await api.acceptConnection('c1');

  assert.equal(res, 'No connection to the server.');
});

test('declineConnection delegates to the RPC with block_peer false', async () => {
  const client = createSupabaseMock([{ data: null, error: null }]);
  __setSupabase(client);

  const res = await api.declineConnection('c1');

  assert.equal(res, null);
  const rpc = rpcOps(client, 'decline_connection');
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0].params, { conn: 'c1', block_peer: false });
});

test('cancelConnectionRequest deletes the request row', async () => {
  const client = createSupabaseMock([{ data: null, error: null }]);
  __setSupabase(client);

  const res = await api.cancelConnectionRequest('c1');

  assert.equal(res, null);
  const del = ops(client, 'connections', 'delete');
  assert.equal(del.length, 1);
  const eq = ops(client, 'connections', 'eq');
  assert.deepEqual(eq[0].args, ['id', 'c1']);
});

// ---------------------------------------------------------------------------
// Deletion operations
// ---------------------------------------------------------------------------

test('isHiddenByChatDeletion honors the hiddenUntil cutoff', () => {
  assert.equal(api.isHiddenByChatDeletion('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'), true);
  assert.equal(api.isHiddenByChatDeletion('2026-07-01T00:00:00Z', '2026-06-01T00:00:00Z'), false);
  assert.equal(api.isHiddenByChatDeletion(undefined, '2026-06-01T00:00:00Z'), false);
  assert.equal(api.isHiddenByChatDeletion('2026-01-01T00:00:00Z', null), false);
});

test('deleteMessageForMe records the deletion scoped to the caller', async () => {
  const client = createSupabaseMock([{ data: null, error: null }]);
  __setSupabase(client);

  const res = await api.deleteMessageForMe(ME, 'm1');

  assert.equal(res, null);
  const insert = ops(client, 'message_deletions', 'insert');
  assert.equal(insert.length, 1);
  assert.deepEqual(insert[0].args[0], { message_id: 'm1', user_id: ME });
});

test('deleteMessageForMe keeps the local fallback and surfaces a DB error', async () => {
  const client = createSupabaseMock([{ data: null, error: { message: 'fetch failed' } }]);
  __setSupabase(client);

  const res = await api.deleteMessageForMe(ME, 'm1');

  // The row is still hidden locally; the DB write failed, so the call reports it.
  assert.equal(res, 'No connection to the server.');
});

test('deleteChatForMe upserts the hidden cutoff for the caller', async () => {
  const client = createSupabaseMock([{ data: null, error: null }]);
  __setSupabase(client);

  const res = await api.deleteChatForMe(ME, 'c1');

  assert.equal(res, null);
  const upsert = ops(client, 'chat_deletions', 'upsert');
  assert.equal(upsert.length, 1);
  const row = upsert[0].args[0];
  assert.equal(row.connection_id, 'c1');
  assert.equal(row.user_id, ME);
  assert.equal(row.revealed, false);
  assert.ok(row.hidden_until);
  assert.deepEqual(upsert[0].args[1], { onConflict: 'connection_id,user_id' });
});

test('deleteChatForMe falls back to an insert when upsert is unsupported', async () => {
  const client = createSupabaseMock([
    { data: null, error: { message: 'upsert unsupported' } },
    { data: null, error: null },
  ]);
  __setSupabase(client);

  const res = await api.deleteChatForMe(ME, 'c1');

  assert.equal(res, null);
  assert.equal(ops(client, 'chat_deletions', 'upsert').length, 1);
  const insert = ops(client, 'chat_deletions', 'insert');
  assert.equal(insert.length, 1);
});

// ---------------------------------------------------------------------------
// Unread-state behavior (exercised through the real getUnreadCounts)
// ---------------------------------------------------------------------------

test('getUnreadCounts reads the connection_unread view scoped to the caller', async () => {
  const client = createSupabaseMock([
    { data: [{ connection_id: 'c1', unread: 2 }], error: null },
  ]);
  __setSupabase(client);

  const res = await api.getUnreadCounts(ME, ['c1'], {}, client);

  assert.deepEqual(res, { c1: 2 });
  const select = ops(client, 'connection_unread', 'select');
  assert.equal(select.length, 1);
  const eq = ops(client, 'connection_unread', 'eq');
  assert.deepEqual(eq[0].args, ['user_id', ME]);
});

test('getUnreadCounts falls back to the batched count when the view is incomplete', async () => {
  const client = createSupabaseMock([
    { data: [], error: null }, // view: c1 missing
    { data: [{ connection_id: 'c1' }, { connection_id: 'c1' }], error: null }, // batched fallback
  ]);
  __setSupabase(client);

  const res = await api.getUnreadCounts(ME, ['c1'], {}, client);

  assert.deepEqual(res, { c1: 2 });
});
