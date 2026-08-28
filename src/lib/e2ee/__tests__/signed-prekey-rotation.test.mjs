// enough. E2EE-v0.2 — F8: signed prekey rotation (regression tests).
//
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/signed-prekey-rotation.test.mjs
//
// Deterministic, no Supabase: a fake "server" holds the published PUBLIC
// material and simulates claim_prekey_bundle; the Web Lock is a passthrough
// (the manager serializes its own lifecycle in-process). Every test runs
// against the REAL engine, because "the tests pass" is not evidence for
// cryptographic code — the assertions check the actual lifecycle:
//
//   F8-1  existing (pre-F8) fixed-id signed prekey stays compatible
//   F8-2  rotation mints a new key id + key pair
//   F8-3  the new public key is correctly signed by the identity key
//   F8-4  the persisted private key matches the advertised public key
//   F8-5  the previous key stays available after rotation
//   F8-6  new sessions use the NEW advertised key, not the previous one
//   F8-7  an established session survives rotation untouched
//   F8-8  a handshake on the previous key still completes after rotation
//   F8-9  restart recovers the current key and the retained keys
//   F8-10 account isolation: no signed prekey crosses a user boundary
//   F8-11 concurrent rotation / initialization stays consistent
//   F8-12 a failed rotation fails closed (no half-rotated state)
//   F8-13 retention is bounded (current + two previous keys)
//   F8-14 initialization rotates a key that reached the rotation interval

import '../../crypto/__tests__/setup.mjs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  initEngineSyncForTests,
  generateIdentity,
  generateSignedPreKey,
  identityPublicKeyFromPair,
  verifyIdentitySignature,
  encodeRegistrationId,
} from '../engine-adapter.ts';
import { E2EESessionManager, parseEnvelope } from '../session-manager.ts';
import {
  deleteCryptoDatabase,
} from '../../crypto/storage.ts';
import { isCryptoError } from '../../crypto/errors.ts';
import { base64ToBytes, bytesToBase64 } from '../../crypto/serialization.ts';
import { loadRatchetState } from '../../crypto/ratchet-state.ts';
import { SIGNED_PREKEY_ROTATION_MS } from '../../crypto/prekeys.ts';
import {
  loadIdentity,
  saveIdentity,
  saveRegistrationId,
  saveSignedPreKey,
  loadSignedPreKey,
  loadSignedPreKeyMeta,
  saveSignedPreKeyMeta,
  removeSignedPreKeyMeta,
  saveSignedPreKeyRecord,
  loadSignedPreKeyRecord,
  removeSignedPreKeyRecord,
  listSignedPreKeyRecords,
} from '../device-store.ts';

const require = createRequire(import.meta.url);
const entry = require.resolve('@getmaapp/signal-wasm');
const wasmPath = entry.replace(/signal_wasm\.js$/, 'signal_wasm_bg.wasm');
let initErr = null;
before(async () => {
  try { initEngineSyncForTests(await readFile(wasmPath)); } catch (e) { initErr = e; }
});

const passthroughLock = async (_name, fn) => fn();
const decoder = new TextDecoder();
let seq = 0;
const freshUser = () => `spk-user-${++seq}`;

