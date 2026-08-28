// enough. E2EE-v0.2 — message cache confidentiality tests (audit finding F6).
// ---------------------------------------------------------------------------
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/message-cache.test.mjs
//
// These tests verify the security invariants of finding F6:
// 1. Persisted cache records do not contain plaintext message content.
// 2. Cache reads correctly restore original plaintext.
// 3. Tampered ciphertext or metadata fails safely (fail closed).
// 4. Missing cache key fails closed (KEY_MISSING).
// 5. Cache encryption and decryption are isolated per user.
// 6. Reload / persistence lifecycle works across in-memory wipes.
// 7. Account deletion wipes the persistent cache record and the sealing key.
// 8. No plaintext fallback exists.
// 9. Legacy localStorage plaintext is migrated and deleted immediately.
// 10. Concurrent cache writes serialize safely without lost updates.

import '../../crypto/__tests__/setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildCacheAad,
  cacheManyPlaintext,
  cachePlaintext,
  clearMessageCache,
  getCachedPlaintext,
  getCachedPlaintextSync,
  isCacheEnvelope,
  sealCache,
  unsealCache,
  warmMessageCache,
  _resetMessageCacheForTests,
  CACHE_ENVELOPE_VERSION,
  CACHE_AAD_PREFIX,
} from '../message-cache.ts';

import {
  deleteCryptoDatabase,
  deleteState,
  deleteUserCryptoState,
  getState,
  putState,
} from '../../crypto/storage.ts';

import {
  deleteSealingKey,
  ensureSealingKey,
  loadSealingKey,
} from '../../crypto/sealed-state.ts';

import { RECORD_MESSAGE_CACHE } from '../../crypto/types.ts';
import { isCryptoError } from '../../crypto/errors.ts';

let seq = 0;
const freshUser = () => `f6-user-${++seq}-${Date.now()}`;

// Ensure localStorage shim is available for tests
const memStorage = new Map();
if (typeof globalThis.window === 'undefined') {
  globalThis.window = /** @type {any} */ ({});
}
globalThis.window.localStorage = {
  getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
  setItem: (k, v) => void memStorage.set(k, String(v)),
  removeItem: (k) => void memStorage.delete(k),
  clear: () => void memStorage.clear(),
};

beforeEach(async () => {
  memStorage.clear();
  _resetMessageCacheForTests();
  await deleteCryptoDatabase();
});

test('MC1: cachePlaintext encrypts plaintext before persisting to IndexedDB (no plaintext in storage)', async () => {
  const user = freshUser();
  const secret = 'super-secret-confidential-message-content-xyz-789';
  await cachePlaintext(user, 'msg-1', secret);

  // 1. Inspect raw IndexedDB record
  const raw = await getState(user, RECORD_MESSAGE_CACHE);
  assert.ok(raw, 'sealed envelope must be persisted to IndexedDB');
  assert.ok(isCacheEnvelope(raw), 'persisted record must be shaped as CachedMessageEnvelope');
  assert.equal(raw.v, CACHE_ENVELOPE_VERSION);
  assert.equal(raw.userId, user);
  assert.equal(raw.iv.length, 12, 'IV must be exactly 12 bytes');
  assert.ok(raw.sealed.length >= 16, 'sealed ciphertext must include AEAD tag');

  // 2. Verify plaintext does NOT appear anywhere in the persisted record
  const serializedRecord = JSON.stringify(raw);
  assert.equal(
    serializedRecord.includes(secret),
    false,
    'Plaintext must NOT appear in stringified IndexedDB record',
  );

  const rawBytesAsString = new TextDecoder('utf-8', { fatal: false }).decode(raw.sealed);
  assert.equal(
    rawBytesAsString.includes(secret),
    false,
    'Ciphertext bytes must NOT contain readable plaintext',
  );

  // 3. Verify no plaintext is stored in localStorage
  assert.equal(
    window.localStorage.getItem(`enough-msgplain-${user}`),
    null,
    'localStorage must not contain unencrypted plaintext cache',
  );
});

