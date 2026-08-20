# enough. — E2EE-2C-1 WASM Provenance & Reproducible Build Experiment

**Status:** isolated supply-chain / reproducibility experiment — **NOT production**
**Date:** 2026-08-20
**Parent document:** [`docs/e2ee-2c-provenance.md`](../../docs/e2ee-2c-provenance.md)
**Subject:** `@getmaapp/signal-wasm@0.6.6`

This isolated experiment gathers **supply-chain and reproducibility evidence**
for the published npm artifact of `@getmaapp/signal-wasm@0.6.6`. It does **not**
integrate the package, does not touch `src/`, `supabase/`, or the message path,
and adds **no dependency** to `enough.`.

## What is here

| Path | Purpose |
|---|---|
| `manifest.json` | Recorded hashes, npm metadata, source revision, toolchain fingerprint. |
| `scripts/fetch-and-hash.sh` | Re-runnable: download the npm tarball, verify integrity, hash every file. |
| `scripts/build-repro.sh` | Exact reproduction recipe (requires the pinned toolchain). |
| `scripts/compare.sh` | Compare a locally built `pkg/` against the published artifact. |
| `scripts/run-all.sh` | Orchestrates everything runnable in this sandbox. |
| `tools/wasm_producers.py` | Dump the WASM `producers` / `target_features` custom sections. |
| `cache/` (git-ignored) | Downloaded npm tarball + extracted files. Never committed. |

## Key result

- The WASM binary **self-describes its toolchain** in its `producers` custom
  section:
  - `rustc 1.92.0 (ded5c06cf 2025-12-08)`
  - `walrus 0.26.4`
  - `wasm-bindgen 0.2.126 (21ac804a9)`
- The npm README and LICENSE are **byte-identical** to the source repo at npm
  `gitHead` (`0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd`).
- WASM source-path strings corroborate a libsignal git checkout at revision
  `b056faa` (matching `Cargo.toml`/`Cargo.lock`), built on macOS.
- **npm provenance attestation is absent.**

## Build limitation in this sandbox

A byte-exact build **could not be executed here**: the sandbox network
allow-list permits `github.com`, `registry.npmjs.org` and `pypi.org`, but blocks
`static.rust-lang.org`, `crates.io` and `index.crates.io` (and debian mirrors).
No Rust/wasm-pack toolchain is present and none can be installed. Because the
upstream repo pins **no** Rust toolchain, exact reproduction additionally
depends on using the exact `rustc 1.92.0` the published binary reports — so the
reproduction must be run elsewhere with that exact toolchain.

## Run

```bash
bash scripts/run-all.sh          # fetch+hash npm artifact, report toolchain state
bash scripts/fetch-and-hash.sh   # just the download + hashing
python3 tools/wasm_producers.py cache/dist/package/signal_wasm_bg.wasm
```

In a network-enabled environment with the pinned toolchain:

```bash
git clone --no-checkout https://github.com/getmaapp/signal-wasm.git src
git -C src checkout --detach 0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd
bash scripts/build-repro.sh "$(pwd)/src"
bash scripts/compare.sh src/pkg
```

## Isolation rules honoured

- No import from `src/`; no import into `src/`.
- No `@getmaapp/signal-wasm` dependency added anywhere.
- No Supabase, no network calls from production code.
- No production bundle; the built artifact comparison only ever runs on the
  `cache/` copy and the experiment `pkg/` output.
