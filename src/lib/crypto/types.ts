// enough. E2EE — Core types
// --------------------------------------------------------------
// IMPORTANT: This module must NEVER import or expose raw private key bytes.
// Private keys are represented as non-extractable `CryptoKey` objects
// managed entirely by Web Crypto and persisted to IndexedDB via wrapKey().

/** Version of the persisted crypto state format. Bump on breaking changes. */
export const CRYPTO_STATE_VERSION = 1;

/** IndexedDB database name. */
export const CRYPTO_DB_NAME = 'enough-crypto';
/**
 * Bumped to 2 in E2EE-2D to add the `ratchet` object store. The upgrade is
 * purely additive: existing `state` and `prekeys` stores are untouched, so
 * identities and prekeys created under version 1 survive the upgrade.
 */
export const CRYPTO_DB_VERSION = 2;

/** IndexedDB object-store names. */
export const CRYPTO_STORE_STATE = 'state';      // keyed by `${userId}:${recordKey}`
export const CRYPTO_STORE_PREKEYS = 'prekeys';  // keyed by composite: `${userId}:${keyId}`
/**
 * Ratchet session state + monotonic revision watermarks (E2EE-2D).
 * Keyed by `${userId}:${connectionId}` for records and
 * `${userId}:${connectionId}:__watermark` for the high-water mark.
 */
export const CRYPTO_STORE_RATCHET = 'ratchet';

/**
 * Record keys for per-user singleton state. At rest these are stored under
 * composite keys `<userId>:<record-key>` to guarantee user isolation when
 * multiple accounts share a single browser profile (e.g. logout/login,
 * family/shared device).
 */
export const RECORD_IDENTITY = 'identity';
export const RECORD_SIGNED_PREKEY = 'signed-prekey';
/**
 * Record key for the X25519 identity keypair used for key agreement.
 * This is the "identity" described in the E2EE-1 foundation PR:
 * a long-lived X25519 keypair whose public half is published as
 * `profiles.identity_public_key` (base64, 32 bytes raw). Private key
 * remains non-extractable in IndexedDB.
 */
export const RECORD_X25519_IDENTITY = 'x25519-identity';

/** Build the composite state key for a given user + record type. */
export function stateKeyFor(userId: string, recordKey: string): string {
  return `${userId}:${recordKey}`;
}

/** Prefix used to scope one-time-prekey entries per user in the prekeys store. */
export function prekeyPrefix(userId: string): string {
  return `${userId}:`;
}

/** Composite key used for one-time prekey records (per-user unique). */
export function prekeyCompositeKey(userId: string, keyId: number): string {
  return `${userId}:${keyId}`;
}

/**
 * Composite key for a per-connection ratchet state record.
 *
 * Binding BOTH userId and connectionId into the key is a security requirement,
 * not a convenience: two accounts sharing one browser profile must never share
 * a ratchet state, and two connections of the same account must never share
 * one either (a 1:1 messenger has one session per peer).
 */
export function ratchetKeyFor(userId: string, connectionId: string): string {
  return `${userId}:${connectionId}`;
}

/**
 * Key holding the monotonic high-water mark for a (user, connection).
 *
 * The suffix contains characters that cannot appear in a UUID, so it can never
 * collide with a real `${userId}:${connectionId}` record key.
 */
export function watermarkKeyFor(userId: string, connectionId: string): string {
  return `${userId}:${connectionId}:__watermark`;
}

/** Prefix used to scope all ratchet entries of a user (for bulk deletion). */
export function ratchetUserPrefix(userId: string): string {
  return `${userId}:`;
}

/** Serialized (bytes) form of an Ed25519 public key. 32 bytes. */
export type Ed25519PublicKeyBytes = Uint8Array;

/** Serialized (bytes) form of an X25519 public key. 32 bytes. */
export type X25519PublicKeyBytes = Uint8Array;

/** Serialized Ed25519 signature. 64 bytes. */
export type SignatureBytes = Uint8Array;

/** Client-side generated device id (random UUID v4). */
export type DeviceId = string;

/**
 * The public identity bundle that can be safely uploaded to Supabase
 * and shared with peers. It MUST NOT contain any private key material.
 */
export interface PublicIdentityBundle {
  version: number;
  deviceId: DeviceId;
  /** Supabase user id this identity is bound to (prevents cross-user reuse). */
  userId: string;
  /** 32-byte Ed25519 identity public key, base64-encoded for transit. */
  identityKey: string;
  /** Unix millis timestamp when this identity was created. */
  createdAt: number;
}

/**
 * Public portion of a signed prekey, safe to upload.
 */
export interface PublicSignedPreKey {
  keyId: number;
  /** 32-byte X25519 public key, base64-encoded. */
  publicKey: string;
  /** 64-byte Ed25519 signature over publicKey, base64-encoded. */
  signature: string;
  createdAt: number;
}

/**
 * A one-time prekey (public portion), safe to upload.
 */
export interface PublicOneTimePreKey {
  keyId: number;
  /** 32-byte X25519 public key, base64-encoded. */
  publicKey: string;
}

/**
 * Full prekey bundle for a device as served to peers (public data only).
 */
export interface PublicDeviceBundle {
  identity: PublicIdentityBundle;
  signedPreKey: PublicSignedPreKey;
  oneTimePreKeys: PublicOneTimePreKey[];
}

/**
 * Error codes used by the crypto layer.
 * Deliberately NOT including any key material in messages.
 */
export type CryptoErrorCode =
  | 'NOT_AVAILABLE'        // Web Crypto / IndexedDB missing or restricted
  | 'NOT_INITIALIZED'      // accessed before initCrypto()
  | 'ALREADY_INITIALIZED'  // tried to init when identity already exists
  | 'CORRUPT_STATE'        // persisted data failed validation
  | 'STORAGE_ERROR'        // IndexedDB failure
  | 'CRYPTO_ERROR'         // Web Crypto failure (algorithm, key ops, etc.)
  | 'DESERIALIZATION_ERROR'
  | 'USER_MISMATCH'        // identity bound to a different user id
  | 'REVISION_CONFLICT'    // CAS failed: another writer advanced the revision
  | 'ROLLBACK_DETECTED';   // an older ratchet state tried to replace a newer one

export interface SerializedKeyPair<K extends CryptoKey = CryptoKey> {
  privateKey: K;
  publicKey: K;
}
