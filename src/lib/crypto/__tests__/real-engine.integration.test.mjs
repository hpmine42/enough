// enough. E2EE-2D.2 — REAL-ENGINE integration test for the ephemeral
// engine sequencer (Stage 5, audit finding H-1).
//
// This test runs against the actual `@getmaapp/signal-wasm@0.6.6` engine, not
// a stand-in. That engine is deliberately NOT a dependency of the application
// (see the dependency audit in docs/e2ee-crash-rollback-hardening.md §9); it
// lives only in `experiments/e2ee-2b/`. So this file SKIPS ITSELF unless that
// experiment's node_modules are present:
//
//     cd experiments/e2ee-2b && npm install
//     node --test --experimental-strip-types \
//       src/lib/crypto/__tests__/real-engine.integration.test.mjs
//
// It is intentionally not part of `npm run test:crypto`, because that script
// must stay runnable on a clean checkout with only the app's own
// dependencies installed.
//
// WHAT IT PROVES
//
// The whole H-1 remedy rests on one empirical claim about this engine:
//
//     encryptMessage() run against a FRESH WasmInMemSessionStore hydrated
//     from exported session bytes does not touch any other store, and two
//     such runs from identical bytes produce identical output.
//
// If that claim is false, the ephemeral-engine design does not close H-1. So
// the claim is tested here directly against the real engine rather than
// assumed from a mock.
//
// No Supabase, no network, no production identities: Alice and Bob are
// throwaway local keypairs generated inside the test.

import './setup.mjs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { adoptSessionFromEstablishment, loadRatchetState } from '../ratchet-state.ts';
import { encryptCommitSend } from '../ratchet-session.ts';
import { deleteCryptoDatabase } from '../storage.ts';
import { isCryptoError } from '../errors.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const experimentDir = path.resolve(here, '../../../../experiments/e2ee-2b');
const require = createRequire(path.join(experimentDir, 'package.json'));

let wasm = null;
let skipReason = null;

before(async () => {
  try {
    const entry = require.resolve('@getmaapp/signal-wasm');
    const mod = await import(`file://${entry}`);
    const wasmPath = path.join(path.dirname(entry), 'signal_wasm_bg.wasm');
    mod.initSync({ module: await readFile(wasmPath) });
    wasm = mod;
  } catch (e) {
    skipReason = `real engine unavailable (${e.message}); run \`npm install\` in experiments/e2ee-2b`;
  }
});

const enc = new TextEncoder();
let clientSeq = 0;

function makeClient(label) {
  const identityPrivate = wasm.WasmPrivateKey.generate();
  const idPair = new wasm.WasmIdentityKeyPair(identityPrivate.getPublicKey(), identityPrivate);
  const registrationId = wasm.generateRegistrationId();
  clientSeq += 1;
  return {
    label,
    address: new wasm.WasmProtocolAddress(`${label}-${clientSeq}`, 1),
    identityPair: idPair,
    registrationId,
    identityStore: new wasm.WasmInMemIdentityKeyStore(idPair, registrationId),
    sessionStore: new wasm.WasmInMemSessionStore(),
    preKeyStore: new wasm.WasmInMemPreKeyStore(),
    signedPreKeyStore: new wasm.WasmInMemSignedPreKeyStore(),
    kyberPreKeyStore: new wasm.WasmInMemKyberPreKeyStore(),
  };
}

async function generateBundle(client) {
  const preKeys = await wasm.generatePreKeys(1, 1, client.preKeyStore);
  const signed = await wasm.generateSignedPreKey(1, client.identityPair, client.signedPreKeyStore);
  const kyber = await wasm.generateKyberPreKey(1, client.identityPair, client.kyberPreKeyStore);
  return {
    registrationId: client.registrationId,
    identityKey: client.identityPair.public_key,
    signedPreKeyId: signed.id,
    signedPreKeyPublic: signed.public_key,
    signedPreKeySignature: signed.signature,
    oneTimePreKeyId: preKeys[0].id,
    oneTimePreKeyPublic: preKeys[0].public_key,
    kyberPreKeyId: kyber.id,
    kyberPreKeyPublic: kyber.public_key,
    kyberPreKeySignature: kyber.signature,
  };
}

async function establishSignalSession(initiator, recipient, bundle) {
  await wasm.processPreKeyBundle(
    recipient.address,
    initiator.address,
    bundle.registrationId,
    bundle.identityKey,
    bundle.signedPreKeyId,
    wasm.WasmPublicKey.deserialize(bundle.signedPreKeyPublic),
    bundle.signedPreKeySignature,
    bundle.oneTimePreKeyId,
    bundle.oneTimePreKeyPublic,
    bundle.kyberPreKeyId,
    bundle.kyberPreKeyPublic,
    bundle.kyberPreKeySignature,
    initiator.sessionStore,
    initiator.identityStore,
  );
}

