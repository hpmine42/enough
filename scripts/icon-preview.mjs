// TEST tooling (icon set proposal): renders the current outline icon set
// (src/components/icons.tsx) next to the proposed filled set
// (src/components/iconsFilled.tsx) into public/icon-test.html, served by the
// Vite dev server at /icon-test.html. Delete together with the test.
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { mkdirSync, writeFileSync } from 'node:fs';

const outdir = 'node_modules/.cache/icon-preview';
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ['src/components/icons.tsx', 'src/components/iconsFilled.tsx'],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  splitting: true,
  outdir,
  logLevel: 'silent',
});

const outline = await import(`../${outdir}/icons.js`);
const filled = await import(`../${outdir}/iconsFilled.js`);

const names = Object.keys(filled).filter((k) => k.endsWith('Icon'));

const cell = (mod, name, size) => {
  const C = mod[name];
  if (!C) return '<span class="missing">—</span>';
  return renderToStaticMarkup(createElement(C, { size }));
};

const rows = names
  .map(
    (name) => `<tr>
      <td class="label">${name}</td>
      <td>${cell(filled, name, 22)}</td>
      <td>${cell(filled, name, 16)}</td>
      <td>${cell(outline, name, 22)}</td>
      <td>${cell(outline, name, 16)}</td>
    </tr>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>enough. — icon set test</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #141311; color: #f0ece6; }
  h1 { font-size: 18px; font-weight: 600; }
  p.note { opacity: .65; max-width: 70ch; }
  .wrap { display: flex; gap: 32px; flex-wrap: wrap; }
  .pane { padding: 20px; border-radius: 14px; }
  .dark { background: #141311; color: #f0ece6; }
  .light { background: #faf9f7; color: #26241f; }
  table { border-collapse: collapse; }
  td { padding: 6px 14px; vertical-align: middle; }
  td.label { font: 12px/1 ui-monospace, monospace; opacity: .6; }
  tr:nth-child(even) { background: rgba(128,128,128,.07); }
  thead td { font-weight: 600; font-size: 12px; opacity: .55; }
  .missing { opacity: .35; }
</style>
</head>
<body>
<h1>enough. — Icon-Test</h1>
<p class="note">Temporäre Vergleichsseite: <strong>filled (Vorschlag)</strong> vs. <strong>outline (aktuell)</strong>,
in den App-Größen 22 px (BottomNav) und 16 px (Inline/Status). Datei löschen: <code>public/icon-test.html</code>.</p>
<div class="wrap">
  <div class="pane dark">
    <table><thead><tr><td></td><td>filled 22</td><td>16</td><td>outline 22</td><td>16</td></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
  <div class="pane light">
    <table><thead><tr><td></td><td>filled 22</td><td>16</td><td>outline 22</td><td>16</td></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
</div>
</body>
</html>`;

writeFileSync('public/icon-test.html', html);
console.log(`icon-test.html written (${names.length} icons)`);
