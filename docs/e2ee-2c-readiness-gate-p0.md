# enough. — E2EE-2C P0 Blocker Resolution

**Role:** Senior Security Engineer / Cryptography Engineer / Release Auditor (evidence-based)
**Status:** P0 gate resolution — **NO production implementation, NO merge**
**Date:** 2026-08-20
**Repository:** `hpmine42/enough`
**Branch at start:** `arena/01a020e0-enough` (PR #41 head)
**Subject:** `@getmaapp/signal-wasm@0.6.6` + the planned E2EE-2C production layer
**Predecessor:** [`e2ee-2c-readiness-gate.md`](./e2ee-2c-readiness-gate.md) (OVERALL NO-GO), [`e2ee-2c-legal-review.md`](./e2ee-2c-legal-review.md)

> **Bottom line:** The P0 gates were worked "as far as technically possible in
> this environment." Of the nine P0 gates, none can be marked **PASS** because
> each requires either an external human/legal review, a real Rust toolchain +
> crates.io network access, real mobile devices, or an independent reviewer —
> none of which this environment provides. Every required external proof was
> **not** replaced by an assumption. Production implementation remains
> **NOT STARTED** and **not approved**.
>
> **`OVERALL: NO-GO`**

---

## 1. Executive Summary

This phase re-established the repository baseline, re-verified the npm artifact
and provenance, attempted (and documented the blocking of) a byte-exact
reproducible build, performed a deeper wrapper source surface-scan, enumerated
the Rust dependency surface from `Cargo.lock`, confirmed `cargo audit` /
`cargo-about` / independent review are unavailable here, and produced a legal
review packet for human counsel.

Result: **all P0 gates remain BLOCKED** (not FAIL, not PASS). The blockers are
not closed by documentation; they require humans, a network-enabled Rust
environment, and real devices. no gate is upgraded to PASS on the basis of
tests alone.

---

## 2. Repository Baseline (verified)

| Item | Value |
|---|---|
| Branch | `arena/01a020e0-enough` |
| HEAD | `a3a4266112878392348467b50f072430eb798028` (matches origin / PR #41) |
| origin/main | `9b13a73d59c960e91415ba72ef74b8265d71e025` (PR #40 merge) |
| Working tree | clean |
| Unexpected commits | none (history = readiness-gate → provenance → architecture) |
| `git diff --check` | clean |
| Root production deps | `@supabase/supabase-js`, `react`, `react-dom` (no signal-wasm) |
| Message path | `sendMessage()` still inserts `ciphertext: text` (plaintext) |
| E2EE session engine / vault under `src/` | **none** |
| CSP in `index.html` | **none** |
| `navigator.locks` / `BroadcastChannel` in `src/` | **not used** |
| enough. license | **none declared** |

All doc reads (`e2ee-2b-due-diligence.md`, `e2ee-2b-spike.md`,
`e2ee-2c-architecture.md`, `e2ee-2c-readiness-gate.md`, `e2ee-architecture.md`)
and experiments (`e2ee-2c`, `e2ee-2c-provenance`, `e2ee-2c-readiness`) were
performed; conclusions are consistent with the prior readiness gate.

---

## 3. Gate A — LEGAL

**Evidence / method:** repo inspection (LICENSE/NOTICE/license field); npm + source `LICENSE` for wrapper; official libsignal npm license.

**Result:** enough. has **no declared license**. Wrapper and upstream are **AGPL-3.0-only**. A full legal review packet was produced at [`e2ee-2c-legal-review.md`](./e2ee-2c-legal-review.md) listing 8 concrete questions for counsel.

**Confidence:** high (facts verified); the *legal conclusion* is not reachable by this auditor.

**Remaining uncertainty:** all — the questions in the packet are unanswered.

**Required external action:** human legal counsel producing a written conclusion; project license decision.

**Status:** `BLOCKED` (Blocking = YES). **LEGAL REVIEW REQUIRED.**

---

## 4. Gate B — ARTIFACT PROVENANCE

**Evidence / method:** `npm view @getmaapp/signal-wasm@0.6.6 …`; registry metadata fetch; tarball download + `sha256sum`; provenance/attestation check.

**Result (re-verified 2026-08-20):**

| Field | Value |
|---|---|
| version | `0.6.6` |
| gitHead | `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` |
| tarball SHA-256 | `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` |
| `signal_wasm_bg.wasm` | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` |
| `signal_wasm.js` | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` |
| `signal_wasm.d.ts` | `32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2` |
| README.md | `6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26` |
| LICENSE | `2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091` |
| npm integrity | `sha512-cYpzAe+HV1xfiXJ1tfDEvAjNkIsKwQApmFgniWJw/dTonOx4By6NzJ7J5izi+pjvfrn5zuXa0TmcHJ7Y/bLZYg==` |
| npm provenance | **absent** |
| npm attestations (`_attestations`) | **absent** |
| GitHub tag at gitHead | **absent** (only v0.1.0–v0.2.0) |
| GitHub release for 0.6.6 | **absent** (releases stop at v0.2.0) |
| CI / release automation in source repo | **absent** (no `.github/`, no workflows) |

**Confidence:** high (directly verified).

**Remaining uncertainty:** none about *facts*; the *absence* of provenance is the blocker.

**Required external action:** upstream must publish npm provenance (`--provenance` via CI) OR enough. vendors and independently rebuilds (Gate C/D).

**Status:** `BLOCKED — NO NPM PROVENANCE`; also `BLOCKED — NO RELEASE/TAG FOR 0.6.6` (Blocking = YES).

---

## 5. Gate C — REPRODUCIBLE BUILD

**Evidence / method:** toolchain detection; network reachability probes; local-cache inspection; attempted build recipe (`experiments/e2ee-2c-provenance/scripts/build-repro.sh`).

**Result:**
- `rustc`, `cargo`, `wasm-pack`, `rustup`, `wasm-tools`, `wasm-opt` all **MISSING**; no `~/.rustup`, no `~/.cargo`.
- Network: `static.rust-lang.org` → 000, `crates.io` → 000, `index.crates.io` → 000, `static.crates.io` → 000 (all hard-blocked); `registry.npmjs.org`/`github.com` reachable.
- No cached crates; no offline build possible.
- Upstream pins **no** toolchain (`rust-toolchain.toml` absent, no CI). wasm-pack/cargo/clang/LLVM versions are **UNKNOWN** (not guessed).

**Known WASM toolchain evidence (from `producers` section, historical/artifact):** rustc 1.92.0 (ded5c06cf 2025-12-08), wasm-bindgen 0.2.126 (21ac804a9), walrus 0.26.4; target `wasm32-unknown-unknown`; release `lto=true, opt-level="s", debug=0, panic="abort"`.

**Confidence:** high that the build is not executable here.

**Remaining uncertainty:** the entire exact-build question — unmeasured.

**Required external action:** run `scripts/build-repro.sh` in a network-enabled environment with `rustc 1.92.0`, then `scripts/compare.sh`.

**Status:** `REPRODUCIBLE BUILD = BLOCKED` (Blocking = YES).

---

## 6. Gate D — SOURCE ↔ BINARY

**Evidence / method:** git provenance of gitHead; README/LICENSE byte comparison; WASM string + producers/target_features extraction; dependency fingerprint from Cargo.lock vs WASM paths.

**Result:**
- **Proven:** npm `gitHead` exists, reachable from `main`, matches npm package; npm README/LICENSE byte-identical to source at gitHead.
- **Indication:** WASM embeds `/Users/me/.cargo/git/checkouts/libsignal-…/b056faa/…` source paths; `producers`/`target_features` present; Cargo.lock dep versions match WASM-embedded registry paths (aes 0.9.2, bytes 1.12.1, block-padding 0.4.2, cipher 0.5.2, libcrux-ml-kem 0.0.10, getrandom 0.2.17/0.3.4/0.4.3).
- **Proof (byte-exact rebuild → identical WASM):** **absent** — no build ran.

**Confidence:** high for Proven + Indication; **no** confidence on Proof.

**Remaining uncertainty:** whether the published WASM is byte-equivalent to a rebuild from source.

**Required external action:** Gate C build + hash comparison.

**Status:** `STRONG CORRELATION — NOT BYTE-VERIFIED` (Blocking = YES).

---

## 7. Gate F — WRAPPER SECURITY REVIEW

**Evidence / method:** full read of `src/lib.rs` (2,024 lines) + `tests/web.rs` (2,771 lines) at gitHead; automated pattern scan; targeted review of key APIs.

**Result (surface scan, 2026-08-20):**

| Pattern | Count in `src/lib.rs` |
|---|---|
| `unsafe` | 0 |
| `.unwrap()` | 0 |
| `.expect(` | 0 |
| `unwrap_or` / `unwrap_unchecked` | 0 |
| `panic!` / `assert!` / `unreachable!` / `todo!` / `unimplemented!` | 0 |
| `transmute` / raw-pointer casts | 0 |
| `#![deny(unsafe_code)]` | present (line 13) |
| `Zeroizing` uses | 11 |

Additional findings:

- **RNG:** `rand::rng()` + `getrandom` `wasm_js` backend (Web Crypto). `generate_random_bytes` bounded to 1 MiB.
- **Allocation bounds:** `MAX_PREKEY_BATCH_SIZE = 500`, `MAX_DEVICE_ID = 127`, `MAX_REGISTRATION_ID = 16383`, random bytes ≤ 1 MiB.
- **Validation:** explicit `validation_error` on device-id, prekey-id, signed-prekey-id, Kyber-prekey-id, Kyber-usage-export-header, key length, batch size. `try_into` with explicit length checks (e.g. `GroupMasterKey::from_bytes`).
- **Secrets:** wrapper buffers use `Zeroizing`; README documents that upstream `PrivateKey` is a `Copy` over `[u8;32]` not erased on drop, and that JS-exported bytes cannot be erased.
- **Errors:** release builds emit generic `"SignalError: Operation failed"` preserving `.code`; debug builds include details; `console_error_panic_hook` is a debug-only helper.
- **Timestamps:** `js_sys::Date::now()`.
- **Exports/imports:** identity, prekey, signed-prekey, Kyber-prekey, session, Kyber-usage export/import present; delete/tombstone APIs present.

Finding classification (relative to enough.'s usage of the 1:1 session surface):

- **Critical:** none found in the reviewed wrapper source surface.
- **High:** JS-exportable secret material is inherent to the API (identity/private/prekey/session/ratchet bytes reach JS); zeroization incomplete for JS copies and upstream scalar — a **model-level** residual, not a fixable wrapper bug. Also: `spqr` (SparsePostQuantumRatchet) is a separate git dependency not reviewed here.
- **Medium:** WASM panic aborts the instance (release `panic=abort`); needs app recovery design. Group/SenderKey/GV2 wrappers present but unused by 1:1 scope (out of scope, not reviewed).
- **Low:** debug builds leak detail strings (debug-only; release flattens).
- **Informational:** wrapper-own stores, Kyber-usage tracking and tombstone APIs are security-relevant and must be covered by persistence tests + independent review.

**Confidence:** high for the mechanical scan; **this is NOT an independent cryptographic audit.**

**Required external action:** independent security review of wrapper boundary logic (stores, Kyber usage, import/export, error mapping) + the enough. adapter when built.

**Status:** `BLOCKED` (Gate X independent review absent). Marked **`SELF-REVIEW ONLY`**.

---

## 8. Gate G — RUSTSEC

**Evidence / method:** `cargo audit` / `cargo deny check` attempted; `cargo` unavailable; `crates.io`/`static.crates.io` unreachable.

**Result:** Could not be run. No RustSec advisory database download, no yanked-crate check, no `cargo deny` policy evaluation. The prior E2EE-2B finding ("no package-specific CVE found via GitHub/npm audit") is **not** equivalent to a RustSec audit.

**Confidence:** n/a (tool unavailable).

**Remaining uncertainty:** all — transitive Rust advisories unmeasured across the 240-crate lockfile.

**Required external action:** run `cargo audit` + `cargo deny check` in a network-enabled environment against `Cargo.lock` at `0a5e3cb8…`.

**Status:** `RUSTSEC = BLOCKED BY ENVIRONMENT` (Blocking = YES).

---

## 9. Gate H — LICENSE INVENTORY

**Evidence / method:** parsed `Cargo.lock` at gitHead (240 packages). License metadata for each crate lives in crates.io metadata, which is **unreachable** here; therefore a full `cargo-about` inventory could not be generated.

**Result (dependency surface, not a license conclusion):**
- 240 packages total: 231 from `registry+https://github.com/rust-lang/crates.io-index`, 9 from git sources.
- Git-source crates (libsignal workspace): `libsignal-account-keys`, `libsignal-core`, `libsignal-debug 0.101.0`, `libsignal-protocol`, `poksho 0.7.0`, `signal-crypto`, `zkcredential`, `zkgroup 0.9.0` (all `@ b056faa6…`), plus `spqr 1.5.3` from `signalapp/SparsePostQuantumRatchet` (tag v1.5.3).
- Notable direct pins: `wasm-bindgen =0.2.126`, `getrandom 0.2.17`/`0.3.4` (transitive 0.4.3), `uuid 1.24.0`, `zeroize 1.9.0`, `rand 0.9.5` (+0.10.2), `subtle 2.6.1`, `curve25519-dalek 5.0.0`, `libcrux-ml-kem 0.0.10`, `aes 0.8.4/0.9.2`, `cipher 0.4.4/0.5.2`, `block-padding 0.4.2`, `bytes 1.12.1`.
- **Licenses of individual crates: NOT determined** (registry metadata blocked).

The per-crate license table is the deliverable that *cannot* be produced here. Do **not** treat this partial enumeration as a license inventory.

**Confidence:** high for names/versions; **zero** for license per crate.

**Remaining uncertainty:** all license values for the 231 registry crates.

**Required external action:** `cargo about generate` (or equivalent) in a network-enabled environment; review for copyleft conflicts + NOTICE obligations.

**Status:** `LICENSE INVENTORY = BLOCKED` (Blocking = yes).

---

## 10. Gate X — INDEPENDENT REVIEW

**Evidence / method:** search of repo + docs for any external/independent audit.

**Result:** No genuinely independent security / cryptography review of the wrapper or the planned enough. adapter exists. This audit, the E2EE-2B/2C self-reviews, README, and the project's own tests are explicitly **not** independent. Upstream `SECURITY_AUDIT_REPORT.md` is for v0.1.1 and historical.

**Confidence:** high.

**Required external action:** hire/engage an independent reviewer for (a) the wrapper and (b) the enough. adapter when built.

**Status:** `INDEPENDENT REVIEW = BLOCKED` (Blocking = YES).

---

## 11. P1 Gate Status Inventory (current, not implemented)

| Gate | Status | Note |
|---|---|---|
| Mobile (Android Chrome / iOS Safari PWA) | **BLOCKED** | no devices available |
| IndexedDB eviction / backgrounding | **UNKNOWN / BLOCKED** | not device-tested |
| Web Locks | **DESIGN ONLY** | `navigator.locks` not used in `src/`; architecture only |
| WASM cold start | **UNKNOWN** | spike Node/Vite only, no mobile |
| CSP / WASM (`wasm-unsafe-eval`) | **BLOCKED** | no CSP in `index.html` |
| Service worker | **PASS (policy)** | SW exists; crypto policy "not in SW" documented; no E2EE yet |
| Performance | **BLOCKED** | no mobile measurements |
| Failure / recovery | **BLOCKED** | mostly untested |
| Negative security tests | **BLOCKED** | missing (malformed envelope/ciphertext, replay, out-of-order, restore, corrupted state, invalid Kyber/prekey/serialized state) |
| Multi-tab | **DESIGN ONLY / BLOCKED** | untested in real browsers |
| Message envelope | **DESIGN ONLY** | spec only, not implemented |
| Verification UX | **DESIGN ONLY** | no UI |
| Secret Model / Persistence | **DESIGN ONLY** (experiments 7/7 pass) | not production |

---

## 12. Threat Model Implications

Because the engine and the enough. E2EE layer are **not** implemented, none of
the T1–T14 mitigations in `e2ee-2c-architecture.md` §16 are active in
production (messages are still plaintext). The architecture correctly documents
that **encrypted IndexedDB does not protect secrets from same-origin malicious
JavaScript** (XSS/SW/bundle remain in scope as accepted residuals). No security
property that depends on E2EE-2C is currently claimed by enough. in production.

---

## 13. Remaining Blockers (unchanged / reinforced)

1. Legal review + enough. license — **open** (packet created).
2. npm provenance / release / tag for 0.6.6 — **absent**.
3. Byte-exact reproducible build — **not executable here**; upstream toolchain unpinned.
4. `cargo audit` / RustSec — **not runnable here**.
5. Transitive license inventory — **not generated**.
6. Independent wrapper + adapter review — **none**.
7. Mobile real-device testing — **not performed**.
8. CSP applied + tested — **not applied**.
9. Production E2EE layer (secret model, multi-tab, prekey/Kyber, device, verification, envelope, Supabase boundary) — **not implemented**.
10. Negative/security + failure/recovery tests — **missing**.

---

## 14. Required External Actions

| Action | Gate | Arena can do? | External required? |
|---|---|---|---|
| Written legal conclusion + enough. license | A | no | **LEGAL / HUMAN** |
| npm provenance OR vendor + rebuild | B/C/D/W | verify only | **EXTERNAL ENVIRONMENT** (toolchain+network) |
| `cargo audit` / `cargo deny` | G | no | **EXTERNAL ENVIRONMENT** |
| `cargo-about` license inventory | H | no | **EXTERNAL ENVIRONMENT** |
| Independent wrapper/adapter review | F/X | no | **EXTERNAL / HUMAN** |
| Mobile device tests M1–M14 | Q/T | no | **EXTERNAL (devices)** |
| CSP apply + test | R | scaffold only | browser + Pages |
| Security/negative + recovery test suite | U/V | partial (isolated scaffold) | device/browser for full |
| CI with pinned toolchain + provenance publishing | B/C/W | no | **EXTERNAL ENVIRONMENT** |

---

## 15. Final Go / No-Go Matrix

| Gate | Status | Blocking? |
|---|---|---|
| A Legal | BLOCKED | YES |
| B Provenance | BLOCKED | YES |
| C Repro Build | BLOCKED | YES |
| D Source/Binary | BLOCKED (STRONG CORRELATION, NOT BYTE-VERIFIED) | YES |
| E libsignal | PARTIALLY VERIFIED | yes (until build) |
| F Wrapper | BLOCKED (self-review only) | YES |
| G RustSec | BLOCKED BY ENVIRONMENT | YES |
| H License Inventory | BLOCKED | YES |
| I Secret Model | NOT IMPLEMENTED | (expected) |
| J Browser Trust | PASS (docs) | no |
| K Multi-tab | DESIGN ONLY / BLOCKED | yes |
| L PreKey/Kyber | NOT IMPLEMENTED | (expected) |
| M Device | NOT IMPLEMENTED | (expected) |
| N Verification | NOT IMPLEMENTED | (expected) |
| O Envelope | NOT IMPLEMENTED | (expected) |
| P Supabase | NOT IMPLEMENTED | (expected) |
| Q Mobile | BLOCKED | YES |
| R CSP/WASM | BLOCKED | YES |
| S Service Worker | PASS (policy) | no |
| T Performance | BLOCKED | yes |
| U Recovery | BLOCKED | yes |
| V Security Testing | BLOCKED | YES |
| W Supply Chain | BLOCKED | YES |
| X Independent Review | BLOCKED | YES |

```text
ARCHITECTURE: GO
IMPLEMENTATION: NO-GO
ENGINE: NO-GO
OVERALL: NO-GO
```

---

## 16. Final Recommendation

enough. does **not** yet have a verifiable basis to safely implement E2EE-2C.
Every P0 gate that can only be closed by external evidence remains open. Do not
begin production E2EE-2C, do not add `@getmaapp/signal-wasm` as a root
dependency, do not merge PR #41. Re-run the environment-dependent gates (C, D,
G, H, Q, T) once a network-enabled Rust environment and real mobile devices are
available, obtain legal counsel (A) and an independent reviewer (F/X), and only
then re-evaluate a separate, explicit implementation approval.

```text
MERGE RECOMMENDATION: DO NOT MERGE
```
