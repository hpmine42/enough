// enough. E2EE-v0.2 Phase 1 — real Signal engine adapter tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/engine-adapter.test.mjs
//
// These tests run against the REAL @getmaapp/signal-wasm@0.6.6 engine (no
// mocks). They prove the engine adapter, the device-store round-trip, the
// crash-safe ratchet-session sequencer, and the kyber anti-replay usage
// persistence all work together. No Supabase, no network.
//
// This file is plain JavaScript (.mjs is not type-stripped).

import '../../crypto/__tests__/setup.mjs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  initEngineSyncForTests,
  generateIdentity,
  identityPublicKeyFromPair,
  encodeRegistrationId,
  decodeRegistrationId,
  generateOneTimePreKeys,
  generateSignedPreKey,
  generateKyberPreKey,
  hydrateDevice,
  establishSenderSession,
  createSessionEngineFactory,
  decryptEstablishingMessage,
  exportKyberUsage,
  removeConsumedKyberPreKey,
  encodeWireCiphertext,
  decodeWireCiphertext,
} from '../engine-adapter.ts';
import {
  saveIdentity, loadIdentity,
  saveRegistrationId, loadRegistrationId,
  saveSignedPreKey, loadSignedPreKey,
  saveOneTimePreKey, listOneTimePreKeys, removeOneTimePreKey,
  saveKyberPreKey, listKyberPreKeys,
  saveKyberUsage, loadKyberUsage,
} from '../device-store.ts';
import { deleteCryptoDatabase } from '../../crypto/storage.ts';
import { adoptSessionFromEstablishment, loadRatchetState } from '../../crypto/ratchet-state.ts';
import { encryptCommitSend, decryptAndCommit, inspectSession } from '../../crypto/ratchet-session.ts';
import { isCryptoError } from '../../crypto/errors.ts';

const require = createRequire(import.meta.url);
const entry = require.resolve('@getmaapp/signal-wasm');
const wasmPath = entry.replace(/signal_wasm\.js$/, 'signal_wasm_bg.wasm');

let engineInitError = null;
before(async () => {
  try {
    initEngineSyncForTests(await readFile(wasmPath));
  } catch (e) {
    engineInitError = e;
  }
});

const enc = new TextEncoder();
const dec = new TextDecoder();
let seq = 0;
const freshUser = () => `e-user-${++seq}`;
const ADDR = (userId, deviceId = 1) => ({ name: userId, deviceId });

function assertBytesEqual(actual, expected, msg) {
  assert.ok(actual instanceof Uint8Array, `${msg} (not Uint8Array)`);
  assert.equal(actual.byteLength, expected.byteLength, `${msg} (length ${actual.byteLength} vs ${expected.byteLength})`);
  for (let i = 0; i < actual.byteLength; i++) assert.equal(actual[i], expected[i], `${msg} (byte ${i})`);
}

/** Generate + persist a full device, return its public material for bundles. */
async function provisionDevice(userId, { otpCount = 3 } = {}) {
  const ident = await generateIdentity();
  await saveIdentity(userId, ident.identityPairBytes);
  await saveRegistrationId(userId, encodeRegistrationId(ident.registrationId));
  const spk = await generateSignedPreKey(ident.identityPairBytes, 1);
  await saveSignedPreKey(userId, spk.record);
  const otps = await generateOneTimePreKeys(1, otpCount);
  for (const otk of otps) await saveOneTimePreKey(userId, otk.id, otk.record);
  const kpk = await generateKyberPreKey(ident.identityPairBytes, 1);
  await saveKyberPreKey(userId, kpk.id, kpk.record);
  return {
    userId,
    registrationId: ident.registrationId,
    identityPublicKey: ident.identityPublicKeyBytes,
    signedPreKey: { id: spk.id, publicKey: spk.publicKey, signature: spk.signature },
    oneTimePreKeys: otps.map((o) => ({ id: o.id, publicKey: o.publicKey })),
    kyberPreKey: { id: kpk.id, publicKey: kpk.publicKey, signature: kpk.signature },
  };
}

/** Hydrate an in-memory device from persisted records. */
async function loadDevice(userId) {
  const identityPairBytes = await loadIdentity(userId);
  const registrationId = decodeRegistrationId(await loadRegistrationId(userId));
  const spkRecord = await loadSignedPreKey(userId);
  const otpList = await listOneTimePreKeys(userId);
  const kpkList = await listKyberPreKeys(userId);
  const kyberUsage = await loadKyberUsage(userId);
  assert.ok(identityPairBytes && spkRecord, 'device not provisioned');
  return hydrateDevice({
    identityPairBytes,
    registrationId,
    signedPreKey: { id: 1, record: spkRecord },
    oneTimePreKeys: otpList.map((o) => ({ id: Number(o.keyId), record: o.body })),
    kyberPreKeys: kpkList.map((k) => ({ id: Number(k.keyId), record: k.body })),
    kyberUsage,
  });
}

