#!/usr/bin/env bash
# run-all.sh — orchestrates the provenance experiment.
#
# In THIS sandbox (network allowlist blocks static.rust-lang.org, crates.io,
# index.crates.io, debian mirrors) the Rust/wasm-pack toolchain cannot be
# installed, so the byte-exact build step is NOT runnable here. This script
# therefore runs everything that IS runnable and clearly reports the build
# step as blocked.
#
#   bash scripts/run-all.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=============================================="
echo " 1. fetch & hash the published npm artifact"
echo "=============================================="
bash scripts/fetch-and-hash.sh

echo
echo "=============================================="
echo " 2. toolchain availability check (build step)"
echo "=============================================="
MISSING=0
for t in rustup cargo rustc wasm-pack wasm-tools; do
  if command -v "$t" >/dev/null 2>&1; then
    echo "  present: $t ($($t --version 2>&1 | head -1))"
  else
    echo "  MISSING: $t"
    MISSING=1
  fi
done
if [ "$MISSING" = 1 ]; then
  echo
  echo "  >>> Build step BLOCKED in this sandbox: rust toolchain + crates.io are"
  echo "      unreachable. A byte-exact build needs rustc 1.92.0 (2025-12-08)."
  echo "      See scripts/build-repro.sh for the exact recipe."
fi

echo
echo "  Done. Reproducibility verdict is documented in docs/e2ee-2c-provenance.md."