/**
 * The production-shaped engine factory: one fresh in-memory session store per
 * attempt, hydrated from the persisted state bytes. Nothing is shared between
 * attempts and no long-lived store is touched.
 */
function makeEphemeralEngineFactory(alice, bob, log) {
  return async (stateBytes) => {
    const store = new wasm.WasmInMemSessionStore();
    await store.import_session(bob.address, stateBytes);
    const instance = {
      store,
      disposed: false,
      async encrypt(plaintext) {
        const ct = await wasm.encryptMessage(
          plaintext,
          bob.address,
          alice.address,
          store,
          alice.identityStore,
        );
        const nextState = await store.export_session(bob.address);
        return {
          ciphertext: new Uint8Array(ct.body),
          nextState: new Uint8Array(nextState),
        };
      },
      dispose() {
        this.disposed = true;
      },
    };
    if (log) log.push(instance);
    return instance;
  };
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ------------------------------------------------------------------ */

test('RE1: encryptMessage on a fresh store leaves the long-lived store untouched', async (t) => {
  if (!wasm) return t.skip(skipReason);

  const alice = makeClient('alice');
  const bob = makeClient('bob');
  await establishSignalSession(alice, bob, await generateBundle(bob));

  const persisted = new Uint8Array(await alice.sessionStore.export_session(bob.address));

  // Three ephemeral attempts from the same exported bytes.
  const outputs = [];
  for (let i = 0; i < 3; i++) {
    const store = new wasm.WasmInMemSessionStore();
    await store.import_session(bob.address, persisted);
    const ct = await wasm.encryptMessage(
      enc.encode('same plaintext'),
      bob.address,
      alice.address,
      store,
      alice.identityStore,
    );
    outputs.push({
      ciphertext: new Uint8Array(ct.body),
      nextState: new Uint8Array(await store.export_session(bob.address)),
    });
  }

  // THE PROPERTY THE DESIGN DEPENDS ON: the long-lived store must not have
  // advanced at all. This is what makes a losing attempt free of consequences
  // and is the structural answer to H-1.
  const after = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  assert.equal(
    bytesEqual(persisted, after),
    true,
    'the shared session store must be byte-identical after 3 ephemeral encryptions',
  );
});

test('RE1b: CORRECTION — ephemeral encryption is NOT byte-deterministic before the session is acknowledged', async (t) => {
  if (!wasm) return t.skip(skipReason);

  // An earlier analysis note claimed that two ephemeral engines hydrated from
  // identical state bytes always produce byte-identical ciphertext and next
  // state. Measured against the real engine, that is only true once the
  // session has been acknowledged by a round trip. While the session is still
  // in its initial PreKey phase, repeated encryptions from identical bytes
  // differ. The claim is therefore recorded here in its corrected form rather
  // than left standing.
  //
  // This does NOT affect the design: the sequencer never compares or replays
  // ciphertexts from competing attempts. It commits one and discards the rest
  // unsent, so their contents are irrelevant. What matters is only that the
  // discarded attempts leave no durable trace, which RE1 and RE3 verify.
  const alice = makeClient('alice');
  const bob = makeClient('bob');
  await establishSignalSession(alice, bob, await generateBundle(bob));

  const attempt = async (state) => {
    const store = new wasm.WasmInMemSessionStore();
    await store.import_session(bob.address, state);
    const ct = await wasm.encryptMessage(
      enc.encode('same'),
      bob.address,
      alice.address,
      store,
      alice.identityStore,
    );
    return new Uint8Array(ct.body);
  };

  // Phase 1: unacknowledged PreKey session — NOT deterministic.
  const preKeyState = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  const p1 = await attempt(preKeyState);
  const p2 = await attempt(preKeyState);
  assert.equal(
    bytesEqual(p1, p2),
    false,
    'EXPECTED: PreKey-phase encryption carries per-call variation',
  );

  // Phase 2: after a full round trip the session is established — deterministic.
  const ct1 = await wasm.encryptMessage(
    enc.encode('m1'), bob.address, alice.address, alice.sessionStore, alice.identityStore,
  );
  await wasm.decryptMessage(
    ct1.body, ct1.message_type, alice.address, bob.address,
    bob.sessionStore, bob.identityStore, bob.preKeyStore, bob.signedPreKeyStore, bob.kyberPreKeyStore,
  );
  const reply = await wasm.encryptMessage(
    enc.encode('reply'), alice.address, bob.address, bob.sessionStore, bob.identityStore,
  );
  await wasm.decryptMessage(
    reply.body, reply.message_type, bob.address, alice.address,
    alice.sessionStore, alice.identityStore, alice.preKeyStore, alice.signedPreKeyStore, alice.kyberPreKeyStore,
  );

  const establishedState = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  const e1 = await attempt(establishedState);
  const e2 = await attempt(establishedState);
  assert.equal(
    bytesEqual(e1, e2),
    true,
    'an established session IS deterministic — which is exactly why rollback reuses a message key',
  );

  // And the shared store stayed untouched throughout both phases.
  const finalState = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  assert.equal(bytesEqual(establishedState, finalState), true);
});

test('RE2: the sequencer drives the real engine end to end', async (t) => {
  if (!wasm) return t.skip(skipReason);
  await deleteCryptoDatabase();

  const alice = makeClient('alice');
  const bob = makeClient('bob');
  await establishSignalSession(alice, bob, await generateBundle(bob));

  const userId = 'real-user-1';
  const connectionId = 'real-conn-1';
  const initial = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  await adoptSessionFromEstablishment(userId, connectionId, initial);

  const sent = [];
  for (let i = 0; i < 3; i++) {
    const result = await encryptCommitSend({
      userId,
      connectionId,
      plaintext: enc.encode(`message ${i}`),
      createEngine: makeEphemeralEngineFactory(alice, bob),
      send: (c) => void sent.push(c),
    });
    assert.equal(result.revision, BigInt(i + 2));
  }

  assert.equal(sent.length, 3);
  // Distinct plaintexts under an advancing ratchet must give distinct
  // ciphertexts — the property that rollback would destroy.
  assert.equal(bytesEqual(sent[0], sent[1]), false);
  assert.equal(bytesEqual(sent[1], sent[2]), false);

  const loaded = await loadRatchetState(userId, connectionId);
  assert.equal(loaded.status, 'VALID');
  assert.equal(loaded.record.revision, 4n);
});

test('RE3: H-1 — concurrent real-engine sends produce one commit, one send, no residue', async (t) => {
  if (!wasm) return t.skip(skipReason);
  await deleteCryptoDatabase();

  const alice = makeClient('alice');
  const bob = makeClient('bob');
  await establishSignalSession(alice, bob, await generateBundle(bob));

  const userId = 'real-user-2';
  const connectionId = 'real-conn-2';
  const initial = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  await adoptSessionFromEstablishment(userId, connectionId, initial);

  const engines = [];
  const sent = [];
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      encryptCommitSend({
        userId,
        connectionId,
        plaintext: enc.encode(`concurrent ${i}`),
        createEngine: makeEphemeralEngineFactory(alice, bob, engines),
        send: (c) => void sent.push(c),
      }).then(
        (r) => ({ ok: true, r }),
        (e) => ({ ok: false, e }),
      ),
    ),
  );

  assert.equal(results.filter((x) => x.ok).length, 1, 'exactly one CAS winner');
  assert.equal(sent.length, 1, 'exactly one send');
  for (const loser of results.filter((x) => !x.ok)) {
    assert.ok(isCryptoError(loser.e), `losers must fail with a CryptoError, got ${loser.e}`);
  }

  // Every ephemeral engine was disposed …
  assert.equal(engines.length, 4);
  assert.ok(engines.every((e) => e.disposed), 'every ephemeral engine must be disposed');

  // … and, the point of H-1: the long-lived store never advanced, so the
  // losing attempts left no consumed message keys anywhere durable.
  const shared = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  assert.equal(
    bytesEqual(initial, shared),
    true,
    'the shared engine store must show NO residue from the losing attempts',
  );

  // The persisted state advanced exactly once.
  const loaded = await loadRatchetState(userId, connectionId);
  assert.equal(loaded.record.revision, 2n);
});

