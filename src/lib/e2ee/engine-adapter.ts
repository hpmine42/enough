// enough. E2EE-v0.2 — Signal-WASM engine adapter.
// ---------------------------------------------------------------------------
// THE ONLY production module that imports `@getmaapp/signal-wasm`. Every other
// layer (UI, api.ts, session-manager, crypto/) talks to this adapter through
// plain serializable types (Uint8Array / number / string). WASM objects never
// cross this boundary.
//
// Engine:      @getmaapp/signal-wasm@0.6.6 (pinned exact)
// License:     AGPL-3.0-only — use in enough. is explicitly approved by the
//              project owner (see docs/e2ee-v02-phase1-engine-adapter.md).
// Protocol:    Signal PQXDH + Double Ratchet (libsignal core, Kyber1024).
//
// LIFETIME MODEL — ephemeral engines, no durable WASM session
//   The crash-safe sequencer in ratchet-session.ts drives every state
//   transition through an `EphemeralEngine`: one FRESH WasmInMemSessionStore
//   per attempt, hydrated from persisted bytes, used once, disposed. A lost
//   compare-and-swap discards the engine + ciphertext and sends nothing. There
//   is NEVER a long-lived mutable WASM session acting as the persistence model.
//   (Verified by real-engine.integration.test.mjs RE1/RE3/RE4.)
//
// WHAT THE ADAPTER OWNS
//   * engine init (browser async / node sync-for-tests)
//   * identity + registration id generation
//   * signed / one-time / kyber prekey generation (returns serializable records)
//   * device-store hydration (build in-memory stores from persisted records)
//   * sender establishment (processPreKeyBundle -> initial session bytes)
//   * the EngineFactory for normal encrypt/decrypt (existing session)
//   * establish-on-receive (first PreKey message, no session yet)
//   * kyber anti-replay usage export/import
//
// WHAT IT DOES NOT OWN
//   * persistence (device-store.ts) or session CAS (ratchet-state.ts)
//   * the commit-before-send ordering (ratchet-session.ts)
//   * Supabase / network / UI

import initWasm, {
  initSync,
  generateRegistrationId,
  WasmPrivateKey,
  WasmPublicKey,
  WasmIdentityKeyPair,
  WasmProtocolAddress,
  WasmInMemIdentityKeyStore,
  WasmInMemSessionStore,
  WasmInMemPreKeyStore,
  WasmInMemSignedPreKeyStore,
  WasmInMemKyberPreKeyStore,
  generatePreKeys,
  generateSignedPreKey as wasmGenerateSignedPreKey,
  generateKyberPreKey as wasmGenerateKyberPreKey,
  processPreKeyBundle,
  encryptMessage,
  decryptMessage,
  verifyIdentitySignature as wasmVerifyIdentitySignature,
} from '@getmaapp/signal-wasm';
import type { EphemeralEngine, EngineFactory } from '../crypto/ratchet-session.ts';
import { CryptoError } from '../crypto/errors.ts';

/* ------------------------------------------------------------------ */
/* Engine initialization                                               */
/* ------------------------------------------------------------------ */

let engineReady = false;
let readyPromise: Promise<void> | null = null;

/**
 * Initialise the WASM engine. In the browser the async default export fetches
 * and instantiates the module. Must be awaited before any engine operation.
 * Idempotent.
 */
export async function ensureEngineReady(): Promise<void> {
  if (engineReady) return;
  if (!readyPromise) {
    readyPromise = (async () => {
      await initWasm();
      engineReady = true;
    })().catch((e: unknown) => {
      readyPromise = null;
      throw new CryptoError('NOT_AVAILABLE', 'Signal engine initialization failed.', e);
    });
  }
  await readyPromise;
}

/**
 * Test/Node-only initialiser: synchronously instantiate from pre-read wasm
 * bytes (browsers fetch asynchronously; raw Node ESM cannot). Call once in a
 * test `before()` hook.
 */
export function initEngineSyncForTests(wasmModule: BufferSource | WebAssembly.Module): void {
  initSync({ module: wasmModule as BufferSource });
  engineReady = true;
  readyPromise = Promise.resolve();
}

/* ------------------------------------------------------------------ */
/* Address / wire helpers                                              */
/* ------------------------------------------------------------------ */

/** Build the protocol address for a peer (v0.2: one device per account). */
export function peerProtocolAddress(userId: string, deviceId: number = 1): WasmProtocolAddress {
  return new WasmProtocolAddress(userId, deviceId);
}

