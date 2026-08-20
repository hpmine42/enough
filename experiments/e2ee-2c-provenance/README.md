# enough. — E2EE-2C-1 WASM Provenance & Reproducible Build Experiment

**Status:** isolated supply-chain / reproducibility experiment — **NOT production**
**Date:** 2026-08-20 (E2EE-2C-1b follow-up added)
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
| `package.json` | `npm test` entry (private, zero dependencies). |
| `test/provenance.test.mjs` | Re-fetches the npm artifact, asserts every SHA-256 against `manifest.json`, asserts gitHead + no-provenance. |
| `scripts/fetch-and-hash.sh` | Re-runnable: download the npm tarball, verify integrity, hash every file. |
| `scripts/build-repro.sh` | Exact reproduction recipe (requires the pinned toolchain). |
| `scripts/compare.sh` | Compare a locally built `pkg/` against the published artifact. |
| `scripts/run-all.sh` | Orchestrates everything runnable in this sandbox. |
| `tools/wasm_producers.py` | Dump the WASM `producers` / `target_features` custom sections. |
| `cache/` (git-ignored) | Original npm tarball + extracted files. Never committed. |

## Tests

```bash
npm test          # hash-verify the published artifact against manifest.json
```

## Key result

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
- **Reproducible build (E2EE-2C-1b): BLOCKED BY ENVIRONMENT** — no Rust
  toolchain in this sandbox and none obtainable (rustup/crates.io/GitHub
  release assets all blocked at egress); upstream pins no toolchain and has no
  CI. The build was not executed and is not marked reproducible.
  See `docs/e2ee-2c-provenance.md` §7.

## Build limitation in this sandbox

A byte-exact build **could not be executed here**. Verified by probing:

- No `rustc`/`cargo`/`rustup`/`wasm-pack`/`wasm-tools`/`wasm-opt` is installed
  (no `~/.rustup`, no `~/.cargo`, no toolchain anywhere on the filesystem, no
  cached crates).
- The sandbox egress allow-list permits `github.com`, `registry.npmjs.org`,
  `pypi.org` and `files.pythonhosted.org`, but **blocks**:
  - `static.rust-lang.org` (rust toolchain / rustup distribution) — IPv4
    resolves to `151.101.x` but TLS connection fails (`SSL_ERROR_SYSCALL`);
  - `crates.io`, `index.crates.io`, `static.crates.io` (crate index + .crate
    downloads) — same hard block;
  - `release-assets.githubusercontent.com` / `objects.githubusercontent.com` /
    `raw.githubusercontent.com` (GitHub release assets) — also blocked, so
    even prebuilt `wasm-pack` / `binaryen` binaries are unobtainable;
  - debian mirrors (no `rustc` apt package installable).
- Because the upstream repo pins **no** Rust toolchain and no CI exists, exact
  reproduction also depends on holding the exact `rustc 1.92.0` the published
  binary reports — an upstream reproducibility gap independent of the sandbox.

## Run

```bash
npm test                         # hash-verify published artifact vs manifest
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
