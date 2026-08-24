// enough. E2EE-v0.2 — session manager (orchestration).
// ---------------------------------------------------------------------------
// Ties the engine adapter, device-store, the crash-safe ratchet sequencer and
// the prekey publication layer together. It performs NO cryptography itself.
//
//   SessionManager
//       ↓ uses
//   ratchet-session.ts (encryptCommitSend / decryptAndCommit — commit ordering)
//       ↓ via
//   engine-adapter.ts (EphemeralEngine over a fresh WasmInMemSessionStore)
//       ↓ persisted through
//   device-store.ts (device records) + ratchet-state.ts (session CAS)
//
// Dependencies (Supabase publish/fetch, web lock) are injected so the
// establishment/encrypt/decrypt/peer-trust logic is deterministically testable
// without a backend. In production the defaults wire to prekeys-api.ts and
// navigator.locks.
//
// Multi-tab: every mutating operation runs under an exclusive Web Lock
// `enough-e2ee:<userId>`. If Web Locks are unavailable the manager FAILS
// CLOSED — it never silently falls back to plaintext.

import { CryptoError } from '../crypto/errors.ts';
import {
  adoptSessionFromEstablishment,
} from '../crypto/ratchet-state.ts';
import {
  encryptCommitSend,
  decryptAndCommit,
  inspectSession,
} from '../crypto/ratchet-session.ts';
import { bytesToBase64, base64ToBytes } from '../crypto/serialization.ts';
import {
  generateIdentity,
  identityPublicKeyFromPair,
  generateSignedPreKey,
  generateKyberPreKey,
  generateOneTimePreKeys,
  hydrateDevice,
  establishSenderSession,
  createSessionEngineFactory,
  decryptEstablishingMessage,
  exportKyberUsage,
  removeConsumedKyberPreKey,
  encodeRegistrationId,
  decodeRegistrationId,
  encodeWireCiphertext,
  decodeWireCiphertext,
  type HydratedDevice,
  type PeerBundleBytes,
  type PartyAddress,
} from './engine-adapter.ts';
import {
  saveIdentity, loadIdentity,
  saveRegistrationId, loadRegistrationId,
  saveSignedPreKey, loadSignedPreKey,
  saveOneTimePreKey, listOneTimePreKeys, removeOneTimePreKey, countOneTimePreKeys,
  saveKyberPreKey, listKyberPreKeys, countKyberPreKeys,
  saveKyberLastResort, loadKyberLastResort,
  saveKyberUsage, loadKyberUsage,
  savePeerTrust, loadPeerTrust,
  savePublishedMaterial, loadPublishedMaterial,
} from './device-store.ts';
import type { FetchBundleResult } from './prekeys-api.ts';
import {
  ENVELOPE_VERSION,
  ENVELOPE_ENGINE,
  DEVICE_ID,
  type MessageEnvelope,
  type PublicDeviceMaterial,
  type PublicSignedPreKey,
  type PublicOneTimePreKey,
  type PublicKyberPreKey,
  type PeerPreKeyBundle,
  type SignalMessageType,
} from './types.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export interface SessionManagerOptions {
  userId: string;
  /** Publish public material (production: prekeys-api.publishDeviceMaterial). Required. */
  publisher: (material: PublicDeviceMaterial) => Promise<string | null>;
  /** Fetch a peer bundle (production: prekeys-api.fetchPeerBundle). Required. */
  bundleProvider: (peerUserId: string) => Promise<FetchBundleResult>;
  /** Exclusive lock around a critical section. Default: navigator.locks (fail-closed). */
  acquireLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** One-time prekey pool target. */
  otkPoolSize?: number;
  /** Refill one-time prekeys when the published count drops to/below this. */
  otkThreshold?: number;
  /** One-time Kyber pool target. */
  kyberPoolSize?: number;
  /** Refill one-time Kyber when the published count drops to/below this. */
  kyberThreshold?: number;
}

