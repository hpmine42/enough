// enough. E2EE-v0.2 — identity reset / recovery tests (audit C2).
//
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/identity-recovery.test.mjs
//
// Deterministic, no Supabase: a fake "server" holds published public material
// and simulates claim_prekey_bundle; the Web Lock is a passthrough. Real
// engine (@getmaapp/signal-wasm), real sealed IndexedDB (fake-indexeddb).
//
// Naming: IR1..IR15 follow the C2 implementation plan. IR15 is the
// investigative test and runs first in file order: it documents what the
// engine ACTUALLY does when a PreKey message from a reset peer arrives on an
// existing VALID session. The receive-side recovery UX is derived from its
// result — no speculation.

import '../../crypto/__tests__/setup.mjs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { initEngineSyncForTests } from '../engine-adapter.ts';
import { E2EESessionManager, parseEnvelope } from '../session-manager.ts';
import { deleteCryptoDatabase, getState, putState } from '../../crypto/storage.ts';
import { isCryptoError } from '../../crypto/errors.ts';
import {
  deleteAllDeviceRecords,
  removePeerTrust,
  loadPeerTrust,
  loadIdentity,
  loadRegistrationId,
  loadSignedPreKeyMeta,
  listSignedPreKeyRecords,
  listOneTimePreKeys,
  listKyberPreKeys,
  loadKyberLastResort,
  loadKyberUsage,
  loadPublishedMaterial,
  listDeviceKeyed,
} from '../device-store.ts';
import {
  loadRatchetState,
  deleteUserRatchetState,
  deleteRatchetSession,
} from '../../crypto/ratchet-state.ts';
import { loadSealingKey } from '../../crypto/sealed-state.ts';
import { RECORD_MESSAGE_CACHE } from '../../crypto/types.ts';
import {
  cachePlaintext,
  getCachedPlaintext,
  _resetMessageCacheForTests,
} from '../message-cache.ts';
import { saveChatSnapshot, loadChatSnapshot } from '../../offlineStore.ts';
import { prepareSend } from '../message-flow.ts';
import { identityPublicKeyFromPair } from '../engine-adapter.ts';
import { bytesToBase64 } from '../../crypto/serialization.ts';

const require = createRequire(import.meta.url);
const entry = require.resolve('@getmaapp/signal-wasm');
const wasmPath = entry.replace(/signal_wasm\.js$/, 'signal_wasm_bg.wasm');
let initErr = null;
before(async () => {
  try { initEngineSyncForTests(await readFile(wasmPath)); } catch (e) { initErr = e; }
});

const passthroughLock = async (_name, fn) => fn();
let seq = 0;
const freshUser = () => `ir-user-${++seq}`;

/** Fake Supabase: stores published PUBLIC material and simulates bundle claim. */
class FakeServer {
  constructor() { this.devices = new Map(); }
  publisher(userId) {
    return async (material) => { this.devices.set(userId, material); return null; };
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
    if (otp) m.oneTimePreKeys = m.oneTimePreKeys.filter((o) => o.keyId !== otp.keyId);
    if (oneTimeKpk) m.kyberPreKeys = m.kyberPreKeys.filter((k) => k.keyId !== oneTimeKpk.keyId);
    return {
      kind: 'ok',
      bundle: {
        userId: peerUserId, deviceId: 1, registrationId: m.registrationId,
        identityKey: m.identityKey, signedPreKey: m.signedPreKey,
        oneTimePreKey: otp, kyberPreKey: kpk,
      },
    };
  }
}

async function reset() { await deleteCryptoDatabase(); }

async function newManager(server, userId, opts = {}) {
  const m = new E2EESessionManager({
    userId,
    publisher: server.publisher(userId),
    bundleProvider: (peer) => server.claim(peer),
    acquireLock: passthroughLock,
    otkPoolSize: opts.otkPoolSize ?? 5,
    otkThreshold: opts.otkThreshold ?? 2,
    kyberPoolSize: opts.kyberPoolSize ?? 3,
    kyberThreshold: opts.kyberThreshold ?? 1,
  });
  await m.initialize();
  return m;
}

/* ------------------------------------------------------------------ */
/* IR15 (investigative, runs first): PreKey from a reset peer arrives   */
/* on an existing VALID session. Documents real engine behavior.       */
/*                                                                     */
/* FINDINGS (verified against @getmaapp/signal-wasm, no speculation):  */
/*  1. Receiving a PreKey message from a RESET peer while holding the  */
/*     old VALID session throws a RAW engine error — a plain `Error`   */
/*     (`\"SignalError: Operation failed\"`, engine-internal            */
/*     `.code === 'UntrustedIdentity'`), NOT a CryptoError. The local  */
/*     session is untouched (still VALID, same revision): fail-closed  */
/*     at the state level, and the message is permanently               */
/*     undecryptable. Because the error is unclassifiable through      */
/*     CryptoError codes, receive-side recovery MUST be offered        */
/*     manually (chat menu entry) — C2 must not sniff engine-internal  */
/*     `.code` strings for UX branching.                               */
/*  2. A freshly reset device receiving an old-session Whisper BEFORE  */
/*     establishing fails with a classifiable `CryptoError`            */
/*     `NEEDS_ESTABLISH` (no session is invented).                     */
/*  3. Peer recovery MUST include engine re-hydration: the engine's    */
/*     in-memory identity store has no per-peer eviction API, so      */
/*     without re-hydration the fresh establishment fails with the    */
/*     same raw `UntrustedIdentity` error (observed). With             */
/*     trust + session deletion + re-hydration, re-establishment      */
/*     succeeds.                                                       */
/*  4. One-sided recovery converges: after the non-reset side          */
/*     recovers and sends a PreKey, the reset side (holding its own   */
/*     fresh sender session) decrypts it successfully — the embedded  */
/*     identity matches, so the engine replaces the session. No       */
/*     ping-pong, no reset needed on the reset side.                   */
/* ------------------------------------------------------------------ */

