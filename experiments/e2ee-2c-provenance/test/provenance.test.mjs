// provenance.test.mjs
//
// Reproducibility experiment test: verifies that the published npm artifact
// @getmaapp/signal-wasm@0.6.6, freshly fetched from the npm registry, matches
// the SHA-256 hashes recorded in ../manifest.json (and docs/e2ee-2c-provenance.md,
// PR #41). Any deviation fails the test as an ARTIFACT MISMATCH.
//
// Requires: Node >= 18 (global fetch), network to registry.npmjs.org only.
// The tarball is cached in ../cache/ (git-ignored).
//
// Run:  npm test   (from experiments/e2ee-2c-provenance)
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXP = path.join(ROOT, '..');
const CACHE = path.join(EXP, 'cache');
const DIST = path.join(CACHE, 'dist');
const TARBALL = path.join(CACHE, 'signal-wasm-0.6.6.tgz');
const TARBALL_URL =
  'https://registry.npmjs.org/@getmaapp/signal-wasm/-/signal-wasm-0.6.6.tgz';

const manifest = JSON.parse(readFileSync(path.join(EXP, 'manifest.json'), 'utf8'));

const FILES = [
  'LICENSE',
  'README.md',
  'package.json',
  'signal_wasm.d.ts',
  'signal_wasm.js',
  'signal_wasm_bg.wasm',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function ensureTarball() {
  if (existsSync(TARBALL)) return;
  mkdirSync(CACHE, { recursive: true });
  const res = await fetch(TARBALL_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(TARBALL));
}

test('download & pin npm artifact 0.6.6 (tarball)', async () => {
  await ensureTarball();
  const hash = sha256(readFileSync(TARBALL));
  const expected =
    manifest.artifact_hashes_sha256['tarball_signal-wasm-0.6.6.tgz'];
  assert.equal(hash, expected,
    `ARTIFACT MISMATCH: tarball sha256 ${hash} != expected ${expected}`);
  console.log(`  tarball ok (${hash})`);
});

test('extract & verify every package file hash', async () => {
  await ensureTarball();
  await rm(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  execFileSync('tar', ['-xzf', TARBALL, '-C', DIST], { stdio: 'ignore' });

  for (const f of FILES) {
    const hash = sha256(readFileSync(path.join(DIST, 'package', f)));
    const expected = manifest.artifact_hashes_sha256[f];
    assert.equal(hash, expected,
      `ARTIFACT MISMATCH: ${f} sha256 ${hash} != expected ${expected}`);
    console.log(`  ${f} ok (${hash})`);
  }
});

test('npm metadata: gitHead matches manifest, provenance absent', async () => {
  const res = await fetch('https://registry.npmjs.org/@getmaapp/signal-wasm');
  const reg = await res.json();
  const v = reg.versions['0.6.6'];
  assert.equal(v.version, '0.6.6');
  assert.equal(v.gitHead, manifest.npm.gitHead);
  assert.equal('provenance' in v, false, 'provenance field must be absent');
  assert.equal('_attestations' in reg, false, '_attestations must be absent');
});
