// enough. E2EE-2A — HKDF-SHA-256 key derivation (PRIMITIVE ONLY)
// ---------------------------------------------------------------------------
// SCOPE / PROTOCOL BOUNDARY
//
//   Primitive only; not a Signal/X3DH/PQXDH/Double-Ratchet implementation.
//
// This is a thin, isolated wrapper around the native Web Crypto HKDF
// (RFC 5869, SHA-256). It performs ONE extract-and-expand step per call.
// It is NOT a key schedule: there are no root keys, no chain keys, no
// ratchet steps, no message counters and no session state. The final
// messenger KDF structure is intentionally NOT frozen here.
//
// SECURITY NOTES
//   * Input keying material is always a non-extractable `HKDF` CryptoKey
//     (typically the output of `deriveSharedSecret()`); raw IKM bytes are
//     only accepted through the explicit `importKeyMaterial()` helper, which
//     also imports non-extractably.
//   * `deriveMessageKey()` returns a NON-EXTRACTABLE AES-256-GCM CryptoKey.
//     Derived key bytes never enter the JS heap.
//   * `deriveKeyBytes()` returns raw octets. It exists for known-answer
//     tests and for future protocol layers that must serialize derived
//     material (e.g. chain keys). Its output is secret: never log it, never
//     store it in plaintext, never send it anywhere.
//   * Salt handling: the salt is NOT a secret. It may be transmitted and
//     stored publicly if the surrounding protocol says so. We deliberately
//     do NOT define a fixed global "secret salt" — that would be security
//     theatre. Use `generateSalt()` for fresh random salts; an empty salt is
//     accepted only because RFC 5869 defines it (HashLen zero bytes) and the
//     known-answer tests need it.
//   * Domain separation happens through `info`. Use `hkdfInfo(label)` so all
//     labels share the versioned `enough.` namespace and cannot collide with
//     labels of a future session protocol.

import { CryptoError } from './errors.ts';
import { toBufferSource } from './serialization.ts';

/** Hash used for HKDF throughout the primitive layer. */
export const HKDF_HASH = 'SHA-256' as const;

/** HKDF-SHA-256 output block size in bytes. */
export const HKDF_HASH_BYTES = 32;

/** Maximum HKDF output length (RFC 5869: 255 * HashLen). */
export const HKDF_MAX_OUTPUT_BYTES = 255 * HKDF_HASH_BYTES;

/** Recommended random salt length in bytes. */
export const DEFAULT_SALT_BYTES = 32;

/** Derived AES key size in bits. */
export const MESSAGE_KEY_BITS = 256;

/**
 * Versioned namespace for HKDF `info` labels.
 *
 * The `primitive.v1` component makes it explicit that these labels belong to
 * the primitive layer and are NOT the (still undefined) production session
 * protocol labels.
 */
export const HKDF_INFO_NAMESPACE = 'enough.e2ee.primitive.v1';

const encoder = new TextEncoder();

/**
 * Build a domain-separated HKDF `info` value:
 * `enough.e2ee.primitive.v1/<label>` as UTF-8 bytes.
 */
export function hkdfInfo(label: string): Uint8Array {
  if (typeof label !== 'string' || label.length === 0) {
    throw new CryptoError('CRYPTO_ERROR', 'HKDF info label must be a non-empty string.');
  }
  return encoder.encode(`${HKDF_INFO_NAMESPACE}/${label}`);
}

/**
 * Generate a fresh random (public) HKDF salt.
 * The salt is not secret and may be stored/transmitted alongside ciphertext.
 */
export function generateSalt(byteLength: number = DEFAULT_SALT_BYTES): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > 1024) {
    throw new CryptoError('CRYPTO_ERROR', 'Invalid salt length.');
  }
  const salt = new Uint8Array(byteLength);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Import raw input keying material as a non-extractable HKDF CryptoKey.
 *
 * Intended for (a) RFC 5869 known-answer tests and (b) future protocol code
 * that receives IKM from a source other than `deriveSharedSecret()` (e.g. a
 * KEM shared secret). The caller should zero its own copy afterwards.
 */
export async function importKeyMaterial(ikm: Uint8Array): Promise<CryptoKey> {
  if (!(ikm instanceof Uint8Array)) {
    throw new CryptoError('CRYPTO_ERROR', 'Key material must be a Uint8Array.');
  }
  return crypto.subtle.importKey(
    'raw',
    toBufferSource(ikm),
    { name: 'HKDF' },
    /* extractable */ false,
    ['deriveBits', 'deriveKey'],
  );
}

/**
 * Derive a NON-EXTRACTABLE AES-256-GCM key from a shared secret.
 *
 * @param sharedSecret HKDF CryptoKey (e.g. from `deriveSharedSecret()`).
 * @param salt         Public, non-secret salt. Use `generateSalt()`.
 * @param info         Domain-separation label. Use `hkdfInfo('...')`.
 *
 * Deterministic: identical (secret, salt, info) yields an identical key.
 * Changing salt or info yields an unrelated key.
 */
export async function deriveMessageKey(
  sharedSecret: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
): Promise<CryptoKey> {
  assertHkdfSecret(sharedSecret);
  assertBytes(salt, 'salt');
  assertBytes(info, 'info');
  if (info.byteLength === 0) {
    // Domain separation is mandatory for derived encryption keys.
    throw new CryptoError('CRYPTO_ERROR', 'HKDF info must not be empty for message keys.');
  }
  try {
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: HKDF_HASH,
        salt: toBufferSource(salt),
        info: toBufferSource(info),
      },
      sharedSecret,
      { name: 'AES-GCM', length: MESSAGE_KEY_BITS },
      /* extractable */ false,
      ['encrypt', 'decrypt'],
    );
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'HKDF key derivation failed.', e);
  }
}

/**
 * Derive raw octets via HKDF-SHA-256.
 *
 * Secret output — used by known-answer tests and by future protocol layers
 * that need serializable derived material. Never log or persist the result
 * in plaintext.
 */
export async function deriveKeyBytes(
  sharedSecret: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
  byteLength: number,
): Promise<Uint8Array> {
  assertHkdfSecret(sharedSecret);
  assertBytes(salt, 'salt');
  assertBytes(info, 'info');
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength > HKDF_MAX_OUTPUT_BYTES) {
    throw new CryptoError('CRYPTO_ERROR', 'Invalid HKDF output length.');
  }
  try {
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: HKDF_HASH,
        salt: toBufferSource(salt),
        info: toBufferSource(info),
      },
      sharedSecret,
      byteLength * 8,
    );
    return new Uint8Array(bits);
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'HKDF derivation failed.', e);
  }
}

// --- validation helpers -----------------------------------------------------

function assertHkdfSecret(key: CryptoKey): void {
  if (!key || typeof key !== 'object' || !('algorithm' in key)) {
    throw new CryptoError('CRYPTO_ERROR', 'An HKDF CryptoKey is required.');
  }
  if (key.algorithm.name !== 'HKDF') {
    throw new CryptoError('CRYPTO_ERROR', 'Key derivation requires an HKDF key.');
  }
  if (key.extractable) {
    throw new CryptoError('CORRUPT_STATE', 'Key material must not be extractable.');
  }
}

function assertBytes(value: Uint8Array, name: string): void {
  if (!(value instanceof Uint8Array)) {
    throw new CryptoError('CRYPTO_ERROR', `HKDF ${name} must be a Uint8Array.`);
  }
}
