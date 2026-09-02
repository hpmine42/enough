# enough. E2EE Engine Selection — Validation Report

**Assignment type:** Strict validation / red team — no implementation
**Date:** 2026-08-23
**Repository:** `hpmine42/enough` @ `9b13a73` (branch `arena/01a02bfb-enough`)
**Hypothesis under test:** “`@getmaapp/signal-wasm@0.6.6` is, in August 2026, the technically safest and most realistic way to implement real 1:1 E2EE with Signal PQXDH + Double Ratchet in enough. as a browser/PWA.”

> **Working method:** No production file was changed, no dependency added, no migration created, no commit made. `git status` is empty (verified after all tests). All execution tests ran in copies outside the repo (`/tmp/run2b`, `/tmp/run2c`, `/tmp/redteam`, `/tmp/swverify`, `/tmp/swgit`). This file is the only produced artifact.

---

## 1. Executive verdict

> ## CORRECTION (E2EE-2D.2, 2026-08-23)
>
> **This document contained a factually wrong description of the
> encryption construction.** It spoke of AES-GCM, AES-CTR, “keystream”
> and XOR reuse. That is **demonstrably false** and is hereby withdrawn.
>
> **Verified construction in `@getmaapp/signal-wasm@0.6.6`:**
>
> ```
> AES-256-CBC + HMAC-SHA-256 (Encrypt-then-MAC)
> ```
>
> with a 42-byte header and an IV derived deterministically via KDF.
> There is **no** keystream and **no** XOR structure against which two
> ciphertexts could be “XORed”.
>
> **What remains correct in the original finding:** the rollback finding
> itself is real and still CRITICAL — only its justification was wrong.
> Because libsignal derives `(cipher_key, mac_key, iv)` deterministically
> from chain key and counter, rolled-back state causes **the same message
> key with the same IV to be applied to a different plaintext**. With
> AES-CBC the consequence is not keystream reuse, but:
>
> * identical plaintext ⇒ **byte-identical** ciphertext,
> * plaintexts with a shared prefix ⇒ shared ciphertext prefix at
>   **AES block granularity** (16 bytes), leaking prefix equality.
>
> Both violate the requirement that a message key is used exactly once.
> The conclusion “commit-before-send + monotonic revision are mandatory”
> therefore remains valid.
>
> Individual false passages are corrected inline below and marked
> **[CORRECTED]**. **No new unsubstantiated cryptographic claims** are
> introduced.

---

### **CONDITIONAL GO**

The core hypothesis **largely survives** the audit — more clearly than I
expected at the start. I actively tried to break the decision, and the
decisive cryptographic claims are independently confirmed: the three SHA-256
hashes named in the architecture document reproduce **exactly**; the WASM
artifact demonstrably contains real libsignal code from `signalapp/libsignal`
revision `b056faa6dd02961cff24064c54c089c52e1a0753`, which via `git ls-remote`
**exactly matches the official upstream tag `v0.101.0`**; there is no fork,
no vendoring, no `[patch]` section and no homemade cryptography in the
wrapper. PQXDH with Kyber1024, Double Ratchet, forward secrecy, replay
rejection and identity-bound prekey signatures I confirmed empirically with
my own attack tests — not only via the existing spike.

But: I found **one CRITICAL blocker** that the architecture document does
not address and that cannot be defined away by an adapter — **ratchet-state
rollback leads to deterministic message-key/IV reuse** (§7, §13.A). I could
reproducibly show that two encryptions from the same restored session state
produce **byte-identical ciphertexts** for identical plaintext and share a
134-byte prefix for different plaintext. **[CORRECTED]** This is **not**
AES-CTR keystream reuse — the construction is AES-256-CBC + HMAC-SHA-256 —
but reuse of the same `(cipher_key, iv)` pair, leaking prefix equality at
16-byte block granularity and violating one-time use of a message key. The
existing E2EE-2C vault spike already solves exactly this problem (monotonic
revisions, rollback rejection) — but the architecture decision does not
name it as what it is: the most security-critical property of the whole
design. On top of that come a **HIGH** supply-chain blocker (no CI, no npm
provenance, build from a developer laptop with `/Users/me/` paths in the
binary, single maintainer) and several **factually wrong details** in the
document (wrapper size, envelope completeness, partly Kyber terminology).

The engine choice itself is right — in August 2026 **no better
browser-capable option exists**, independently checked (§12). The
architecture *around* it needs concrete corrections before implementation.

---

## 2. Repository findings

### 2.1 Actual E2EE state

| Phase | Status | Evidence |
|---|---|---|
| **E2EE-1** | ✅ **Merged, executable production code** | `src/lib/crypto/` — 13 TS modules, 3811 LOC. X25519 identity + Ed25519 signing, non-extractable `CryptoKey` in IndexedDB, prekey pool. |
| **E2EE-2A** | ✅ **Merged, but deliberately not wired** | `key-agreement.ts`, `kdf.ts`, `symmetric.ts`, `primitives.ts`. **Intentionally not** re-exported from `index.ts` — the boundary is mechanically enforced by test (`__tests__/primitives.test.mjs`). |
| **E2EE-2B** | ⚠️ **Isolated spike only** | `experiments/e2ee-2b/` — 403 LOC harness, 13 checks against `@getmaapp/signal-wasm@0.6.6`. Own `package.json`, never imported from `src/`. |
| **E2EE-2C** | ⚠️ **Isolated spike + docs only** | `experiments/e2ee-2c/` — 305 LOC vault model, 7 tests. Plus `docs/e2ee-2c-architecture.md` (50 KB). |
| **Compat spike** | ⚠️ **Spike only** | `spikes/e2ee-compat-spike/` — tests `mlkem-wasm` + `@noble/post-quantum`, **not** signal-wasm. |
| **Supabase prekey schema** | ❌ **Does not exist** | Migrations only go to `0010_identity_public_key.sql`. `crypto_devices`, `crypto_signed_prekeys`, `crypto_one_time_prekeys`, `crypto_kyber_prekeys`, `claim_prekey_bundle()` appear **only in `docs/`** — no SQL. |

**Test-run results (all green, executed by me):**
- `npm run test:crypto` → **87/87 passed**
- `npm run build` → green (`tsc --noEmit` + Vite, 488.84 kB / 137.21 kB gzip)
- `npm run smoke` → all passed
- `experiments/e2ee-2b` → **13/13 passed**
- `experiments/e2ee-2c` → **7/7 passed**

### 2.2 Plaintext state — confirmed

**`messages.ciphertext` today holds pure plaintext.** Evidence, exact site:

```ts
// src/lib/api.ts:602-606
const { data, error } = await supabase
  .from('messages')
  .insert({ connection_id: connectionId, sender_id: senderId, ciphertext: text })
```

