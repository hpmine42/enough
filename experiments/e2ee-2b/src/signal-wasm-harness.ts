// ============================================================================
// enough. E2EE-2B COMPATIBILITY SPIKE — @getmaapp/signal-wasm harness
// ----------------------------------------------------------------------------
// ISOLATED TEST CODE ONLY. This file is never imported by src/lib/crypto or the
// production app. It uses fake local Alice/Bob identities only; no Supabase,
// no network, no production messages, no enough. user keys.
// ============================================================================

import initWasm, {
  WasmIdentityKeyPair,
  WasmInMemIdentityKeyStore,
  WasmInMemKyberPreKeyStore,
  WasmInMemPreKeyStore,
  WasmInMemSessionStore,
  WasmInMemSignedPreKeyStore,
  WasmPrivateKey,
  WasmProtocolAddress,
  WasmPublicKey,
  decryptMessage,
  encryptMessage,
  generateKyberPreKey,
  generatePreKeys,
  generateRegistrationId,
  generateSafetyNumber,
  generateSignedPreKey,
  initSync,
  message_type_pre_key,
  processPreKeyBundle,
  ratchet_key_of_ciphertext,
  verifyScannableFingerprint,
} from '@getmaapp/signal-wasm';

export type CheckStatus = 'PASS' | 'FAIL' | 'INFO';

export interface CheckResult {
  id: string;
  category: string;
  name: string;
  status: CheckStatus;
  detail: string;
  durationMs: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function initSignalWasmForBrowser(): Promise<void> {
  await initWasm();
}

export function initSignalWasmForNode(wasmBytes: Uint8Array): void {
  initSync({ module: wasmBytes });
}

export interface Client {
  label: 'Alice' | 'Bob' | 'Mallory';
  userId: string;
  deviceId: number;
  address: WasmProtocolAddress;
  identityPrivate: WasmPrivateKey;
  identityPair: WasmIdentityKeyPair;
  registrationId: number;
  identityStore: WasmInMemIdentityKeyStore;
  sessionStore: WasmInMemSessionStore;
  preKeyStore: WasmInMemPreKeyStore;
  signedPreKeyStore: WasmInMemSignedPreKeyStore;
  kyberPreKeyStore: WasmInMemKyberPreKeyStore;
}

export interface Bundle {
  registrationId: number;
  identityKey: WasmPublicKey;
  signedPreKeyId: number;
  signedPreKeyPublic: Uint8Array;
  signedPreKeySignature: Uint8Array;
  oneTimePreKeyId: number;
  oneTimePreKeyPublic: Uint8Array;
  kyberPreKeyId: number;
  kyberPreKeyPublic: Uint8Array;
  kyberPreKeySignature: Uint8Array;
}

export function createClient(label: Client['label'], deviceId = 1): Client {
  const userId = `${label.toLowerCase()}-local-spike-id`;
  const identityPrivate = WasmPrivateKey.generate();
  const identityPair = new WasmIdentityKeyPair(identityPrivate.getPublicKey(), identityPrivate);
  const registrationId = generateRegistrationId();
  return createClientFromIdentity(label, userId, deviceId, identityPair, registrationId);
}

export function createClientFromIdentity(
  label: Client['label'],
  userId: string,
  deviceId: number,
  identityPair: WasmIdentityKeyPair,
  registrationId: number,
): Client {
  return {
    label,
    userId,
    deviceId,
    address: new WasmProtocolAddress(userId, deviceId),
    identityPrivate: identityPair.private_key,
    identityPair,
    registrationId,
    identityStore: new WasmInMemIdentityKeyStore(identityPair, registrationId),
    sessionStore: new WasmInMemSessionStore(),
    preKeyStore: new WasmInMemPreKeyStore(),
    signedPreKeyStore: new WasmInMemSignedPreKeyStore(),
    kyberPreKeyStore: new WasmInMemKyberPreKeyStore(),
  };
}

export async function generateBundle(client: Client, ids = { pre: 1, signed: 1, kyber: 1 }): Promise<Bundle> {
  const preKeys = await generatePreKeys(ids.pre, 1, client.preKeyStore);
  const signed = await generateSignedPreKey(ids.signed, client.identityPair, client.signedPreKeyStore);
  const kyber = await generateKyberPreKey(ids.kyber, client.identityPair, client.kyberPreKeyStore);
  return {
    registrationId: client.registrationId,
    identityKey: client.identityPair.public_key,
    signedPreKeyId: signed.id,
    signedPreKeyPublic: signed.public_key,
    signedPreKeySignature: signed.signature,
    oneTimePreKeyId: preKeys[0]!.id,
    oneTimePreKeyPublic: preKeys[0]!.public_key,
    kyberPreKeyId: kyber.id,
    kyberPreKeyPublic: kyber.public_key,
    kyberPreKeySignature: kyber.signature,
  };
}

export async function establishSession(initiator: Client, recipient: Client, recipientBundle: Bundle): Promise<void> {
  await processPreKeyBundle(
    recipient.address,
    initiator.address,
    recipientBundle.registrationId,
    recipientBundle.identityKey,
    recipientBundle.signedPreKeyId,
    WasmPublicKey.deserialize(recipientBundle.signedPreKeyPublic),
    recipientBundle.signedPreKeySignature,
    recipientBundle.oneTimePreKeyId,
    recipientBundle.oneTimePreKeyPublic,
    recipientBundle.kyberPreKeyId,
    recipientBundle.kyberPreKeyPublic,
    recipientBundle.kyberPreKeySignature,
    initiator.sessionStore,
    initiator.identityStore,
  );
}

export async function send(sender: Client, recipient: Client, text: string) {
  return encryptMessage(enc.encode(text), recipient.address, sender.address, sender.sessionStore, sender.identityStore);
}

export async function receive(recipient: Client, sender: Client, ciphertext: { body: Uint8Array; message_type: number }): Promise<string> {
  const result = await decryptMessage(
    ciphertext.body,
    ciphertext.message_type,
    sender.address,
    recipient.address,
    recipient.sessionStore,
    recipient.identityStore,
    recipient.preKeyStore,
    recipient.signedPreKeyStore,
    recipient.kyberPreKeyStore,
  );
  if (result.kyberPreKeyId !== undefined) recipient.kyberPreKeyStore.remove_kyber_pre_key(result.kyberPreKeyId);
  return dec.decode(result.plaintext);
}

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  let d = 0;
  for (let i = 0; i < a.byteLength; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

async function snapshotSession(client: Client, peer: Client): Promise<Uint8Array> {
  const bytes = await client.sessionStore.export_session(peer.address);
  if (!bytes) throw new Error(`${client.label} has no session for ${peer.label}`);
  return bytes;
}

async function expectThrows(fn: () => Promise<unknown>, contains?: string): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const err = e as Error & { code?: string };
    const msg = `${err.code ?? 'no-code'} ${err.message ?? String(e)}`;
    if (contains && !msg.includes(contains)) throw new Error(`Expected error containing ${contains}, got ${msg}`);
    return msg;
  }
  throw new Error('Expected operation to throw');
}

