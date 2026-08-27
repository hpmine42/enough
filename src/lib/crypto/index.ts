// enough. E2EE — Public API surface
// --------------------------------------------------------------
// This is the ONLY module that UI/message-service code should import.
// It deliberately exposes only the operations needed for device lifecycle
// and (in later phases) message encrypt/decrypt. No private key material
// is ever returned from these functions.
//
// NOTE: As of E2EE-1, no message encryption/decryption is performed.
// `sendMessage()` continues to write plaintext to `messages.ciphertext`.
// This layer currently manages only identity and prekey infrastructure.

export { CryptoError, isCryptoError } from './errors.ts';

export {
  hasIdentity,
  generateIdentity,
  loadIdentity,
  getIdentityBundle,
  getIdentityBundleJSON,
  getDeviceId,
  deleteIdentity,
  verifyWithPublicKey,
} from './identity.ts';

export {
  generateIdentityKeyPair,
  exportPublicKey,
  importPublicKey,
  saveIdentityKeyPair,
  loadIdentityKeyPair,
  getX25519PublicKeyBase64,
  deleteX25519Identity,
} from './keys.ts';

export {
  ensureSignedPreKey,
  getSignedPreKey,
  refillOneTimePreKeys,
  listPublicOneTimePreKeys,
  getOneTimePreKeyCount,
  getPublicDeviceBundle,
  consumeOneTimePreKey,
  deleteSignedPreKey,
  DEFAULT_OTK_POOL_SIZE,
  MIN_OTK_THRESHOLD,
  SIGNED_PREKEY_ROTATION_MS,
} from './prekeys.ts';

export {
  bytesToBase64,
  base64ToBytes,
  importPublicKeyRaw,
  serializeIdentityBundle,
  deserializeIdentityBundle,
  serializeSignedPreKey,
  deserializeSignedPreKey,
  serializeOneTimePreKey,
  deserializeOneTimePreKey,
  generateDeviceId,
} from './serialization.ts';

export {
  assertCryptoEnvironment,
  deleteUserCryptoState,
  deleteCryptoDatabase,
} from './storage.ts';

export type {
  DeviceId,
  PublicIdentityBundle,
  PublicSignedPreKey,
  PublicOneTimePreKey,
  PublicDeviceBundle,
  CryptoErrorCode,
} from './types.ts';

import { assertCryptoEnvironment } from './storage.ts';
import {
  generateIdentity,
  hasIdentity,
  loadIdentity,
} from './identity.ts';
import {
  MIN_OTK_THRESHOLD,
  ensureSignedPreKey,
  getOneTimePreKeyCount,
  refillOneTimePreKeys,
} from './prekeys.ts';
import {
  generateIdentityKeyPair as generateX25519KeyPair,
  loadIdentityKeyPair as loadX25519KeyPair,
  saveIdentityKeyPair as saveX25519KeyPair,
  exportPublicKey as exportX25519PublicKey,
} from './keys.ts';
import type { PublicIdentityBundle } from './types.ts';

/**
 * Per-user in-flight mutex for initCrypto() to avoid races where two
 * concurrent calls (auth listener + getSession callback) double-generate
 * an identity for the same user.
 */
const initLocks = new Map<string, Promise<PublicIdentityBundle>>();

/**
 * Check whether the browser supports the primitives needed for enough.'s
 * E2EE layer. Call this before attempting any crypto operations. If it
 * returns false, the app falls back to the existing plaintext behaviour.
 */
export function isE2eeSupported(): boolean {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return false;
    if (typeof indexedDB === 'undefined') return false;
    if (typeof crypto.getRandomValues !== 'function') return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize (or load) the local device identity for the signed-in user
 * and ensure a signed prekey + a full one-time-prekey pool exist.
 *
 * Safe to call on every app start and on every auth state change;
 * idempotent per user. Concurrent calls for the same user are serialized.
 *
 * Returns the public identity bundle. Does NOT touch the message flow.
 *
 * Callers MUST pass the current Supabase user id so the crypto state is
 * correctly isolated when multiple accounts share a single browser profile.
 */
export async function initCrypto(userId: string): Promise<PublicIdentityBundle> {
  if (!userId) {
    throw new Error('initCrypto: userId is required');
  }
  assertCryptoEnvironment();

  // Serialize concurrent inits for the same user.
  const existing = initLocks.get(userId);
  if (existing) return existing;

  const job = (async (): Promise<PublicIdentityBundle> => {
    let bundle: PublicIdentityBundle | null;
    if (!(await hasIdentity(userId))) {
      bundle = await generateIdentity(userId);
      await refillOneTimePreKeys(userId);
    } else {
      bundle = await loadIdentity(userId);
      if (!bundle) {
        bundle = await generateIdentity(userId);
        await refillOneTimePreKeys(userId);
      } else {
        await ensureSignedPreKey(userId);
        const count = await getOneTimePreKeyCount(userId);
        if (count < MIN_OTK_THRESHOLD) {
          await refillOneTimePreKeys(userId);
        }
      }
    }
    // Ensure X25519 identity keypair also exists for the E2EE-1 foundation.
    // This is the "identity" described in the PR scope (X25519 for key
    // agreement). It is stored separately from the Ed25519 signing identity
    // above, both scoped per userId.
    try {
      const existingX = await loadX25519KeyPair(userId);
      if (!existingX) {
        const kp = await generateX25519KeyPair();
        await saveX25519KeyPair(userId, kp);
      }
    } catch {
      // X25519 generation failure must not break the main Ed25519 flow.
      // Callers handle the fallback and never leak keys.
    }
    return bundle;
  })();

  initLocks.set(userId, job);
  try {
    return await job;
  } finally {
    initLocks.delete(userId);
  }
}

/**
 * Get the X25519 public identity key for a user as a base64 string
 * suitable for `profiles.identity_public_key`.
 * Returns null if no X25519 identity exists yet.
 * This is the key that should be published to Supabase.
 */
export async function getX25519IdentityPublicKeyBase64(userId: string): Promise<string | null> {
  const kp = await loadX25519KeyPair(userId);
  if (!kp) return null;
  return exportX25519PublicKey(kp.publicKey);
}

/**
 * Ensure an X25519 identity exists for the user and return its public
 * base64. Generates and persists if missing. Used by profile sync.
 */
export async function ensureX25519Identity(userId: string): Promise<string> {
  let kp = await loadX25519KeyPair(userId);
  if (!kp) {
    kp = await generateX25519KeyPair();
    await saveX25519KeyPair(userId, kp);
  }
  return exportX25519PublicKey(kp.publicKey);
}
