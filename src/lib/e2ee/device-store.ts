// enough. E2EE-v0.2 — Signal device-store persistence (Phase 1, license-independent)
// ---------------------------------------------------------------------------
// WHAT THIS IS
//   A persistence layer for the Signal-WASM *device* stores: the serialized
//   identity keypair, the registration id, the current signed prekey, the
//   one-time prekeys, the kyber prekeys and the kyber anti-replay usage blob.
//   Every record body is an OPAQUE Uint8Array — exactly the output of the
//   engine's `export_*()` functions — and this module never interprets it.
//
//   This file is deliberately LICENSE-INDEPENDENT: it does NOT import
//   `@getmaapp/signal-wasm`. The future engine adapter (blocked on the AGPL
//   license decision — see docs/e2ee-engine-decision.md §15) will hand the
//   bytes the engine exports to these helpers, and re-import them on reload.
//
// ARCHITECTURE — reuses the established layer, does not duplicate it
//   * Same sealing KEY as the session state. There is exactly one per-user
//     non-extractable AES-GCM-256 key, owned by `sealed-state.ts` (stored in
//     the `vaultkeys` store). This module calls `ensureSealingKey`/`
//     loadSealingKey`. There is NO second wrapping-key architecture.
//   * Same IndexedDB DATABASE (`enough-crypto`) and same `state` object store
//     as the E2EE-1 foundation, via `storage.ts`. Records live under composite
//     keys `${userId}:signal:<...>` so they are disjoint from E2EE-1 records
//     and wiped atomically by `deleteUserCryptoState`.
//   * A device-specific AEAD additional-data string binds every record to its
//     (userId, recordType, keyId) so a record sealed for one user cannot be
//     unsealed under another, and a prekey record cannot masquerade as the
//     identity record. This mirrors the AAD strategy of `sealed-state.ts`
//     without weakening the ratchet envelope's own AAD.
//
//   This is NOT a second ratchet/CAS layer. Device records are independent
//   key/value records, not monotonic session state — session state stays the
//   exclusive responsibility of `ratchet-state.ts`/`ratchet-session.ts`.
//
// SECURITY MODEL (the invariants that are tested in device-store.test.mjs)
//   * No private material is ever sent to Supabase or stored in plaintext.
//   * `extractable: false` sealing key (verified by sealed-state.ts).
//   * Cross-user/cross-type/cross-keyId records are rejected on unseal.
//   * A missing sealing key next to an existing record fails CLOSED
//     (`KEY_MISSING`), never silently returns null or synthesises fresh bytes.
//   * Tampered ciphertext is rejected (`UNSEAL_FAILED`).
//
// This module performs NO protocol cryptography of its own.

import { CryptoError } from '../crypto/errors.ts';
import {
  ensureSealingKey,
  loadSealingKey,
} from '../crypto/sealed-state.ts';
import {
  deleteState,
  getState,
  openDatabase,
  putState,
  txComplete,
} from '../crypto/storage.ts';
import { toBufferSource } from '../crypto/serialization.ts';
import {
  CRYPTO_STORE_STATE,
  DEVICE_RECORD_PREFIX,
} from '../crypto/types.ts';

/** Format version of a sealed device-store record. Part of the AAD. */
export const DEVICE_ENVELOPE_VERSION = 1;

/** Prefix of the device-record AEAD additional-data string. Part of the AAD. */
export const DEVICE_AAD_PREFIX = 'enough.e2ee.device.v1';

/** AES-GCM nonce length in bytes. */
const DEVICE_IV_BYTES = 12;

/** Minimum length of a sealed body: the AES-GCM authentication tag. */
const TAG_BYTES = 16;

/**
 * The categories of device record this layer persists.
 *
 * Singleton categories hold one record per user; keyed categories hold one
 * record per numeric key id.
 */
