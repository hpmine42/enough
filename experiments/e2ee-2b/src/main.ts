import { initSignalWasmForBrowser, runAllSignalWasmChecks, summarize } from './signal-wasm-harness';

async function main() {
  const app = document.getElementById('app')!;
  await initSignalWasmForBrowser();
  const results = await runAllSignalWasmChecks();
  const summary = summarize(results);
  app.textContent = [
    'enough. E2EE-2B signal-wasm isolated browser spike',
    `${summary.passed} PASS / ${summary.failed} FAIL / ${summary.info} INFO`,
    '',
    ...results.map((r) => `${r.status} [${r.id}] ${r.name} — ${r.detail} (${r.durationMs.toFixed(1)}ms)`),
  ].join('\n');
  if (summary.failed > 0) throw new Error('Spike checks failed');
}

main().catch((e) => {
  const app = document.getElementById('app');
  if (app) app.textContent = e instanceof Error ? e.stack ?? e.message : String(e);
  console.error(e);
});
