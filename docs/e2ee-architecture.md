# enough. E2EE Architecture Decision

**Status:** Decision document for E2EE-1A (compatibility spike) and E2EE-1B (key infrastructure).
**Date:** 2026-08-19
**Version:** v0.2 (single-device, no multi-device, no key backup)

> **TL;DR — recommendation:** enough. uses **no homemade messenger cryptography** and currently (as of August 2026) **cannot run any of the examined Signal protocol libraries** cleanly in the browser. We therefore establish a clean **crypto infrastructure layer** on the **Web Crypto API** (identity keys, prekey persistence, IndexedDB storage, public-key serialization) — but **without** implementing Double Ratchet/X3DH/PQXDH ourselves. The productive message flow stays plaintext for now. As soon as an auditable, browser-capable Signal-compatible library is available (e.g. official libsignal WASM bindings or a stabilized vodozemac JS binding), it will be plugged in behind the abstracted crypto layer.

---

## 1. Threat model

### Active attackers

| Attacker | Capabilities |
|---|---|
| Supabase administrator | Read/write access to all DB rows including `messages.ciphertext`, realtime capture on the DB side |
| Database leak / SQL injection | Exfiltration of all stored ciphertexts, public keys and metadata |
| TLS intercept / TLS compromise | Reading traffic between client and Supabase |
| Compromised realtime channel | Reading and injecting messages in live realtime sessions |
| Rogue client with valid Supabase auth | Reading all messages RLS grants (i.e. the user’s connections) |

### Out of scope for E2EE-1

| Attacker | Why not |
|---|---|
| Compromised endpoint | No browser-based cryptosystem can protect against that |
| XSS / manipulated JavaScript | Same trust domain as legitimate code — can access keys |
| Malicious browser extensions | Can read code and DOM |
| Screenshot / physical access | Outside software control |

---

## 2. Security goals

1. **Confidentiality toward Supabase:** neither the database nor realtime nor a database leak must be able to read plaintext messages.
2. **Forward secrecy:** compromise of a long-term key must not disclose past sessions. (Goal for a later phase — not yet implemented.)
3. **Post-compromise security (future secrecy):** after compromise of a session key, future messages should be secure again. (Goal for a later phase.)
4. **Asynchronous communication:** a user must be able to be offline; the other must still be able to establish a session and send a message (prekey model).
5. **Authenticity:** the recipient must be sure a message comes from the claimed sender (via signature/key agreement).
6. **Minimal attack surface:** secret keys never leave the device as plaintext and are not held in React state, URL, cookies or `localStorage`.
7. **Separation of identities:** Supabase user id, connection id and cryptographic identity are independent layers.

### Explicitly not covered by E2EE

- RLS / access control (stays with Supabase).
- Transport encryption (stays with TLS).
- Device compromise (see threat model).
- Metadata hiding (who talks to whom when) — still visible at the DB layer.
- Push notifications — there are none.

---

## 3. Browser requirements

### Minimum requirements

| Feature | Purpose | Availability (2026) |
|---|---|---|
| `crypto.subtle` (Web Crypto) | All cryptographic primitives | All modern browsers (Chrome >= 37, FF >= 34, Safari >= 11, Edge >= 79) |
| **Ed25519** in `SubtleCrypto` | Identity key (signatures) | Chrome >= 137 (May 2025), Firefox >= 130, Safari >= 17 |
| **X25519** in `SubtleCrypto` | ECDH key agreement | Chrome >= 113, Firefox >= 130, Safari >= 17.2 |
| AES-GCM | Message encryption | All modern browsers |
| HKDF | Key derivation | All modern browsers |
| `non-extractable` `CryptoKey` | Protect private keys from export | All modern browsers |
| IndexedDB | Persistence of keys/sessions | All modern browsers |
| `crypto.getRandomValues` | Secure random numbers | All modern browsers |

### Graceful degradation

- Browsers without `crypto.subtle` or without Ed25519/X25519 **must not be forced onto the E2EE path**; existing plaintext function must remain.
- Because Ed25519 in Chrome is only available from version 137 (May 2025), we activate E2EE functionality only after feature detection. Until widespread availability, `messages.ciphertext` remains plaintext.

### Deployment context

- Vite (ESM bundler)
- GitHub Pages deployment under path `/enough/`
- No Node.js in the browser, no server-side crypto component
- PWA: crypto storage must be available offline (IndexedDB is PWA-compatible)
- **No** service-worker crypto in E2EE-1

---

## 4. Examined libraries

### Option A — `@signalapp/libsignal-client` (official)

| Criterion | Result |
|---|---|
| Version | 0.101.0 (2026) |
| Install size | 147.5 MB unpacked, including native `.node` binaries for darwin/linux/win32 on arm64 and x64 |
| Module format | ESM (`"type": "module"`), but via `node-gyp-build` |
| **Browser capability** | **Not given.** Imports `node:buffer`, `node:crypto` and loads native `.node` addons. No WASM builds in the npm package. |
| Vite build test | **Failed:** `Buffer is not exported by "__vite-browser-external"` (Adress.js:6). Native bindings cannot be loaded in the browser. |
| Official docs | The TypeScript API is a **Node.js-only wrapper** around the Rust core library. Signal offers no web client and has repeatedly argued that the browser trust model is insufficient for their threat model. |
| Supported protocol parts | All (PQXDH, Double Ratchet, X3DH, Sealed Sender, group sessions, SVR2, etc.) — but only in Node/Electron/native clients. |
| License | AGPL-3.0-only |
| Fit for enough. | **No.** Cannot be run in a Vite/GitHub Pages browser app. Polyfills would not replace native bindings. |

### Option B — Web Crypto API (primitives)

