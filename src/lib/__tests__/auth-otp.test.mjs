// enough. — regression tests for the email-OTP auth flows (code-based
// verification + password recovery).
//
// Server-side properties (generation, hashing at rest, TTL, atomic single
// use, purpose binding, platform rate limits) belong to Supabase Auth and
// cannot run in this offline harness; see docs/auth-otp.md §5. What this
// suite pins is THIS repository's side of the contract:
//
//   * input normalization and the (UX-only) format guard,
//   * the resend cooldown math that mirrors the server's 60 s window,
//   * delegation: every accept/reject decision comes from
//     `supabase.auth.verifyOtp` — the client never compares the entered
//     code against a known value and never decides validity locally,
//   * correct `type` binding ('signup' vs 'recovery') per flow,
//   * enumeration-safe recovery requests (frequency-limit replies are
//     suppressed into the neutral success path),
//   * no code material in any console output,
//   * EN/DE parity for every string these screens render.
//
// The rendered end-to-end walkthroughs (wrong code, valid code, rate-limit
// copy, sign-in after verify) ride on `npm run smoke` (main run + the
// SMOKE_OTP scenario).
//
// Run with:
//   npm run test:authotp
//   node --test --experimental-strip-types src/lib/__tests__/auth-otp.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

const {
  RESEND_COOLDOWN_MS,
  normalizeOtpCode,
  isPlausibleOtpCode,
  resendCooldownRemaining,
} = await import('../authOtp.ts');
const { translations } = await import('../../i18n/translations.ts');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const readRel = (path) => fs.readFileSync(`${__dirname}/../../${path}`, 'utf8');

const authContext = readRel('context/AuthContext.tsx');
const registerSource = readRel('components/Register.tsx');
const forgot = readRel('components/ForgotPassword.tsx');
const resetPassword = readRel('components/ResetPassword.tsx');
const app = readRel('App.tsx');
const authOtpSource = readRel('lib/authOtp.ts');

/* ------------------------------------------------------------------ */
/* 1 — input handling (UX guard only, server stays the authority)       */
/* ------------------------------------------------------------------ */

test('normalizeOtpCode strips mail-paste noise and keeps digits', () => {
  assert.equal(normalizeOtpCode('123456'), '123456');
  assert.equal(normalizeOtpCode(' 123 456 \n'), '123456');
  assert.equal(normalizeOtpCode('123-456'), '123456');
  assert.equal(normalizeOtpCode('  1234 5678  '), '12345678');
});

test('normalizeOtpCode returns null when no digit remains', () => {
  assert.equal(normalizeOtpCode(''), null);
  assert.equal(normalizeOtpCode('   '), null);
  assert.equal(normalizeOtpCode('abc'), null);
  assert.equal(normalizeOtpCode('- – —'), null);
});

test('isPlausibleOtpCode accepts the documented server range with margin', () => {
  // Supabase Auth's email OTP length is a server setting (6–10 digits by
  // documented range); the client guard is intentionally a little wider so
  // a length change can never lock out a valid code.
  for (const len of [6, 7, 8, 9, 10, 11, 12]) {
    assert.equal(isPlausibleOtpCode('1'.repeat(len)), true, `len=${len}`);
  }
  assert.equal(isPlausibleOtpCode('12345'), false, '5 digits rejected');
  assert.equal(isPlausibleOtpCode('1'.repeat(13)), false, '13 digits rejected');
  assert.equal(isPlausibleOtpCode('12345a'), false, 'letters rejected');
  assert.equal(isPlausibleOtpCode(''), false, 'empty rejected');
});

test('the format guard never contains a code comparison (server decides)', () => {
  // The entered code must not be compared against any known value in the
  // client — no `code === …`, no stored expected token. `authOtp.ts` only
  // normalizes and shape-checks.
  for (const [name, source] of [
    ['lib/authOtp.ts', authOtpSource],
    ['components/Register.tsx', registerSource],
    ['components/ForgotPassword.tsx', forgot],
  ]) {
    assert.doesNotMatch(source, /code\s*===/, `${name} must not compare the code`);
    assert.doesNotMatch(source, /code\s*!==/, `${name} must not compare the code`);
    assert.doesNotMatch(source, /expectedCode|storedCode|correctCode/, `${name} must not keep an expected code`);
  }
});

/* ------------------------------------------------------------------ */
/* 2 — resend cooldown (mirrors the server's 60 s per-address window)   */
/* ------------------------------------------------------------------ */

test('resendCooldownRemaining tracks a full 60 s window and expires', () => {
  assert.equal(RESEND_COOLDOWN_MS, 60_000, 'cooldown mirrors the documented server window');
  const t0 = 1_000_000;
  assert.equal(resendCooldownRemaining(t0, t0), 60_000, 'full window at send time');
  assert.equal(resendCooldownRemaining(t0, t0 + 1_000), 59_000, 'counts down');
  assert.equal(resendCooldownRemaining(t0, t0 + 59_999), 1, 'last second');
  assert.equal(resendCooldownRemaining(t0, t0 + 60_000), 0, 'window closed');
  assert.equal(resendCooldownRemaining(t0, t0 + 600_000), 0, 'stays at zero');
  assert.equal(resendCooldownRemaining(null, t0), 0, 'no send recorded');
});

