// enough. E2EE — security-focused tests for the crypto foundation.
//
// Run with:
//   node --test --experimental-strip-types src/lib/crypto/__tests__/crypto.test.mjs
//
// These tests run against Node's Web Crypto + fake-indexeddb and do NOT
// touch Supabase or any network.

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bytesToBase64,
  base64ToBytes,
  serializeIdentityBundle,
  deserializeIdentityBundle,
  serializeSignedPreKey,
  deserializeSignedPreKey,
  serializeOneTimePreKey,
  deserializeOneTimePreKey,
  generateDeviceId,
} from '../serialization.ts';

import {
  hasIdentity,
  generateIdentity,
  loadIdentity,
  getIdentityBundle,
  getIdentityPublicKey,
  getIdentitySigningKey,
  signWithIdentity,
  verifyWithPublicKey,
  deleteIdentity,
  _resetIdentityCacheForTests,
  getDeviceId,
} from '../identity.ts';

import {
  ensureSignedPreKey,
  getSignedPreKey,
  refillOneTimePreKeys,
  listPublicOneTimePreKeys,
  getOneTimePreKeyCount,
  getPublicDeviceBundle,
  consumeOneTimePreKey,
  DEFAULT_OTK_POOL_SIZE,
} from '../prekeys.ts';

import {
  deleteCryptoDatabase,
  deleteUserCryptoState,
  openDatabase,
  CRYPTO_STORE_STATE,
  stateKeyFor,
} from '../storage.ts';

import {
  initCrypto,
  isE2eeSupported,
  CryptoError,
} from '../index.ts';

// Two distinct user ids to test cross-user isolation.
const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';

