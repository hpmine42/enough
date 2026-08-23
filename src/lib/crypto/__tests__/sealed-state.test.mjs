// enough. E2EE-2D.2 — sealed ratchet-state envelope (Stage 4).
//
// Run with:
//   node --test --experimental-strip-types src/lib/crypto/__tests__/sealed-state.test.mjs
//
// This suite exists to falsify audit finding C-2 and the state-substitution
// and cross-binding variants of it. Emphasis is entirely on proving that
// TAMPERED input is REJECTED. A test that only shows a genuine envelope opens
// would pass against a no-op implementation.
//
// The "state" blobs here are opaque non-secret fixtures. This layer never
// interprets them and no real key material is involved.

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AAD_PREFIX,
  IV_BYTES,
  buildAad,
  deleteSealingKey,
  ensureSealingKey,
  generateSealingKey,
  isEnvelopeShaped,
  loadSealingKey,
  seal,
  unseal,
} from '../sealed-state.ts';
import { encodeRevision } from '../revision.ts';
import { SEALED_ENVELOPE_VERSION } from '../types.ts';
import { deleteCryptoDatabase } from '../storage.ts';
import { isCryptoError } from '../errors.ts';

const U = 'user-A';
const C = 'conn-1';
const STATE = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

let seq = 0;
const freshUser = () => `sealed-user-${++seq}`;

async function reset() {
  await deleteCryptoDatabase();
}

/** Structured-clone an envelope the way IndexedDB would, then tamper with it. */
function clone(envelope) {
  return {
    ...envelope,
    epoch: new Uint8Array(envelope.epoch),
    revision: new Uint8Array(envelope.revision),
    iv: new Uint8Array(envelope.iv),
    sealed: new Uint8Array(envelope.sealed),
  };
}

/* ------------------------------------------------------------------ */
/* S1-S3. The key itself                                               */
/* ------------------------------------------------------------------ */

test('S1: the sealing key is AES-GCM-256 and NOT extractable', async () => {
  const key = await generateSealingKey();
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, 'AES-GCM');
  assert.equal(key.algorithm.length, 256);

  // Non-extractability must be real, not just a flag we set. Both export
  // routes have to fail, or same-origin script could lift the key and forge
  // envelopes offline.
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
  await assert.rejects(() => crypto.subtle.exportKey('jwk', key));
});

test('S2: the key survives an IndexedDB round trip as a live CryptoKey', async () => {
  await reset();
  const u = freshUser();
  const created = await ensureSealingKey(u);
  const loaded = await loadSealingKey(u);
  assert.ok(loaded instanceof CryptoKey);
  assert.equal(loaded.extractable, false);

  // Same key, proven by function rather than identity: an envelope sealed with
  // the created handle must open with the loaded handle.
  const env = await seal(created, u, C, 0n, 1n, STATE);
  const out = await unseal(loaded, env, u, C);
  assert.equal(out.ok, true);
  assert.deepEqual(out.value.state, STATE);
});

test('S3: ensureSealingKey is idempotent and never replaces a live key', async () => {
  await reset();
  const u = freshUser();
  const first = await ensureSealingKey(u);
  const env = await seal(first, u, C, 0n, 1n, STATE);

  // Concurrent callers must converge on one key. If a second key replaced the
  // first, every existing envelope would become permanently unreadable.
  const racers = await Promise.all([
    ensureSealingKey(u),
    ensureSealingKey(u),
    ensureSealingKey(u),
  ]);
  for (const k of racers) {
    const out = await unseal(k, env, u, C);
    assert.equal(out.ok, true, 'every returned key must open the original envelope');
  }
});

/* ------------------------------------------------------------------ */
/* S4. Happy path                                                      */
/* ------------------------------------------------------------------ */

test('S4: a genuine envelope opens and reports its authenticated header', async () => {
  const key = await generateSealingKey();
  const env = await seal(key, U, C, 3n, 7n, STATE);

  assert.equal(env.version, SEALED_ENVELOPE_VERSION);
  assert.equal(env.iv.length, IV_BYTES);
  assert.deepEqual(env.epoch, encodeRevision(3n));
  assert.deepEqual(env.revision, encodeRevision(7n));
  // The state must not appear in the clear anywhere in the record.
  assert.notDeepEqual(env.sealed.slice(0, STATE.length), STATE);

  const out = await unseal(key, env, U, C);
  assert.equal(out.ok, true);
  assert.equal(out.value.epoch, 3n);
  assert.equal(out.value.revision, 7n);
  assert.deepEqual(out.value.state, STATE);
});