/**
 * Encode a libsignal ciphertext for the opaque `EphemeralEngine` wire:
 * byte 0 = message type (2 | 3), bytes 1.. = body. The session manager splits
 * this back into the JSON envelope `{v,e,t,b}` for Supabase and reconstructs
 * it on receive. ratchet-session.ts treats the whole Uint8Array as opaque.
 */
export function encodeWireCiphertext(messageType: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.byteLength + 1);
  out[0] = messageType;
  out.set(body, 1);
  return out;
}

export function decodeWireCiphertext(wire: Uint8Array): { type: number; body: Uint8Array } {
  if (!(wire instanceof Uint8Array) || wire.byteLength < 1) {
    throw new CryptoError('CORRUPT_STATE', 'Invalid ciphertext wire encoding.');
  }
  return { type: wire[0]!, body: wire.subarray(1) };
}

/* ------------------------------------------------------------------ */
/* Identity + registration id                                          */
/* ------------------------------------------------------------------ */

export interface GeneratedIdentity {
  /** Serialized WasmIdentityKeyPair (private-bearing). */
  identityPairBytes: Uint8Array;
  registrationId: number;
  /** Serialized Signal identity public key (for publishing). */
  identityPublicKeyBytes: Uint8Array;
}

export async function generateIdentity(): Promise<GeneratedIdentity> {
  await ensureEngineReady();
  const priv = WasmPrivateKey.generate();
  const pair = new WasmIdentityKeyPair(priv.getPublicKey(), priv);
  try {
    return {
      identityPairBytes: pair.serialize(),
      registrationId: generateRegistrationId(),
      identityPublicKeyBytes: pair.public_key.serialize(),
    };
  } finally {
    priv.free();
    pair.free();
  }
}

/** Re-derive the public identity key bytes from a serialized pair. */
export async function identityPublicKeyFromPair(pairBytes: Uint8Array): Promise<Uint8Array> {
  await ensureEngineReady();
  const pair = WasmIdentityKeyPair.deserialize(pairBytes);
  try {
    return pair.public_key.serialize();
  } finally {
    pair.free();
  }
}

/**
 * Verify an Ed25519 signature made with the identity key (`message` is the
 * exact byte string that was signed — for a signed prekey, its serialized
 * engine public key).
 *
 * Used by the F8 rotation lifecycle to confirm that advertised public
 * material really belongs to the local identity key. No new primitive: this
 * is the engine's own identity-signature verification.
 */
export async function verifyIdentitySignature(
  identityPublicKeyBytes: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  await ensureEngineReady();
  const pub = WasmPublicKey.deserialize(identityPublicKeyBytes);
  try {
    return wasmVerifyIdentitySignature(pub, message, signature);
  } finally {
    pub.free();
  }
}

/* ------------------------------------------------------------------ */
/* Registration id byte encoding (device-store stores Uint8Array)      */
/* ------------------------------------------------------------------ */

export function encodeRegistrationId(registrationId: number): Uint8Array {
  if (!Number.isInteger(registrationId) || registrationId < 0 || registrationId > 0xffffffff) {
    throw new CryptoError('CORRUPT_STATE', 'registration id out of u32 range');
  }
  const out = new Uint8Array(4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, registrationId, false);
  return out;
}

export function decodeRegistrationId(bytes: Uint8Array): number {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 4) {
    throw new CryptoError('CORRUPT_STATE', 'registration id must be 4 bytes');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getUint32(0, false);
}

/* ------------------------------------------------------------------ */
/* Prekey generation (returns serializable records + public material)  */
/* ------------------------------------------------------------------ */

export interface GeneratedOneTimePreKey {
  id: number;
  /** Private-bearing record to persist in device-store. */
  record: Uint8Array;
  /** Raw public key bytes to publish. */
  publicKey: Uint8Array;
}

export interface GeneratedSignedPreKey {
  id: number;
  record: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
}

export interface GeneratedKyberPreKey {
  id: number;
  record: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
}

export async function generateOneTimePreKeys(
  startId: number,
  count: number,
): Promise<GeneratedOneTimePreKey[]> {
  if (!Number.isInteger(startId) || startId < 1 || !Number.isInteger(count) || count < 1) {
    throw new CryptoError('CORRUPT_STATE', 'invalid prekey id range');
  }
  await ensureEngineReady();
  const store = new WasmInMemPreKeyStore();
  try {
    const keys = await generatePreKeys(startId, count, store);
    const out: GeneratedOneTimePreKey[] = [];
    for (const k of keys) {
      const record = await store.export_pre_key(k.id);
      if (!record) throw new CryptoError('CRYPTO_ERROR', 'generated prekey was not exportable');
      out.push({ id: k.id, record, publicKey: new Uint8Array(k.public_key) });
      k.free();
    }
    return out;
  } finally {
    store.free();
  }
}