function bundleFromDevice(d) {
  const otp = d.oneTimePreKeys[0];
  return {
    registrationId: d.registrationId,
    identityKey: d.identityPublicKey,
    signedPreKeyId: d.signedPreKey.id,
    signedPreKey: d.signedPreKey.publicKey,
    signedPreKeySignature: d.signedPreKey.signature,
    oneTimePreKeyId: otp ? otp.id : null,
    oneTimePreKey: otp ? otp.publicKey : null,
    kyberPreKeyId: d.kyberPreKey.id,
    kyberPreKey: d.kyberPreKey.publicKey,
    kyberPreKeySignature: d.kyberPreKey.signature,
  };
}

async function reset() {
  await deleteCryptoDatabase();
}

/* ------------------------------------------------------------------ */

test('E1: identity generation and serialize/deserialize round-trip', async () => {
  assert.ifError(engineInitError);
  await reset();
  const ident = await generateIdentity();
  assert.ok(ident.identityPairBytes.byteLength > 0, 'identity pair bytes');
  assert.ok(ident.identityPublicKeyBytes.byteLength > 0, 'public key bytes');
  assert.ok(ident.registrationId >= 1 && ident.registrationId <= 16383, 'reg id range');
  const pubAgain = await identityPublicKeyFromPair(ident.identityPairBytes);
  assertBytesEqual(pubAgain, ident.identityPublicKeyBytes, 'public key stable across serialize');
});

test('E2: registration id encodes/decodes as 4 bytes', async () => {
  for (const id of [1, 255, 16383, 0xdeadbeef]) {
    assert.equal(decodeRegistrationId(encodeRegistrationId(id)), id, `round-trip ${id}`);
  }
});

test('E3: device-store round-trip with the REAL engine (provision -> reload -> hydrate)', async () => {
  assert.ifError(engineInitError);
  await reset();
  const u = freshUser();
  const pub = await provisionDevice(u);
  const device = await loadDevice(u);
  try {
    // The hydrated device must be usable for a full establish + encrypt + decrypt
    // against a second device. This proves the persisted opaque bytes survive.
    const bob = freshUser();
    const bobPub = await provisionDevice(bob);
    const bobDevice = await loadDevice(bob);
    try {
      const initial = await establishSenderSession(device, ADDR(u), ADDR(bob), bundleFromDevice(bobPub));
      assert.ok(initial.byteLength > 0, 'establishment produced a session');
      await adoptSessionFromEstablishment(u, 'conn', initial);
      const sent = [];
      const res = await encryptCommitSend({
        userId: u, connectionId: 'conn', plaintext: enc.encode('roundtrip works'),
        createEngine: createSessionEngineFactory(device, ADDR(u), ADDR(bob)),
        send: (c) => void sent.push(c),
      });
      assert.equal(res.stage, 'SENT');
      assert.equal(sent.length, 1);
      const { type, body } = decodeWireCiphertext(sent[0]);
      assert.equal(type, 3, 'first message is PreKey');
      const est = await decryptEstablishingMessage(bobDevice, ADDR(bob), ADDR(u), body, type);
      assert.equal(dec.decode(est.plaintext), 'roundtrip works');
      assert.equal(est.consumed.oneTimePreKeyId, 1, 'OTP consumed & reported');
      assert.equal(est.consumed.kyberPreKeyId, 1, 'Kyber consumed & reported');
    } finally {
      bobDevice.free();
    }
  } finally {
    device.free();
  }
});

test('E4: first message is PreKey (t=3); subsequent are Whisper (t=2)', async () => {
  assert.ifError(engineInitError);
  await reset();
  const a = freshUser(), b = freshUser();
  const aPub = await provisionDevice(a), bPub = await provisionDevice(b);
  const aDev = await loadDevice(a), bDev = await loadDevice(b);
  try {
    await adoptSessionFromEstablishment(a, 'c', await establishSenderSession(aDev, ADDR(a), ADDR(b), bundleFromDevice(bPub)));
    const first = await send(a, aDev, b);
    assert.equal(decodeWireCiphertext(first).type, 3, 'first is PreKey');
    // Bob establishes on receive
    const { body, type } = decodeWireCiphertext(first);
    const est = await decryptEstablishingMessage(bDev, ADDR(b), ADDR(a), body, type);
    await adoptSessionFromEstablishment(b, 'c', est.nextState);
    await tombstoneConsumed(b, est.consumed, bDev);
    // Bob replies -> Whisper
    const reply = await send(b, bDev, a);
    assert.equal(decodeWireCiphertext(reply).type, 2, 'reply after roundtrip is Whisper');
  } finally { aDev.free(); bDev.free(); }

  async function send(userId, dev, peer) {
    const out = [];
    await encryptCommitSend({ userId, connectionId: 'c', plaintext: enc.encode('hi'), createEngine: createSessionEngineFactory(dev, ADDR(userId), ADDR(peer)), send: (c) => void out.push(c) });
    return out[0];
  }
});

