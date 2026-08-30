// enough. — Focused regression tests for src/lib/errors.ts (roadmap E3).
//
// Exercises the localized mapping of known Supabase / PostgREST / network error
// shapes to the strings users actually see, using the real module (loaded via
// the test loader). `errorMessage` logs diagnostics to console.error; we
// silence that here so the test output stays readable.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/errors.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

const { errorMessage } = await import('../errors.ts');

const originalError = console.error;
const diagnostics = [];
console.error = (...args) => diagnostics.push(args);
after(() => {
  console.error = originalError;
});

test('null / empty error falls back to the generic message', () => {
  assert.equal(errorMessage(null), 'Something went wrong. Please try again.');
  assert.equal(errorMessage(undefined), 'Something went wrong. Please try again.');
});

test('invalid login credentials (code) maps to invalidCredentials', () => {
  assert.equal(
    errorMessage({ code: 'invalid_credentials' }),
    'Email or password is incorrect.',
  );
});

test('invalid login credentials (message) maps to invalidCredentials', () => {
  assert.equal(
    errorMessage({ message: 'Invalid login credentials' }),
    'Email or password is incorrect.',
  );
});

test('email not confirmed maps to emailNotConfirmed', () => {
  assert.equal(
    errorMessage({ message: 'Email not confirmed' }),
    'Please confirm your email address before logging in.',
  );
  assert.equal(
    errorMessage({ message: 'email_not_confirmed' }),
    'Please confirm your email address before logging in.',
  );
});

test('already-registered email maps to emailTaken', () => {
  assert.equal(
    errorMessage({ code: 'user_already_exists' }),
    'This email address is already registered.',
  );
  assert.equal(
    errorMessage({ message: 'User already registered' }),
    'This email address is already registered.',
  );
});

test('weak password maps to weakPassword', () => {
  assert.equal(errorMessage({ code: 'weak_password' }), 'The password is too weak.');
  assert.equal(errorMessage({ message: 'Password should be at least 8 characters' }), 'The password is too weak.');
});

/* ------------------------------------------------------------------ */
/* Password reuse (same_password) — must stay distinct from weak_password */
/* ------------------------------------------------------------------ */

// GoTrue's real answer to `updateUser({ password })` when the new password
// equals the current one: HTTP 422 with error_code "same_password" and the
// message below. Note the shared "password should be" wording — that is
// exactly what made the reuse error fall into the weak-password branch.
const REUSE_MESSAGE = 'New password should be different from the old password.';
const REUSE_TEXT = 'The new password must be different from your current password.';

test('same_password maps to samePassword, not to weakPassword', () => {
  const result = errorMessage({ code: 'same_password', message: REUSE_MESSAGE, status: 422 });
  assert.equal(result, REUSE_TEXT);
  assert.notEqual(result, 'The password is too weak.');
});

test('same_password is recognized via the canonical code alone', () => {
  assert.equal(errorMessage({ code: 'same_password' }), REUSE_TEXT);
});

test('same_password is recognized on the real AuthApiError shape', () => {
  // supabase-js throws an Error carrying `code` and `status` — this is what
  // AuthContext.updatePassword hands to errorMessage() on the recovery and
  // settings paths (`errorMessage(error, 'auth updateUser password')`).
  const error = new Error(REUSE_MESSAGE);
  error.code = 'same_password';
  error.status = 422;
  assert.equal(errorMessage(error, 'auth updateUser password'), REUSE_TEXT);
});

test('same_password is recognized when no error code is present', () => {
  assert.equal(errorMessage({ message: REUSE_MESSAGE }), REUSE_TEXT);
});

test('a genuine weak_password is still reported as a strength problem', () => {
  for (const message of [
    'Password should be at least 8 characters.',
    'Password should contain at least one character of each: A-Z, a-z, 0-9.',
  ]) {
    const result = errorMessage({ code: 'weak_password', message });
    assert.equal(result, 'The password is too weak.', `message: ${message}`);
    assert.notEqual(result, REUSE_TEXT, `message: ${message}`);
  }
});

