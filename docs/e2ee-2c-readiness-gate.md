# enough. — E2EE-2C READINESS GATE — FINAL GO / NO-GO AUDIT

**Role:** Senior Security Engineer / Cryptography Engineer / Release Auditor (evidence-based)
**Status:** Readiness audit only — **NO production implementation, NO merge**
**Date:** 2026-08-20
**Repository:** `hpmine42/enough`
**Subject:** `@getmaapp/signal-wasm@0.6.6` + the planned enough. E2EE-2C production layer

> **Final decision:** `ARCHITECTURE = GO`, `IMPLEMENTATION = NO-GO`,
> `ENGINE = NO-GO`. **OVERALL = NO-GO.** Production implementation of E2EE-2C
> is **not approved**. Multiple required gates are BLOCKED (environment) or
> otherwise open, and the production E2EE layer does **not** exist yet.
>
> **FINAL VERDICT: NO-GO**

---

## 1. Executive Summary

enough. has completed E2EE-1 (X25519 identity foundation), E2EE-2A (primitive
layer), E2EE-2B (spike + due diligence), E2EE-2C architecture (PR #40), and
E2EE-2C-1/1b provenance investigation (PR #41, result
`REPRODUCTION BLOCKED BY ENVIRONMENT`). The planned browser engine is the
unofficial `@getmaapp/signal-wasm@0.6.6` (AGPL-3.0-only) wrapping official
libsignal `v0.101.0` (`b056faa6d`).

This audit finds:

- The **architecture** (Model A secret storage, Web Locks, tombstone-wins
  prekey/Kyber lifecycle, single device, message envelope, XSS trust model) is
  coherent, internally consistent, and correctly documents that encrypted
  IndexedDB does **not** protect secrets from same-origin malicious JS.
- The **engine is NOT production-approvable** now: no npm provenance
  attestation, no demonstrated byte-exact reproducible build, no GitHub
  release/tag for 0.6.6, toolchain unpinned upstream, no `cargo audit`, no
  license inventory, no independent security review, and the byte-exact build
  could not be executed in this environment.
- The **production E2EE layer is NOT STARTED**: `sendMessage()` still writes
  plaintext into `messages.ciphertext`; no engine, session manager or vault
  exists under `src/`; no CSP; no declared project license.

An execution of any missing test was **never** counted as PASS.

---

## 2. Repository Baseline

| Item | Value |
|---|---|
| Branch | `arena/01a020e0-enough` (matches origin, PR #41 head) |
| Commit (HEAD) | `ce65decadbb344061e6a57a69db7990062557f45` |
| Working tree | clean (`git status` → nothing to commit) |
| origin/main | `9b13a73d59c960e91415ba72ef74b8265d71e025` (PR #40 merge) |
| open/uncommitted changes | none (after sync to origin branch head) |
| E2EE docs present | `e2ee-architecture.md`, `e2ee-2b-spike.md`, `e2ee-2b-due-diligence.md`, `e2ee-2c-architecture.md`, `e2ee-2c-provenance.md`, plus `e2ee-session-architecture.md`, `e2ee-solution-review.md`, `e2ee-implementation-feasibility.md` |
| Experiments present | `experiments/e2ee-2b`, `experiments/e2ee-2c`, `experiments/e2ee-2c-provenance`, `experiments/e2ee-2c-readiness` (new) |
| Root production deps | `@supabase/supabase-js`, `react`, `react-dom` only |
| `@getmaapp/signal-wasm` in root deps | **no** |
| Message path | `sendMessage()` inserts `ciphertext: text` (plaintext) |
| E2EE session engine under `src/` | **none** |

`git diff --check` clean. Production files untouched by this audit.

---

## 3. Previous E2EE Phases

| Phase | Result (documented) |
|---|---|
| E2EE-1 | X25519 identity, non-extractable keys, IndexedDB, `profiles.identity_public_key` |
| E2EE-2A | Local primitives (X25519, HKDF-SHA-256, AES-256-GCM) + tests |
| E2EE-2B spike | `@getmaapp/signal-wasm@0.6.6` runs a PQXDH/Kyber + Double-Ratchet session in an isolated Vite harness |
| E2EE-2B due diligence | PROMISING — BLOCKED on legal, provenance, reproducible WASM, storage, key lifecycle, independent review |
| E2EE-2C architecture (PR #40) | CONDITIONAL GO for planning; NO-GO for production implementation |
| E2EE-2C-1/1b provenance (PR #41) | `REPRODUCTION BLOCKED BY ENVIRONMENT`; PRODUCTION APPROVAL NO; DO NOT MERGE |

Cross-document consistency check: the phases agree on the blockers. E2EE-2C
architecture §21 (GO CONDITIONS) lists legal, reproducible build / provenance,
`cargo audit`, license inventory, independent review, mobile MUST TEST, and
explicit product acceptance of the security boundary — **all still open** in
this audit.

---

## 4. Current Architecture (per `docs/e2ee-2c-architecture.md`)

- **Secret Model A:** session/identity/ratchet material wrapped with a
  non-extractable Web Crypto AES-256-GCM key; AAD-bound; persisted in
  IndexedDB. JS-exportable `Uint8Array` secret records are unavoidable with
  this engine.
- **Persistence:** atomic IndexedDB transactions (one transaction for state +
  Kyber-usage + tombstone), monotonic revision for rollback rejection,
  tombstone-wins.
- **Multi-tab:** exclusive per-user lock via `navigator.locks`; **fail closed**
  if Web Locks unavailable.
- **Device model:** exactly 1 cryptographic device per account; `deviceId = 1`.
- **Identity verification:** TOFU / verified / identity-changed states;
  send-block after identity change; safety number (60-digit fingerprint). QR
  explicitly not required.
- **Message envelope:** `{"v":1,"e":"sw","t":2,"b":"<base64>"}` (specified, not
  a frozen wire format).
- **Supabase boundary:** Supabase may see public identity/prekey material +
  ciphertext + metadata; must never see private keys, session/ratchet state,
  Kyber private keys, plaintext, wrapping key, or vault contents.
- **Service worker:** crypto must not run in the SW.
- **CSP:** `script-src 'self' 'wasm-unsafe-eval'` planned; `'unsafe-eval'` never.

---

## 5. Full Readiness Matrix

| Gate | Requirement | Evidence | Status | Severity | Blocking? |
|---|---|---|---|---|---|
| A — LEGAL | documented legal approval (AGPL) | no LICENSE/NOTICE in enough.; no `license` field; wrapper AGPL-3.0-only; no legal review on record | **BLOCKED** | High | **YES** |
| B — ARTIFACT PROVENANCE | npm provenance attestation | integrity present; **no provenance**, no `_attestations`; no tag/release for 0.6.6 | **BLOCKED** | High | **YES** |
| C — REPRODUCIBLE BUILD | byte-exact build from pinned commit | not executable here (no toolchain; rustup/crates.io blocked) | **BLOCKED** | High | **YES** |
| D — SOURCE↔BINARY | byte-exact proof | only Proven (gitHead) + Indication (WASM strings); **no Proof** | **BLOCKED** | High | **YES** |
| E — UPSTREAM LIBSIGNAL | revision alignment + protocol | Cargo.lock pins `b056faa6d` == official v0.101.0 gitHead | **PARTIALLY VERIFIED** | Medium | yes (until build verified) |
| F — WRAPPER SECURITY | independent security review | surface scan positive (no `unsafe`/`unwrap`/`panic`); **no independent review** | **BLOCKED** | High | **YES** |
| G — RUSTSEC (`cargo audit`) | RustSec advisories | `cargo` unavailable; crates.io blocked | **BLOCKED** | High | **YES** |
| H — LICENSE INVENTORY | full transitive inventory | partial only (AGPL); `cargo-about` not runnable | **BLOCKED** | Medium | yes |
| I — SECRET MODEL | production vault implementation | architecture only (Model A); **NOT IMPLEMENTED** | **NOT IMPLEMENTED** | Medium | (expected) |
| J — XSS / BROWSER TRUST | correct trust-model documentation | architecture §16 documents encrypted IDB does NOT stop same-origin JS | **PASS** (docs) | — | no |
| K — MULTI-TAB | Web Locks, fail-closed, tested | architecture only; untested | **BLOCKED** | Medium | yes |
| L — PREKEY / KYBER LIFECYCLE | atomic tombstone-wins, tested | architecture only; no production code | **NOT IMPLEMENTED** | Medium | (expected) |
| M — DEVICE MODEL | 1 account = 1 device | architecture only | **NOT IMPLEMENTED** | Medium | (expected) |
| N — IDENTITY VERIFICATION | TOFU/verified + send-block | architecture only; no UI | **NOT IMPLEMENTED** | Medium | (expected) |
| O — MESSAGE ENVELOPE | implemented wire format | specified only | **NOT IMPLEMENTED** | Medium | (expected) |
| P — SUPABASE BOUNDARY | live boundary enforced | spec only; live system not yet E2EE | **NOT IMPLEMENTED** | Medium | (expected) |
| Q — MOBILE | real-device testing | no devices available | **BLOCKED** | High | **YES** |
| R — CSP / WASM | `wasm-unsafe-eval` applied, no `unsafe-eval` | no CSP meta in index.html | **BLOCKED** | High | **YES** |
| S — SERVICE WORKER | crypto not in SW | pwa SW exists; policy says crypto not in SW; no E2EE yet | **PASS** (policy) | — | no |
| T — PERFORMANCE | measured mobile budgets | spike only; no mobile measurements | **BLOCKED** | Medium | yes |
| U — FAILURE / RECOVERY | crash/corruption scenarios tested | largely untested | **BLOCKED** | Medium | yes |
| V — SECURITY TESTING | malformed-input/negative tests | many MISSING TEST | **BLOCKED** | High | **YES** |
| W — SUPPLY CHAIN | integrity+provenance+reproducibility | integrity ✅; provenance ❌; reproducibility ❌ | **BLOCKED** | High | **YES** |
| X — INDEPENDENT REVIEW | genuinely independent review | none | **BLOCKED** | High | **YES** |

Status vocabulary used only: `PASS`, `FAIL`, `BLOCKED`, `UNKNOWN`, `NOT
APPLICABLE` (plus `NOT IMPLEMENTED` / `PARTIALLY VERIFIED` / `DESIGN ONLY` as
documentation labels).

---

## 6. Legal Gate

Verified in this audit:

- enough. has **no `LICENSE`/`NOTICE` file** in the repo root and **no
  `license` field** in `package.json`. There is **no declared license
  strategy** for the project.
- `@getmaapp/signal-wasm@0.6.6` is `AGPL-3.0-only` (npm `license` field,
  package `LICENSE` file, source repo `LICENSE`). libsignal (upstream) is also
  AGPL-3.0.
- No written legal conclusion is on record regarding shipping an AGPL-3.0-only
  WASM bundle on GitHub Pages.

Per the gate rule, this auditor is **not** a lawyer and will not assert that
AGPL is "compatible" or "incompatible". **LEGAL REVIEW REQUIRED.**

**Gate A status: BLOCKED (Blocking = YES).**

---

## 7. Provenance Gate

Re-verified in this audit (`npm view`, registry metadata fetch, tarball
download + `sha256sum`):

| Field | Value |
|---|---|
| package / version | `@getmaapp/signal-wasm` `0.6.6` |
| npm `gitHead` | `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` |
| `dist.integrity` | `sha512-cYpzAe+HV1xfiXJ1tfDEvAjNkIsKwQApmFgniWJw/dTonOx4By6NzJ7J5izi+pjvfrn5zuXa0TmcHJ7Y/bLZYg==` |
| `dist.shasum` | `62ad482454e62187664bd4f9473f8afac2061b07` |
| fileCount / unpackedSize | 6 / 925,512 |
| tarball SHA-256 | `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` |
| `signal_wasm_bg.wasm` SHA-256 | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` |
| `signal_wasm.js` SHA-256 | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` |
| `signal_wasm.d.ts` SHA-256 | `32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2` |
| README.md SHA-256 | `6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26` |
| LICENSE SHA-256 | `2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091` |
| npm provenance attestation | **NOT PRESENT** (`provenance` field absent; no `_attestations`) |
| npm package signature | present (integrity signature) — this is **not** provenance |
| GitHub release for `0.6.6` | **absent** (releases stop at `v0.2.0`) |
| git tag at `gitHead` | **absent** |

All hashes **match** the E2EE-2C-1/1b records (no artifact mismatch). But
**integrity ≠ authenticity ≠ provenance ≠ reproducibility**. There is no
machine attestation that the published files were built from the claimed
source.

**Gate B status: BLOCKED (Blocking = YES).**

---

## 8. Reproducibility Gate

Verified in this audit:

- `rustc`, `cargo`, `wasm-pack`, `rustup`, `wasm-tools`, `wasm-opt` are all
  **MISSING**; no `~/.rustup`, no `~/.cargo`, no cached crates.
- Network reachability probed: `static.rust-lang.org` → 000, `crates.io` → 000,
  `index.crates.io` → 000, `release-assets.githubusercontent.com` → 000
  (hard egress block). `registry.npmjs.org` → 200, `github.com` → 200.
- Therefore the byte-exact build **cannot be executed in this environment**.
  Required toolchain/dependencies are unavailable.

A build that did not run is **never** PASS or EXACT. The upstream repo also
pins **no** toolchain (`rust-toolchain.toml` absent, no CI), so even with a
toolchain the exact build environment is only *identified from the binary*
(see §9), not *reconstructable from the repo*.

**Gate C status: BLOCKED (Blocking = YES).** Reason: `Required
toolchain/dependencies unavailable in current environment.`

---

## 9. Source ↔ Binary Gate

Strict separation:

- **Proven:** npm `gitHead` `0a5e3cb8…` exists in the source repo, is
  reachable from `main`, matches npm `package.json`; npm README/LICENSE are
  byte-identical to the repo files at `gitHead`.
- **Indication:** the published WASM embeds source-path strings
  (`/Users/me/.cargo/git/checkouts/libsignal-…/b056faa/…`) pointing at the
  pinned libsignal checkout `b056faa` (== `Cargo.lock`), and
  `producers`/`target_features` sections fingerprint the toolchain:
  `rustc 1.92.0 (ded5c06cf 2025-12-08)`, `walrus 0.26.4`,
  `wasm-bindgen 0.2.126 (21ac804a9)`.
- **Proof (byte-exact rebuild → identical WASM):** **absent** — no build ran.

Only **Proof** is a genuine reproducibility proof. It is missing.

**Gate D status: BLOCKED (Blocking = YES).**

---

## 10. libsignal Upstream Gate

Verified:

- Source `Cargo.toml` and `Cargo.lock` at `gitHead` pin
  `libsignal-protocol` and `zkgroup` to
  `b056faa6dd02961cff24064c54c089c52e1a0753`.
- Official `@signalapp/libsignal-client@0.101.0` npm `gitHead` = the same
  commit `b056faa6`. The pin is aligned with official v0.101.0.
- `Cargo.lock` dependency versions match WASM-embedded registry paths
  (aes 0.9.2, bytes 1.12.1, block-padding 0.4.2, cipher 0.5.2,
  libcrux-ml-kem 0.0.10).
- PQXDH / Double Ratchet / session state / prekey / Kyber / fingerprint /
  serialization are provided by upstream libsignal (protocol core); the
  wrapper exposes stores + boundary logic. A full protocol-equivalence
  verification against official bindings was **not** executed (no build).

**Gate E status: PARTIALLY VERIFIED** (pin aligned; protocol/build-level
equivalence unverified).

---

## 11. Wrapper Security Gate

Surface analysis of `src/lib.rs` at `gitHead` (2,024 lines, `tests/web.rs`
2,771 lines):

- `#![deny(unsafe_code)]` at module root → **zero `unsafe`** in the wrapper.
- `#![warn(clippy::unwrap_used)]`.
- **No** `unwrap()`, `expect()`, `panic!`, `assert!`, `unreachable!`,
  `todo!`, `unimplemented!`, `transmute`, or raw-pointer casts found in
  `src/lib.rs`.
- Randomness via `rand::rng()` with `getrandom` `wasm_js` backend (Web Crypto).
- Timestamps via `js_sys::Date::now()`.
- Secrets use `zeroize::Zeroizing`.
- Input length validation (`try_into` with explicit `validation_error`);
  documented bounds (random bytes ≤ 1 MiB; prekey batch ≤ 500).
- Error conversion: release builds emit generic `"SignalError: Operation
  failed"`; debug builds include details. `console_error_panic_hook` is a debug
  helper.

This is a **positive surface scan, not a full independent security review**.
Boundary logic, serialization, key/session import/export, Kyber usage &
tombstone handling, and malformed/attacker-controlled input were not subjected
to an independent expert review. The E2EE-2B/2C docs already flag wrapper
storage/Kyber/export review as open.

**Gate F status: BLOCKED (Blocking = YES)** — surface scan positive, but no
sufficient/independent review.

---

## 12. RustSec Gate

`cargo audit` and `cargo deny check` could **not** be run: `cargo` is not
installed and `crates.io`/`static.crates.io` are unreachable. No RustSec /
yanked-crate / advisory check was performed.

**Gate G status: BLOCKED (Blocking = YES).**

---

## 13. License Gate (transitive inventory)

Known: wrapper `AGPL-3.0-only`; upstream libsignal `AGPL-3.0-only`. A complete
transitive Rust dependency license inventory (`cargo-about`) was **not**
generated (cargo unavailable). Enough. has no declared license at all.

**Gate H status: BLOCKED (Blocking = yes).**

---

## 14. Secret Persistence Gate (Secret Model)

Architecture (E2EE-2C §5, §6, §9): Model A — wrapping key (non-extractable
AES-256-GCM), AAD, IndexedDB vault isolation, atomic persistence, rollback
(monotonic revision), corruption handling, tombstone-wins, logout/account
deletion, crash recovery. This is **design**, verified in the architecture
document and the isolated `experiments/e2ee-2c` vault experiments (not a
production implementation).

**Gate I status: NOT IMPLEMENTED** (design verified, implementation absent —
expected at this stage).

---

## 15. Multi-Tab Gate

Architecture (E2EE-2C §10): exclusive per-user lock via `navigator.locks`;
**fail closed** if Web Locks unavailable; addresses stale state, concurrent
session modification, duplicate prekey consumption, duplicate encryption,
session rollback. **Not tested** on real browsers; no production code.

**Gate K status: BLOCKED** (untested; design only).

---

## 16. PreKey / Kyber Gate

Architecture (E2EE-2C §8–§9): X25519 identity/signed/one-time prekeys with
consumption + tombstone; Kyber1024 one-time + last-resort keys with usage
state, export/import, tombstone, crash consistency, replay protection;
**tombstone-wins**; usage state persisted atomically with session state. No
production code; only architecture + isolated experiments.

**Gate L status: NOT IMPLEMENTED / DESIGN ONLY** (not a production approval).

---

## 17. Device Gate

Architecture (E2EE-2C §11): 1 account = 1 device, `deviceId = 1`; new browser /
IndexedDB wipe / browser change / logout / account deletion / identity
replacement behavior designed. Multi-device explicitly postponed. No production
code.

**Gate M status: NOT IMPLEMENTED / DESIGN ONLY.**

---

## 18. Identity Verification Gate

Architecture (E2EE-2C §12): TOFU → verified → identity-changed states;
send-block after identity change; safety number (60-digit fingerprint);
verification persistence / reset designed. QR is optional and **not**
represented as implemented. No UI exists.

**Gate N status: NOT IMPLEMENTED / DESIGN ONLY.**

---

## 19. Message Envelope Gate

Architecture (E2EE-2C §13): `{"v":1,"e":"sw","t":2,"b":"<base64>"}` specified —
versioning, engine id, message type, binary encoding, malformed/downgrade
behavior, migration path. **Specified only; not implemented.** No code
consumes or produces envelopes.

**Gate O status: NOT IMPLEMENTED** (spec only).

---

## 20. Supabase Boundary Gate

Architecture (E2EE-2C §14): Supabase may see public identity/prekey material,
ciphertext, metadata; must never see private keys, session/ratchet state, Kyber
private keys, plaintext, wrapping key, vault contents. This is a **spec**; the
live system does **not** yet enforce an E2EE boundary (`sendMessage` writes
plaintext). No claim is made that the boundary is live.

**Gate P status: NOT IMPLEMENTED.**

---

## 21. Mobile Gate

Real-device testing (Android Chrome/PWA, iOS Safari, WASM init, IndexedDB, Web
Locks, background/suspend, reload, storage persistence, memory pressure) was
**not** possible — no physical devices available in this environment.

**Gate Q status: BLOCKED (Blocking = YES).**

---

## 22. CSP / WASM Gate

Verified: `index.html` has **no `Content-Security-Policy` meta tag** and no
`wasm-unsafe-eval` directive. The planned CSP
(`script-src 'self' 'wasm-unsafe-eval'`, never `'unsafe-eval'`) is **not yet
applied or tested** on GitHub Pages / Vite.

**Gate R status: BLOCKED (Blocking = YES).**

---

## 23. Service Worker Gate

Verified: enough. registers a service worker (`src/lib/pwa.ts`, `sw.js`). The
architecture policy is that **crypto does not run in the SW**; no E2EE is
implemented anywhere yet. Update/cache/trust-boundary analysis exists in the
architecture doc. For the current (non-E2EE) app this policy is coherent.

**Gate S status: PASS (policy)** — implementation still pending with E2EE-2C.

---

## 24. Performance Gate

Only the E2EE-2B spike exists. No measured cold-init / PQXDH / encrypt /
decrypt / prekey-gen / memory / IndexedDB-persistence numbers on low-end
Android or iOS Safari. No real measurements.

**Gate T status: BLOCKED.**

---

## 25. Failure / Recovery Gate

Scenarios 1–15 (crash during encryption/persistence, crash pre/post tombstone,
corrupted vault, missing/stale session, deleted IndexedDB, storage eviction,
identity change, duplicate ciphertext, replay, out-of-order, two tabs sending)
are largely **un-tested** in a production context; only the isolated vault
experiment covers a small subset (atomicity/rollback/wrapping).

**Gate U status: BLOCKED** — expected behavior partially specified, evidence
minimal, not implemented.

---

## 26. Security Testing Gate

Present tests: E2EE-2A crypto primitives tests (main repo `npm run
test:crypto`); E2EE-2B spike harness tests; E2EE-2C vault tests; provenance
hash tests. **Missing** production-facing negative tests for malformed
ciphertext, malformed envelope, wrong identity, wrong session, replay,
out-of-order, session restore, corrupted state, duplicate messages, invalid
Kyber signature, invalid prekey, invalid serialized state — all **MISSING
TEST** and blocking for production.

**Gate V status: BLOCKED (Blocking = YES).**

---

## 27. Supply Chain Gate

Distinguished:

- **Integrity:** ✅ npm `dist.integrity`/`shasum` match; all file hashes stable.
- **Authenticity:** partial — npm registry signature present, but no trusted
  release chain / signed release / checksums.
- **Provenance:** ❌ no npm provenance attestation; no CI; no GitHub release.
- **Reproducibility:** ❌ no byte-exact build; toolchain unpinned.

A standard package signature is **not** treated as provenance.

**Gate W status: BLOCKED (Blocking = YES).**

---

## 28. Independent Review Gate

No genuinely independent security / cryptography review of the wrapper or of
enough.'s planned E2EE adapter exists. Self-review, this Arena audit, README,
and the project's own tests are explicitly **not** independent.

**Gate X status: BLOCKED (Blocking = YES).**

---

## 29. Remaining Blockers

Required gates not PASS:

1. **Legal review** (A) — no declared enough. license; AGPL un-reviewed.
2. **npm provenance / attestation** (B, W) — absent.
3. **Reproducible byte-exact build** (C, D, W) — not executed; env-blocked and
   upstream toolchain unpinned.
4. **Wrapper independent security review** (F, X) — none.
5. **`cargo audit` / RustSec** (G) — not runnable here.
6. **Transitive license inventory** (H) — not generated.
7. **Mobile real-device testing** (Q) — not performed.
8. **CSP / `wasm-unsafe-eval` applied & tested** (R) — not applied.
9. **Performance measurements** (T) — none.
10. **Failure/recovery + security (negative) tests** (U, V) — missing.
11. **Full production E2EE implementation** (I, K–P) — not started.

---

## 30. Required Actions (prioritized)

### P0 — Blocking (before any production E2EE-2C implementation)

| Action | Why | Evidence needed | Where | Arena? | External? |
|---|---|---|---|---|---|
| Written legal conclusion on shipping AGPL-3.0-only wrapper on GitHub Pages + enough. license strategy | Gate A | legal opinion / license decision | counsel + repo | NO | **LEGAL / HUMAN REVIEW REQUIRED** |
| npm provenance attestation or vendor + reproducible build | Gates B/C/D/W | SLSA/npm attestation OR vendored WASM with verified hashes | upstream + CI | PARTIAL (verification) | **EXTERNAL ENVIRONMENT REQUIRED** (network/toolchain) |
| Byte-exact reproducible build (`rustc 1.92.0` + `wasm-bindgen 0.2.126`, target `wasm32-unknown-unknown`, release profile) | Gate C/D | Build #1==#2==npm SHA-256 | network-enabled env | NO | **EXTERNAL ENVIRONMENT REQUIRED** |
| Independent wrapper security review (storage, Kyber usage, import/export, boundary) | Gates F/X | independent audit report | external reviewer | NO | **EXTERNAL / HUMAN REVIEW REQUIRED** |
| `cargo audit` + transitive license inventory (`cargo-about`) | Gates G/H | clean/excepted audit + inventory | network-enabled env | NO | **EXTERNAL ENVIRONMENT REQUIRED** |

### P1 — Required before implementation

- Design freeze + explicit product acceptance of the §16 security boundary
  (XSS/SW/bundle out of E2EE scope).
- Mobile MUST TEST M1–M14 on real Android/iOS (WASM init, IndexedDB, Web
  Locks, background, reload, persistence, memory). — **EXTERNAL (devices)**
- Apply + test CSP (`script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-eval'`).
- Define/adopt the message envelope `v=1 e=sw t=2 b=…` and migration path.
- Performance budget measurements on low-end devices.

### P2 — Required before production release

- Full security (negative) test suite: malformed envelope/ciphertext, replay,
  out-of-order, session restore, corrupted state, duplicate messages, invalid
  Kyber/prekey/serialized state.
- Failure/recovery scenario tests (crash, tombstone, eviction, multi-tab).
- CI with pinned toolchain + provenance publishing.
- Independent crypto review of the enough. adapter + engine integration.

### P3 — Recommended hardening

- Runtime panic/reload telemetry without leaking secrets.
- Vendor WASM or pin by hash in the app.
- Documentation of the dual-stack / old-plaintext migration.

Legend: **ARENA CAN DO** applies to the P2 security-test scaffolding and the
readiness baseline test (which Arena created under `experiments/`); everything
requiring real devices, the Rust toolchain + network, legal counsel, or an
independent reviewer is **EXTERNAL / HUMAN REVIEW REQUIRED**.

---

## 31. Architecture Decision

The planned architecture (Model A secret model, Web Locks fail-closed
multi-tab, tombstone-wins prekey/Kyber lifecycle, single device, message
envelope, explicit XSS trust model, no crypto in SW, CSP `wasm-unsafe-eval`)
is coherent, internally consistent, and correctly scopes the security
boundary.

```text
ARCHITECTURE: GO
```

This is a design decision only — it is **not** an implementation approval.

---

## 32. Implementation Decision

Multiple P0/P1 gates are BLOCKED (legal, provenance, reproducible build,
wrapper review, RustSec, mobile, CSP) and the production E2EE layer does not
exist. Per the absolute rule in §32, production implementation is **not**
approved.

```text
IMPLEMENTATION: NO-GO
```

---

## 33. Engine Decision

`@getmaapp/signal-wasm@0.6.6` is not production-approvable: no provenance
attestation, no byte-exact reproducible build, no release/tag, unpinned
toolchain, no independent review.

```text
ENGINE: NO-GO
```

---

## 34. Final GO / NO-GO Decision

Required gates NOT all PASS (many BLOCKED) → production implementation of
E2EE-2C is **NO-GO**.

```text
OVERALL: NO-GO
```

```text
E2EE-2C production implementation: NOT STARTED
Production approval: NO
Merge: DO NOT MERGE (PR #41 stays open, not auto-merged)
```

This audit performs **no production integration**. Per the stop condition, no
production code was written.