// Wipe database AND in-memory caches between tests.
async function resetAll() {
  _resetIdentityCacheForTests();
  await deleteCryptoDatabase();
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

test('bytesToBase64 / base64ToBytes round-trip', () => {
  const data = new Uint8Array([0, 1, 2, 3, 254, 255]);
  const b64 = bytesToBase64(data);
  assert.equal(typeof b64, 'string');
  assert.ok(b64.length > 0);
  const back = base64ToBytes(b64);
  assert.deepEqual([...back], [...data]);
});

test('base64ToBytes rejects non-string/invalid input', () => {
  assert.throws(() => base64ToBytes(undefined), /Invalid base64/);
  assert.throws(() => base64ToBytes(null), /Invalid base64/);
  assert.throws(() => base64ToBytes('!!!not-base64!!!'), /Invalid base64/);
});

test('identity bundle (de)serialization round-trip includes userId', () => {
  const bundle = {
    version: 1,
    deviceId: 'abc-123',
    userId: USER_A,
    identityKey: bytesToBase64(new Uint8Array(32).fill(7)),
    createdAt: 123456789,
  };
  const json = serializeIdentityBundle(bundle);
  const out = deserializeIdentityBundle(json);
  assert.deepEqual(out, bundle);
  assert.equal(out.userId, USER_A);
});

test('deserializeIdentityBundle rejects bad JSON and wrong field shapes', () => {
  assert.throws(() => deserializeIdentityBundle('{not json'), /Invalid identity bundle/);
  assert.throws(() => deserializeIdentityBundle('null'), /Invalid identity bundle/);
  assert.throws(() => deserializeIdentityBundle('{}'), /Malformed identity/);
  assert.throws(
    () =>
      deserializeIdentityBundle(
        JSON.stringify({
          version: 1,
          deviceId: 'x',
          userId: USER_A,
          identityKey: bytesToBase64(new Uint8Array(10)),
          createdAt: 1,
        }),
      ),
    /wrong length/,
  );
});

test('signed prekey (de)serialization round-trip', () => {
  const spk = {
    keyId: 7,
    publicKey: bytesToBase64(new Uint8Array(32).fill(1)),
    signature: bytesToBase64(new Uint8Array(64).fill(2)),
    createdAt: 99,
  };
  const json = serializeSignedPreKey(spk);
  const out = deserializeSignedPreKey(json);
  assert.deepEqual(out, spk);
});

test('signed prekey rejects wrong-length public key or signature', () => {
  assert.throws(
    () =>
      deserializeSignedPreKey(
        JSON.stringify({
          keyId: 1,
          publicKey: bytesToBase64(new Uint8Array(10)),
          signature: bytesToBase64(new Uint8Array(64)),
          createdAt: 1,
        }),
      ),
    /wrong length/,
  );
});

test('one-time prekey (de)serialization round-trip', () => {
  const otk = { keyId: 42, publicKey: bytesToBase64(new Uint8Array(32).fill(9)) };
  const json = serializeOneTimePreKey(otk);
  const out = deserializeOneTimePreKey(json);
  assert.deepEqual(out, otk);
});

test('generateDeviceId produces UUID-v4-shaped string', () => {
  const id = generateDeviceId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ---------------------------------------------------------------------------
// Identity lifecycle (per-user)
// ---------------------------------------------------------------------------

test('identity is generated once per user and survives reload', async () => {
  await resetAll();
  assert.equal(await hasIdentity(USER_A), false);
  const b1 = await generateIdentity(USER_A);
  assert.equal(b1.userId, USER_A);
  assert.equal(await hasIdentity(USER_A), false || true);
  assert.equal(await hasIdentity(USER_A), true);
  // Second generateIdentity for the SAME user must throw.
  await assert.rejects(generateIdentity(USER_A), /already exists/);
  // In-memory reload:
  _resetIdentityCacheForTests();
  const b2 = await loadIdentity(USER_A);
  assert.ok(b2);
  assert.equal(b2.deviceId, b1.deviceId);
  assert.equal(b2.identityKey, b1.identityKey);
  assert.equal(b2.userId, USER_A);
});

test('fresh storage produces a new identity', async () => {
  await resetAll();
  const b1 = await generateIdentity(USER_A);
  await deleteCryptoDatabase();
  _resetIdentityCacheForTests();
  assert.equal(await hasIdentity(USER_A), false);
  const b2 = await generateIdentity(USER_A);
  assert.notEqual(b1.deviceId, b2.deviceId);
  assert.notEqual(b1.identityKey, b2.identityKey);
});

test('identity public key signs/verifies correctly; private key is non-extractable', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  const pubKey = await getIdentityPublicKey(USER_A);
  assert.equal(pubKey.type, 'public');
  const privKey = await getIdentitySigningKey(USER_A);
  assert.equal(privKey.type, 'private');
  assert.equal(privKey.extractable, false);

  // Actual export of the private key must FAIL (not just have a flag).
  let exportedPrivate = null;
  try {
    exportedPrivate = await crypto.subtle.exportKey('pkcs8', privKey);
  } catch (e) {
    /* expected */
  }
  assert.equal(exportedPrivate, null, 'private key must NOT be exportable');

  // Sign/verify round-trip works.
  const msg = new TextEncoder().encode('hello enough.');
  const sig = await signWithIdentity(USER_A, msg);
  assert.equal(sig.byteLength, 64);
  assert.equal(await verifyWithPublicKey(pubKey, msg, sig), true);
  const tampered = new Uint8Array(msg);
  tampered[0] ^= 0xff;
  assert.equal(await verifyWithPublicKey(pubKey, tampered, sig), false);
});

test('deleteIdentity removes local identity for that user only', async () => {
  await resetAll();
  const a = await generateIdentity(USER_A);
  const b = await generateIdentity(USER_B);
  assert.equal(await hasIdentity(USER_A), true);
  assert.equal(await hasIdentity(USER_B), true);
  await deleteIdentity(USER_A);
  _resetIdentityCacheForTests();
  assert.equal(await hasIdentity(USER_A), false);
  assert.equal(await hasIdentity(USER_B), true);
  const b2 = await loadIdentity(USER_B);
  assert.equal(b2.deviceId, b.deviceId);
  void a;
});

test('corrupted identity record is detected and does not silently overwrite', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  // Insert garbage via raw IndexedDB (bypassing typed storage).
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CRYPTO_STORE_STATE, 'readwrite');
    tx.objectStore(CRYPTO_STORE_STATE).put(
      { garbage: true, version: 1, missingKeys: true },
      stateKeyFor(USER_A, 'identity'),
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  _resetIdentityCacheForTests();
  await assert.rejects(loadIdentity(USER_A), /corrupt/i);
  // After corruption we must NOT silently overwrite; generateIdentity must
  // also throw because hasIdentity sees a (corrupt) record.
  await assert.rejects(generateIdentity(USER_A), /already exists/);
});

test('identity record with wrong userId fails validation (user isolation)', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  // Tamper the stored record to point at USER_B.
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CRYPTO_STORE_STATE, 'readwrite');
    const store = tx.objectStore(CRYPTO_STORE_STATE);
    const req = store.get(stateKeyFor(USER_A, 'identity'));
    req.onsuccess = () => {
      const rec = req.result;
      rec.userId = USER_B;
      store.put(rec, stateKeyFor(USER_A, 'identity'));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  _resetIdentityCacheForTests();
  // Loading the identity under USER_A must now fail because the stored
  // userId does not match.
  await assert.rejects(loadIdentity(USER_A), /different user/i);
  // USER_B should still have no identity (storage is keyed by user).
  assert.equal(await hasIdentity(USER_B), false);
});