`text` is the unchanged string from `MessageComposer`. **No** encryption
happens in the real message flow.

Read/write sites:
- **Write:** `api.ts:604` (`sendMessage`), `api.ts:623` (`deleteMessageForEveryone` sets `ciphertext: ''`)
- **Read:** `api.ts:556`, `api.ts:583` (SELECT lists), `components/MessageBubble.tsx:112-114` (renders directly), `components/Home.tsx:56` (chat preview), `components/Chat.tsx:584`
- **Server-side:** system messages are inserted as plaintext via SQL (`0001:182,210`, `0008:186,209,247`) — these can **never** be E2EE-encrypted and need their own envelope type.
- **DB constraint:** `0009_explicit_base_rls.sql:163-175` enforces that `ciphertext` may only be changed to `''`, and only on delete.

**Conclusion:** `src/lib/crypto/README.md` describes the state correctly and
honestly. The docs do not overclaim here.

---

## 3. signal-wasm verification

### 3.1 Package facts (npm registry, independently queried)

| Field | Value |
|---|---|
| Name / version | `@getmaapp/signal-wasm@0.6.6` |
| Published | 2026-08-19T12:50:10Z |
| License | `AGPL-3.0-only` |
| Maintainer | **`thecannabisapp <jia@thecannabis.app>` (only one)** |
| `gitHead` | `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` |
| Files | 6 (LICENSE, README, package.json, .d.ts, .js, .wasm) |
| Dependencies | **none** |
| Install scripts | **none** (`hasInstallScript: None`) |
| npm provenance | ❌ **none** (`/-/npm/v1/attestations/...` → `{"error":"Not found"}`) |
| Releases | 12 versions since 2026-01-14 |

**Positive:** no transitive dependencies, no install scripts, no unexpected
files. The attack surface of the npm package itself is minimal.

### 3.2 Trust chain

```
Signal specification (PQXDH, Double Ratchet)     → VERIFIED
        ↓
official libsignal v0.101.0 (b056faa6d)          → VERIFIED
        ↓
@getmaapp/signal-wasm 0.6.6 (git dep, no patch)  → VERIFIED (source) / PARTIALLY VERIFIED (build)
        ↓
WASM artifact (hash-matched, unreproducible)     → PARTIALLY VERIFIED
        ↓
enough. adapter (does not exist yet)             → UNVERIFIED
```

**Proof of link 2→3** — wrapper `Cargo.toml` (`/tmp/swgit`, HEAD = `0a5e3cb`, identical with npm `gitHead`):

```toml
libsignal-protocol = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
zkgroup             = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
```

**Independent verification of this revision against Signal:**
```
$ git ls-remote https://github.com/signalapp/libsignal | grep v0.101
e1d4fd21fec6b9b5583aa4e7d319777765372d00  refs/tags/v0.101.0
b056faa6dd02961cff24064c54c089c52e1a0753  refs/tags/v0.101.0^{}
```
→ The pinned commit **is** exactly the official Signal release tag `v0.101.0`.
That is the strongest single finding of this validation.

**Proof that the core is in the binary** — strings from `signal_wasm_bg.wasm`:
```
/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/pqxdh.rs
/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/double_ratchet.rs
/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/ratchet/keys.rs
libsignal_protocol::kem::kyber1024::Parameters::encapsulate
libsignal_protocol::ratchet::keys::MessageKeys::derive_keys
```
Cargo git-checkout paths with revision prefix `b056faa` — a real git-dependency
build, not copied code.

### 3.3 Answers to the 12 questions from assignment §7

1. **libsignal version:** v0.101.0
2. **Commit:** `b056faa6dd02961cff24064c54c089c52e1a0753` (= official tag)
3. **Direct dependency?** ✅ Yes, Cargo git dependency
4. **Code copied?** ❌ No
5. **Code forked?** ❌ No — remote is `github.com/signalapp/libsignal`
6. **Core changed?** ❌ No — no `[patch.crates-io]`, no `[replace]`, no `vendor/`
7. **Original Signal:** all cryptography (PQXDH, Double Ratchet, KEM, Curve25519, KDF, AEAD, fingerprints)
8. **From the wrapper:** wasm-bindgen bindings + store decorators only (`RemovableSessionStore`, `ConsumptionTrackingPreKeyStore`, `KyberUsageTrackingStore`, `RemovableSenderKeyStore`)
9. **Homemade crypto implementations:** **none** — `grep` for `Hmac|Sha256::|Aes|chacha|fn hkdf|derive_key` in `src/lib.rs` yields **zero** hits
10. **Patch files:** none
11. **Local forks:** none
12. **Deviations:** additive store functionality only (`delete_session`, `remove_kyber_pre_key`, usage tracking) — documented and justified with upstream line references

> **The architecture document is correct here.** The claim “official libsignal
> Rust core” is **VERIFIED**.

### 3.4 Correction: wrapper size

> **The architecture document is incorrect here.** The claim “wrapper is ~500
> lines” is **INCORRECT**. `wc -l src/lib.rs` → **2024 lines**, plus 2771 lines
> of tests (`tests/web.rs`). That is a factor of 4. This is not a security
> problem — more code here means more store care, not more crypto — but the
> number in the document is simply wrong and must be corrected because it is
> used for risk assessment (“trivially auditable”). 2024 lines of Rust are
> auditable, but not in an afternoon.

---

## 4. PQXDH verification

### 4.1 Empirical evidence

From my own test (`/tmp/redteam/t2.mjs`, not the spike):
```
[KEM] kyber pub bytes  = 1569   (ML-KEM-1024/Kyber1024 pk = 1568 + 1 type byte)
[KEM] kyber sig bytes  = 64     (XEdDSA over X25519 identity)
[KEM] kyber record     = 4821
```
1568 bytes is the **unique** public-key size of Kyber-1024 / ML-KEM-1024.
That proves the parameter choice independently of any documentation.

### 4.2 Source evidence

`/tmp/swgit/src/lib.rs:1473-1495`:
```rust
#[wasm_bindgen(js_name = generateKyberPreKey)]
pub async fn generate_kyber_pre_key(key_id: u32, identity_key_pair: &WasmIdentityKeyPair, ...) {
    let key_pair = kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut rng);
    let signature = identity_key_pair.private_key.0
        .calculate_signature(&key_pair.public_key.serialize(), &mut rng)?;
    let kyber_record = KyberPreKeyRecord::new(key_id.into(), timestamp, &key_pair, &signature);
```
The Kyber prekey is **signed with the identity key** — exactly as the PQXDH
specification requires. I also checked the negative case: a forged signature
is rejected with `SignatureValidationFailed`.

### 4.3 PQXDH info string from the binary

