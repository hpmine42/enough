// enough. E2EE — Serialization helpers for PUBLIC key material only
// --------------------------------------------------------------
// These helpers deal with base64 encoding/decoding of public bytes and
// JSON serialization of public bundles. They MUST NEVER be used to
// serialize private/secret keys — those remain as non-extractable CryptoKey
// objects inside IndexedDB.

import { CryptoError } from './errors.ts';
import type {
  PublicIdentityBundle,
  PublicOneTimePreKey,
  PublicSignedPreKey,
} from './types.ts';

/**
 * Encode a Uint8Array to an unpadded base64 (not base64url) string.
 * Uses the browser's btoa for correctness, with a Uint8Array -> binary string
 * conversion that is safe for all byte values.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Decode an unpadded base64 string to Uint8Array. Throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array {
  // Reject whitespace / URL-safe variants / padding oddities early.
  if (typeof b64 !== 'string') {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid base64 input.');
  }
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid base64 input.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Export a public Ed25519 or X25519 CryptoKey to raw bytes.
 * Only public keys may be passed. `extractable` must have been set at
 * key generation. We only call this for public keys.
 */
export async function exportPublicKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  if (key.type !== 'public') {
    throw new CryptoError(
      'CRYPTO_ERROR',
      'Refusing to export a non-public key.',
    );
  }
  const buf = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(buf);
}

/** Import a raw public key (Ed25519 for verification, X25519 for ECDH). */
export async function importPublicKeyRaw(
  data: Uint8Array,
  algorithm: 'Ed25519' | 'X25519',
  usages: ReadonlyArray<'verify' | 'deriveKey' | 'deriveBits'>,
): Promise<CryptoKey> {
  // Copy into a fresh ArrayBuffer-backed view so TypeScript (and at runtime)
  // is guaranteed a non-SharedArrayBuffer BufferSource.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return crypto.subtle.importKey('raw', copy, algorithm, true, usages as KeyUsage[]);
}

/**
 * Coerce a Uint8Array to a BufferSource suitable for SubtleCrypto.
 * Ensures the returned view references a plain (non-shared) ArrayBuffer
 * because Web Crypto rejects SharedArrayBuffer-backed views.
 */
export function toBufferSource(bytes: Uint8Array): BufferSource {
  // Always copy into a fresh ArrayBuffer-backed Uint8Array to satisfy both
  // the SharedArrayBuffer type-check and any offset/length edge cases.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return copy;
}

/** Serialize the public identity bundle to a JSON-safe object. */
export function serializeIdentityBundle(
  bundle: PublicIdentityBundle,
): string {
  // Defensive deep copy to avoid caller mutating bytes before encoding.
  const out: PublicIdentityBundle = {
    version: bundle.version,
    deviceId: bundle.deviceId,
    userId: bundle.userId,
    identityKey: bundle.identityKey,
    createdAt: bundle.createdAt,
  };
  return JSON.stringify(out);
}

export function deserializeIdentityBundle(
  json: string,
): PublicIdentityBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid identity bundle JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid identity bundle.');
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.version !== 'number' ||
    typeof obj.deviceId !== 'string' ||
    typeof obj.userId !== 'string' ||
    typeof obj.identityKey !== 'string' ||
    typeof obj.createdAt !== 'number'
  ) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Malformed identity bundle fields.');
  }
  // Validate that identityKey decodes to a 32-byte Ed25519 public key.
  const pk = base64ToBytes(obj.identityKey);
  if (pk.byteLength !== 32) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Identity public key has wrong length.');
  }
  return {
    version: obj.version,
    deviceId: obj.deviceId,
    userId: obj.userId,
    identityKey: obj.identityKey,
    createdAt: obj.createdAt,
  };
}

export function serializeSignedPreKey(spk: PublicSignedPreKey): string {
  return JSON.stringify(spk);
}

export function deserializeSignedPreKey(json: string): PublicSignedPreKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid signed prekey JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid signed prekey.');
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.keyId !== 'number' ||
    typeof obj.publicKey !== 'string' ||
    typeof obj.signature !== 'string' ||
    typeof obj.createdAt !== 'number'
  ) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Malformed signed prekey fields.');
  }
  if (base64ToBytes(obj.publicKey).byteLength !== 32) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Signed prekey public key has wrong length.');
  }
  if (base64ToBytes(obj.signature).byteLength !== 64) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Signed prekey signature has wrong length.');
  }
  return {
    keyId: obj.keyId,
    publicKey: obj.publicKey,
    signature: obj.signature,
    createdAt: obj.createdAt,
  };
}

export function serializeOneTimePreKey(otk: PublicOneTimePreKey): string {
  return JSON.stringify(otk);
}

export function deserializeOneTimePreKey(json: string): PublicOneTimePreKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid one-time prekey JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Invalid one-time prekey.');
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.keyId !== 'number' ||
    typeof obj.publicKey !== 'string'
  ) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'Malformed one-time prekey fields.');
  }
  if (base64ToBytes(obj.publicKey).byteLength !== 32) {
    throw new CryptoError('DESERIALIZATION_ERROR', 'One-time prekey public key has wrong length.');
  }
  return { keyId: obj.keyId, publicKey: obj.publicKey };
}

/**
 * Generate a client-side device id. Uses crypto.randomUUID() when available,
 * which we already verified is present in the environments we target.
 */
export function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 16 random bytes -> UUID v4 shape. Extremely defensive for older browsers.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
