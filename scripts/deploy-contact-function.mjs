#!/usr/bin/env node
// enough. — Deploy + end-to-end check for the send-contact-email Edge Function.
//
// Performs the same two steps as the (manually installed) CI workflow
// scripts/deploy-supabase-functions.yml:
//
//   1. Deploys supabase/functions/send-contact-email to the Supabase project
//      with the Supabase CLI (verify_jwt = false is read from
//      supabase/config.toml by the CLI).
//   2. Runs a real end-to-end check against the deployed function: CORS
//      preflight, GET method guard (405) and a POST with the exact JSON
//      payload the contact form sends, asserting HTTP 200 with ok:true.
//
// Usage:
//   node scripts/deploy-contact-function.mjs [--project-ref <ref>]
//                                            [--skip-deploy]
//                                            [--url <function-url>]
//
// Environment:
//   SUPABASE_ACCESS_TOKEN   Supabase access token (required for deploy).
//   SUPABASE_PROJECT_REF    Optional explicit project ref; otherwise derived
//                           from VITE_SUPABASE_URL (env or .env file).
//   ENOUGH_E2E_URL          Test hook: overrides the checked function URL
//                           (used by the local mock tests).
//
// The script never prints or stores secret values. The access token is only
// forwarded to the Supabase CLI through the process environment; the report
// contains HTTP statuses and the function's response bodies, which never
// contain secrets (the function redacts them by design).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ */
/* arguments & configuration                                          */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { projectRef: null, skipDeploy: false, url: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-ref') args.projectRef = argv[++i] ?? null;
    else if (arg === '--skip-deploy') args.skipDeploy = true;
    else if (arg === '--url') args.url = argv[++i] ?? null;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

/** Minimal .env reader — only to discover VITE_SUPABASE_URL. Values are
 *  never echoed. */
function readEnvFileViteUrl() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    return match[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

function deriveProjectRef(explicit) {
  const candidates = [
    explicit,
    process.env.SUPABASE_PROJECT_REF,
    process.env.VITE_SUPABASE_URL,
    readEnvFileViteUrl(),
  ].filter((value) => typeof value === 'string' && value.length > 0);

  for (const candidate of candidates) {
    // The ref is the 20-char lowercase hostname segment of the project URL.
    // A bare ref and a full https://<ref>.supabase.co URL are both accepted;
    // everything else (including keys) is rejected rather than guessed.
    if (/^[a-z0-9]{20}$/.test(candidate)) return candidate;
    const fromUrl = candidate.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
    if (fromUrl) return fromUrl[1];
  }
  console.error(
    'No project ref found. Set --project-ref, SUPABASE_PROJECT_REF or ' +
      'VITE_SUPABASE_URL (env or .env) to the project URL ' +
      '(https://<ref>.supabase.co).',
  );
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* deploy                                                             */
/* ------------------------------------------------------------------ */

function deploy(ref) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.error('Error: SUPABASE_ACCESS_TOKEN is not set. Export a Supabase access token that may deploy functions for this project.');
    process.exit(2);
  }

  const version = spawnSync('supabase', ['--version'], { encoding: 'utf-8' });
  if (version.error || version.status !== 0) {
    console.error(
      'Error: Supabase CLI not found on PATH. Install it (npm install -g supabase ' +
        'or brew install supabase/tap/supabase) and retry.',
    );
    process.exit(2);
  }

  console.log(`Deploying send-contact-email to project ${ref} ...`);
  const result = spawnSync(
    'supabase',
    ['functions', 'deploy', 'send-contact-email', '--project-ref', ref],
    { stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) {
    console.error('Error: supabase functions deploy failed (see output above).');
    process.exit(1);
  }
  console.log('Deploy finished.');
}

/* ------------------------------------------------------------------ */
/* end-to-end check                                                   */
/* ------------------------------------------------------------------ */

const EXPECTED_ORIGIN = process.env.ENOUGH_E2E_ORIGIN ?? 'https://hpmine42.github.io';

/** The exact JSON shape the contact form sends via
 *  supabase.functions.invoke('send-contact-email', { body }). clientTime is
 *  10 seconds in the past to clear the sub-minute bot heuristic. */
function formPayload() {
  return JSON.stringify({
    name: 'enough. CI E2E',
    email: 'e2e-test@example.com',
    message: 'Automated end-to-end test of the contact form pipeline.',
    hp: '',
    clientTime: Date.now() - 10_000,
  });
}

async function e2eCheck(url) {
  const results = [];
  let ok = true;

  async function check(label, expected, run) {
    let actual;
    try {
      actual = await run();
    } catch (err) {
      actual = `network error: ${err?.cause?.code ?? err?.message ?? err}`;
    }
    const pass = actual === expected;
    if (!pass) ok = false;
    results.push({ label, expected, actual, pass });
  }

  // 1) CORS preflight: must answer and echo the allowlisted origin.
  let preflightAcao = null;
  await check('OPTIONS preflight', 200, async () => {
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: EXPECTED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    preflightAcao = res.headers.get('access-control-allow-origin');
    return res.status;
  });
  results.push({
    label: 'preflight Access-Control-Allow-Origin',
    expected: EXPECTED_ORIGIN,
    actual: preflightAcao ?? '<absent>',
    pass: preflightAcao === EXPECTED_ORIGIN,
  });
  if (preflightAcao !== EXPECTED_ORIGIN) ok = false;

  // 2) Method guard: GET must be rejected with 405.
  await check('GET method guard', 405, async () => {
    const res = await fetch(url, { method: 'GET', headers: { Origin: EXPECTED_ORIGIN } });
    await res.arrayBuffer();
    return res.status;
  });

  // 3) Real POST with the contact form's payload shape.
  let postBody = '';
  await check('POST form payload', 200, async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Origin: EXPECTED_ORIGIN, 'Content-Type': 'application/json' },
      body: formPayload(),
    });
    postBody = await res.text();
    return res.status;
  });
  const okTrue = /"ok"\s*:\s*true/.test(postBody);
  if (!okTrue) ok = false;
  results.push({
    label: 'POST response body contains ok:true',
    expected: 'true',
    actual: okTrue ? 'true' : postBody.slice(0, 300),
    pass: okTrue,
  });

  console.log('\nsend-contact-email end-to-end check');
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label} — expected ${r.expected}, got ${r.actual}`);
  }
  if (postBody) console.log(`  response body: ${postBody}`);
  if (/'Mock mode'|Mock mode/.test(postBody)) {
    console.warn(
      '  NOTE: function replied in mock mode — RESEND_API_KEY is not set on the ' +
        'project, so no real email was dispatched. Set the function secrets ' +
        '(RESEND_API_KEY, CONTACT_TO_EMAIL, RESEND_FROM_EMAIL) with `supabase secrets set`.',
    );
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

const args = parseArgs(process.argv.slice(2));
let fnUrl = args.url ?? process.env.ENOUGH_E2E_URL;

if (!args.skipDeploy) {
  const ref = deriveProjectRef(args.projectRef);
  deploy(ref);
}

if (!fnUrl) {
  // E2E target: explicit --url / test hook, or the production URL of `ref`.
  const ref = deriveProjectRef(args.projectRef);
  fnUrl = `https://${ref}.supabase.co/functions/v1/send-contact-email`;
}

const passed = await e2eCheck(fnUrl);
console.log(passed ? '\nE2E check PASSED.' : '\nE2E check FAILED.');
process.exit(passed ? 0 : 1);