```
WhisperText_X25519_SHA-256_CRYSTALS-KYBER-1024
X3DH no longer supported
```
That is libsignal’s canonical PQXDH domain separator. Notable: **`X3DH no
longer supported`** — the engine enforces PQXDH; a downgrade to classical
X3DH is impossible. Additionally confirmed by `Kyber pre key must be present
for this session version`.

My test confirms this at the API: `processPreKeyBundle` has **no overload
without Kyber parameters** — `kyber_prekey_id`, `kyber_prekey`,
`kyber_prekey_signature` are non-nullable, while `prekey_id`/`prekey` are
nullable. **PQXDH is not optional.**

### 4.4 Terminology — partial correction

The question from assignment §8 was justified; the answer is more nuanced
than expected. The binary contains **two** PQ primitives:

| Use | Primitive | Evidence |
|---|---|---|
| **PQXDH handshake** | **Kyber1024** (Round-3 CRYSTALS-Kyber, *not* FIPS-203 ML-KEM) | `libsignal_protocol::kem::kyber1024::Parameters::encapsulate`, info string `CRYSTALS-KYBER-1024` |
| **SPQR / Triple Ratchet** | **ML-KEM-768** (FIPS 203) via `libcrux-ml-kem 0.0.10` | `spqr::incremental_mlkem768`, `Signal_PQCKA_V1_MLKEM768:...`, dependency `SparsePostQuantumRatchet v1.5.3` |

> **Verdict:** “Kyber1024” is the **correct and still current** name for
> **PQXDH** — libsignal v0.101.0 deliberately uses Round-3 Kyber there, not
> ML-KEM. The document is therefore **right** here, but **incomplete**: it
> does not mention that 0.6.6 additionally contains Signal’s **SPQR Triple
> Ratchet with ML-KEM-768**. That is an *improvement* (continuous PQ rekeying
> rather than PQ handshake only), but it must be in the docs — not least
> because it drives session-record size to **5885 bytes** (instead of the
> ~2 KB expected from classical libsignal). That has direct consequences
> for the IndexedDB budget.

**PQXDH: VERIFIED.**

---

## 5. Double Ratchet verification

All checks are empirical, with my own tests.

| Property | Result | Evidence |
|---|---|---|
| Message types | ✅ | `prekey=3`, `signal=2`, `senderkey=7` |
| First message = PreKeyMessage | ✅ | `t=3`, then `t=2` |
| Sending/receiving chain | ✅ | protobuf field names in the binary: `sender_chain`, `receiver_chains`, `root_key`, `chain_key`, `message_keys` |
| **DH ratchet** | ✅ | `ratchet_key_of_ciphertext` yields **different** ratchet keys for Alice and Bob |
| Symmetric ratchet | ✅ | session state changes after **every** encrypt/decrypt (6 unique snapshots) |
| **Skipped message keys / out-of-order** | ✅ | M1→M3→M2 decrypts correctly, then M4 — session stays consistent |
| **Replay rejection** | ✅ | second decrypt of the same ciphertext → `DuplicatedMessage` |
| Tampered ciphertext | ✅ | bit-flip → rejected |
| **Forward secrecy** | ✅ **empirical** | session state stolen after m1..m3 → **0 of 3** old ciphertexts decryptable |
| **Post-compromise security** | ⚠️ **limited** | stolen state decrypts m4 (next message of the same chain). PCS only kicks in **after** the peer turns the DH ratchet. |
| Session serialization | ✅ | `export_session`/`import_session`, 5885 B, cryptographically neutral (raw libsignal records) |

> **On the claim “Double Ratchet provides forward secrecy and post-compromise
> security”:** FS is **VERIFIED** (empirically). PCS is **PARTIALLY VERIFIED**
> — that is not an engine weakness, but the correct, spec-conformant Double
> Ratchet property. The document should not claim PCS unqualified: PCS is
> *eventual*, not immediate, and requires a reply round-trip. In a 1:1
> messenger where a user may not reply for days, that is a real difference.

---

## 6. Browser/WASM verification

| Check | Result | Evidence |
|---|---|---|
| Node globals (`fs`, `path`, `process`, `Buffer`, `require`) | ✅ **none** | grep over `signal_wasm.js` → zero hits |
| Node crypto import | ✅ **none** | uses `globalThis.crypto.getRandomValues` (Web Crypto) |
| Polyfills needed | ✅ **no** | Vite build green with no polyfill config |
| **SharedArrayBuffer / Atomics** | ✅ **not used** | grep → zero hits |
| **COOP/COEP / cross-origin isolation** | ✅ **not required** | follows from the previous point |
| Worker required | ✅ no | single-threaded |
| WASM load | ✅ | `new URL('signal_wasm_bg.wasm', import.meta.url)` → hashed by Vite as an asset |
| MIME | ⚠️ | `instantiateStreaming` needs `application/wasm`; fallback to `instantiate` present. GitHub Pages serves correctly. |
| **Vite build** | ✅ **green** | `dist/assets/signal_wasm_bg-fOyaQtRb.wasm 797.75 kB │ gzip: 302.94 kB` |
| Main app build | ✅ green | 488.84 kB / 137.21 kB gzip |
| CSP | ⚠️ | needs `'wasm-unsafe-eval'` in `script-src`. **Not mentioned in the document.** |

### 6.1 Correction: bundle size

> **The architecture document is incorrect here.** The claim “299 KB gzip”
> is **INCORRECT**, if only narrowly:

| File | raw | gzip -9 |
|---|---|---|
| `signal_wasm_bg.wasm` | 797 749 B | **300 711 B** |
| `signal_wasm.js` | 78 213 B | **12 920 B** |
| **Total** | 875 962 B | **313 631 B ≈ 306 KB** |

Vite reports 302.94 kB gzip for the WASM alone. The correct number for the
**total increase** is **~306 KB gzip**, not 299 KB. For comparison: the
current app is 137 KB gzip — the engine **triples** the download size. For
a mobile-first PWA that is the most important number in the whole document
and should not be understated.

### 6.2 Not verifiable in this environment

Playwright Chromium download is blocked in this sandbox (network + missing
system fonts). **All engine tests ran under Node 24, not in a real browser.**
That is an honest gap: Node and the browser share `globalThis.crypto` and
the WASM engine, but iOS Safari-specific behaviour (WASM memory limits,
IndexedDB eviction, Web Locks) is **not** tested. The architecture document
rests on the same Node spike — the claim “runs cleanly in browser/PWA” is
therefore **PARTIALLY VERIFIED** and needs a real-device test.

---

## 7. Persistence verification

### 7.1 The CRITICAL finding: rollback ⇒ message-key/IV reuse **[CORRECTED]**

This is the most important result of this validation. Reproducible test
(`/tmp/redteam/t3.mjs`):

