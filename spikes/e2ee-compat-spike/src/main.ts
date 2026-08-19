// Browser entry for the spike page. Runs all checks and renders a report.
import { runAllChecks, summarize, runtimeLabel } from './checks.ts';

const app = document.getElementById('app') as HTMLElement;
app.innerHTML = `<h1>enough. — E2EE-2.5 Compatibility Spike</h1>
  <p class="meta">Runtime: ${runtimeLabel} · Test page only — not part of the app.</p>
  <p id="summary" data-state="running">Running checks…</p>`;

const results = await runAllChecks();
const { passed, failed, info, allPassed } = summarize(results);

document.getElementById('summary')!.textContent = allPassed
  ? `ALL CHECKS PASSED — ${passed} passed, ${failed} failed, ${info} info`
  : `CHECK FAILURES — ${passed} passed, ${failed} failed, ${info} info`;
(document.getElementById('summary') as HTMLElement).dataset.state = allPassed ? 'ok' : 'fail';

const rows = results
  .map(
    (r) => `<tr class="${r.status.toLowerCase()}">
    <td><code>${r.id}</code></td>
    <td>${r.category}</td>
    <td>${r.name}</td>
    <td>${r.status}</td>
    <td>${r.durationMs.toFixed(1)} ms</td>
    <td>${r.detail}</td>
  </tr>`,
  )
  .join('');

app.insertAdjacentHTML(
  'beforeend',
  `<table>
    <thead><tr><th>ID</th><th>Category</th><th>Check</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`,
);
