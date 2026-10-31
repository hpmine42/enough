#!/usr/bin/env node
/**
 * enough. — run every `test:*` script discovered in package.json.
 *
 * Mirrors the CI discovery logic so `npm test` locally runs the same suites as
 * the pull-request gate. Suites run sequentially; failures are collected and
 * reported at the end (one failing suite does not stop the rest).
 *
 * Usage:  npm test            (all suites, no smoke)
 *         npm test -- --smoke (all suites + smoke test)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const includeSmoke = process.argv.includes('--smoke');

const suites = Object.keys(pkg.scripts || {})
  // `test:smoke` is this runner with `--smoke`; discovering it here would
  // recursively launch another full run instead of executing one suite.
  .filter((k) => k.startsWith('test:') && k !== 'test:smoke')
  .sort();

if (includeSmoke) suites.push('smoke');

let failed = [];
let passed = 0;

console.log(`Discovered ${suites.length} suite(s): ${suites.join(', ')}\n`);

for (const suite of suites) {
  process.stdout.write(`──────── ${suite} ────────\n`);
  const start = Date.now();
  const result = spawnSync('npm', ['run', '--silent', suite], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`✔ ${suite} (${elapsed}s)\n`);
    passed++;
  } else {
    console.log(`✘ ${suite} FAILED (${elapsed}s)\n`);
    failed.push(suite);
  }
}

console.log(`\nResult: ${passed} passed, ${failed.length} failed.`);
if (failed.length > 0) {
  console.log(`Failing suites: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('All suites passed.');