```
[KEYREUSE] same plaintext, rolled-back state
           → ciphertext bodies IDENTICAL: true
[KEYREUSE] different plaintexts, same counter
           → shared prefix: 134 of 1792 bytes
```

**What happens:** libsignal is deterministic. From the same chain key and
counter, `MessageKeys::derive_keys` derives the same `cipher_key` **and the
same IV**. If session state is reset to revision N and encrypted again, the
same message key with the same IV is applied to a **different** plaintext.

**[CORRECTED]** The original version concluded “XOR of both ciphertexts =
XOR of both plaintexts”. That holds for stream ciphers / CTR — **not** for
the construction actually used, **AES-256-CBC + HMAC-SHA-256**. The correct
consequence of CBC with reused `(key, iv)`:

* identical plaintext ⇒ **byte-identical** ciphertext (confirmed by the
  measurement above),
* shared plaintext prefix ⇒ shared ciphertext prefix, resolved in
  **16-byte blocks** (the measured 134 bytes correspond to 8 full blocks
  plus header),
* that yields a **leak of prefix equality**, not direct plaintext recovery
  via XOR.

This is still a break of the Double Ratchet requirement “a message key is
used exactly once” and remains **CRITICAL**. The attacker needs no key.

**Trigger in the planned design:** browser crash between “ratchet state
mutated in WASM” (`encryptMessage`) and “vault commit”. On reload the old
state is hydrated, the message is sent again — message-key/IV reuse
**[CORRECTED: not keystream reuse]**. On iOS Safari that is not an edge
case: OS kill of background tabs is normal operation.

**Secondary effect (sensitive, but not critical):** after rollback the
receiver rejects the second message with `DuplicatedMessage`. The message
is **permanently lost** — the session recovers (msg-C arrives) but msg-B is
gone without the UI noticing. Silent message loss in a messenger is a
product bug.

**And the receiver side is worse:**
```
[ROLLBACK-RECEIVER]
  first decrypt:            "secret"
  immediate replay:         DuplicatedMessage  ✅
  after vault rollback:     ACCEPTED AGAIN     ❌
```
Double Ratchet replay protection lives **exclusively** in session state.
Whoever rolls the vault back to an older snapshot (backup restore,
IndexedDB corruption, attacker with local access) fully reactivates replay
attacks.

**Why no adapter solves this:** the determinism is in libsignal itself and
is correct there. An adapter cannot “wrap it away”. The only defence is a
**persistence protocol** that guarantees a once-advanced ratchet state
never goes backwards — i.e. **commit-before-send** with monotonic revision
and fail-closed behaviour.

**Good news:** `experiments/e2ee-2c/` already implements **exactly that**
in the model:
- `commitDecryptMutation()` writes session + Kyber usage + tombstones +
  revision in **one** IndexedDB transaction with `durability: 'strict'`
- Test “older session backup is rejected (rollback protection)” ✅
- Test “revision conflict aborts and leaves previous tombstones/session intact” ✅
- AAD binds every record to `userId|kind|recordId` — records cannot be
  moved between accounts or slots

The 2C spike is the solution. The architecture document **just does not
sell it as what it is**, and does not write the order guarantee as a
binding invariant.

### 7.2 Multi-tab

```
[MULTI-TAB FORK] two tabs hydrate the same snapshot, both send
  tab1 → "from tab1" ✅
  tab2 → REJECTED: DuplicatedMessage
```
The fork is **not silent** — the receiver rejects. That is better than
feared (**[CORRECTED]** no unnoticed message-key/IV reuse between tabs,
because both use the same counter and the second is caught). But: tab 2’s
message is **lost**, and the sender is not told. A Web Lock is therefore
**functionally mandatory**, not optional.

### 7.3 Web Locks on iOS Safari

`navigator.locks` has been available since Safari 15.4; that is not the
problem. The problem is **lifetime**: if iOS kills a background tab, the
lock vanishes without `finally`. That is even good for correctness (no
deadlock), but it means: **a lock alone is not a guarantee.** The 2C
revision check must be the second, authoritative defence — the lock is a
performance optimization, the revision is the security mechanism. Can a
send hang? Yes, if the lock is not taken with a timeout (`ifAvailable` or
`AbortSignal` required).

---

## 8. Supabase verification

**Central finding: there is nothing to verify.** The four tables and
`claim_prekey_bundle()` exist **only in prose** (`docs/e2ee-2c-architecture.md:646-649`,
`docs/e2ee-session-architecture.md`). No SQL, no migration, no RLS policy,
no tests. The claim that the Supabase model is “correct” is therefore
**UNVERIFIED** — not false, just unproven.

What I can judge from the existing schema:

**Positive:** the project has a solid RLS culture — `0009_explicit_base_rls.sql`
with explicit base policies, `guard_profile_update` as a column whitelist,
and a dedicated `supabase/rls-tests.sql`. That is a good foundation.

**Concrete risks for the planned prekey schema:**

1. **OTK consumption race** — `claim_prekey_bundle()` **must** use
   `FOR UPDATE SKIP LOCKED`. Without it two concurrent senders can get the
   same one-time prekey. Consequence: both build a session against the same
   OTK; the receiver accepts only the first (the OTK is gone after the first
   decrypt), the second fails. No crypto break, but message loss.
2. **Kyber prekey consumption** — the subtler bug. The engine reports
   consumed Kyber IDs via `WasmDecryptResult.kyberPreKeyId`, **but**
   `remove_kyber_pre_key()` must **not** be called for last-resort keys
   (otherwise anti-replay protection is lost, see `.d.ts:134-149`). The
   one-time vs last-resort distinction must be made by the **application**
   — libsignal does not. The database schema must therefore carry the
   `is_last_resort` flag **authoritatively**.
3. **Last-resort prekey not generatable** — see §15.
4. **Claim-without-send** — if a sender claims a bundle and never sends,
   the OTK is burned. Needs refill logic with a threshold (e.g. < 20 → fill
   to 100).
5. **User enumeration** — `profiles` SELECT is `authenticated USING true`
   (from 0009). A prekey table with the same policy lets any logged-in user
   claim bundles of arbitrary users and exhaust their OTK pool (DoS → forced
   last-resort fallback). Rate limiting needed.
6. **Deletion cascade** — `0004_delete_account.sql` must be extended with
   the prekey tables.

---

## 9. Envelope verification

Proposed:
```json
{ "v": 1, "e": "sw", "t": 3, "b": "base64-of-libsignal-ciphertext-body" }
```

### 9.1 Is `t` tamperable?

Tested (`/tmp/redteam/t1.mjs`) — real type 3, all other values substituted:
```
t=2   → rejected (Generic)
t=7   → rejected (Validation failed)
t=0   → rejected (Validation failed)
t=255 → rejected (Validation failed)
```
**No security break.** `t` is a dispatch hint; the ciphertext is
self-authenticating. Tampering = DoS, not decryption. The question from §16
is therefore answered: carrying `t` outside the AEAD is **acceptable**.

