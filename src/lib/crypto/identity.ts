// enough. E2EE — Identity key lifecycle
// --------------------------------------------------------------
// Each device has one long-lived Ed25519 identity key pair.
//   * Public key is uploaded to Supabase and shared with peers.
//   * Private key is generated non-extractable and kept in IndexedDB.
//   * The identity key is NOT derived from username, password, or profile id.
//   * Identity state is scoped per Supabase user id so multiple accounts on
//     the same browser (e.g. logout/login) cannot reuse each other's keys.
//
// Lifecycle:
//   - First visit: no identity in storage -> generateIdentity() creates one.
//   - Subsequent visits: loadIdentity() returns the persisted bundle.
//   - Logout: identity persists locally (the device stays bound).
//   - Browser storage wipe: identity is lost; documented behaviour.
//   - Account deletion: caller must invoke deleteUserCryptoState() locally.
//
// This module does NOT implement sessions or double-ratchet; it only
// manages long-term identity material.

import { CryptoError } from './errors.ts';
import {
  base64ToBytes,
  bytesToBase64,
  generateDeviceId,
  serializeIdentityBundle,
  toBufferSource,
} from './serialization.ts';
import {
  deleteState,
  getState,
  putState,
} from './storage.ts';
import {
  CRYPTO_STATE_VERSION,
  RECORD_IDENTITY,
  type DeviceId,
  type PublicIdentityBundle,
} from './types.ts';

interface PersistedIdentity {
  version: number;
  userId: string;
  deviceId: DeviceId;
  createdAt: number;
  /** Base64 of the 32-byte raw public key (cached for sync access). */
  publicKeyBase64: string;
  /** Non-extractable Ed25519 private key for signing. */
  signingPrivateKey: CryptoKey;
  /** Public key handle for verification. */
  signingPublicKey: CryptoKey;
}

/** In-memory cache keyed by userId so multiple accounts can coexist. */
const identityCache = new Map<string, PersistedIdentity>();

function cacheKey(userId: string): string {
  return userId;
}

/** Check whether an identity already exists in storage for this user. */
export async function hasIdentity(userId: string): Promise<boolean> {
  if (identityCache.has(cacheKey(userId))) return true;
  const existing = await getState<PersistedIdentity>(userId, RECORD_IDENTITY);
  return existing !== undefined && existing !== null;
}

/**
 * Generate a new device identity for the given user. Must only be called
 * once per (user, device). Throws ALREADY_INITIALIZED if an identity
 * already exists to prevent silent overwriting.
 */
export async function generateIdentity(userId: string): Promise<PublicIdentityBundle> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  if (await hasIdentity(userId)) {
    throw new CryptoError('ALREADY_INITIALIZED');
  }

  let keyPair: CryptoKeyPair;
  try {
    keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      /* extractable */ false,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
  } catch (e) {
    throw new CryptoError(
      'NOT_AVAILABLE',
      'Ed25519 is not supported by this browser.',
      e,
    );
  }

  if (!keyPair.privateKey || !keyPair.publicKey) {
    throw new CryptoError('CRYPTO_ERROR', 'Failed to generate identity key pair.');
  }

  // Export the public key raw bytes. All modern browsers allow exporting
  // public-key material even when the pair was generated with extractable=false,
  // but if that fails we fall back to generating an extractable pair and
  // ensuring the private key is still non-extractable (verified below).
  let publicRawBuf: ArrayBuffer;
  try {
    publicRawBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  } catch {
    const extractablePair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      /* extractable */ true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    keyPair = extractablePair;
    publicRawBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  }
  const publicRaw = new Uint8Array(publicRawBuf);

  // Re-import the public key as extractable for later verification/bundles.
  const signingPublicKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(publicRaw),
    { name: 'Ed25519' },
    /* extractable */ true,
    ['verify'],
  );

  // If we hit the fallback where the generated private key ended up extractable,
  // discard it and regenerate with extractable=false. We never persist an
  // extractable private key.
  if (keyPair.privateKey.extractable) {
    keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      /* extractable */ false,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    publicRawBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const reimportedPub = await crypto.subtle.importKey(
      'raw',
      publicRawBuf,
      { name: 'Ed25519' },
      true,
      ['verify'],
    );
    const record: PersistedIdentity = {
      version: CRYPTO_STATE_VERSION,
      userId,
      deviceId: generateDeviceId(),
      createdAt: Date.now(),
      publicKeyBase64: bytesToBase64(new Uint8Array(publicRawBuf)),
      signingPrivateKey: keyPair.privateKey,
      signingPublicKey: reimportedPub,
    };
    await putState(userId, RECORD_IDENTITY, record);
    identityCache.set(cacheKey(userId), record);
    return bundleFromRecord(record);
  }

  const record: PersistedIdentity = {
    version: CRYPTO_STATE_VERSION,
    userId,
    deviceId: generateDeviceId(),
    createdAt: Date.now(),
    publicKeyBase64: bytesToBase64(publicRaw),
    signingPrivateKey: keyPair.privateKey,
    signingPublicKey,
  };

  await putState(userId, RECORD_IDENTITY, record);
  identityCache.set(cacheKey(userId), record);
  return bundleFromRecord(record);
}

/**
 * Load the identity for this user. Returns null if no identity exists.
 * Throws on corrupt state.
 */
