# enough. — E2EE-2C-1 WASM Provenance & Reproducible Build Verification

**Status:** supply-chain / reproducibility evidence only — **NO PRODUCTION IMPLEMENTATION**
**Date:** 2026-08-20
**Repository branch:** `arena/01a020e0-enough`
**Repository HEAD at start:** `9b13a73d59c960e91415ba72ef74b8265d71e025` (main, PR #40 / E2EE-2C architecture merged)
**Subject:** `@getmaapp/signal-wasm@0.6.6`
**Isolated experiment:** [`experiments/e2ee-2c-provenance/`](../experiments/e2ee-2c-provenance/)

> **Result: STRONG EVIDENCE, NOT EXACTLY REPRODUCIBLE.** The published npm
> artifact is internally consistent with the source repo at its npm `gitHead`
> and with the pinned libsignal revision, and the WASM binary self-identifies
> its exact toolchain. However, a **byte-exact reproducible build was not
> demonstrated in this phase**: the upstream repo pins no Rust toolchain, no
> build ran (sandbox toolchain unavailable + crates.io/rustup unreachable), and
> the package has **no npm provenance attestation** and **no GitHub release /
> tag for `0.6.6`**. Therefore production use of this package is **not
> approved**.

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

## 7. Git Status

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

---

## 8. Decision

```text
RESULT: STRONG EVIDENCE, NOT EXACTLY REPRODUCIBLE
```

```text
PRODUCTION APPROVAL: NO
```

Even in the hypothetical case of an exact reproducible build, this phase
performs **no production integration**; the next step would be a separate
implementation phase.
