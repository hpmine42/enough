// readiness-baseline.test.mjs
//
// E2EE-2C readiness gate — baseline verification.
//
// This test does NOT build or run any E2EE code. It verifies, against the
// real repository files, the baseline facts the readiness gate relies on:
//
//   1. @getmaapp/signal-wasm is NOT a root dependency of enough.
//   2. The production message path (sendMessage) still writes plaintext into
//      messages.ciphertext (no session-engine encryption integrated).
//   3. There is no session-engine / secret-vault integration anywhere under src/.
//   4. enough. has NO declared license (no LICENSE file, no package.json
//      license field) — feeds the LEGAL gate.
//   5. There is NO Content-Security-Policy meta tag and NO wasm-unsafe-eval
//      yet — feeds the CSP / WASM gate.
//
// These assertions document the repository baseline and must FAIL if any
// future PR starts integrating E2EE-2C, which is exactly what a production
// implementation approval would change. It does not itself approve anything.
//
// Run:  npm test   (from experiments/e2ee-2c-readiness)
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PKG_JSON = path.join(ROOT, 'package.json');
const API = path.join(ROOT, 'src', 'lib', 'api.ts');
const INDEX_HTML = path.join(ROOT, 'index.html');

const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
const apiSrc = readFileSync(API, 'utf8');
const indexHtml = readFileSync(INDEX_HTML, 'utf8');

test('baseline: @getmaapp/signal-wasm is NOT a root dependency', () => {
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  assert.equal(
    '@getmaapp/signal-wasm' in all,
    false,
    'FAIL: @getmaapp/signal-wasm must not be a root dependency in the baseline',
  );
});

test('baseline: sendMessage still writes plaintext (no engine integration)', () => {
  assert.match(apiSrc, /insert\(\{\s*connection_id: connectionId,\s*sender_id: senderId,\s*ciphertext: text\s*\}/,
    'FAIL: expected sendMessage to still write plaintext text into ciphertext');
  // No encryption primitive should be invoked inside sendMessage.
  assert.doesNotMatch(apiSrc,
    /(message_encrypt|process_prekey_bundle|session_encrypt|SignalWasm|signal_wasm)/,
    'FAIL: session-engine encryption symbols must not appear in api.ts in the baseline');
});

test('baseline: no session engine / secret vault under src/', () => {
  const out = execFileSync('find', [path.join(ROOT, 'src'), '-type', 'f'], { encoding: 'utf8' });
  const names = out.trim().split('\n').map((f) => f.toLowerCase());
  for (const needle of ['session', 'vault', 'signal_wasm', 'signal-wasm']) {
    const hit = names.filter((n) => n.includes(needle));
    assert.equal(hit.length, 0,
      `FAIL: unexpected src/ file matching "${needle}": ${hit.join(', ')}`);
  }
});

test('baseline: enough. has NO declared license (LEGAL gate feed)', () => {
  assert.equal(existsSync(path.join(ROOT, 'LICENSE')), false, 'FAIL: a LICENSE file must not exist in the baseline');
  assert.equal(existsSync(path.join(ROOT, 'NOTICE')), false, 'FAIL: a NOTICE file must not exist in the baseline');
  assert.equal('license' in pkg, false, 'FAIL: package.json must not declare a license in the baseline');
});

test('baseline: NO Content-Security-Policy / wasm-unsafe-eval yet (CSP gate feed)', () => {
  assert.doesNotMatch(indexHtml, /Content-Security-Policy/i,
    'FAIL: CSP must not yet be set in the baseline');
  assert.doesNotMatch(indexHtml, /wasm-unsafe-eval/,
    'FAIL: wasm-unsafe-eval must not yet be present in the baseline');
});