test('IR15: peer resets identity, then sends a PreKey message on the same connection while we hold the old VALID session', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);

  // Establish + round trip so BOTH sessions are VALID and advanced.
  const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
  await bob.decryptFromPeer(aId, 'c', e1);
  const reply = await bob.encryptForPeer(aId, 'c', 'ack');
  await alice.decryptFromPeer(bId, 'c', reply);

  const aliceBefore = await loadRatchetState(aId, 'c');
  assert.equal(aliceBefore.status, 'VALID', 'alice holds a VALID session before the peer reset');
  const bobIdentityBefore = server.devices.get(bId).identityKey;

  // Bob wipes his device (new browser / cleared storage): all local device
  // state and sessions are gone. Re-initializing the same user id mints a
  // fresh identity and republishes it.
  bob.destroy();
  await deleteAllDeviceRecords(bId);
  await deleteUserRatchetState(bId);
  const bob2 = await newManager(server, bId);
  const bobIdentityAfter = server.devices.get(bId).identityKey;
  assert.notEqual(bobIdentityAfter, bobIdentityBefore, 'bob now has a NEW published identity');

  // Bob sends first on the same connection: he has no session, so he
  // establishes a fresh sender session against alice's UNCHANGED identity.
  const prekeyFromResetBob = await bob2.encryptForPeer(aId, 'c', 'hello from reset bob');
  assert.equal(parseEnvelope(prekeyFromResetBob).t, 3, 'first post-reset message is a PreKey envelope');

  // FINDING 1: alice's decrypt throws a RAW engine error (not a CryptoError)
  // and her session is untouched.
  await assert.rejects(
    () => alice.decryptFromPeer(bId, 'c', prekeyFromResetBob),
    (e) => {
      assert.ok(e instanceof Error, 'a real error is thrown');
      assert.equal(isCryptoError(e), false, 'the engine identity failure is NOT a classifiable CryptoError');
      return true;
    },
    'PreKey from a reset peer on an old VALID session must fail (fail-closed)',
  );
  const aliceAfter = await loadRatchetState(aId, 'c');
  assert.equal(aliceAfter.status, 'VALID', 'the failed decrypt leaves the old session VALID');
  assert.equal(
    aliceAfter.record?.revision, aliceBefore.record?.revision,
    'the failed decrypt does not advance the old session',
  );

  // FINDING 4: one-sided recovery converges. Alice recovers (trust + session
  // deletion + engine re-hydration — destroy/re-init is the primitive-level
  // stand-in for what resetPeerSecurityState does internally) and sends; the
  // reset side decrypts her PreKey even though it holds its own fresh sender
  // session, because the embedded identity matches.
  await removePeerTrust(aId, bId);
  await deleteUserRatchetState(aId);
  alice.destroy();
  const aliceRecovered = await newManager(server, aId);
  try {
    const m2 = await aliceRecovered.encryptForPeer(bId, 'c', 'alice after recovery');
    assert.equal(parseEnvelope(m2).t, 3, 'recovered alice establishes fresh (PreKey)');
    assert.equal(
      (await bob2.decryptFromPeer(aId, 'c', m2)).plaintext,
      'alice after recovery',
      'the reset side accepts the recovery PreKey — one-sided recovery converges',
    );
    const m3 = await bob2.encryptForPeer(aId, 'c', 'bob replies');
    assert.equal(
      (await aliceRecovered.decryptFromPeer(bId, 'c', m3)).plaintext,
      'bob replies',
      'the conversation continues bidirectionally after one-sided recovery',
    );
  } finally {
    aliceRecovered.destroy();
    bob2.destroy();
  }
});

