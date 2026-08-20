# enough. — E2EE-2C-1 / E2EE-2C-1b WASM Provenance & Reproducible Build Verification

**Status:** supply-chain / reproducibility evidence only — **NO PRODUCTION IMPLEMENTATION**
**Date:** 2026-08-20 (E2EE-2C-1b reproducible-build attempt added)
**Repository branch:** `arena/01a020e0-enough`
**Repository HEAD at start (E2EE-2C-1):** `9b13a73d59c960e91415ba72ef74b8265d71e025` (main, PR #40)
**PR #41 (E2EE-2C-1):** `bc52aa0dc32f5884581999904ad20191c4c3dbc2`
**Subject:** `@getmaapp/signal-wasm@0.6.6`
**Isolated experiment:** [`experiments/e2ee-2c-provenance/`](../experiments/e2ee-2c-provenance/)

> **Result (E2EE-2C-1): STRONG EVIDENCE, NOT EXACTLY REPRODUCIBLE** — the
> published npm artifact is internally consistent with the source repo at its
> npm `gitHead` and with the pinned libsignal revision, and the WASM binary
> self-identifies its exact toolchain; but no byte-exact build ran and no npm
> provenance / GitHub release exists.
>
> **Result (E2EE-2C-1b): REPRODUCTION BLOCKED BY ENVIRONMENT** — a byte-exact
> build was attempted but could **not be executed**: the verification sandbox
> has no Rust toolchain and cannot obtain one (rustup/crates.io/GitHub release
> assets are hard-blocked at the egress firewall), and the upstream repo pins
> **no** toolchain and has **no CI**. The build was therefore **not** performed
> and must **not** be upgraded to EXACT REPRODUCIBLE.
>
> **Production use of this package is NOT approved. MERGE RECOMMENDATION:
> DO NOT MERGE.**

---

## 1. Provenance

| Field | Value |
|---|---|
| package | `@getmaapp/signal-wasm` |
| version | `0.6.6` |
| npm `gitHead` | `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` |
| npm license | `AGPL-3.0-only` |
| tarball URL | `https://registry.npmjs.org/@getmaapp/signal-wasm/-/signal-wasm-0.6.6.tgz` |
| npm `dist.integrity` | `sha512-cYpzAe+HV1xfiXJ1tfDEvAjNkIsKwQApmFgniWJw/dTonOx4By6NzJ7J5izi+pjvfrn5zuXa0TmcHJ7Y/bLZYg==` |
| npm `dist.shasum` | `62ad482454e62187664bd4f9473f8afac2061b07` |
| file count / unpacked | 6 files / 925,512 bytes |
| npm provenance attestation | **NOT PRESENT** (`provenance` field absent; no `_attestations` in registry metadata) |
| npm package signature | present (sigstore keyid) — this is the standard package **integrity** signature, **not** build provenance |

**Summary:** The package metadata is cleanly attributable to the published
source `gitHead` and to the official libsignal commit `b056faa6d`. But **npm
provenance (SLSA/generator attestation) is absent**, so there is **no
machine-attestation** that the published files were built from the claimed
source.

### Hash Comparison (npm artifact, SHA-256)

| File | Size (B) | SHA-256 |
|---|---:|---|
| tarball `signal-wasm-0.6.6.tgz` | 327,360 | `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` |
| `LICENSE` | 1,174 | `2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091` |
| `README.md` | 15,440 | `6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26` |
| `package.json` | 586 | `677b54900bf2c8fc422e7771efd90d1a5c10b251402c8bcae27d5fd445cddded` |
| `signal_wasm.d.ts` | 32,350 | `32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2` |
| `signal_wasm.js` | 78,213 | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` |
| `signal_wasm_bg.wasm` | 797,749 | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` |

All hashes were independently recomputed in this phase and **match** the values
recorded in the E2EE-2B due-diligence review and in
`experiments/e2ee-2c-provenance/manifest.json`.

---

## 2. Source Revision

Repository: `https://github.com/getmaapp/signal-wasm`

| Check | Result |
|---|---|
| npm `gitHead` `0a5e3cb8…` exists in repo | ✅ yes |
| Commit reachable | ✅ yes (ancestor of `main`; `main` `contains` it) |
| Tag at commit | ❌ no tag points at it |
| GitHub release for `0.6.6` | ❌ not present (releases stop at `v0.2.0`, `Latest`) |
| Git tags in repo | `v0.1.0`, `v0.1.1`, `v0.1.2`, `v0.2.0` only |

**Source ↔ npm consistency (byte-level):**
- npm `README.md` (SHA-256 `6c1b3f…`) is **byte-identical** to repo `README.md` at `gitHead`.
- npm `LICENSE` (SHA-256 `2b87ae…`) is **byte-identical** to repo `LICENSE` at `gitHead`.
- npm `package.json` fields (name `@getmaapp/signal-wasm`, version `0.6.6`, license,
  repository, description, `files`, `main`, `types`, `sideEffects`) exactly match what
  `wasm-pack build --target web --scope getmaapp` produces from this crate.

**libsignal revision used:**
```toml
libsignal-protocol = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
zkgroup           = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
```
`Cargo.lock` at `gitHead` resolves all libsignal crates from
`git+https://github.com/signalapp/libsignal?rev=b056faa6…#b056faa6…` — the
**same commit** as official `@signalapp/libsignal-client@0.101.0` (`b056faa6`).
So the pin is correct and consistent.

**WASM ↔ libsignal strings:** the published `signal_wasm_bg.wasm` embeds
source-path strings of the form
`/Users/me/.cargo/git/checkouts/libsignal-2a193a9867decbc4/b056faa/rust/protocol/src/…`
(corresponds to checkout prefix `b056faa`) and
`…/sparsepostquantumratchet-b58d7f56e3645ccd/fd32048/…` (SPQR ratchet dep), plus
registry paths `…/index.crates.io-1949cf8c6b5b557f/aes-0.9.2/…`, `bytes-1.12.1`,
`block-padding-0.4.2`, `cipher-0.5.2` — all of which are present in the repo's
`Cargo.lock` with matching versions. This **corroborates** but does not *prove*
that the binary came from this exact source and lockfile.

---

## 3. Build Environment

Reconstructed from the WASM `producers` custom section (parsed with
`experiments/e2ee-2c-provenance/tools/wasm_producers.py`):

| Component | Value | How known |
|---|---|---|
| Language | Rust | WASM `producers` |
| **rustc** | **`1.92.0 (ded5c06cf 2025-12-08)`** | WASM `producers` |
| **walrus** | `0.26.4` | WASM `producers` |
| **wasm-bindgen** | `0.2.126 (21ac804a9)` | WASM `producers` (also exact-pinned in `Cargo.toml`) |
| Target | `wasm32-unknown-unknown` | README / `wasm-pack` |
| Cargo | not recorded in artifact; only known via cargo-git checkout path layout | inferred |
| wasm-pack | **not recorded anywhere** | unknown (uncertainty) |
| Build host | macOS (paths `/Users/me/…`) | WASM embedded strings |
| `.cargo/config.toml` rustflags | `--cfg getrandom_backend="wasm_js"` | repo `.cargo/config.toml` |
| Release profile | `lto = true`, `opt-level = "s"`, `debug = 0`, `panic = "abort"` | repo `Cargo.toml` |
| Command | `wasm-pack build --target web --scope getmaapp` | README §Build from Source |

`target_features` in the binary: `mutable-globals`, `nontrapping-fptoint`,
`bulk-memory`, `sign-ext`, `reference-types`, `multivalue`,
`bulk-memory-opt`, `call-indirect-overlong`.

**What is NOT determinable / not pinned:**
- The repo has **no `rust-toolchain.toml`**, **no CI workflow**, and does not
  document a Rust version. The exact rustc (`1.92.0`) is only known because the
  published binary says so — the *source* alone does not pin it.
- **wasm-pack version** and **cargo version** are not recorded in the repo or
  the artifacts.
- Build-time **environment variables** are unknown.
- Because the toolchain is unpinned, the exact build environment is **not fully
  reconstructable from the repository**; it is only *identifiable* from the
  published binary's own fingerprint.

---

## 4. Reproducible Build

### Attempt in this phase

An isolated experiment directory was created
(`experiments/e2ee-2c-provenance/`) with the exact reproduction recipe
(`scripts/build-repro.sh`), a compare harness (`scripts/compare.sh`), and the
artifact hashes (`manifest.json`).

**The build could not be executed in this sandbox.** Reason (verified by
probing): the sandbox network allow-list permits `github.com`,
`registry.npmjs.org` and `pypi.org`, but blocks `static.rust-lang.org`,
`crates.io`, `index.crates.io` and debian mirrors; no `rustc`/`cargo`/
`wasm-pack`/`wasm-tools` is present and none can be installed. Even with cargo
available, `crates.io` is unreachable, so dependencies could not be fetched.

This is an **environmental limitation of the verification sandbox**, not a
failure of the package.

### Classification

Because a byte-exact build did not run in this phase, the phase-level
assessment is:

```text
BUILD NOT REPRODUCIBLE / NOT VERIFIED IN THIS ENVIRONMENT (toolchain unavailable)
```

The four verdicts from the brief map as follows:

| Verdict | Applies here? |
|---|---|
| EXACT MATCH | **No — build not executed; not proven.** |
| SEMANTIC MATCH ONLY | Not assignable without a build. |
| BUILD SUCCEEDED BUT BINARY DIFFERS | Not applicable (no build ran). |
| BUILD NOT REPRODUCIBLE | **Yes for this environment/phase** (toolchain unavailable and unpinned upstream). |

If the build **is** run elsewhere with the exact toolchain (`rustc 1.92.0` +
`wasm-bindgen 0.2.126` + matching walrus), the recipe in
`scripts/build-repro.sh` + `compare.sh` will produce an EXACT / NOT-EXACT
verdict. Key check-points for a future EXACT verdict: identical WASM SHA-256,
identical size, and identical `producers` section. If bytes differ despite the
matching producers fingerprint, run `wasm-tools diff` to inspect the
wasm-bindgen custom-section hash and any build-id / debug / custom-section
differences.

---

## 5. Supply-Chain Evidence

| Evidence item | Status |
|---|---|
| npm provenance attestation | **absent** |
| GitHub Release for `0.6.6` | **absent** (latest release `v0.2.0`) |
| Signed git tag for `0.6.6` | **absent** (no tag at `gitHead`) |
| Source ↔ npm `gitHead` | consistent (commit exists, reachable, on `main`) |
| Source ↔ npm README/LICENSE | **byte-identical** |
| Source ↔ npm `package.json` | consistent with wasm-pack output |
| WASM ↔ libsignal `b056faa6d` | corroborated by embedded source-path strings |
| Cargo.lock ↔ libsignal rev | pinned to `b056faa6d` (matches official v0.101.0) |
| Cargo.lock ↔ WASM dep versions | match (aes 0.9.2, bytes 1.12.1, block-padding 0.4.2, cipher 0.5.2, libcrux-ml-kem 0.0.10, getrandom 0.2.17/0.3.4/0.4.3) |
| npm package signature | present (integrity only, not provenance) |

**Net:** the evidence strongly indicates the npm artifact was built from the
published source at the claimed commit and pinned libsignal revision, on macOS,
with `rustc 1.92.0` / `wasm-bindgen 0.2.126`. But it is **circumstantial
(observational), not machine-attested** — no SLSA provenance, no release, no
tag, no recorded CI.

---

## 6. Security Assessment

**Q: Does the evidence suffice to treat the npm artifact as trustworthy?**

**No — not yet.** What we have is strong *consistency* evidence (source ↔
artifact ↔ libsignal pin), but the two open process blockers named in E2EE-2B
/ E2EE-2C remain exactly where they were:

1. **No npm provenance attestation** → no trusted, non-repudiable statement
   that this binary was built from this source.
2. **No demonstrated byte-exact reproducible build** → binary could not be
   rebuilt and byte-compared in this phase (toolchain unavailable here; and
   upstream pins no toolchain at all).

**Remaining uncertainty:**
- The exact build was **not reproduced**; any divergence (e.g. compiler
  behavior differences, wasm-bindgen section hash, build-id) is unmeasured.
- **wasm-pack version and cargo version are unknown/unpinned.**
- The toolchain is **not pinned upstream**, so reproducibility is fragile and
  depends on someone guessing/holding the exact `rustc 1.92.0`.
- The build host paths (`/Users/me/…`) show a **personal, non-CI build** with no
  release record (no tag/release for `0.6.6`).
- No independent third-party security audit of this wrapper (upstream
  `SECURITY_AUDIT_REPORT.md` is for old `0.1.1`).

**What must happen before production use of this package in `enough.`:**
1. Add npm **provenance** to the publishing process (reproducible release via
   `npm` `--provenance` / GitHub Actions), or otherwise machine-attest the build.
2. **Pin the toolchain** (add `rust-toolchain.toml`, record wasm-pack/cargo
   versions) and provide a **CI build**.
3. Demonstrate a **byte-exact reproducible build** of the published WASM from
   source (`rustc 1.92.0` + `wasm-bindgen 0.2.126`, target
   `wasm32-unknown-unknown`, release profile) and compare SHA-256/size with the
   published binary.
4. Create a matching **GitHub tag + release** for the npm version.
5. Independent security/crypto review of the wrapper and its storage/lifecycle
   integration (already required by E2EE-2B/2C).
6. Legal review of AGPL-3.0-only (wrapper + libsignal) for the browser app.

---

## 7. E2EE-2C-1b follow-up — Reproducible Build Attempt

This section records the dedicated byte-exact reproducible-build attempt
(E2EE-2C-1b) run against the exact pinned source commit. It did **not** change
the security assessment; it confirms that the build is **blocked in the
verification environment** and additionally quantifies the upstream
reproducibility gaps.

### 7.1 Exact source commit

```text
repository : https://github.com/getmaapp/signal-wasm
commit     : 0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd
short      : 0a5e3cb8
date       : 2026-08-19 08:40:13 +0100
author     : 庄稼 <jia@thecannabis.app>
subject    : feat: re-pin to libsignal v0.101.0 (b056faa6d), add retry-protocol primitives
parent     : a253fbcc6b91678a65d3817f980ef6fcd0cfcbe9
tree       : fb1bdbb84ad52fd8a1cb1309deb0998672222942
tags       : none (0 tags point at this commit)
reachable  : yes — verified `git merge-base --is-ancestor <sha> main` → ancestor of main
```

`git rev-parse 0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` returns the commit
unchanged; the commit is **unmodified and reachable** from `main`.

### 7.2 Original npm artifact saved & hash-checked

The original tarball was saved in the isolated experiment at
`experiments/e2ee-2c-provenance/cache/signal-wasm-0.6.6.tgz` (git-ignored) and
re-verified. All hashes **match** the values recorded in PR #41
(`docs/e2ee-2c-provenance.md` §1 and `manifest.json`). **No ARTIFACT MISMATCH.**
`experiments/e2ee-2c-provenance/test/provenance.test.mjs` re-fetches from the
registry and asserts these hashes automatically (`npm test`, 3/3 pass).

### 7.3 Toolchain determination

Investigated `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`,
`.github/workflows/**`, `rust-toolchain*`, `Makefile`, build scripts, README,
and GitHub release automation in the source repo:

| Component | Determined? | Value / evidence |
|---|---|---|
| rustc | exact | `1.92.0 (ded5c06cf 2025-12-08)` — from WASM `producers` section (not from repo) |
| walrus | exact | `0.26.4` — WASM `producers` |
| wasm-bindgen | exact | `0.2.126 (21ac804a9)` — WASM `producers` + `Cargo.toml` `=0.2.126` |
| target | exact | `wasm32-unknown-unknown` |
| cargo | **UNKNOWN** | not recorded in repo or artifact |
| wasm-pack | **UNKNOWN** | not recorded in repo or artifact; README only says `cargo install wasm-pack` |
| clang/LLVM | **UNKNOWN** | no reference anywhere; not needed for `wasm32-unknown-unknown` core build |
| Node.js / npm | **UNKNOWN** | not recorded; only `wasm-pack`-generated glue depends on target runtime, not build version |
| release profile | exact | `lto=true`, `opt-level="s"`, `debug=0`, `panic="abort"` (`Cargo.toml`) |
| rustflags | exact | `--cfg getrandom_backend="wasm_js"` (`.cargo/config.toml`) |
| `SOURCE_DATE_EPOCH` / `CARGO_PROFILE_RELEASE` | **UNKNOWN / not set in repo** | no CI, no script sets them |
| build host | inferred | macOS (`/Users/me/…` embedded paths) |

No `rust-toolchain` / `rust-toolchain.toml` file exists upstream. There is **no
CI** (no `.github/`, no Makefile, no build/release scripts) — only an example
GitHub Actions step for *tests* in `TESTING_PLAN.md`. Toolchain versions not
recorded are reported as **UNKNOWN** (not guessed).

### 7.4 Build attempt & offline/cache behaviour

A full build was attempted via the recipe in
`experiments/e2ee-2c-provenance/scripts/build-repro.sh`
(`rustup target add wasm32-unknown-unknown; wasm-pack build --target web
--scope getmaapp --release`) from the exact commit. It could **not** run:

- **No toolchain present:** `rustup`, `cargo`, `rustc`, `wasm-pack`,
  `wasm-tools`, `wasm-opt` all absent; no `~/.rustup`, no `~/.cargo`, no cached
  crates anywhere on the filesystem.
- **No toolchain obtainable (verified egress):**
  - `static.rust-lang.org` — required to install the Rust toolchain. IPv4
    resolves (`151.101.x`) but TLS fails (`SSL_ERROR_SYSCALL`); HTTP also 000.
  - `crates.io`, `index.crates.io`, `static.crates.io` — required for `Cargo.lock`
    dependency downloads. All hard-blocked (000).
  - `release-assets.githubusercontent.com`, `objects.githubusercontent.com`,
    `raw.githubusercontent.com` — GitHub release assets (prebuilt `wasm-pack`,
    `binaryen`/`wasm-opt`). Blocked; a `binaryen` release asset redirect failed
    on TLS to `release-assets.githubusercontent.com`.
  - debian mirrors — no `rustc` apt install possible.
  - Reachable: `github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`
    — none of these can supply a Rust toolchain or crates.
- **No local crate cache:** documented above; there is nothing to build offline
  from.

Because the build never executed, **nothing is claimed to be reproducible**.
`experiments/e2ee-2c-provenance/scripts/run-all.sh` reproduces this
verification and reports the same toolchain-availability state.

### 7.5 Hash comparison

Only the published-artifact comparison is applicable (no build output exists):

| Item | This phase (re-fetch) | PR #41 recorded | Match |
|---|---:|---:|---|
| tarball `signal-wasm-0.6.6.tgz` | `c3e0d6cd…e3082` | `c3e0d6cd…e3082` | ✅ |
| `signal_wasm_bg.wasm` | `71b456b8…d6c1` | `71b456b8…d6c1` | ✅ |
| `signal_wasm.js` | `c72af7ae…83410` | `c72af7ae…83410` | ✅ |
| `signal_wasm.d.ts` | `32441be5…7f2` | `32441be5…7f2` | ✅ |
| `README.md` | `6c1b3f94…2fe26` | `6c1b3f94…2fe26` | ✅ |
| `LICENSE` | `2b87ae92…5f091` | `2b87ae92…5f091` | ✅ |

A build-vs-npm WASM byte comparison (**Build #1 / Build #2 vs npm**) could not be
performed because no build ran.

### 7.6 Second build / absolute-path & metadata analysis

- **Build #2 (second independent build):** not applicable — build #1 never ran.
- **Absolute paths:** the published WASM embeds `/Users/me/.cargo/…` source
  paths (macOS personal build). This is observational evidence only; it does
  not by itself prove or disprove reproducibility.
- **Build-metadata non-determinism:** the WASM `producers`/`target_features`
  sections and the wasm-bindgen glue already carry toolchain metadata. Whether a
  rebuild would differ only in metadata (e.g. wasm-bindgen section hash) or in
  code is **unmeasured** because no rebuild ran. This is the exact question a
  future build in a network-enabled environment with `rustc 1.92.0` must answer
  (recipe + compare in the experiment).

### 7.7 CI / release supply chain

1. **Automated release build?** No. No `.github/`, no CI of any provider in the source repo.
2. **Reproducible CI build?** No. There is no CI at all; only a *test-runner* example in `TESTING_PLAN.md`.
3. **npm published from CI?** No — no CI; the embedded `/Users/me/…` paths indicate a personal build host.
4. **npm provenance?** No (re-checked 2026-08-20: no `provenance` field, no `_attestations`).
5. **Signed releases?** No GitHub release for `0.6.6`; git tags/releases stop at `v0.2.0`.
6. **Release checksums?** npm `dist.shasum`/`dist.integrity` exist (npm-generated); no independent release checksum.
7. **Verifiable `git commit → CI → WASM → npm` chain?** **No** — the CI link is missing entirely.

### 7.8 Provenance re-check

Re-checked the npm registry for `@getmaapp/signal-wasm@0.6.6` on 2026-08-20:
**NO PROVENANCE** (no `provenance` field on the version, no `_attestations` at
top level). This is recorded as a finding, not as an investigation error.

---

## 8. Git Status

| Item | State |
|---|---|
| Working tree changes (this phase) | `docs/e2ee-2c-provenance.md`, `experiments/e2ee-2c-provenance/**`, `.gitignore` (ignore experiment `cache/`) |
| Production files changed (`src/`, `supabase/`, message path) | **none** |
| Root dependency added | **none** |
| Merged | **not merged** (PR open only) |

Tests run in this phase (main repo):
- `npm run test:crypto` → **87/87 pass**
- `npm run build` → success (tsc + vite build)
- `npm run smoke` → **all smoke tests passed**
- `git diff --check` → clean (no whitespace errors)
- experiment `npm test` (`experiments/e2ee-2c-provenance`) → **3/3 pass**
  (published-artifact hash verification against `manifest.json`)

---

## 9. Decision

```text
RESULT: REPRODUCTION BLOCKED BY ENVIRONMENT
```

```text
PRODUCTION APPROVAL: NO
```

```text
MERGE RECOMMENDATION: DO NOT MERGE
```

Not upgraded to `EXACT REPRODUCIBLE` (per phase rules, Fall D must not be
promoted). Even in the hypothetical case of an exact reproducible build, this
phase performs **no production integration**; the next step would be a separate
implementation phase.