### 9.2 What is missing — the envelope is incomplete

> **The architecture document is incorrect here.** The envelope is **not
> sufficient**.

| Missing | Why mandatory |
|---|---|
| **`deviceId` (sender)** | `decryptMessage` requires `sender: WasmProtocolAddress(name, device_id)`. Without a device id in the envelope **the receiver cannot form the address**. Currently hardcoded to `1` — that cements single-device forever. `src/` today has **no** device concept (`grep deviceId src/` finds only test files). |
| **`registrationId` (sender)** | Signal Desktop uses this for stale-session detection; the engine even exposes `session_remote_registration_id()`. Without this field enough. cannot cleanly detect a peer re-registration. |
| **Envelope type for system messages** | `messages` contains SQL-generated plaintext system messages (`kind: 'name_change'` etc., e.g. `0008:186`). These can never be E2EE. Without a discriminator the client cannot tell encrypted from unencrypted → parse errors or, worse, fallback-to-plaintext. |

Recommended minimum:
```json
{ "v": 1, "e": "sw", "t": 3, "sd": 1, "sr": 12345, "b": "..." }
```
`v`/`e` are correct and useful (versioning + engine discriminator for later
migration). Base64 of the body is tolerable (+33 % overhead on ~1759 B
prekey messages ≈ 2.3 KB per message; `bytea` would be more efficient, but
`text` is schema-compatible).

Must **not** go in the envelope: session identifiers (the session follows
from `(sender_address, local_address)`), message keys, any ratchet state.

**Classification:** **HIGH**, not CRITICAL — not a crypto break, but it
makes multi-device permanently impossible and breaks on the system-message
path.

---

## 10. Supply-chain verification

### 10.1 Hash verification — all three confirmed ✅

I loaded the tarball fresh from the registry and hashed it:

| Artifact | Document | Measured | |
|---|---|---|---|
| `signal_wasm_bg.wasm` | `71b456b8…20d6c1` | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` | ✅ |
| `signal_wasm.js` | `c72af7ae…883410` | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` | ✅ |
| npm tarball | `c3e0d6cd…5e3082` | `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` | ✅ |

Additionally cross-checked in `/tmp/run2b/node_modules` after `npm ci` —
identical. **The document is exactly correct here.**

### 10.2 But: hashes prove immutability, not trustworthiness

> **On “is vendored artifact + hash pinning sufficient?” — No.**

A hash confirms: “this byte array is the same as yesterday”. It does
**not** confirm that the byte array was produced from the reviewed source.
Exactly that gap is open here:

| Control | Status |
|---|---|
| npm provenance / SLSA attestation | ❌ **none** — registry endpoint returns `{"error":"Not found"}` |
| CI / release automation | ❌ **none** — `ls .github/workflows` → does not exist |
| Reproducible build | ❌ **no** — `/Users/me/.cargo/...` and `/Users/me/src/signal-wasm/target/...` in the binary prove a **laptop build** |
| Signed tags | ❌ tags only up to `v0.2.0`, current releases untagged |
| Maintainer | ⚠️ **single point of failure** — exactly one person |
| SBOM | ❌ not published |
| Independent audits | ❌ only self-audit (`SECURITY_AUDIT_REPORT.md`, as of v0.1.1 — **five minor releases stale**) |
| Install scripts / deps | ✅ none (positive) |
| Namespace | ⚠️ unscoped `signal-wasm@0.6.2` exists (same maintainer — not a squat, but mix-up risk; pinning the **scoped** name is mandatory) |

**I could not reproduce the build** — this sandbox has no Rust toolchain.
Even with a toolchain, exact reproduction would be unlikely because of
embedded absolute paths unless `--remap-path-prefix` is set.

**Realistic risk assessment:** the source is verifiably clean and pins a
verifiably official libsignal commit. A malicious binary would have to
diverge from the published source — possible, but there is no indication.
The risk is not “the package is compromised”, but “**nobody can prove it is
not**”, combined with “one compromised npm account is enough for a
malicious 0.6.7”. For an E2EE engine that is a decision to make
consciously, not a detail.

**Classification: HIGH.** Minimal mitigation: vendor the artifact (do not
pull from npm at build time), enforce the hash in CI, `npm ci` with
lockfile pin to the **exact** version, and review upstream releases
manually instead of taking them automatically.

---

## 11. License verification

**I am not a lawyer. Nothing here is legal advice.**

**Technical facts:**
- `@getmaapp/signal-wasm` → `AGPL-3.0-only` (npm metadata **and** shipped `LICENSE` = full AGPLv3 text, verified)
- Upstream `libsignal` v0.101.0 → also `AGPL-3.0-only` (Signal’s standard license)
- `@signalapp/libsignal-client` → `AGPL-3.0-only`
- Rust dependencies (wasm-bindgen, getrandom, uuid, zeroize, rand, subtle) → MIT/Apache-2.0 throughout, AGPL-compatible
- **Distribution form:** the WASM is linked into the Vite bundle and delivered to every browser. Technically that is **distribution** — and because of bundle integration closer to static than dynamic linking.
- enough. currently has **no** `LICENSE` file in the repository.

**Technically likely:** the AGPL obligation applies. Because the client code
is delivered to the browser anyway, the practical hurdle is low — the
source is already public on GitHub.

**Legally unclear — legal counsel required:**
1. **AGPL §13 (“Remote Network Interaction”)** — does it apply when the AGPL code runs in the *user’s browser* and not on the server? The legal situation for WASM-in-browser under AGPL is, to my knowledge, unsettled.
2. **Scope of “Corresponding Source”** — only the E2EE adapter, or the **entire** enough. application under AGPL? With static linking into a shared bundle the conservative reading is: everything.
3. **Supabase backend** — is the server side covered by §13 even though no AGPL code runs there?
4. **Imprint/liability** — enough. has an imprint (`src/config/imprint.ts`), so it presumably operates under German law. AGPL enforceability and warranty disclaimers should be reviewed there.
5. **Future commercialization** — AGPL practically rules out a later proprietary model. That is a **business decision**, not a technical one.

> **The architecture document is incorrect here** — not on the facts, but
> in tone. “enough. can therefore simply become AGPL” is a **legal
> conclusion without legal review**. The word “simply” is inappropriate.
> The license decision is irreversible (once AGPL is shipped, it cannot be
> taken back for shipped versions) and needs a conscious, documented
> decision.

---

## 12. Alternative engines

All figures freshly queried from npm (2026-08-23).