// ---------------------------------------------------------------------------
// PreKeys
// ---------------------------------------------------------------------------

test('signed prekey is created idempotently and its signature verifies', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  const s1 = await ensureSignedPreKey(USER_A);
  assert.equal(typeof s1.keyId, 'number');
  assert.equal(base64ToBytes(s1.publicKey).byteLength, 32);
  assert.equal(base64ToBytes(s1.signature).byteLength, 64);
  const s2 = await getSignedPreKey(USER_A);
  assert.ok(s2);
  assert.equal(s2.keyId, s1.keyId);

  const pub = await getIdentityPublicKey(USER_A);
  const ok = await verifyWithPublicKey(
    pub,
    base64ToBytes(s1.publicKey),
    base64ToBytes(s1.signature),
  );
  assert.equal(ok, true, 'signed prekey signature must verify against identity');
});

test('signed prekey private key is non-extractable', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  await ensureSignedPreKey(USER_A);
  // Reach into storage to inspect the private key.
  const { getState } = await import('../storage.ts');
  const { RECORD_SIGNED_PREKEY } = await import('../types.ts');
  const rec = await getState(USER_A, RECORD_SIGNED_PREKEY);
  assert.ok(rec, 'signed prekey record must exist');
  assert.equal(rec.privateKey.type, 'private');
  assert.equal(rec.privateKey.algorithm.name, 'X25519');
  assert.equal(rec.privateKey.extractable, false);
  let exported = null;
  try {
    exported = await crypto.subtle.exportKey('pkcs8', rec.privateKey);
  } catch { /* expected */ }
  assert.equal(exported, null, 'signed prekey private key must NOT be exportable');
});

test('one-time prekey pool refills to DEFAULT_OTK_POOL_SIZE and can be consumed', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  await ensureSignedPreKey(USER_A);
  const fresh = await refillOneTimePreKeys(USER_A);
  assert.equal(fresh.length, DEFAULT_OTK_POOL_SIZE);
  const more = await refillOneTimePreKeys(USER_A);
  assert.equal(more.length, 0);
  assert.equal(await getOneTimePreKeyCount(USER_A), DEFAULT_OTK_POOL_SIZE);
  const pub = await listPublicOneTimePreKeys(USER_A);
  assert.equal(pub.length, DEFAULT_OTK_POOL_SIZE);
  for (const k of pub) {
    assert.equal(typeof k.keyId, 'number');
    assert.equal(base64ToBytes(k.publicKey).byteLength, 32);
  }
  const target = pub[0];
  await consumeOneTimePreKey(USER_A, target.keyId);
  assert.equal(await getOneTimePreKeyCount(USER_A), DEFAULT_OTK_POOL_SIZE - 1);
  const after = await listPublicOneTimePreKeys(USER_A);
  assert.ok(!after.find((k) => k.keyId === target.keyId));
});