| Criterion | Result |
|---|---|
| APIs | X25519 (from ~2023/24 in all major engines), Ed25519 (from Chrome 137, FF 130, Safari 17), AES-GCM, HKDF, SHA-256/512, HMAC, `non-extractable` CryptoKeys, `getRandomValues` |
| Node compatibility | `globalThis.crypto.subtle` exists from Node 15; tests can run in Node. |
| Persistence | None built in — IndexedDB must be addressed ourselves. |
| **Important: what Web Crypto is NOT** | **It is not a Signal protocol.** It provides building blocks (DH, signatures, AEAD, KDF, PRF), but no key agreement (X3DH/PQXDH), no Double Ratchet, no prekey handling, no session management. |
| Forbidden use | Assembling a “homemade Signal-like” messenger from it would be a cryptographic anti-pattern and is **explicitly not done** in this project. |
| Fit for enough. | **Partial.** Excellent for **identity keys, signed prekeys, persistence layer, public-key serialization** and as a backend for a future protocol library. Alone **not** enough for E2EE messages. |

### Option C — third-party libraries

#### C.1 — `libsignal-protocol-javascript` (signalapp, obsolete)
- Officially **deprecated** since 2021.
- Needs a self-provided `curve25519` WebWorker (asm.js/WASM).
- No security updates for years; PQXDH, Kyber and newer Signal adaptations missing.
- **Decision:** do not use. An unmaintained protocol in the encryption layer is a security risk.

#### C.2 — `2key-ratchet` (PeculiarVentures)
- TypeScript implementation of X3DH + Double Ratchet on WebCrypto.
- **No longer actively maintained** (README: “This library is no longer actively maintained”; recommendation to migrate to `pqc-ratchet`).
- Uses **secp256r1 (P-256)** instead of Curve25519 — significant deviation from the Signal ecosystem, no interop.
- Own protocol deltas (“two-key” model) without broad external audit.
- License unclear/custom.
- **Decision:** do not use. Unmaintained, different curve, not Signal-compatible.

#### C.3 — `triple-double` (zbo14)
- Implements X3DH + Double Ratchet including header encryption.
- **Node.js-only** (uses `tls`, `https`, `net`, own WebSocket implementation).
- 6 years old, one maintainer, no known audits.
- **Decision:** do not use.