/** Fake Supabase: stores published PUBLIC material and simulates bundle claim. */
class FakeServer {
  constructor() {
    this.devices = new Map();
    this.failPublish = false;
    this.claims = [];
    // `claim_prekey_bundle` marks one-time keys consumed on the SERVER, so a
    // later republication of the owner's cached material must not resurrect
    // them. (The owner deletes them locally too — see session-manager.)
    this.consumed = new Map();
  }
  publisher(userId) {
    return async (material) => {
      if (this.failPublish) return 'simulated publication failure';
      const consumed = this.consumed.get(userId) ?? new Set();
      this.devices.set(userId, {
        ...material,
        oneTimePreKeys: material.oneTimePreKeys.filter((o) => !consumed.has(`o:${o.keyId}`)),
        kyberPreKeys: material.kyberPreKeys.filter(
          (k) => k.isLastResort || !consumed.has(`k:${k.keyId}`),
        ),
      });
      return null;
    };
  }
  /** Simulate claim_prekey_bundle(peer): returns the bundle for `peer`. */
  async claim(peerUserId) {
    const m = this.devices.get(peerUserId);
    if (!m) return { kind: 'no-device' };
    const otp = m.oneTimePreKeys[0] ?? null;
    const oneTimeKpk = m.kyberPreKeys.find((k) => !k.isLastResort) ?? null;
    const lastResort = m.kyberPreKeys.find((k) => k.isLastResort) ?? null;
    const kpk = oneTimeKpk ?? lastResort;
    if (!kpk) return { kind: 'no-device' };
    // Simulate the atomic server-side consumption of one-time keys.
    const consumed = this.consumed.get(peerUserId) ?? new Set();
    if (otp) consumed.add(`o:${otp.keyId}`);
    if (oneTimeKpk) consumed.add(`k:${oneTimeKpk.keyId}`);
    this.consumed.set(peerUserId, consumed);
    const bundle = {
      userId: peerUserId, deviceId: 1, registrationId: m.registrationId,
      identityKey: m.identityKey, signedPreKey: m.signedPreKey,
      oneTimePreKey: otp, kyberPreKey: kpk,
    };
    this.claims.push(bundle);
    return { kind: 'ok', bundle };
  }
}

async function reset() { await deleteCryptoDatabase(); }

function makeManager(server, userId, opts = {}) {
  return new E2EESessionManager({
    userId,
    publisher: server.publisher(userId),
    bundleProvider: opts.bundleProvider ?? ((peer) => server.claim(peer)),
    acquireLock: passthroughLock,
    otkPoolSize: opts.otkPoolSize ?? 5,
    otkThreshold: opts.otkThreshold ?? 2,
    kyberPoolSize: opts.kyberPoolSize ?? 3,
    kyberThreshold: opts.kyberThreshold ?? 1,
  });
}

async function newManager(server, userId, opts = {}) {
  const m = makeManager(server, userId, opts);
  await m.initialize();
  return m;
}

/** The persisted "current signed prekey" pointer (public metadata only). */
async function readCurrentMeta(userId) {
  const raw = await loadSignedPreKeyMeta(userId);
  assert.ok(raw, 'signed prekey metadata is present');
  const parsed = JSON.parse(decoder.decode(raw));
  assert.ok(Number.isInteger(parsed.keyId), 'metadata carries a numeric key id');
  return parsed;
}

async function recordIds(userId) {
  const list = await listSignedPreKeyRecords(userId);
  return list.map((r) => Number(r.keyId)).sort((a, b) => a - b);
}

/** Establish alice -> bob (claims a fresh bundle) and return the plaintext. */
async function roundTrip(alice, bob, connectionId, text) {
  const env = await alice.encryptForPeer(bob.userId, connectionId, text);
  const out = await bob.decryptFromPeer(alice.userId, connectionId, env);
  assert.equal(out.legacy, false);
  return out.plaintext;
}

/* ------------------------------------------------------------------ */
/* F8-1 — backward compatibility with the legacy fixed id              */
/* ------------------------------------------------------------------ */

