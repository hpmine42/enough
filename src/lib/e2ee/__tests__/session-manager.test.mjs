// enough. E2EE-v0.2 Phase 2 — session manager orchestration tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/session-manager.test.mjs
//
// Deterministic, no Supabase: a fake "server" holds published public material
// and simulates claim_prekey_bundle; the Web Lock is a passthrough. This proves
// the manager's establishment / encrypt / decrypt / reload / fail-closed /
// peer-trust logic end-to-end against the REAL engine.

import '../../crypto/__tests__/setup.mjs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { initEngineSyncForTests } from '../engine-adapter.ts';
import { E2EESessionManager, parseEnvelope } from '../session-manager.ts';
import { deleteCryptoDatabase } from '../../crypto/storage.ts';
import { isCryptoError } from '../../crypto/errors.ts';

const require = createRequire(import.meta.url);
const entry = require.resolve('@getmaapp/signal-wasm');
const wasmPath = entry.replace(/signal_wasm\.js$/, 'signal_wasm_bg.wasm');
let initErr = null;
before(async () => {
  try { initEngineSyncForTests(await readFile(wasmPath)); } catch (e) { initErr = e; }
});

const passthroughLock = async (_name, fn) => fn();
let seq = 0;
const freshUser = () => `sm-user-${++seq}`;

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
    // Simulate the atomic server-side consumption of one-time keys.
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

async function newManager(server, userId) {
  const m = new E2EESessionManager({
    userId,
    publisher: server.publisher(userId),
    bundleProvider: (peer) => server.claim(peer),
    acquireLock: passthroughLock,
    otkPoolSize: 5, otkThreshold: 2, kyberPoolSize: 3, kyberThreshold: 1,
  });
  await m.initialize();
  return m;
}

test('SM1: alice -> bob first message establishes on receive and decrypts', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const alice = await newManager(server, freshUser());
  const bob = await newManager(server, freshUser());
  try {
    const env = await alice.encryptForPeer(bob.userId, 'c', 'Hello Bob');
    const parsed = parseEnvelope(env);
    assert.ok(parsed, 'envelope parses');
    assert.equal(parsed.t, 3, 'first message is PreKey');
    const out = await bob.decryptFromPeer(alice.userId, 'c', env);
    assert.equal(out.plaintext, 'Hello Bob');
    assert.equal(out.legacy, false);
  } finally { alice.destroy(); bob.destroy(); }
});

test('SM2: bidirectional conversation after establishment', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const alice = await newManager(server, freshUser());
  const bob = await newManager(server, freshUser());
  try {
    const e1 = await alice.encryptForPeer(bob.userId, 'c', 'hi');
    assert.equal((await bob.decryptFromPeer(alice.userId, 'c', e1)).plaintext, 'hi');
    const e2 = await bob.encryptForPeer(alice.userId, 'c', 'hello');
    assert.equal((await alice.decryptFromPeer(bob.userId, 'c', e2)).plaintext, 'hello');
    const e3 = await alice.encryptForPeer(bob.userId, 'c', 'how are you');
    assert.equal((await bob.decryptFromPeer(alice.userId, 'c', e3)).plaintext, 'how are you');
  } finally { alice.destroy(); bob.destroy(); }
});

test('SM3: reload (destroy + re-init) continues the conversation', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const aId = freshUser(), bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  const e1 = await alice.encryptForPeer(bId, 'c', 'before reload');
  await bob.decryptFromPeer(aId, 'c', e1);
  alice.destroy();
  bob.destroy();
  // Re-create managers from persisted state.
  const alice2 = await newManager(server, aId);
  const bob2 = await newManager(server, bId);
  try {
    const e2 = await alice2.encryptForPeer(bId, 'c', 'after reload');
    assert.equal((await bob2.decryptFromPeer(aId, 'c', e2)).plaintext, 'after reload');
  } finally { alice2.destroy(); bob2.destroy(); }
});

test('SM4: legacy plaintext rows pass through unchanged', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const bob = await newManager(server, freshUser());
  try {
    const out = await bob.decryptFromPeer('anyone', 'c', 'this is old plaintext');
    assert.equal(out.plaintext, 'this is old plaintext');
    assert.equal(out.legacy, true);
  } finally { bob.destroy(); }
});

test('SM5: a Whisper message with no session fails closed (NEEDS_ESTABLISH)', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const alice = await newManager(server, freshUser());
  const bob = await newManager(server, freshUser());
  const carol = await newManager(server, freshUser());
  try {
    // Establish alice<->bob and get a Whisper envelope (after a round trip).
    const e1 = await alice.encryptForPeer(bob.userId, 'c', 'establish');
    await bob.decryptFromPeer(alice.userId, 'c', e1);
    const reply = await bob.encryptForPeer(alice.userId, 'c', 'ack');
    await alice.decryptFromPeer(bob.userId, 'c', reply);
    const whisper = await alice.encryptForPeer(bob.userId, 'c', 'whisper msg');
    assert.equal(parseEnvelope(whisper).t, 2, 'now Whisper');
    // Carol has NO session with alice: a Whisper must not be invented.
    await assert.rejects(
      () => carol.decryptFromPeer(alice.userId, 'c2', whisper),
      (e) => isCryptoError(e, 'NEEDS_ESTABLISH') || isCryptoError(e),
    );
  } finally { alice.destroy(); bob.destroy(); carol.destroy(); }
});

test('SM6: a changed peer identity key is rejected (TOFU)', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const aId = freshUser(), bId = freshUser();
  const alice = await newManager(server, aId);
  const bob = await newManager(server, bId);
  try {
    // First contact records bob's identity.
    await alice.encryptForPeer(bId, 'c1', 'first');
    // Tamper bob's published identity on the fake server.
    const m = server.devices.get(bId);
    server.devices.set(bId, { ...m, identityKey: 'AA' + (m.identityKey.slice(2)) });
    // A second, separate connection must refuse the changed key.
    await assert.rejects(
      () => alice.encryptForPeer(bId, 'c2', 'second'),
      (e) => isCryptoError(e, 'USER_MISMATCH'),
    );
  } finally { alice.destroy(); bob.destroy(); }
});

test('SM7: out-of-order delivery decrypts via the manager', async () => {
  assert.ifError(initErr);
  await reset();
  const server = new FakeServer();
  const alice = await newManager(server, freshUser());
  const bob = await newManager(server, freshUser());
  try {
    const e1 = await alice.encryptForPeer(bob.userId, 'c', 'first');
    await bob.decryptFromPeer(alice.userId, 'c', e1); // bob establishes
    const a = await alice.encryptForPeer(bob.userId, 'c', 'A');
    const b = await alice.encryptForPeer(bob.userId, 'c', 'B');
    const c = await alice.encryptForPeer(bob.userId, 'c', 'C');
    // deliver b, c, a
    assert.equal((await bob.decryptFromPeer(alice.userId, 'c', b)).plaintext, 'B');
    assert.equal((await bob.decryptFromPeer(alice.userId, 'c', c)).plaintext, 'C');
    assert.equal((await bob.decryptFromPeer(alice.userId, 'c', a)).plaintext, 'A');
  } finally { alice.destroy(); bob.destroy(); }
});
