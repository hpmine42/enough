#!/usr/bin/env node
/**
 * F5 — Supply-chain hash assertion for `@getmaapp/signal-wasm@0.6.6`.
 *
 * Verifies, byte-exactly, the WASM/crypto artifacts that the app actually
 * executes, against the audited SHA-256 manifest recorded in
 * `docs/e2ee-2c-provenance.md` (§1) and `experiments/e2ee-2c-provenance/
 * manifest.json`. See `docs/e2ee-f5-supply-chain.md` for scope and limits.
 *
 * What this check DOES guarantee:
 *   - the dependency is pinned to exactly 0.6.6 (no range) in package.json
 *   - the lockfile still references the audited tarball URL + sha512 integrity
 *   - every file of the installed package is byte-identical to the audited
 *     artifact (any substitution or post-install tampering fails the check)
 *   - if a `dist/` build exists, the shipped wasm asset is the same byte
 *     sequence (Vite copies it verbatim; the JS glue is bundled/transformed
 *     and therefore not hashable after bundling)
 *
 * What this check does NOT guarantee (see docs/e2ee-f5-supply-chain.md):
 *   - it does not prove a reproducible upstream build of the WASM
 *   - it does not remove trust in the npm registry as the source: it pins
 *     WHAT the audited bytes are, relative to the lockfile+manifest
 *   - it is no substitute for npm's own integrity verification, it layers on
 *     top of it (npm ci already enforces the sha512 integrity at install)
 *
 * Semantics: read-only filesystem checks, no network, no secrets.
 * Exit code 0 = all checks passed; exit code 1 = at least one mismatch.
 *
 * Run:  npm run verify:signal-wasm   (after npm ci)
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Audited manifest — source: docs/e2ee-2c-provenance.md §1            */
/* ------------------------------------------------------------------ */

const PKG = '@getmaapp/signal-wasm';
const VERSION = '0.6.6';
const TARBALL_URL = `https://registry.npmjs.org/@getmaapp/signal-wasm/-/signal-wasm-${VERSION}.tgz`;
// sha512 integrity as recorded in package-lock.json and in the npm registry
// metadata at audit time (docs/e2ee-2c-provenance.md §1).
const LOCKFILE_INTEGRITY =
  'sha512-cYpzAe+HV1xfiXJ1tfDEvAjNkIsKwQApmFgniWJw/dTonOx4By6NzJ7J5izi+pjvfrn5zuXa0TmcHJ7Y/bLZYg==';
// SHA-256 of every file contained in the published tarball. Independently
// recomputed from a fresh `npm ci` install on 2026-08-24 (F5 phase 1).
const EXPECTED_SHA256 = {
  'LICENSE': '2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091',
  'README.md': '6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26',
  'package.json': '677b54900bf2c8fc422e7771efd90d1a5c10b251402c8bcae27d5fd445cddded',
  'signal_wasm.d.ts': '32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2',
  'signal_wasm.js': 'c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410',
  'signal_wasm_bg.wasm': '71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1',
};

/* ------------------------------------------------------------------ */
/* Check machinery                                                     */
/* ------------------------------------------------------------------ */

const failures = [];

function ok(msg) {
  console.log(`  PASS ${msg}`);
}

function fail(msg) {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

console.log(`F5 supply-chain verification: ${PKG}@${VERSION}`);

/* 1. Root package.json: exact version pin (no range operators). */
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const spec = pkg.dependencies?.[PKG];
  if (spec === VERSION) {
    ok(`package.json pins ${PKG} exactly to ${VERSION}`);
  } else {
    fail(`package.json dependency spec is ${JSON.stringify(spec)}, expected exact "${VERSION}"`);
  }
}

/* 2. package-lock.json: version, tarball URL, sha512 integrity. */
{
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${PKG}`];
  if (!entry) {
    fail(`package-lock.json has no entry for node_modules/${PKG}`);
  } else {
    if (entry.version === VERSION) {
      ok(`lockfile version is ${VERSION}`);
    } else {
      fail(`lockfile version is ${JSON.stringify(entry.version)}, expected "${VERSION}"`);
    }
    if (entry.resolved === TARBALL_URL) {
      ok('lockfile resolved tarball URL matches the audited registry URL');
    } else {
      fail(`lockfile resolved URL is ${JSON.stringify(entry.resolved)}, expected ${TARBALL_URL}`);
    }
    if (entry.integrity === LOCKFILE_INTEGRITY) {
      ok('lockfile sha512 integrity matches the audited value (npm ci enforces it at install)');
    } else {
      fail(`lockfile integrity is ${JSON.stringify(entry.integrity)}, expected ${LOCKFILE_INTEGRITY}`);
    }
  }
}

/* 3. Installed package: identity + byte-exact file hashes. */
const pkgDir = join(root, 'node_modules', '@getmaapp', 'signal-wasm');
if (!existsSync(pkgDir)) {
  fail(`installed package not found at ${pkgDir} — run "npm ci" first`);
} else {
  const installed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  if (installed.name === PKG && installed.version === VERSION) {
    ok(`installed package identifies as ${PKG}@${VERSION}`);
  } else {
    fail(`installed package identifies as ${installed.name}@${installed.version}, expected ${PKG}@${VERSION}`);
  }

  // The package directory must contain exactly the audited files — nothing
  // missing, nothing extra.
  const actual = new Set(readdirSync(pkgDir).filter((f) => f !== '.bin'));
  const expected = new Set(Object.keys(EXPECTED_SHA256));
  for (const f of expected) {
    if (!actual.has(f)) fail(`installed package is missing audited file: ${f}`);
  }
  for (const f of actual) {
    if (!expected.has(f)) fail(`installed package contains unexpected extra file: ${f}`);
  }

  for (const [file, expectedHash] of Object.entries(EXPECTED_SHA256)) {
    const path = join(pkgDir, file);
    if (!existsSync(path)) continue; // already reported as missing above
    const hash = sha256(path);
    if (hash === expectedHash) {
      ok(`${file} SHA-256 ${hash}`);
    } else {
      fail(`${file} SHA-256 mismatch: got ${hash}, expected ${expectedHash}`);
    }
  }
}

/* 4. Shipped artifact (only when a build exists): Vite emits the wasm as a
      static asset; it must be byte-identical to the audited module. The JS
      glue is bundled/transformed and intentionally not checked here. */
{
  const distAssets = join(root, 'dist', 'assets');
  if (!existsSync(distAssets)) {
    console.log('  INFO dist/ not present — shipped-artifact check skipped (run after a build to include it)');
  } else {
    const wasmAssets = readdirSync(distAssets).filter((f) => /^signal_wasm_bg-.*\.wasm$/.test(f));
    if (wasmAssets.length !== 1) {
      fail(`expected exactly one signal_wasm_bg-*.wasm asset in dist/assets, found ${wasmAssets.length}`);
    } else {
      const hash = sha256(join(distAssets, wasmAssets[0]));
      if (hash === EXPECTED_SHA256['signal_wasm_bg.wasm']) {
        ok(`dist/assets/${wasmAssets[0]} is byte-identical to the audited signal_wasm_bg.wasm`);
      } else {
        fail(`dist/assets/${wasmAssets[0]} SHA-256 mismatch: got ${hash}, expected ${EXPECTED_SHA256['signal_wasm_bg.wasm']}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`\nF5 VERIFY FAILED: ${failures.length} check(s) failed — refusing build/deploy.`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nF5 VERIFY PASSED: signal-wasm artifacts match the audited manifest.');