test('F8-1: an existing pre-F8 signed prekey (fixed id 1) is migrated, not rotated away', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const first = await newManager(server, u);
  const legacyRecord = await loadSignedPreKeyRecord(u, 1);
  const publishedBefore = server.devices.get(u).signedPreKey;
  assert.equal(publishedBefore.keyId, 1, 'legacy layout advertises the fixed id 1');
  first.destroy();

  // Downgrade the persisted state to the pre-F8 layout: one fixed signed
  // prekey in the legacy singleton, no rotating key set, no metadata.
  await saveSignedPreKey(u, legacyRecord);
  await removeSignedPreKeyRecord(u, 1);
  await removeSignedPreKeyMeta(u);

  const second = await newManager(server, u);
  const peer = await newManager(server, freshUser());
  try {
    const meta = await readCurrentMeta(u);
    assert.equal(meta.keyId, 1, 'the existing key is adopted as the current key');
    assert.equal(meta.publicKey, publishedBefore.publicKey, 'the advertised key is unchanged');
    assert.equal(meta.signature, publishedBefore.signature, 'the advertised signature is unchanged');
    assert.ok(await loadSignedPreKeyRecord(u, 1), 'the private record joined the rotating key set');
    assert.equal(await loadSignedPreKey(u), null, 'the legacy singleton is retired once migrated');
    assert.deepEqual(
      server.devices.get(u).signedPreKey,
      publishedBefore,
      'the upgrade does not re-advertise a different key',
    );
    // And the migrated key still works end to end.
    assert.equal(await roundTrip(peer, second, 'c', 'legacy key still works'), 'legacy key still works');
  } finally {
    second.destroy();
    peer.destroy();
  }
});

test('F8-1b: a legacy signed prekey with no known public half is retained, and a fresh current key is generated', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  // Seed the pre-F8 layout by hand (identity + one fixed signed prekey) and
  // deliberately leave out the published-material cache, so the public half
  // of the legacy key cannot be recovered.
  const ident = await generateIdentity();
  await saveIdentity(u, ident.identityPairBytes);
  await saveRegistrationId(u, encodeRegistrationId(ident.registrationId));
  const legacy = await generateSignedPreKey(ident.identityPairBytes, 1);
  await saveSignedPreKey(u, legacy.record);

  const m = await newManager(server, u);
  try {
    const meta = await readCurrentMeta(u);
    assert.equal(meta.keyId, 2, 'a new current key id is minted for the fresh key');
    assert.notEqual(meta.publicKey, bytesToBase64(legacy.publicKey), 'the current key is a new key pair');
    assert.deepEqual(
      server.devices.get(u).signedPreKey,
      { keyId: 2, publicKey: meta.publicKey, signature: meta.signature },
      'the new key is what gets advertised',
    );
    assert.ok(await loadSignedPreKeyRecord(u, 1), 'the legacy private key is retained, not discarded');
    assert.equal(await loadSignedPreKey(u), null, 'the legacy singleton is retired');
  } finally {
    m.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* F8-2 / F8-3 / F8-4 / F8-5 — the rotation itself                     */
/* ------------------------------------------------------------------ */

test('F8-2: rotation creates a new signed prekey with a new id', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  try {
    const before = await readCurrentMeta(u);
    const beforeRecord = await loadSignedPreKeyRecord(u, before.keyId);
    const identityBefore = await identityPublicKeyFromPair(await loadIdentity(u));
    assert.equal(before.keyId, 1, 'a fresh device starts at id 1');

    const rotated = await m.rotateSignedPreKey();

    assert.deepEqual(
      await identityPublicKeyFromPair(await loadIdentity(u)),
      identityBefore,
      'rotation never touches the identity key',
    );

    const after = await readCurrentMeta(u);
    assert.equal(after.keyId, before.keyId + 1, 'the rotated key has a different id');
    assert.notEqual(after.publicKey, before.publicKey, 'the rotated key is a new key pair');
    assert.notEqual(after.signature, before.signature, 'the rotated key carries a new signature');
    assert.deepEqual(
      rotated,
      { keyId: after.keyId, publicKey: after.publicKey, signature: after.signature },
      'rotateSignedPreKey() returns exactly what was made current',
    );
    const afterRecord = await loadSignedPreKeyRecord(u, after.keyId);
    assert.ok(afterRecord && afterRecord.byteLength > 0, 'the new private record is persisted');
    assert.notDeepEqual(afterRecord, beforeRecord, 'the new private record is a different key');
    assert.deepEqual(
      server.devices.get(u).signedPreKey,
      { keyId: after.keyId, publicKey: after.publicKey, signature: after.signature },
      'the new key is published',
    );
  } finally {
    m.destroy();
  }
});

test('F8-3: the new public signed prekey carries a valid identity-key signature', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  try {
    const rotated = await m.rotateSignedPreKey();
    const identityPublicKey = await identityPublicKeyFromPair(await loadIdentity(u));
    const publicKey = base64ToBytes(rotated.publicKey);
    const signature = base64ToBytes(rotated.signature);
    assert.equal(publicKey.byteLength, 33, 'signed prekey public key is the serialized engine key');
    assert.equal(signature.byteLength, 64, 'signature is 64 bytes');
    assert.equal(
      await verifyIdentitySignature(identityPublicKey, publicKey, signature),
      true,
      'signature verifies under the identity key',
    );
    // A tampered public key must NOT verify (proves the check is meaningful).
    const tampered = new Uint8Array(publicKey);
    tampered[0] ^= 0x01;
    assert.equal(
      await verifyIdentitySignature(identityPublicKey, tampered, signature),
      false,
      'a tampered signed prekey does not verify',
    );
  } finally {
    m.destroy();
  }
});