test('S5: every seal draws a fresh IV', async () => {
  const key = await generateSealingKey();
  const ivs = new Set();
  for (let i = 0; i < 32; i++) {
    const env = await seal(key, U, C, 0n, BigInt(i), STATE);
    ivs.add(Buffer.from(env.iv).toString('hex'));
  }
  assert.equal(ivs.size, 32, 'IVs must never repeat under one key');
});

test('S6: sealing copies the caller buffer', async () => {
  const key = await generateSealingKey();
  const mutable = new Uint8Array([1, 2, 3, 4]);
  const env = await seal(key, U, C, 0n, 1n, mutable);
  mutable[0] = 99; // caller mutates after sealing
  const out = await unseal(key, env, U, C);
  assert.equal(out.ok, true);
  assert.deepEqual(out.value.state, new Uint8Array([1, 2, 3, 4]));
});

/* ------------------------------------------------------------------ */
/* S7. C-2: revision manipulation                                      */
/* ------------------------------------------------------------------ */

test('S7: C-2 — re-labelling a genuine state with a higher revision is REJECTED', async () => {
  const key = await generateSealingKey();
  // The exact audit scenario: a real state committed at revision 5, then
  // stamped with revision 500 to make it outrank the live session.
  const genuine = await seal(key, U, C, 0n, 5n, STATE);

  const forged = clone(genuine);
  forged.revision = encodeRevision(500n);

  const out = await unseal(key, forged, U, C);
  assert.equal(out.ok, false, 'a re-labelled envelope must NOT open');
  assert.equal(out.reason, 'UNSEAL_FAILED');

  // Guard against a weaker failure: it must not open AND report 500 either.
  assert.equal(out.value, undefined);
});

test('S8: lowering the revision is equally rejected', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 5n, STATE);
  const forged = clone(genuine);
  forged.revision = encodeRevision(1n);
  const out = await unseal(key, forged, U, C);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'UNSEAL_FAILED');
});

test('S9: every single-bit revision change is caught', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 0x0102030405060708n, STATE);
  for (let byte = 0; byte < 8; byte++) {
    for (const bit of [0, 3, 7]) {
      const forged = clone(genuine);
      forged.revision[byte] ^= 1 << bit;
      const out = await unseal(key, forged, U, C);
      assert.equal(out.ok, false, `revision byte ${byte} bit ${bit} must be authenticated`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* S10. State substitution                                             */
/* ------------------------------------------------------------------ */

test('S10: substituting state bytes under a header is REJECTED', async () => {
  const key = await generateSealingKey();
  const envA = await seal(key, U, C, 0n, 5n, new Uint8Array([1, 1, 1, 1]));
  const envB = await seal(key, U, C, 0n, 5n, new Uint8Array([2, 2, 2, 2]));

  // Splice B's ciphertext under A's header, keeping A's IV.
  const spliced = clone(envA);
  spliced.sealed = new Uint8Array(envB.sealed);
  const out = await unseal(key, spliced, U, C);
  assert.equal(out.ok, false, 'ciphertext from another envelope must not verify');
  assert.equal(out.reason, 'UNSEAL_FAILED');

  // A state blob from a DIFFERENT revision cannot be moved into this slot.
  // This is the direction that matters for rollback: an old committed state
  // being promoted to a newer revision.
  const older = await seal(key, U, C, 0n, 4n, new Uint8Array([7, 7, 7, 7]));
  const promoted = clone(envA);
  promoted.iv = new Uint8Array(older.iv);
  promoted.sealed = new Uint8Array(older.sealed);
  const out2 = await unseal(key, promoted, U, C);
  assert.equal(out2.ok, false, 'a rev-4 state must not verify under a rev-5 header');
  assert.equal(out2.reason, 'UNSEAL_FAILED');

  // Same for a state belonging to another connection.
  const foreign = await seal(key, U, 'conn-other', 0n, 5n, new Uint8Array([8, 8, 8, 8]));
  const moved = clone(envA);
  moved.iv = new Uint8Array(foreign.iv);
  moved.sealed = new Uint8Array(foreign.sealed);
  assert.equal((await unseal(key, moved, U, C)).ok, false);
});

test('S10b: DOCUMENTED LIMIT — envelopes sharing an identical AAD are interchangeable', async () => {
  // Honest statement of what AEAD does and does not give us, verified rather
  // than assumed.
  //
  // The AAD binds (version, userId, connectionId, epoch, revision). It does
  // NOT make a ciphertext unique within that tuple: two envelopes sealed for
  // the SAME (user, connection, epoch, revision) under the same key are both
  // genuine, so their (iv, sealed) pairs can be exchanged and still verify.
  //
  // This is not exploitable in this design, and the reason is structural, not
  // cryptographic: at most ONE envelope is ever persisted per (epoch,
  // revision) slot. `commitRatchetState` seals before opening the write
  // transaction and discards the envelope when the compare-and-swap loses, so
  // a second envelope for an already-committed slot never reaches storage for
  // an attacker to harvest. Every slot the attacker CAN read holds exactly one
  // envelope, and moving it to any other slot is rejected (S7-S14).
  //
  // Recording it as a test so the property stays visible and cannot be
  // mistaken for "state substitution is impossible in all cases".
  const key = await generateSealingKey();
  const one = await seal(key, U, C, 0n, 5n, new Uint8Array([1, 1, 1, 1]));
  const two = await seal(key, U, C, 0n, 5n, new Uint8Array([2, 2, 2, 2]));

  const swapped = clone(one);
  swapped.iv = new Uint8Array(two.iv);
  swapped.sealed = new Uint8Array(two.sealed);
  const out = await unseal(key, swapped, U, C);

  assert.equal(out.ok, true, 'EXPECTED_LIMITATION: identical AAD means interchangeable');
  assert.deepEqual(out.value.state, new Uint8Array([2, 2, 2, 2]));
  assert.equal(out.value.revision, 5n);
});

test('S11: flipping any bit of the ciphertext is caught', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 5n, STATE);
  for (let i = 0; i < genuine.sealed.length; i++) {
    const forged = clone(genuine);
    forged.sealed[i] ^= 0x01;
    const out = await unseal(key, forged, U, C);
    assert.equal(out.ok, false, `ciphertext byte ${i} must be authenticated`);
  }
});

test('S12: flipping any bit of the IV is caught', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 5n, STATE);
  for (let i = 0; i < IV_BYTES; i++) {
    const forged = clone(genuine);
    forged.iv[i] ^= 0x80;
    const out = await unseal(key, forged, U, C);
    assert.equal(out.ok, false, `IV byte ${i} must be authenticated`);
  }
});

