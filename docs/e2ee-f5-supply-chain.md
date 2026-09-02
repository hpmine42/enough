# enough. — F5: Supply-chain hardening for `@getmaapp/signal-wasm@0.6.6`

**Status:** implemented (CI hash assert, option A) — vendoring evaluated and rejected
**Date:** 2026-08-24
**Scope:** exclusively supply-chain verification of the WASM/crypto artifacts.
No change to E2EE architecture, engine adapter, session manager, protocol,
schema, RLS, or tests.

---

## 1. Audit finding F5

> Vendoring of the WASM artifacts and/or a CI hash assert against the known
> provenance values is missing.

Previous protection: npm lockfile + exact dependency version (`0.6.6`) +
documented artifact hashes (`docs/e2ee-2c-provenance.md`,
`experiments/e2ee-2c-provenance/manifest.json`) — but **no machine check**
of those hashes.

## 2. Inventory (phase 1, 2026-08-24)

| Question | Finding |
|---|---|
| Which WASM files are used? | `signal_wasm_bg.wasm` (797,749 B, the executed crypto core) and `signal_wasm.js` (78,213 B, wasm-bindgen glue). Plus `signal_wasm.d.ts` (types only) and `LICENSE`/`README.md`/`package.json` (not executable). |
| Where do they come from? | npm tarball `https://registry.npmjs.org/@getmaapp/signal-wasm/-/signal-wasm-0.6.6.tgz`; npm publication **without** a provenance attestation (documented in `docs/e2ee-2c-provenance.md`). |
| Loaded directly from npm or via the bundle? | Both: the browser loads the Vite-emitted `dist/assets/signal_wasm_bg-*.wasm` at runtime; Vite copies that file **byte-identically** (proven in this phase by hash comparison). `signal_wasm.js` is bundled/transformed by Vite (hash after bundling is not stable). Node tests load `signal_wasm_bg.wasm` via `initSync` directly from `node_modules`. |
| Which files must be checked? | All 6 files in the package (full coverage; matches the audited manifest). |
| Are the documented hashes still exactly reproducible? | **Yes.** Fresh `npm ci` on 2026-08-24: all 6 SHA-256 values from `docs/e2ee-2c-provenance.md` §1 match the installed files byte-for-byte. |
| Is a CI hash assert deterministically possible? | **Yes.** Pure filesystem check against `npm ci`-installed artifacts; no extra network, no secrets, Node builtins (`node:crypto`). |

## 3. Decision: option A (CI hash assert), no vendoring

Vendoring was evaluated and **rejected**:

- `npm ci` already cryptographically verifies the tarball sha512 against the
  lockfile. The hash assert additionally covers any change to the **unpacked,
  actually used files** — including after installation. Vendoring therefore
  adds no extra integrity benefit.
- Vendoring would require invasive changes: the only production module that
  imports `@getmaapp/signal-wasm` is `src/lib/e2ee/engine-adapter.ts`
  (intentionally frozen). A vendored artifact would have to change either
  dependency resolution (`file:` dependency) or the load layer — both are
  out of scope for F5 (no custom crypto/WASM load layer, no architecture
  change).
- Vendoring would put ~1 MB of binaries in the repository, with drift risk
  (repo vs npm) on every version bump.
- The only real extra benefit of vendoring would be **availability**
  (protection against unpublish/registry outage), not integrity — not the
  subject of F5.

## 4. Implementation

- **`scripts/verify-signal-wasm.mjs`** (npm script `verify:signal-wasm`):
  1. `package.json` pins `@getmaapp/signal-wasm` exactly to `0.6.6` (no range operator).
  2. `package-lock.json`: version, tarball URL and sha512 integrity match the audited state.
  3. The installed package identifies itself as `@getmaapp/signal-wasm@0.6.6`.
  4. The package directory contains **exactly** the 6 audited files (nothing missing, nothing extra).
  5. SHA-256 of each file == audited manifest value.
  6. If `dist/` exists: exactly one `signal_wasm_bg-*.wasm` asset and byte-identical with the audited WASM.
- **`.github/workflows/deploy.yml`**: step “Verify signal-wasm artifacts (F5)”
  immediately after `npm ci`, **before** build, all tests, and the Pages deploy.
  A non-zero exit code aborts the workflow; a hash mismatch prevents deployment.
  Existing F4 (test gate) and F3 (live Postgres) steps remain unchanged.

### Checked SHA-256 values (source: `docs/e2ee-2c-provenance.md` §1; independently recomputed and confirmed on 2026-08-24 from a fresh `npm ci`)

| File | SHA-256 |
|---|---|
| `signal_wasm_bg.wasm` | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` |
| `signal_wasm.js` | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` |
| `signal_wasm.d.ts` | `32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2` |
| `package.json` | `677b54900bf2c8fc422e7771efd90d1a5c10b251402c8bcae27d5fd445cddded` |
| `README.md` | `6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26` |
| `LICENSE` | `2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091` |

## 5. What the check guarantees — and what it does not

**Guaranteed:**
- The lockfile pins the dependency version exactly (`0.6.6`, no range).
- npm integrity: `npm ci` verifies the tarball sha512 against the lockfile.
- The CI hash assert detects any unexpected change to the installed
  artifacts (substitution at publish time, manipulation after install,
  unexpected extra files) and any deviation from lockfile/manifest.
- The shipped `dist` WASM (when built) is byte-identical with the audited artifact.

**Not guaranteed:**
- **No proven reproducible build.** The upstream repository does not pin a
  toolchain and has no CI; a byte-exact rebuild was never executed (see
  `docs/e2ee-2c-provenance.md` §4/§7: “REPRODUCTION BLOCKED BY ENVIRONMENT”).
  The repository is therefore **not** “fully reproducible”.
- **The npm supply chain is not fully secured.** The source remains the
  npm-registry tarball without a provenance attestation. The check pins the
  *known audited bytes* — it cannot prove those bytes were built correctly
  from the upstream source.
- A compromised CI runner (after the verifier step) is not covered by the
  check; that is outside the scope of static artifact verification.

## 6. Negative test (2026-08-24, fully restored)

1. `signal_wasm_bg.wasm` in `node_modules` altered by 1 byte → `npm run verify:signal-wasm` → **FAIL** (SHA-256 mismatch, exit code 1).
2. Artifact restored byte-exactly (SHA-256 checked) → **PASS** (exit code 0).
3. Additionally: sha512 integrity in `package-lock.json` corrupted → **FAIL**; lockfile restored (SHA-256 checked) → **PASS**.

No production artifact and no dependency was left permanently changed.

## 7. Maintenance on a legitimate version bump

On a deliberate upgrade of `@getmaapp/signal-wasm`, **all of the following
must be updated together**: `package.json`, `package-lock.json`, and the
manifest values in `scripts/verify-signal-wasm.mjs` (see comments there on
hash origin). The new hash must be taken from the actually installed files
first, not copied from third-party sources, and the provenance of the new
version must be re-evaluated as described in `docs/e2ee-2c-provenance.md`.