test('one-time prekey private keys are non-extractable', async () => {
  await resetAll();
  await generateIdentity(USER_A);
  await refillOneTimePreKeys(USER_A, 3);
  const list = await (await import('../storage.ts')).listPreKeys(USER_A);
  assert.ok(list.length >= 3);
  for (const k of list) {
    assert.equal(k.userId, USER_A);
    const priv = k.privateKey;
    assert.equal(priv.type, 'private');
    assert.equal(priv.algorithm.name, 'X25519');
    assert.equal(priv.extractable, false);
    let exported = null;
    try { exported = await crypto.subtle.exportKey('pkcs8', priv); } catch { /* expected */ }
    assert.equal(exported, null, 'OTK private key must NOT be exportable');
  }
});

// ---------------------------------------------------------------------------
// User Isolation
// ---------------------------------------------------------------------------

test('user A and user B get distinct identities and prekeys on the same browser', async () => {
  await resetAll();
  const a = await initCrypto(USER_A);
  const b = await initCrypto(USER_B);
  assert.notEqual(a.deviceId, b.deviceId);
  assert.notEqual(a.identityKey, b.identityKey);
  assert.equal(a.userId, USER_A);
  assert.equal(b.userId, USER_B);

  // Prekey pools are per-user; consuming one for A doesn't affect B.
  const aPre = await listPublicOneTimePreKeys(USER_A);
  const bPre = await listPublicOneTimePreKeys(USER_B);
  assert.ok(aPre.length > 0);
  assert.ok(bPre.length > 0);
  const aKeyIds = new Set(aPre.map((k) => k.keyId));
  for (const k of bPre) {
    assert.equal(aKeyIds.has(k.keyId), false, 'prekey id collision across users');
  }

  // Deleting A's state leaves B intact.
  await deleteUserCryptoState(USER_A);
  _resetIdentityCacheForTests();
  assert.equal(await hasIdentity(USER_A), false);
  assert.equal(await hasIdentity(USER_B), true);
  const b2 = await loadIdentity(USER_B);
  assert.equal(b2.deviceId, b.deviceId);
});

test('logout preserves identity; deleteAccount wipes it via deleteUserCryptoState', async () => {
  await resetAll();
  const a = await initCrypto(USER_A);
  // Simulate logout (no crypto deletion per spec): identity must remain.
  _resetIdentityCacheForTests(); // cache only, simulating reload
  const a2 = await loadIdentity(USER_A);
  assert.ok(a2);
  assert.equal(a2.deviceId, a.deviceId);
  // Simulate account deletion:
  await deleteUserCryptoState(USER_A);
  _resetIdentityCacheForTests();
  assert.equal(await hasIdentity(USER_A), false);
});

test('reload (cache reset) preserves identity and prekey counts', async () => {
  await resetAll();
  await initCrypto(USER_A);
  const preCount = await getOneTimePreKeyCount(USER_A);
  assert.ok(preCount > 0);
  _resetIdentityCacheForTests();
  const bundle = await loadIdentity(USER_A);
  assert.ok(bundle);
  assert.equal(bundle.userId, USER_A);
  assert.equal(await getOneTimePreKeyCount(USER_A), preCount);
});

// ---------------------------------------------------------------------------
// Public bundle security — no private material
// ---------------------------------------------------------------------------

test('getPublicDeviceBundle returns only public material', async () => {
  await resetAll();
  await initCrypto(USER_A);
  const bundle = await getPublicDeviceBundle(USER_A, 50);
  assert.ok(bundle.identity);
  assert.ok(bundle.signedPreKey);
  assert.ok(Array.isArray(bundle.oneTimePreKeys));
  assert.equal(bundle.identity.userId, USER_A);
  // Serialize and grep for forbidden fields/values.
  const json = JSON.stringify(bundle);
  for (const needle of [
    'privateKey',
    'signingPrivateKey',
    'signingKey',
    'secret',
    'CryptoKey',
    'extractable',
    'pkcs8',
    'raw"',
  ]) {
    assert.equal(
      json.includes(needle),
      false,
      `Public bundle must not contain '${needle}'`,
    );
  }
  // Public key strings must be 32-byte base64 (not, e.g., 64-byte private keys).
  assert.equal(base64ToBytes(bundle.identity.identityKey).byteLength, 32);
  assert.equal(base64ToBytes(bundle.signedPreKey.publicKey).byteLength, 32);
  assert.equal(base64ToBytes(bundle.signedPreKey.signature).byteLength, 64);
  for (const k of bundle.oneTimePreKeys) {
    assert.equal(base64ToBytes(k.publicKey).byteLength, 32);
  }
});