export type DeviceRecordType =
  | 'identity' // serialized Signal identity keypair (private-bearing)
  | 'registration-id' // registration id bytes
  // LEGACY (pre-F8): the single fixed signed prekey, keyed by nothing.
  // Superseded by `signed-prekey-record` + `signed-prekey-meta`; only read
  // and migrated, never written, by the F8 lifecycle.
  | 'signed-prekey'
  // F8: one signed prekey export per signed-prekey id (private-bearing).
  // Holds the current key AND the retained previously advertised keys.
  | 'signed-prekey-record'
  // F8: PUBLIC metadata (id, public key, signature, createdAt) of the
  // CURRENT signed prekey. This is the pointer that "rotation" flips.
  | 'signed-prekey-meta'
  | 'kyber-usage' // kyber anti-replay usage blob, if the engine exposes one
  | 'prekey' // one-time X25519 prekey export, keyed by id (private-bearing)
  | 'kyber-prekey' // one-time kyber prekey export, keyed by id (private-bearing)
  | 'kyber-prekey-lastresort' // reusable last-resort kyber (private-bearing), singleton
  | 'peer-trust' // TOFU record for a peer, keyed by peer user id (string)
  | 'published-material'; // last-published PUBLIC material (base64 JSON), singleton

/**
 * A sealed device-store record as it lives in IndexedDB.
 *
 * Header fields are stored in the clear so they can be routed without a key,
 * but they are NOT trusted until `unsealDeviceRecord` confirms them against
 * the AEAD tag. Treat every field of a freshly read envelope as
 * attacker-controlled until then.
 */
export interface DeviceEnvelope {
  /** Envelope format version. Part of the AAD. */
  v: number;
  /** Owning Supabase user id. Part of the AAD. */
  userId: string;
  /** Record category. Part of the AAD. */
  recordType: DeviceRecordType;
  /** Numeric key id as a string, or null for singletons. Part of the AAD. */
  keyId: string | null;
  /** AES-GCM nonce, 12 random bytes, fresh for every seal. */
  iv: Uint8Array;
  /** AES-GCM ciphertext of the opaque record body, tag appended. */
  sealed: Uint8Array;
}

/** One keyed record after it has been authenticated and decrypted. */
export interface DeviceKeyedRecord {
  keyId: string;
  body: Uint8Array;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * NUL marker for the keyId segment of the AAD. It cannot occur in a numeric
 * key id, so it makes the mapping (recordType, keyId|null) -> AAD injective:
 * a singleton (keyId === null) never collides with any keyed record.
 */
const NULL_KEY_ID = '\u0000';

/**
 * Build the AEAD additional data for one device record.
 *
 * Encoding is injective: fixed versioned prefix, `|` separator (rejected in
 * identifiers), and a distinct NUL marker for the null keyId.
 */
function buildDeviceAad(
  userId: string,
  recordType: DeviceRecordType,
  keyId: string | null,
): Uint8Array {
  if (!userId) {
    throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  }
  if (userId.includes('|') || (keyId !== null && keyId.includes('|'))) {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Identifiers must not contain the AAD separator.',
    );
  }
  const idPart = keyId === null ? NULL_KEY_ID : keyId;
  return utf8(`${DEVICE_AAD_PREFIX}|${userId}|${recordType}|${idPart}`);
}

async function sealDeviceRecord(
  key: CryptoKey,
  userId: string,
  recordType: DeviceRecordType,
  keyId: string | null,
  body: Uint8Array,
): Promise<DeviceEnvelope> {
  if (!(body instanceof Uint8Array) || body.length === 0) {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Device record body must be a non-empty Uint8Array.',
    );
  }
  const aad = buildDeviceAad(userId, recordType, keyId);
  const iv = crypto.getRandomValues(new Uint8Array(DEVICE_IV_BYTES));
  const plaintext = new Uint8Array(body); // defensive copy
  let sealed: ArrayBuffer;
  try {
    sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: toBufferSource(aad) },
      key,
      toBufferSource(plaintext),
    );
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'Sealing the device record failed.', e);
  }
  return {
    v: DEVICE_ENVELOPE_VERSION,
    userId,
    recordType,
    keyId,
    iv,
    sealed: new Uint8Array(sealed),
  };
}

