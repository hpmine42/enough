// enough. E2EE-2A — X25519 key agreement (PRIMITIVE ONLY)
// ---------------------------------------------------------------------------
// SCOPE / PROTOCOL BOUNDARY
//
//   Primitive only; not a Signal/X3DH/PQXDH/Double-Ratchet implementation.
//
// This module exposes a single cryptographic operation: a raw X25519
// Diffie-Hellman key agreement between one local non-extractable private key
// and one peer public key. It deliberately implements NO session semantics:
// no handshake, no prekey selection, no DH concatenation schedule, no root/
// chain keys, no forward secrecy, no post-compromise security, no replay
// protection, no key verification, no multi-device fan-out.
//
// A real session protocol (PQXDH + Double Ratchet, see
// docs/e2ee-session-architecture.md) will later be provided by a vetted
// engine and may call this primitive — but nothing in this file constitutes
// such a protocol.
//
// SECURITY RULES ENFORCED HERE
//   * The local private key MUST be a non-extractable X25519 CryptoKey.
//     We never export it, never serialize it, never log it.
//   * The 32-byte shared secret never leaves this module as bytes: it is
//     immediately imported as a NON-EXTRACTABLE `HKDF` CryptoKey and the
//     temporary byte buffer is zeroed. Callers therefore cannot read, log,
//     persist or upload it.
//   * Nothing here touches Supabase, the network, localStorage,
//     sessionStorage, cookies, URLs or React state.
//   * All-zero DH output (small-order peer point) is rejected.

import { CryptoError } from './errors.ts';
import { toBufferSource } from './serialization.ts';

/** Raw X25519 public key length in bytes. */
export const X25519_PUBLIC_KEY_BYTES = 32;

/** Raw X25519 shared-secret length in bytes. */
export const X25519_SHARED_SECRET_BYTES = 32;

/**
 * Opaque handle for an X25519 shared secret.
 *
 * It is a non-extractable `HKDF` CryptoKey: usable as input keying material
 * (IKM) for {@link ./kdf.ts deriveMessageKey} / `deriveKeyBytes`, but the raw
 * secret bytes are unreachable from JavaScript.
 */
export type SharedSecret = CryptoKey;

/**
 * Perform an X25519 key agreement.
 *
 * @param myPrivateKey  Local X25519 private key (`extractable: false`,
 *                      usage `deriveBits`), e.g. from `keys.ts`
 *                      `loadIdentityKeyPair()` / `generateIdentityKeyPair()`.
 * @param peerPublicKey Peer X25519 public key, e.g. from `keys.ts`
 *                      `importPublicKey(base64)`.
 * @returns             Non-extractable HKDF CryptoKey wrapping the 32-byte
 *                      shared secret. Never the raw bytes.
 *
 * Both sides of the exchange obtain the same secret:
 *   deriveSharedSecret(a.privateKey, b.publicKey)
 *     === deriveSharedSecret(b.privateKey, a.publicKey)
 *
 * The result MUST NOT be used directly as an encryption key — always run it
 * through HKDF (`deriveMessageKey`) first.
 */
export async function deriveSharedSecret(
  myPrivateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<SharedSecret> {
  assertX25519PrivateKey(myPrivateKey);
  assertX25519PublicKey(peerPublicKey);

  let raw: Uint8Array;
  try {
    const bits = await crypto.subtle.deriveBits(
      { name: 'X25519', public: peerPublicKey } as unknown as AlgorithmIdentifier,
      myPrivateKey,
      X25519_SHARED_SECRET_BYTES * 8,
    );
    raw = new Uint8Array(bits);
  } catch (e) {
    // Web Crypto throws OperationError for small-order / invalid peer points.
    // The error carries no key material; we still wrap it in a generic
    // CryptoError so nothing implementation-specific reaches the UI.
    throw new CryptoError('CRYPTO_ERROR', 'X25519 key agreement failed.', e);
  }

  try {
    if (raw.byteLength !== X25519_SHARED_SECRET_BYTES) {
      throw new CryptoError('CRYPTO_ERROR', 'X25519 shared secret has wrong length.');
    }
    if (isAllZero(raw)) {
      // Contributory-behaviour check: a small-order peer public key would
      // yield an all-zero secret. Never derive keys from it.
      throw new CryptoError('CRYPTO_ERROR', 'X25519 key agreement produced a degenerate secret.');
    }
    // Import as non-extractable HKDF input keying material. From here on the
    // secret only exists inside the Web Crypto implementation.
    return await crypto.subtle.importKey(
      'raw',
      toBufferSource(raw),
      { name: 'HKDF' },
      /* extractable */ false,
      ['deriveBits', 'deriveKey'],
    );
  } finally {
    // Best-effort scrub of the transient copy in the JS heap.
    raw.fill(0);
  }
}

// --- validation helpers -----------------------------------------------------

function assertX25519PrivateKey(key: CryptoKey): void {
  if (!key || typeof key !== 'object' || !('type' in key)) {
    throw new CryptoError('CRYPTO_ERROR', 'A private CryptoKey is required.');
  }
  if (key.type !== 'private') {
    throw new CryptoError('CRYPTO_ERROR', 'Key agreement requires a private key.');
  }
  if (key.algorithm.name !== 'X25519') {
    throw new CryptoError('CRYPTO_ERROR', 'Key agreement requires an X25519 private key.');
  }
  if (key.extractable) {
    // Hard stop: an extractable private key violates the storage contract.
    throw new CryptoError('CORRUPT_STATE', 'Private key must not be extractable.');
  }
  if (!key.usages.includes('deriveBits')) {
    throw new CryptoError('CRYPTO_ERROR', 'Private key is missing the deriveBits usage.');
  }
}

function assertX25519PublicKey(key: CryptoKey): void {
  if (!key || typeof key !== 'object' || !('type' in key)) {
    throw new CryptoError('CRYPTO_ERROR', 'A public CryptoKey is required.');
  }
  if (key.type !== 'public') {
    throw new CryptoError('CRYPTO_ERROR', 'Key agreement requires a public peer key.');
  }
  if (key.algorithm.name !== 'X25519') {
    throw new CryptoError('CRYPTO_ERROR', 'Key agreement requires an X25519 public key.');
  }
}

function isAllZero(bytes: Uint8Array): boolean {
  let acc = 0;
  for (let i = 0; i < bytes.byteLength; i++) acc |= bytes[i]!;
  return acc === 0;
}
