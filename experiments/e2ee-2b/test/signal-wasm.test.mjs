import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initSignalWasmForNode, runAllSignalWasmChecks, summarize } from '../src/signal-wasm-harness.ts';

const wasmPath = fileURLToPath(new URL('../node_modules/@getmaapp/signal-wasm/signal_wasm_bg.wasm', import.meta.url));

initSignalWasmForNode(await readFile(wasmPath));

test('isolated @getmaapp/signal-wasm Alice/Bob session-engine compatibility checks', async () => {
  const results = await runAllSignalWasmChecks();
  for (const r of results) {
    console.log(`${r.status === 'PASS' ? '✔' : r.status === 'FAIL' ? '✘' : 'ℹ'} [${r.id}] ${r.name} — ${r.detail} (${r.durationMs.toFixed(1)}ms)`);
  }
  const summary = summarize(results);
  console.log(`\nSummary: ${summary.passed} passed, ${summary.failed} failed, ${summary.info} info`);
  assert.equal(
    summary.failed,
    0,
    `Failed checks:\n${results.filter((r) => r.status === 'FAIL').map((r) => `  [${r.id}] ${r.name}: ${r.detail}`).join('\n')}`,
  );
});
