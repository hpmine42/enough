// enough. — P1-5 regression tests for the Home realtime reconciliation.
//
// Home.tsx applies message/profile events to the already-rendered list
// instead of re-fetching everything. These tests cover the pure merge logic
// that the realtime handlers delegate to.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/home-realtime.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMessageNewer,
  mergeLastMessage,
  unreadAfterInsert,
} from '../homeRealtime.ts';

function msg(id, connectionId, createdAt) {
  return { id, connection_id: connectionId, sender_id: 'peer', ciphertext: 'x', created_at: createdAt };
}

test('isMessageNewer: later timestamp wins', () => {
  assert.equal(
    isMessageNewer(msg('a', 'c', '2026-01-01T10:00:00Z'), msg('b', 'c', '2026-01-01T09:00:00Z')),
    true,
  );
  assert.equal(
    isMessageNewer(msg('a', 'c', '2026-01-01T09:00:00Z'), msg('b', 'c', '2026-01-01T10:00:00Z')),
    false,
  );
});

test('isMessageNewer: equal timestamps are broken by id', () => {
  const t = '2026-01-01T10:00:00Z';
  assert.equal(isMessageNewer(msg('b', 'c', t), msg('a', 'c', t)), true);
  assert.equal(isMessageNewer(msg('a', 'c', t), msg('b', 'c', t)), false);
});

test('mergeLastMessage: empty map adds the message', () => {
  const m = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const next = mergeLastMessage({}, m);
  assert.equal(next['conn-1'], m);
});

test('mergeLastMessage: newer insert replaces the last message', () => {
  const older = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const newer = msg('m2', 'conn-1', '2026-01-01T11:00:00Z');
  const next = mergeLastMessage({ 'conn-1': older }, newer);
  assert.equal(next['conn-1'], newer);
});

test('mergeLastMessage: out-of-order older insert is ignored (same reference)', () => {
  const newer = msg('m2', 'conn-1', '2026-01-01T11:00:00Z');
  const older = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const prev = { 'conn-1': newer };
  const next = mergeLastMessage(prev, older);
  assert.equal(next, prev, 'unchanged event must not allocate a new map');
});

test('mergeLastMessage: update of the currently displayed message replaces it', () => {
  const original = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const deleted = { ...original, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const next = mergeLastMessage({ 'conn-1': original }, deleted);
  assert.equal(next['conn-1'], deleted);
});

test('mergeLastMessage: update of a non-last message is ignored', () => {
  const last = msg('m2', 'conn-1', '2026-01-01T11:00:00Z');
  const nonLastUpdate = { ...msg('m1', 'conn-1', '2026-01-01T10:00:00Z'), deleted_at: '2026-01-01T12:00:00Z' };
  const prev = { 'conn-1': last };
  const next = mergeLastMessage(prev, nonLastUpdate);
  assert.equal(next, prev, 'non-last message update must not change the map');
});

test('mergeLastMessage: independent connections do not interfere', () => {
  const m1 = msg('m1', 'conn-1', '2026-01-01T10:00:00Z');
  const m2 = msg('m2', 'conn-2', '2026-01-01T11:00:00Z');
  const prev = { 'conn-1': m1 };
  const next = mergeLastMessage(prev, m2);
  assert.equal(next['conn-1'], m1);
  assert.equal(next['conn-2'], m2);
});

test('unreadAfterInsert: peer message increments', () => {
  assert.deepEqual(unreadAfterInsert({}, 'conn-1', true), { 'conn-1': 1 });
  assert.deepEqual(unreadAfterInsert({ 'conn-1': 2 }, 'conn-1', true), { 'conn-1': 3 });
});

test('unreadAfterInsert: own message leaves the map untouched (same reference)', () => {
  const prev = { 'conn-1': 2 };
  assert.equal(unreadAfterInsert(prev, 'conn-1', false), prev);
});
