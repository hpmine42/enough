// enough. E2EE-v0.2 Phase 1 — device-store persistence tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/device-store.test.mjs
//
// These tests are LICENSE-INDEPENDENT: they do not import
// @getmaapp/signal-wasm. The record bodies here are arbitrary opaque bytes
// (this layer never interprets them). They prove the persistence contract that
// the future engine adapter will rely on: byte-identical round-trips, AAD
// cross-binding rejection, user isolation, fail-closed on a missing sealing
// key, and atomic cleanup on account deletion.
//
// This file is plain JavaScript (.mjs is not type-stripped): no type
// annotations, `as` casts or generic call arguments.
//
// Emphasis is on proving that WRONG behaviour is REJECTED, not merely that
// the happy path works.

import '../../crypto/__tests__/setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  saveIdentity,
  loadIdentity,
  saveRegistrationId,
  loadRegistrationId,
  saveKyberUsage,
  loadKyberUsage,
  saveSignedPreKey,
  loadSignedPreKey,
  removeSignedPreKey,
  saveOneTimePreKey,
  loadOneTimePreKey,
  removeOneTimePreKey,
  listOneTimePreKeys,
  countOneTimePreKeys,
  saveKyberPreKey,
  loadKyberPreKey,
  removeKyberPreKey,
  listKyberPreKeys,
  countKyberPreKeys,
  deleteAllDeviceRecords,
} from '../device-store.ts';
import {
  deleteCryptoDatabase,
  deleteUserCryptoState,
  deleteSealingKey,
  getState,
  putState,
} from '../../crypto/storage.ts';
import { isCryptoError } from '../../crypto/errors.ts';

let seq = 0;
const freshUser = () => `dev-user-${++seq}`;
/** Build arbitrary opaque bytes (this layer never inspects them). */
const B = (...bytes) => new Uint8Array(bytes);

async function reset() {
  await deleteCryptoDatabase();
}

function assertBytesEqual(actual, expected, msg) {
  assert.ok(actual instanceof Uint8Array, `${msg} (not a Uint8Array)`);
  assert.equal(actual.byteLength, expected.byteLength, `${msg} (length)`);
  for (let i = 0; i < actual.byteLength; i++) {
    assert.equal(actual[i], expected[i], `${msg} (byte ${i})`);
  }
}

/** Simulate a same-origin attacker editing a stored envelope in place. */
async function tamperSealedByte(userId, recordKey) {
  const raw = await getState(userId, recordKey);
  assert.ok(raw, 'envelope present');
  const tampered = { ...raw, sealed: new Uint8Array(raw.sealed) };
  tampered.sealed[0] ^= 0x01;
  await putState(userId, recordKey, tampered);
}

test('D1: singleton identity round-trips byte-identical', async () => {
  await reset();
  const u = freshUser();
  const body = B(1, 2, 3, 4, 5, 6, 7, 8);
  assert.equal(await loadIdentity(u), null, 'nothing before save');
  await saveIdentity(u, body);
  const loaded = await loadIdentity(u);
  assert.ok(loaded, 'loaded after save');
  assertBytesEqual(loaded, body, 'identity bytes preserved');
});

test('D2: registration-id, signed-prekey and kyber-usage singletons round-trip', async () => {
  await reset();
  const u = freshUser();
  await saveRegistrationId(u, B(10, 20, 30, 40));
  await saveSignedPreKey(u, B(11, 22, 33));
  await saveKyberUsage(u, B(0xff, 0xee, 0xdd));
  assertBytesEqual(await loadRegistrationId(u), B(10, 20, 30, 40), 'reg id');
  assertBytesEqual(await loadSignedPreKey(u), B(11, 22, 33), 'signed prekey');
  assertBytesEqual(await loadKyberUsage(u), B(0xff, 0xee, 0xdd), 'kyber usage');
  await removeSignedPreKey(u);
  assert.equal(await loadSignedPreKey(u), null, 'signed prekey removed');
});

test('D3: keyed one-time prekeys round-trip, list, count, remove', async () => {
  await reset();
  const u = freshUser();
  await saveOneTimePreKey(u, 5, B(50));
  await saveOneTimePreKey(u, 6, B(60));
  await saveOneTimePreKey(u, 7, B(70));
  assert.equal(await countOneTimePreKeys(u), 3, 'count before removal');
  assertBytesEqual(await loadOneTimePreKey(u, 6), B(60), 'load keyed prekey 6');
  const list = await listOneTimePreKeys(u);
  assert.equal(list.length, 3, 'list length');
  await removeOneTimePreKey(u, 6);
  assert.equal(await loadOneTimePreKey(u, 6), null, 'removed prekey gone');
  assert.equal(await countOneTimePreKeys(u), 2, 'count after removal');
});

test('D4: keyed kyber prekeys round-trip, count, remove', async () => {
  await reset();
  const u = freshUser();
  await saveKyberPreKey(u, 1, B(1, 2, 3));
  await saveKyberPreKey(u, 2, B(4, 5, 6));
  assert.equal(await countKyberPreKeys(u), 2, 'kyber count');
  assertBytesEqual(await loadKyberPreKey(u, 2), B(4, 5, 6), 'kyber load');
  const list = await listKyberPreKeys(u);
  assert.equal(list.length, 2, 'kyber list length');
  await removeKyberPreKey(u, 1);
  assert.equal(await countKyberPreKeys(u), 1, 'kyber count after removal');
});