export async function generateSignedPreKey(
  identityPairBytes: Uint8Array,
  id: number,
): Promise<GeneratedSignedPreKey> {
  if (!Number.isInteger(id) || id < 1) {
    throw new CryptoError('CORRUPT_STATE', 'invalid signed prekey id');
  }
  await ensureEngineReady();
  const pair = WasmIdentityKeyPair.deserialize(identityPairBytes);
  const store = new WasmInMemSignedPreKeyStore();
  try {
    const spk = await wasmGenerateSignedPreKey(id, pair, store);
    const record = await store.export_signed_pre_key(spk.id);
    if (!record) throw new CryptoError('CRYPTO_ERROR', 'generated signed prekey was not exportable');
    const result: GeneratedSignedPreKey = {
      id: spk.id,
      record,
      publicKey: new Uint8Array(spk.public_key),
      signature: new Uint8Array(spk.signature),
    };
    spk.free();
    return result;
  } finally {
    store.free();
    pair.free();
  }
}

export async function generateKyberPreKey(
  identityPairBytes: Uint8Array,
  id: number,
): Promise<GeneratedKyberPreKey> {
  if (!Number.isInteger(id) || id < 1) {
    throw new CryptoError('CORRUPT_STATE', 'invalid kyber prekey id');
  }
  await ensureEngineReady();
  const pair = WasmIdentityKeyPair.deserialize(identityPairBytes);
  const store = new WasmInMemKyberPreKeyStore();
  try {
    const kpk = await wasmGenerateKyberPreKey(id, pair, store);
    const record = await store.export_kyber_pre_key(kpk.id);
    if (!record) throw new CryptoError('CRYPTO_ERROR', 'generated kyber prekey was not exportable');
    const result: GeneratedKyberPreKey = {
      id: kpk.id,
      record,
      publicKey: new Uint8Array(kpk.public_key),
      signature: new Uint8Array(kpk.signature),
    };
    kpk.free();
    return result;
  } finally {
    store.free();
    pair.free();
  }
}

/* ------------------------------------------------------------------ */
/* Device-store hydration (persisted records -> in-memory stores)      */
/* ------------------------------------------------------------------ */

export interface DeviceRecords {
  identityPairBytes: Uint8Array;
  registrationId: number;
  signedPreKey: { id: number; record: Uint8Array };
  /**
   * Previously advertised signed prekeys that are retained after rotation
   * (F8). They are imported alongside the current key so a handshake that
   * was started against an older bundle can still be completed. Entries
   * whose id equals `signedPreKey.id` are skipped.
   */
  retainedSignedPreKeys?: { id: number; record: Uint8Array }[];
  oneTimePreKeys: { id: number; record: Uint8Array }[];
  kyberPreKeys: { id: number; record: Uint8Array }[];
  kyberUsage: Uint8Array | null;
}

export interface HydratedDevice {
  identityStore: WasmInMemIdentityKeyStore;
  preKeyStore: WasmInMemPreKeyStore;
  signedPreKeyStore: WasmInMemSignedPreKeyStore;
  kyberPreKeyStore: WasmInMemKyberPreKeyStore;
  /** Free every owned WASM object. Idempotent. */
  free(): void;
}

/**
 * Rebuild the four in-memory engine stores from persisted records. This is
 * the "reload" half of the device-store round-trip: every record is opaque
 * bytes that the engine re-imports verbatim.
 */
export async function hydrateDevice(records: DeviceRecords): Promise<HydratedDevice> {
  await ensureEngineReady();
  const pair = WasmIdentityKeyPair.deserialize(records.identityPairBytes);
  const identityStore = new WasmInMemIdentityKeyStore(pair, records.registrationId);
  const preKeyStore = new WasmInMemPreKeyStore();
  const signedPreKeyStore = new WasmInMemSignedPreKeyStore();
  const kyberPreKeyStore = new WasmInMemKyberPreKeyStore();

  await signedPreKeyStore.import_signed_pre_key(records.signedPreKey.id, records.signedPreKey.record);
  // F8: retained (rotated-out) signed prekeys stay addressable by their id.
  for (const prev of records.retainedSignedPreKeys ?? []) {
    if (prev.id === records.signedPreKey.id) continue;
    await signedPreKeyStore.import_signed_pre_key(prev.id, prev.record);
  }
  for (const otk of records.oneTimePreKeys) {
    await preKeyStore.import_pre_key(otk.id, otk.record);
  }
  for (const kpk of records.kyberPreKeys) {
    await kyberPreKeyStore.import_kyber_pre_key(kpk.id, kpk.record);
  }
  if (records.kyberUsage) {
    kyberPreKeyStore.import_kyber_usage(records.kyberUsage);
  }

  let freed = false;
  return {
    identityStore,
    preKeyStore,
    signedPreKeyStore,
    kyberPreKeyStore,
    free(): void {
      if (freed) return;
      freed = true;
      for (const obj of [kyberPreKeyStore, signedPreKeyStore, preKeyStore, identityStore, pair]) {
        try {
          obj.free();
        } catch {
          /* a partially-freed object must not abort the rest */
        }
      }
    },
  };
}