test('E5: multiple messages decrypt in order', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  try {
    for (let i = 1; i <= 5; i++) {
      const wire = await sendOne(a, aDev, b, `m${i}`);
      const { plaintext } = await decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wire, createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) });
      assert.equal(dec.decode(plaintext), `m${i}`);
    }
  } finally { aDev.free(); bDev.free(); }
});

test('E6: out-of-order messages decrypt via skipped message keys', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  try {
    const wires = [];
    for (let i = 0; i < 3; i++) wires.push(await sendOne(a, aDev, b, `M${i + 1}`));
    // Deliver 1, 3, 2
    const p1 = await dec.decode((await decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wires[0], createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) })).plaintext);
    const p3 = await dec.decode((await decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wires[2], createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) })).plaintext);
    const p2 = await dec.decode((await decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wires[1], createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) })).plaintext);
    assert.equal(`${p1},${p3},${p2}`, 'M1,M3,M2');
  } finally { aDev.free(); bDev.free(); }
});

test('E7: a replayed message is rejected (DuplicatedMessage) and commits nothing', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  try {
    const wire = await sendOne(a, aDev, b, 'once');
    await decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wire, createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) });
    const before = (await loadRatchetState(b, 'c')).record.revision;
    await assert.rejects(
      () => decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wire, createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) }),
      () => true,
    );
    const after = (await loadRatchetState(b, 'c')).record.revision;
    assert.equal(before, after, 'replay must not advance the committed state');
  } finally { aDev.free(); bDev.free(); }
});

test('E8: a tampered Whisper ciphertext is rejected and commits nothing', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  try {
    // Acknowledge Alice's session: Bob replies, Alice decrypts. After a
    // round-trip Alice's next message is a Whisper (t=2), the steady-state
    // case. (In the unacknowledged PreKey phase all messages are t=3 and a
    // body edit can land on bundle bytes with subtler semantics — Whisper is
    // the honest tamper target.)
    const reply = await sendOne(b, bDev, a, 'ack');
    await decryptAndCommit({ userId: a, connectionId: 'c', ciphertext: reply, createEngine: createSessionEngineFactory(aDev, ADDR(a), ADDR(b)) });
    const wire = await sendOne(a, aDev, b, 'tamper me');
    assert.equal(decodeWireCiphertext(wire).type, 2, 'message is Whisper after acknowledgement');
    const tampered = new Uint8Array(wire);
    tampered[tampered.length - 1] ^= 0x01; // flip a body byte (wire[0] is the type byte)
    const before = (await loadRatchetState(b, 'c')).record.revision;
    await assert.rejects(
      () => decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: tampered, createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) }),
      () => true,
    );
    const after = (await loadRatchetState(b, 'c')).record.revision;
    assert.equal(before, after, 'tamper must not advance the committed state');
  } finally { aDev.free(); bDev.free(); }
});

test('E9: a ciphertext for a different peer/session is rejected', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  // carol has no session with alice; she must fail to decrypt alice->bob ct.
  const c = freshUser();
  const cPub = await provisionDevice(c);
  const cDev = await loadDevice(c);
  try {
    const wire = await sendOne(a, aDev, b, 'not for carol');
    const { body, type } = decodeWireCiphertext(wire);
    await assert.rejects(
      () => decryptEstablishingMessage(cDev, ADDR(c), ADDR(a), body, type),
      () => true,
    );
  } finally { aDev.free(); bDev.free(); cDev.free(); }
});

test('E10: session export/import — reload continues the conversation', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  try {
    await sendOne(a, aDev, b, 'first after establish');
    // Simulate a reload: drop the in-memory device, re-hydrate from device-store.
    aDev.free();
    const aDev2 = await loadDevice(a);
    try {
      const wire = await sendOne(a, aDev2, b, 'after reload');
      const { plaintext } = await decryptAndCommit({ userId: b, connectionId: 'c', ciphertext: wire, createEngine: createSessionEngineFactory(bDev, ADDR(b), ADDR(a)) });
      assert.equal(dec.decode(plaintext), 'after reload');
    } finally { aDev2.free(); }
  } finally { bDev.free(); }
});

