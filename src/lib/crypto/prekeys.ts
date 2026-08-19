// enough. E2EE — PreKey management
// --------------------------------------------------------------
// Prepares the device for asynchronous session establishment:
//   * A long-lived (rotated periodically) "signed prekey" — an X25519
//     public key signed by the Ed25519 identity key.
//   * A pool of one-time prekeys (X25519) consumed one per X3DH handshake.
//
// Private keys are kept non-extractable in IndexedDB (scoped per userId).
// Public portions are serializable for upload to Supabase in a later phase.
//
// This module does NOT perform X3DH or session construction — those are
// the responsibility of the future Ratchet/Session layer.
//
// FOUNDATION PARAMETERS (NOT FINAL PROTOCOL CONSTANTS):
//   DEFAULT_OTK_POOL_SIZE = 100
//   MIN_OTK_THRESHOLD     = 20   (refill when count drops below)
//   SIGNED_PREKEY_ROTATION_MS = 30 days
// These are enough.-specific defaults for the infrastructure layer. The
// eventual ratchet/session library may impose different values; they will
// be replaced/adapted when that layer is integrated. Do not treat these as
// a final Signal-protocol parameter set.

import { CryptoError } from './errors.ts';
import {
  getIdentityBundle,
  getIdentitySigningKey,
  hasIdentity,
} from './identity.ts';
import {
  bytesToBase64,
  toBufferSource,
} from './serialization.ts';
import {
  RECORD_SIGNED_PREKEY,
  type PublicOneTimePreKey,
  type PublicSignedPreKey,
} from './types.ts';
import {
  countPreKeys,
  deletePreKey,
  deleteState,
  getPreKey,
  getState,
  listPreKeys,
  putPreKey,
  putState,
  type StoredPreKey,
} from './storage.ts';

/** enough. foundation parameter — see file header. */
export const DEFAULT_OTK_POOL_SIZE = 100;
/** enough. foundation parameter — see file header. */
export const MIN_OTK_THRESHOLD = 20;
/** enough. foundation parameter — see file header. */
export const SIGNED_PREKEY_ROTATION_MS = 30 * 24 * 60 * 60 * 1000;

interface PersistedSignedPreKey {
  version: number;
  userId: string;
  keyId: number;
  createdAt: number;
  publicKeyBase64: string;
  signatureBase64: string;
  /** Non-extractable X25519 private key. */
  privateKey: CryptoKey;
  /** Extractable X25519 public key handle. */
  publicKey: CryptoKey;
}

const SIGNED_PREKEY_STATE_VERSION = 1;

/** Next monotonic one-time-prekey id for the current user. */
const nextOtkId = new Map<string, number>();

/**
 * Generate (or reuse/rotate) the signed prekey. Idempotent — returns
 * the existing signed prekey if it exists and is not yet due for rotation.
 */
export async function ensureSignedPreKey(userId: string): Promise<PublicSignedPreKey> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  if (!(await hasIdentity(userId))) throw new CryptoError('NOT_INITIALIZED');
  const existing = await loadSignedPreKeyRecord(userId);
  if (existing && !isSignedPreKeyExpired(existing)) {
    return publicSignedPreKeyFromRecord(existing);
  }
  return rotateSignedPreKey(userId, existing?.keyId);
}

/** Get the current signed prekey (public portion) or null if none exists. */
export async function getSignedPreKey(userId: string): Promise<PublicSignedPreKey | null> {
  const rec = await loadSignedPreKeyRecord(userId);
  return rec ? publicSignedPreKeyFromRecord(rec) : null;
}

/**
 * Top up the one-time prekey pool for this user to `desiredSize`.
 * Returns the list of *newly generated* public one-time prekeys.
 */
export async function refillOneTimePreKeys(
  userId: string,
  desiredSize: number = DEFAULT_OTK_POOL_SIZE,
): Promise<PublicOneTimePreKey[]> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  if (!(await hasIdentity(userId))) throw new CryptoError('NOT_INITIALIZED');
  const currentCount = await countPreKeys(userId);
  const need = Math.max(0, desiredSize - currentCount);
  if (need === 0) return [];
  if (!nextOtkId.has(userId)) {
    nextOtkId.set(userId, await computeNextOtkId(userId));
  }
  const results: PublicOneTimePreKey[] = [];
  for (let i = 0; i < need; i++) {
    const id = nextOtkId.get(userId)!;
    nextOtkId.set(userId, id + 1);
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'X25519' },
      /* extractable */ false,
      ['deriveKey', 'deriveBits'],
    )) as CryptoKeyPair;
    if (!keyPair.privateKey || !keyPair.publicKey) {
      throw new CryptoError('CRYPTO_ERROR', 'Failed to generate one-time prekey.');
    }
    if (keyPair.privateKey.extractable) {
      throw new CryptoError('CORRUPT_STATE', 'One-time prekey private key is unexpectedly extractable.');
    }
    const publicRawBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicRaw = new Uint8Array(publicRawBuf);
    const publicKey = await crypto.subtle.importKey(
      'raw',
      toBufferSource(publicRaw),
      { name: 'X25519' },
      /* extractable */ true,
      /* usages */ [],
    );
    const record: StoredPreKey = {
      userId,
      keyId: id,
      publicKeyBytes: publicRaw,
      privateKey: keyPair.privateKey,
      createdAt: Date.now(),
    };
    await putPreKey(record);
    results.push({ keyId: id, publicKey: bytesToBase64(publicRaw) });
    void publicKey;
  }
  return results;
}