const SIGNED_PREKEY_ID = 1;
const LAST_RESORT_KYBER_ID = 1;

/** Default Web Lock acquisition; fails closed when the API is absent. */
function defaultAcquireLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return Promise.reject(
      new CryptoError('NOT_AVAILABLE', 'Web Locks API unavailable; E2EE refuses to run unsynchronized.'),
    );
  }
  return new Promise<T>((resolve, reject) => {
    navigator.locks.request(name, { mode: 'exclusive' }, async (lock) => {
      if (!lock) {
        reject(new CryptoError('NOT_AVAILABLE', 'Could not acquire E2EE lock.'));
        return null;
      }
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
      return undefined;
    });
  });
}

/**
 * The result of decrypting an incoming row. `legacy` marks pre-E2EE plaintext
 * rows that must still render as-is during the transition.
 */
export interface DecryptOutcome {
  plaintext: string;
  legacy: boolean;
}

export class E2EESessionManager {
  private readonly userId: string;
  private readonly publisher: (m: PublicDeviceMaterial) => Promise<string | null>;
  private readonly bundleProvider: (peerUserId: string) => Promise<FetchBundleResult>;
  private readonly acquireLock: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  private readonly otkPoolSize: number;
  private readonly otkThreshold: number;
  private readonly kyberPoolSize: number;
  private readonly kyberThreshold: number;
  private device: HydratedDevice | null = null;