/** Export the kyber anti-replay memory for durable storage (sync). */
export function exportKyberUsage(kyberPreKeyStore: WasmInMemKyberPreKeyStore): Uint8Array {
  return kyberPreKeyStore.export_kyber_usage();
}

/* ------------------------------------------------------------------ */
/* Sender establishment                                                */
/* ------------------------------------------------------------------ */

export interface PeerBundleBytes {
  registrationId: number;
  /** Serialized Signal identity public key. */
  identityKey: Uint8Array;
  signedPreKeyId: number;
  /** Raw signed-prekey public key bytes. */
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  oneTimePreKeyId: number | null;
  /** Raw one-time prekey public key bytes (null when none was claimed). */
  oneTimePreKey: Uint8Array | null;
  kyberPreKeyId: number;
  /** Raw Kyber1024 public key bytes. */
  kyberPreKey: Uint8Array;
  kyberPreKeySignature: Uint8Array;
}

export interface PartyAddress {
  name: string;
  deviceId: number;
}

/**
 * Establish a session as the SENDER: process the peer's prekey bundle into a
 * fresh session store and return the initial session bytes. The caller
 * persists them via `adoptSessionFromEstablishment`. The peer's identity is
 * saved (TOFU) into `localDevice.identityStore`.
 */
export async function establishSenderSession(
  localDevice: HydratedDevice,
  local: PartyAddress,
  peer: PartyAddress,
  bundle: PeerBundleBytes,
): Promise<Uint8Array> {
  await ensureEngineReady();
  const peerAddr = new WasmProtocolAddress(peer.name, peer.deviceId);
  const localAddr = new WasmProtocolAddress(local.name, local.deviceId);
  const sessionStore = new WasmInMemSessionStore();
  const identityKey = WasmPublicKey.deserialize(bundle.identityKey);
  const signedPreKey = WasmPublicKey.deserialize(bundle.signedPreKey);
  try {
    await processPreKeyBundle(
      peerAddr,
      localAddr,
      bundle.registrationId,
      identityKey,
      bundle.signedPreKeyId,
      signedPreKey,
      bundle.signedPreKeySignature,
      bundle.oneTimePreKeyId,
      bundle.oneTimePreKey,
      bundle.kyberPreKeyId,
      bundle.kyberPreKey,
      bundle.kyberPreKeySignature,
      sessionStore,
      localDevice.identityStore,
    );
    const initial = await sessionStore.export_session(peerAddr);
    if (!initial) {
      throw new CryptoError('CRYPTO_ERROR', 'processPreKeyBundle produced no session');
    }
    return new Uint8Array(initial);
  } finally {
    try { sessionStore.free(); } catch { /* */ }
    try { peerAddr.free(); } catch { /**/ }
    try { localAddr.free(); } catch { /**/ }
    try { identityKey.free(); } catch { /**/ }
    try { signedPreKey.free(); } catch { /**/ }
  }
}

/* ------------------------------------------------------------------ */
/* EngineFactory for normal encrypt/decrypt (existing session)         */
/* ------------------------------------------------------------------ */

/**
 * Build the `EngineFactory` consumed by ratchet-session.ts. Each attempt
 * constructs a FRESH session store from the persisted state bytes, performs
 * one operation, exports the advanced state, and disposes the store. The
 * shared device stores (identity/prekey/…) are read-only across a normal
 * message on an existing session, exactly as verified by RE1.
 */