test('identity bundle JSON contains no private data', async () => {
  await resetAll();
  await initCrypto(USER_A);
  const { getIdentityBundleJSON } = await import('../identity.ts');
  const json = await getIdentityBundleJSON(USER_A);
  for (const needle of ['private', 'secret', 'CryptoKey', 'extractable']) {
    assert.equal(
      json.includes(needle),
      false,
      `Identity JSON must not contain '${needle}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// initCrypto: concurrency + idempotency + error paths
// ---------------------------------------------------------------------------

test('concurrent initCrypto calls for the same user produce one identity', async () => {
  await resetAll();
  const [b1, b2, b3] = await Promise.all([
    initCrypto(USER_A),
    initCrypto(USER_A),
    initCrypto(USER_A),
  ]);
  assert.equal(b1.deviceId, b2.deviceId);
  assert.equal(b2.deviceId, b3.deviceId);
  assert.equal(b1.identityKey, b2.identityKey);
});

test('initCrypto without userId throws', async () => {
  await resetAll();
  await assert.rejects(() => initCrypto(''), /userId is required|required/);
});

test('isE2eeSupported returns true in the test environment', () => {
  assert.equal(isE2eeSupported(), true);
});

// ---------------------------------------------------------------------------
// Error handling: CryptoError never includes secrets
// ---------------------------------------------------------------------------

test('CryptoError messages are generic and do not echo inputs', () => {
  const err = new CryptoError('CRYPTO_ERROR', undefined, new Error('super secret key bytes'));
  // The underlying cause is hidden on a non-enumerable symbol so that
  // JSON.stringify / toString / console.log won't reveal it.
  assert.match(err.message, /cryptographic operation failed/i);
  assert.doesNotMatch(err.message, /secret/i);
  const s = JSON.stringify({ err: { name: err.name, message: err.message, stack: err.stack } });
  assert.doesNotMatch(s, /secret key bytes/);
  // The symbol-keyed cause is still retrievable inside the module for
  // controlled debugging, but is not enumerable.
  const sym = Object.getOwnPropertySymbols(err).find(
    (s) => s.description === 'enough.crypto.cause',
  );
  assert.ok(sym, 'cause must be stored on a non-enumerable symbol');
});

// ---------------------------------------------------------------------------
// Storage / index
// ---------------------------------------------------------------------------

test('deleteCryptoDatabase is idempotent', async () => {
  await resetAll();
  await initCrypto(USER_A);
  assert.equal(await hasIdentity(USER_A), true);
  await deleteCryptoDatabase();
  _resetIdentityCacheForTests();
  assert.equal(await hasIdentity(USER_A), false);
  await deleteCryptoDatabase(); // idempotent
});

test('deleteUserCryptoState removes only that user', async () => {
  await resetAll();
  await initCrypto(USER_A);
  await initCrypto(USER_B);
  await deleteUserCryptoState(USER_A);
  _resetIdentityCacheForTests();
  assert.equal(await hasIdentity(USER_A), false);
  assert.equal(await hasIdentity(USER_B), true);
});

// ---------------------------------------------------------------------------
// Protocol boundary assertion (no accidental protocol implementation)
// ---------------------------------------------------------------------------

test('crypto layer exposes NO encrypt/decrypt/session APIs in E2EE-1', async () => {
  await resetAll();
  const index = await import('../index.ts');
  for (const forbidden of [
    'encryptMessage',
    'decryptMessage',
    'createSession',
    'establishSession',
    'doubleRatchet',
    'x3dh',
    'pqxdh',
  ]) {
    assert.equal(
      forbidden in index,
      false,
      `Crypto layer must not expose '${forbidden}' in E2EE-1`,
    );
  }
});