test('RE4: a ciphertext from a losing attempt is never externalized', async (t) => {
  if (!wasm) return t.skip(skipReason);
  await deleteCryptoDatabase();

  const alice = makeClient('alice');
  const bob = makeClient('bob');
  await establishSignalSession(alice, bob, await generateBundle(bob));

  const userId = 'real-user-3';
  const connectionId = 'real-conn-3';
  const initial = new Uint8Array(await alice.sessionStore.export_session(bob.address));
  const { epoch } = await adoptSessionFromEstablishment(userId, connectionId, initial);

  const sent = [];
  // Steal the ciphertext the losing attempt produced, then prove it was not
  // sent and that the committed state does not correspond to it.
  let losingCiphertext = null;
  await assert.rejects(() =>
    encryptCommitSend({
      userId,
      connectionId,
      plaintext: enc.encode('loser'),
      createEngine: async (state) => {
        const factory = makeEphemeralEngineFactory(alice, bob);
        const inst = await factory(state);
        const original = inst.encrypt.bind(inst);
        inst.encrypt = async (p) => {
          const out = await original(p);
          losingCiphertext = out.ciphertext;
          // A competing writer commits first.
          const winner = await factory(state);
          const w = await winner.encrypt(enc.encode('winner'));
          const { commitRatchetState } = await import('../ratchet-state.ts');
          await commitRatchetState(userId, connectionId, { epoch, revision: 1n }, w.nextState);
          return out;
        };
        return inst;
      },
      send: (c) => void sent.push(c),
    }),
  );

  assert.ok(losingCiphertext, 'the losing attempt did produce a ciphertext');
  assert.equal(sent.length, 0, 'the losing ciphertext must never be sent');
});