| Candidate | Version | License | Browser? | Protocol | Verdict |
|---|---|---|---|---|---|
| **`@signalapp/libsignal-client`** | 0.101.0 | AGPL-3.0 | ❌ **no** | Signal PQXDH+DR | `node-gyp-build` dependency, `build_node_bridge.py` → **native Node binding**. No WASM target. **Docs confirmed.** |
| **`@getmaapp/signal-wasm`** | 0.6.6 | AGPL-3.0 | ✅ | Signal PQXDH+DR+SPQR | Only browser-capable path to the real libsignal core. |
| **`@matrix-org/matrix-sdk-crypto-wasm`** | 18.5.0 | Apache-2.0 | ✅ | Olm/Megolm | Maintained (2026-08-10), very mature, better supply chain (Matrix.org org, CI). **But:** Olm is **not PQXDH** — no post-quantum handshake. Also Matrix data model (rooms/devices) deeply wired → heavy impedance mismatch for a 1:1 messenger on Supabase. |
| **`@wireapp/core-crypto`** | 10.4.0 | GPL-3.0 | ✅ | MLS + Proteus | Active (2026-08-19). MLS is group-oriented; overkill for 1:1. Proteus = old Axolotl **without PQ**. Needs an MLS delivery service — does not fit Supabase. |
| **OpenMLS** | — | — | ⚠️ | MLS | **Not on npm** (`npm view openmls` → 404). Docs confirmed. |
| **vodozemac** | — | — | ⚠️ | Olm | **Not on npm** (404). Only via matrix-sdk-crypto-wasm. |
| **`openpgp`** | 6.3.1 | LGPL-3.0+ | ✅ | OpenPGP | **No ratchet, no forward secrecy.** Unsuitable for messaging. Docs confirmed. |
| Pure-TS ports | — | — | ✅ | Signal | `@lukium/libsignal-protocol-typescript@0.1.0-beta.2` — beta, unmaintained. Not trustworthy. Docs confirmed. |

**Newer candidates (search for “pqxdh”, August 2026):** `webcrypto-ratchet@0.7.2`, `@open-e2ee/signal-protocol-sdk@0.4.0`, `@oxpulse/crypto-primitives`, `@transmissionbot/core-wasm@0.1.2`. All fail the same criteria: solo maintainer, pre-1.0, no libsignal core, no audits, some reimplement the protocol in TypeScript. **None is a serious alternative** — several are worse than signal-wasm because they *rebuild* Signal instead of binding it.

> **Conclusion:** the document’s alternatives analysis is **VERIFIED**. The
> claim “only browser-capable Signal implementation” holds in the precise
> form: *the only browser-capable binding to the official libsignal core*.
> If PQXDH is required, there is **no choice**. If PQ were negotiable,
> `@matrix-org/matrix-sdk-crypto-wasm` would be a legitimate counter-candidate
> because of the drastically better supply chain — but the protocol mismatch
> weighs more.

---

## 13. Threat-model results

| # | Scenario | Result |
|---|---|---|
| **A** | **Server compromise** (entire DB + realtime) | ✅ **Holds.** Only public prekeys + ciphertexts. Private keys and ratchet state never leave the browser. Metadata (who-with-whom-when) stays exposed — inherent with Supabase, correctly marked “untrusted” in the document. |
| **B** | **Malicious server** (wrong prekeys) | ✅ **Largely holds.** Empirically: Kyber prekey swap → `SignatureValidationFailed`; signed-prekey swap → `SignatureValidationFailed`. Both are identity-signed. OTK swap is accepted — that is **spec-conformant** (OTKs are unsigned in X3DH/PQXDH) and harmless because the OTK only enters the KDF. Server can force OTK exhaustion (DoS → last-resort). |
| **C** | **MITM** | ⚠️ **Depends on enough., not the engine.** Identity-key replacement: the engine throws `UntrustedIdentity` for a **known** peer — on **first** contact there is naturally no comparison value. The server *can* deliver a wrong identity key at first contact. Defence: safety numbers (`generateSafetyNumber` + `verifyScannableFingerprint`, both present and tested) + TOFU pinning. **Without a safety-number UI enough. is not protected against a malicious server at first contact.** The document names TOFU, but not as a mandatory deliverable. |
| **D** | **Rollback** | 🔴 **BREAKS — CRITICAL.** See §7.1. Sender: message-key/IV reuse **[CORRECTED: not keystream reuse; AES-CBC + HMAC]**. Receiver: replay protection fully lifted (empirically confirmed: the same ciphertext is accepted again after vault rollback). |
| **E** | **Crash** (encrypt→persist→send) | 🔴 **BREAKS — CRITICAL.** Crash after `encryptMessage`, before commit → rollback (case D). Crash after commit, before send → message lost, but **cryptographically safe** (ratchet already advanced). ⇒ **The only safe order is encrypt → commit → send.** Lost messages are acceptable, message-key reuse is not. **[CORRECTED]** |
| **F** | **Multi-tab** | ⚠️ **Degraded, not broken.** Second tab → `DuplicatedMessage` at the receiver. No message-key reuse **[CORRECTED]** (both use the same counter, the second is caught), but silent message loss. Web Lock + revision check mandatory. |
| **G** | **Identity change** (Bob clears browser data) | ✅ **Clean.** Engine throws `UntrustedIdentity` — Alice’s store does **not** silently accept the new identity. enough. **must** treat this as a UI warning (“safety number has changed”) and must not blindly `archive_session` + rebuild; otherwise MITM protection is worthless. |
| **H** | **Key compromise** (session state stolen) | ✅/⚠️ **As specified.** Old messages: **0 of 3** decryptable → **forward secrecy holds**. Future messages of the same chain: decryptable → **PCS only after DH ratchet turn**. Correct Double Ratchet behaviour. |

---

