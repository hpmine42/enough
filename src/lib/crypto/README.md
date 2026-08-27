# enough. Crypto Layer — E2EE-1 Foundation

End-to-end encryption **foundation** for enough. (E2EE-1) — **NOT yet E2EE**.

> **Status update (audit finding F2):** the E2EE-1 login initialization
> (`AuthContext.ensureCryptoReady` → `initCrypto`, including the publish of an
> X25519 public key to `profiles.identity_public_key`) has been **removed from
> the app** — the production message flow uses the Signal-based E2EE
> architecture in `src/lib/e2ee/`, which does not depend on this layer.
> The modules below remain as a tested library (and for the shared
> storage/serialization primitives the Signal layer builds on); their removal
> is deferred. `profiles.identity_public_key` is no longer written or read by
> any production path; the column and migration `0010` stay in place
> unchanged.

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
- `profiles.identity_public_key` (`text`, nullable, migration `0010`) was
  specified to store **strictly X25519 public keys** (base64, 32 bytes
  decoded); Ed25519 must never be written there. Since F2 the app no longer
  initializes E2EE-1 at login and **no production path writes or reads this
  column**; the column, its rules and migration `0010` remain in the schema
  unchanged. `Supabase never receives a private key` under either regime.
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
6. **Initialization** (`index.ts:initCrypto`) — loads or generates the
   identity, ensures signed prekey + OTK pool, and ensures the X25519
   identity. **No longer called by application code** (removed from login
   with F2); it remains a library entry point exercised by the crypto test
   suite. Production E2EE initialization lives in
   `src/context/E2EEContext.tsx` → `src/lib/e2ee/session-manager.ts`.

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

---

# E2EE-2A — Primitive Layer (additive, NOT wired into the app)

> **Primitive only; not a Signal/X3DH/PQXDH/Double-Ratchet implementation.**

E2EE-2A adds the local cryptographic building blocks that a future, vetted
session protocol can sit on top of. It changes nothing about the existing
E2EE-1 identity/prekey infrastructure and nothing about the message flow:
`sendMessage()` still writes plaintext to `messages.ciphertext`.

```
X25519 shared secret  →  HKDF-SHA-256  →  AES-256-GCM key  →  local encrypt/decrypt  →  tests
```

## Modules

| File | Contents |
|---|---|
| `key-agreement.ts` | `deriveSharedSecret(myPrivateKey, peerPublicKey)` — X25519 only. Returns a **non-extractable `HKDF` CryptoKey**; the 32 raw secret bytes are never handed to callers (the transient buffer is zeroed). Rejects extractable private keys, non-X25519 keys, wrong key roles and degenerate (all-zero) results. |
| `kdf.ts` | `deriveMessageKey(sharedSecret, salt, info)` → non-extractable AES-256-GCM key; `deriveKeyBytes(...)` → raw octets (KATs / future protocol use); `importKeyMaterial(ikm)`, `generateSalt(n = 32)`, `hkdfInfo(label)`. |
| `symmetric.ts` | `encryptBytes(key, plaintext, aad?)` → `{ nonce, ciphertext }`; `decryptBytes(key, ciphertext, nonce, aad?)`; `generateNonce()`, `generateLocalAesKey()`, `importAesKey(raw)`, plus a **test-only** `{ version, nonce, ciphertext }` container. |
| `primitives.ts` | Barrel for the three modules above. **Deliberately not re-exported from `index.ts`** so the "no production integration" boundary is mechanically testable. |

Reused (not duplicated): `serialization.ts` (`bytesToBase64`, `base64ToBytes`,
`toBufferSource`), `errors.ts` (`CryptoError`), `keys.ts`
(`generateIdentityKeyPair`, `importPublicKey`).

## Parameters and rules

- **X25519** via `crypto.subtle.deriveBits`; private keys stay
  `extractable: false` and are never exported.
- **HKDF-SHA-256**, one extract-and-expand step per call. No key schedule, no
  chain/root keys, no ratchet.
- **Salt is public**, freshly random per derivation (`generateSalt()`). There
  is no fixed global "secret salt" — that would be security theatre. An empty
  salt is accepted only because RFC 5869 defines it (needed for the KATs).
- **Domain separation via `info`**: `hkdfInfo('label')` yields
  `enough.e2ee.primitive.v1/label`. The `primitive.v1` namespace makes clear
  these are not the final protocol labels.
- **AES-256-GCM**, 128-bit tag, **fresh 96-bit random nonce on every
  `encryptBytes()` call** — the API intentionally offers no way to supply a
  nonce for encryption, so a nonce can never be reused with the same key. The
  nonce is public and is stored/transmitted with the ciphertext.
- **AAD** is supported and tested (`aad?: Uint8Array`); the production AAD
  format (protocol version, connection id, device ids, …) is **not** frozen
  in this phase.
- The `{ version: 1, nonce, ciphertext }` container is a **conceptual test
  format only** — not the `messages` DB format, not a wire format.

## Test vectors

- X25519: **RFC 7748 §6.1**
- HKDF-SHA-256: **RFC 5869 Test Cases 1, 2, 3**
- AES-256-GCM: **McGrew/Viega GCM spec, AES-256 Test Cases 13, 14, 16** (16 with AAD)

No hand-invented expected values.

## Boundary (enforced by tests in `__tests__/primitives.test.mjs`)

- `index.ts` exposes **none** of the primitives; `src/lib/api.ts` references
  none of them; `sendMessage()` keeps its plaintext insert.
- No `console.*`, no `localStorage`/`sessionStorage`/cookies/URLs, no Supabase,
  no network, no IndexedDB in the primitive modules.
- No `exportKey()` anywhere in the primitive layer; every key is created
  non-extractable.
- **Not implemented (and must not appear as a side effect):** X3DH, PQXDH,
  Double Ratchet, Triple Ratchet, session establishment, forward secrecy,
  post-compromise security, protocol-level replay protection, key
  verification, multi-device, offline session negotiation, key backup.
  A single static-key X25519 DH provides **no** forward secrecy.
