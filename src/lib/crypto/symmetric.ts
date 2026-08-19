// enough. E2EE-2A — AES-256-GCM authenticated encryption (PRIMITIVE ONLY)
// ---------------------------------------------------------------------------
// SCOPE / PROTOCOL BOUNDARY
//
//   Primitive only; not a Signal/X3DH/PQXDH/Double-Ratchet implementation.
//
// Local AEAD helpers around the native Web Crypto AES-GCM implementation.
// No AEAD is implemented by hand. There is no message framing, no session
// binding, no counters, no replay protection and no wire format for the
// `messages` table here — those belong to a future protocol layer.
//
// PARAMETERS
//   * AES-256-GCM, 256-bit keys, 128-bit authentication tag.
//   * 96-bit (12-byte) nonce/IV, freshly generated with
//     `crypto.getRandomValues()` on EVERY `encryptBytes()` call. Nonces are
//     public: they may be stored/transmitted next to the ciphertext. They
//     must NEVER be reused with the same key — which is why this module
//     never accepts a caller-supplied nonce for encryption.
//   * Optional Associated Additional Data (AAD): authenticated but not
//     encrypted. The production AAD format (protocol version, connection id,
//     device ids, …) is intentionally NOT fixed in this phase; the API only
//     guarantees that AAD is supported and enforced.

import { CryptoError } from './errors.ts';
import { base64ToBytes, bytesToBase64, toBufferSource } from './serialization.ts';

/** AES-GCM key size in bits. */
export const AES_GCM_KEY_BITS = 256;

/** AES-GCM key size in bytes. */
export const AES_GCM_KEY_BYTES = AES_GCM_KEY_BITS / 8;

/** Nonce/IV size in bytes (96 bit, the AES-GCM recommended size). */
export const AES_GCM_NONCE_BYTES = 12;

/** Authentication tag size in bits. */
export const AES_GCM_TAG_BITS = 128;

/** Authentication tag size in bytes. */
export const AES_GCM_TAG_BYTES = AES_GCM_TAG_BITS / 8;

/** Result of {@link encryptBytes}: public nonce + ciphertext‖tag. */
export interface SealedBytes {
  /** 12-byte random nonce. Public, must be stored with the ciphertext. */
  nonce: Uint8Array;
  /** Ciphertext with the 16-byte GCM tag appended (Web Crypto layout). */
  ciphertext: Uint8Array;
}

/**
 * Generate a fresh random 96-bit nonce.
 * Exposed for tests and for future protocol code; `encryptBytes()` always
 * generates its own nonce internally.
 */
export function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Generate a random NON-EXTRACTABLE AES-256-GCM key.
 *
 * For local use and tests only. Production keys must come from
 * `deriveMessageKey()` so they are bound to an X25519 agreement.
 */
export async function generateLocalAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_GCM_KEY_BITS },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  ) as Promise<CryptoKey>;
}

/**
 * Import raw 32 key bytes as a NON-EXTRACTABLE AES-256-GCM key.
 * Intended for standardized known-answer tests and for future protocol
 * layers that receive key bytes from a KDF chain.
 */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (!(raw instanceof Uint8Array) || raw.byteLength !== AES_GCM_KEY_BYTES) {
    throw new CryptoError('CRYPTO_ERROR', 'AES key must be 32 bytes.');
  }
  return crypto.subtle.importKey(
    'raw',
    toBufferSource(raw),
    { name: 'AES-GCM' },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt bytes with AES-256-GCM under a freshly generated 96-bit nonce.
 *
 * @param key       AES-256-GCM CryptoKey (`deriveMessageKey()` output).
 * @param plaintext Bytes to encrypt (may be empty).
 * @param aad       Optional associated data: authenticated, not encrypted.
 * @returns         `{ nonce, ciphertext }` — the nonce is public and must be
 *                  supplied unchanged to {@link decryptBytes}.
 */
export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<SealedBytes> {
  assertAesKey(key, 'encrypt');
  assertBytes(plaintext, 'plaintext');
  if (aad !== undefined) assertBytes(aad, 'aad');

  // A fresh nonce per call: nonce reuse under the same key destroys AES-GCM
  // security, so no caller is allowed to supply one.
  const nonce = generateNonce();
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: toBufferSource(nonce),
    tagLength: AES_GCM_TAG_BITS,
  };
  if (aad !== undefined) params.additionalData = toBufferSource(aad);

  try {
    const buf = await crypto.subtle.encrypt(params, key, toBufferSource(plaintext));
    return { nonce, ciphertext: new Uint8Array(buf) };
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'AES-GCM encryption failed.', e);
  }
}

