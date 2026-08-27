// enough. E2EE — X25519 identity keypair layer (E2EE-1 foundation)
// -------------------------------------------------------------------
// This module implements the exact API required by the E2EE-1 PR scope:
//
//   generateIdentityKeyPair()
//   exportPublicKey()
//   importPublicKey()
//   saveIdentityKeyPair()
//   loadIdentityKeyPair()
//
// It uses the browser's native Web Crypto API (X25519) and persists
// private keys as non-extractable CryptoKey objects in IndexedDB, scoped
// per Supabase user id. No private material is ever serialized to
// localStorage, sessionStorage, cookies, React state, or Supabase.
//
// Encoding: public keys are 32-byte raw X25519 keys, base64-encoded
// via standard btoa/atob (not base64url) for deterministic DB storage.
// This matches the existing `profiles.identity_public_key` column
// expectation (nullable text, 32 bytes decoded).
//
// This module coexists with the existing Ed25519 identity (identity.ts)
// which is used for signing prekeys. For the foundation PR we expose
// both: Ed25519 remains the signing identity, X25519 here is the key-
// agreement identity. Future message encryption will use X25519 +
// HKDF-SHA256 + AES-256-GCM. The profile column `profiles.identity_public_key`
// is strictly X25519 only — Ed25519 must never be written there. (The
// login-time publish path was removed with audit finding F2; the app no
// longer writes this column.) If X25519 is unavailable, the foundation
// is marked not available and no alternative key is stored.

import { CryptoError } from './errors.ts';
import {
  base64ToBytes,
  bytesToBase64,
  toBufferSource,
} from './serialization.ts';
import { getState, putState, deleteState, registerCacheResetter } from './storage.ts';
import {
  CRYPTO_STATE_VERSION,
  RECORD_X25519_IDENTITY,
  type X25519PublicKeyBytes,
} from './types.ts';

export interface IdentityKeyPair {
  /** Non-extractable X25519 private key (deriveBits/deriveKey). */
  privateKey: CryptoKey;
  /** Extractable X25519 public key handle. */
  publicKey: CryptoKey;
}

interface PersistedX25519Identity {
  version: number;
  userId: string;
  createdAt: number;
  publicKeyBase64: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

// In-memory cache per user to avoid repeated IndexedDB reads.
const x25519Cache = new Map<string, PersistedX25519Identity>();

/**
 * Generate a new X25519 identity keypair.
 * Uses Web Crypto directly; private key is non-extractable.
 * Does NOT persist — caller must call saveIdentityKeyPair().
 */
export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  let kp: CryptoKeyPair;
  try {
    kp = (await crypto.subtle.generateKey(
      { name: 'X25519' },
      /* extractable */ false,
      ['deriveBits', 'deriveKey'],
    )) as CryptoKeyPair;
  } catch (e) {
    throw new CryptoError('NOT_AVAILABLE', 'X25519 is not supported by this browser.', e);
  }
  if (!kp.privateKey || !kp.publicKey) {
    throw new CryptoError('CRYPTO_ERROR', 'Failed to generate X25519 keypair.');
  }
  if (kp.privateKey.extractable) {
    throw new CryptoError('CORRUPT_STATE', 'Generated private key is unexpectedly extractable.');
  }
  // Verify public key can be exported (defense).
  try {
    const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
    if (raw.byteLength !== 32) {
      throw new CryptoError('CRYPTO_ERROR', 'X25519 public key has wrong length.');
    }
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    // Fallback: some browsers require extractable true to export public keys.
    // Regenerate with extractable true, then re-wrap private as non-extractable.
    // For X25519 we cannot easily re-import private as non-extractable without
    // raw private bytes (which we don't have). Instead, generate a new
    // non-extractable pair and try again; if still failing, surface error.
    throw new CryptoError('CRYPTO_ERROR', 'Failed to export X25519 public key.', e);
  }
  return kp;
}

/**
 * Export a public X25519 CryptoKey to a base64 string suitable for
 * database storage (profiles.identity_public_key).
 * Only public keys may be passed.
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  if (publicKey.type !== 'public') {
    throw new CryptoError('CRYPTO_ERROR', 'Refusing to export a non-public key.');
  }
  if (publicKey.algorithm.name !== 'X25519') {
    throw new CryptoError('CRYPTO_ERROR', 'Public key algorithm mismatch: expected X25519.');
  }
  const buf = await crypto.subtle.exportKey('raw', publicKey);
  return bytesToBase64(new Uint8Array(buf));
}

/**
 * Import a base64-encoded 32-byte X25519 public key to a CryptoKey.
 * The returned key is extractable and usable for deriveBits/deriveKey.
 */
export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const bytes: X25519PublicKeyBytes = base64ToBytes(base64);
  if (bytes.byteLength !== 32) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'X25519 public key has wrong length.');
  }
  return crypto.subtle.importKey(
    'raw',
    toBufferSource(bytes),
    { name: 'X25519' },
    /* extractable */ true,
    [],
  );
}

