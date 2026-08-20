# enough. — E2EE-2C Architecture & Blocker Resolution

**Status:** architecture / due-diligence only — **NO PRODUCTION IMPLEMENTATION**
**Date:** 2026-08-20
**Repository HEAD at start:** `62f4bac0cffb81a11e09612036c2859c31fdbd50` (main, PR #39 / E2EE-2B merged)
**Predecessor:** [`e2ee-2b-due-diligence.md`](./e2ee-2b-due-diligence.md), [`e2ee-2b-spike.md`](./e2ee-2b-spike.md)
**Isolated experiments:** [`experiments/e2ee-2c/`](../experiments/e2ee-2c/)

> **Decision:** **CONDITIONAL GO** for `@getmaapp/signal-wasm@0.6.6` as the *planned* browser session engine.
> **NO-GO** for starting E2EE-2C production implementation until the Go Conditions in §21 are met.
>
> This document resolves *how* the E2EE-2B blockers would be handled. It does **not** claim they are all closed. Legal, provenance, reproducible WASM build, independent review, and real-device testing remain open.

---

## 1. Executive Summary

enough. is a minimal 1:1 browser messenger (Vite + React + Supabase + GitHub Pages PWA). Messages are still plaintext in `messages.ciphertext`. E2EE-1 and E2EE-2A built identity/prekey infrastructure and local primitives. E2EE-2B proved that `@getmaapp/signal-wasm` can run a Signal/PQXDH-style session in an isolated Vite/WASM spike.

The remaining question was not “does encrypt/decrypt work in a harness?” It was: **can enough. adopt this wrapper as a production engine without lying about the security model?**

Answer, after this architecture pass:

| Question | Answer |
|---|---|
| Can we use `@getmaapp/signal-wasm` at all? | **Yes, conditionally** — it is still the only demonstrated browser/Vite-compatible Signal/PQXDH + Double Ratchet engine. |
| Better engine since E2EE-2B? | **Not found** as of 2026-08-20. Official `@signalapp/libsignal-client` is still Node/native. Matrix WASM is still a Matrix protocol. |
| JS-visible secrets? | **Unavoidable with this wrapper.** Contain with a wrapping-key vault. Do **not** pretend IndexedDB encryption defeats XSS. |
| Security boundary? | E2EE protects plaintext from Supabase, network, and DB leaks. It does **not** protect against XSS, a compromised bundle, a compromised service worker, extensions, or a compromised device. |
| v1 device model? | **Exactly one cryptographic device per account.** Browser wipe = new identity. No auto-accept of identity changes. |
| Production now? | **No.** Legal review, artifact provenance/reproducible build, independent wrapper review, mobile tests, CSP, and the storage/concurrency design in this document are prerequisites. |

**Kurzfassung:** `@getmaapp/signal-wasm` bleibt der beste Browser-Kandidat. Die Architektur ist belastbar genug für eine spätere Integration, aber **nicht** für sofortige Produktionsarbeit. AGPL, Provenance, reproduzierbarer WASM-Build und unabhängige Review sind weiterhin Blocker. Verschlüsselung in IndexedDB löst XSS **nicht**.

---

## 2. Current State

No files under `src/` or `supabase/` were changed for this phase. The production message path is still plaintext.

### 2.1 CURRENT STATE

```
enough. production app
├── Auth (Supabase email/password) ─────────────────────────────────────────┐
├── profiles / connections / messages / Realtime                            │
├── PWA service worker (static app shell only; no crypto; no chat cache)    │
├── localStorage: theme, i18n, read-state fallback, deletion fallback       │
│                                                                           │
├── E2EE-1 (on main, foundation only)
│     X25519 identity  (non-extractable Web Crypto CryptoKey, IndexedDB
│                       `enough-crypto`, per userId)
│     Ed25519 signing  (non-extractable, IndexedDB, for local prekeys)
│     Signed PreKey + OTK pool (local only, not uploaded as a protocol bundle)
│     profiles.identity_public_key = base64 X25519 public (32 bytes)
│     NOT a Signal identity, NOT wired into sendMessage()
│
├── E2EE-2A (on main, primitive only, NOT exported from crypto/index.ts)
│     X25519 DH → HKDF-SHA-256 → AES-256-GCM
│     tests only; no session, no ratchet, no production import
│
├── E2EE-2B (on main as docs + experiments/e2ee-2b/, PR #39)
│     Isolated spike: @getmaapp/signal-wasm@0.6.6
│     PQXDH/Kyber1024, Double Ratchet behaviour, replay, out-of-order,
│     safety numbers, Vite WASM build
│     Decision: PROMISING — BLOCKED ON SPECIFIC ISSUES
│
└── Messaging layer (plaintext)
      sendMessage() inserts ciphertext: text
      Chat.tsx Realtime INSERT/UPDATE on public.messages
      MessageBubble renders message.ciphertext as text
```

### 2.2 Existing storage map

| Location | What | Secrets? |
|---|---|---|
| IndexedDB `enough-crypto` | E2EE-1 identity / signed prekey / OTKs as `CryptoKey` | Yes (non-extractable keys) |
| `localStorage` `enough-theme`, i18n, preferences | UX | No |
| `localStorage` `enough-deletions-*`, `enough-read-*` | UX fallback | No (message ids / timestamps) |
| Supabase `profiles.identity_public_key` | E2EE-1 X25519 public | Public only |
| Supabase `messages.ciphertext` | **plaintext** | Confidentiality failure by design until E2EE |
| Service worker Cache Storage | hashed app shell | Must never hold keys or chat |

### 2.3 TARGET STATE (architecture only — not implemented)

```
UI (Chat / Composer / Bubble)
    │  plaintext in, plaintext out — never secret records
    v
Message API  (future: encrypt before insert / decrypt after fetch)
    v
E2EE Session Manager   ← single owner of protocol state
    │  Web Lock enough-e2ee:{userId}
    │  BroadcastChannel enough-e2ee:{userId}
    v
Crypto Engine Adapter  (the ONLY module allowed to import signal-wasm)
    ├── Identity / RegistrationId / Device address
    ├── PreKeys (X25519 OTK, Signed PreKey, Kyber one-time + last-resort)
    ├── Session / Double Ratchet
    ├── Encrypt / Decrypt
    └── Safety number
    v
Secret Vault  (IndexedDB enough-e2ee-protocol)
    wrapping key = non-extractable AES-256-GCM CryptoKey
    records     = encrypted opaque libsignal blobs + tombstones + revisions
    v
Transport Envelope  (opaque JSON string in messages.ciphertext)
    v
Supabase  (untrusted): routing metadata + public prekeys + ciphertext
Realtime  : delivers envelopes, never plaintext
```

Layers that stay **out** of the engine:

- Supabase Auth
- RLS
- connection request state machine
- system messages (`kind != 'text'`)
- E2EE-1 Web Crypto identity (not the Signal IK; see §11)

---

## 3. Proposed Architecture

### 3.1 Hard rules carried forward

1. Do **not** implement PQXDH, Double Ratchet, or a custom session engine in enough. code.
2. Do **not** encrypt `sendMessage()` until a separate E2EE-2C implementation phase is explicitly approved.
3. The engine adapter is the only production module that may import `@getmaapp/signal-wasm`.
4. Secret-bearing `Uint8Array` values never enter React state, URLs, logs, `localStorage`, cookies, or Supabase.
5. Fail closed on corruption, revision conflict, identity mismatch, and missing Web Locks.

### 3.2 Component responsibilities

| Component | Owns | Must not own |
|---|---|---|
| UI | plaintext display, verification UX | session records, wrapping key, WASM stores |
| `api.ts` (future) | transport of envelopes | crypto math |
| Session Manager | lock, persist-after-mutate, tombstones, peer identity cache | WASM internals |
| Engine Adapter | thin calls into signal-wasm | IndexedDB schema, Supabase |
| Secret Vault | wrap/unwrap, atomic tx, revisions | protocol semantics |
| Supabase | public prekey distribution, ciphertext relay | private keys, ratchet state |

### 3.3 Identity dualism (explicit)

enough. already publishes an E2EE-1 X25519 public key. `@getmaapp/signal-wasm` uses a **libsignal Curve25519 identity** that is serializable to 32-byte JS `Uint8Array`. These are **not the same key** and cannot be:

- E2EE-1 private keys are non-extractable Web Crypto `CryptoKey` objects.
- libsignal `PrivateKey` is a serializable `[u8; 32]` exported to JS for persistence.

**v1 decision:**

- Keep E2EE-1 keys in `enough-crypto` untouched until a later cleanup.
- Generate a **new** libsignal identity inside the engine for protocol use.
- Do **not** put the libsignal private identity into `profiles.identity_public_key`.
- Future integration publishes the **libsignal public identity** (and prekey bundle) via additive tables, not by overloading the E2EE-1 column without a migration plan.
- The E2EE-1 key is **not** used as the wrapping key (purpose separation).

This is a documented downgrade of the “identity private key is a non-extractable CryptoKey” invariant **for the protocol identity**. The wrapping key retains that invariant. The protocol identity does not.

### 3.4 Protocol choice vs earlier E2EE-2 text

[`e2ee-session-architecture.md`](./e2ee-session-architecture.md) targeted ML-KEM-768 + a custom adapter. E2EE-2.5 correctly NO-GO’d implementing that protocol in-house.

Adopting `@getmaapp/signal-wasm` means adopting **libsignal v0.101.0** behaviour as pinned by the wrapper:

- PQXDH with **Kyber1024** (not the earlier ML-KEM-768 sketch)
- Double Ratchet inside libsignal (including whatever ratchet composition that libsignal version ships)
- Signal safety numbers via libsignal `Fingerprint`
- PreKey message types `2` (Signal) and `3` (PreKey) as observed in the E2EE-2B spike

enough. does **not** claim wire compatibility with Signal clients. It claims “libsignal-family protocol via this wrapper,” subject to wrapper review.

E2EE-2A primitives remain unused for the session path.

---

## 4. Engine Decision

### 4.1 Why `@getmaapp/signal-wasm` is still the best browser candidate

Re-checked 2026-08-20 against E2EE-2B and public sources. No new official Signal browser/WASM package was found. Signal still does not ship a web client; `@signalapp/libsignal-client` remains Node/native (`.node`, `node:crypto`).

| Criterion | `@getmaapp/signal-wasm@0.6.6` | `@signalapp/libsignal-client@0.101.0` | `@matrix-org/matrix-sdk-crypto-wasm` |
|---|---|---|---|
| Browser / Vite | ✅ spike build passed | ❌ native Node | ✅ web WASM |
| WASM | ✅ ~798 KB | ❌ | ✅ ~7.8 MB |
| PQXDH | ✅ Kyber1024 API tested | ✅ core, not browser | ❌ not found |
| Double Ratchet | ✅ delegated to libsignal; behaviour tested | ✅ | ⚠️ Olm, not Signal DR |
| PreKeys | ✅ tested | ✅ | Matrix OTKs |
| Session persistence | ✅ export/import | ✅ | Matrix stores |
| Identity verification | ✅ safety numbers tested | ✅ | SAS / cross-signing |
| License | AGPL-3.0-only | AGPL-3.0-only | Apache-2.0 |
| Provenance | npm integrity; **no SLSA attestation found** | npm SLSA attestation | npm attestation |
| Maintenance | ⚠️ young, unofficial | ✅ Signal official | ✅ Matrix.org |
| Fit for enough. 1:1 | ⚠️ best technical fit | ❌ no browser path | ❌ protocol mismatch |

Other names checked and **not** adopted:

- `@open-e2ee/signal-protocol-sdk` — pure TS, unaudited, AGPL, not official libsignal.
- `positive-intentions/signal-protocol` — from-scratch WASM, not a libsignal wrap.
- Community `libsignal-wasm` ports — unofficial, stale, or unpinned.
- Implementing PQXDH/DR ourselves — **forbidden**.

### 4.2 Remaining engine risks

1. Unofficial wrapper around official crates — wrapper-owned stores, Kyber usage, error mapping, serialization.
2. No npm provenance attestation for 0.6.6.
3. Source-to-WASM byte equivalence **not** proven (E2EE-2B hashes exist; no rebuild).
4. GitHub releases lag npm (`v0.2.0` vs npm `0.6.6`).
5. `SECURITY_AUDIT_REPORT.md` in the upstream repo is for 0.1.1 — not a current audit.
6. JS-exportable secrets (see §5).
7. Release panics abort the WASM instance.
8. AGPL-3.0-only (see §18).
9. Not tested on iOS Safari / Android Chrome.

### 4.3 Verdict

**CONDITIONAL GO** as the planned engine.

**Not approved** as a production dependency of the root app.

---

## 5. Secret Model

E2EE-2B showed that identity, prekeys, Kyber records, session records and Kyber usage export as JS `Uint8Array`. Persistence requires that. The E2EE-1 non-extractable protocol-identity invariant **cannot** be preserved for libsignal identity.

### 5.1 Actual security boundary (read this first)

> If malicious JavaScript runs in the enough. origin **while the app is active**, it can:
> 1. call `export_session` / `serialize` on live WASM objects, **or**
> 2. load the non-extractable wrapping key from IndexedDB and `decrypt` every vault row, **or**
> 3. read plaintext out of React/DOM after decryption.
>
> **Encrypted IndexedDB does not solve XSS.** It reduces *at-rest* exposure of raw protocol bytes and stops naive dumps from being immediately useful. It does not create an enclave against the application.

WASM linear memory is same-origin. Zeroization of JS copies is not possible. Treat WASM as a packaging boundary, not a confidentiality boundary against the app.

### 5.2 Model comparison

| | A Web Crypto wrapping key | B Password-derived vault key | C Auth/session-derived key | D WebAuthn PRF / hardware | E A+B lock screen |
|---|---|---|---|---|---|
| XSS while unlocked | ❌ attacker decrypts | ❌ | ❌ | ❌ | ❌ |
| Stolen IndexedDB dump | ⚠️ CryptoKey may still be in the same origin profile; browser-dependent | ✅ if vault locked / password unknown | ❌ server/auth material is the wrong root | ⚠️ better if PRF unavailable offline | ✅ when locked |
| Reload / browser restart | ✅ wrapping key in IDB | ❌ until password re-entered | ⚠️ if session exists | ⚠️ user presence | ✅ after unlock |
| Logout | keep vault (same as E2EE-1 identity) | keep ciphertext; drop unlocked key from RAM | must not use JWT as wrap key | keep wrapped vault | keep ciphertext |
| Login other account | prefix isolation | prefix isolation | dangerous if mixed | prefix isolation | prefix isolation |
| Password change | n/a | rewrap all records | auth password ≠ crypto | n/a | rewrap |
| Recovery / device change | none (wipe = new identity) | forgotten password = total loss | server involvement = not E2EE | lost passkey = total loss | same |
| Multi-tab | shared wrapping key; needs locks | same | same | same | same |
| Mobile / PWA | realistic for v1 | UX heavy | **reject** | PRF support uneven (Safari 18+, Chrome desktop; Android Chrome historically patchy) | later |
| XSS / bundle compromise | not solved | not solved while unlocked | not solved | not solved while unlocked | not solved while unlocked |

**Reject C** as a wrapping root. Supabase JWTs, refresh tokens, and the account password exist to authenticate to a server enough. does not trust with plaintext. Deriving protocol keys from them would put the server (or a stolen session) into the E2EE story.

**D is not v1.** WebAuthn PRF can wrap a data-encryption key on supporting platforms, but recovery and iOS/Android PWA behaviour are not production-proven for enough. Revisit after mobile testing.

**v1 recommendation: Model A.**

- Per-user non-extractable AES-256-GCM wrapping key in IndexedDB (`enough-e2ee-protocol` / `meta`).
- All libsignal secret records stored as `{ iv, ciphertext }` with AAD = `enough.e2ee.vault.v1|{userId}|{kind}|{id}`.
- Wrapping key generated once, never extractable, never published, never logged.
- Isolated experiment: [`experiments/e2ee-2c/`](../experiments/e2ee-2c/) demonstrates wrap/unwrap, AAD binding, atomic commit, rollback reject, and the XSS residual.

**Later optional: Model E** (A + user passphrase or PRF) so a locked PWA does not keep an unwrap-capable key reachable. Still does not solve XSS while unlocked.

### 5.3 Lifecycle of secrets under Model A

| Event | Behaviour |
|---|---|
| First login | generate wrapping key + libsignal identity; wrap and store |
| Reload | load wrapping key; import identity/session/prekeys into WASM |
| Logout | drop WASM in-memory stores; **keep** IndexedDB vault |
| Login same user | restore vault |
| Login different user | different key prefix; never reuse wrapping key or identity |
| Account deletion | delete vault prefix (and E2EE-1 `deleteUserCryptoState`) |
| Browser data wipe / IDB eviction | new device; peers see identity change |
| Password change (Supabase auth) | **no** crypto rotation |
| XSS during session | **full secret compromise** — accepted residual |

---

## 6. Persistence

Conceptual only. No production schema, no migration.

### 6.1 Database

- Name: `enough-e2ee-protocol`
- Version: `1`
- Durability: `strict` where supported
- Separate from `enough-crypto` so a protocol-store bug cannot wipe E2EE-1 keys (and vice versa)

### 6.2 Object stores (conceptual)

| Store | Key | Value | Secret? |
|---|---|---|---|
| `meta` | `{userId}:wrapping-key` | non-extractable `CryptoKey` | yes (opaque) |
| `meta` | `{userId}:device` | `{ deviceId, registrationId, createdAt, protocolVersion }` | registrationId is protocol state; treat as sensitive |
| `vault` | `{userId}:{kind}:{id}` | `{ iv, ciphertext, userId, kind, revision? }` | yes (wrapped) |
| `tombstones` | `{userId}:{kind}:{keyId}` | `{ userId, kind, keyId, consumedAt }` | no (ids only); **append-only** |
| `revisions` | `{userId}:session:{peerUserId}:{deviceId}` | monotonic `number` | no, but integrity-critical |
| `revisions` | `{userId}:global` | monotonic `number` | no, anti-rollback |
| `peers` | `{userId}:{peerUserId}:{deviceId}` | `{ identityPublic, verification, firstSeen, changedAt }` | public keys + UX state; wrap anyway |

Vault kinds: `identity`, `signed-prekey:{id}`, `otk:{id}`, `kyber:{id}`, `kyber-last-resort:{id}`, `kyber-usage`, `session:{peerUserId}:{deviceId}`.

### 6.3 Versioning and migration

- `VAULT_SCHEMA_VERSION = 1` stored in `meta`.
- Unknown future version → fail closed (do not decrypt with a guessed format).
- IndexedDB `onupgradeneeded` only adds stores; never silently delete secret rows.
- No automatic identity regeneration on corruption.

### 6.4 Atomic transactions

One IndexedDB transaction after every WASM mutate that must survive a crash:

**After encrypt (send):**
1. `encryptMessage` in WASM
2. `export_session`
3. wrap session
4. `tx`: vault session + bump revision
5. only then enqueue/send envelope
6. if (4) fails: do not send; reload stores from IDB (WASM in-memory is untrusted)

**After decrypt (receive, including first PreKey):**
1. `decryptMessage`
2. export session, kyber usage, consumed ids
3. `tx`: vault session + kyber-usage + tombstones + optional delete of consumed OTK/Kyber one-time private records + bump revision
4. only then return plaintext to UI
5. if (3) fails: do not return plaintext; reload from IDB

Order rationale: **never reveal plaintext or send ciphertext until durable state matches WASM.** Prefer “message not displayed / not sent” over “replayable Kyber key after reload.”

IndexedDB constraint (confirmed in `experiments/e2ee-2c`): **wrap records with Web Crypto before opening the write transaction.** Awaiting `crypto.subtle.encrypt` inside an active transaction makes it inactive (`TransactionInactiveError`). Revision compare-and-swap still happens inside the transaction; wrapping does not.

Experiment coverage: `commitDecryptMutation` in `experiments/e2ee-2c`.

### 6.5 Crash recovery

| Crash point | Risk | Recovery |
|---|---|---|
| After WASM decrypt, before IDB commit | in-memory advanced, disk old → replay after reload | treat in-memory as dirty; discard on commit failure; reload |
| After IDB commit, before UI | OK; message can be decrypted again from ciphertext if UI retry runs — engine must still reject true duplicates | persist first |
| After send over network, before session persist | sender may re-encrypt with old ratchet | **forbidden sequence**; persist then send |
| IDB abort | no partial tombstone | IDB atomicity |
| WASM panic | instance bricked | reload page; restore from IDB; no secret telemetry |

### 6.6 Rollback protection

- Monotonic per-session revision; refuse writes with `expectedRevision !== stored`.
- Refuse importing a session blob whose revision is older than stored (`ROLLBACK_REJECTED`).
- Tombstones are append-only and **never reused as live key ids**.
- Do not offer “restore from file” in v1.
- Browser-level backup of the origin (if any) can still roll everything back together; that is a residual T10 risk. Mitigate later with a server-held monotone (non-secret) revision watermark if needed — **not v1**, because a malicious server could freeze the watermark. v1 accepts “full profile restore rolls back crypto” as a documented device-compromise-adjacent case.

### 6.7 Corruption

- Unwrap/AAD failure → `CORRUPT_STATE`, stop that session, do not auto-reset identity.
- User can explicitly reset **this device identity** (wipe vault prefix) — peers will see identity change.
- Never upload vault blobs to Supabase.

### 6.8 Account isolation

Composite keys `${userId}:…`. Validate `record.userId === expectedUserId` on every load. Logout does not delete. Account deletion deletes the prefix.

---

## 7. Session Model

### 7.1 Addressing

v1:

```
WasmProtocolAddress(name = supabaseUserId, deviceId = 1)
```

One session per peer account. My Notes is a session with `name = self userId` (self-address). No groups. No sender keys.

### 7.2 Establishment

1. Claim/fetch peer public bundle from Supabase (future additive tables / RPC).
2. Verify signed prekey and Kyber prekey signatures with peer identity key.
3. Compare peer identity to stored TOFU record (§12).
4. `processPreKeyBundle(...)`.
5. Persist session **before** first encrypt.
6. Encrypt first message as PreKey type (`t = 3`).
7. Persist advanced session, then insert envelope.

Responder:

1. Receive envelope `t = 3`.
2. Decrypt with local stores.
3. Atomically persist session + consume OTKs/Kyber as reported.
4. Show plaintext.

### 7.3 Steady state

Normal messages use `t = 2`. Each encrypt/decrypt exports and persists the session. Out-of-order and replay are engine responsibilities; enough. must persist skipped-key-bearing session records.

### 7.4 Session reset

User-initiated or identity-change path:

1. Delete local session row (not identity).
2. Peer will establish a new PreKey session.
3. History already decrypted stays local; server still has old envelopes (undecryptable with new session — expected).

Never silently create a new identity to “fix” decrypt errors.

---

## 8. PreKey Lifecycle

Public material may live on Supabase. Private records live only in the vault.

| Key | Generate | Publish | Consume | Rotate | Tombstone |
|---|---|---|---|---|---|
| Identity | once per device | public only | never | only on device wipe | n/a |
| Registration ID | once | with bundle | n/a | with identity | n/a |
| Signed PreKey | on init | public + signature | not one-time | ~30 days; keep previous locally ~14 days for in-flight | after grace, delete private |
| X25519 one-time | pool (engine `generatePreKeys`) | public | decrypt reports `oneTimePreKeyId`; wrapper removes in-memory | refill when low | **append tombstone; never reuse id** |
| Kyber one-time | `generateKyberPreKey` | public + signature | decrypt reports `kyberPreKeyId`; **caller** `remove_kyber_pre_key` | refill | tombstone id |
| Kyber last-resort | one live | public + signature; always in bundle | do **not** remove; persist `export_kyber_usage()` | with SPK-like policy | usage triples persist until key retired |

IDs are uint32 from the engine. enough. must not invent overlapping ids after restore: persist `nextId` watermarks in `meta`, and treat tombstoned ids as permanently spent.

Signatures: libsignal identity signs SPK and Kyber public keys. enough. verifies before `processPreKeyBundle`. Invalid signature → reject bundle (spike already showed this).

Server-side claim of one-time public prekeys (conceptual RPC, **not created in this phase**): atomic pop so two peers do not receive the same OTK. Last-resort Kyber is never popped.

---

## 9. Kyber Lifecycle

This is the highest-risk persistence surface (E2EE-2B §7).

### 9.1 Atomic consume (responder, one-time Kyber)

In one IDB transaction after successful `decryptMessage`:

1. Wrap and store new `SessionRecord`.
2. If one-time Kyber: delete wrapped private Kyber record; insert tombstone `{kind:'kyber', keyId}`.
3. If last-resort: keep private record; replace wrapped `kyber-usage` with `export_kyber_usage()`.
4. Tombstone/delete X25519 OTK if `oneTimePreKeyId` present.
5. Bump session revision.

If the transaction fails, reload WASM stores from disk. The PreKey ciphertext remains on the server; a retry may decrypt again **only if** the one-time private key is still present. That is acceptable. The forbidden outcome is: private key gone from WASM but not tombstoned, then a reload resurrecting it.

### 9.2 Crash must not resurrect consumed Kyber keys

Invariant:

```
if tombstone(kyber, id) exists → never import_kyber_pre_key(id)
even if a wrapped private blob still exists (treat blob as garbage).
```

Tombstone wins over vault blob. Reload path: apply tombstones first.

### 9.3 Last-resort replay

`KyberUsageTrackingStore` records `(kyberId, signedPreKeyId, baseKey)`. Losing usage bytes after a last-resort decrypt can accept a replayed initial message after restart. Usage bytes are therefore in the same transaction as the session write.

### 9.4 Rotation

Retire last-resort by generating a new Kyber last-resort, publishing it, keeping the old private + usage until in-flight PreKey messages using the old id can still decrypt (grace window), then tombstone the old id.

---

## 10. Multi-Tab Concurrency

### 10.1 Races without coordination

Tab A and Tab B share IndexedDB and would each hold a WASM store:

- both encrypt → divergent `SessionRecord`, last writer wins, messages become undecryptable
- both decrypt the same PreKey message → double consume / usage divergence
- one tab persists stale state over a newer ratchet

### 10.2 Options

| Mechanism | Verdict |
|---|---|
| IndexedDB transactions alone | ❌ not enough: WASM in-memory copies diverge across tabs |
| BroadcastChannel | needed for “reload your stores” notify; not a lock |
| SharedWorker | possible single engine; extra lifetime/debug surface; **not v1** |
| Service Worker as crypto leader | **forbidden** — SW compromise is T3 |
| Leader tab election | works, but leader death needs failover |
| **Web Locks API exclusive lock** | **v1 recommendation** |

### 10.3 Recommended v1 architecture

```
navigator.locks.request(
  `enough-e2ee:${userId}`,
  { mode: 'exclusive', ifAvailable: false },
  async (lock) => { /* import stores if stale; encrypt/decrypt; persist; notify */ }
)
```

- Every encrypt, decrypt, prekey generate/consume, and identity load-for-mutate takes the lock.
- After persist, `BroadcastChannel('enough-e2ee:' + userId).postMessage({ type: 'vault-advanced', revision })`.
- Other tabs mark WASM stores stale and re-import from IDB before their next op (they will block on the lock anyway).
- If `navigator.locks` is missing: **fail closed** for E2EE operations in that browser (do not race). Feature-detect at `init`.
- UI may still show previously decrypted messages; sending is disabled with a clear error.
- Do not hold the lock during network I/O except the short persist-then-send critical section. Prefer: persist session for the ciphertext, release lock, then POST. If POST fails, the sent ciphertext may still be retried as an identical envelope (idempotent insert is a later API concern); do not re-encrypt.

Secondary-tab UX: allowed to read/decrypt under the lock; no “only one tab may be open” hard product rule if Locks exist.

This was **not** runtime-tested in a real multi-tab browser in this phase. It is the architecture to implement and test in the future implementation phase.

---

## 11. Device Model

enough. is a 1:1 messenger. v1 stays minimal.

```
Account (auth.users.id)
  └── Device (exactly one)  deviceId = 1
        └── libsignal Identity Key
              └── Sessions keyed by peer (userId, deviceId=1)
```

| Question | v1 decision |
|---|---|
| Multiple devices per account? | **No.** |
| Second browser / PWA install? | New identity. Old device is not linked. Peer sees identity change. |
| Browser data deleted? | New identity. Same. |
| New identity key auto-accepted? | **No.** |
| How is change detected? | Stored TOFU peer identity ≠ bundle/message identity. |
| Multi-device later? | New device ids (2, 3, …) + fan-out; out of scope. No fake multi-device now. |
| My Notes | Self session on device 1. |

E2EE-1 `deviceId` UUID in `enough-crypto` is **not** the libsignal device id. Do not mix them. Protocol device id is the integer `1` until a real multi-device design exists.

---

## 12. Identity Verification

Engine primitive (already spiked): 60-digit safety number + scannable fingerprint.

### 12.1 States

| State | Meaning | Send? |
|---|---|---|
| `unverified` | TOFU: first seen identity stored, user has not compared | **Yes**, with a quiet header indicator (minimal product) |
| `verified` | user confirmed safety number match | Yes |
| `identity_changed` | peer public identity ≠ stored | **No** until user chooses |
| `new_device` | reserved; v1 equivalent to identity_changed (deviceId always 1) | No |
| `reset` | local session dropped; identity may still be verified if unchanged | Yes if identity same |

### 12.2 Rules

- First contact: store peer identity, state `unverified`. Do not block chat — enough. is minimal — but show that verification is available.
- Identity change: **block sending**, decrypt of new-session messages may proceed into a holding path only after acknowledgement. Recommended v1 UX: dialog “Safety number changed. This can mean a new device or an attack. Compare the new number.” Actions: *Verify*, *Accept without verifying* (→ `unverified` with new identity, old verification dropped), *Cancel*.
- Never auto-accept.
- Verification state is **local-only** (vault `peers` store). The server must not be the source of trust.
- Display: 12 groups of 5 digits, both users’ identifiers bound as the engine specifies.
- QR: engine supports scannable bytes. **v1 = digits only**; QR is optional later (camera UX on iOS PWA is extra scope).
- No key-directory transparency log in v1.

---

## 13. Message Envelope

Do **not** rename `messages.ciphertext`. Do **not** migrate historical plaintext in this phase. Future encrypt path writes an opaque string; old rows remain distinguishable.

### 13.1 Conceptual format (not frozen wire)

```ts
// Future content of messages.ciphertext for kind === 'text'
interface EnoughEnvelopeV1 {
  v: 1;             // envelope version
  e: 'sw';          // engine id: signal-wasm
  t: 2 | 3;         // libsignal message type (signal | prekey)
  b: string;        // standard base64 of WasmCiphertext.body
}
```

Detection: parse JSON; if `v` and `e` present → E2EE envelope; else treat as legacy plaintext (during any future dual-stack window). Dual-stack policy is an implementation-phase product decision; this architecture only requires a parseable discriminator.

### 13.2 What the envelope must not contain

- plaintext
- identity private keys
- session records
- prekey private material
- wrapping keys
- safety-number secrets (there are none beyond public identities)

Prekey ids need not be duplicated in the envelope; they live inside libsignal PreKey message bytes.

### 13.3 Replay, order, out-of-order

- Transport order: existing `created_at` + `id` pagination.
- Crypto order: ratchet counters inside `b`.
- Duplicate envelope insert: engine `DuplicatedMessage` after first successful decrypt+persist.
- Reordering: engine skipped keys, provided session is persisted after each decrypt.
- Attachments: not required.
- Groups: not required.

### 13.4 System messages

`kind` ∈ `name_change` | `connection_event` | `deleted_account` stay **unencrypted** with empty/meta ciphertext as today. They are metadata. Do not run them through the engine.

### 13.5 Delete-for-everyone

Existing path clears `ciphertext` to `''` within 24 h. For envelopes this removes server ciphertext. Already-decrypted local plaintext cannot be remotely wiped. Documented, unchanged.

---

## 14. Supabase Boundary

### 14.1 SUPABASE MAY SEE

- Account ids, usernames, display names
- Connection ids and status
- `sender_id`, `connection_id`, `created_at`, `deleted_at`, `kind`, `meta`
- Opaque envelope strings (ciphertext + public message type)
- Public identity keys
- Public signed prekeys, public OTKs, public Kyber prekeys and signatures
- Prekey ids, consumption timestamps (not private keys)
- Read receipts / deletion-for-me rows
- Ciphertext length and timing (metadata)

### 14.2 SUPABASE MUST NEVER SEE

- Identity private keys
- Wrapping keys
- Session records / ratchet state / message keys / skipped keys
- PreKey private keys, Kyber private keys
- Kyber usage/replay private triples (local only)
- Plaintext of `kind = 'text'`
- Safety-number comparison outcomes are local; if ever uploaded, only a boolean `verified` without fingerprints as secrets (fingerprints are derivable from public keys anyway)

### 14.3 Future additive public tables (conceptual — **no SQL in this phase**)

Enough. will need *some* public prekey distribution. Sketch only, aligned with earlier session-architecture thinking:

- `crypto_devices` — user_id, device_id, libsignal identity public, registration_id, revoked_at
- `crypto_signed_prekeys` — public + signature
- `crypto_one_time_prekeys` — public; consume via RPC
- `crypto_kyber_prekeys` — one-time + last-resort flag, public + signature

RLS: read public material for authenticated users; write only owner; OTK/Kyber one-time pop via `SECURITY DEFINER` RPC with `FOR UPDATE SKIP LOCKED`.

**Do not implement in E2EE-2C preparation.**

### 14.4 Existing messages / Realtime / RLS

- Keep current `messages` RLS (participants read; sender insert; sender update for delete-for-everyone).
- Realtime INSERT still delivers rows; the client decrypts locally under the Web Lock.
- Offline: no SW queue for chat (current PWA design). A future offline send queue would store **envelopes already persisted locally**, never unpersisted WASM state.
- Ordering: unchanged at SQL level.

### 14.5 `profiles.identity_public_key`

Today: E2EE-1 X25519 public. Future Signal identity public should not silently overwrite that column with a different algorithm/meaning. Implementation phase must migrate or add a column/table. **No migration now.**

---

## 15. Browser / PWA Boundary

### 15.1 Deployment

- Vite 6, `base` `/enough/` on GitHub Pages
- SW generated by `scripts/pwa-plugin.ts`: precaches hashed static assets, network-first navigations, ignores Supabase
- No CSP header today; GitHub Pages does not provide custom response headers
- Inline theme bootstrap in `index.html` currently implies `'unsafe-inline'` if a meta CSP is added without hashes

### 15.2 WASM loading

E2EE-2B Vite build emitted `signal_wasm_bg-*.wasm` as a hashed asset. wasm-bindgen glue uses `WebAssembly.instantiate` / compile.

Production CSP (when added) **must** allow WASM compilation without enabling JS `eval`:

```
script-src 'self' 'wasm-unsafe-eval';
```

`'wasm-unsafe-eval'` is the documented token (Chrome 97+, Firefox 102+, Safari 16+) that permits `WebAssembly.compile` / `instantiate` without `'unsafe-eval'`.

**Never** set `'unsafe-eval'` to “make WASM work.”

GitHub Pages limitation: CSP via `<meta http-equiv>` cannot set `frame-ancestors`. Accept residual clickjacking as a non-E2EE issue or move hosting later.

### 15.3 Service worker vs E2EE

A compromised or malicious SW can:

- intercept `sw.js` updates
- serve attacker JS/WASM for the origin
- persist itself with `skipWaiting` + `clients.claim` (enough. already does this for freshness)

**T3 is inside the trust boundary.** E2EE cannot survive a hostile SW. Mitigations are supply-chain and deploy integrity, not cryptography:

- hashed Vite assets (already)
- precache WASM by content hash (plugin already hashes file contents into cache id)
- `updateViaCache: 'none'` (already)
- do **not** run encrypt/decrypt inside the SW
- do **not** cache Supabase responses (already)
- branch protection / review on `main` (process)
- optional later: user-visible “update available” instead of instant claim — product tradeoff, not required before 2C design freeze

Rollback: activate deletes old `enough-shell-*` caches. A malicious worker can refuse to die until a later deploy. Process control of GitHub Pages is the real control.

### 15.4 Compromised GitHub Pages deploy

Equivalent to T2+T3. E2EE does not protect users from the app they just downloaded. State this in any user-facing security text.

---

## 16. Threat Model

Assumed assets: plaintext, libsignal identity private, prekey privates, session/ratchet, wrapping key, verification state, WASM module integrity.

| ID | Attack | Assets | Existing controls | Residual | Required before production |
|---|---|---|---|---|---|
| T1 | XSS in enough. origin | all secrets, plaintext | React escaping, no `dangerouslySetInnerHTML`, markdown strip | **High** — same-origin JS = full compromise | CSP (wasm-unsafe-eval only), no secret-in-DOM beyond plaintext bubbles, dependency hygiene. **Accept residual.** |
| T2 | Compromised JS bundle / Pages deploy | all | GitHub Actions from `main`, hashed filenames | **High** | Review, lockfile, no silent 2C. **Accept residual.** |
| T3 | Compromised service worker | all future JS | SW only shells static files; hashed cache id | **High** | Keep crypto out of SW; hashed WASM. **Accept residual.** |
| T4 | Malicious Supabase operator | envelopes, metadata, public keys | none for confidentiality today (plaintext!) | After E2EE: metadata + ciphertext only | Envelope + public-only prekeys; no private upload |
| T5 | Network attacker | traffic | TLS to Supabase | metadata, sizes | TLS + E2EE body |
| T6 | Malicious peer | own plaintext, forgeries | none | protocol auth via IK; TOFU gap | verification UX; no auto-accept IK change |
| T7 | Stolen IndexedDB dump | wrapped records + wrapping CryptoKey | E2EE-1 non-extractable keys | Model A: wrapping helps against raw blobs; CryptoKey still in profile | Model A; document; optional later lock screen |
| T8 | Storage corruption / partial write | availability, possible replay if mishandled | E2EE-1 CORRUPT_STATE | high if tombstones not atomic | atomic tx, tombstone-wins, fail closed |
| T9 | Replay attacker (network/DB) | freshness | none today | engine `DuplicatedMessage` if persist correct | persist-before-ack; kyber usage |
| T10 | Rollback (old IDB backup) | FS/replay | none | full-profile restore still rolls back | monotonic revisions; no user backup import in v1 |
| T11 | Malicious extension | all | none | **High** | document; not solvable in-page |
| T12 | Multi-tab race | session integrity | none for protocol | high without locks | Web Locks + stale import |
| T13 | Compromised npm dependency | all | lockfile, few runtime deps | wrapper + future adapter | pin, audit, no unpinned upgrades |
| T14 | Compromised WASM artifact | all protocol | E2EE-2B hashes documented | unproven reproducibility | rebuild + SHA-256 match before prod depend |

---

## 17. Supply Chain

### 17.1 Requirements before the wrapper may be a root production dependency

1. Exact version pin `@getmaapp/signal-wasm@0.6.6` (or a later **reviewed** version) in root `package-lock.json` via `npm ci`.
2. Record and CI-check npm integrity:
   - tarball SHA-256 `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` (E2EE-2B)
   - `signal_wasm_bg.wasm` SHA-256 `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1`
   - `signal_wasm.js` SHA-256 `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410`
3. npm `gitHead` `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` reviewed.
4. Reproducible WASM build (below) **or** vendor the reviewed artifacts and refuse registry mutations.
5. `cargo audit` / RustSec on the source `Cargo.lock` (240 crates) — **not done** in 2B or 2C.
6. License inventory (`cargo-about` or equivalent) — **not done**.
7. CI job: `npm ci`, hash check, `npm audit --omit=dev`.
8. No automatic major bumps.

### 17.2 Reproducible build concept (not implemented)

```text
docker (pinned rust + wasm-pack versions)
  git clone https://github.com/getmaapp/signal-wasm
  git checkout 0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd
  wasm-pack build --target web --scope getmaapp --release
  sha256sum pkg/signal_wasm_bg.wasm pkg/signal_wasm.js pkg/signal_wasm.d.ts
  compare to npm pack files
```

Success criterion: **byte-identical** WASM and JS glue, or a documented, reviewed diff (e.g. wasm-bindgen version). Until then, provenance is **Open**.

Official libsignal pin expected: `b056faa6dd02961cff24064c54c089c52e1a0753` (`v0.101.0`).

---

## 18. Legal Considerations

**This is not legal advice. Status: LEGAL REVIEW REQUIRED.**

Facts a lawyer needs:

| Item | Observation |
|---|---|
| Wrapper license | AGPL-3.0-only (`@getmaapp/signal-wasm`, package LICENSE) |
| Upstream | libsignal AGPL-3.0-only |
| enough. license | **none declared** (`package.json` has no `license`; no `LICENSE` file) |
| Distribution | static GitHub Pages app; WASM+JS shipped to every visitor’s browser |
| Modification | enough. would not necessarily fork the wrapper; it would bundle and call it |
| Network | users interact with enough. over the network (AGPL §13 questions) |
| Corresponding Source | wrapper source is on GitHub; glue JS is generated; enough. application source is on GitHub today but without a license grant |
| WASM | compiling to WASM does not avoid AGPL |

Questions for counsel (not answered here):

1. Does bundling unmodified AGPL WASM+JS into enough. make the enough. client a combined work that must be AGPL?
2. What Corresponding Source must be offered (wrapper, wasm-bindgen glue, enough. integration, build scripts)?
3. Does GitHub Pages + public GitHub repo satisfy source offer if licenses are declared?
4. Does enough. need to choose a license before shipping the wrapper?
5. Trademark: wrapper is not Signal-endorsed; UI must not imply otherwise.

Do **not** treat “the repo is already public” as AGPL compliance.

---

## 19. Mobile Requirements

**Nothing below was device-tested in this phase.** Spike evidence is Node + Vite production build only.

### MUST TEST BEFORE PRODUCTION

| # | Test | Why |
|---|---|---|
| M1 | Android Chrome: WASM init, first PreKey, ping-pong | primary Android browser |
| M2 | iOS Safari + Add to Home Screen PWA | WASM, IDB, SW, standalone |
| M3 | iOS storage eviction / ITP-style pressure | identity loss = key change |
| M4 | Android Chrome IDB under storage pressure | same |
| M5 | Tab freeze / backgrounding mid-decrypt | persist atomicity |
| M6 | Lock + resume | wrapping key still present (Model A) |
| M7 | Multi-tab / split-screen if available | Web Locks |
| M8 | Cold start WASM + Kyber generate pool time | UX budget |
| M9 | Offline: queued incoming envelopes after restore | export/import path |
| M10 | CSP with `wasm-unsafe-eval` on real WebViews | GH Pages meta CSP |
| M11 | Low-end Android memory with ~800 KB WASM | OOM / panic |
| M12 | Service worker update while a chat is open | no lost in-flight persist |
| M13 | `navigator.locks` presence on iOS Safari target versions | fail-closed gate |
| M14 | `structuredClone(CryptoKey)` wrapping key in IDB on iOS | Model A depends on it (E2EE-1 already relies on this for X25519) |

Budgets (targets, not measurements): WASM cold init < 1 s on mid-range; encrypt/decrypt < 50 ms excluding network; Kyber batch generate acceptable in background after login.

---

## 20. Performance Requirements

From E2EE-2B spike only (not mobile):

- WASM 797.75 KB raw / ~303 KB gzip
- Spike JS ~33 KB / ~8 KB gzip
- App baseline ~485 KB JS / ~137 KB gzip **without** the engine

Requirements for a future integration:

1. **Lazy-load** the engine after auth, not on the landing bundle.
2. Do not generate full Kyber+OTK pools on the first frame; background after `init`.
3. One WASM instance per tab, re-imported after lock (not per message).
4. Measure M8/M11 before shipping.
5. Gzip/brotli of `.wasm` depends on GitHub Pages; hashed filename is cache-safe.

---

## 21. Go / No-Go Matrix

| Blocker | Status | Required before 2C implementation? | Solution in this document |
|---|---|---|---|
| Legal (AGPL) | **Open** | **Yes** | §18 — lawyer; LICENSE for enough. |
| Provenance (npm attestation) | **Open** | **Yes** (or vendor+repro) | §17 |
| Reproducibility | **Open** | **Yes** | §17.2 rebuild + SHA-256 |
| Wrapper security review | **Open** | **Yes** | independent review of `src/lib.rs` stores/Kyber usage |
| Secret storage | Architected | Yes to implement, design done | §5 Model A |
| Persistence | Architected | Yes to implement, design done | §6 |
| PreKeys | Architected | Yes | §8 |
| Kyber / tombstones | Architected | Yes | §9 |
| Replay persistence | Architected | Yes | §6–§9 |
| Multi-tab | Architected, untested | Yes | §10 Web Locks |
| Device model | Architected | Yes | §11 single device |
| Verification | Architected, no UI | Yes (UX in impl phase) | §12 |
| Message envelope | Architected | Yes | §13 |
| Supabase public prekeys | Architected, no SQL | Yes (additive migration in impl phase) | §14 |
| Mobile | **Open** | **Yes** | §19 MUST TEST |
| CSP / WASM | Architected, not applied | Yes | §15 `wasm-unsafe-eval` |
| Service worker | Analyzed | Yes (policy) | §15.3 crypto not in SW |
| Performance | Spike only | Yes (mobile budgets) | §20 |
| Rust audit | **Open** | **Yes** | cargo audit |
| License inventory | **Open** | **Yes** | cargo-about |
| Independent crypto review | **Open** | **Recommended / required for GO** | external review of wrapper + enough. adapter |

### GO CONDITIONS (all required to start production E2EE-2C implementation)

1. Legal review written conclusion that shipping the wrapper on GitHub Pages is acceptable, and enough. has a declared license strategy.
2. Reproducible build **or** vendored artifacts matching E2EE-2B hashes, with CI pin.
3. `cargo audit` clean or explicitly accepted.
4. License inventory recorded.
5. Independent review of wrapper storage/Kyber/export APIs (or an equivalent documented residual-risk acceptance by the project owner).
6. Mobile MUST TEST M1–M14 executed and written up.
7. Explicit product acceptance of the security boundary in §16 (XSS/SW/bundle not in E2EE scope).

### NO-GO CONDITIONS (any one blocks implementation)

- Counsel forbids AGPL client distribution as planned.
- WASM cannot be reproduced and provenance remains untrusted.
- A practical browser alternative that is official Signal WASM appears — re-evaluate before wrapping the unofficial crate.
- Web Locks missing on a required browser and no fail-closed product decision.
- Kyber tombstone lifecycle cannot be shown atomic in a real browser test.
- Desire to keep “protocol identity is non-extractable Web Crypto” as a hard invariant — **incompatible** with this engine.

---

## 22. E2EE-2C Preconditions

Before any PR that:

- adds `@getmaapp/signal-wasm` to root `package.json`, or
- encrypts `sendMessage()`, or
- changes `messages` / RLS / AuthContext / Chat / Composer / Bubble, or
- adds a production session engine under `src/`

the following must be true:

1. A **separate explicit implementation approval** after this architecture.
2. All GO CONDITIONS in §21.
3. Implementation follows this architecture (Model A, Web Locks, tombstone-wins, single device, envelope `v=1 e=sw`, no crypto in SW).
4. Adapter isolation: one module imports the engine.
5. Existing plaintext tests (`sendMessage` plaintext assertion) are replaced only when encryption is intentionally switched on.
6. Dual-stack / migration of old plaintext rows is specified in that implementation PR, not here.
7. No custom ratchet math.

Until then: **do not start E2EE-2C production implementation.**

---

## 23. Open Questions

1. Dual-stack duration: encrypt new messages only vs migrate UX for old plaintext history?
2. Whether unverified TOFU may send (this doc says yes, quietly) — product may choose to block.
3. Whether to add a monotone server-side revision watermark against T10 full-profile restore.
4. Whether Model E (lock screen) is required for v1 on shared devices.
5. Column vs table for libsignal identity public vs E2EE-1 `identity_public_key`.
6. enough. SPDX license choice (blocked on legal).
7. Whether to vendor WASM instead of npm.
8. Panic/reload telemetry without leaking secrets.
9. My Notes threat: E2EE hides notes from the server, not from the same device.
10. Future multi-device fan-out — explicitly postponed.

---

## 24. Final Recommendation

**Architecture decision:** **CONDITIONAL GO** on `@getmaapp/signal-wasm@0.6.6` as the planned engine.

**Implementation decision:** **NO-GO** until §21 GO CONDITIONS are met and a separate implementation phase is approved.

The wrapper is still the only realistic browser path to libsignal PQXDH + Double Ratchet without writing protocol code. The E2EE-2B blockers that were *design* problems (secrets, persistence, Kyber tombstones, multi-tab, device model, envelope, Supabase boundary, CSP, SW, threat model) now have a concrete architecture.

The blockers that were *evidence / process* problems (legal, provenance, reproducibility, rust audit, license inventory, independent review, mobile) are **not** closed by writing this document.

enough. must tell users the truth:

> End-to-end encryption, when shipped, hides message bodies from the server and from the network. It does not hide them from anyone who can run JavaScript as enough. in your browser.

That sentence is part of the architecture.

---

## Appendix A — Isolated experiments

[`experiments/e2ee-2c/`](../experiments/e2ee-2c/) validates Model A mechanics only:

- non-extractable wrapping key in IndexedDB
- AAD-bound wrap/unwrap of opaque records
- atomic session + kyber-usage + tombstone commit
- revision conflict and rollback reject
- explicit demonstration that same-origin JS with the wrapping key still unwraps secrets

No production import. No Supabase. No signal-wasm dependency in this experiment (records are dummy bytes).

## Appendix B — What this phase did not do

- no `src/` changes
- no `supabase/` changes
- no SQL, no RLS, no migration
- no root dependency
- no sendMessage encryption
- no Safety Number UI
- no production session engine

**STOP.** Production E2EE-2C implementation requires a separate approval.
