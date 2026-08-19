# enough. Crypto Layer

End-to-end encryption infrastructure for enough.

## Status (E2EE-1)

This directory contains **identity and prekey infrastructure only**. It does
**not** yet encrypt messages. `sendMessage()` continues to write plaintext to
`messages.ciphertext` — this is intentional and documented in
[`docs/e2ee-architecture.md`](../../../docs/e2ee-architecture.md).

The code here establishes:

1. **Identity keys** (`identity.ts`) — long-lived Ed25519 key pairs per device.
   Private keys are generated `non-extractable` via Web Crypto and persisted
   to IndexedDB, never to localStorage, React state, URLs, or cookies.
2. **PreKeys** (`prekeys.ts`) — signed X25519 prekey and a pool of one-time
   prekeys, ready for future asynchronous session establishment.
3. **Storage** (`storage.ts`) — a thin IndexedDB layer separate from UI state.
4. **Serialization** (`serialization.ts`) — base64 helpers for public key
   material. **Never** use these to serialize private keys.
5. **Errors** (`errors.ts`) — errors that contain no secret material.

## Public API

Import only from `src/lib/crypto` (the `index.ts` barrel):

```ts
import {
  isE2eeSupported,
  initCrypto,
  getIdentityBundle,
  getPublicDeviceBundle,
  deleteCryptoDatabase,
} from '../lib/crypto';
```

## Rules

- Private keys are `CryptoKey` objects with `extractable: false`. They must
  never leave this module as serializable values.
- Never log keys, signatures, or ciphertexts. Do not include them in error
  messages. Do not send them to Supabase except for the public bundles
  explicitly typed as `Public*`.
- Do not implement your own Double Ratchet, X3DH, PQXDH, or AES-GCM message
  transport. The ratchet engine will be plugged in later (see architecture
  doc, §8).
- Storage is IndexedDB only. Do not use localStorage for any key material.
- Logout does NOT delete the crypto identity. Account deletion MUST call
  `deleteCryptoDatabase()` in addition to server-side cleanup.