test('D5: a tampered record body is rejected (UNSEAL_FAILED)', async () => {
  await reset();
  const u = freshUser();
  // Body long enough that flipping one byte cannot just corrupt the tag marker.
  await saveIdentity(u, B(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16));
  await tamperSealedByte(u, 'signal:identity');
  await assert.rejects(
    () => loadIdentity(u),
    (e) => isCryptoError(e, 'UNSEAL_FAILED'),
  );
});

test('D6: a foreign record cannot be unsealed under another user (USER_MISMATCH)', async () => {
  await reset();
  const a = freshUser();
  const b = freshUser();
  await saveIdentity(a, B(9, 9, 9, 9));
  // Give B its own sealing key + identity, then overwrite B's slot with A's
  // envelope. The cleartext header (userId = a) must reject under B before any
  // tag check, and the tag would fail anyway (sealed under A's key).
  await saveIdentity(b, B(2, 2, 2, 2));
  const aEnv = await getState(a, 'signal:identity');
  await putState(b, 'signal:identity', aEnv);
  // Loading as B must NOT hand back A's bytes.
  await assert.rejects(
    () => loadIdentity(b),
    (e) => isCryptoError(e, 'USER_MISMATCH'),
  );
});

test('D7: a record of the wrong type under a slot is rejected (USER_MISMATCH)', async () => {
  await reset();
  const u = freshUser();
  await saveOneTimePreKey(u, 5, B(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  // Place a 'prekey' envelope into the 'identity' slot.
  const env = await getState(u, 'signal:prekey:5');
  await putState(u, 'signal:identity', env);
  await assert.rejects(
    () => loadIdentity(u),
    (e) => isCryptoError(e, 'USER_MISMATCH'),
  );
});

test('D8: a missing sealing key with an existing record fails CLOSED (KEY_MISSING)', async () => {
  await reset();
  const u = freshUser();
  await saveIdentity(u, B(1, 2, 3, 4, 5, 6, 7, 8));
  await deleteSealingKey(u);
  await assert.rejects(
    () => loadIdentity(u),
    (e) => isCryptoError(e, 'KEY_MISSING'),
  );
});

test('D9: users A and B are fully isolated', async () => {
  await reset();
  const a = freshUser();
  const b = freshUser();
  await saveIdentity(a, B(1, 1, 1, 1));
  await saveIdentity(b, B(2, 2, 2, 2));
  await saveOneTimePreKey(a, 1, B(10));
  await saveOneTimePreKey(b, 1, B(20));
  assertBytesEqual(await loadIdentity(a), B(1, 1, 1, 1), 'A identity');
  assertBytesEqual(await loadIdentity(b), B(2, 2, 2, 2), 'B identity');
  assertBytesEqual(await loadOneTimePreKey(a, 1), B(10), 'A prekey 1');
  assertBytesEqual(await loadOneTimePreKey(b, 1), B(20), 'B prekey 1');
  // B's listing must not contain A's prekeys.
  assert.equal((await listOneTimePreKeys(b)).length, 1, 'B has only its own prekeys');
  // Deleting all device records for A leaves B intact.
  await deleteAllDeviceRecords(a);
  assert.equal(await loadIdentity(a), null, 'A identity gone');
  assert.equal(await countOneTimePreKeys(a), 0, 'A prekeys gone');
  assertBytesEqual(await loadIdentity(b), B(2, 2, 2, 2), 'B identity untouched');
  assert.equal(await countOneTimePreKeys(b), 1, 'B prekeys untouched');
});

test('D10: deleteUserCryptoState wipes all device records atomically', async () => {
  await reset();
  const a = freshUser();
  const b = freshUser();
  await saveIdentity(a, B(1, 1, 1, 1));
  await saveOneTimePreKey(a, 7, B(7));
  await saveKyberPreKey(a, 3, B(3));
  await saveIdentity(b, B(2, 2, 2, 2));
  await deleteUserCryptoState(a);
  // Account deletion wipes A's device records and its sealing key in one
  // atomic transaction, so a recreated account starts from a clean slate.
  assert.equal(await loadIdentity(a), null, 'A identity wiped');
  assert.equal(await countOneTimePreKeys(a), 0, 'A one-time prekeys wiped');
  assert.equal(await countKyberPreKeys(a), 0, 'A kyber prekeys wiped');
  assertBytesEqual(await loadIdentity(b), B(2, 2, 2, 2), 'B identity survives');
});

test('D11: overwriting a singleton replaces the previous value', async () => {
  await reset();
  const u = freshUser();
  await saveIdentity(u, B(1, 2, 3));
  await saveIdentity(u, B(9, 8, 7));
  assertBytesEqual(await loadIdentity(u), B(9, 8, 7), 'replaced value');
});

test('D12: an empty record body is rejected (CORRUPT_STATE)', async () => {
  await reset();
  const u = freshUser();
  await assert.rejects(
    () => saveIdentity(u, new Uint8Array(0)),
    (e) => isCryptoError(e, 'CORRUPT_STATE'),
  );
});

test('D13: keyed records of different types do not collide', async () => {
  await reset();
  const u = freshUser();
  // prekey id 1 and kyber-prekey id 1 must coexist independently.
  await saveOneTimePreKey(u, 1, B(0xaa));
  await saveKyberPreKey(u, 1, B(0xbb));
  assertBytesEqual(await loadOneTimePreKey(u, 1), B(0xaa), 'prekey 1');
  assertBytesEqual(await loadKyberPreKey(u, 1), B(0xbb), 'kyber-prekey 1');
  assert.equal(await countOneTimePreKeys(u), 1, 'prekey count unaffected by kyber');
  assert.equal(await countKyberPreKeys(u), 1, 'kyber count unaffected by prekey');
});