/* ------------------------------------------------------------------ */
/* S13. Cross-user / cross-connection binding                          */
/* ------------------------------------------------------------------ */

test('S13: an envelope sealed for user A does not open for user B', async () => {
  // Mutation guard #5 (userId removed from AAD).
  const key = await generateSealingKey();
  const env = await seal(key, 'user-A', C, 0n, 5n, STATE);

  // Same key, different claimed owner: caught by the identifier check.
  const out = await unseal(key, env, 'user-B', C);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'USER_MISMATCH');

  // And with the header edited to match user B, so the identifier check
  // passes and only the AAD binding is left to catch it.
  const relabelled = clone(env);
  relabelled.userId = 'user-B';
  const out2 = await unseal(key, relabelled, 'user-B', C);
  assert.equal(out2.ok, false, 'userId must be bound into the AAD');
  assert.equal(out2.reason, 'UNSEAL_FAILED');
});

test('S14: an envelope sealed for connection 1 does not open for connection 2', async () => {
  // Mutation guard #6 (connectionId removed from AAD).
  const key = await generateSealingKey();
  const env = await seal(key, U, 'conn-1', 0n, 5n, STATE);

  const out = await unseal(key, env, U, 'conn-2');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'USER_MISMATCH');

  const relabelled = clone(env);
  relabelled.connectionId = 'conn-2';
  const out2 = await unseal(key, relabelled, U, 'conn-2');
  assert.equal(out2.ok, false, 'connectionId must be bound into the AAD');
  assert.equal(out2.reason, 'UNSEAL_FAILED');
});

test('S15: two users sharing a device cannot read each other envelopes', async () => {
  await reset();
  const a = freshUser();
  const b = freshUser();
  const keyA = await ensureSealingKey(a);
  const keyB = await ensureSealingKey(b);

  const envA = await seal(keyA, a, C, 0n, 1n, STATE);
  // Wrong key entirely: fails on the tag.
  const relabelled = clone(envA);
  relabelled.userId = b;
  const out = await unseal(keyB, relabelled, b, C);
  assert.equal(out.ok, false);
});

/* ------------------------------------------------------------------ */
/* S16. Header manipulation: version and epoch                         */
/* ------------------------------------------------------------------ */