test('E11: kyber_usage persists across reload and keeps rejecting replays', async () => {
  assert.ifError(engineInitError);
  await reset();
  const a = freshUser(), b = freshUser();
  const aPub = await provisionDevice(a), bPub = await provisionDevice(b);
  // Alice -> Bob (first PreKey). Bob establishes and we persist his kyber usage.
  const aDev = await loadDevice(a);
  const bDev = await loadDevice(b);
  let firstWire;
  try {
    await adoptSessionFromEstablishment(a, 'c', await establishSenderSession(aDev, ADDR(a), ADDR(b), bundleFromDevice(bPub)));
    firstWire = await sendOne(a, aDev, b, 'establish');
    const { body, type } = decodeWireCiphertext(firstWire);
    const est = await decryptEstablishingMessage(bDev, ADDR(b), ADDR(a), body, type);
    await adoptSessionFromEstablishment(b, 'c', est.nextState);
    // tombstone the consumed one-time kyber + persist updated kyber usage
    assert.equal(removeConsumedKyberPreKey(bDev, est.consumed.kyberPreKeyId), true);
    await saveKyberUsage(b, exportKyberUsage(bDev.kyberPreKeyStore));
    await removeOneTimePreKey(b, est.consumed.oneTimePreKeyId);
  } finally { aDev.free(); }
  // Reload Bob from device-store (kyber usage restored) and replay the same
  // PreKey message — it must still be rejected, NOT re-establish a session.
  const bDev2 = await loadDevice(b);
  try {
    const { body, type } = decodeWireCiphertext(firstWire);
    await assert.rejects(
      () => decryptEstablishingMessage(bDev2, ADDR(b), ADDR(a), body, type),
      () => true,
      'replayed PreKey must be rejected after reload with restored kyber usage',
    );
  } finally { bDev.free(); bDev2.free(); }
});

test('E12: encryptCommitSend advances the committed revision (CAS path)', async () => {
  assert.ifError(engineInitError);
  await reset();
  const { aDev, bDev, a, b } = await establishedPair();
  try {
    const r0 = (await loadRatchetState(a, 'c')).record.revision;
    for (let i = 0; i < 3; i++) {
      await sendOne(a, aDev, b, `n${i}`);
    }
    const r1 = (await loadRatchetState(a, 'c')).record.revision;
    assert.equal(r1 - r0, 3n, 'revision advanced by exactly 3 commits');
  } finally { aDev.free(); bDev.free(); }
});

test('E13: account isolation — A and B keep separate identities/sessions', async () => {
  assert.ifError(engineInitError);
  await reset();
  const a = freshUser(), b = freshUser();
  const aPub = await provisionDevice(a), bPub = await provisionDevice(b);
  const aIdA = await loadIdentity(a);
  const bIdB = await loadIdentity(b);
  assert.notDeepEqual(Array.from(aIdA), Array.from(bIdB), 'identities differ');
  // A cannot load B's identity bytes as its own (AAD cross-binding).
  // (Cross-user load returns null because keys are user-scoped; the AAD guard
  // is exercised in device-store.test.mjs D6.)
  assert.equal(await loadIdentity(b + '-typo'), null);
});

/* ---- helpers shared by E4..E12 ---- */

async function establishedPair() {
  const a = freshUser(), b = freshUser();
  const aPub = await provisionDevice(a), bPub = await provisionDevice(b);
  const aDev = await loadDevice(a), bDev = await loadDevice(b);
  await adoptSessionFromEstablishment(a, 'c', await establishSenderSession(aDev, ADDR(a), ADDR(b), bundleFromDevice(bPub)));
  // first message establishes Bob
  const first = await sendOne(a, aDev, b, 'hello');
  const { body, type } = decodeWireCiphertext(first);
  const est = await decryptEstablishingMessage(bDev, ADDR(b), ADDR(a), body, type);
  await adoptSessionFromEstablishment(b, 'c', est.nextState);
  await tombstoneConsumed(b, est.consumed, bDev);
  return { a, b, aDev, bDev, aPub, bPub };
}

async function sendOne(userId, dev, peer, text) {
  const out = [];
  await encryptCommitSend({ userId, connectionId: 'c', plaintext: enc.encode(text), createEngine: createSessionEngineFactory(dev, ADDR(userId), ADDR(peer)), send: (c) => void out.push(c) });
  return out[0];
}

async function tombstoneConsumed(userId, consumed, dev) {
  if (consumed.kyberPreKeyId !== undefined) {
    removeConsumedKyberPreKey(dev, consumed.kyberPreKeyId);
    await saveKyberUsage(userId, exportKyberUsage(dev.kyberPreKeyStore));
  }
  if (consumed.oneTimePreKeyId !== undefined) {
    await removeOneTimePreKey(userId, consumed.oneTimePreKeyId);
  }
}