export async function loadIdentity(userId: string): Promise<PublicIdentityBundle | null> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  const cached = identityCache.get(cacheKey(userId));
  if (cached) return bundleFromRecord(cached);
  const record = await getState<PersistedIdentity>(userId, RECORD_IDENTITY);
  if (!record) return null;

  validateRecord(record, userId);
  identityCache.set(cacheKey(userId), record);
  return bundleFromRecord(record);
}

/**
 * Return the signing private key for the given user. MUST NOT be exposed
 * outside the crypto layer. Throws if no identity exists.
 */
export async function getIdentitySigningKey(userId: string): Promise<CryptoKey> {
  const record = await requireIdentityRecord(userId);
  const key = record.signingPrivateKey;
  if (key.extractable) {
    // Hard defense: never hand out an extractable private key.
    throw new CryptoError('CORRUPT_STATE', 'Identity private key is extractable; aborting.');
  }
  return key;
}

/** Return the identity public key as a CryptoKey for signature verification. */
export async function getIdentityPublicKey(userId: string): Promise<CryptoKey> {
  const record = await requireIdentityRecord(userId);
  return record.signingPublicKey;
}

/** Return the device id for this user, loading from storage if needed. */
export async function getDeviceId(userId: string): Promise<DeviceId> {
  const record = await requireIdentityRecord(userId);
  return record.deviceId;
}

/** Sign `message` with this user's identity key. Returns 64-byte signature. */
export async function signWithIdentity(userId: string, message: Uint8Array): Promise<Uint8Array> {
  const key = await getIdentitySigningKey(userId);
  const sig = await crypto.subtle.sign('Ed25519', key, toBufferSource(message));
  return new Uint8Array(sig);
}

/**
 * Verify an Ed25519 signature against a public key.
 * Accepts either a CryptoKey or raw bytes.
 */
export async function verifyWithPublicKey(
  publicKey: CryptoKey | Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  let key: CryptoKey;
  if (publicKey instanceof CryptoKey) {
    key = publicKey;
  } else {
    key = await crypto.subtle.importKey(
      'raw',
      toBufferSource(publicKey),
      { name: 'Ed25519' },
      /* extractable */ true,
      ['verify'],
    );
  }
  try {
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      toBufferSource(signature),
      toBufferSource(message),
    );
  } catch {
    return false;
  }
}

/** Delete the local identity for this user (on account deletion). */
export async function deleteIdentity(userId: string): Promise<void> {
  await deleteState(userId, RECORD_IDENTITY);
  identityCache.delete(cacheKey(userId));
}

/** Test-only: clear the in-memory identity cache for all users. */
export function _resetIdentityCacheForTests(): void {
  identityCache.clear();
}

/** Async accessor returning the public bundle. */
export async function getIdentityBundle(userId: string): Promise<PublicIdentityBundle> {
  const record = await requireIdentityRecord(userId);
  return bundleFromRecord(record);
}

/** JSON-serialize the public bundle for upload/storage. */
export async function getIdentityBundleJSON(userId: string): Promise<string> {
  return serializeIdentityBundle(await getIdentityBundle(userId));
}

// --- internals ---

async function requireIdentityRecord(userId: string): Promise<PersistedIdentity> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  const cached = identityCache.get(cacheKey(userId));
  if (cached) return cached;
  const loaded = await loadIdentity(userId);
  if (!loaded) throw new CryptoError('NOT_INITIALIZED');
  return identityCache.get(cacheKey(userId))!;
}

function bundleFromRecord(rec: PersistedIdentity): PublicIdentityBundle {
  const bundle: PublicIdentityBundle = {
    version: rec.version,
    deviceId: rec.deviceId,
    userId: rec.userId,
    identityKey: rec.publicKeyBase64,
    createdAt: rec.createdAt,
  };
  return Object.freeze(bundle);
}

function validateRecord(record: PersistedIdentity, expectedUserId: string): void {
  if (
    !record ||
    typeof record !== 'object' ||
    record.version !== CRYPTO_STATE_VERSION ||
    typeof record.userId !== 'string' ||
    typeof record.deviceId !== 'string' ||
    typeof record.createdAt !== 'number' ||
    typeof record.publicKeyBase64 !== 'string' ||
    !record.signingPrivateKey ||
    !record.signingPublicKey
  ) {
    throw new CryptoError('CORRUPT_STATE', 'Identity record is corrupted.');
  }
  // Isolation check: refuse to load an identity that was created for a
  // different Supabase user id. This prevents cross-user identity reuse.
  if (record.userId !== expectedUserId) {
    throw new CryptoError(
      'USER_MISMATCH',
      'Stored identity belongs to a different user.',
    );
  }
  const priv = record.signingPrivateKey as CryptoKey;
  const pub = record.signingPublicKey as CryptoKey;
  if (priv.type !== 'private' || pub.type !== 'public') {
    throw new CryptoError('CORRUPT_STATE', 'Identity record has invalid key types.');
  }
  if (priv.algorithm.name !== 'Ed25519' || pub.algorithm.name !== 'Ed25519') {
    throw new CryptoError('CORRUPT_STATE', 'Identity key algorithm mismatch.');
  }
  if (priv.extractable) {
    throw new CryptoError('CORRUPT_STATE', 'Identity private key must not be extractable.');
  }
  try {
    const bytes = base64ToBytes(record.publicKeyBase64);
    if (bytes.byteLength !== 32) {
      throw new CryptoError('CORRUPT_STATE', 'Identity public key has wrong length.');
    }
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError('CORRUPT_STATE', 'Identity public key is not valid base64.');
  }
}