test('MC2: getCachedPlaintext and getCachedPlaintextSync restore original plaintext', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'msg-1', 'Hello World!');

  // Async read
  const asyncResult = await getCachedPlaintext(user, 'msg-1');
  assert.equal(asyncResult, 'Hello World!');

  // Sync read from in-memory cache
  const syncResult = getCachedPlaintextSync(user, 'msg-1');
  assert.equal(syncResult, 'Hello World!');

  // Missing message returns null
  assert.equal(await getCachedPlaintext(user, 'non-existent'), null);
  assert.equal(getCachedPlaintextSync(user, 'non-existent'), null);
});

test('MC3: batch caching with cacheManyPlaintext encrypts and restores all entries', async () => {
  const user = freshUser();
  await cacheManyPlaintext(user, [
    { messageId: 'm-1', plaintext: 'first message' },
    { messageId: 'm-2', plaintext: 'second message' },
    { messageId: 'm-3', plaintext: 'third message' },
  ]);

  assert.equal(await getCachedPlaintext(user, 'm-1'), 'first message');
  assert.equal(await getCachedPlaintext(user, 'm-2'), 'second message');
  assert.equal(await getCachedPlaintext(user, 'm-3'), 'third message');

  // Simulate reload
  _resetMessageCacheForTests();
  assert.equal(await getCachedPlaintext(user, 'm-1'), 'first message');
  assert.equal(await getCachedPlaintext(user, 'm-2'), 'second message');
  assert.equal(await getCachedPlaintext(user, 'm-3'), 'third message');
});

test('MC4: tampered ciphertext fails authentication (UNSEAL_FAILED) and fails closed', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'secret message');

  const raw = /** @type {any} */ (await getState(user, RECORD_MESSAGE_CACHE));
  assert.ok(isCacheEnvelope(raw));

  // Flip a bit in the ciphertext
  const tamperedSealed = new Uint8Array(raw.sealed);
  tamperedSealed[0] ^= 0x01;
  const tamperedEnvelope = { ...raw, sealed: tamperedSealed };
  await putState(user, RECORD_MESSAGE_CACHE, tamperedEnvelope);

  // Direct unseal throws UNSEAL_FAILED
  const key = await ensureSealingKey(user);
  await assert.rejects(
    () => unsealCache(key, tamperedEnvelope, user),
    (err) => isCryptoError(err, 'UNSEAL_FAILED'),
  );

  // Safe UI read fails closed (returns null, does not throw or crash)
  _resetMessageCacheForTests();
  const recovered = await getCachedPlaintext(user, 'm-1');
  assert.equal(recovered, null, 'Tampered cache must fail closed');
});

test('MC5: tampered IV fails authentication (UNSEAL_FAILED) and fails closed', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'secret message');

  const raw = /** @type {any} */ (await getState(user, RECORD_MESSAGE_CACHE));
  const tamperedIv = new Uint8Array(raw.iv);
  tamperedIv[0] ^= 0xff;
  const tamperedEnvelope = { ...raw, iv: tamperedIv };
  await putState(user, RECORD_MESSAGE_CACHE, tamperedEnvelope);

  const key = await ensureSealingKey(user);
  await assert.rejects(
    () => unsealCache(key, tamperedEnvelope, user),
    (err) => isCryptoError(err, 'UNSEAL_FAILED'),
  );

  _resetMessageCacheForTests();
  assert.equal(await getCachedPlaintext(user, 'm-1'), null);
});

test('MC6: wrong envelope version fails validation (CORRUPT_STATE) and fails closed', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'secret message');

  const raw = /** @type {any} */ (await getState(user, RECORD_MESSAGE_CACHE));
  const tamperedEnvelope = { ...raw, v: 999 };
  await putState(user, RECORD_MESSAGE_CACHE, tamperedEnvelope);

  const key = await ensureSealingKey(user);
  await assert.rejects(
    () => unsealCache(key, tamperedEnvelope, user),
    (err) => isCryptoError(err, 'CORRUPT_STATE'),
  );

  _resetMessageCacheForTests();
  assert.equal(await getCachedPlaintext(user, 'm-1'), null);
});