async function check(results: CheckResult[], category: string, id: string, name: string, fn: () => Promise<string>): Promise<void> {
  const started = performance.now();
  try {
    const detail = await fn();
    results.push({ id, category, name, status: 'PASS', detail, durationMs: performance.now() - started });
  } catch (e) {
    results.push({ id, category, name, status: 'FAIL', detail: e instanceof Error ? e.message : String(e), durationMs: performance.now() - started });
  }
}

export async function runAllSignalWasmChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const cat = '@getmaapp/signal-wasm 0.6.6 isolated API checks';

  await check(results, cat, 'alice-to-bob', 'Alice establishes PQXDH session and Bob decrypts Hello Bob', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    const bobBundle = await generateBundle(bob);
    await establishSession(alice, bob, bobBundle);
    const ct = await send(alice, bob, 'Hello Bob');
    if (ct.message_type !== message_type_pre_key()) throw new Error(`first message type ${ct.message_type} was not PreKey`);
    const plaintext = await receive(bob, alice, ct);
    if (plaintext !== 'Hello Bob') throw new Error(`wrong plaintext ${plaintext}`);
    return `ok; first ciphertext is PreKey type ${ct.message_type}; Bob consumed prekeys when decrypting`;
  });

  await check(results, cat, 'bob-to-alice', 'Bob replies on established session and Alice decrypts Hello Alice', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    await receive(bob, alice, await send(alice, bob, 'Hello Bob'));
    const reply = await send(bob, alice, 'Hello Alice');
    const plaintext = await receive(alice, bob, reply);
    if (plaintext !== 'Hello Alice') throw new Error(`wrong plaintext ${plaintext}`);
    return `ok; reply message type ${reply.message_type}`;
  });

  await check(results, cat, 'bidirectional-ratchet', 'Multiple bidirectional messages ratchet session state', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    const states: Uint8Array[] = [];
    const texts = ['message 1', 'message 2', 'message 3'];
    const ratchetKeys: Uint8Array[] = [];
    for (const text of texts) {
      const ct = await send(alice, bob, text);
      const rk = ratchet_key_of_ciphertext(ct.body, ct.message_type);
      if (rk) ratchetKeys.push(rk);
      const out = await receive(bob, alice, ct);
      if (out !== text) throw new Error(`Bob got ${out}`);
      states.push(await snapshotSession(alice, bob));
    }
    for (const text of ['reply 1', 'reply 2']) {
      const ct = await send(bob, alice, text);
      const out = await receive(alice, bob, ct);
      if (out !== text) throw new Error(`Alice got ${out}`);
      states.push(await snapshotSession(bob, alice));
    }
    const ct4 = await send(alice, bob, 'message 4');
    if ((await receive(bob, alice, ct4)) !== 'message 4') throw new Error('message 4 failed');
    const uniqueStateCount = new Set(states.map((s) => Array.from(s).join(','))).size;
    if (uniqueStateCount < states.length) throw new Error('exported session states repeated unexpectedly');
    const uniqueRatchetPublicKeys = new Set(ratchetKeys.map((s) => Array.from(s).join(','))).size;
    return `${states.length + 1} messages decrypted; exported session state changed after each encrypt/decrypt; ${uniqueRatchetPublicKeys} sender ratchet public key(s) observed (same-chain repeats are expected)`;
  });

  await check(results, cat, 'out-of-order', 'Out-of-order messages M1, M3, M2 decrypt', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    const c1 = await send(alice, bob, 'M1');
    const c2 = await send(alice, bob, 'M2');
    const c3 = await send(alice, bob, 'M3');
    const p1 = await receive(bob, alice, c1);
    const p3 = await receive(bob, alice, c3);
    const p2 = await receive(bob, alice, c2);
    if (`${p1},${p3},${p2}` !== 'M1,M3,M2') throw new Error(`${p1},${p3},${p2}`);
    const c4 = await send(alice, bob, 'M4');
    if ((await receive(bob, alice, c4)) !== 'M4') throw new Error('session not consistent after skipped key use');
    return 'M1, M3, M2, then M4 decrypted; skipped-message key behavior works through the API';
  });

  await check(results, cat, 'session-restore-offline', 'Offline queued ciphertext decrypts after session serialization/restore', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    const queued = await send(alice, bob, 'offline message');

    const restoredBob = createClientFromIdentity(
      'Bob',
      bob.userId,
      bob.deviceId,
      WasmIdentityKeyPair.deserialize(bob.identityPair.serialize()),
      bob.registrationId,
    );
    const session = await bob.sessionStore.export_session(alice.address);
    if (session) await restoredBob.sessionStore.import_session(alice.address, session);
    // Bob has not yet decrypted the first PreKey message, so restore prekey stores too.
    for (const id of [1]) {
      const pk = await bob.preKeyStore.export_pre_key(id);
      if (pk) await restoredBob.preKeyStore.import_pre_key(id, pk);
      const spk = await bob.signedPreKeyStore.export_signed_pre_key(id);
      if (spk) await restoredBob.signedPreKeyStore.import_signed_pre_key(id, spk);
      const kpk = await bob.kyberPreKeyStore.export_kyber_pre_key(id);
      if (kpk) await restoredBob.kyberPreKeyStore.import_kyber_pre_key(id, kpk);
    }
    const plaintext = await receive(restoredBob, alice, queued);
    if (plaintext !== 'offline message') throw new Error(plaintext);
    return 'prekey/session stores exported as Uint8Array records and restored into new in-memory stores';
  });

  await check(results, cat, 'tamper-ciphertext', 'Manipulated ciphertext is rejected', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    const ct = await send(alice, bob, 'tamper me');
    const body = new Uint8Array(ct.body);
    body[Math.floor(body.length / 2)] ^= 0x01;
    return await expectThrows(() => receive(bob, alice, { body, message_type: ct.message_type }));
  });

  await check(results, cat, 'wrong-session', 'Wrong recipient/session cannot decrypt', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    const mallory = createClient('Mallory');
    await establishSession(alice, bob, await generateBundle(bob));
    const ct = await send(alice, bob, 'not for Mallory');
    return await expectThrows(() => receive(mallory, alice, ct));
  });

  await check(results, cat, 'wrong-identity-key', 'PreKey bundle with mismatched identity/signature is rejected', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    const mallory = createClient('Mallory');
    const bundle = await generateBundle(bob);
    bundle.identityKey = mallory.identityPair.public_key;
    return await expectThrows(() => establishSession(alice, bob, bundle));
  });

  await check(results, cat, 'replay', 'Replay behavior rejects duplicate message', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    const ct = await send(alice, bob, 'once');
    const first = await receive(bob, alice, ct);
    if (first !== 'once') throw new Error(first);
    return await expectThrows(() => receive(bob, alice, ct), 'DuplicatedMessage');
  });

  await check(results, cat, 'prekey-consumption', 'One-time PreKey consumption is surfaced/tombstoned', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    await establishSession(alice, bob, await generateBundle(bob));
    const ct = await send(alice, bob, 'consume');
    const result = await decryptMessage(ct.body, ct.message_type, alice.address, bob.address, bob.sessionStore, bob.identityStore, bob.preKeyStore, bob.signedPreKeyStore, bob.kyberPreKeyStore);
    if (dec.decode(result.plaintext) !== 'consume') throw new Error('decrypt failed');
    if (result.oneTimePreKeyId === undefined) throw new Error('no one-time X25519 prekey id reported');
    if (result.kyberPreKeyId === undefined) throw new Error('no Kyber prekey id reported');
    const remainingX = await bob.preKeyStore.export_pre_key(result.oneTimePreKeyId);
    bob.kyberPreKeyStore.remove_kyber_pre_key(result.kyberPreKeyId);
    const remainingK = await bob.kyberPreKeyStore.export_kyber_pre_key(result.kyberPreKeyId);
    if (remainingX !== undefined) throw new Error('X25519 one-time prekey still exportable after decrypt');
    if (remainingK !== undefined) throw new Error('Kyber prekey still exportable after tombstone');
    return `consumed X25519 id ${result.oneTimePreKeyId}, Kyber id ${result.kyberPreKeyId}, signed prekey id ${result.signedPreKeyId}`;
  });

  await check(results, cat, 'pqxdh-surface', 'PQXDH/Kyber PreKey is required by processPreKeyBundle', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    const bundle = await generateBundle(bob);
    await expectThrows(() => processPreKeyBundle(bob.address, alice.address, bundle.registrationId, bundle.identityKey, bundle.signedPreKeyId, WasmPublicKey.deserialize(bundle.signedPreKeyPublic), bundle.signedPreKeySignature, bundle.oneTimePreKeyId, bundle.oneTimePreKeyPublic, bundle.kyberPreKeyId, new Uint8Array(bundle.kyberPreKeyPublic), new Uint8Array(64), alice.sessionStore, alice.identityStore));
    await establishSession(alice, bob, bundle);
    return `valid Kyber public key (${bundle.kyberPreKeyPublic.byteLength} B) and signature (${bundle.kyberPreKeySignature.byteLength} B) accepted; invalid Kyber signature rejected`;
  });

  await check(results, cat, 'safety-number', 'Safety number and QR scannable fingerprint verify cross-perspective', async () => {
    const alice = createClient('Alice');
    const bob = createClient('Bob');
    const aliceView = generateSafetyNumber(alice.userId, alice.identityPair.public_key, bob.userId, bob.identityPair.public_key);
    const bobView = generateSafetyNumber(bob.userId, bob.identityPair.public_key, alice.userId, alice.identityPair.public_key);
    if (!/^\d+( \d+)*$/.test(aliceView.displayable)) throw new Error('displayable safety number is not decimal groups');
    const ok = verifyScannableFingerprint(bobView.scannable, alice.userId, alice.identityPair.public_key, bob.userId, bob.identityPair.public_key);
    if (!ok) throw new Error('cross-perspective QR verification failed');
    return `${aliceView.displayable.replaceAll(' ', '').length} display digits; scannable ${aliceView.scannable.byteLength} B`;
  });

  await check(results, cat, 'private-key-serialization', 'Private material is serializable/exportable from JS API', async () => {
    const bob = createClient('Bob');
    const bundle = await generateBundle(bob);
    const identityPrivate = bob.identityPrivate.serialize();
    const identityPairRecord = bob.identityPair.serialize();
    const preKeyRecord = await bob.preKeyStore.export_pre_key(bundle.oneTimePreKeyId);
    const signedRecord = await bob.signedPreKeyStore.export_signed_pre_key(bundle.signedPreKeyId);
    const kyberRecord = await bob.kyberPreKeyStore.export_kyber_pre_key(bundle.kyberPreKeyId);
    if (!preKeyRecord || !signedRecord || !kyberRecord) throw new Error('missing exported prekey records');
    return `JS can export secret-bearing records: identity private ${identityPrivate.byteLength} B, identity pair ${identityPairRecord.byteLength} B, prekey ${preKeyRecord.byteLength} B, signed ${signedRecord.byteLength} B, kyber ${kyberRecord.byteLength} B`;
  });

  return results;
}

export function summarize(results: CheckResult[]) {
  return {
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: results.filter((r) => r.status === 'FAIL').length,
    info: results.filter((r) => r.status === 'INFO').length,
  };
}
