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
  verifyIdentitySignature,
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
  saveSignedPreKey, loadSignedPreKey, removeSignedPreKey,
  saveSignedPreKeyRecord, loadSignedPreKeyRecord, removeSignedPreKeyRecord, listSignedPreKeyRecords,
  saveSignedPreKeyMeta, loadSignedPreKeyMeta,
  saveOneTimePreKey, listOneTimePreKeys, removeOneTimePreKey, countOneTimePreKeys,
  saveKyberPreKey, listKyberPreKeys, countKyberPreKeys, removeKyberPreKey,
  saveKyberLastResort, loadKyberLastResort,
  saveKyberUsage, loadKyberUsage,
  savePeerTrust, loadPeerTrust,
  savePublishedMaterial, loadPublishedMaterial,
} from './device-store.ts';
import type { FetchBundleResult } from './prekeys-api.ts';
import { SIGNED_PREKEY_ROTATION_MS } from '../crypto/prekeys.ts';
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

const LAST_RESORT_KYBER_ID = 1;

/* ------------------------------------------------------------------ */
/* F8 — Signed-PreKey rotation                                         */
/* ------------------------------------------------------------------ */
// A signed prekey is long-lived, but not permanent. The lifecycle below
// rotates the CURRENT (advertised) signed prekey after the project's
// documented interval and keeps a bounded set of previously advertised keys
// available, because a peer may have claimed the older bundle shortly before
// the rotation and must still be able to complete that handshake.
//
// The key id is never a constant: every rotation mints a new id, and the
// record holding it is addressed by that id.

/**
 * Id of the fixed signed prekey of the pre-F8 implementation.
 *
 * Used ONLY to migrate an existing record into the rotating key set. No part
 * of the rotation lifecycle depends on this value.
 */
const LEGACY_SIGNED_PREKEY_ID = 1;

/**
 * How many previously advertised signed prekeys remain available for
 * private-key lookup after they stopped being current.
 *
 * The architecture cannot observe when a peer stops referencing an
 * advertised signed prekey, so retention is deliberately conservative
 * instead of guessed-from-usage: with the 30-day rotation interval a key
 * stays available for at least (RETENTION_COUNT + 1) full intervals — far
 * beyond any in-flight handshake window.
 */
const SIGNED_PREKEY_RETENTION_COUNT = 2;

/** Format version of the persisted current-signed-prekey metadata. */
const SIGNED_PREKEY_META_VERSION = 1;

/**
 * Serialized sizes of the advertised signed prekey material: the engine's
 * serialized X25519 public key (1 type byte + 32 key bytes) and the Ed25519
 * signature over it. Unchanged from the pre-F8 format.
 */
const SPK_PUBLIC_KEY_BYTES = 33;
const SPK_SIGNATURE_BYTES = 64;

/**
 * The current signed prekey, as advertised: its id, its PUBLIC key material
 * and the time the key was created (the rotation clock).
 *
 * This metadata mirrors what the engine keeps in the private record and is
 * the single pointer that decides which persisted record is current. It
 * contains no private material.
 */
interface SignedPreKeyMeta {
  keyId: number;
  publicKey: string;
  signature: string;
  createdAt: number;
}

function encodeSignedPreKeyMeta(meta: SignedPreKeyMeta): Uint8Array {
  return TEXT_ENCODER.encode(
    JSON.stringify({ v: SIGNED_PREKEY_META_VERSION, ...meta }),
  );
}

/** Decode persisted current-signed-prekey metadata. Fails closed on garbage. */
function decodeSignedPreKeyMeta(bytes: Uint8Array): SignedPreKeyMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey metadata is malformed.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey metadata is malformed.');
  }
  const m = parsed as Partial<SignedPreKeyMeta> & { v?: number };
  if (
    m.v !== SIGNED_PREKEY_META_VERSION ||
    !Number.isInteger(m.keyId) || (m.keyId as number) < 1 ||
    typeof m.publicKey !== 'string' ||
    typeof m.signature !== 'string' ||
    !Number.isFinite(m.createdAt)
  ) {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey metadata is invalid.');
  }
  // Reject metadata that cannot describe a real signed prekey.
  if (
    base64ToBytes(m.publicKey).byteLength !== SPK_PUBLIC_KEY_BYTES ||
    base64ToBytes(m.signature).byteLength !== SPK_SIGNATURE_BYTES
  ) {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey metadata has invalid key material.');
  }
  return { keyId: m.keyId as number, publicKey: m.publicKey, signature: m.signature, createdAt: m.createdAt as number };
}