#### C.4 — `@towns-protocol/vodozemac` / `@cogia/vodozemac-nodejs`
- JS/WASM bindings for [matrix-org/vodozemac](https://github.com/matrix-org/vodozemac) (Rust implementation of Olm/Megolm).
- `@towns-protocol/vodozemac` is a **fork for the Towns protocol** — not an official Matrix package, no stable versioning, no independent security audits documented.
- `@cogia/vodozemac-nodejs` is Node.js-only.
- Officially matrix-org has no own npm package for vodozemac JS.
- **Decision:** do not use for now. Too much uncertainty about maintenance, API stability and audit status.

#### C.5 — `@matrix-org/matrix-sdk-crypto-wasm`
- WASM build of Matrix Rust crypto (vodozemac + Matrix key management).
- Tightly coupled to Matrix rooms, device lists, server signatures, Megolm sessions, etc.
- No standalone “Double Ratchet only” API — would bring the entire Matrix crypto infrastructure.
- **Decision:** not suitable for a 1:1 messenger without a Matrix server.

#### C.6 — `libomemo.js` (conversejs)
- XMPP OMEMO implementation (based on libsignal-protocol-javascript).
- Maintenance unclear, XMPP-focused, no audited releases.
- **Decision:** do not use.

---

## 5. Pros and cons at a glance

| Option | Browser-capable | Signal-compatible | Auditable | Actively maintained | Easy to integrate | Verdict |
|---|---|---|---|---|---|---|
| libsignal-client (official) | No (Node only) | Yes | Yes | Yes | No | Not usable in the browser |
| Web Crypto API (only) | Yes | Primitives only | Yes | Yes (browsers) | Yes | No protocol → must not stand alone |
| libsignal-protocol-js (old) | Yes | Yes (old) | Yes (hist.) | No (deprecated) | Conditional | No longer maintained — too risky |
| 2key-ratchet | Yes | No (secp256r1) | No | No | Conditional | Wrong curve, EOL |
| triple-double | No (Node) | Yes | No | No | No | Node-only, ignored |
| @towns-protocol/vodozemac | Yes (WASM) | No (Olm/Megolm) | No | Conditional (fork) | Conditional | Unclear maintenance, Olm instead of Signal |
| matrix-sdk-crypto-wasm | Yes | No (Matrix) | Yes | Yes | No | Too Matrix-specific |

---

## 6. Build / deployment impact

### Current situation
- Vite bundle: ~474 KB JS / ~27 KB CSS (gzip ~139 KB) — very lean.
- No WASM files, no Node polyfills needed.
- GitHub Pages deployment with `base: '/enough/'` works.

### Impact of the chosen architecture
- **Identity/storage layer on Web Crypto:** no extra dependencies → bundle increase < 5 KB (own TS code only). No WASM, no polyfills.
- **No native code:** Vite does not have to polyfill `node:*` modules.
- **WASM library (future):** later `vite.config.ts` can add `assetsInclude: ['**/*.wasm']` and possibly `optimizeDeps.exclude`. Not required for E2EE-1.
- **GitHub Pages WASM:** Vite serves WASM as an asset with the correct MIME type; `/enough/` base path works for relative asset loads as long as the library does not `fetch('/...')` with an absolute path. This is to be tested once WASM is actually used.

### Verification (already done)
- `npm run build` runs cleanly before and after the changes.
- An import of `@signalapp/libsignal-client` was added as a probe — the Vite build fails as expected (see §4 option A). The dependency was removed again.

---

## 7. Persistence of cryptographic state

### Storage location: IndexedDB (not localStorage!)

| Data | Location | Rationale |
|---|---|---|
| Identity key pair (Ed25519) | IndexedDB | Private key held as `non-extractable` CryptoKey; IndexedDB can store CryptoKey objects |
| Signed prekey | IndexedDB | Contains private prekey + signature; must not be in localStorage. |
| One-time prekeys | IndexedDB | Consumed; atomic transactions required. |
| Session records (future) | IndexedDB | Larger objects, structured. |
| Public-key metadata | IndexedDB (local) + Supabase (public parts only) | Public keys are published to Supabase for other devices. |

### Forbidden storage locations
- `localStorage` (synchronous, plaintext-serialized, easy XSS access)
- React state / context (lost on reload, visible via DevTools)
- URL hash / query parameters (logs, browser history)
- Cookies (sent to the server)
- `window.name` or similar hacks

### Storage-layer design
- A dedicated `src/lib/crypto/storage.ts` module encapsulates all IndexedDB access.
- The layer is logically separate from UI and from Supabase.
- Private key material is generated as `non-extractable` `CryptoKey` objects and persisted as such in IndexedDB.
- As a fallback for browsers that cannot store non-extractable CryptoKeys in IndexedDB, keys are wrapped with a device-bound AES-GCM wrap key (`wrapKey`/`unwrapKey`).

### Storage-clear behaviour

| Event | Behaviour |
|---|---|
| Reload / tab switch | CryptoState remains (IndexedDB-persisted). |
| Logout | CryptoState remains locally; the user can log in again and keep using the existing device. |
| “Clear browser data” / IndexedDB deleted | All local keys are lost. Because there is no backup (v0.2), state is as for a new device. Documented. |
| Account deletion | Local CryptoState is also deleted so no half-identity remains. |
| Second device / second browser | Each device generates its own identity. Multi-device is **not** supported for v0.2. |

---

## 8. Recommended solution (decision)

**For enough. E2EE-1 we recommend:**

> **Step 1 (E2EE-1A, now):** None of the examined third-party libraries is production-ready in the browser without major compromises. We **stop productive message encryption here** (i.e. `messages.ciphertext` stays plaintext for now) and **document this explicitly**.
>
> **Step 2 (E2EE-1B, now):** We build a **clean crypto infrastructure layer** (`src/lib/crypto/`) on the **Web Crypto API** and **IndexedDB** that:
> - generates, loads and persists long-lived identity key pairs (Ed25519),
> - generates signed prekeys (X25519, signed by the identity key),
> - generates and manages one-time prekeys,
> - serializes/deserializes public-key material in a type-safe way (without private parts),
> - separates storage from the UI/API layer,
> - **contains no homemade Double Ratchet or X3DH implementations**.
>
> **Step 3 (later phase, not E2EE-1):** As soon as one of the following options is available and auditable, it will be plugged in behind the crypto layer as the session/ratchet engine:
> 1. Official WASM builds of `libsignal-client` (if Signal ever offers browser support),
> 2. An officially published and audited vodozemac JS/WASM package from matrix-org, or
> 3. Another security-community-reviewed, browser-capable Signal-compatible library.
>
> Until then `sendMessage()` keeps writing plaintext to `messages.ciphertext`. The `kind` and `meta` fields (system messages etc.) stay unencrypted and are explicitly treated as metadata.

### Rationale
- **Safety before speed:** unmaintained, homemade or insecure “encryption” is worse than none, because it suggests false security.
- **Infrastructure is portable:** the identity/storage layer is independent of the later ratchet library.
- **Existing app keeps working:** no breaking changes, no data migration, no lost messages.
- **Lean bundle:** no 150 MB native modules, no WASM at build time.

### Explicitly NOT in E2EE-1
- AES-GCM “quick-fix” encryption with a shared password
- Homemade prekey logic / X3DH / Double Ratchet from Web Crypto primitives
- Plugging in an unmaintained third-party library just “because it works”
- Multi-device, key backup, device transfer
- Push notifications
- Migration of existing messages
- System-message encryption (handled separately in a later phase)

---

## 9. Rejected alternatives

| Alternative | Reason for rejection |
|---|---|
| Homemade Double Ratchet on WebCrypto | Highly complex, error-prone, not auditable. |
| `@signalapp/libsignal-client` in the browser | Native `.node` addons and `node:*` modules — not browser-capable. |
| Obsolete `libsignal-protocol-javascript` | Officially deprecated since 2021, no current security updates. |
| `2key-ratchet` | EOL, uses secp256r1 instead of Curve25519, no Signal compatibility. |
| `triple-double` | Node-only, no maintenance. |
| Unofficial libsignal WASM forks | No official origin, no audit trails. |
| `@towns-protocol/vodozemac` | Third-party fork, no clear releases, Olm instead of Signal. |
| AES-GCM with a fixed key | Fake E2EE, no forward secrecy, no prekey model. |
| Encryption with the user password | Supabase auth passwords are for authentication, not for crypto. |
| `window.crypto.subtle` directly in `api.ts` | No layering, no persistent key management. |

---

## 10. Device / multi-device model (v0.2)

```
Supabase auth user (user.id)
        |
        |  (1:1 in v0.2)
        v
enough. crypto device (device_id = client-generated UUID)
        |
        +-- Identity key pair (Ed25519) — private stays on the device
        +-- Current signed prekey (X25519, signed by identity)
        +-- One-time prekey pool (X25519)
        +-- Session records (future)
```

- **1 account = 1 active cryptographic device** in v0.2.
- A second browser / second device generates a new, independent identity.
- **Supabase account != crypto identity:** `auth.users.id` is a UUID from Supabase; `device_id` is a client-generated UUID later bound to `auth.uid()` in a `crypto_devices` row. The public identity key is a separate byte field.
- **Connection != crypto session:** existing `connections.id` is the messenger association layer.

### Database schema (proposal, additive, not used in E2EE-1)

```sql
CREATE TABLE IF NOT EXISTS public.crypto_devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_key     BYTEA NOT NULL,            -- Ed25519 public key (32 bytes)
  signed_prekey_id INTEGER,
  signed_prekey    BYTEA,                     -- X25519 public signed prekey
  signed_prekey_sig BYTEA,                    -- Ed25519 signature
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crypto_one_time_prekeys (
  id         BIGSERIAL PRIMARY KEY,
  device_id  UUID NOT NULL REFERENCES public.crypto_devices(id) ON DELETE CASCADE,
  key_id     INTEGER NOT NULL,
  public_key BYTEA NOT NULL,
  used_at    TIMESTAMPTZ,
  UNIQUE (device_id, key_id)
);
```

> **Important:** going live with these tables (and RLS policies) is **not in E2EE-1**, because they are only useful once the session/ratchet layer exists. For the storage infrastructure local IndexedDB is enough. The migration is supplied as a proposal but **not applied automatically**.

---

## 11. Connection binding

- `connections.id` (existing) is the messenger conversation layer.
- Per connection there will later (after plugging in a ratchet engine) be exactly one active crypto session per device pair.
- The connection id is **not** part of the key material; it is only for association.
- **My Notes** (self-connection, `user_a = user_b`) will use the same infrastructure — no special path “user_id = shared secret”.
- **System messages** (`kind: 'name_change'`, `connection_event`, `deleted_account`) are produced server-side with empty `ciphertext` and `meta` JSON. These stay unencrypted for now. This is **documented, not solved** in E2EE-1.

---

## 12. Delete-for-everyone / delete-for-me

- **Delete-for-me:** as today (local deletions list + `message_deletions` table). No change.
- **Delete-for-everyone:** the server can set ciphertext empty and thereby stop further delivery. It **cannot** guarantee that plaintext already delivered and decrypted on the device is destroyed. This is documented.
- In E2EE-1 there are no ciphertexts to delete — behaviour stays as today.

---

## 13. Security boundaries (explicit)

### Protected by E2EE (when fully implemented)
- Supabase database administrator without device keys
- Supabase storage read rights (e.g. service-role leak)
- Realtime traffic intercept
- Stolen ciphertext data (e.g. DB dump)
- Direct server access to message payloads (after encryption is activated)

### Not automatically protected (not later either)
- Compromised endpoint (malware, root/administrator access)
- Cross-site scripting (XSS) — keys are in the same JS context
- Manipulated JavaScript (e.g. compromised deploy on GitHub Pages)
- Compromised browser or browser profile
- Malicious browser extensions (can read page context)
- Already decrypted messages (remain in UI memory/DOM)
- Screenshots, photography, screen recording
- Traffic metadata (who when with whom) — stays visible
- Downgrade attacks via compromised JavaScript (requires CSP/SRI hardening, to be planned separately)

---

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Browser Ed25519 support not widespread enough | Medium | E2EE cannot be activated for users of older browsers | Feature detection; plaintext fallback; gradual rollout |
| IndexedDB extractability behaviour varies across browsers | Low | Private keys may not persist as non-extractable | Wrap-key pattern with extra AES-GCM wrapping as fallback |
| XSS leak of private keys | Medium | Total loss of confidentiality | Strict CSP, no eval, dependency audits, no keys in strings |
| Later library integration causes breaking changes | Medium | Rebuild | Crypto-layer API kept deliberately narrow and library-agnostic |
| License conflicts with future libraries | Low | Legal risk | License review before every integration |
| Missing cloud key backup leads to data loss | High (in v0.2) | Message loss on device loss | Documentation; backup solution in a later version |
| System messages stay permanently plaintext | Low | Metadata leak | Later design document for system events |

---

## 15. Open decisions (follow-on phases)

- **O1:** When and which library do we use for the session/ratchet layer? Recommendation: watch (a) official libsignal WASM, (b) official vodozemac JS binding. Decision in E2EE-2.
- **O2:** From which browser-support level do we enable E2EE by default?
- **O3:** Multi-device strategy (device linking, key fanout, device revocation).
- **O4:** Key backup / recovery (SVR-like as in Signal, or recovery key / paper key).
- **O5:** Handling of system messages under E2EE.
- **O6:** Security hardening: CSP headers, SRI for build artifacts.
- **O7:** My Notes keys (same identity, separate session? Self-encryption with prekey?).
- **O8:** How is the public identity key distributed to the peer?
- **O9:** Handling of violations of the “no key in logs/URL/error” rule in third-party dependencies.

---

## 16. Module structure (implemented in E2EE-1B)

```
src/lib/crypto/
  index.ts          Public API (initIdentity, getIdentity, getPublicBundle, ...)
  types.ts          Types (SerializedIdentityKey, PreKeyBundle, ...)
  storage.ts        IndexedDB layer (init, put, get, delete, list, versioning)
  identity.ts       Identity-key generation, store, load, export of the public half
  prekeys.ts        Signed prekey + one-time prekeys (generate, sign, persist)
  serialization.ts  Public keys <-> Base64/Uint8Array (without private parts!)
  key-agreement.ts  (E2EE-2A) X25519 shared secret as non-extractable HKDF CryptoKey
  kdf.ts            (E2EE-2A) HKDF-SHA-256 (message-key derivation, domain separation)
  symmetric.ts      (E2EE-2A) AES-256-GCM encrypt/decrypt with 96-bit random nonce and AAD
  primitives.ts     (E2EE-2A) barrel of the primitive layer (not exported from index.ts)
  errors.ts         Own crypto errors (no secret contents in message/stack)
  __tests__/        Tests (storage, identity, serialization, security)
  README.md         Developer docs
```

**Important:** the modules do not export private keys as serializable values. `CryptoKey` objects are created only in `non-extractable` form and handled as such. `index.ts` is the **only** public entry point.

### Future extension (E2EE-2+)
```
src/lib/crypto/
  sessions/
    index.ts
    <library>.ts    # adapter to the chosen ratchet library
  messages.ts          # encryptMessage / decryptMessage (delegates to sessions)
```

---

## 17. References

- Signal Specifications: https://signal.org/docs/
  - X3DH: https://signal.org/docs/specifications/x3dh/
  - Double Ratchet: https://signal.org/docs/specifications/doubleratchet/
  - PQXDH: https://signal.org/docs/specifications/pqxdh/
- libsignal (Rust core): https://github.com/signalapp/libsignal
- Web Crypto API: https://www.w3.org/TR/WebCryptoAPI/
- WebCrypto Secure Curves (Ed25519/X25519): https://wicg.github.io/webcrypto-secure-curves/
- vodozemac (Matrix Rust implementation of Olm/Megolm): https://github.com/matrix-org/vodozemac
- Olm / Megolm Specification: https://gitlab.matrix.org/matrix-org/olm/-/blob/master/docs/
- 2key-ratchet (PeculiarVentures): https://github.com/PeculiarVentures/2key-ratchet
- “Can I use Secure Curves”: https://blogs.igalia.com/jfernandez/2025/02/28/can-i-use-secure-curves-in-the-web-platform/

---

## 18. Change log

- **2026-08-19 — E2EE-1A:** Initial architecture decision. Recommendation: Web-Crypto-based identity/storage layer, no productive message encryption in E2EE-1.
- **2026-08-19 — E2EE-1C:** Security review of the implemented infrastructure (details in §19).
- **2026-08-19 — E2EE-2A:** Local primitive layer (X25519 -> HKDF-SHA-256 -> AES-256-GCM) added additively, without productive integration (details in §20).
- **2026-08-20 — E2EE-2C (preparation):** Architecture and blocker resolution for a possible session engine (`@getmaapp/signal-wasm`) in [`e2ee-2c-architecture.md`](./e2ee-2c-architecture.md). **No production integration.** Decision: CONDITIONAL GO for engine choice, NO-GO for implementation until legal/provenance/mobile/review.

---

## 19. E2EE-1C security review

This section documents the targeted security review of the crypto foundation produced after E2EE-1B, before release for E2EE-2 (session/ratchet layer).

### 19.1 Areas reviewed

| # | Area | Result |
|---|---|---|
| 1 | Private-key exposure (logs, errors, localStorage, URL, props, JSON, Supabase) | No leaks — see §19.2 |
| 2 | User isolation (logout/login, reload, storage clear) | Originally **broken** (critical), clean after fix — see §19.3 finding F-1 |
| 3 | IndexedDB design (schema, migrations, corruption, missing records) | Corruption detection present, user scoping after fix — §19.3 F-1 |
| 4 | Key extractability (`extractable: false` and actual export failure) | OK; tests check real `exportKey` failure — §19.3 F-2 |
| 5 | Public-bundle content (no private fields) | OK; negative tests and JSON scans — §19.3 F-3 |
| 6 | Error handling (no secrets in `message`/`stack`/`console`) | Originally unsafe cause forwarding, fixed — §19.3 F-4 |
| 7 | Prekey-parameter documentation | Values are enough. foundation parameters, not Signal constants — §19.6 |
| 8 | Protocol boundary (no implicit X3DH/PQXDH/Double Ratchet/encryption) | Confirmed, test checks absence of these APIs — §19.7 |
| 9 | Auth lifecycle (login, session restore, logout, account deletion) | Logout keeps identity; account deletion deletes it — §19.8 |
| 10 | Build/smoke/crypto tests | `npm run build`, `npm run smoke`, `npm run test:crypto` successful (30/30 tests) — §19.9 |

### 19.2 Findings — private-key exposure

**Scan method:**
- `grep` for `console.log/error/warn` inside `src/lib/crypto/` → **no** hits (production code; tests do not print secrets to the console).
- `grep` for `localStorage/sessionStorage` inside `src/lib/crypto/` → only in comments (“NOT in localStorage”).
- Manual inspection of all serialization paths: `serializeIdentityBundle`, `serializeSignedPreKey`, `serializeOneTimePreKey`, `getPublicDeviceBundle` accept only the intended `Public*Bundle` types; those types contain no `CryptoKey` fields.
- `CryptoError` hangs the `cause` on a **non-enumerable symbol** (`Symbol.for('enough.crypto.cause')`), so `JSON.stringify`, `console.log` (with standard serialization) and `Error.toString()` do not disclose the cause.
- Automated tests scan public-bundle JSON for `privateKey`, `signingPrivateKey`, `secret`, `CryptoKey`, `extractable`, `pkcs8` (fail on a hit).

**Result:** no private material leaves the crypto layer on any of the checked paths.

### 19.3 Findings (severity)

| ID | Severity | Title | Status |
|---|---|---|---|
| F-1 | **Critical** | Crypto state was not isolated per user | **Fixed** |
| F-2 | Low | Extractability checked only via flag, not via export test | **Fixed** |
| F-3 | Medium | `_resetIdentityCacheForTests` was exported via the public barrel | **Fixed** |
| F-4 | Low | `cause` handling in `CryptoError` could lose details in the stack | **Fixed** |
| F-5 | Low | `initCrypto` had no mutex against double generation | **Fixed** |
| F-6 | Medium | `deleteAccount()` did not delete local CryptoState | **Fixed** |
| F-7 | Informational | Prekey-pool constants (100/20/30 days) must be marked as enough.’s own foundation parameters | **Fixed** (docs) |
| F-8 | Informational | `sendMessage()` stays plaintext — deliberate | **Confirmed** |
| F-9 | Informational | No multi-device, backup, push or system-message cryptography | **Documented** (E2EE-1 scope) |

#### F-1 — user isolation (critical)

**Original bug:** `IDENTITY_RECORD_KEY = 'identity'` and `SIGNED_PREKEY_RECORD_KEY = 'signed-prekey'` were **global** IndexedDB keys without a user namespace. Logout + login as another user on the same browser profile would have reused the previous user’s identity (cross-user identity reuse).

**Fix:**
- State is stored under **composite keys** `${userId}:${recordKey}` (`stateKeyFor()`/`prekeyCompositeKey()`).
- Prekey object store uses composite string keys `${userId}:${keyId}`; `listPreKeys(userId)` does a prefix scan via `IDBKeyRange.bound(prefix, prefix + '\\uffff')` and defensively checks `userId` on every record.
- `PersistedIdentity`/`PersistedSignedPreKey`/`StoredPreKey` additionally contain a `userId` field; `validateRecord` checks `record.userId === expectedUserId` and throws `USER_MISMATCH` on mismatch (isolation violation is detected instead of silently returning wrong data).
- `PublicIdentityBundle` now contains `userId`; the deserializer enforces this field.

**New tests:** `user A and user B get distinct identities`, `deleteUserCryptoState removes only that user`, `identity record with wrong userId fails validation`.

#### F-2 — key-extractability check (low)

**Original state:** tests only checked `key.extractable === false`, not whether an actual `crypto.subtle.exportKey('pkcs8', ...)` call fails.

**Fix:** tests actively try `exportKey('pkcs8', privKey)` for identity, signed-prekey and OTK private keys and expect failure.

#### F-3 — test helper in the public barrel (medium)

**Original bug:** `_resetIdentityCacheForTests` was re-exported from `src/lib/crypto/index.ts` and therefore reachable from production code. A call would have reset the cache.

**Fix:** the helper is removed from the public barrel (remains only in the `identity.ts` export, imported directly in tests).

#### F-4 — CryptoError cause handling (low)

**Original state:** `cause` was not put on the Error; only a symbol property was used. That is correct in itself.

**Review result:** the behaviour is correct and desired (no leaks), but was explicitly verified in tests (`CryptoError messages are generic and do not echo inputs`). No code change necessary; test added.

#### F-5 — race in `initCrypto` (low)

**Original bug:** `initCrypto()` had no synchronization; `onAuthStateChange` and the `getSession()` callback could both call `generateIdentity()` while the first call was still running, leading to `ALREADY_INITIALIZED` errors or — in the worst case — a silent overwrite.

**Fix:** per-user mutex `initLocks: Map<userId, Promise>` — concurrent calls for the same user get the same promise; the entry is removed after completion.

**Test:** `concurrent initCrypto calls for the same user produce one identity`.

#### F-6 — `deleteAccount()` without crypto cleanup (medium)

**Original bug:** after `deleteOwnAccount()` (server-side account deletion) only the Supabase session was ended, but the local identity remained in IndexedDB. A later new account on the same browser instance could potentially have seen the old identity (or hit “already initialized”).

**Fix:** `deleteAccount()` now calls `deleteUserCryptoState(deletedUserId)` **before** sign-out. Errors are swallowed so a local-cleanup failure does not block the account-deletion flow.

**Test:** logout/deletion isolation is tested in `logout preserves identity; deleteAccount wipes it` (indirectly via `deleteUserCryptoState`).

#### F-7 — prekey parameters marked as enough. foundation parameters (informational)

The values `DEFAULT_OTK_POOL_SIZE = 100`, `MIN_OTK_THRESHOLD = 20`, `SIGNED_PREKEY_ROTATION_MS = 30d` are **not** taken from a Signal specification document. They are explicitly documented in `src/lib/crypto/prekeys.ts` as “enough. foundation parameter — NOT a final Signal-protocol constant”. They will likely be replaced by the later ratchet library’s values.

#### F-8 — `sendMessage()` plaintext (informational / confirmation)

`src/lib/api.ts` `sendMessage()` still writes `ciphertext: text` (plaintext) directly. This is correct per E2EE-1 scope — productive message encryption happens only in E2EE-2 after the library decision. Test confirms this (grep check).

#### F-9 — features outside E2EE-1 scope (informational)

- Multi-device — **not implemented** (as intended).
- Key backup / recovery — **not implemented**.
- Push notifications — **not implemented** (as intended; `package.json` has no corresponding dependencies).
- System-message encryption — **documented** (§11).
- My Notes special cryptography — **not implemented** (will be mapped through the same crypto layer).

### 19.4 IndexedDB details

| Property | Value |
|---|---|
| Database name | `enough-crypto` |
| DB version | 1 |
| Object stores | `state` (keyed by composite string `${userId}:${recordKey}`), `prekeys` (keyed by `${userId}:${keyId}`) |
| Persistence | transactions with `durability: 'strict'` |
| Concurrency | each API call opens a new connection in `openDatabase()` and closes it in `finally`; V8/IDB serializes. |
| Corruption recovery | on schema/field validation errors `CORRUPT_STATE` is thrown — **no** automatic delete/regenerate, to avoid silent identity replacement. The UI layer (future) can inform the user about the corrupt state. |
| Reload | all records stay on disk; the in-memory cache is a per-user map and is refilled from IndexedDB after reload. |
| Second tab | IndexedDB is shared across tabs of the same origin. Sign-out in tab A does not delete data (logout keeps identity); account deletion in tab A deletes it via `deleteUserCryptoState`. Tab B would notice on the next read that the identity is missing and generate a new one — this is documented and the later session layer must handle multi-tab races (for v0.2: “one tab = one device” recommendation). |

### 19.5 Private-key protections in detail

- All private keys are generated with `extractable: false`.
- **Recheck:** after generation (in `generateIdentity` and signed-prekey/OTK generation) `if (key.privateKey.extractable) throw/re-generate` is executed.
- **Additional recheck:** on every load from IndexedDB `priv.extractable` is checked again; if `true`, `CORRUPT_STATE` is thrown.
- **Export test:** tests call `crypto.subtle.exportKey('pkcs8', key)` and expect an `InvalidAccessError`.
- Private keys are never passed as parameters outside `identity.ts`/`prekeys.ts` (except `getIdentitySigningKey(userId)` — this function is **not** exported from the public barrel of `index.ts`, so it is unreachable for UI/API code).
- Private keys are never converted into a JS string or JSON object.
- Even `console.log` on a CryptoKey object typically prints only `CryptoKey {...}` without key material; we still never call `console.log` with keys.

### 19.6 Prekey semantics (parameter documentation)

The following values are **enough. foundation parameters**. In E2EE-1 they exist only to create a working infrastructure and are **not** final protocol parameters. They may and likely will be replaced once the later protocol library (libsignal, vodozemac or similar) brings its own constants.

| Constant | Value | Rationale in E2EE-1 |
|---|---|---|
| `DEFAULT_OTK_POOL_SIZE` | 100 | Enough for an asynchronous 1:1 chat with typical usage frequency; compatible with the order of magnitude of Signal recommendations, but without audit. |
| `MIN_OTK_THRESHOLD` | 20 | Pool is refilled when it falls below 20; buffer against concurrent session setups. |
| `SIGNED_PREKEY_ROTATION_MS` | 30 days | Aligns with recommendations for ordinary prekey rotations; long enough to be rare, short enough to contain compromise. |

### 19.7 Protocol boundary — explicit confirmation

The current crypto layer implements **none** of the following:

- ❌ X3DH (Extended Triple Diffie-Hellman)
- ❌ PQXDH (Post-Quantum X3DH)
- ❌ Double Ratchet
- ❌ Triple Ratchet
- ❌ Session establishment (cryptographic)
- ❌ Message encryption
- ❌ Message decryption
- ❌ Sealed sender / anonymous sender
- ❌ Group-chat encryption (Megolm/sender-key)

This is backed by a test `crypto layer exposes NO encrypt/decrypt/session APIs in E2EE-1` that forbids function names such as `encryptMessage`, `decryptMessage`, `createSession`, `doubleRatchet`, `x3dh`, `pqxdh` in the public barrel.

### 19.8 Auth lifecycle — behaviour in detail

| Event | Action regarding CryptoState |
|---|---|
| First login (new user, no existing identity) | `initCrypto(userId)` generates Ed25519 identity, signed prekey, OTK pool (100 items), all in IndexedDB. |
| Repeat login / session restore after reload | `initCrypto(userId)` finds existing identity, loads it from IndexedDB, rotates signed prekey if needed (after 30d), refills OTK pool if <20. |
| Logout (`signOut()`) | **Identity remains** (as with Signal Desktop), no DB deletion. Cache is not cleared; on the next login of the same user id the same identity is reused. |
| Session expiry (Supabase session expires, user is logged out) | Same state as logout — local identity remains. |
| Account deletion (`deleteAccount()`) | Before sign-out, `deleteUserCryptoState(userId)` is called to remove this user’s identity, signed prekey and OTKs from IndexedDB. Other user identities in the same browser (multi-account case) stay untouched. |
| “Clear browser data” / IndexedDB deleted | All identities are lost. Behaviour: as for a new device (documented data loss). `loadIdentity()` returns `null`; subsequent `initCrypto` generates a new identity. |
| Concurrent `initCrypto(userId)` (race) | Per-user promise mutex serializes initialization; only one identity is generated. |
| Second tab with the same user | IndexedDB is shared; both tabs see the same identity. No locking in E2EE-1 — later session layers must account for this. |

### 19.9 Test runs

```
$ npm run build
  tsc --noEmit && vite build
  dist/assets/index-*.js  484.83 KB │ gzip: 136.62 KB
  ✓ built in 1.81s

$ npm run smoke
  All smoke tests passed.

$ npm run test:crypto
  1..30
  # tests 30
  # pass 30
  # fail 0
```

### 19.10 Remaining risks (low / documented)

| Risk | Status |
|---|---|
| XSS can access non-extractable CryptoKeys (same JS context) | **Documented** (§13); not fixable at the E2EE layer — needs CSP/SRI/code hardening as part of the general app security model. |
| Ed25519 not yet available in all older Chrome versions | **Documented** (§3); `isE2eeSupported()` feature detection enables E2EE code paths only when available; plaintext fallback remains. |
| No key backup (device loss = key loss) | **Documented** (§14); follow-up work in a later phase. |
| No multi-device | **Documented** (§10); v0.2 = one device per account. |
| IndexedDB version migrations on future schema changes | No migration yet; schema version is `1`. Future changes must implement upgrade handlers in `openDatabase()`. |
| SharedWorker/ServiceWorker does not isolate crypto | **Documented**; E2EE-1 does not run crypto operations in workers. |
| `deleteAccount()` fails if IndexedDB is locked | Error is swallowed so deletion is not blocked; a later rebuild of IndexedDB is acceptable (at most an orphaned identity remains that no longer maps to an existing Supabase account). |

### 19.11 Go / no-go for E2EE-2

**GO** — with the following conditions:

1. E2EE-2 must **not** start by writing a homemade X3DH/Double Ratchet implementation. Instead it MUST implement one of the options named in the architecture document (§8): (a) official libsignal WASM bindings once available, (b) vodozemac JS/WASM package officially published by matrix-org, or (c) another security-community-audited, browser-capable Signal-compatible library.
2. Before E2EE-2 goes productive:
   - remaining risks in §19.10 must be evaluated,
   - the Supabase migration for `crypto_devices`/`crypto_one_time_prekeys` (schema proposal in §10) must be implemented and secured with RLS policies,
   - test coverage for the session/ratchet layer must exist at the level of the present tests (real export-failure checks, user isolation, race conditions, corruption),
   - `sendMessage()` encryption and `getMessagesPage()` decryption must be inserted behind the existing crypto layer without breaking the existing API structure.
3. As long as none of the libraries in (1) can be cleanly integrated, the productive message flow stays plaintext (as today).

---

## 20. E2EE-2A — primitive layer

**Phase:** E2EE-2A (crypto session primitives, phase 1)
**Status:** implemented, **not productively wired**
**In short:** `Primitive only; not a Signal/X3DH/Double-Ratchet implementation.`

### 20.1 Purpose

E2EE-2A delivers exclusively the **local cryptographic foundation** on which
a later, established session protocol (PQXDH + Double Ratchet, see
[`e2ee-session-architecture.md`](./e2ee-session-architecture.md), gate status in
[`e2ee-implementation-feasibility.md`](./e2ee-implementation-feasibility.md))
can sit:

```
   X25519 shared secret          key-agreement.ts   deriveSharedSecret()
            |
            v
      HKDF-SHA-256                kdf.ts            deriveMessageKey() / deriveKeyBytes()
            |
            v
     AES-256-GCM key
            |
            v
   local encrypt / decrypt        symmetric.ts      encryptBytes() / decryptBytes()
            |
            v
        tests                     __tests__/primitives.test.mjs
```

All primitives come from the **native Web Crypto API**. **No new dependency**
was installed, no homemade curve arithmetic, no homemade AEAD implementation
and no homemade protocol was written.

### 20.2 Modules (additive)

```
src/lib/crypto/
  key-agreement.ts  X25519 Diffie-Hellman -> non-extractable HKDF CryptoKey
  kdf.ts            HKDF-SHA-256: deriveMessageKey (AES-256-GCM), deriveKeyBytes, hkdfInfo, generateSalt
  symmetric.ts      AES-256-GCM: encryptBytes/decryptBytes (96-bit random nonce, optional AAD)
  primitives.ts     barrel of the primitive layer (deliberately NOT re-exported from index.ts)
```

Existing helpers are reused, not duplicated:
`serialization.ts` (`bytesToBase64` / `base64ToBytes` / `toBufferSource`),
`errors.ts` (`CryptoError`), `keys.ts` (`generateIdentityKeyPair` /
`importPublicKey`). `identity.ts`, `prekeys.ts`, `storage.ts`, `index.ts`,
`types.ts` and the IndexedDB structure stay unchanged.

### 20.3 Cryptographic parameters

| Building block | Parameters |
|---|---|
| **X25519** | Web Crypto `deriveBits`, 32-byte shared secret. Private key MUST be `extractable: false` (checked). Result is immediately imported as a **non-extractable `HKDF` CryptoKey**; the byte buffer is zeroed. All-zero result (small-order point) is rejected. |
| **HKDF** | SHA-256, one extract-and-expand step per call. No key schedule, no chain/root keys. |
| **Salt** | **public, not secret**, fresh per derivation via `generateSalt()` (32 bytes). No fixed global “secret salt” — that would be security theatre. Empty salt is only allowed because RFC 5869 defines it (known-answer tests). |
| **Domain separation** | via `info`: `hkdfInfo(label)` produces `enough.e2ee.primitive.v1/<label>`. The namespace makes explicit that these are **not** the later protocol labels. |
| **AES-256-GCM** | 256-bit key (`extractable: false`), 128-bit tag, **96-bit nonce fresh per call** from `crypto.getRandomValues()`. There is deliberately **no** API to supply a nonce when encrypting (nonce-reuse protection). Nonce is public and travels with the ciphertext. |
| **AAD** | optional (`aad?: Uint8Array`), authenticated but not encrypted. The **productive AAD format is not yet fixed** (later e.g. `protocolVersion`, `connectionId`, `senderDeviceId`, `recipientDeviceId`). |
| **Container** | `{ version: 1, nonce, ciphertext }` (Base64) — **conceptual/test only**, explicitly **not** a `messages` DB format and not a wire format. |

### 20.4 Standardized test vectors

- **X25519:** RFC 7748 §6.1 (Alice/Bob vector, expected shared secret
  `4a5d9d5b…161742`) — checked without exporting the secret, by comparing
  HKDF derivations.
- **HKDF-SHA-256:** RFC 5869 test cases 1, 2 and 3.
- **AES-256-GCM:** McGrew/Viega GCM specification, AES-256 test cases 13, 14
  and 16 (test case 16 including AAD) — each against `decryptBytes()`.

No homemade “expected values” were invented.

### 20.5 Security limits of this phase

- Private keys, shared secrets and AES keys exist exclusively as
  **non-extractable `CryptoKey` objects** in the browser. `exportKey()` is
  never called in the primitive layer.
- No `console.*` in the new modules; `CryptoError` messages contain no
  key, nonce or plaintext material.
- No access to Supabase, network, IndexedDB, `localStorage`,
  `sessionStorage`, cookies, URLs or React state from the primitive layer.
- **No productive integration:** `src/lib/api.ts` (incl. `sendMessage()` /
  `getMessagesPage()`), `Chat.tsx`, `MessageBubble.tsx`, `MessageComposer.tsx`,
  the `messages` schema, the RLS structure and the Supabase migrations are
  unchanged. The new functions are used only by tests and (for lack of
  import) do not land in the production bundle.

### 20.6 Explicitly NOT implemented

X3DH · PQXDH · Double Ratchet · Triple Ratchet · session establishment ·
forward secrecy · post-compromise security · replay protection at
protocol level · key verification / safety numbers · multi-device ·
offline session negotiation · key backup/recovery · productive
message encryption.

None of these properties arises as a by-product of the primitive layer.
A single X25519 DH with static identity keys in particular yields
**no** forward secrecy — that requires a ratchet protocol (E2EE-2B+).

### 20.7 Validation

```
npm run test:crypto   -> 87 tests (46 existing + 41 new), 0 failures
npm run build         -> tsc --noEmit + vite build: PASS
npm run smoke         -> PASS
```