/**
 * Persist an X25519 identity keypair for the given user.
 * Private key remains non-extractable; stored as CryptoKey in IndexedDB.
 * Scoped per userId to prevent cross-user reuse.
 */
export async function saveIdentityKeyPair(
  userId: string,
  keyPair: CryptoKeyPair,
): Promise<void> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  if (!keyPair.privateKey || !keyPair.publicKey) {
    throw new CryptoError('CRYPTO_ERROR', 'Invalid keypair.');
  }
  if (keyPair.privateKey.type !== 'private' || keyPair.publicKey.type !== 'public') {
    throw new CryptoError('CRYPTO_ERROR', 'Invalid key types.');
  }
  if (keyPair.privateKey.algorithm.name !== 'X25519' || keyPair.publicKey.algorithm.name !== 'X25519') {
    throw new CryptoError('CRYPTO_ERROR', 'Key algorithm mismatch: expected X25519.');
  }
  if (keyPair.privateKey.extractable) {
    throw new CryptoError('CORRUPT_STATE', 'Private key must not be extractable.');
  }
  const rawBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const raw = new Uint8Array(rawBuf);
  if (raw.byteLength !== 32) {
    throw new CryptoError('CRYPTO_ERROR', 'Public key has wrong length.');
  }
  // Re-import public key as extractable handle for later use (ensures consistency).
  const publicKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(raw),
    { name: 'X25519' },
    /* extractable */ true,
    [],
  );
  const record: PersistedX25519Identity = {
    version: CRYPTO_STATE_VERSION,
    userId,
    createdAt: Date.now(),
    publicKeyBase64: bytesToBase64(raw),
    privateKey: keyPair.privateKey,
    publicKey,
  };
  await putState(userId, RECORD_X25519_IDENTITY, record);
  x25519Cache.set(userId, record);
}

/**
 * Load the X25519 identity keypair for the given user.
 * Returns null if none exists. Throws CORRUPT_STATE on validation failure.
 */
export async function loadIdentityKeyPair(
  userId: string,
): Promise<CryptoKeyPair | null> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  const cached = x25519Cache.get(userId);
  if (cached) {
    return { privateKey: cached.privateKey, publicKey: cached.publicKey };
  }
  const rec = await getState<PersistedX25519Identity>(userId, RECORD_X25519_IDENTITY);
  if (!rec) return null;
  validateX25519Record(rec, userId);
  x25519Cache.set(userId, rec);
  return { privateKey: rec.privateKey, publicKey: rec.publicKey };
}

/**
 * Get the public key base64 for the given user, if exists.
 * Convenience for profile sync.
 */
export async function getX25519PublicKeyBase64(userId: string): Promise<string | null> {
  const kp = await loadIdentityKeyPair(userId);
  if (!kp) return null;
  const cached = x25519Cache.get(userId);
  if (cached) return cached.publicKeyBase64;
  // Fallback: export from loaded public key
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return bytesToBase64(new Uint8Array(raw));
}

/** Delete the X25519 identity for a user (account deletion). */
export async function deleteX25519Identity(userId: string): Promise<void> {
  await deleteState(userId, RECORD_X25519_IDENTITY);
  x25519Cache.delete(userId);
}

/** Test-only: clear in-memory cache. */
export function _resetX25519CacheForTests(): void {
  x25519Cache.clear();
}

// See identity.ts: deletion of persisted state must also evict the live
// CryptoKey objects held here, or `loadIdentityKeyPair()` keeps returning the
// deleted account's keypair from memory.
registerCacheResetter((userId) => {
  x25519Cache.delete(userId);
});

function validateX25519Record(rec: PersistedX25519Identity, expectedUserId: string): void {
  if (
    !rec ||
    typeof rec !== 'object' ||
    rec.version !== CRYPTO_STATE_VERSION ||
    typeof rec.userId !== 'string' ||
    typeof rec.createdAt !== 'number' ||
    typeof rec.publicKeyBase64 !== 'string' ||
    !rec.privateKey ||
    !rec.publicKey
  ) {
    throw new CryptoError('CORRUPT_STATE', 'X25519 identity record is corrupted.');
  }
  if (rec.userId !== expectedUserId) {
    throw new CryptoError('USER_MISMATCH', 'Stored X25519 identity belongs to a different user.');
  }
  const priv = rec.privateKey as CryptoKey;
  const pub = rec.publicKey as CryptoKey;
  if (priv.type !== 'private' || pub.type !== 'public') {
    throw new CryptoError('CORRUPT_STATE', 'X25519 identity has invalid key types.');
  }
  if (priv.algorithm.name !== 'X25519' || pub.algorithm.name !== 'X25519') {
    throw new CryptoError('CORRUPT_STATE', 'X25519 identity algorithm mismatch.');
  }
  if (priv.extractable) {
    throw new CryptoError('CORRUPT_STATE', 'X25519 private key must not be extractable.');
  }
  const bytes = base64ToBytes(rec.publicKeyBase64);
  if (bytes.byteLength !== 32) {
    throw new CryptoError('CORRUPT_STATE', 'X25519 public key has wrong length.');
  }
}