test('MC7: cross-user isolation — user A cache cannot be read by user B', async () => {
  const alice = freshUser();
  const bob = freshUser();

  await cachePlaintext(alice, 'm-1', 'alice secret');
  await cachePlaintext(bob, 'm-1', 'bob secret');

  assert.equal(await getCachedPlaintext(alice, 'm-1'), 'alice secret');
  assert.equal(await getCachedPlaintext(bob, 'm-1'), 'bob secret');

  // Attempt to unseal Alice's envelope directly with Bob's key/identity
  const aliceRaw = /** @type {any} */ (await getState(alice, RECORD_MESSAGE_CACHE));
  const bobKey = await ensureSealingKey(bob);

  // 1. Header mismatch: envelope.userId !== expectedUserId
  await assert.rejects(
    () => unsealCache(bobKey, aliceRaw, bob),
    (err) => isCryptoError(err, 'USER_MISMATCH'),
  );

  // 2. Modified header: replace userId with Bob's id. Tag check must fail because AAD was bound to Alice!
  const forgedEnvelope = { ...aliceRaw, userId: bob };
  await assert.rejects(
    () => unsealCache(bobKey, forgedEnvelope, bob),
    (err) => isCryptoError(err, 'UNSEAL_FAILED'),
  );

  // 3. Even if forged record is stored in Bob's slot, Bob's cache read fails closed
  await putState(bob, RECORD_MESSAGE_CACHE, forgedEnvelope);
  _resetMessageCacheForTests();
  assert.equal(await getCachedPlaintext(bob, 'm-1'), null);
});

test('MC8: missing sealing key fails closed (KEY_MISSING)', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'sensitive text');

  // Destroy sealing key
  await deleteSealingKey(user);
  assert.equal(await loadSealingKey(user), null);

  // Simulate cold reload
  _resetMessageCacheForTests();

  // Read fails closed (returns null, never returns plaintext)
  const result = await getCachedPlaintext(user, 'm-1');
  assert.equal(result, null, 'Cache read must fail closed when sealing key is missing');
});

test('MC9: reload lifecycle — persistent sealed cache survives in-memory wipe', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'msg-reload-1', 'text before reload');

  // Wipe in-memory caches (simulates tab restart or reload)
  _resetMessageCacheForTests();

  // Synchronous read before hydration returns null
  assert.equal(getCachedPlaintextSync(user, 'msg-reload-1'), null);

  // Pre-warm the cache (Home load path)
  await warmMessageCache(user);

  // Synchronous read now succeeds
  assert.equal(getCachedPlaintextSync(user, 'msg-reload-1'), 'text before reload');

  // Asynchronous read also succeeds
  assert.equal(await getCachedPlaintext(user, 'msg-reload-1'), 'text before reload');
});

test('MC10: account deletion removes persistent cache, sealing key, and in-memory state', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'ephemeral secret');

  // Verify stored in IndexedDB
  const stored = await getState(user, RECORD_MESSAGE_CACHE);
  assert.ok(stored);

  // Execute full account deletion cleanup
  await deleteUserCryptoState(user);

  // Verify persistent cache record is deleted
  const postDeleteState = await getState(user, RECORD_MESSAGE_CACHE);
  assert.equal(postDeleteState, undefined, 'deleteUserCryptoState must remove RECORD_MESSAGE_CACHE');

  // Verify sealing key is deleted
  const postDeleteKey = await loadSealingKey(user);
  assert.equal(postDeleteKey, null, 'deleteUserCryptoState must remove sealing key');

  // Verify in-memory cache was cleared
  assert.equal(getCachedPlaintextSync(user, 'm-1'), null);
  assert.equal(await getCachedPlaintext(user, 'm-1'), null);
});

