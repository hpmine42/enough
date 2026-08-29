// enough. — unit tests for the pure helpers in src/lib/helpers.ts.
//
// Covers the relative-timestamp formatting (including the P2-1 "just now"
// behaviour), username normalization/validation, display-name fallbacks and
// the connection lifecycle helpers.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/helpers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUEST_LIFETIME_MS,
  compareMessagesAsc,
  connectionExpiresAt,
  displayName,
  effectiveStatus,
  formatDate,
  formatRelative,
  isConnectionExpired,
  isSelfConnection,
  isValidUsername,
  normalizeUsername,
  otherUserId,
} from '../helpers.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

function isoOffset(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

/* ------------------------- formatRelative ------------------------- */

test('formatRelative: messages younger than a minute read "just now"', () => {
  assert.equal(formatRelative(isoOffset(0), 'en', NOW), 'just now');
  assert.equal(formatRelative(isoOffset(29_000), 'en', NOW), 'just now');
  assert.equal(formatRelative(isoOffset(59_999), 'en', NOW), 'just now');
});

test('formatRelative: German fresh messages read "gerade eben"', () => {
  assert.equal(formatRelative(isoOffset(5_000), 'de', NOW), 'gerade eben');
});

test('formatRelative: slightly future timestamps (clock skew) also read "just now"', () => {
  const future = new Date(NOW.getTime() + 15_000).toISOString();
  assert.equal(formatRelative(future, 'en', NOW), 'just now');
});

test('formatRelative: minutes and hours', () => {
  assert.equal(formatRelative(isoOffset(60_000), 'en', NOW), '1 min');
  assert.equal(formatRelative(isoOffset(5 * 60_000), 'en', NOW), '5 min');
  assert.equal(formatRelative(isoOffset(60 * 60_000), 'en', NOW), '1 h');
  assert.equal(formatRelative(isoOffset(3 * 60 * 60_000), 'en', NOW), '3 h');
});

test('formatRelative: beyond 24h falls back to weekday/date, never a minute count', () => {
  const weekday = formatRelative(isoOffset(3 * 24 * 60 * 60_000), 'en', NOW);
  assert.ok(typeof weekday === 'string' && weekday.length > 0, 'weekday is a string');
  assert.ok(!/(just now|\d+ min|\d+ h)/.test(weekday), 'weekday branch does not use minutes/hours');
  const date = formatRelative(isoOffset(30 * 24 * 60 * 60_000), 'en', NOW);
  assert.ok(typeof date === 'string' && date.length > 0, 'date is a string');
});

test('formatRelative: invalid input returns an empty string', () => {
  assert.equal(formatRelative('not-a-date', 'en', NOW), '');
});

/* --------------------------- formatDate --------------------------- */

test('formatDate: invalid input returns an empty string', () => {
  assert.equal(formatDate('nope', 'en'), '');
  assert.equal(formatDate(new Date('invalid'), 'de'), '');
});

test('formatDate: valid input returns a non-empty string in both languages', () => {
  assert.ok(formatDate('2026-08-29T12:00:00Z', 'en').length > 0);
  assert.ok(formatDate('2026-08-29T12:00:00Z', 'de').length > 0);
});

/* ------------------------ username helpers ------------------------ */

test('normalizeUsername: trims, strips a leading @ and lowercases', () => {
  assert.equal(normalizeUsername('  @Anna_Müller  '), 'anna_müller');
  assert.equal(normalizeUsername('Benno'), 'benno');
  assert.equal(normalizeUsername('@Caro'), 'caro');
});

test('isValidUsername: accepts lowercase letters, digits and underscores, 3–20 chars', () => {
  assert.equal(isValidUsername('abc'), true);
  assert.equal(isValidUsername('a1_b2'), true);
  assert.equal(isValidUsername('a'.repeat(20)), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(isValidUsername('a'.repeat(21)), false);
  assert.equal(isValidUsername('AB'), false);
  assert.equal(isValidUsername('has space'), false);
  assert.equal(isValidUsername('has-dash'), false);
});

/* ------------------------- display helpers ------------------------ */

test('displayName: prefers display name, falls back to username, then ellipsis', () => {
  assert.equal(displayName({ id: '1', username: 'benno', display_name: 'Benno S.' }), 'Benno S.');
  assert.equal(displayName({ id: '1', username: 'benno', display_name: '  ' }), 'benno');
  assert.equal(displayName({ id: '1', username: 'benno' }), 'benno');
  assert.equal(displayName(null), '…');
  assert.equal(displayName(undefined), '…');
});

test('compareMessagesAsc: orders by created_at then id, ascending', () => {
  const t = '2026-01-01T10:00:00Z';
  const messages = [
    { id: 'c', created_at: t },
    { id: 'a', created_at: '2026-01-01T11:00:00Z' },
    { id: 'b', created_at: t },
    { id: 'a', created_at: t },
  ];
  const sorted = [...messages].sort(compareMessagesAsc);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ['a', 'b', 'c', 'a'],
    'equal timestamps sort by id, later timestamps sort last',
  );
});

test('otherUserId / isSelfConnection', () => {
  assert.equal(otherUserId({ id: 'c', user_a: 'me', user_b: 'peer', status: 'accepted' }, 'me'), 'peer');
  assert.equal(otherUserId({ id: 'c', user_a: 'peer', user_b: 'me', status: 'accepted' }, 'me'), 'peer');
  assert.equal(isSelfConnection({ id: 'c', user_a: 'me', user_b: 'me', status: 'accepted' }), true);
  assert.equal(isSelfConnection({ id: 'c', user_a: 'me', user_b: 'peer', status: 'accepted' }), false);
});

/* ---------------------- connection lifecycle ---------------------- */

const pending = (createdAt) => ({ id: 'c', user_a: 'a', user_b: 'b', status: 'pending', created_at: createdAt });

test('connectionExpiresAt: pending requests expire after REQUEST_LIFETIME_MS', () => {
  const createdAt = '2026-08-01T00:00:00.000Z';
  const expires = connectionExpiresAt(pending(createdAt));
  assert.equal(
    expires?.getTime(),
    new Date(createdAt).getTime() + REQUEST_LIFETIME_MS,
  );
});

test('connectionExpiresAt: accepted/ended or missing created_at never expire', () => {
  assert.equal(connectionExpiresAt({ ...pending('2026-08-01T00:00:00Z'), status: 'accepted' }), null);
  assert.equal(connectionExpiresAt({ ...pending('2026-08-01T00:00:00Z'), status: 'ended' }), null);
  assert.equal(connectionExpiresAt(pending(undefined)), null);
});

test('isConnectionExpired / effectiveStatus', () => {
  const fresh = pending(isoOffset(60_000));
  assert.equal(isConnectionExpired(fresh, NOW), false);
  assert.equal(effectiveStatus(fresh, NOW), 'pending');

  const stale = pending(isoOffset(REQUEST_LIFETIME_MS + 60_000));
  assert.equal(isConnectionExpired(stale, NOW), true);
  assert.equal(effectiveStatus(stale, NOW), 'expired');

  const accepted = { ...stale, status: 'accepted' };
  assert.equal(isConnectionExpired(accepted, NOW), false);
  assert.equal(effectiveStatus(accepted, NOW), 'accepted');

  const ended = { ...stale, status: 'ended' };
  assert.equal(effectiveStatus(ended, NOW), 'ended');
});