## 14. Claim verification matrix

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | “real Signal protocol” | ✅ **VERIFIED** | libsignal v0.101.0 as git dep; PQXDH+DR symbols in the binary |
| 2 | “official libsignal core” | ✅ **VERIFIED** | `rev = b056faa6d` = tag `v0.101.0` via `git ls-remote` |
| 3 | “PQXDH” | ✅ **VERIFIED** | `pqxdh.rs` in the binary; Kyber non-nullable; `X3DH no longer supported` |
| 4 | “Kyber1024” | ⚠️ **PARTIALLY VERIFIED** | Correct for PQXDH (1569 B pk). Unmentioned: SPQR Triple Ratchet additionally uses **ML-KEM-768** |
| 5 | “Double Ratchet” | ✅ **VERIFIED** | DH + symmetric ratchet empirically confirmed |
| 6 | “forward secrecy” | ✅ **VERIFIED** | stolen state decrypts 0/3 old messages |
| 7 | “post-compromise security” | ⚠️ **PARTIALLY VERIFIED** | only after DH ratchet turn; not immediate |
| 8 | “replay protection” | ⚠️ **PARTIALLY VERIFIED** | only with intact state — **liftable by vault rollback** |
| 9 | “browser compatible” | ⚠️ **PARTIALLY VERIFIED** | Vite build green, no Node globals. **Never tested in a real browser** |
| 10 | “no COOP/COEP” | ✅ **VERIFIED** | no SharedArrayBuffer/Atomics |
| 11 | “299 KB gzip” | ❌ **INCORRECT** | **~306 KB** (300 711 + 12 920 B) |
| 12 | “API maps 1:1” | ❌ **INCORRECT** | adapter needed for **every** concept — see §17 |
| 13 | “wrapper is ~500 lines” | ❌ **INCORRECT** | **2024 lines** `src/lib.rs` |
| 14 | “12 releases” | ✅ **VERIFIED** | 0.1.0 … 0.6.6 |
| 15 | “official Signal code” | ✅ **VERIFIED** | no fork, no patch, no homemade crypto |
| 16 | “only browser-capable Signal implementation” | ✅ **VERIFIED** | all alternatives checked |
| 17 | “AGPL is acceptable” | ⚠️ **UNVERIFIED — legal** | technically plausible, legally unsettled |
| 18 | “hash pinning is sufficient” | ❌ **INCORRECT** | no provenance, no CI, laptop build |
| 19 | “IndexedDB design is safe” | ⚠️ **PARTIALLY VERIFIED** | 2C model is good; commit-before-send missing as an invariant |
| 20 | “Supabase model is correct” | ⚠️ **UNVERIFIED** | exists only as prose |

---

## 15. Scorecard (recomputed)

| Dimension | Weight | signal-wasm | Matrix crypto-wasm | Wire core-crypto | OpenPGP.js |
|---|--:|--:|--:|--:|--:|
| Protocol security | 25 % | **9** | 7 | 6 | 2 |
| Browser suitability | 20 % | **8** | 9 | 7 | 9 |
| Implementation maturity | 15 % | **5** | 9 | 8 | 8 |
| Integration | 10 % | **7** | 3 | 3 | 6 |
| Persistence | 10 % | **6** | 7 | 6 | 8 |
| Supply chain | 10 % | **3** | 9 | 8 | 8 |
| Complexity | 10 % | **6** | 4 | 3 | 8 |
| **Weighted** | **100 %** | **6.95** | **7.05** | **6.10** | **6.10** |

**Rationales (signal-wasm):**
- **Protocol security 9/10** — real PQXDH + Double Ratchet + SPQR, unmodified official core. No crypto deduction; −1 because PCS is not immediate and replay protection is state-dependent.
- **Browser suitability 8/10** — no polyfills, no COOP/COEP, Vite build green. −2 for 306 KB gzip (tripling the bundle) on a mobile-first PWA and missing real-browser test.
- **Implementation maturity 5/10** — version 0.6.6, **pre-1.0**, 7 months old, several BREAKING changes in history, self-audit as of v0.1.1. The *core* is maximally mature; the *wrapper* is not.
- **Integration 7/10** — API conceptually fits the plan; −3 because enough. has no device model, the envelope must be extended, and the entire Supabase schema is still missing.
- **Persistence 6/10** — export/import primitives are complete and clean; −4 for the rollback/message-key-reuse trap **[CORRECTED]**, which the application itself must catch.
- **Supply chain 3/10** — the weakest point. Single maintainer, no CI, no provenance, laptop build, no external audits. Hashes reproduce, but prove only immutability.
- **Complexity 6/10** — thin-adapter approach is right, but store hydration, tombstones, Kyber usage tracking and locking are substantial work.

> **Important, and in contradiction to the source document:** Matrix
> crypto-wasm **narrowly wins** on this weighting (7.05 vs. 6.95) — solely
> because of maturity and supply chain. **That still does not make it the
> better choice**, because the scorecard does not encode the hard
> requirement “PQXDH” as a knockout. Olm/Megolm offers **no post-quantum
> handshake**; if PQ is a requirement (and the document sets it), Matrix
> drops out of the set of admissible solutions before the points count. I
> record this explicitly because a scorecard that does not encode its own
> requirement invites the wrong conclusion. **The engine choice is right —
> the document’s scorecard was right for the wrong reasons.**

---

## 16. Blockers

### 🔴 CRITICAL

**C-1 — ratchet-state rollback ⇒ message-key/IV reuse [CORRECTED]**
Reproducible: identical plaintext from rolled-back state ⇒ **byte-identical
ciphertext**; different plaintexts ⇒ 134-byte shared prefix. Additionally a
vault rollback on the receiver **fully** lifts `DuplicatedMessage` replay
protection (empirically confirmed). Triggers are everyday events: iOS
background kill, crash between encrypt and persist, storage restore.
*Not solvable by adapter* — the determinism is correct libsignal behaviour.
Only a persistence protocol with **commit-before-send** and monotonic
revision prevents it.

**Addendum E2EE-2D.2:** The mitigation is **not** in the 2C vault. The vault
is a usable at-rest building block, but **not a rollback trust anchor**:
vault, keys and revision are restored together, its AAD does not contain
the revision, and an old blob can be given a higher revision. What was
implemented instead is a local sealed-state envelope with revision-bound
AAD plus CAS; see `docs/e2ee-crash-rollback-hardening.md`. Coordinated
full-origin rollback (C-1) remains **open** — deliberately: the initially
named server-side epoch anchor at session establishment was **rejected as
insufficient** in the follow-up audit, because C-1 also occurs inside an
existing epoch and an establishment counter stays constant there. See
`docs/e2ee-crash-rollback-hardening.md` §8.0/§8.1.

### 🟠 HIGH

**H-1 — supply chain not independently verifiable.** No npm provenance, no CI, no reproducible build (`/Users/me/` paths in the binary), single maintainer, self-audit five releases stale.
**H-2 — envelope incomplete.** Without `deviceId` the receiver cannot form the `WasmProtocolAddress`; without a system-message discriminator the mixed-content path in `messages` breaks.
**H-3 — Supabase prekey architecture does not exist.** Four tables + `claim_prekey_bundle()` are pure prose. OTK race, Kyber consumption semantics, last-resort handling, RLS and deletion cascade are unsolved.
**H-4 — multi-tab without lock ⇒ silent message loss.** Web Locks are unreliable on iOS OS kill; the revision check must be the authoritative defence.
**H-5 — no test in a real browser.** All evidence is from Node. iOS Safari (WASM limits, IndexedDB eviction, lifecycle) is untested.

### 🟡 MEDIUM