  constructor(opts: SessionManagerOptions) {
    if (!opts.userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
    this.userId = opts.userId;
    this.publisher = opts.publisher;
    this.bundleProvider = opts.bundleProvider;
    this.acquireLock = opts.acquireLock ?? defaultAcquireLock;
    this.otkPoolSize = opts.otkPoolSize ?? 50;
    this.otkThreshold = opts.otkThreshold ?? 10;
    this.kyberPoolSize = opts.kyberPoolSize ?? 5;
    this.kyberThreshold = opts.kyberThreshold ?? 2;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Load or create the local device identity + prekey pools, publish the
   * public material, and hydrate the in-memory engine stores. Idempotent;
   * safe on every app start. Must run before encrypt/decrypt.
   */
  async initialize(): Promise<void> {
    await this.acquireLock(this.lockName(), () => this.initializeLocked());
  }

  private async initializeLocked(): Promise<void> {
    // Identity
    let identityPairBytes = await loadIdentity(this.userId);
    let registrationId: number;
    if (!identityPairBytes) {
      const ident = await generateIdentity();
      identityPairBytes = ident.identityPairBytes;
      registrationId = ident.registrationId;
      await saveIdentity(this.userId, identityPairBytes);
      await saveRegistrationId(this.userId, encodeRegistrationId(registrationId));
    } else {
      const regBytes = await loadRegistrationId(this.userId);
      if (!regBytes) throw new CryptoError('CORRUPT_STATE', 'registration id missing.');
      registrationId = decodeRegistrationId(regBytes);
    }

    // Signed prekey (id fixed at 1 in v0.2; rotation is deferred).
    let spkRecord = await loadSignedPreKey(this.userId);
    let spkPublic: PublicSignedPreKey | null = null;
    if (!spkRecord) {
      const spk = await generateSignedPreKey(identityPairBytes, SIGNED_PREKEY_ID);
      spkRecord = spk.record;
      spkPublic = { keyId: spk.id, publicKey: bytesToBase64(spk.publicKey), signature: bytesToBase64(spk.signature) };
      await saveSignedPreKey(this.userId, spkRecord);
    }

    // Last-resort Kyber (id fixed at 1; reusable).
    let lastResortRecord = await loadKyberLastResort(this.userId);
    let lastResortPublic: PublicKyberPreKey | null = null;
    if (!lastResortRecord) {
      const kpk = await generateKyberPreKey(identityPairBytes, LAST_RESORT_KYBER_ID);
      lastResortRecord = kpk.record;
      lastResortPublic = {
        keyId: kpk.id,
        publicKey: bytesToBase64(kpk.publicKey),
        signature: bytesToBase64(kpk.signature),
        isLastResort: true,
      };
      await saveKyberLastResort(this.userId, lastResortRecord);
    }

    // One-time prekey pool.
    const otpCount = await countOneTimePreKeys(this.userId);
    const newOtps: PublicOneTimePreKey[] = [];
    if (otpCount <= this.otkThreshold) {
      const startId = (await this.nextPreKeyId());
      const need = Math.max(0, this.otkPoolSize - otpCount);
      if (need > 0) {
        const generated = await generateOneTimePreKeys(startId, need);
        for (const otk of generated) {
          await saveOneTimePreKey(this.userId, otk.id, otk.record);
          newOtps.push({ keyId: otk.id, publicKey: bytesToBase64(otk.publicKey) });
        }
      }
    }

    // One-time Kyber pool.
    const kyberCount = await countKyberPreKeys(this.userId);
    const newKyber: PublicKyberPreKey[] = [];
    if (kyberCount <= this.kyberThreshold) {
      const startId = (await this.nextKyberId());
      const need = Math.max(0, this.kyberPoolSize - kyberCount);
      if (need > 0) {
        const generated = await generateKyberPreKeysBatch(identityPairBytes, startId, need);
        for (const kpk of generated) {
          await saveKyberPreKey(this.userId, kpk.id, kpk.record);
          newKyber.push({
            keyId: kpk.id,
            publicKey: bytesToBase64(kpk.publicKey),
            signature: bytesToBase64(kpk.signature),
            isLastResort: false,
          });
        }
      }
    }

    // Publish if anything is new, or always on first init (cached material).
    const material = await this.buildPublicMaterial(
      identityPairBytes,
      registrationId,
      spkPublic,
      lastResortPublic,
      newOtps,
      newKyber,
    );
    const err = await this.publisher(material);
    if (err) {
      throw new CryptoError('STORAGE_ERROR', `Prekey publication failed: ${err}`);
    }

    this.device = await this.hydrateFromStore();
  }

  /** Drop in-memory engine state. IndexedDB persists (logout). */
  destroy(): void {
    if (this.device) {
      this.device.free();
      this.device = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Encrypt (send)                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Encrypt `plaintext` for a peer. Establishes the session on first contact
   * (fetching the peer bundle via the injected provider). Returns the JSON
   * envelope string to store in messages.ciphertext.
   */
  async encryptForPeer(peerUserId: string, connectionId: string, plaintext: string): Promise<string> {
    if (!this.device) throw new CryptoError('NOT_INITIALIZED', 'Call initialize() first.');
    const local: PartyAddress = { name: this.userId, deviceId: DEVICE_ID };
    const peer: PartyAddress = { name: peerUserId, deviceId: DEVICE_ID };
    return this.acquireLock(this.lockName(), async () => {
      await this.ensureEstablished(peerUserId, connectionId, local, peer);
      let wire: Uint8Array | null = null;
      await encryptCommitSend({
        userId: this.userId,
        connectionId,
        plaintext: TEXT_ENCODER.encode(plaintext),
        createEngine: createSessionEngineFactory(this.device!, local, peer),
        send: (c) => {
          wire = c;
        },
      });
      if (!wire) throw new CryptoError('CRYPTO_ERROR', 'encrypt produced no ciphertext');
      return envelopeToJSON(wireToEnvelope(wire));
    });
  }

  /* ---------------------------------------------------------------- */
  /* Decrypt (receive)                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Decrypt an incoming `messages.ciphertext` value.
   *  - Legacy plaintext (not an envelope) → returned as-is with `legacy: true`.
   *  - PreKey envelope with no session → establish-on-receive, tombstone keys.
   *  - Whisper envelope on an existing session → normal decrypt-and-commit.
   *  - Whisper envelope with NO session → fails closed (NEEDS_ESTABLISH):
   *    a session is never invented from a non-PreKey message.
   */
  async decryptFromPeer(senderUserId: string, connectionId: string, ciphertextValue: string): Promise<DecryptOutcome> {
    if (!this.device) throw new CryptoError('NOT_INITIALIZED', 'Call initialize() first.');
    const envelope = parseEnvelope(ciphertextValue);
    if (!envelope) {
      return { plaintext: ciphertextValue, legacy: true };
    }
    const local: PartyAddress = { name: this.userId, deviceId: DEVICE_ID };
    const sender: PartyAddress = { name: senderUserId, deviceId: DEVICE_ID };
    const wire = envelopeToWire(envelope);
    return this.acquireLock(this.lockName(), async () => {
      const session = await inspectSession(this.userId, connectionId);
      if (session.status !== 'VALID') {
        if (envelope.t === 3 /* PREKEY */) {
          return { plaintext: await this.receiveEstablish(senderUserId, connectionId, sender, local, wire), legacy: false };
        }
        // MISSING + Whisper: a session must not be invented. Fail closed.
        throw new CryptoError('NEEDS_ESTABLISH', 'No session for a Whisper message; refusing to invent one.');
      }
      const result = await decryptAndCommit({
        userId: this.userId,
        connectionId,
        ciphertext: wire,
        createEngine: createSessionEngineFactory(this.device!, local, sender),
      });
      return { plaintext: TEXT_DECODER.decode(result.plaintext), legacy: false };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                        */
  /* ---------------------------------------------------------------- */

  private lockName(): string {
    return `enough-e2ee:${this.userId}`;
  }

  private async ensureEstablished(
    peerUserId: string,
    connectionId: string,
    local: PartyAddress,
    peer: PartyAddress,
  ): Promise<void> {
    const session = await inspectSession(this.userId, connectionId);
    if (session.status === 'VALID') return;
    if (session.status !== 'MISSING') {
      throw new CryptoError('CORRUPT_STATE', `Cannot establish over session status ${session.status}.`);
    }
    const fetched = await this.bundleProvider(peerUserId);
    if (fetched.kind !== 'ok') {
      throw bundleError(fetched);
    }
    await this.applyPeerTrust(peerUserId, fetched.bundle.identityKey);
    const bundle = bundleToBytes(fetched.bundle);
    const initial = await establishSenderSession(this.device!, local, peer, bundle);
    await adoptSessionFromEstablishment(this.userId, connectionId, initial);
  }

  private async receiveEstablish(
    senderUserId: string,
    connectionId: string,
    sender: PartyAddress,
    local: PartyAddress,
    wire: Uint8Array,
  ): Promise<string> {
    const { type, body } = decodeWireCiphertext(wire);
    const established = await decryptEstablishingMessage(this.device!, local, sender, body, type);
    await adoptSessionFromEstablishment(this.userId, connectionId, established.nextState);
    // Tombstone consumed one-time keys and persist updated kyber anti-replay.
    const consumed = established.consumed;
    if (consumed.kyberPreKeyId !== undefined) {
      removeConsumedKyberPreKey(this.device!, consumed.kyberPreKeyId);
      await saveKyberUsage(this.userId, exportKyberUsage(this.device!.kyberPreKeyStore));
    }
    if (consumed.oneTimePreKeyId !== undefined) {
      await removeOneTimePreKey(this.userId, consumed.oneTimePreKeyId);
    }
    void senderUserId;
    return TEXT_DECODER.decode(established.plaintext);
  }

  /**
   * Trust-on-first-use: record the peer's identity key on first contact and
   * reject a changed key. The engine's own identity store additionally rejects
   * messages whose embedded identity does not match the session.
   */
  private async applyPeerTrust(peerUserId: string, identityKeyB64: string): Promise<void> {
    const stored = await loadPeerTrust(this.userId, peerUserId);
    const record = TEXT_ENCODER.encode(JSON.stringify({ identityKey: identityKeyB64, state: 'unverified' }));
    if (!stored) {
      await savePeerTrust(this.userId, peerUserId, record);
      return;
    }
    let parsed: { identityKey?: string; state?: string };
    try {
      parsed = JSON.parse(TEXT_DECODER.decode(stored));
    } catch {
      throw new CryptoError('CORRUPT_STATE', 'Stored peer trust record is malformed.');
    }
    if (parsed.identityKey !== identityKeyB64) {
      throw new CryptoError('USER_MISMATCH', 'Peer identity key changed; verification required.');
    }
  }

  private async hydrateFromStore(): Promise<HydratedDevice> {
    const identityPairBytes = await loadIdentity(this.userId);
    const regBytes = await loadRegistrationId(this.userId);
    const spkRecord = await loadSignedPreKey(this.userId);
    const lastResort = await loadKyberLastResort(this.userId);
    if (!identityPairBytes || !regBytes || !spkRecord || !lastResort) {
      throw new CryptoError('CORRUPT_STATE', 'Device not fully provisioned.');
    }
    const registrationId = decodeRegistrationId(regBytes);
    const otpList = await listOneTimePreKeys(this.userId);
    const kpkList = await listKyberPreKeys(this.userId);
    const kyberUsage = await loadKyberUsage(this.userId);
    return hydrateDevice({
      identityPairBytes,
      registrationId,
      signedPreKey: { id: SIGNED_PREKEY_ID, record: spkRecord },
      oneTimePreKeys: otpList.map((o) => ({ id: Number(o.keyId), record: o.body })),
      kyberPreKeys: [
        { id: LAST_RESORT_KYBER_ID, record: lastResort },
        ...kpkList.map((k) => ({ id: Number(k.keyId), record: k.body })),
      ],
      kyberUsage,
    });
  }

  private async nextPreKeyId(): Promise<number> {
    const all = await listOneTimePreKeys(this.userId);
    return all.reduce((max, k) => Math.max(max, Number(k.keyId)), 0) + 1;
  }

  private async nextKyberId(): Promise<number> {
    const all = await listKyberPreKeys(this.userId);
    return all.reduce((max, k) => Math.max(max, Number(k.keyId)), 0) + 1;
  }

  /**
   * Build the full PublicDeviceMaterial. Reloads cached published material so
   * every publish carries the complete set (idempotent server upserts), then
   * merges anything newly generated this init.
   */
  private async buildPublicMaterial(
    identityPairBytes: Uint8Array,
    registrationId: number,
    newSpk: PublicSignedPreKey | null,
    newLastResort: PublicKyberPreKey | null,
    newOtps: PublicOneTimePreKey[],
    newKyber: PublicKyberPreKey[],
  ): Promise<PublicDeviceMaterial> {
    const cached = await loadPublishedMaterial(this.userId);
    let base: PublicDeviceMaterial | null = null;
    if (cached) {
      try {
        base = JSON.parse(TEXT_DECODER.decode(cached)) as PublicDeviceMaterial;
      } catch {
        base = null;
      }
    }
    const identityKey = bytesToBase64(await identityPublicKeyFromPair(identityPairBytes));
    const signedPreKey = newSpk ?? base?.signedPreKey ?? mustHave('signedPreKey');
    const kyber: PublicKyberPreKey[] = [];
    const seenKyber = new Set<number>();
    if (newLastResort) {
      kyber.push(newLastResort);
      seenKyber.add(newLastResort.keyId);
    }
    for (const k of newKyber) {
      if (!seenKyber.has(k.keyId)) {
        kyber.push(k);
        seenKyber.add(k.keyId);
      }
    }
    for (const k of base?.kyberPreKeys ?? []) {
      if (!seenKyber.has(k.keyId)) {
        kyber.push(k);
        seenKyber.add(k.keyId);
      }
    }
    const otps: PublicOneTimePreKey[] = [
      ...newOtps,
      ...(base?.oneTimePreKeys ?? []).filter((o) => !newOtps.some((n) => n.keyId === o.keyId)),
    ];
    const material: PublicDeviceMaterial = {
      identityKey,
      registrationId,
      signedPreKey,
      oneTimePreKeys: otps,
      kyberPreKeys: kyber,
    };
    await savePublishedMaterial(this.userId, TEXT_ENCODER.encode(JSON.stringify(material)));
    return material;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function mustHave(name: string): never {
  throw new CryptoError('CORRUPT_STATE', `Missing device material: ${name}`);
}

async function generateKyberPreKeysBatch(
  identityPairBytes: Uint8Array,
  startId: number,
  count: number,
): Promise<{ id: number; record: Uint8Array; publicKey: Uint8Array; signature: Uint8Array }[]> {
  const out: { id: number; record: Uint8Array; publicKey: Uint8Array; signature: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    out.push(await generateKyberPreKey(identityPairBytes, startId + i));
  }
  return out;
}

function bundleError(r: FetchBundleResult): CryptoError {
  switch (r.kind) {
    case 'self':
      return new CryptoError('NOT_INITIALIZED', 'Cannot establish a session with yourself.');
    case 'blocked':
      return new CryptoError('USER_MISMATCH', 'Peer has blocked you (or you them).');
    case 'no-device':
      return new CryptoError('NEEDS_ESTABLISH', 'Peer has not published a prekey bundle yet.');
    default:
      return new CryptoError('STORAGE_ERROR', `Bundle fetch failed: ${'message' in r ? r.message : 'unknown'}`);
  }
}

/** Convert a public bundle (base64) to the bytes the adapter consumes. */
function bundleToBytes(bundle: PeerPreKeyBundle): PeerBundleBytes {
  return {
    registrationId: bundle.registrationId,
    identityKey: base64ToBytes(bundle.identityKey),
    signedPreKeyId: bundle.signedPreKey.keyId,
    signedPreKey: base64ToBytes(bundle.signedPreKey.publicKey),
    signedPreKeySignature: base64ToBytes(bundle.signedPreKey.signature),
    oneTimePreKeyId: bundle.oneTimePreKey?.keyId ?? null,
    oneTimePreKey: bundle.oneTimePreKey ? base64ToBytes(bundle.oneTimePreKey.publicKey) : null,
    kyberPreKeyId: bundle.kyberPreKey.keyId,
    kyberPreKey: base64ToBytes(bundle.kyberPreKey.publicKey),
    kyberPreKeySignature: base64ToBytes(bundle.kyberPreKey.signature),
  };
}

/** Parse a messages.ciphertext value into an envelope, or null if legacy plaintext. */
export function parseEnvelope(value: string): MessageEnvelope | null {
  if (typeof value !== 'string' || value.length === 0 || value[0] !== '{') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const e = parsed as Partial<MessageEnvelope>;
  if (e.v !== ENVELOPE_VERSION || e.e !== ENVELOPE_ENGINE) return null;
  if (e.t !== 2 && e.t !== 3) return null;
  if (typeof e.b !== 'string') return null;
  return { v: ENVELOPE_VERSION, e: ENVELOPE_ENGINE, t: e.t as SignalMessageType, b: e.b };
}

function wireToEnvelope(wire: Uint8Array): MessageEnvelope {
  const { type, body } = decodeWireCiphertext(wire);
  return { v: ENVELOPE_VERSION, e: ENVELOPE_ENGINE, t: type as SignalMessageType, b: bytesToBase64(body) };
}

function envelopeToWire(env: MessageEnvelope): Uint8Array {
  return encodeWireCiphertext(env.t, base64ToBytes(env.b));
}

export function envelopeToJSON(env: MessageEnvelope): string {
  return JSON.stringify(env);
}
