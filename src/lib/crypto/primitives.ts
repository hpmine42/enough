// enough. E2EE-2A — Primitive layer barrel
// ---------------------------------------------------------------------------
//   Primitive only; not a Signal/X3DH/PQXDH/Double-Ratchet implementation.
// ---------------------------------------------------------------------------
//
// This barrel groups the three local cryptographic primitives added in
// E2EE-2A:
//
//     X25519 shared secret  →  HKDF-SHA-256  →  AES-256-GCM
//     (key-agreement.ts)       (kdf.ts)         (symmetric.ts)
//
// DELIBERATELY NOT RE-EXPORTED FROM `src/lib/crypto/index.ts`.
// `index.ts` is the application-facing barrel; keeping the primitives out of
// it makes the "no production integration" boundary mechanically checkable
// (see `__tests__/primitives.test.mjs`). Only tests import this module today.
//
// What this layer is NOT (and must not silently become):
//   X3DH · PQXDH · Double Ratchet · Triple Ratchet · session establishment ·
//   forward secrecy · post-compromise security · protocol-level replay
//   protection · key verification / safety numbers · multi-device ·
//   offline session negotiation · key backup or recovery.
//
// All operations are local: nothing here reads or writes IndexedDB,
// localStorage, sessionStorage, cookies, URLs, React state or Supabase, and
// nothing here logs.

export {
  deriveSharedSecret,
  X25519_PUBLIC_KEY_BYTES,
  X25519_SHARED_SECRET_BYTES,
  type SharedSecret,
} from './key-agreement.ts';

export {
  deriveMessageKey,
  deriveKeyBytes,
  importKeyMaterial,
  generateSalt,
  hkdfInfo,
  HKDF_HASH,
  HKDF_HASH_BYTES,
  HKDF_MAX_OUTPUT_BYTES,
  HKDF_INFO_NAMESPACE,
  DEFAULT_SALT_BYTES,
  MESSAGE_KEY_BITS,
} from './kdf.ts';

export {
  encryptBytes,
  decryptBytes,
  generateNonce,
  generateLocalAesKey,
  importAesKey,
  toSealedContainer,
  fromSealedContainer,
  AES_GCM_KEY_BITS,
  AES_GCM_KEY_BYTES,
  AES_GCM_NONCE_BYTES,
  AES_GCM_TAG_BITS,
  AES_GCM_TAG_BYTES,
  SEALED_CONTAINER_VERSION,
  type SealedBytes,
  type SealedContainer,
} from './symmetric.ts';
