#!/usr/bin/env bash
# compare.sh
#
# Compares a locally built wasm-pack output ("pkg/") against the published
# npm artifact. Prints a per-file SHA-256 table and an EXACT/SEMANTIC verdict
# for the WASM binary.
#
# Usage:
#   bash scripts/fetch-and-hash.sh            # populates cache/
#   bash scripts/compare.sh <path-to-built-pkg>
#
# Requires: sha256sum, diff, and tools/wasm_producers.py (python3).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILT="${1:?usage: compare.sh <path-to-built-pkg>}"
NPM="$ROOT/cache/dist/package"

echo "==> Published npm artifact"
for f in signal_wasm_bg.wasm signal_wasm.js signal_wasm.d.ts; do
  printf '  %-24s %s\n' "$f" "$(sha256sum "$NPM/$f" | cut -d' ' -f1)"
done

echo
echo "==> Locally built artifact"
for f in signal_wasm_bg.wasm signal_wasm.js signal_wasm.d.ts; do
  if [ -f "$BUILT/$f" ]; then
    printf '  %-24s %s\n' "$f" "$(sha256sum "$BUILT/$f" | cut -d' ' -f1)"
  else
    printf '  %-24s <MISSING>\n' "$f"
  fi
done

echo
echo "==> WASM byte comparison"
if cmp -s "$NPM/signal_wasm_bg.wasm" "$BUILT/signal_wasm_bg.wasm"; then
  echo "WASM verdict: EXACT MATCH (byte-identical, sha256 equal)"
else
  echo "WASM verdict: NOT byte-identical"
  echo "  npm size : $(wc -c < "$NPM/signal_wasm_bg.wasm")"
  echo "  built size: $(wc -c < "$BUILT/signal_wasm_bg.wasm")"
  echo
  echo "==> producers section (npm vs built) — toolchain fingerprint"
  echo "-- npm --"
  python3 "$ROOT/tools/wasm_producers.py" "$NPM/signal_wasm_bg.wasm"
  echo "-- built --"
  python3 "$ROOT/tools/wasm_producers.py" "$BUILT/signal_wasm_bg.wasm"
  echo
  echo "If the producers sections match but bytes differ, run wasm-tools diff to"
  echo "inspect build-id / custom-section differences (e.g. wasm-bindgen section hash)."
fi