/** Return all public one-time prekeys currently in storage for this user. */
export async function listPublicOneTimePreKeys(userId: string): Promise<PublicOneTimePreKey[]> {
  const all = await listPreKeys(userId);
  return all.map((k) => ({
    keyId: k.keyId,
    publicKey: bytesToBase64(k.publicKeyBytes),
  }));
}

/** Count of available (unused) one-time prekeys for this user. */
export async function getOneTimePreKeyCount(userId: string): Promise<number> {
  return countPreKeys(userId);
}

/** Mark a one-time prekey as consumed (delete it). */
export async function consumeOneTimePreKey(userId: string, keyId: number): Promise<void> {
  await deletePreKey(userId, keyId);
}

/**
 * Retrieve a one-time prekey's private key. Package-internal, MUST NOT
 * be exposed outside the crypto layer. Returns null if missing/consumed.
 */
export async function _getOneTimePreKeyPrivate(userId: string, keyId: number): Promise<StoredPreKey | null> {
  const rec = await getPreKey(userId, keyId);
  return rec ?? null;
}

/**
 * Delete all signed prekey state for this user. Called during account deletion.
 */
export async function deleteSignedPreKey(userId: string): Promise<void> {
  await deleteState(userId, RECORD_SIGNED_PREKEY);
}

// --- internals ---

async function rotateSignedPreKey(userId: string, previousId?: number): Promise<PublicSignedPreKey> {
  const signingKey = await getIdentitySigningKey(userId);
  const keyId = (previousId ?? 0) + 1;

  const kp = (await crypto.subtle.generateKey(
    { name: 'X25519' },
    /* extractable */ false,
    ['deriveKey', 'deriveBits'],
  )) as CryptoKeyPair;
  if (!kp.privateKey || !kp.publicKey) {
    throw new CryptoError('CRYPTO_ERROR', 'Failed to generate signed prekey.');
  }
  if (kp.privateKey.extractable) {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey private key is unexpectedly extractable.');
  }

  const publicRawBuf = await crypto.subtle.exportKey('raw', kp.publicKey);
  const publicRaw = new Uint8Array(publicRawBuf);
  const signatureBuf = await crypto.subtle.sign('Ed25519', signingKey, toBufferSource(publicRaw));
  const signature = new Uint8Array(signatureBuf);

  const publicKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(publicRaw),
    { name: 'X25519' },
    /* extractable */ true,
    /* usages */ [],
  );

  const record: PersistedSignedPreKey = {
    version: SIGNED_PREKEY_STATE_VERSION,
    userId,
    keyId,
    createdAt: Date.now(),
    publicKeyBase64: bytesToBase64(publicRaw),
    signatureBase64: bytesToBase64(signature),
    privateKey: kp.privateKey,
    publicKey,
  };
  await putState(userId, RECORD_SIGNED_PREKEY, record);
  return publicSignedPreKeyFromRecord(record);
}

async function loadSignedPreKeyRecord(userId: string): Promise<PersistedSignedPreKey | null> {
  const rec = await getState<PersistedSignedPreKey>(userId, RECORD_SIGNED_PREKEY);
  if (!rec) return null;
  if (
    rec.version !== SIGNED_PREKEY_STATE_VERSION ||
    typeof rec.keyId !== 'number' ||
    typeof rec.createdAt !== 'number' ||
    typeof rec.publicKeyBase64 !== 'string' ||
    typeof rec.signatureBase64 !== 'string' ||
    rec.userId !== userId ||
    !rec.privateKey ||
    !rec.publicKey
  ) {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey record is corrupted.');
  }
  const priv = rec.privateKey as CryptoKey;
  if (priv.type !== 'private' || priv.algorithm.name !== 'X25519') {
    throw new CryptoError('CORRUPT_STATE', 'Signed prekey has invalid key type.');
  }
  if (priv.extractable) {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Signed prekey private key must not be extractable.',
    );
  }
  return rec;
}

function isSignedPreKeyExpired(rec: PersistedSignedPreKey): boolean {
  return Date.now() - rec.createdAt >= SIGNED_PREKEY_ROTATION_MS;
}

function publicSignedPreKeyFromRecord(rec: PersistedSignedPreKey): PublicSignedPreKey {
  return Object.freeze({
    keyId: rec.keyId,
    publicKey: rec.publicKeyBase64,
    signature: rec.signatureBase64,
    createdAt: rec.createdAt,
  });
}

async function computeNextOtkId(userId: string): Promise<number> {
  const all = await listPreKeys(userId);
  if (all.length === 0) return 1;
  let max = 0;
  for (const k of all) {
    if (k.userId !== userId) continue;
    if (k.keyId > max) max = k.keyId;
  }
  return max + 1;
}

/**
 * Build the full public device bundle for upload to the server.
 * This includes only PUBLIC material.
 */
export async function getPublicDeviceBundle(
  userId: string,
  otkLimit: number = DEFAULT_OTK_POOL_SIZE,
): Promise<{
  identity: Awaited<ReturnType<typeof getIdentityBundle>>;
  signedPreKey: PublicSignedPreKey;
  oneTimePreKeys: PublicOneTimePreKey[];
}> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'User id is required.');
  const identity = await getIdentityBundle(userId);
  const spk = await ensureSignedPreKey(userId);
  let otks = await listPublicOneTimePreKeys(userId);
  if (otks.length < MIN_OTK_THRESHOLD) {
    const fresh = await refillOneTimePreKeys(userId);
    otks = otks.concat(fresh);
  }
  return {
    identity,
    signedPreKey: spk,
    oneTimePreKeys: otks.slice(0, otkLimit),
  };
}
