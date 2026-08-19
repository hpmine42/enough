# enough. Crypto Layer — E2EE-1 Foundation

End-to-end encryption **foundation** for enough. (E2EE-1) — **NOT yet E2EE**.

## Status — Explicitly NOT yet E2EE

This directory contains **identity and prekey infrastructure only**.
It does **not** yet encrypt messages. `sendMessage()` continues to write
plaintext to `messages.ciphertext` — this is intentional and documented in
[`docs/e2ee-architecture.md`](../../../docs/e2ee-architecture.md).

**E2EE-1 scope (this PR) — what IS done:**
- X25519 identity keypairs are generated client-side via `crypto.subtle`.
- Private keys remain as **non-extractable `CryptoKey` objects in IndexedDB**,
  scoped per Supabase user id (`${userId}:recordKey`). No private material
  is ever written to `localStorage`, `sessionStorage`, cookies, URLs,
  React state, or Supabase.
- Public keys are **base64-encoded 32-byte raw X25519 keys** (standard
  `btoa`/`atob`, not base64url) via `exportPublicKey()` / `importPublicKey()`.
  This encoding is deterministic, reversible, and documented for
  `profiles.identity_public_key`. The column contains **only public-key
  material** — private keys never leave the browser.
- `profiles.identity_public_key` (`text`, nullable, migration `0010`) stores
  **strictly X25519 public keys** (base64, 32 bytes decoded). Ed25519 must
  never be written there. Existing users are backfilled lazily on next
  `initCrypto(userId)`; `Supabase never receives a private key`. If X25519 is
  not available in the current browser/context, the foundation is marked
  **not available** and **no alternative key** is stored — the messenger
  continues unchanged in plaintext mode.
- The mere storage of a public key in `profiles` **does NOT yet provide
  complete E2EE identity verification** (no fingerprint/safety-number
  verification, no trust-on-first-use UI).

**Explicitly NOT implemented in E2EE-1:**
- **Message Encryption NOT implemented** — `messages.ciphertext` stays
  plaintext until a future PR wires `X25519 → HKDF-SHA256 → AES-256-GCM`.
- **Forward Secrecy NOT implemented**
- **Message Ratcheting (Double Ratchet) NOT implemented**
- **No Signal-compatible session protocol (X3DH / PQXDH / Double Ratchet)
  is implemented** — the next PR will plug an audited library behind this
  layer (see architecture doc §8).

Future encryption (next PR) will use:
`X25519 (key agreement) → HKDF-SHA256 (key derivation) → AES-256-GCM (AEAD)`,
but only after an audited session library is integrated.

The code here establishes:

1. **Identity keys**
   - `identity.ts` — long-lived **Ed25519** keypair per device (signing
     identity for prekeys). Private key `non-extractable`, persisted in
     IndexedDB.
   - `keys.ts` — long-lived **X25519** keypair per device (key-agreement
     identity for future E2EE). `generateIdentityKeyPair()`, `exportPublicKey()`,
     `importPublicKey()`, `saveIdentityKeyPair()`, `loadIdentityKeyPair()`
     all operate on X25519 via Web Crypto; private keys are non-extractable
     and stored per-`userId` in IndexedDB.
2. **PreKeys** (`prekeys.ts`) — signed X25519 prekey and a pool of one-time
   prekeys, ready for future asynchronous session establishment.
3. **Storage** (`storage.ts`) — thin IndexedDB layer separate from UI state.
   Stores `CryptoKey` objects directly (structured-cloneable) under composite
   keys `${userId}:${recordKey}`; user isolation prevents cross-account reuse.
   Logout does **not** delete keys; login recovers them; missing keys are
   generated.
4. **Serialization** (`serialization.ts`) — base64 helpers for **public**
   key material only. Never use these to serialize private keys.
5. **Errors** (`errors.ts`) — generic messages that contain no secret material.
6. **Initialization** (`index.ts:initCrypto`) — on authenticated session,
   loads or generates the identity, ensures signed prekey + OTK pool,
   ensures the X25519 identity, and (via `AuthContext`) publishes **only**
   the public key to `profiles.identity_public_key`.

## Public API

Import only from `src/lib/crypto` (the `index.ts` barrel):

```ts
import {
  isE2eeSupported,
  initCrypto,
  generateIdentityKeyPair,
  exportPublicKey,
  importPublicKey,
  saveIdentityKeyPair,
  loadIdentityKeyPair,
  getIdentityBundle,
  getPublicDeviceBundle,
  deleteCryptoDatabase,
} from '../lib/crypto';
```

`generateIdentityKeyPair()` → `CryptoKeyPair` (X25519, private non-extractable)  
`exportPublicKey(publicKey)` → `string` (base64 32 bytes X25519)  
`importPublicKey(base64)` → `CryptoKey` (X25519 public, for ECDH)  
`saveIdentityKeyPair(userId, pair)` / `loadIdentityKeyPair(userId)` — IndexedDB,
per-user isolation.

`profiles.identity_public_key` receives **only** `exportPublicKey()` output
from an **X25519** key — Ed25519 must never be written there.

## Encoding

- Raw public keys for `identity_public_key`: **32 bytes X25519 only**.
  Ed25519 keys are 32 bytes too but must NOT be stored in this column.
- Encoding: standard base64 (`btoa`/`atob` over binary string), **not**
  base64url, no padding stripped. `bytesToBase64()` / `base64ToBytes()`
  are the canonical helpers. Any `identity_public_key` value must decode to
  exactly 32 bytes and, when imported via `importPublicKey()`, be usable as
  X25519.

## Rules

- Private keys are `CryptoKey` objects with `extractable: false`. They must
  never leave this module as serializable values; never `exportKey('pkcs8')`,
  never `JSON.stringify`, never log. No private X25519 key is ever sent to
  Supabase — profile updates send **only** `identity_public_key` (public).
- Never log keys, signatures, or ciphertexts. Do not include them in error
  messages. Do not send them to Supabase except for the public bundles
  explicitly typed as `Public*` or the single X25519 `identity_public_key` string.
- `identity_public_key` is **only public-key material**; its presence alone
  does NOT yet constitute complete E2EE identity verification.
- Do not implement your own Double Ratchet, X3DH, PQXDH, or AES-GCM message
  transport. The ratchet engine will be plugged in later (see architecture
  doc, §8). **Forward secrecy, message ratcheting and Signal-compatible
  sessions are explicitly NOT implemented in E2EE-1.**
- Storage is **IndexedDB only** (`enough-crypto` DB, stores `state` and
  `prekeys`). Do not use `localStorage` for any key material.
- Logout does NOT delete the crypto identity. Account deletion MUST call
  `deleteUserCryptoState(userId)` (or `deleteCryptoDatabase()`) in addition
  to server-side cleanup.
- RLS / Guard: `profiles` SELECT is `authenticated` (`USING true` from 0009)
  and UPDATE is owner-only (`id = auth.uid()`); `guard_profile_update`
  explicitly allows **only** `display_name` and `identity_public_key` to
  change (`id`/`username`/`created_at` and all other columns are immutable).
  The new column inherits those policies — no new permissive policy is
  introduced. If X25519 is unavailable, no alternative key is stored.
