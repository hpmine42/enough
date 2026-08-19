// Node test runner for the compatibility spike.
// Runs the SAME check code that the browser page runs (src/checks.ts).
// Usage: npm test   (inside spikes/e2ee-compat-spike)
//
// NOTE: Node's WebCrypto differs slightly from browsers (e.g. it requires an
// explicit AlgorithmIdentifier for Ed25519 sign()). checks.ts handles that.
// Where behaviour is browser-specific the check reports INFO, not FAIL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runAllChecks, summarize } from '../src/checks.ts';

test('e2ee-2.5 compatibility spike — all checks pass', async () => {
  const results = await runAllChecks();
  for (const r of results) {
    console.log(`${r.status === 'PASS' ? '✔' : r.status === 'FAIL' ? '✘' : 'ℹ'} [${r.id}] ${r.name} — ${r.detail} (${r.durationMs.toFixed(1)}ms)`);
  }
  const summary = summarize(results);
  console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed, ${summary.info} info`);
  const failed = results.filter((r) => r.status === 'FAIL');
  assert.equal(
    failed.length,
    0,
    `Failed checks:\n${failed.map((f) => `  [${f.id}] ${f.name}: ${f.detail}`).join('\n')}`,
  );
});