/**
 * Decrypt and verify an AES-256-GCM ciphertext.
 *
 * Throws `CryptoError('CRYPTO_ERROR')` when authentication fails — i.e. on a
 * tampered ciphertext, a tampered nonce, a wrong key or mismatching AAD. The
 * error message contains no key, nonce or ciphertext material.
 */
export async function decryptBytes(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  assertAesKey(key, 'decrypt');
  assertBytes(ciphertext, 'ciphertext');
  assertBytes(nonce, 'nonce');
  if (nonce.byteLength !== AES_GCM_NONCE_BYTES) {
    throw new CryptoError('CRYPTO_ERROR', 'AES-GCM nonce must be 12 bytes.');
  }
  if (ciphertext.byteLength < AES_GCM_TAG_BYTES) {
    throw new CryptoError('CRYPTO_ERROR', 'AES-GCM ciphertext is too short.');
  }
  if (aad !== undefined) assertBytes(aad, 'aad');

  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: toBufferSource(nonce),
    tagLength: AES_GCM_TAG_BITS,
  };
  if (aad !== undefined) params.additionalData = toBufferSource(aad);

  try {
    const buf = await crypto.subtle.decrypt(params, key, toBufferSource(ciphertext));
    return new Uint8Array(buf);
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'AES-GCM authentication failed.', e);
  }
}

// ---------------------------------------------------------------------------
// Conceptual container — TEST/DEV ONLY
// ---------------------------------------------------------------------------
// This is a minimal JSON shape used to demonstrate that nonce + ciphertext
// round-trip through the existing base64 helpers. It is explicitly NOT the
// `messages` database format, NOT a wire format and NOT versioned protocol
// state. `messages.ciphertext` stays plaintext in this phase (see
// docs/e2ee-architecture.md).

/** Version tag of the conceptual test container. */
export const SEALED_CONTAINER_VERSION = 1;

export interface SealedContainer {
  version: number;
  /** Base64 of the 12-byte nonce. */
  nonce: string;
  /** Base64 of ciphertext‖tag. */
  ciphertext: string;
}

/** Encode `{nonce, ciphertext}` into the conceptual JSON-safe container. */
export function toSealedContainer(sealed: SealedBytes): SealedContainer {
  assertBytes(sealed?.nonce, 'nonce');
  assertBytes(sealed?.ciphertext, 'ciphertext');
  return {
    version: SEALED_CONTAINER_VERSION,
    nonce: bytesToBase64(sealed.nonce),
    ciphertext: bytesToBase64(sealed.ciphertext),
  };
}

/** Decode the conceptual container back into raw bytes. Validates strictly. */
export function fromSealedContainer(container: unknown): SealedBytes {
  if (!container || typeof container !== 'object') {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid sealed container.');
  }
  const obj = container as Record<string, unknown>;
  if (
    obj.version !== SEALED_CONTAINER_VERSION ||
    typeof obj.nonce !== 'string' ||
    typeof obj.ciphertext !== 'string'
  ) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Malformed sealed container fields.');
  }
  const nonce = base64ToBytes(obj.nonce);
  const ciphertext = base64ToBytes(obj.ciphertext);
  if (nonce.byteLength !== AES_GCM_NONCE_BYTES) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Sealed container nonce has wrong length.');
  }
  if (ciphertext.byteLength < AES_GCM_TAG_BYTES) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Sealed container ciphertext is too short.');
  }
  return { nonce, ciphertext };
}

// --- validation helpers -----------------------------------------------------

function assertAesKey(key: CryptoKey, usage: 'encrypt' | 'decrypt'): void {
  if (!key || typeof key !== 'object' || !('algorithm' in key)) {
    throw new CryptoError('CRYPTO_ERROR', 'An AES-GCM CryptoKey is required.');
  }
  if (key.algorithm.name !== 'AES-GCM') {
    throw new CryptoError('CRYPTO_ERROR', 'Symmetric operations require an AES-GCM key.');
  }
  const length = (key.algorithm as AesKeyAlgorithm).length;
  if (length !== AES_GCM_KEY_BITS) {
    throw new CryptoError('CRYPTO_ERROR', 'AES-GCM key must be 256 bits.');
  }
  if (!key.usages.includes(usage)) {
    throw new CryptoError('CRYPTO_ERROR', `AES-GCM key is missing the ${usage} usage.`);
  }
}

function assertBytes(value: Uint8Array, name: string): void {
  if (!(value instanceof Uint8Array)) {
    throw new CryptoError('CRYPTO_ERROR', `AES-GCM ${name} must be a Uint8Array.`);
  }
}