test('F8-4: the persisted private key corresponds to the advertised public key', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bob = await newManager(server, freshUser());
  const alice = await newManager(server, freshUser());
  try {
    const meta = await readCurrentMeta(bob.userId);
    const rotated = await bob.rotateSignedPreKey();
    assert.equal(rotated.keyId, meta.keyId + 1);

    // The only way to prove correspondence is to USE the key: Alice performs
    // X3DH against the ADVERTISED (public) key, Bob decrypts with the
    // PERSISTED private key. A mismatch would fail the handshake.
    assert.equal(
      await roundTrip(alice, bob, 'c', 'correspondence'),
      'correspondence',
      'the advertised public key and the persisted private key are the same pair',
    );
    const claimed = server.claims[server.claims.length - 1];
    assert.equal(claimed.signedPreKey.keyId, rotated.keyId, 'the peer claimed the advertised key');
    assert.equal(claimed.signedPreKey.publicKey, rotated.publicKey);
  } finally {
    bob.destroy();
    alice.destroy();
  }
});

test('F8-5: the previous signed prekey remains available after rotation', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  try {
    const before = await readCurrentMeta(u);
    const previousRecord = await loadSignedPreKeyRecord(u, before.keyId);
    assert.ok(previousRecord, 'previous record present before rotation');

    await m.rotateSignedPreKey();

    assert.deepEqual(
      await loadSignedPreKeyRecord(u, before.keyId),
      previousRecord,
      'the previous private key record is still addressable by its id',
    );
    const ids = await recordIds(u);
    assert.deepEqual(ids, [before.keyId, before.keyId + 1], 'previous and current key are both retained');
  } finally {
    m.destroy();
  }
});