/** Structural check of an envelope read back from storage. */
function isDeviceEnvelope(value: unknown): value is DeviceEnvelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<DeviceEnvelope>;
  return (
    typeof e.v === 'number' &&
    typeof e.userId === 'string' &&
    typeof e.recordType === 'string' &&
    (e.keyId === null || typeof e.keyId === 'string') &&
    e.iv instanceof Uint8Array &&
    e.sealed instanceof Uint8Array
  );
}

/**
 * Authenticate and decrypt a device record.
 *
 * Throws `CryptoError` (never an unstructured error) so callers can branch on
 * `code`. The cleartext header is checked first so a foreign record surfaces
 * as `USER_MISMATCH` rather than a generic tag failure, but the AEAD tag is
 * the real authority: a header field that was edited after sealing fails the
 * tag check with `UNSEAL_FAILED`.
 */
async function unsealDeviceRecord(
  key: CryptoKey,
  envelope: unknown,
  expectedUserId: string,
  expectedRecordType: DeviceRecordType,
  expectedKeyId: string | null,
): Promise<Uint8Array> {
  if (!isDeviceEnvelope(envelope)) {
    throw new CryptoError('CORRUPT_STATE', 'Stored device record is malformed.');
  }
  if (envelope.v !== DEVICE_ENVELOPE_VERSION) {
    throw new CryptoError('CORRUPT_STATE', 'Device record has an unsupported version.');
  }
  if (envelope.iv.length !== DEVICE_IV_BYTES || envelope.sealed.length < TAG_BYTES) {
    throw new CryptoError('CORRUPT_STATE', 'Device record is malformed.');
  }
  if (
    envelope.userId !== expectedUserId ||
    envelope.recordType !== expectedRecordType ||
    envelope.keyId !== expectedKeyId
  ) {
    throw new CryptoError(
      'USER_MISMATCH',
      'Device record does not belong to the expected user, type or key.',
    );
  }
  const aad = buildDeviceAad(envelope.userId, envelope.recordType, envelope.keyId);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBufferSource(envelope.iv), additionalData: toBufferSource(aad) },
      key,
      toBufferSource(envelope.sealed),
    );
  } catch {
    throw new CryptoError('UNSEAL_FAILED', 'Device record failed authentication.');
  }
  return new Uint8Array(plaintext);
}

/* ------------------------------------------------------------------ */
/* Composite-key helpers                                               */
/* ------------------------------------------------------------------ */

function singletonRecordKey(recordType: DeviceRecordType): string {
  return `${DEVICE_RECORD_PREFIX}${recordType}`;
}

function keyedRecordKey(recordType: DeviceRecordType, keyId: string): string {
  return `${DEVICE_RECORD_PREFIX}${recordType}:${keyId}`;
}

/**
 * Validate the key-id segment of a signed prekey record.
 *
 * Signed prekey ids are positive integers minted by the F8 rotation
 * lifecycle; anything else would let a malformed caller create an
 * unaddressable record inside the key range.
 */
function signedPreKeyIdKey(keyId: number): string {
  if (!Number.isInteger(keyId) || keyId < 1) {
    throw new CryptoError('CORRUPT_STATE', 'invalid signed prekey id');
  }
  return String(keyId);
}

/** Full IndexedDB key range prefix for one user's device records. */
function deviceRangeFor(userId: string): IDBKeyRange {
  const lower = `${userId}:${DEVICE_RECORD_PREFIX}`;
  return IDBKeyRange.bound(lower, lower + '\uffff', false, false);
}

/** Require the per-user sealing key, failing closed when it is gone. */
async function requireSealingKey(userId: string): Promise<CryptoKey> {
  const key = await loadSealingKey(userId);
  if (!key) {
    throw new CryptoError(
      'KEY_MISSING',
      'The local sealing key is unavailable; device records cannot be read.',
    );
  }
  return key;
}