export function createSessionEngineFactory(
  localDevice: HydratedDevice,
  local: PartyAddress,
  peer: PartyAddress,
): EngineFactory {
  return (stateBytes: Uint8Array): Promise<EphemeralEngine> =>
    (async (): Promise<EphemeralEngine> => {
      await ensureEngineReady();
      const peerAddr = new WasmProtocolAddress(peer.name, peer.deviceId);
      const localAddr = new WasmProtocolAddress(local.name, local.deviceId);
      const sessionStore = new WasmInMemSessionStore();
      await sessionStore.import_session(peerAddr, stateBytes);
      let disposed = false;

      return {
        async encrypt(plaintext: Uint8Array) {
          const ct = await encryptMessage(
            plaintext,
            peerAddr,
            localAddr,
            sessionStore,
            localDevice.identityStore,
          );
          const nextState = await sessionStore.export_session(peerAddr);
          if (!nextState) throw new CryptoError('CRYPTO_ERROR', 'session vanished after encrypt');
          const wire = encodeWireCiphertext(ct.message_type, new Uint8Array(ct.body));
          ct.free();
          return { ciphertext: wire, nextState: new Uint8Array(nextState) };
        },
        async decrypt(wire: Uint8Array) {
          const { type, body } = decodeWireCiphertext(wire);
          const result = await decryptMessage(
            body,
            type,
            peerAddr,
            localAddr,
            sessionStore,
            localDevice.identityStore,
            localDevice.preKeyStore,
            localDevice.signedPreKeyStore,
            localDevice.kyberPreKeyStore,
          );
          const plaintext = new Uint8Array(result.plaintext);
          const nextState = await sessionStore.export_session(peerAddr);
          result.free();
          if (!nextState) throw new CryptoError('CRYPTO_ERROR', 'session vanished after decrypt');
          return { plaintext, nextState: new Uint8Array(nextState) };
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          try { sessionStore.free(); } catch { /**/ }
          try { peerAddr.free(); } catch { /**/ }
          try { localAddr.free(); } catch { /**/ }
        },
      };
    })();
}

/* ------------------------------------------------------------------ */
/* Establish-on-receive (first PreKey message, no session yet)         */
/* ------------------------------------------------------------------ */

export interface DecryptEstablishingResult {
  plaintext: Uint8Array;
  nextState: Uint8Array;
  consumed: {
    oneTimePreKeyId: number | undefined;
    kyberPreKeyId: number | undefined;
    signedPreKeyId: number | undefined;
  };
}

/**
 * Decrypt the FIRST (PreKey) message from a peer when no session exists yet.
 * The engine creates the session from the local device's prekey stores and
 * returns the consumed one-time prekey ids for tombstoning. The caller
 * persists the new session via `adoptSessionFromEstablishment`, removes the
 * consumed kyber record from `localDevice.kyberPreKeyStore`, re-exports
 * `kyber_usage`, and tombstones the consumed ids in device-store.
 *
 * For a Whisper (type 2) message with no session this MUST NOT be called —
 * the session manager fails closed in that case (NEEDS_ESTABLISH).
 */
export async function decryptEstablishingMessage(
  localDevice: HydratedDevice,
  local: PartyAddress,
  sender: PartyAddress,
  ciphertextBody: Uint8Array,
  messageType: number,
): Promise<DecryptEstablishingResult> {
  await ensureEngineReady();
  const senderAddr = new WasmProtocolAddress(sender.name, sender.deviceId);
  const localAddr = new WasmProtocolAddress(local.name, local.deviceId);
  const sessionStore = new WasmInMemSessionStore();
  let result: { plaintext: Uint8Array; oneTimePreKeyId: number | undefined; kyberPreKeyId: number | undefined; signedPreKeyId: number | undefined; free: () => void } | null = null;
  try {
    result = await decryptMessage(
      ciphertextBody,
      messageType,
      senderAddr,
      localAddr,
      sessionStore,
      localDevice.identityStore,
      localDevice.preKeyStore,
      localDevice.signedPreKeyStore,
      localDevice.kyberPreKeyStore,
    );
    const plaintext = new Uint8Array(result.plaintext);
    const nextState = await sessionStore.export_session(senderAddr);
    const consumed = {
      oneTimePreKeyId: result.oneTimePreKeyId,
      kyberPreKeyId: result.kyberPreKeyId,
      signedPreKeyId: result.signedPreKeyId,
    };
    result.free();
    result = null;
    if (!nextState) throw new CryptoError('CRYPTO_ERROR', 'establishing decrypt produced no session');
    return { plaintext, nextState: new Uint8Array(nextState), consumed };
  } finally {
    if (result) {
      try { result.free(); } catch { /**/ }
    }
    try { sessionStore.free(); } catch { /**/ }
    try { senderAddr.free(); } catch { /**/ }
    try { localAddr.free(); } catch { /**/ }
  }
}

/** Remove a consumed one-time kyber prekey from the in-memory store. */
export function removeConsumedKyberPreKey(
  localDevice: HydratedDevice,
  kyberPreKeyId: number,
): boolean {
  return localDevice.kyberPreKeyStore.remove_kyber_pre_key(kyberPreKeyId);
}