test('MC11: clearMessageCache removes cache from IndexedDB and cleans legacy localStorage', async () => {
  const user = freshUser();
  // Simulate leftover legacy plaintext
  window.localStorage.setItem(`enough-msgplain-${user}`, JSON.stringify({ 'm-legacy': 'old' }));
  await cachePlaintext(user, 'm-1', 'active');

  await clearMessageCache(user);

  assert.equal(await getState(user, RECORD_MESSAGE_CACHE), undefined);
  assert.equal(window.localStorage.getItem(`enough-msgplain-${user}`), null);
  assert.equal(getCachedPlaintextSync(user, 'm-1'), null);
  assert.equal(await getCachedPlaintext(user, 'm-1'), null);
});

test('MC12: legacy localStorage plaintext is migrated and immediately deleted on first load', async () => {
  const user = freshUser();
  // Setup legacy unencrypted plaintext in localStorage
  window.localStorage.setItem(
    `enough-msgplain-${user}`,
    JSON.stringify({ 'legacy-msg-1': 'migrated text content' }),
  );

  _resetMessageCacheForTests();

  // Trigger load
  await warmMessageCache(user);

  // 1. Legacy localStorage plaintext MUST be wiped
  assert.equal(
    window.localStorage.getItem(`enough-msgplain-${user}`),
    null,
    'Legacy plaintext in localStorage must be wiped on migration',
  );

  // 2. Plaintext is now available through cache
  assert.equal(getCachedPlaintextSync(user, 'legacy-msg-1'), 'migrated text content');
  assert.equal(await getCachedPlaintext(user, 'legacy-msg-1'), 'migrated text content');

  // 3. Persistent record in IndexedDB is sealed
  const raw = await getState(user, RECORD_MESSAGE_CACHE);
  assert.ok(isCacheEnvelope(raw));
  assert.equal(
    JSON.stringify(raw).includes('migrated text content'),
    false,
    'Migrated persistent record must be sealed, not plaintext',
  );
});

test('MC13: sequential write queue prevents lost updates under concurrent cachePlaintext', async () => {
  const user = freshUser();
  const count = 10;

  // Issue 10 concurrent un-awaited cachePlaintext operations
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(cachePlaintext(user, `msg-${i}`, `content-${i}`));
  }
  await Promise.all(promises);

  // Wipe memory to force unseal from storage
  _resetMessageCacheForTests();

  // All 10 messages must be present in storage
  for (let i = 0; i < count; i++) {
    const text = await getCachedPlaintext(user, `msg-${i}`);
    assert.equal(text, `content-${i}`, `msg-${i} must be preserved across concurrent writes`);
  }
});

test('MC14: static security analysis — no plaintext persistence in message-cache.ts', () => {
  const source = fs.readFileSync(
    new URL('../message-cache.ts', import.meta.url),
    'utf-8',
  );

  // Must not set plaintext items in localStorage
  assert.equal(
    source.includes('localStorage.setItem'),
    false,
    'message-cache.ts must NOT write to localStorage.setItem',
  );

  // Must use WebCrypto AES-GCM
  assert.match(source, /AES-GCM/);
  assert.match(source, /crypto\.subtle\.encrypt/);
  assert.match(source, /crypto\.subtle\.decrypt/);

  // Must use sealed-state key management
  assert.match(source, /ensureSealingKey/);
  assert.match(source, /loadSealingKey/);

  // Must use IndexedDB state store
  assert.match(source, /RECORD_MESSAGE_CACHE/);
  assert.match(source, /putState/);
  assert.match(source, /getState/);
  assert.match(source, /deleteState/);

  // Must bind AAD with prefix
  assert.match(source, /CACHE_AAD_PREFIX/);
  assert.match(source, /buildCacheAad/);
});

test('MC15: buildCacheAad is injective and rejects separators in userId', () => {
  const aad1 = buildCacheAad('alice');
  const aad2 = buildCacheAad('bob');
  assert.notDeepEqual(aad1, aad2);

  assert.throws(
    () => buildCacheAad('user|with|separator'),
    (err) => isCryptoError(err, 'CORRUPT_STATE'),
  );
  assert.throws(
    () => buildCacheAad(''),
    (err) => isCryptoError(err, 'NOT_INITIALIZED'),
  );
});