test('IR15b: a freshly reset device receiving an old-session Whisper before establishing fails with NEEDS_ESTABLISH', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
    await bob.decryptFromPeer(aId, 'c', e1);
    const r1 = await bob.encryptForPeer(aId, 'c', 'ack');
    await alice.decryptFromPeer(bId, 'c', r1);
    const whisper = await alice.encryptForPeer(bId, 'c', 'whisper msg');
    assert.equal(parseEnvelope(whisper).t, 2, 'established conversation uses Whisper messages');
    // Bob resets and has NOT established yet (no session at all).
    bob.destroy();
    await deleteAllDeviceRecords(bId);
    await deleteUserRatchetState(bId);
    const bobFresh = await newManager(server, bId);
    try {
      // FINDING 2: classifiable NEEDS_ESTABLISH — no session is invented.
      await assert.rejects(
        () => bobFresh.decryptFromPeer(aId, 'c', whisper),
        (e) => isCryptoError(e, 'NEEDS_ESTABLISH'),
        'Whisper with no session must fail closed with NEEDS_ESTABLISH',
      );
    } finally {
      bobFresh.destroy();
    }
  } finally {
    alice.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* Inventory helpers: byte-exact before/after comparison of local state */
/* ------------------------------------------------------------------ */

const b64 = (u8) => Buffer.from(u8).toString('base64');

/** Unsealed device records of a user (byte-exact, comparable). */
async function deviceInventory(userId) {
  const ident = await loadIdentity(userId);
  const reg = await loadRegistrationId(userId);
  const spkMeta = await loadSignedPreKeyMeta(userId);
  const spks = await listSignedPreKeyRecords(userId);
  const otps = await listOneTimePreKeys(userId);
  const kpks = await listKyberPreKeys(userId);
  const lr = await loadKyberLastResort(userId);
  const usage = await loadKyberUsage(userId);
  const pub = await loadPublishedMaterial(userId);
  const trusts = await listDeviceKeyed(userId, 'peer-trust');
  return {
    identity: ident ? b64(ident) : null,
    registrationId: reg ? b64(reg) : null,
    spkMeta: spkMeta ? b64(spkMeta) : null,
    spks: spks.map((r) => [r.keyId, b64(r.body)]).sort(),
    otps: otps.map((r) => [r.keyId, b64(r.body)]).sort(),
    kpks: kpks.map((r) => [r.keyId, b64(r.body)]).sort(),
    lastResort: lr ? b64(lr) : null,
    kyberUsage: usage ? b64(usage) : null,
    published: pub ? b64(pub) : null,
    trusts: trusts.map((r) => [r.keyId, b64(r.body)]).sort(),
  };
}

/** Ratchet session slot of one (user, connection), byte-exact. */
async function sessionSnapshot(userId, connectionId) {
  const loaded = await loadRatchetState(userId, connectionId);
  return {
    status: loaded.status,
    epoch: String(loaded.record?.epoch ?? loaded.watermark.epoch),
    revision: String(loaded.record?.revision ?? loaded.watermark.revision),
    state: loaded.record ? b64(loaded.record.state) : null,
  };
}

function decodeTrustRecord(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ------------------------------------------------------------------ */
/* IR1: normal E2EE start is unchanged                                  */
/* ------------------------------------------------------------------ */

test('IR1: normal E2EE start is unchanged — fresh init, bidirectional chat, reload continuity', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'hello');
    assert.equal(parseEnvelope(e1).t, 3, 'first message establishes (PreKey)');
    assert.equal((await bob.decryptFromPeer(aId, 'c', e1)).plaintext, 'hello');
    const e2 = await bob.encryptForPeer(aId, 'c', 'hi back');
    assert.equal((await alice.decryptFromPeer(bId, 'c', e2)).plaintext, 'hi back');
    assert.equal(await alice.peerTrustState(bId), 'unverified', 'first contact records fresh TOFU');
  } finally {
    alice.destroy();
    bob.destroy();
  }
  const alice2 = await newManager(server, aId);
  const bob2 = await newManager(server, bId);
  try {
    const e3 = await alice2.encryptForPeer(bId, 'c', 'after reload');
    assert.equal(parseEnvelope(e3).t, 2, 'reloaded session continues as Whisper');
    assert.equal((await bob2.decryptFromPeer(aId, 'c', e3)).plaintext, 'after reload');
    assert.equal(await alice2.peerTrustState(bId), 'unverified', 'TOFU survives reload unchanged');
  } finally {
    alice2.destroy();
    bob2.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR2: USER_MISMATCH is detected; the check stays strict; P4 marks it */
/* ------------------------------------------------------------------ */

test('IR2: a changed peer identity key is rejected, stays rejected, and is persistently marked identity_changed', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    await alice.encryptForPeer(bId, 'c1', 'first');
    const originalKey = decodeTrustRecord(await loadPeerTrust(aId, bId)).identityKey;
    assert.equal(await alice.peerTrustState(bId), 'unverified');
    // The peer reinstalls: a new identity key is published for the same user.
    const m = server.devices.get(bId);
    const newKey = 'AA' + m.identityKey.slice(2);
    assert.notEqual(newKey, originalKey);
    server.devices.set(bId, { ...m, identityKey: newKey });
    // A new connection must refuse the changed key.
    await assert.rejects(
      () => alice.encryptForPeer(bId, 'c2', 'second'),
      (e) => isCryptoError(e, 'USER_MISMATCH'),
      'changed peer identity must raise USER_MISMATCH',
    );
    // P4: the mismatch is persistently marked — old key kept, new key NOT stored.
    assert.equal(await alice.peerTrustState(bId), 'identity_changed');
    const marked = decodeTrustRecord(await loadPeerTrust(aId, bId));
    assert.equal(marked.identityKey, originalKey, 'the old key is kept, never overwritten');
    assert.equal(marked.state, 'identity_changed');
    // Strictness: retrying without a reset fails identically (no silent re-TOFU).
    await assert.rejects(
      () => alice.encryptForPeer(bId, 'c2', 'second again'),
      (e) => isCryptoError(e, 'USER_MISMATCH'),
      'a second attempt must fail identically — no automatic re-TOFU',
    );
    assert.equal(
      decodeTrustRecord(await loadPeerTrust(aId, bId)).identityKey,
      originalKey,
      'repeated failures never store the new key',
    );
    // Unknown peers and malformed input read as null, never throw.
    assert.equal(await alice.peerTrustState('nobody'), null);
    assert.equal(await alice.peerTrustState(''), null);
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR3: no plaintext is ever sent on the failure/recovery paths        */
/* ------------------------------------------------------------------ */

test('IR3: failure and recovery paths never emit plaintext and leave no half session behind', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    await alice.encryptForPeer(bId, 'c1', 'first');
    // Tamper with the peer identity: the next establishment on a new
    // connection rejects — and resolves nothing (certainly no plaintext).
    const m = server.devices.get(bId);
    server.devices.set(bId, { ...m, identityKey: 'AA' + m.identityKey.slice(2) });
    await assert.rejects(
      () => prepareSend({ e2ee: alice, isSelf: false, peerUserId: bId, connectionId: 'c2', plaintext: 'secret' }),
      (e) => isCryptoError(e, 'USER_MISMATCH'),
      'prepareSend propagates the TOFU rejection and resolves nothing',
    );
    assert.equal((await loadRatchetState(aId, 'c2')).status, 'MISSING', 'failed establishment creates no session');
    // Without a manager the transport boundary fails closed (C1 pin).
    await assert.rejects(
      () => prepareSend({ e2ee: null, isSelf: false, peerUserId: bId, connectionId: 'c2', plaintext: 'secret' }),
      (e) => isCryptoError(e, 'NOT_AVAILABLE'),
    );
    // After a peer reset, a failing establishment leaves no trust and no
    // session behind either (no half-TOFU for an unreachable peer).
    const daveId = freshUser(); // never published, never contacted
    await alice.resetPeerSecurityState(daveId, []);
    await assert.rejects(
      () => alice.encryptForPeer(daveId, 'cX', 'hello?'),
      (e) => isCryptoError(e, 'NEEDS_ESTABLISH'),
    );
    assert.equal(await loadPeerTrust(aId, daveId), null, 'no trust record for a failed establishment');
    assert.equal((await loadRatchetState(aId, 'cX')).status, 'MISSING');
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR4: reset deletes only the intended local state (scope inventory)  */
/* ------------------------------------------------------------------ */

test('IR4: peer reset deletes exactly one trust record plus the named sessions — everything else is byte-identical', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const cId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  const carol = await newManager(server, cId);
  try {
    // Three live conversations across three users.
    const ab1 = await alice.encryptForPeer(bId, 'cAB', 'a->b');
    await bob.decryptFromPeer(aId, 'cAB', ab1);
    const ac1 = await alice.encryptForPeer(cId, 'cAC', 'a->c');
    await carol.decryptFromPeer(aId, 'cAC', ac1);
    const bc1 = await bob.encryptForPeer(cId, 'cBC', 'b->c');
    await carol.decryptFromPeer(bId, 'cBC', bc1);
    // Local-only state that a peer reset must preserve.
    await cachePlaintext(aId, 'm-alice-1', 'alice readable history');
    await saveChatSnapshot(aId, 'cAB', {
      connection: { id: 'cAB' },
      peer: null,
      messages: [],
      hiddenUntil: null,
      deletedForMe: [],
    });
    assert.ok(await loadSealingKey(aId), 'precondition: sealing key exists');

    const aliceBefore = await deviceInventory(aId);
    const bobBefore = await deviceInventory(bId);
    const carolBefore = await deviceInventory(cId);
    const sessionsBefore = {
      aAB: await sessionSnapshot(aId, 'cAB'),
      aAC: await sessionSnapshot(aId, 'cAC'),
      bAB: await sessionSnapshot(bId, 'cAB'),
      bBC: await sessionSnapshot(bId, 'cBC'),
      cAC: await sessionSnapshot(cId, 'cAC'),
      cBC: await sessionSnapshot(cId, 'cBC'),
    };
    assert.equal(sessionsBefore.aAB.status, 'VALID');

    // The recovery under test: alice resets bob on their conversation.
    await alice.resetPeerSecurityState(bId, ['cAB']);

    // Exactly the intended deletions on alice's side...
    assert.equal(await loadPeerTrust(aId, bId), null, 'the peer trust record is gone');
    assert.equal(await alice.peerTrustState(bId), null);
    const aABAfter = await sessionSnapshot(aId, 'cAB');
    assert.equal(aABAfter.status, 'MISSING', 'record AND watermark are gone (not WEDGED/ROLLBACK)');
    assert.equal(aABAfter.epoch, '0');
    assert.equal(aABAfter.revision, '0');
    // ...and nothing else changed for alice.
    const aliceAfter = await deviceInventory(aId);
    assert.deepEqual(
      { ...aliceAfter, trusts: aliceAfter.trusts.filter(([id]) => id !== bId) },
      { ...aliceBefore, trusts: aliceBefore.trusts.filter(([id]) => id !== bId) },
      'own identity, SPKs, pools, published cache and carol trust are byte-identical',
    );
    assert.deepEqual(await sessionSnapshot(aId, 'cAC'), sessionsBefore.aAC, 'the carol session is untouched');
    assert.equal(await getCachedPlaintext(aId, 'm-alice-1'), 'alice readable history', 'message cache survives');
    assert.ok(await getState(aId, RECORD_MESSAGE_CACHE), 'sealed cache record survives');
    assert.ok(await loadSealingKey(aId), 'sealing key survives');
    assert.ok(await loadChatSnapshot(aId, 'cAB'), 'offline snapshot survives');
    // Other users are completely untouched.
    assert.deepEqual(await deviceInventory(bId), bobBefore, 'bob device state untouched');
    assert.deepEqual(await deviceInventory(cId), carolBefore, 'carol device state untouched');
    assert.deepEqual(await sessionSnapshot(bId, 'cAB'), sessionsBefore.bAB, 'bob session untouched');
    assert.deepEqual(await sessionSnapshot(bId, 'cBC'), sessionsBefore.bBC);
    assert.deepEqual(await sessionSnapshot(cId, 'cAC'), sessionsBefore.cAC);
    assert.deepEqual(await sessionSnapshot(cId, 'cBC'), sessionsBefore.cBC);

    // Idempotency: resetting again succeeds and changes nothing further.
    await alice.resetPeerSecurityState(bId, ['cAB']);
    assert.equal((await loadRatchetState(aId, 'cAB')).status, 'MISSING');
    assert.equal(await loadPeerTrust(aId, bId), null);

    // The device re-hydration inside the reset did not break other sessions.
    const ac2 = await alice.encryptForPeer(cId, 'cAC', 'still works');
    assert.equal((await carol.decryptFromPeer(aId, 'cAC', ac2)).plaintext, 'still works');
  } finally {
    alice.destroy();
    bob.destroy();
    carol.destroy();
  }
});

test('IR4b: deleteRatchetSession removes record plus watermark for exactly one pair and is idempotent', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const dId = freshUser();
  const eId = freshUser();
  const dave = await newManager(server, dId);
  const eve = await newManager(server, eId);
  try {
    const x1 = await dave.encryptForPeer(eId, 'cX', 'x');
    await eve.decryptFromPeer(dId, 'cX', x1);
    const y1 = await dave.encryptForPeer(eId, 'cY', 'y');
    await eve.decryptFromPeer(dId, 'cY', y1);
    const eveXBefore = await sessionSnapshot(eId, 'cX');
    const daveYBefore = await sessionSnapshot(dId, 'cY');
    await deleteRatchetSession(dId, 'cX');
    assert.equal((await loadRatchetState(dId, 'cX')).status, 'MISSING');
    assert.deepEqual(await sessionSnapshot(dId, 'cY'), daveYBefore, 'sibling session untouched');
    assert.deepEqual(await sessionSnapshot(eId, 'cX'), eveXBefore, 'peer session untouched');
    // Idempotent and forgiving: repeat + empty ids are no-ops, never throws.
    await deleteRatchetSession(dId, 'cX');
    await deleteRatchetSession(dId, '');
    await deleteRatchetSession('', 'cX');
    assert.equal((await loadRatchetState(dId, 'cX')).status, 'MISSING');
    // The slot is usable again through the normal establishment path.
    const x2 = await dave.encryptForPeer(eId, 'cX', 'x again');
    assert.equal(parseEnvelope(x2).t, 3, 're-establishment after targeted delete uses PreKey');
    assert.equal((await eve.decryptFromPeer(dId, 'cX', x2)).plaintext, 'x again');
  } finally {
    dave.destroy();
    eve.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR5: after a reset the new identity initializes correctly           */
/* ------------------------------------------------------------------ */

test('IR5: peer recovery converges — fresh establishment, fresh TOFU, bidirectional chat', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  let alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
    await bob.decryptFromPeer(aId, 'c', e1);
    const r1 = await bob.encryptForPeer(aId, 'c', 'ack');
    await alice.decryptFromPeer(bId, 'c', r1);
    // Bob's device is wiped: same user id, brand-new identity.
    bob.destroy();
    await deleteAllDeviceRecords(bId);
    await deleteUserRatchetState(bId);
    const bob2 = await newManager(server, bId);
    try {
      // Alice's old session still "works" locally — the silent wedge: her
      // sends succeed but the reset peer cannot read them (IR15).
      const stale = await alice.encryptForPeer(bId, 'c', 'stale');
      assert.equal(parseEnvelope(stale).t, 2);
      await assert.rejects(() => bob2.decryptFromPeer(aId, 'c', stale));
      // Alice performs the C2 peer recovery and re-sends explicitly (P2: the
      // reset itself sends nothing — the next encrypt call is the user's).
      await alice.resetPeerSecurityState(bId, ['c']);
      assert.equal(await alice.peerTrustState(bId), null, 'trust slot is empty right after the reset');
      const fresh = await alice.encryptForPeer(bId, 'c', 'fresh start');
      assert.equal(parseEnvelope(fresh).t, 3, 'post-reset send establishes fresh (PreKey)');
      assert.equal((await bob2.decryptFromPeer(aId, 'c', fresh)).plaintext, 'fresh start');
      const back = await bob2.encryptForPeer(aId, 'c', 'welcome back');
      assert.equal((await alice.decryptFromPeer(bId, 'c', back)).plaintext, 'welcome back');
      // Fresh TOFU for the NEW key exists only now — after the real handshake.
      assert.equal(await alice.peerTrustState(bId), 'unverified');
      assert.equal(
        decodeTrustRecord(await loadPeerTrust(aId, bId)).identityKey,
        server.devices.get(bId).identityKey,
        'the recorded trust is the currently advertised key',
      );
      // No key reuse: the same plaintext under the new session differs.
      const again = await alice.encryptForPeer(bId, 'c', 'fresh start');
      assert.notEqual(again, fresh, 'ratchet advances — no ciphertext/key reuse');
    } finally {
      bob2.destroy();
    }
  } finally {
    alice.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR6: old trust is never adopted insecurely; second change re-detected */
/* ------------------------------------------------------------------ */

test('IR6: the trust slot stays empty until a real establishment; a second identity change is detected again', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  let bob = await newManager(server, bId);
  // Faithful peer reinstall: same user id, genuinely new identity material.
  // (Corrupting base64, SM6-style, only works when establishment is never
  // attempted with the fake key — here it is, so the key must be real.)
  async function reinstallBob() {
    bob.destroy();
    await deleteAllDeviceRecords(bId);
    await deleteUserRatchetState(bId);
    bob = await newManager(server, bId);
  }
  try {
    await alice.encryptForPeer(bId, 'c1', 'first');
    const key1 = decodeTrustRecord(await loadPeerTrust(aId, bId)).identityKey;
    // First identity change -> USER_MISMATCH + persistent mark.
    await reinstallBob();
    const key2advertised = server.devices.get(bId).identityKey;
    assert.notEqual(key2advertised, key1);
    await assert.rejects(() => alice.encryptForPeer(bId, 'c2', 'second'), (e) => isCryptoError(e, 'USER_MISMATCH'));
    assert.equal(await alice.peerTrustState(bId), 'identity_changed');
    // Recovery empties the slot — it does not adopt the new key.
    await alice.resetPeerSecurityState(bId, ['c1', 'c2']);
    assert.equal(await loadPeerTrust(aId, bId), null, 'no key is pre-filled by the reset');
    assert.equal(await alice.peerTrustState(bId), null);
    // Real establishment records the new key as fresh TOFU.
    await alice.encryptForPeer(bId, 'c2', 'second');
    const key2 = decodeTrustRecord(await loadPeerTrust(aId, bId)).identityKey;
    assert.equal(key2, key2advertised, 'fresh TOFU records the advertised key');
    assert.equal(await alice.peerTrustState(bId), 'unverified');
    // Second identity change on yet another connection is detected again.
    await reinstallBob();
    const key3advertised = server.devices.get(bId).identityKey;
    assert.notEqual(key3advertised, key2);
    await assert.rejects(() => alice.encryptForPeer(bId, 'c3', 'third'), (e) => isCryptoError(e, 'USER_MISMATCH'));
    assert.equal(await alice.peerTrustState(bId), 'identity_changed');
    assert.equal(
      decodeTrustRecord(await loadPeerTrust(aId, bId)).identityKey,
      key2,
      'the second change preserves the second key — never the third',
    );
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR7: messages of the old security state are handled correctly       */
/* ------------------------------------------------------------------ */

test('IR7: cached history stays readable; uncached old ciphertexts are never rescued by the new state', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
    await bob.decryptFromPeer(aId, 'c', e1);
    const r1 = await bob.encryptForPeer(aId, 'c', 'ack');
    await alice.decryptFromPeer(bId, 'c', r1);
    // One message the peer reads and caches, one it never sees.
    const read = await alice.encryptForPeer(bId, 'c', 'please cache me');
    assert.equal((await bob.decryptFromPeer(aId, 'c', read)).plaintext, 'please cache me');
    await cachePlaintext(bId, 'm-read', 'please cache me');
    const unread = await alice.encryptForPeer(bId, 'c', 'never received');
    assert.equal(parseEnvelope(unread).t, 2);
    // Bob's device is wiped and re-initialized (new identity).
    bob.destroy();
    await deleteAllDeviceRecords(bId);
    await deleteUserRatchetState(bId);
    _resetMessageCacheForTests();
    const bob2 = await newManager(server, bId);
    try {
      // The sealed cache is keyed by the surviving sealing key: readable.
      assert.equal(await getCachedPlaintext(bId, 'm-read'), 'please cache me');
      // The uncached old Whisper is NOT rescued — before establishment...
      await assert.rejects(
        () => bob2.decryptFromPeer(aId, 'c', unread),
        (e) => isCryptoError(e, 'NEEDS_ESTABLISH'),
      );
      // ...and not after a fresh establishment either.
      const hello = await bob2.encryptForPeer(aId, 'c', 'new here');
      await alice.decryptFromPeer(bId, 'c', hello).catch(() => null);
      await assert.rejects(
        () => bob2.decryptFromPeer(aId, 'c', unread),
        () => true,
        'old ciphertexts stay undecryptable under the new identity',
      );
    } finally {
      bob2.destroy();
    }
  } finally {
    alice.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR8: successful recovery path — own device reset after corrupt state */
/* ------------------------------------------------------------------ */

test('IR8: a corrupt local identity state is recoverable via resetDeviceIdentity — new identity, preserved cache', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
    await bob.decryptFromPeer(aId, 'c', e1);
    const r1 = await bob.encryptForPeer(aId, 'c', 'ack');
    await alice.decryptFromPeer(bId, 'c', r1);
    // Bob also establishes as a sender (on a second connection), so he holds
    // a trust record pinning alice's key — trust is recorded on sender
    // establishment only.
    const b2 = await bob.encryptForPeer(aId, 'c2', 'bob establishes too');
    await alice.decryptFromPeer(bId, 'c2', b2);
    await cachePlaintext(aId, 'm-alice-1', 'readable history');
    await saveChatSnapshot(aId, 'c', {
      connection: { id: 'c' },
      peer: null,
      messages: [],
      hiddenUntil: null,
      deletedForMe: [],
    });
    await putState(aId, 'identity', { legacy: 'e2ee1-marker' });
    const oldPublished = server.devices.get(aId).identityKey;
    const oldIdentityBytes = b64(await loadIdentity(aId));
    // Corrupt the sealed local identity the way a damaged store would: the
    // slot no longer holds an envelope at all.
    await putState(aId, 'signal:identity', { bogus: true });
    alice.destroy();
    bob.destroy();

    // A plain re-initialization (what retry() does) cannot fix this.
    const wedge = await (async () => {
      const m = new E2EESessionManager({
        userId: aId,
        publisher: server.publisher(aId),
        bundleProvider: (peer) => server.claim(peer),
        acquireLock: passthroughLock,
      });
      await assert.rejects(() => m.initialize(), (e) => isCryptoError(e, 'CORRUPT_STATE'));
      await assert.rejects(() => m.initialize(), 'retrying drives the same broken state');
      return m;
    })();

    // The C2 device reset wipes the broken device state and runs the normal
    // initialization path afterwards.
    await wedge.resetDeviceIdentity();
    try {
      const newPublished = server.devices.get(aId).identityKey;
      assert.notEqual(newPublished, oldPublished, 'a NEW identity is published');
      assert.notEqual(b64(await loadIdentity(aId)), oldIdentityBytes, 'a NEW local identity exists');
      // Local and published halves agree — no split brain.
      const localPub = bytesToBase64(await identityPublicKeyFromPair(await loadIdentity(aId)));
      assert.equal(localPub, newPublished, 'published key matches the local identity');
      // The stale per-peer state is gone with the device records.
      assert.equal(await loadPeerTrust(aId, bId), null, 'peer trust went with the device wipe');
      assert.equal((await loadRatchetState(aId, 'c')).status, 'MISSING', 'sessions went with the wipe');
      assert.ok((await listOneTimePreKeys(aId)).length > 0, 'fresh one-time pool generated');
      assert.ok(await loadKyberLastResort(aId), 'fresh last-resort kyber generated');
      // ...while everything the reset must keep survived byte-identically.
      _resetMessageCacheForTests();
      assert.equal(await getCachedPlaintext(aId, 'm-alice-1'), 'readable history', 'cache re-warms from the kept record');
      assert.ok(await loadSealingKey(aId), 'sealing key kept');
      assert.ok(await loadChatSnapshot(aId, 'c'), 'offline snapshot kept');
      assert.deepEqual(await getState(aId, 'identity'), { legacy: 'e2ee1-marker' }, 'legacy records untouched');
      const bobTrust = decodeTrustRecord(await loadPeerTrust(bId, aId));
      assert.equal(bobTrust.identityKey, oldPublished, 'the peer still pins the OLD key (asymmetric reality)');

      // The republished material is public-only: exact key shapes, no records.
      const pub = server.devices.get(aId);
      assert.deepEqual(Object.keys(pub).sort(), ['identityKey', 'kyberPreKeys', 'oneTimePreKeys', 'registrationId', 'signedPreKey']);
      assert.deepEqual(Object.keys(pub.signedPreKey).sort(), ['keyId', 'publicKey', 'signature']);
      for (const o of pub.oneTimePreKeys) assert.deepEqual(Object.keys(o).sort(), ['keyId', 'publicKey']);
      for (const k of pub.kyberPreKeys) {
        assert.deepEqual(Object.keys(k).sort(), ['isLastResort', 'keyId', 'publicKey', 'signature']);
      }

      // End to end: the peer recovers on their side, then both chat again.
      const bob2 = await newManager(server, bId);
      try {
        await bob2.resetPeerSecurityState(aId, ['c']);
        const fresh = await bob2.encryptForPeer(aId, 'c', 'fresh start');
        assert.equal(parseEnvelope(fresh).t, 3);
        assert.equal((await wedge.decryptFromPeer(bId, 'c', fresh)).plaintext, 'fresh start');
        const back = await wedge.encryptForPeer(bId, 'c', 'welcome back');
        assert.equal((await bob2.decryptFromPeer(aId, 'c', back)).plaintext, 'welcome back');
      } finally {
        bob2.destroy();
      }
    } finally {
      wedge.destroy();
    }
  } finally {
    // (already destroyed managers; destroy() is idempotent)
  }
});

/* ------------------------------------------------------------------ */
/* IR9a (manager part): nothing changes before confirmation; double     */
/* confirm is a single state transition                                */
/* ------------------------------------------------------------------ */

test('IR9a: reading recovery state changes nothing; concurrent double resets settle into one consistent state', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
    await bob.decryptFromPeer(aId, 'c', e1);
    // Mere inspection (what the UI does before the user confirms anything)
    // changes nothing durable.
    const beforeDevices = await deviceInventory(aId);
    const beforeSession = await sessionSnapshot(aId, 'c');
    assert.equal(await alice.peerTrustState(bId), 'unverified');
    await sessionSnapshot(aId, 'c');
    await deviceInventory(aId);
    assert.deepEqual(await deviceInventory(aId), beforeDevices, 'reads change nothing');
    assert.deepEqual(await sessionSnapshot(aId, 'c'), beforeSession, 'reads change nothing');
    // Concurrent double peer-reset: both resolve, one consistent outcome.
    await Promise.all([
      alice.resetPeerSecurityState(bId, ['c']),
      alice.resetPeerSecurityState(bId, ['c']),
      alice.resetPeerSecurityState(bId, ['c']),
    ]);
    assert.equal((await loadRatchetState(aId, 'c')).status, 'MISSING');
    assert.equal(await loadPeerTrust(aId, bId), null);
    // Exactly one establishment follows: the first message commits rev 2.
    const first = await alice.encryptForPeer(bId, 'c', 'after double reset');
    assert.equal((await sessionSnapshot(aId, 'c')).revision, '2', 'a single establishment happened');
    assert.equal((await bob.decryptFromPeer(aId, 'c', first)).plaintext, 'after double reset');
    // Concurrent double device-reset: consistent local/published identity.
    await Promise.all([alice.resetDeviceIdentity(), alice.resetDeviceIdentity()]);
    const localPub = bytesToBase64(await identityPublicKeyFromPair(await loadIdentity(aId)));
    assert.equal(localPub, server.devices.get(aId).identityKey, 'no split brain after concurrent device resets');
    const hello = await alice.encryptForPeer(bId, 'c2', 'still works');
    assert.equal(parseEnvelope(hello).t, 3);
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR11 (manager part): a block never looks like an identity change to  */
/* the trust layer                                                     */
/* ------------------------------------------------------------------ */

test('IR11a: the blocked-bundle path rejects without creating or touching any trust record', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const blockedId = freshUser();
  const alice = new E2EESessionManager({
    userId: aId,
    publisher: server.publisher(aId),
    bundleProvider: async (peer) => (peer === blockedId ? { kind: 'blocked' } : server.claim(peer)),
    acquireLock: passthroughLock,
  });
  await alice.initialize();
  try {
    await assert.rejects(
      () => alice.encryptForPeer(blockedId, 'c', 'hello?'),
      (e) => isCryptoError(e),
      'a blocked peer rejects the send',
    );
    assert.equal(await loadPeerTrust(aId, blockedId), null, 'the block path writes no trust record');
    assert.equal(await alice.peerTrustState(blockedId), null);
    assert.equal((await loadRatchetState(aId, 'c')).status, 'MISSING', 'the block path creates no session');
  } finally {
    alice.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* IR12: lock/mutex serialization; no network-triggered reset path     */
/* ------------------------------------------------------------------ */

test('IR12a: initialize racing resetDeviceIdentity settles into one working manager', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = new E2EESessionManager({
    userId: aId,
    publisher: server.publisher(aId),
    bundleProvider: (peer) => server.claim(peer),
    acquireLock: passthroughLock,
  });
  const bob = await newManager(server, bId);
  try {
    // A reset racing the very first initialization: both are serialized by
    // the lock+mutex, both resolve, the outcome is one working manager.
    await Promise.all([alice.initialize(), alice.resetDeviceIdentity()]);
    const localPub = bytesToBase64(await identityPublicKeyFromPair(await loadIdentity(aId)));
    assert.equal(localPub, server.devices.get(aId).identityKey, 'local and published identity agree');
    const e1 = await alice.encryptForPeer(bId, 'c', 'works');
    assert.equal((await bob.decryptFromPeer(aId, 'c', e1)).plaintext, 'works');
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

test('IR12b: resetPeerSecurityState on a destroyed manager fails closed', async () => {
  assert.ifError(initErr);
  await reset();
  _resetMessageCacheForTests();
  const server = new FakeServer();
  const aId = freshUser();
  const bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    const e1 = await alice.encryptForPeer(bId, 'c', 'establish');
    await bob.decryptFromPeer(aId, 'c', e1);
    const beforeDevices = await deviceInventory(aId);
    const beforeSession = await sessionSnapshot(aId, 'c');
    alice.destroy(); // logout while the UI still shows a reset button
    await assert.rejects(
      () => alice.resetPeerSecurityState(bId, ['c']),
      (e) => isCryptoError(e, 'NOT_INITIALIZED'),
      'a destroyed manager refuses the peer reset',
    );
    assert.deepEqual(await deviceInventory(aId), beforeDevices, 'refused reset changes nothing');
    assert.deepEqual(await sessionSnapshot(aId, 'c'), beforeSession, 'refused reset changes nothing');
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

test('IR12c: no network, realtime or server path can invoke a reset (static tripwire)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const root = new URL('../../../..', import.meta.url).pathname;
  const src = join(root, 'src');
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
      if (p.includes('__tests__')) continue;
      const text = readFileSync(p, 'utf-8');
      for (const id of ['resetPeerSecurityState', 'resetDeviceIdentity', 'removePeerTrust', 'deleteRatchetSession']) {
        if (text.includes(id)) hits.push(`${relative(root, p)}:${id}`);
      }
    }
  };
  walk(src);
  const allowed = new Set([
    'src/lib/e2ee/session-manager.ts:resetPeerSecurityState',
    'src/lib/e2ee/session-manager.ts:resetDeviceIdentity',
    'src/lib/e2ee/session-manager.ts:removePeerTrust',
    'src/lib/e2ee/session-manager.ts:deleteRatchetSession',
    'src/lib/crypto/ratchet-state.ts:deleteRatchetSession',
    'src/lib/e2ee/device-store.ts:removePeerTrust',
    // UI call sites (added with the Chat/E2EEContext wiring):
    'src/context/E2EEContext.tsx:resetDeviceIdentity',
    'src/components/Chat.tsx:resetPeerSecurityState',
  ]);
  for (const hit of hits) {
    assert.ok(allowed.has(hit), `reset-related identifier outside its sanctioned module: ${hit}`);
  }
  assert.ok(hits.length > 0, 'the tripwire actually scans (sanity)');
});
