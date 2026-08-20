import { webcrypto } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}

import {
  VaultError,
  attemptRollbackRestore,
  commitDecryptMutation,
  deleteVaultDatabase,
  generateWrappingKey,
  hasTombstone,
  loadSession,
  loadWrappingKey,
  persistWrappingKey,
  unwrapRecord,
  wrapRecord,
  encodeAad,
} from '../src/secret-vault.mjs';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PEER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeProtocolRecord(label, size = 64) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  bytes[0] = label;
  return bytes;
}

test.beforeEach(async () => {
  await deleteVaultDatabase();
});

test('wrapping key is non-extractable and survives IndexedDB roundtrip', async () => {
  const key = await generateWrappingKey();
  assert.equal(key.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
  await persistWrappingKey(USER_A, key);
  const loaded = await loadWrappingKey(USER_A);
  assert.ok(loaded instanceof CryptoKey);
  assert.equal(loaded.extractable, false);
  assert.equal(loaded.algorithm.name, 'AES-GCM');
});

test('opaque protocol records wrap and unwrap with AAD binding', async () => {
  const key = await generateWrappingKey();
  const record = fakeProtocolRecord(0x42, 4821); // Kyber-sized blob
  const aad = encodeAad(USER_A, 'kyber', '7');
  const blob = await wrapRecord(key, record, aad);
  assert.equal(blob.iv.byteLength, 12);
  assert.ok(blob.ciphertext.byteLength > record.byteLength); // GCM tag
  const plain = await unwrapRecord(key, blob, aad);
  assert.deepEqual(plain, record);
});

test('AAD mismatch (moved across users or record slots) fails closed', async () => {
  const key = await generateWrappingKey();
  const record = fakeProtocolRecord(0x11);
  const blob = await wrapRecord(key, record, encodeAad(USER_A, 'session', PEER));
  await assert.rejects(
    () => unwrapRecord(key, blob, encodeAad(USER_B, 'session', PEER)),
  );
  await assert.rejects(
    () => unwrapRecord(key, blob, encodeAad(USER_A, 'session', 'other-peer')),
  );
});

test('decrypt mutation writes session, kyber usage and tombstones atomically', async () => {
  const key = await generateWrappingKey();
  await persistWrappingKey(USER_A, key);
  const sessionBytes = fakeProtocolRecord(0x53, 256);
  const usageBytes = fakeProtocolRecord(0x4b, 80);
  const rev = await commitDecryptMutation(USER_A, key, {
    peerId: PEER,
    sessionBytes,
    kyberUsageBytes: usageBytes,
    consumedOtkId: 42,
    consumedKyberId: 7,
    expectedRevision: 0,
  });
  assert.equal(rev, 1);
  const loaded = await loadSession(USER_A, key, PEER);
  assert.equal(loaded.revision, 1);
  assert.deepEqual(loaded.bytes, sessionBytes);
  assert.equal(await hasTombstone(USER_A, 'otk', 42), true);
  assert.equal(await hasTombstone(USER_A, 'kyber', 7), true);
  assert.equal(await hasTombstone(USER_A, 'kyber', 8), false);
});

test('revision conflict aborts and leaves previous tombstones/session intact', async () => {
  const key = await generateWrappingKey();
  const firstSession = fakeProtocolRecord(0x01);
  await commitDecryptMutation(USER_A, key, {
    peerId: PEER,
    sessionBytes: firstSession,
    kyberUsageBytes: fakeProtocolRecord(0x4b, 16),
    consumedOtkId: 1,
    expectedRevision: 0,
  });
  await assert.rejects(
    () =>
      commitDecryptMutation(USER_A, key, {
        peerId: PEER,
        sessionBytes: fakeProtocolRecord(0x02),
        kyberUsageBytes: fakeProtocolRecord(0x4b, 16),
        consumedOtkId: 2,
        expectedRevision: 0, // stale
      }),
    (err) => err instanceof VaultError && err.code === 'REVISION_CONFLICT',
  );
  const loaded = await loadSession(USER_A, key, PEER);
  assert.deepEqual(loaded.bytes, firstSession);
  assert.equal(loaded.revision, 1);
  assert.equal(await hasTombstone(USER_A, 'otk', 1), true);
  assert.equal(await hasTombstone(USER_A, 'otk', 2), false);
});

test('older session backup is rejected (rollback protection)', async () => {
  const key = await generateWrappingKey();
  const v1 = fakeProtocolRecord(0x01);
  await commitDecryptMutation(USER_A, key, {
    peerId: PEER,
    sessionBytes: v1,
    kyberUsageBytes: fakeProtocolRecord(0x4b, 16),
    expectedRevision: 0,
  });
  const snapshot = await loadSession(USER_A, key, PEER);
  await commitDecryptMutation(USER_A, key, {
    peerId: PEER,
    sessionBytes: fakeProtocolRecord(0x02),
    kyberUsageBytes: fakeProtocolRecord(0x4b, 16),
    expectedRevision: 1,
  });
  await assert.rejects(
    () => attemptRollbackRestore(USER_A, key, PEER, snapshot.blob, snapshot.revision),
    (err) => err instanceof VaultError && err.code === 'ROLLBACK_REJECTED',
  );
  const current = await loadSession(USER_A, key, PEER);
  assert.equal(current.revision, 2);
  assert.notDeepEqual(current.bytes, v1);
});

test('SECURITY BOUNDARY: wrapping does not stop same-origin JS that can invoke decrypt', async () => {
  // This is the XSS / compromised-bundle residual risk. Documented, not "solved".
  const key = await generateWrappingKey();
  await persistWrappingKey(USER_A, key);
  const secret = fakeProtocolRecord(0x99, 32);
  await commitDecryptMutation(USER_A, key, {
    peerId: PEER,
    sessionBytes: secret,
    kyberUsageBytes: fakeProtocolRecord(0x4b, 16),
    expectedRevision: 0,
  });

  // Malicious same-origin script can load the wrapping key and unwrap.
  const stolenKey = await loadWrappingKey(USER_A);
  const stolen = await loadSession(USER_A, stolenKey, PEER);
  assert.deepEqual(stolen.bytes, secret);

  // What wrapping *does* prevent: reading vault rows as plaintext bytes.
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('enough-e2ee-2c-vault-experiment', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const raw = await new Promise((resolve, reject) => {
    const tx = db.transaction('vault', 'readonly');
    const get = tx.objectStore('vault').get(`${USER_A}:session:${PEER}`);
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  });
  db.close();
  assert.ok(raw.ciphertext);
  assert.notDeepEqual(new Uint8Array(raw.ciphertext.slice(0, secret.byteLength)), secret);
});
