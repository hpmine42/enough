#!/usr/bin/env bash
# fetch-and-hash.sh
#
# Downloads the published npm artifact @getmaapp/signal-wasm@0.6.6, verifies
# its integrity, and prints a SHA-256 hash manifest for every file in the
# tarball. This is the re-runnable basis for the provenance comparison in
# docs/e2ee-2c-provenance.md.
#
# Usage:  bash scripts/fetch-and-hash.sh
#
# Requires: curl, sha256sum, tar, node (for the registry metadata check).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/cache"
PKG="@getmaapp/signal-wasm"
VER="0.6.6"
TARBALL="$CACHE/signal-wasm-${VER}.tgz"
DIST="$CACHE/dist"

mkdir -p "$CACHE" "$DIST"

echo "==> npm registry metadata ($PKG@$VER)"
node -e '
  const v = process.argv[1];
  fetch("https://registry.npmjs.org/@getmaapp/signal-wasm")
    .then(r => r.json())
    .then(d => {
      const x = d.versions[v];
      console.log(JSON.stringify({
        version: x.version,
        gitHead: x.gitHead,
        dist: x.dist,
        provenance: ("provenance" in x),
        hasAttestations: ("_attestations" in d),
      }, null, 2));
    });
' "$VER"

echo
echo "==> Downloading tarball from registry"
curl -fsSL -o "$TARBALL" \
  "https://registry.npmjs.org/@getmaapp/signal-wasm/-/signal-wasm-${VER}.tgz"

echo
echo "==> Tarball SHA-256"
sha256sum "$TARBALL"
echo "Expected: c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082"

echo
echo "==> Extracting"
rm -rf "$DIST"
mkdir -p "$DIST"
tar -xzf "$TARBALL" -C "$DIST"

echo
echo "==> Per-file SHA-256"
cd "$DIST/package"
sha256sum LICENSE README.md package.json signal_wasm.d.ts signal_wasm.js signal_wasm_bg.wasm
echo
echo "==> Per-file sizes"
wc -c LICENSE README.md package.json signal_wasm.d.ts signal_wasm.js signal_wasm_bg.wasm
