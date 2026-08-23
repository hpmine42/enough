#!/usr/bin/env bash
# build-repro.sh
#
# EXACT reproduction recipe for @getmaapp/signal-wasm@0.6.6.
#
# The published WASM binary self-describes its own toolchain (parsed from the
# WASM "producers" custom section — see tools/wasm_producers.py):
#
#   rustc         1.92.0 (ded5c06cf 2025-12-08)
#   walrus        0.26.4
#   wasm-bindgen  0.2.126 (21ac804a9)
#
# This script reproduces the build given a toolchain that exactly matches.
# It will FAIL FAST if the required toolchain is not present, because a
# byte-exact reproduction REQUIRES these exact versions — any deviation
# changes the binary and the result must be classified as non-EXACT.
#
# Important reproducibility caveats (documented in docs/e2ee-2c-provenance.md):
#   * The upstream repo pins NO rust toolchain (no rust-toolchain.toml, no CI).
#     rustc 1.92.0 is only known because the published binary says so.
#   * Cargo.lock is committed, so all registry/git dependency revisions are
#     pinned (libsignal @ b056faa6d). wasm-bindgen =0.2.126 is exact-pinned.
#   * wasm-pack version is NOT recorded anywhere in the repo or the artifacts.
#
# Usage (in a network-enabled environment):
#   bash scripts/build-repro.sh <path-to-cloned-source-at-gitHead>
#
# The source must be checked out at npm gitHead:
#   0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?usage: build-repro.sh <path-to-source-at-gitHead>}"

echo "==> Toolchain preconditions"
for t in rustup cargo rustc wasm-pack; do
  if ! command -v "$t" >/dev/null 2>&1; then
    echo "ERROR: '$t' not found on PATH."
    echo "       A byte-exact build needs rustc 1.92.0 (ded5c06cf 2025-12-08)."
    echo "       This script only documents the recipe; it cannot build without that exact toolchain."
    exit 2
  fi
done

echo "==> Verify source commit"
HEAD="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)"
EXPECT="0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd"
echo "source HEAD: ${HEAD:-<not a git repo>}"
echo "expected:    $EXPECT"
[ "$HEAD" = "$EXPECT" ] || { echo "ERROR: source not at npm gitHead"; exit 2; }

echo "==> Verify rustc version"
rustc --version
echo "   (must report: rustc 1.92.0 (ded5c06cf 2025-12-08))"

echo "==> Add wasm32 target"
rustup target add wasm32-unknown-unknown

echo "==> Build (mirrors README / npm package.json)"
cd "$SRC"
# .cargo/config.toml already sets:  rustflags = ['--cfg', 'getrandom_backend="wasm_js"']
wasm-pack build --target web --scope getmaapp --release

echo "==> Outputs"
ls -la pkg/
echo
echo "Built artifacts are in <source>/pkg/. Run scripts/compare.sh against them."
echo "Expected npm artifacts to compare (pkg/): signal_wasm_bg.wasm, signal_wasm.js, signal_wasm.d.ts"