**M-1 — last-resort Kyber prekey not generatable.** `generateKyberPreKey(key_id, identity_key_pair, store)` has **no** `is_last_resort` parameter. The wrapper knows the concept in docs and anti-replay logic but exposes no generator. Consequence: with an exhausted OTK pool no fallback bundle can be served → first contact fails. **Must be clarified with upstream before implementation.**
**M-2 — pre-1.0 engine** with BREAKING changes in history; session wire-format stability across upgrades not guaranteed (CHANGELOG at least documents wire-format stability explicitly for the last pin).
**M-3 — bundle +306 KB gzip** triples app size.
**M-4 — session records ~5.9 KB** (because of SPQR) → watch IndexedDB quota with many peers.
**M-5 — CSP** needs `'wasm-unsafe-eval'`; not mentioned in the document.
**M-6 — PCS claim** unqualified.

### 🔵 LOW

L-1 wrapper LOC wrong (500 → 2024) · L-2 gzip size wrong (299 → 306 KB) · L-3 “API maps 1:1” wrong · L-4 Kyber terminology incomplete (SPQR/ML-KEM-768 missing) · L-5 document unscoped `signal-wasm` as mix-up risk

---

## 17. Required corrections

Binding before implementation starts:

1. **Write the persistence invariant (C-1):** `encrypt → commit(vault, rev+1) → send`. Never send before ratchet state is committed. Monotonic revision, rollback = hard error (fail-closed). Lost message is acceptable; rollback is not. Elevate the 2C model to the binding vault design.
2. **Correct the envelope (H-2):** `{v, e, t, sd (senderDeviceId), sr (registrationId), b}` + a dedicated discriminator for unencrypted system messages.
3. **Introduce a device model (H-2):** enough. has none. Decide before the adapter: fixed `deviceId=1` with a documented single-device restriction, or a real device register.
4. **Actually design the Supabase schema (H-3):** migration with `claim_prekey_bundle()` including `FOR UPDATE SKIP LOCKED`, `is_last_resort` flag authoritative in the DB, RLS matrix, deletion cascade in `0004`, refill threshold, rate limit against OTK exhaustion. Plus extension of `supabase/rls-tests.sql`.
5. **Clarify last-resort prekey (M-1):** upstream issue at `getmaapp/signal-wasm`. **No production rollout without an answer** — otherwise first contact fails on an empty OTK pool.
6. **Supply-chain measures (H-1):** vendor WASM+JS instead of pulling at build time; hash check in `.github/workflows/deploy.yml` as a mandatory gate; upstream updates only after manual review; accept the single-maintainer risk in writing.
7. **Locking (H-4):** Web Lock `enough-e2ee:{userId}` **with** timeout/`AbortSignal`, plus revision check as authoritative second line.
8. **Real device test (H-5):** iOS Safari + Android Chrome, installed PWA, including background-kill scenario and IndexedDB persistence across app restart.
9. **TOFU + safety numbers as a mandatory deliverable (threat C/G):** `generateSafetyNumber` + `verifyScannableFingerprint` exist and are tested. `UntrustedIdentity` **must** trigger a user warning, not a silent session rebuild.
10. **Document corrections (LOW):** 306 KB instead of 299 KB · 2024 instead of 500 lines · drop “API maps 1:1” · add SPQR/ML-KEM-768 · qualify PCS as *eventual* · add CSP `'wasm-unsafe-eval'`.
11. **License decision (§11):** conscious, documented resolution + `LICENSE` file; have the five named points reviewed by counsel.

---

## 18. Final decision

# CONDITIONAL GO

**Required before implementation:**

```
1.  Commit-before-send persistence invariant + monotonic revision (C-1)
2.  Extend envelope with senderDeviceId + registrationId + system-message discriminator (H-2)
3.  Decide and write down the device model (H-2)
4.  Actually design the Supabase prekey migration including SKIP LOCKED + RLS + cascade (H-3)
5.  Clarify last-resort Kyber prekey with upstream (M-1)
6.  Vendor the artifact + hash gate in CI + accept single-maintainer risk (H-1)
7.  Web Lock with timeout + revision as authoritative second line (H-4)
8.  Real iOS Safari / Android Chrome PWA test (H-5)
9.  TOFU + safety-number UI as a mandatory deliverable (threat C/G)
10. Factual corrections in the architecture document (LOW)
11. Conscious, documented AGPL decision + LICENSE file (§11)
```

---

## 19. Recommended next step

**Do not** start with the engine adapter. The engine is the best-understood
part of the system; the risks sit exclusively around it.

**Step 1 — E2EE-2D: crash/rollback hardening (highest priority).** Extend
`experiments/e2ee-2c/` with exactly the cases I broke: crash between encrypt
and commit, vault rollback on the receiver, concurrent tabs. Only when a
test **proves** that a rolled-back state never produces a second ciphertext
is C-1 closed. That is the condition everything else hangs on.

**Step 2 — in parallel: upstream issue on last-resort Kyber prekey.** Blocks
nothing else, but has lead time and is a prerequisite for production.

**Step 3 — Supabase prekey migration as its own reviewable PR** with
`claim_prekey_bundle()`, RLS tests and a concurrency test against the OTK
race.

**Step 4 — only then** the adapter (`engine-adapter.ts` + `session-manager.ts`)
against the then-fixed envelope and schema contracts.

---

## Answer to the closing question

> **“Would you implement this architecture with a clear technical conscience as the basis for real E2EE in enough.?”**

## **YES — CONDITIONAL GO**

The engine decision is **right and evidenced**. I tried to destroy it, and
the central claims held: the core is demonstrably official libsignal
v0.101.0 — verified against Signal’s own git tag, not against a README.
There is no fork, no patches, no homemade cryptography. PQXDH with Kyber1024
is real and not switchable off. Forward secrecy, replay rejection and
identity-bound prekey signatures I confirmed empirically. All three hashes
reproduce exactly. And in August 2026 there is demonstrably **no better
browser-capable option**.

But I would **not implement it the way the document describes it**. The
document has a blind spot at the most dangerous place: it treats persistence
as an engineering detail, although here it is the actual security mechanism.
With a deterministic ratchet the order of persist and send is **not an
implementation detail, it is the crypto property itself**. A single
misplaced `await` — send before commit — produces IV reuse and makes the
entire AEAD guarantee worthless, without any test going red and without a
user ever noticing. That is why C-1 is CRITICAL and not HIGH.

On top of that an honest ranking of the supply-chain risk: you are trusting
a single person who builds an 800 KB binary on their laptop and publishes it
to npm with no CI, no provenance and no external audit. The source is clean
and verifiably pins official Signal code — but nobody can prove the shipped
binary came from that source. That is an acceptable risk if you take it
**consciously** and vendor plus hash-gate the artifact. It is not an
acceptable risk if you write `npm install` into a pipeline and hope.

With the eleven corrections from §17 — especially the commit-before-send
invariant — this is a viable basis for real E2EE. Without them the result
would be a system that is green in every test and still leaks plaintext as
soon as an iPhone kills a tab in the background.