/* ------------------------------------------------------------------ */
/* Singleton records (identity, registration-id, signed-prekey, kyber-usage) */
/* ------------------------------------------------------------------ */

/** Persist (overwrite) a singleton device record, sealed under the user key. */
export async function saveDeviceSingleton(
  userId: string,
  recordType: DeviceRecordType,
  body: Uint8Array,
): Promise<void> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const key = await ensureSealingKey(userId);
  const envelope = await sealDeviceRecord(key, userId, recordType, null, body);
  await putState(userId, singletonRecordKey(recordType), envelope);
}

/**
 * Load and authenticate a singleton device record.
 *
 * Returns `null` when no record exists. Throws `KEY_MISSING` when a record
 * exists but the sealing key is gone (fail-closed — never synthesise fresh
 * bytes), `USER_MISMATCH`/`CORRUPT_STATE` on a mis-routed/malformed record,
 * and `UNSEAL_FAILED` on a tampered record.
 */
export async function loadDeviceSingleton(
  userId: string,
  recordType: DeviceRecordType,
): Promise<Uint8Array | null> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const raw = await getState<DeviceEnvelope>(userId, singletonRecordKey(recordType));
  if (raw === undefined || raw === null) return null;
  const key = await requireSealingKey(userId);
  return unsealDeviceRecord(key, raw, userId, recordType, null);
}

/** Delete a singleton device record (e.g. signed-prekey rotation). */
export async function removeDeviceSingleton(
  userId: string,
  recordType: DeviceRecordType,
): Promise<void> {
  if (!userId) return;
  await deleteState(userId, singletonRecordKey(recordType));
}

/* ------------------------------------------------------------------ */
/* Keyed records (prekey, kyber-prekey)                                */
/* ------------------------------------------------------------------ */

/** Persist (overwrite) a keyed device record, sealed under the user key. */
export async function saveDeviceKeyed(
  userId: string,
  recordType: DeviceRecordType,
  keyId: string,
  body: Uint8Array,
): Promise<void> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const key = await ensureSealingKey(userId);
  const envelope = await sealDeviceRecord(key, userId, recordType, keyId, body);
  await putState(userId, keyedRecordKey(recordType, keyId), envelope);
}

/** Load and authenticate a keyed device record (null when absent). */
export async function loadDeviceKeyed(
  userId: string,
  recordType: DeviceRecordType,
  keyId: string,
): Promise<Uint8Array | null> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const raw = await getState<DeviceEnvelope>(userId, keyedRecordKey(recordType, keyId));
  if (raw === undefined || raw === null) return null;
  const key = await requireSealingKey(userId);
  return unsealDeviceRecord(key, raw, userId, recordType, keyId);
}

/** Delete a keyed device record (e.g. after a one-time prekey is consumed). */
export async function removeDeviceKeyed(
  userId: string,
  recordType: DeviceRecordType,
  keyId: string,
): Promise<void> {
  if (!userId) return;
  await deleteState(userId, keyedRecordKey(recordType, keyId));
}

/**
 * Collect the raw keyed envelopes in one consistent read transaction.
 *
 * No Web Crypto is awaited inside the transaction (that would let it
 * auto-commit). The caller unseals the collected records afterwards.
 */
async function collectKeyedRaw(
  userId: string,
  recordType: DeviceRecordType,
): Promise<{ keyId: string; envelope: unknown }[]> {
  const lower = `${userId}:${DEVICE_RECORD_PREFIX}${recordType}:`;
  const range = IDBKeyRange.bound(lower, lower + '\uffff', false, false);
  const collected: { keyId: string; envelope: unknown }[] = [];
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_STATE, 'readonly');
    const store = transaction.objectStore(CRYPTO_STORE_STATE);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const keyStr = String(cursor.key);
        // Defensive: only include keys that actually belong to this user+type.
        if (keyStr.startsWith(lower)) {
          collected.push({ keyId: keyStr.slice(lower.length), envelope: cursor.value });
        }
        cursor.continue();
      };
      req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
    });
    await txComplete(transaction);
  } finally {
    db.close();
  }
  return collected;
}

