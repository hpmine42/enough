// enough. — Offline Send Queue (outbox) tests.
//
// Covered:
//   1. enqueue/load round-trip preserves payload fields,
//   2. ordering is insertion-order (FIFO),
//   3. outboxForConnection filters a loaded list by connectionId,
//   4. removeFromOutbox drops exactly one entry,
//   5. updateOutboxError stores the error message and bumps attempts,
//   6. account isolation: user B cannot see user A's entries,
//   7. tampering with the sealed record fails closed (entry dropped),
//   8. deleteUserCryptoState wipes outbox entries for that user.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/outbox.test.mjs

import '../crypto/__tests__/setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  enqueueMessage,
  loadOutbox,
  outboxForConnection,
  removeFromOutbox,
  updateOutboxError,
} from '../outbox.ts';

import { ensureSealingKey } from '../crypto/sealed-state.ts';
import { getState, putState, deleteUserCryptoState } from '../crypto/storage.ts';
import { OFFLINE_OUTBOX_RECORD } from '../outbox.ts';

let seq = 0;
const freshUser = () => `outbox-user-${++seq}-${Date.now()}`;

const makeEntry = (i = 0, connectionId = 'c', text = `hello ${i}`) => ({
  id: `outbox-client-${seq}-${i}`,
  connectionId,
  plaintext: text,
});

/* ------------------------------------------------------------------ */
/* 1. Basic enqueue/load/remove round trip                             */
/* ------------------------------------------------------------------ */

test('Q1: enqueue adds an entry that loadOutbox returns', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  const entry = { ...makeEntry(1), id: `q1-${Date.now()}` };
  await enqueueMessage(user, entry);

  const all = await loadOutbox(user);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, entry.id);
  assert.equal(all[0].connectionId, 'c');
  assert.equal(all[0].plaintext, 'hello 1');
  assert.equal(typeof all[0].createdAt, 'number');
  assert.equal(all[0].attempts, 0);
  assert.equal(all[0].lastError, undefined);
});

test('Q2: entries are returned in insertion order (FIFO)', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  const a = { id: `q2a-${Date.now()}`, connectionId: 'c', plaintext: 'a' };
  const b = { id: `q2b-${Date.now()}`, connectionId: 'c', plaintext: 'b' };
  const c = { id: `q2c-${Date.now()}`, connectionId: 'c', plaintext: 'c' };
  await enqueueMessage(user, a);
  await enqueueMessage(user, b);
  await enqueueMessage(user, c);
  const all = await loadOutbox(user);
  assert.deepEqual(
    all.map((m) => m.id),
    [a.id, b.id, c.id],
    'messages must come back in insertion order',
  );
});

test('Q3: outboxForConnection filters a loaded list by connectionId', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  await enqueueMessage(user, { id: `q3a-${Date.now()}`, connectionId: 'c-a', plaintext: 'a' });
  const bId = `q3b-${Date.now()}`;
  await enqueueMessage(user, { id: bId, connectionId: 'c-b', plaintext: 'b' });
  const all = await loadOutbox(user);
  const aList = outboxForConnection(all, 'c-a');
  const bList = outboxForConnection(all, 'c-b');
  assert.equal(aList.length, 1);
  assert.equal(bList.length, 1);
  assert.equal(bList[0].id, bId);
});

test('Q4: removeFromOutbox removes exactly one entry', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  const id1 = `q4a-${Date.now()}`;
  const id2 = `q4b-${Date.now()}`;
  await enqueueMessage(user, { id: id1, connectionId: 'c', plaintext: 'a' });
  await enqueueMessage(user, { id: id2, connectionId: 'c', plaintext: 'b' });
  await removeFromOutbox(user, id1);
  const all = await loadOutbox(user);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, id2);
});

test('Q5: updateOutboxError stores the error and bumps attempts', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  const id = `q5-${Date.now()}`;
  await enqueueMessage(user, { id, connectionId: 'c', plaintext: 'hi' });
  await updateOutboxError(user, id, 'server rejected: stale prekey');
  const all = await loadOutbox(user);
  assert.equal(all.length, 1);
  assert.equal(all[0].lastError, 'server rejected: stale prekey');
  assert.equal(all[0].attempts, 1);
});

/* ------------------------------------------------------------------ */
/* 2. Security / isolation properties                                  */
/* ------------------------------------------------------------------ */

test('Q6: entries are isolated by userId', async () => {
  const alice = freshUser();
  const bob = freshUser();
  await ensureSealingKey(alice);
  await ensureSealingKey(bob);
  await enqueueMessage(alice, { id: `q6-${Date.now()}`, connectionId: 'c', plaintext: 'hi' });
  const bobList = await loadOutbox(bob);
  assert.equal(bobList.length, 0, 'bob must not see alice outbox entries');
  const aliceList = await loadOutbox(alice);
  assert.equal(aliceList.length, 1);
});

test('Q7: tampering with the sealed record fails closed', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  const id = `q7-${Date.now()}`;
  await enqueueMessage(user, { id, connectionId: 'c', plaintext: 'hi' });

  // Read the stored envelope and flip a byte in the sealed body, then
  // write it back via putState (which handles structured cloning safely).
  const raw = await getState(user, OFFLINE_OUTBOX_RECORD);
  assert.ok(raw, 'record must exist for test to be meaningful');
  const tamperedSealed = new Uint8Array(raw.sealed.length);
  tamperedSealed.set(new Uint8Array(raw.sealed));
  const mid = Math.floor(tamperedSealed.length / 2);
  tamperedSealed[mid] ^= 0xff;
  await putState(user, OFFLINE_OUTBOX_RECORD, {
    v: raw.v,
    userId: raw.userId,
    record: raw.record,
    iv: new Uint8Array(raw.iv),
    sealed: tamperedSealed,
  });

  const all = await loadOutbox(user);
  assert.equal(all.length, 0, 'tampered entry must be rejected');
});

test('Q8: deleteUserCryptoState wipes all outbox entries', async () => {
  const user = freshUser();
  await ensureSealingKey(user);
  await enqueueMessage(user, { id: `q8a-${Date.now()}`, connectionId: 'c', plaintext: 'a' });
  await enqueueMessage(user, { id: `q8b-${Date.now()}`, connectionId: 'c', plaintext: 'b' });
  await deleteUserCryptoState(user);
  const all = await loadOutbox(user);
  assert.equal(all.length, 0, 'after deletion outbox must be empty');
});
