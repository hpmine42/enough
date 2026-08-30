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
console.error = () => {};
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