test('the resend hook wires the cooldown into both code screens', () => {
  const hook = readRel('components/useResendCooldown.ts');
  assert.match(hook, /resendCooldownRemaining\(sentAt\)/, 'hook counts down from markSent');
  for (const [name, source] of [
    ['Register.tsx', registerSource],
    ['ForgotPassword.tsx', forgot],
  ]) {
    assert.match(source, /useResendCooldown\(true\)|useResendCooldown\(false\)/, `${name} uses the cooldown hook`);
    assert.match(
      source,
      /disabled=\{resendBusy \|\| remaining > 0\}/,
      `${name} disables resend while the window runs`,
    );
    assert.match(source, /markSent\(\)/, `${name} restarts the window after a successful send`);
    assert.match(source, /t\('auth\.resendWait', \{ seconds: Math\.ceil\(remaining \/ 1000\) \}\)/, `${name} shows the countdown hint`);
  }
});

/* ------------------------------------------------------------------ */
/* 3 — delegation: verifyOtp decides, with the right purpose binding    */
/* ------------------------------------------------------------------ */

test('registration verification delegates to verifyOtp with type signup', () => {
  assert.match(authContext, /verifySignupCode/, 'context exposes verifySignupCode');
  const fn = authContext.slice(
    authContext.indexOf('const verifySignupCode'),
    authContext.indexOf('const verifyRecoveryCode'),
  );
  assert.match(fn, /supabase\.auth\.verifyOtp\(\{/, 'signup verify goes through verifyOtp');
  assert.match(fn, /type: 'signup'/, "purpose-bound to 'signup'");
  assert.match(fn, /token: code/, 'forwards the typed code');
  assert.match(fn, /email,/, 'bound to the flow address');
  // On success the screen's success flag may only be set after the server
  // call resolved — never before it.
  const verifyCall = registerSource.indexOf('await verifySignupCode(');
  const successFlag = registerSource.indexOf('setVerified(true)');
  assert.notEqual(verifyCall, -1, 'Register submits through verifySignupCode');
  assert.notEqual(successFlag, -1, 'Register has a no-session success state');
  assert.ok(verifyCall < successFlag, 'success state is set only after the server answered');
});

test('recovery verification delegates to verifyOtp with type recovery', () => {
  assert.match(authContext, /verifyRecoveryCode/, 'context exposes verifyRecoveryCode');
  const fn = authContext.slice(authContext.indexOf('const verifyRecoveryCode'));
  assert.match(fn, /supabase\.auth\.verifyOtp\(\{/, 'recovery verify goes through verifyOtp');
  assert.match(fn, /type: 'recovery'/, "purpose-bound to 'recovery'");
  assert.match(fn, /token: code/, 'forwards the typed code');
  assert.match(fn, /if \(!data\.session\) return t\('errors\.generic'\)/, 'fails closed without a server-issued session');
  assert.match(fn, /setRecovery\(true\)/, 'the reset permission state turns on only after success');
  // The recovery state must never be set before the server accepted the
  // code and issued the session: the only assignment inside
  // verifyRecoveryCode comes after the error and session checks.
  const errReturn = fn.indexOf('if (error) return errorMessage');
  const sessionCheck = fn.indexOf("if (!data.session) return");
  const recoverySet = fn.indexOf('setRecovery(true)');
  assert.ok(errReturn !== -1 && errReturn < recoverySet, 'error path returns before recovery state is set');
  assert.ok(sessionCheck !== -1 && sessionCheck < recoverySet, 'missing session returns before recovery state is set');
});

test('double submit is guarded before the verify request is sent', () => {
  for (const [name, source] of [
    ['Register.tsx', registerSource],
    ['ForgotPassword.tsx', forgot],
  ]) {
    const fnStart = source.indexOf('async function onVerify');
    assert.notEqual(fnStart, -1, `${name} defines onVerify`);
    const body = source.slice(fnStart, source.indexOf('async function', fnStart + 10));
    const busyGuard = body.indexOf('if (busy) return;');
    const serverCall = body.indexOf('await verify');
    assert.ok(busyGuard !== -1, `${name} guards with the busy flag`);
    assert.ok(serverCall !== -1, `${name} calls the context verify`);
    assert.ok(busyGuard < serverCall, `${name} checks the guard before the server call (no parallel verify)`);
  }
});

test('the app gates on the recovery state before the plain user state', () => {
  // The reset permission must control the screen: with a recovery session
  // the password form renders regardless of route/user, and the check sits
  // in front of `if (!user)`.
  const recoveryGate = app.indexOf('if (recovery)');
  const userGate = app.indexOf('if (!user)');
  assert.notEqual(recoveryGate, -1, 'App.tsx renders on the recovery flag');
  assert.notEqual(userGate, -1, 'App.tsx renders the logged-out screens');
  assert.ok(recoveryGate < userGate, 'recovery gate wins over the logged-out gate');
  assert.match(resetPassword, /updatePassword/, 'the reset screen only offers updateUser({ password })');
});

/* ------------------------------------------------------------------ */
/* 4 — enumeration-safe recovery requests                              */
/* ------------------------------------------------------------------ */

test('resetPassword suppresses the per-address frequency error into success', () => {
  const fn = authContext.slice(
    authContext.indexOf('const resetPassword'),
    authContext.indexOf('const resendConfirmation'),
  );
  assert.match(
    fn,
    /error\.code === 'over_email_send_rate_limit'/,
    'the existence-dependent frequency reply is recognised',
  );
  const branch = fn.indexOf("error.code === 'over_email_send_rate_limit'");
  const branchTail = fn.slice(branch);
  assert.match(
    branchTail.slice(0, branchTail.indexOf('return errorMessage(error, \'auth resetPasswordForEmail\')')),
    /return null;/,
    'the frequency error returns the neutral success path',
  );
  // The visible reply for a request therefore only differs between
  // "network/config problem" (shown) and "sent" (shown identically for
  // existing and unknown addresses).
  assert.match(
    forgot,
    /t\('auth\.resetSent'\)/,
    'the code screen repeats the neutral "if an account exists" sentence',
  );
});

test('verify errors surface only the shared localized sentences', () => {
  // Components render the mapped string, never raw server text.
  for (const [name, source] of [
    ['Register.tsx', registerSource],
    ['ForgotPassword.tsx', forgot],
  ]) {
    assert.match(source, /setError\(err\)/, `${name} shows the mapped error`);
    assert.doesNotMatch(source, /err\.message/, `${name} must not render raw server messages`);
    assert.doesNotMatch(source, /alert\(/, `${name} must not use browser alerts`);
  }
});

/* ------------------------------------------------------------------ */
/* 5 — no code material in logs                                        */
/* ------------------------------------------------------------------ */

test('no OTP screen or helper writes to the console at all', () => {
  for (const [name, source] of [
    ['lib/authOtp.ts', authOtpSource],
    ['components/Register.tsx', registerSource],
    ['components/ForgotPassword.tsx', forgot],
    ['context/AuthContext.tsx', authContext],
  ]) {
    assert.doesNotMatch(
      source,
      /console\.(log|warn|info|debug|error|trace)/,
      `${name} must keep codes out of the console`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 6 — i18n: every string these screens render, in both languages       */
/* ------------------------------------------------------------------ */

test('all OTP flow keys exist in EN and DE with matching placeholders', () => {
  const keys = [
    'confirmTitle', 'confirmText', 'confirmResend', 'confirmResent',
    'codeLabel', 'codeRequired', 'verifyCode', 'resendWait',
    'verifySuccessTitle', 'verifySuccessText', 'backToLogin',
    'forgotTitle', 'forgotText', 'sendResetLink', 'resetSent',
    'codeEntryTitle', 'codeEntryText',
    'resetTitle', 'resetText', 'setNewPassword', 'resetSuccess',
  ];
  for (const key of keys) {
    const en = translations.en.auth[key];
    const de = translations.de.auth[key];
    assert.equal(typeof en, 'string', `auth.${key} (EN) exists`);
    assert.equal(typeof de, 'string', `auth.${key} (DE) exists`);
    assert.ok(en.trim().length > 0, `auth.${key} (EN) non-empty`);
    assert.ok(de.trim().length > 0, `auth.${key} (DE) non-empty`);
    assert.notEqual(en, de, `auth.${key} is actually translated`);
    const placeholders = (s) => (s.match(/\{[^{}]+\}/g) ?? []).sort().join(',');
    assert.equal(placeholders(de), placeholders(en), `auth.${key} placeholders match`);
  }
  // Interpolated values are required by the screens themselves.
  assert.match(translations.en.auth.confirmText, /\{email\}/);
  assert.match(translations.de.auth.confirmText, /\{email\}/);
  assert.match(translations.en.auth.codeEntryText, /\{email\}/);
  assert.match(translations.de.auth.codeEntryText, /\{email\}/);
  assert.match(translations.en.auth.resendWait, /\{seconds\}/);
  assert.match(translations.de.auth.resendWait, /\{seconds\}/);
});

test('the new error sentences exist in EN and DE and stay neutral', () => {
  for (const key of ['otpInvalid', 'tooManyAttempts']) {
    const en = translations.en.errors[key];
    const de = translations.de.errors[key];
    assert.ok(en && de && en !== de, `errors.${key} translated`);
    // Neutral wording: no account-existence claim, no server jargon.
    assert.doesNotMatch(en, /account (does not|doesn't) exist|user not found|otp_expired/i);
    assert.doesNotMatch(de, /Konto (gibt es nicht|nicht vorhanden)|otp_expired/i);
  }
  assert.equal(
    translations.en.errors.otpInvalid,
    'This code is invalid or has expired.',
    'one shared sentence for wrong/expired/used codes',
  );
});
