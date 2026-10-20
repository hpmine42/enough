#!/usr/bin/env node
/**
 * enough. — i18n translation parity checker.
 *
 * Verifies that every language in src/i18n/translations.ts defines a
 * non-empty string for every key present in the English (source) dictionary,
 * and that no language has extra keys that don't exist in English.
 *
 * Usage:  npm run i18n:check
 *
 * Loads the translations module directly via Node with --experimental-strip-types
 * (stubbing the browser globals the i18n module touches), so the check uses the
 * real module exports — no fragile string parsing.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runner = resolve(root, 'scripts/.i18n-check-runner.mjs');

const runnerCode = `
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
globalThis.document = { documentElement: { lang: 'en' } };
const { translations } = await import('../src/i18n/translations.ts');

function walk(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string') {
      out.push({ key: path, hasValue: v.length > 0 });
    } else if (v && typeof v === 'object') {
      walk(v, path, out);
    }
  }
}
const report = {};
for (const [lang, dict] of Object.entries(translations)) {
  const entries = [];
  walk(dict, '', entries);
  report[lang] = entries;
}
process.stdout.write(JSON.stringify(report));
`;

writeFileSync(runner, runnerCode);
try {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', runner],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error('i18n check failed to load translations:');
    if (result.stderr) console.error(result.stderr);
    process.exit(2);
  }
  const report = JSON.parse(result.stdout);
  const enKeys = new Map((report.en || []).map((e) => [e.key, e.hasValue]));
  const langs = Object.keys(report).sort();
  if (langs.length === 0 || !report.en) {
    console.error('i18n check: English dictionary missing.');
    process.exit(2);
  }

  let total = 0;
  for (const lang of langs) {
    if (lang === 'en') continue;
    const dict = new Map((report[lang] || []).map((e) => [e.key, e.hasValue]));
    const missing = [];
    const extra = [];
    for (const [k] of enKeys) {
      if (!dict.has(k) || !dict.get(k)) missing.push(k);
    }
    for (const k of dict.keys()) {
      if (!enKeys.has(k)) extra.push(k);
    }
    if (missing.length === 0 && extra.length === 0) continue;
    total += missing.length + extra.length;
    if (missing.length > 0) {
      console.error(`\n✘ ${lang}: missing ${missing.length} key(s):`);
      for (const k of missing) console.error(`   - ${k}`);
    }
    if (extra.length > 0) {
      console.error(`\n✘ ${lang}: ${extra.length} orphan key(s) not present in en:`);
      for (const k of extra) console.error(`   + ${k}`);
    }
  }
  if (total === 0) {
    console.log(`i18n parity OK: ${langs.length} languages, ${enKeys.size} keys each.`);
    process.exit(0);
  }
  console.error(`\n${total} translation problem(s).`);
  process.exit(1);
} finally {
  try { unlinkSync(runner); } catch { /* ignore */ }
}