/**
 * List all readable keyed records of one type.
 *
 * Unreadable records (corrupt or tampered) are skipped rather than aborting
 * the enumeration — a single bad prekey must not brick prekey accounting. The
 * individual `loadDeviceKeyed` for a bad record still throws.
 */
export async function listDeviceKeyed(
  userId: string,
  recordType: DeviceRecordType,
): Promise<DeviceKeyedRecord[]> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const raw = await collectKeyedRaw(userId, recordType);
  const key = await requireSealingKey(userId);
  const out: DeviceKeyedRecord[] = [];
  for (const { keyId, envelope } of raw) {
    try {
      const body = await unsealDeviceRecord(key, envelope, userId, recordType, keyId);
      out.push({ keyId, body });
    } catch {
      /* skip unreadable; documented above */
    }
  }
  return out;
}

/** Count keyed records of one type by key (cheap — no decryption). */
export async function countDeviceKeyed(
  userId: string,
  recordType: DeviceRecordType,
): Promise<number> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const lower = `${userId}:${DEVICE_RECORD_PREFIX}${recordType}:`;
  const range = IDBKeyRange.bound(lower, lower + '\uffff', false, false);
  let count = 0;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_STATE, 'readonly');
    const store = transaction.objectStore(CRYPTO_STORE_STATE);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (String(cursor.key).startsWith(lower)) count += 1;
        cursor.continue();
      };
      req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
    });
    await txComplete(transaction);
  } finally {
    db.close();
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Bulk cleanup                                                        */
/* ------------------------------------------------------------------ */

/**
 * Delete every device record for a user (all `signal:` rows in the state
 * store). `deleteUserCryptoState` performs the same erase inside its atomic
 * multi-store transaction for account deletion; this standalone variant is
 * available for a targeted device reset that keeps the identity.
 */
export async function deleteAllDeviceRecords(userId: string): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  const range = deviceRangeFor(userId);
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_STATE, 'readwrite', {
      durability: 'strict',
    });
    const store = transaction.objectStore(CRYPTO_STORE_STATE);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
    });
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* Typed convenience wrappers (one per engine store category)          */
/* ------------------------------------------------------------------ */
// These give the future engine adapter a clear, intention-revealing API.
// Each maps directly onto the generic primitive above and a record type.

/** Signal identity keypair (serialized, private-bearing). Singleton. */
export const saveIdentity = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'identity', body);
export const loadIdentity = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'identity');

/** Registration id. Singleton. */
export const saveRegistrationId = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'registration-id', body);
export const loadRegistrationId = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'registration-id');

/** Kyber anti-replay usage blob (if the engine exposes one). Singleton. */
export const saveKyberUsage = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'kyber-usage', body);
export const loadKyberUsage = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'kyber-usage');

/**
 * LEGACY (pre-F8) current signed prekey export (private-bearing). Singleton.
 *
 * Only used to migrate an existing record into the F8 rotating key set; the
 * F8 lifecycle never writes it.
 */
export const saveSignedPreKey = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'signed-prekey', body);
export const loadSignedPreKey = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'signed-prekey');
export const removeSignedPreKey = (userId: string): Promise<void> =>
  removeDeviceSingleton(userId, 'signed-prekey');

/**
 * Signed prekey export (private-bearing), keyed by signed-prekey id (F8).
 *
 * The set holds the CURRENT key plus the retained previously advertised
 * keys, so a handshake that fetched a bundle before a rotation can still be
 * completed. Which key is current is decided by `signed-prekey-meta`, never
 * by a fixed id and never by this store alone.
 */
export const saveSignedPreKeyRecord = (
  userId: string,
  keyId: number,
  body: Uint8Array,
): Promise<void> => saveDeviceKeyed(userId, 'signed-prekey-record', signedPreKeyIdKey(keyId), body);
export const loadSignedPreKeyRecord = (userId: string, keyId: number): Promise<Uint8Array | null> =>
  loadDeviceKeyed(userId, 'signed-prekey-record', signedPreKeyIdKey(keyId));