test('an unknown password error is not classified as same_password', () => {
  for (const error of [
    { code: 'password_too_short', message: 'Password is too short.' },
    { code: 'current_password_invalid', message: 'Current password does not match the password on record.' },
    { code: 'reauthentication_needed', message: 'Reauthentication is needed to change your password.' },
    { code: 'weak_password', message: 'Password should be at least 8 characters.' },
  ]) {
    assert.notEqual(errorMessage(error), REUSE_TEXT, `code: ${error.code}`);
  }
});

test('existing auth, mail and network mappings are unaffected', () => {
  assert.equal(errorMessage({ code: 'invalid_credentials' }), 'Email or password is incorrect.');
  assert.equal(errorMessage({ message: 'Invalid login credentials' }), 'Email or password is incorrect.');
  assert.equal(
    errorMessage({ message: 'Email not confirmed' }),
    'Please confirm your email address before logging in.',
  );
  assert.equal(errorMessage({ message: 'Failed to fetch' }), 'No connection to the server.');
  // Rate limiting has no dedicated mapping in errors.ts; it must keep falling
  // through to the generic text instead of being read as a password problem.
  assert.equal(
    errorMessage({
      code: 'over_request_rate_limit',
      message: 'For security purposes, you can only request this once every minute.',
    }),
    'Something went wrong. Please try again.',
  );
});

test('duplicate username (23505 with username) maps to usernameTaken', () => {
  assert.equal(
    errorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_username"',
    }),
    'This username is already taken.',
  );
});

test('not-null username on profiles maps to usernameSave', () => {
  assert.equal(
    errorMessage({
      code: '23502',
      message: 'null value in column "username" violates not-null constraint (profiles)',
    }),
    'The username could not be saved.',
  );
});

test('RLS profile insert rejection maps to profileCreate', () => {
  assert.equal(
    errorMessage({
      code: '42501',
      message: 'new row violates row-level security policy on table "profiles"',
    }),
    'The profile could not be created.',
  );
});

test('network failures map to network', () => {
  for (const message of ['Failed to fetch', 'NetworkError', 'fetch failed', 'network request failed']) {
    assert.equal(errorMessage({ message }), 'No connection to the server.', `message: ${message}`);
  }
});

test('no rows (PGRST116) maps to noProfile', () => {
  assert.equal(errorMessage({ code: 'PGRST116' }), 'No profile found.');
});

test('raise-exception (P0001) maps to chat unavailable', () => {
  assert.equal(
    errorMessage({ code: 'P0001', message: 'cannot message into closed conversation' }),
    'This conversation is not available.',
  );
});

test('block guard (BLCKD) maps to a block error', () => {
  assert.equal(
    errorMessage({ code: 'BLCKD', message: 'peer is blocked' }),
    'This is not possible because of a block.',
  );
});

test('generic RLS denial maps to permissionDenied', () => {
  assert.equal(errorMessage({ code: '42501', message: 'permission denied' }), 'You are not allowed to do that.');
});

test('decline context maps to declineFailed', () => {
  // An unrecognised error code must fall through to the context-specific fallback.
  assert.equal(
    errorMessage({ code: '55555', message: 'db error' }, 'request decline'),
    'The request could not be declined.',
  );
});

test('accept context maps to acceptFailed', () => {
  assert.equal(
    errorMessage({ code: '55555', message: 'db error' }, 'request accept'),
    'The request could not be accepted.',
  );
});

test('registration duplicate maps to usernameTaken', () => {
  assert.equal(
    errorMessage({ code: '23505', message: 'duplicate key value' }, 'registration'),
    'This username is already taken.',
  );
});

test('unknown error shape maps to generic', () => {
  assert.equal(errorMessage({ code: '99999', message: 'totally unexpected' }), 'Something went wrong. Please try again.');
});

test('diagnostics do not expose error content', () => {
  diagnostics.length = 0;
  errorMessage({
    code: '99999',
    message: 'secret message contents',
    details: 'sensitive row data',
    hint: 'private implementation hint',
    status: 500,
    name: 'PostgrestError',
  }, 'diagnostic test');
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0][1], {
    code: '99999',
    status: 500,
    name: 'PostgrestError',
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret message contents|sensitive row data|private implementation hint/);
});