function isSignedPreKeyRotationDue(meta: SignedPreKeyMeta): boolean {
  return Date.now() - meta.createdAt >= SIGNED_PREKEY_ROTATION_MS;
}

/** PUBLIC part of the metadata: what peers are served. */
function publicSignedPreKeyOf(meta: SignedPreKeyMeta): PublicSignedPreKey {
  return { keyId: meta.keyId, publicKey: meta.publicKey, signature: meta.signature };
}

/**
 * Per-user in-process serialization of the device lifecycle.
 *
 * `acquireLock` (Web Locks) serializes tabs and workers, but it does not
 * serialize two managers that share one JS realm, and the injected lock used
 * by the tests is a passthrough. Two interleaved rotations could otherwise
 * publish a public key that belongs to a different private-key record, so
 * `initialize()` and `rotateSignedPreKey()` both run their critical section
 * inside this guard.
 *
 * The Web Lock is always taken FIRST; this guard is never re-entered from
 * inside itself, so the two cannot deadlock.
 */
const userMutexes = new Map<string, Promise<void>>();

function withUserMutex<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = userMutexes.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const forget = (): void => {
    if (userMutexes.get(userId) === guard) userMutexes.delete(userId);
  };
  // `guard` never rejects (both handlers swallow), so a failed critical
  // section cannot wedge the queue for the next caller.
  const guard: Promise<void> = run.then(forget, forget);
  userMutexes.set(userId, guard);
  return run;
}

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
    await this.acquireLock(this.lockName(), () =>
      withUserMutex(this.userId, () => this.initializeLocked()),
    );
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

    // Signed prekey (F8): addressed by its own id, migrated from the legacy
    // fixed key, and rotated when the lifecycle requires it.
    const spkPublic = await this.ensureCurrentSignedPreKey(identityPairBytes);

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
    // The mutex also keeps a concurrent rotation from freeing the in-memory
    // engine (it swaps `this.device`) while this call is in flight.
    return this.acquireLock(this.lockName(), () =>
      withUserMutex(this.userId, async () => {
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
      }),
    );
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
    return this.acquireLock(this.lockName(), () =>
      withUserMutex(this.userId, async () => {
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
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                        */
  /* ---------------------------------------------------------------- */

  private lockName(): string {
    return `enough-e2ee:${this.userId}`;
  }

  /* ---------------------------------------------------------------- */
  /* Signed prekey lifecycle (F8)                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Rotate the current signed prekey (F8).
   *
   * Generates a new signed prekey with a NEW id, persists its private
   * record, makes it the current (and therefore the advertised) key and
   * republishes the public material. The previously advertised key(s) stay
   * available so handshakes that already claimed them can still complete.
   *
   * Runs under the Web Lock and the per-user mutex; returns the new PUBLIC
   * signed prekey. Requires an initialized manager.
   */
  async rotateSignedPreKey(): Promise<PublicSignedPreKey> {
    if (!this.device) throw new CryptoError('NOT_INITIALIZED', 'Call initialize() first.');
    return this.acquireLock(this.lockName(), () =>
      withUserMutex(this.userId, () => this.rotateAndPublish()),
    );
  }

  /** Rotation + republication. Caller holds the lock and the mutex. */
  private async rotateAndPublish(): Promise<PublicSignedPreKey> {
    const identityPairBytes = await loadIdentity(this.userId);
    const regBytes = await loadRegistrationId(this.userId);
    if (!identityPairBytes || !regBytes) {
      throw new CryptoError('CORRUPT_STATE', 'Device not fully provisioned.');
    }
    const meta = await this.rotateSignedPreKeyLocked(identityPairBytes);
    const material = await this.buildPublicMaterial(
      identityPairBytes,
      decodeRegistrationId(regBytes),
      publicSignedPreKeyOf(meta),
      null,
      [],
      [],
    );
    const err = await this.publisher(material);
    if (err) {
      throw new CryptoError('STORAGE_ERROR', `Prekey publication failed: ${err}`);
    }
    // Re-import the new key and the retained ones into the engine stores.
    // Existing sessions are unaffected: they live in the persisted ratchet
    // state, not in the in-memory device.
    const superseded = this.device;
    this.device = await this.hydrateFromStore();
    superseded?.free();
    return publicSignedPreKeyOf(meta);
  }

  /**
   * Resolve the current signed prekey for this device (F8).
   *
   * Migrates pre-F8 state, keeps a valid current key, and rotates it when
   * the lifecycle requires a new one. Returns the PUBLIC material that must
   * be published. Existing sessions and the Double Ratchet state are not
   * touched by any of this.
   */
  private async ensureCurrentSignedPreKey(identityPairBytes: Uint8Array): Promise<PublicSignedPreKey> {
    // Pre-F8 installs keep a single fixed signed prekey in this singleton.
    const legacyRecord = await loadSignedPreKey(this.userId);
    let meta = await this.readCurrentSignedPreKeyMeta();
    if (!meta) {
      meta = await this.adoptLegacySignedPreKey(identityPairBytes, legacyRecord);
    }
    if (!meta || isSignedPreKeyRotationDue(meta)) {
      meta = await this.rotateSignedPreKeyLocked(identityPairBytes);
    }
    if (legacyRecord) {
      // The rotating key set owns the material now (the legacy record was
      // copied into it first); the singleton is redundant private material.
      await removeSignedPreKey(this.userId);
    }
    return publicSignedPreKeyOf(meta);
  }

  /**
   * Generate, persist and activate the next signed prekey.
   *
   * Persistence order is the crash-safety contract:
   *   0. discard records left over from an interrupted rotation,
   *   1. write the new private record (the previous key stays current),
   *   2. flip the single "current" metadata record,
   *   3. only then retire surplus previous keys.
   * An interruption leaves either the old state (1) or the complete new
   * state (2/3) — never a pointer to a key that was not persisted, and never
   * a published key without its private half.
   */
  private async rotateSignedPreKeyLocked(identityPairBytes: Uint8Array): Promise<SignedPreKeyMeta> {
    // 0) A record whose id is HIGHER than the current key's was written by a
    //    rotation that died before step 2. Current ids only ever grow, so
    //    such an id was never current and therefore never published: no peer
    //    can reference it, and dropping it keeps the id sequence tight.
    const superseding = await this.readCurrentSignedPreKeyMeta();
    if (superseding) await this.discardUnpublishedSignedPreKeys(superseding.keyId);
    const keyId = await this.nextSignedPreKeyId();
    const spk = await generateSignedPreKey(identityPairBytes, keyId);
    if (spk.id !== keyId || !(spk.record instanceof Uint8Array) || spk.record.byteLength === 0) {
      throw new CryptoError('CRYPTO_ERROR', 'Signed prekey generation produced an inconsistent key.');
    }
    // 1) New private record first.
    await saveSignedPreKeyRecord(this.userId, keyId, spk.record);
    // 2) The one write that changes which key is current.
    const meta: SignedPreKeyMeta = {
      keyId,
      publicKey: bytesToBase64(spk.publicKey),
      signature: bytesToBase64(spk.signature),
      createdAt: Date.now(),
    };
    await saveSignedPreKeyMeta(this.userId, encodeSignedPreKeyMeta(meta));
    // 3) Retire keys that can no longer be referenced.
    await this.retireSupersededSignedPreKeys(keyId);
    return meta;
  }

  /**
   * Remove signed prekey records that were never published.
   *
   * Only the key the metadata points at is ever advertised, and ids grow
   * monotonically, so any record above the current id is the residue of an
   * interrupted rotation. It has no peer-visible existence.
   */
  private async discardUnpublishedSignedPreKeys(currentKeyId: number): Promise<void> {
    for (const rec of await listSignedPreKeyRecords(this.userId)) {
      const id = Number(rec.keyId);
      if (Number.isInteger(id) && id > currentKeyId) {
        await removeSignedPreKeyRecord(this.userId, id);
      }
    }
  }

  /**
   * Migrate a pre-F8 signed prekey into the rotating key set.
   *
   * The legacy private record is preserved as a retained key either way, so
   * a handshake that already claimed it stays completable. It is adopted as
   * the CURRENT key only when its public half is still known (the cached
   * published material) and its signature verifies under the identity key —
   * otherwise the device generates a fresh current key instead of
   * re-advertising material it cannot describe.
   *
   * Returns null when there was nothing to migrate (fresh device) or when
   * the legacy key could not be adopted.
   */
  private async adoptLegacySignedPreKey(
    identityPairBytes: Uint8Array,
    legacyRecord: Uint8Array | null,
  ): Promise<SignedPreKeyMeta | null> {
    if (!legacyRecord) return null;
    await saveSignedPreKeyRecord(this.userId, LEGACY_SIGNED_PREKEY_ID, legacyRecord);
    const published = await this.loadPublishedSignedPreKey();
    if (
      !published ||
      published.keyId !== LEGACY_SIGNED_PREKEY_ID ||
      !(await isSignedPreKeySignatureValid(identityPairBytes, published))
    ) {
      return null;
    }
    // The legacy key's creation time was never persisted; start the rotation
    // clock now so an upgrade does not rotate away a valid key immediately.
    const adopted: SignedPreKeyMeta = { ...published, createdAt: Date.now() };
    await saveSignedPreKeyMeta(this.userId, encodeSignedPreKeyMeta(adopted));
    return adopted;
  }

  /**
   * Drop signed prekeys that can no longer be referenced (F8 retention).
   *
   * Kept: the current key and the newest RETENTION_COUNT previous keys.
   * Removed: older previous keys, and keys with a HIGHER id than the current
   * one — those are leftovers of a rotation that was interrupted before the
   * current pointer moved, so they were never published and no peer can
   * reference them.
   */
  private async retireSupersededSignedPreKeys(currentKeyId: number): Promise<void> {
    const ids = (await listSignedPreKeyRecords(this.userId))
      .map((r) => Number(r.keyId))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b);
    const kept = new Set<number>([currentKeyId]);
    for (const id of ids.filter((id) => id < currentKeyId).slice(-SIGNED_PREKEY_RETENTION_COUNT)) {
      kept.add(id);
    }
    for (const id of ids) {
      if (!kept.has(id)) await removeSignedPreKeyRecord(this.userId, id);
    }
  }

  /**
   * Next free signed-prekey id: one past the highest id in this user's
   * persisted key set.
   *
   * Ids are therefore stable for persisted keys, unique within the account,
   * never reused after rotation, restart, or logout/login of the same
   * account, and never derived from another account's state (the key set is
   * scoped and sealed per user id).
   */
  private async nextSignedPreKeyId(): Promise<number> {
    const meta = await this.readCurrentSignedPreKeyMeta();
    let max = meta?.keyId ?? 0;
    for (const rec of await listSignedPreKeyRecords(this.userId)) {
      const id = Number(rec.keyId);
      if (Number.isInteger(id) && id > max) max = id;
    }
    return max + 1;
  }

  /** The current-key pointer, or null when the device has none yet. */
  private async readCurrentSignedPreKeyMeta(): Promise<SignedPreKeyMeta | null> {
    const raw = await loadSignedPreKeyMeta(this.userId);
    return raw ? decodeSignedPreKeyMeta(raw) : null;
  }

  /** The signed prekey of the last published material (public half only). */
  private async loadPublishedSignedPreKey(): Promise<PublicSignedPreKey | null> {
    const cached = await loadPublishedMaterial(this.userId);
    if (!cached) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(TEXT_DECODER.decode(cached));
    } catch {
      return null;
    }
    const spk = (parsed as { signedPreKey?: Partial<PublicSignedPreKey> } | null)?.signedPreKey;
    if (
      !spk ||
      !Number.isInteger(spk.keyId) ||
      typeof spk.publicKey !== 'string' ||
      typeof spk.signature !== 'string'
    ) {
      return null;
    }
    return { keyId: spk.keyId as number, publicKey: spk.publicKey, signature: spk.signature };
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
    // Tombstone consumed one-time keys and persist the updated Kyber anti-replay
    // memory. A consumed ONE-TIME Kyber is evicted from the engine store AND the
    // durable device-store (so it is never re-imported on reload). The reusable
    // LAST-RESORT Kyber is never evicted — it must serve future establishments.
    const consumed = established.consumed;
    if (consumed.kyberPreKeyId !== undefined) {
      await saveKyberUsage(this.userId, exportKyberUsage(this.device!.kyberPreKeyStore));
      if (consumed.kyberPreKeyId !== LAST_RESORT_KYBER_ID) {
        removeConsumedKyberPreKey(this.device!, consumed.kyberPreKeyId);
        await removeKyberPreKey(this.userId, consumed.kyberPreKeyId);
      }
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
    // F8: the current signed prekey is the record the metadata points at;
    // every other retained record is imported as well so an in-flight
    // handshake on an older bundle can still resolve its private key.
    const spkMeta = await this.readCurrentSignedPreKeyMeta();
    const spkRecord = spkMeta ? await loadSignedPreKeyRecord(this.userId, spkMeta.keyId) : null;
    const lastResort = await loadKyberLastResort(this.userId);
    if (!identityPairBytes || !regBytes || !spkMeta || !spkRecord || !lastResort) {
      throw new CryptoError('CORRUPT_STATE', 'Device not fully provisioned.');
    }
    const registrationId = decodeRegistrationId(regBytes);
    const retainedSpks = (await listSignedPreKeyRecords(this.userId))
      .filter((r) => Number(r.keyId) !== spkMeta.keyId && Number.isInteger(Number(r.keyId)))
      .map((r) => ({ id: Number(r.keyId), record: r.body }));
    const otpList = await listOneTimePreKeys(this.userId);
    const kpkList = await listKyberPreKeys(this.userId);
    const kyberUsage = await loadKyberUsage(this.userId);
    return hydrateDevice({
      identityPairBytes,
      registrationId,
      signedPreKey: { id: spkMeta.keyId, record: spkRecord },
      retainedSignedPreKeys: retainedSpks,
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
    const maxUsed = all.reduce((max, k) => Math.max(max, Number(k.keyId)), 0);
    // Reserve id 1 for the reusable last-resort Kyber; one-time ids start at 2
    // so they never collide with the last-resort in the engine's kyber store.
    return Math.max(maxUsed, LAST_RESORT_KYBER_ID) + 1;
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

/**
 * Verify an advertised signed prekey against the local identity key.
 *
 * Used by the F8 migration to decide whether legacy public material may be
 * kept as the current key. Anything unverifiable (malformed base64, corrupt
 * identity, engine failure) counts as NOT valid: the caller then rotates
 * instead of re-advertising material it cannot prove. This never relaxes
 * verification — it only chooses a safe fallback for unreadable legacy state.
 */
async function isSignedPreKeySignatureValid(
  identityPairBytes: Uint8Array,
  spk: PublicSignedPreKey,
): Promise<boolean> {
  try {
    const identityPublicKey = await identityPublicKeyFromPair(identityPairBytes);
    return await verifyIdentitySignature(
      identityPublicKey,
      base64ToBytes(spk.publicKey),
      base64ToBytes(spk.signature),
    );
  } catch {
    return false;
  }
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