export const removeSignedPreKeyRecord = (userId: string, keyId: number): Promise<void> =>
  removeDeviceKeyed(userId, 'signed-prekey-record', signedPreKeyIdKey(keyId));
/** Every signed prekey record of this user (current + retained). */
export const listSignedPreKeyRecords = (userId: string): Promise<DeviceKeyedRecord[]> =>
  listDeviceKeyed(userId, 'signed-prekey-record');

/** PUBLIC metadata of the current signed prekey (F8). Singleton. */
export const saveSignedPreKeyMeta = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'signed-prekey-meta', body);
export const loadSignedPreKeyMeta = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'signed-prekey-meta');
export const removeSignedPreKeyMeta = (userId: string): Promise<void> =>
  removeDeviceSingleton(userId, 'signed-prekey-meta');

/** One-time X25519 prekey export (private-bearing). Keyed by id. */
export const saveOneTimePreKey = (
  userId: string,
  keyId: number,
  body: Uint8Array,
): Promise<void> => saveDeviceKeyed(userId, 'prekey', String(keyId), body);
export const loadOneTimePreKey = (userId: string, keyId: number): Promise<Uint8Array | null> =>
  loadDeviceKeyed(userId, 'prekey', String(keyId));
export const removeOneTimePreKey = (userId: string, keyId: number): Promise<void> =>
  removeDeviceKeyed(userId, 'prekey', String(keyId));
export const listOneTimePreKeys = (userId: string): Promise<DeviceKeyedRecord[]> =>
  listDeviceKeyed(userId, 'prekey');
export const countOneTimePreKeys = (userId: string): Promise<number> =>
  countDeviceKeyed(userId, 'prekey');

/** Kyber prekey export (private-bearing). Keyed by id. */
export const saveKyberPreKey = (
  userId: string,
  keyId: number,
  body: Uint8Array,
): Promise<void> => saveDeviceKeyed(userId, 'kyber-prekey', String(keyId), body);
export const loadKyberPreKey = (userId: string, keyId: number): Promise<Uint8Array | null> =>
  loadDeviceKeyed(userId, 'kyber-prekey', String(keyId));
export const removeKyberPreKey = (userId: string, keyId: number): Promise<void> =>
  removeDeviceKeyed(userId, 'kyber-prekey', String(keyId));
export const listKyberPreKeys = (userId: string): Promise<DeviceKeyedRecord[]> =>
  listDeviceKeyed(userId, 'kyber-prekey');
export const countKyberPreKeys = (userId: string): Promise<number> =>
  countDeviceKeyed(userId, 'kyber-prekey');

/** Reusable last-resort Kyber prekey (private-bearing). Singleton. */
export const saveKyberLastResort = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'kyber-prekey-lastresort', body);
export const loadKyberLastResort = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'kyber-prekey-lastresort');

/** Last-published PUBLIC material cache (base64 JSON). Singleton. */
export const savePublishedMaterial = (userId: string, body: Uint8Array): Promise<void> =>
  saveDeviceSingleton(userId, 'published-material', body);
export const loadPublishedMaterial = (userId: string): Promise<Uint8Array | null> =>
  loadDeviceSingleton(userId, 'published-material');

/* Peer TOFU records — keyed by peer user id (string), stored sealed. */
export const savePeerTrust = (userId: string, peerUserId: string, body: Uint8Array): Promise<void> =>
  saveDeviceKeyed(userId, 'peer-trust', peerUserId, body);
export const loadPeerTrust = (userId: string, peerUserId: string): Promise<Uint8Array | null> =>
  loadDeviceKeyed(userId, 'peer-trust', peerUserId);
export const removePeerTrust = (userId: string, peerUserId: string): Promise<void> =>
  removeDeviceKeyed(userId, 'peer-trust', peerUserId);