test('S16: changing the envelope version is REJECTED', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 5n, STATE);

  const bumped = clone(genuine);
  bumped.version = SEALED_ENVELOPE_VERSION + 1;
  const out = await unseal(key, bumped, U, C);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CORRUPTED');
});

test('S17: changing the epoch is REJECTED', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 4n, 5n, STATE);

  for (const forgedEpoch of [0n, 3n, 5n, 999n]) {
    const forged = clone(genuine);
    forged.epoch = encodeRevision(forgedEpoch);
    const out = await unseal(key, forged, U, C);
    assert.equal(out.ok, false, `epoch ${forgedEpoch} must not verify`);
    assert.equal(out.reason, 'UNSEAL_FAILED');
  }
});

test('S18: a malformed epoch/revision width is REJECTED as corruption', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 5n, STATE);

  const shortRev = clone(genuine);
  shortRev.revision = new Uint8Array([0, 0, 5]);
  assert.equal((await unseal(key, shortRev, U, C)).reason, 'CORRUPTED');

  const longEpoch = clone(genuine);
  longEpoch.epoch = new Uint8Array(16);
  assert.equal((await unseal(key, longEpoch, U, C)).reason, 'CORRUPTED');
});

test('S19: structurally broken records are REJECTED without throwing', async () => {
  const key = await generateSealingKey();
  for (const bad of [
    null,
    undefined,
    42,
    'not-an-envelope',
    {},
    { version: 3, userId: U, connectionId: C },
    { version: 3, userId: U, connectionId: C, epoch: 0, revision: 1, iv: 'x', sealed: 'y' },
  ]) {
    assert.equal(isEnvelopeShaped(bad), false);
    const out = await unseal(key, bad, U, C);
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'CORRUPTED');
  }
});

test('S20: a truncated ciphertext shorter than the GCM tag is REJECTED', async () => {
  const key = await generateSealingKey();
  const genuine = await seal(key, U, C, 0n, 5n, STATE);
  const truncated = clone(genuine);
  truncated.sealed = genuine.sealed.slice(0, 8);
  const out = await unseal(key, truncated, U, C);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'CORRUPTED');
});

/* ------------------------------------------------------------------ */
/* S21. Wrong key / missing key                                        */
/* ------------------------------------------------------------------ */

test('S21: an envelope does not open under a different key', async () => {
  const keyA = await generateSealingKey();
  const keyB = await generateSealingKey();
  const env = await seal(keyA, U, C, 0n, 5n, STATE);
  const out = await unseal(keyB, env, U, C);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'UNSEAL_FAILED');
});

test('S22: deleting the sealing key makes it unavailable, not silently regenerated', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);
  assert.ok(await loadSealingKey(u));

  await deleteSealingKey(u);
  assert.equal(await loadSealingKey(u), null);
});

/* ------------------------------------------------------------------ */
/* S23. AAD construction                                               */
/* ------------------------------------------------------------------ */

test('S23: the AAD is injective over its inputs', async () => {
  const dec = (b) => new TextDecoder().decode(b);
  assert.equal(
    dec(buildAad('u', 'c', 0n, 1n)),
    `${AAD_PREFIX}|u|c|0000000000000000|0000000000000001`,
  );

  // Distinct inputs must never collide. The classic collision is a separator
  // that can appear inside an identifier: ("a|b","c") vs ("a","b|c").
  const seen = new Set();
  const inputs = [
    ['u1', 'c1', 0n, 1n],
    ['u1', 'c1', 0n, 2n],
    ['u1', 'c1', 1n, 1n],
    ['u1', 'c2', 0n, 1n],
    ['u2', 'c1', 0n, 1n],
    ['u11', 'c1', 0n, 1n],
    ['u1', 'c11', 0n, 1n],
  ];
  for (const [a, b, e, r] of inputs) {
    const s = dec(buildAad(a, b, e, r));
    assert.equal(seen.has(s), false, `AAD collision on ${s}`);
    seen.add(s);
  }
});

test('S24: identifiers containing the AAD separator are REJECTED', () => {
  assert.throws(() => buildAad('a|b', 'c', 0n, 1n), (e) => isCryptoError(e, 'CORRUPT_STATE'));
  assert.throws(() => buildAad('a', 'b|c', 0n, 1n), (e) => isCryptoError(e, 'CORRUPT_STATE'));
});

test('S25: a revision outside uint64 cannot be sealed', async () => {
  const key = await generateSealingKey();
  await assert.rejects(
    () => seal(key, U, C, 0n, 2n ** 64n, STATE),
    (e) => isCryptoError(e, 'REVISION_OVERFLOW'),
  );
});