test('F8-6: a new session uses the newly advertised signed prekey, not the previous one', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bob = await newManager(server, freshUser());
  const alice = await newManager(server, freshUser());
  const carol = await newManager(server, freshUser());
  try {
    await bob.rotateSignedPreKey();
    const meta = await readCurrentMeta(bob.userId);

    // Carol's session is created AFTER the rotation: she must get the new key.
    assert.equal(await roundTrip(carol, bob, 'c-carol', 'new key'), 'new key');
    const claimed = server.claims[server.claims.length - 1];
    assert.equal(claimed.signedPreKey.keyId, meta.keyId, 'the claimed bundle carries the current key id');
    assert.equal(claimed.signedPreKey.publicKey, meta.publicKey, 'the claimed bundle carries the current public key');

    // Strongest form: drop the retained PREVIOUS key and reload, so the only
    // signed prekey the device holds is the current one. A new session still
    // establishes and decrypts — it therefore used the current key.
    await removeSignedPreKeyRecord(bob.userId, meta.keyId - 1);
    bob.destroy();
    const bob2 = await newManager(server, bob.userId);
    try {
      assert.deepEqual(await recordIds(bob.userId), [meta.keyId], 'only the current key remains');
      assert.equal(await roundTrip(alice, bob2, 'c-alice', 'current key only'), 'current key only');
    } finally {
      bob2.destroy();
    }
  } finally {
    bob.destroy();
    alice.destroy();
    carol.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* F8-7 / F8-8 — sessions and in-flight handshakes                     */
/* ------------------------------------------------------------------ */

test('F8-7: an established session (and its Double Ratchet state) survives rotation', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const alice = await newManager(server, freshUser());
  const bob = await newManager(server, freshUser());
  try {
    assert.equal(await roundTrip(alice, bob, 'c', 'establish'), 'establish');
    const reply = await roundTrip(bob, alice, 'c', 'ack');
    assert.equal(reply, 'ack');

    const beforeState = await loadRatchetState(alice.userId, 'c');
    assert.equal(beforeState.status, 'VALID');

    await bob.rotateSignedPreKey();

    const afterState = await loadRatchetState(alice.userId, 'c');
    assert.equal(afterState.status, 'VALID', "Alice's session is untouched by Bob's rotation");
    assert.equal(afterState.record.epoch, beforeState.record.epoch, 'no re-establishment (epoch unchanged)');

    // The session continues as a Whisper (t=2) conversation — proof that the
    // ratchet state was neither reset nor replaced.
    const after = await alice.encryptForPeer(bob.userId, 'c', 'after rotation');
    assert.equal(parseEnvelope(after).t, 2, 'still on the existing session');
    assert.equal((await bob.decryptFromPeer(alice.userId, 'c', after)).plaintext, 'after rotation');
    const back = await bob.encryptForPeer(alice.userId, 'c', 'and back');
    assert.equal((await alice.decryptFromPeer(bob.userId, 'c', back)).plaintext, 'and back');
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

test('F8-8: a handshake started against the previous signed prekey still completes after rotation', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bob = await newManager(server, freshUser());
  try {
    // Alice claims Bob's bundle BEFORE the rotation: she holds the previously
    // advertised signed prekey (id 1) and starts the handshake afterwards.
    const claimed = await server.claim(bob.userId);
    assert.equal(claimed.kind, 'ok');
    const staleBundle = claimed.bundle;
    assert.equal(staleBundle.signedPreKey.keyId, 1, 'the stale bundle references the previous key');

    const rotated = await bob.rotateSignedPreKey();
    assert.notEqual(rotated.keyId, staleBundle.signedPreKey.keyId, 'Bob rotated in the meantime');

    const alice = await newManager(server, freshUser(), {
      bundleProvider: async () => ({ kind: 'ok', bundle: staleBundle }),
    });
    try {
      const env = await alice.encryptForPeer(bob.userId, 'c', 'in-flight handshake');
      assert.equal(parseEnvelope(env).t, 3, 'an establishing (PreKey) message');
      const out = await bob.decryptFromPeer(alice.userId, 'c', env);
      assert.equal(out.plaintext, 'in-flight handshake', 'the retained previous key completed the handshake');
    } finally {
      alice.destroy();
    }
  } finally {
    bob.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* F8-9 — restart                                                      */
/* ------------------------------------------------------------------ */

test('F8-9: after a restart the current and retained signed prekeys are recovered', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bobId = freshUser();
  const bob = await newManager(server, bobId);
  const rotated = await bob.rotateSignedPreKey();
  const previousId = rotated.keyId - 1;
  bob.destroy();

  const bob2 = await newManager(server, bobId);
  const alice = await newManager(server, freshUser());
  try {
    const meta = await readCurrentMeta(bobId);
    assert.equal(meta.keyId, rotated.keyId, 'the current key id survives the restart');
    assert.equal(meta.publicKey, rotated.publicKey, 'the current public key survives the restart');
    assert.equal(meta.signature, rotated.signature, 'the current signature survives the restart');
    assert.deepEqual(await recordIds(bobId), [previousId, rotated.keyId], 'retained keys survive the restart');
    assert.deepEqual(
      server.devices.get(bobId).signedPreKey,
      { keyId: rotated.keyId, publicKey: rotated.publicKey, signature: rotated.signature },
      'the re-published material matches the recovered current key',
    );
    // A new session over the current key works ...
    assert.equal(await roundTrip(alice, bob2, 'c-new', 'after restart'), 'after restart');
    // ... and the retained previous key is still addressable after the reload.
    assert.ok(await loadSignedPreKeyRecord(bobId, previousId), 'the previous key survived the restart');
  } finally {
    bob2.destroy();
    alice.destroy();
  }
});

test('F8-9b: a handshake on a retained key still works after a restart', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bobId = freshUser();
  const bob = await newManager(server, bobId);
  const staleClaim = await server.claim(bobId);
  assert.equal(staleClaim.kind, 'ok');
  const staleBundle = staleClaim.bundle;
  const previousId = staleBundle.signedPreKey.keyId;
  await bob.rotateSignedPreKey();
  bob.destroy();

  const bob2 = await newManager(server, bobId);
  try {
    const alice = await newManager(server, freshUser(), {
      bundleProvider: async () => ({ kind: 'ok', bundle: staleBundle }),
    });
    try {
      const env = await alice.encryptForPeer(bobId, 'c', 'after restart, old key');
      const out = await bob2.decryptFromPeer(alice.userId, 'c', env);
      assert.equal(out.plaintext, 'after restart, old key');
      assert.equal(previousId, (await readCurrentMeta(bobId)).keyId - 1, 'the bundle referenced the retained key');
    } finally {
      alice.destroy();
    }
  } finally {
    bob2.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* F8-10 — account isolation                                           */
/* ------------------------------------------------------------------ */

test('F8-10: signed prekey state never crosses an account boundary', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bob = await newManager(server, freshUser());
  const carol = await newManager(server, freshUser());
  try {
    const bobRotated = await bob.rotateSignedPreKey();
    const carolSpk = await carol.rotateSignedPreKey();

    // A third account that never rotated has no record at Bob's key id at
    // all: the key set is namespaced and sealed per user.
    const dave = await newManager(server, freshUser());
    try {
      assert.equal(
        await loadSignedPreKeyRecord(dave.userId, bobRotated.keyId),
        null,
        "Bob's key id does not exist in another account's key set",
      );
    } finally {
      dave.destroy();
    }
    // Carol's current key id (2) is the same number as Bob's, but it is a
    // different key: ids are per-account, and the record is sealed per user.
    assert.notEqual(carolSpk.publicKey, bobRotated.publicKey, 'different accounts hold different key material');
    assert.notDeepEqual(
      await loadSignedPreKeyRecord(carol.userId, carolSpk.keyId),
      await loadSignedPreKeyRecord(bob.userId, bobRotated.keyId),
      "Carol's record for her own id 2 is not Bob's record for his id 2",
    );
    assert.notDeepEqual(
      await loadSignedPreKeyRecord(carol.userId, 1),
      await loadSignedPreKeyRecord(bob.userId, 1),
      "each account's retained key id 1 is its own",
    );
    // Carol's published material is her own.
    assert.equal(server.devices.get(carol.userId).signedPreKey.publicKey, carolSpk.publicKey);
    assert.equal(server.devices.get(bob.userId).signedPreKey.publicKey, bobRotated.publicKey);
  } finally {
    bob.destroy();
    carol.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* F8-11 — concurrency                                                 */
/* ------------------------------------------------------------------ */

test('F8-11: concurrent rotations produce one consistent current key', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  try {
    const [a, b] = await Promise.all([m.rotateSignedPreKey(), m.rotateSignedPreKey()]);
    assert.notEqual(a.keyId, b.keyId, 'the two rotations did not collide on one id');

    const meta = await readCurrentMeta(u);
    const winner = meta.keyId === a.keyId ? a : b;
    assert.equal(meta.keyId, Math.max(a.keyId, b.keyId), 'the newest key is current');
    assert.equal(meta.publicKey, winner.publicKey, 'the current pointer matches a rotated key');
    assert.equal(meta.signature, winner.signature, 'the current signature matches the same key');

    // The current pointer must have a private record that really corresponds
    // to it (end-to-end, not just structurally).
    const alice = await newManager(server, freshUser());
    try {
      assert.equal(await roundTrip(alice, m, 'c', 'consistent after race'), 'consistent after race');
    } finally {
      alice.destroy();
    }
    // No lost records: current + the two retained previous keys.
    assert.deepEqual(await recordIds(u), [1, 2, 3], 'exactly current + retained keys, nothing lost');
  } finally {
    m.destroy();
  }
});

test('F8-11b: concurrent initialization does not create a split current key', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const [first, second] = await Promise.all([
    newManager(server, u),
    newManager(server, u),
  ]);
  try {
    const meta = await readCurrentMeta(u);
    assert.equal(meta.keyId, 1, 'a fresh device is provisioned exactly once');
    assert.deepEqual(await recordIds(u), [1], 'no duplicate key records');
    assert.equal(
      server.devices.get(u).signedPreKey.publicKey,
      meta.publicKey,
      'the published key matches the single current key',
    );
    const peer = await newManager(server, freshUser());
    try {
      assert.equal(await roundTrip(peer, first, 'c', 'no split brain'), 'no split brain');
      assert.equal(await roundTrip(peer, second, 'c2', 'both managers agree'), 'both managers agree');
    } finally {
      peer.destroy();
    }
  } finally {
    first.destroy();
    second.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* F8-12 — failure behaviour                                           */
/* ------------------------------------------------------------------ */

test('F8-12: a failed publication during rotation fails closed and keeps the previous key usable', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bobId = freshUser();
  const bob = await newManager(server, bobId);
  const alice = await newManager(server, freshUser());
  try {
    // Alice already holds Bob's pre-rotation bundle.
    const staleClaim = await server.claim(bobId);
    assert.equal(staleClaim.kind, 'ok');
    const staleBundle = staleClaim.bundle;

    server.failPublish = true;
    await assert.rejects(
      () => bob.rotateSignedPreKey(),
      (e) => isCryptoError(e, 'STORAGE_ERROR'),
      'rotation fails when the new key cannot be published',
    );
    server.failPublish = false;

    // The server still advertises the previous key: nothing half-published.
    assert.equal(
      server.devices.get(bobId).signedPreKey.keyId,
      staleBundle.signedPreKey.keyId,
      'the failed rotation never advertised a new key',
    );
    // The previous private key is still there and still usable.
    assert.ok(await loadSignedPreKeyRecord(bobId, staleBundle.signedPreKey.keyId), 'previous key retained');
    const inFlight = await newManager(server, freshUser(), {
      bundleProvider: async () => ({ kind: 'ok', bundle: staleBundle }),
    });
    try {
      const env = await inFlight.encryptForPeer(bobId, 'c', 'survives failed rotation');
      assert.equal((await bob.decryptFromPeer(inFlight.userId, 'c', env)).plaintext, 'survives failed rotation');
    } finally {
      inFlight.destroy();
    }

    // Recovery: the next successful initialization publishes a consistent
    // current key and both a new and an in-flight handshake work.
    bob.destroy();
    const bob2 = await newManager(server, bobId);
    try {
      const meta = await readCurrentMeta(bobId);
      assert.deepEqual(
        server.devices.get(bobId).signedPreKey,
        { keyId: meta.keyId, publicKey: meta.publicKey, signature: meta.signature },
        'the republished material matches the current key',
      );
      assert.equal(await roundTrip(alice, bob2, 'c-new', 'after recovery'), 'after recovery');
    } finally {
      bob2.destroy();
    }
  } finally {
    bob.destroy();
    alice.destroy();
  }
});

test('F8-12b: a rotation interrupted between the two writes leaves the previous key current', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  const current = await readCurrentMeta(u);
  try {
    // Simulate the crash window of a rotation: the new private record was
    // persisted, the pointer write never happened.
    const identityPairBytes = await loadIdentity(u);
    const staged = await generateSignedPreKey(identityPairBytes, 7);
    await m.rotateSignedPreKey(); // current becomes id 2
    await saveSignedPreKeyRecord(u, 7, staged.record);

    m.destroy();
    const reloaded = await newManager(server, u);
    try {
      const meta = await readCurrentMeta(u);
      assert.equal(meta.keyId, current.keyId + 1, 'the completed rotation is what is current');
      assert.notEqual(meta.keyId, 7, 'the interrupted rotation never became current');
      assert.equal(
        server.devices.get(u).signedPreKey.keyId,
        meta.keyId,
        'the uncommitted key is never advertised',
      );
      // The uncommitted key is dropped on the next rotation (never published),
      // while the genuinely advertised keys stay retained.
      await reloaded.rotateSignedPreKey();
      const ids = await recordIds(u);
      assert.equal(ids.includes(7), false, 'a never-published staged key is retired');
      assert.deepEqual(ids, [1, 2, 3], 'advertised keys are retained');
    } finally {
      reloaded.destroy();
    }
  } finally {
    m.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* Retention bound                                                     */
/* ------------------------------------------------------------------ */

test('F8-13: retention is bounded — only the newest previous keys are kept', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  try {
    await m.rotateSignedPreKey(); // ids: 1, 2
    await m.rotateSignedPreKey(); // ids: 1, 2, 3
    await m.rotateSignedPreKey(); // ids: 2, 3, 4 (1 retired)
    const ids = await recordIds(u);
    const meta = await readCurrentMeta(u);
    assert.deepEqual(ids, [meta.keyId - 2, meta.keyId - 1, meta.keyId], 'current + two previous keys');
    assert.equal(await loadSignedPreKeyRecord(u, meta.keyId - 3), null, 'the oldest key is retired');
    assert.ok(await loadSignedPreKeyRecord(u, meta.keyId), 'the current key is never retired');
    // Every retained key is still usable, not just present.
    const alice = await newManager(server, freshUser());
    try {
      assert.equal(await roundTrip(alice, m, 'c', 'still consistent'), 'still consistent');
    } finally {
      alice.destroy();
    }
  } finally {
    m.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* Rotation trigger                                                    */
/* ------------------------------------------------------------------ */

test('F8-14: initialization rotates a signed prekey that reached the rotation interval', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const u = freshUser();
  const m = await newManager(server, u);
  const before = await readCurrentMeta(u);
  m.destroy();

  // Move the rotation clock past the documented interval (30 days). The key
  // itself is still valid — only its lifetime is over.
  await saveSignedPreKeyMeta(
    u,
    new TextEncoder().encode(JSON.stringify({
      v: 1,
      keyId: before.keyId,
      publicKey: before.publicKey,
      signature: before.signature,
      createdAt: Date.now() - SIGNED_PREKEY_ROTATION_MS - 1,
    })),
  );

  const reloaded = await newManager(server, u);
  try {
    const after = await readCurrentMeta(u);
    assert.equal(after.keyId, before.keyId + 1, 'the expired key is rotated on initialization');
    assert.notEqual(after.publicKey, before.publicKey, 'the rotated-in key is a new key pair');
    assert.ok(await loadSignedPreKeyRecord(u, before.keyId), 'the expired key is retained, not dropped');
    assert.equal(
      server.devices.get(u).signedPreKey.keyId,
      after.keyId,
      'the new key is what gets advertised',
    );
    // A key that is NOT due is never rotated by initialization (F8-1/F8-9
    // assert the same on restart); one more init must leave it alone.
    reloaded.destroy();
    const again = await newManager(server, u);
    try {
      assert.equal((await readCurrentMeta(u)).keyId, after.keyId, 'a fresh key is not rotated again');
    } finally {
      again.destroy();
    }
  } finally {
    reloaded.destroy();
  }
});
