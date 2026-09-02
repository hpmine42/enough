// enough. — regression tests for the Home chat-overview preview attribution
// of deleted messages.
//
// The bug: the Home preview always rendered
// `@{peer} deleted this message` for a delete-for-everyone tombstone, even
// when the current user had deleted their own message. The wording must name
// the actual deletion actor.
//
// Actor model under test (unchanged by the fix): only the SENDER of a message
// may delete it for everyone (RLS policy `messages_update_sender_only` +
// trigger `guard_message_update`, migration 0009), so the tombstone actor is
// the sender. "Delete for me" writes per-user `message_deletions` rows and
// leaves `deleted_at` null — it must never produce a tombstone preview.
//
// Run with:
//   npm run test:preview
//   node --test --experimental-strip-types src/lib/__tests__/home-preview.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/* Minimal browser surface the i18n module touches (same shim as
   src/i18n/__tests__/i18n.test.mjs). */
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
globalThis.document = { documentElement: { lang: 'en' } };

const { deletedMessagePreview } = await import('../homePreview.ts');
const { setLang } = await import('../../i18n/index.ts');
const { mergeLastMessage } = await import('../homeRealtime.ts');

const ME = 'user-1';
const PEER = 'user-2';

function msg(overrides = {}) {
  return {
    id: 'm1',
    connection_id: 'conn-1',
    sender_id: PEER,
    ciphertext: 'Hello!',
    created_at: '2026-01-01T10:00:00Z',
    deleted_at: null,
    kind: 'text',
    ...overrides,
  };
}

before(() => setLang('en'));
after(() => setLang('en'));

/** Run `fn` with the UI switched to German, then restore English. */
function inGerman(fn) {
  setLang('de');
  try {
    return fn();
  } finally {
    setLang('en');
  }
}

/* ------------------------------------------------------------------ */
/* 1. I delete my own message (delete for everyone) → "You …"          */
/* ------------------------------------------------------------------ */

test('own message deleted for everyone is attributed to "You"', () => {
  const own = msg({ sender_id: ME, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  assert.equal(
    deletedMessagePreview(own, ME, 'benno'),
    'You deleted this message.',
  );
});

test('self-chat (My Notes) tombstone is also attributed to "You"', () => {
  const ownNote = msg({ sender_id: ME, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  assert.equal(
    deletedMessagePreview(ownNote, ME, 'anna'),
    'You deleted this message.',
  );
});

/* ------------------------------------------------------------------ */
/* 2. The other participant deletes → preview names the other user     */
/* ------------------------------------------------------------------ */

test('peer message deleted for everyone names the peer', () => {
  const theirs = msg({ sender_id: PEER, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  assert.equal(
    deletedMessagePreview(theirs, ME, 'benno'),
    '@benno deleted this message.',
  );
});

test('the peer is never credited with a deletion performed by me', () => {
  const own = msg({ sender_id: ME, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  const preview = deletedMessagePreview(own, ME, 'benno');
  assert.equal(preview.includes('benno'), false);
  assert.equal(preview.includes('You'), true);
});

/* ------------------------------------------------------------------ */
/* 3. Normal (non-deleted) previews are unaffected                     */
/* ------------------------------------------------------------------ */

test('a live message produces no tombstone (falls through to the normal preview)', () => {
  assert.equal(deletedMessagePreview(msg(), ME, 'benno'), null);
  assert.equal(deletedMessagePreview(msg({ deleted_at: null }), ME, 'benno'), null);
});

/* ------------------------------------------------------------------ */
/* 4. Delete for me keeps its own semantics (no tombstone)             */
/* ------------------------------------------------------------------ */

test('delete for me never produces a deleted-this-message preview', () => {
  // A "delete for me" writes a message_deletions row for the current user
  // and leaves the message row itself untouched (deleted_at stays null) —
  // for the deleting user the message is hidden entirely instead.
  const deletedForMeOnly = msg({ sender_id: PEER, deleted_at: null });
  assert.equal(deletedMessagePreview(deletedForMeOnly, ME, 'benno'), null);
});

test('delete for everyone remains a visible tombstone (distinct from delete for me)', () => {
  const deletedForEveryone = msg({
    sender_id: PEER,
    deleted_at: '2026-01-01T12:00:00Z',
    ciphertext: '',
  });
  assert.notEqual(deletedMessagePreview(deletedForEveryone, ME, 'benno'), null);
});

/* ------------------------------------------------------------------ */
/* 5. Attribution survives realtime updates / reloads                  */
/* ------------------------------------------------------------------ */

test('a realtime delete-for-everyone UPDATE of the displayed message keeps the actor correct', () => {
  // Simulates the Home realtime UPDATE handler: the newest message row is
  // replaced in place by its deleted version, then the preview is computed
  // from the merged state — the same path a reload takes.
  const mine = msg({ id: 'm2', sender_id: ME, created_at: '2026-01-01T11:00:00Z' });
  const deleted = { ...mine, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const merged = mergeLastMessage({ 'conn-1': mine }, deleted);
  assert.equal(merged['conn-1'], deleted);
  assert.equal(deletedMessagePreview(merged['conn-1'], ME, 'benno'), 'You deleted this message.');
});

test('a realtime delete UPDATE of a non-last message cannot change the attribution', () => {
  const last = msg({ id: 'm2', sender_id: ME, created_at: '2026-01-01T11:00:00Z' });
  const olderPeerDeleted = {
    ...msg({ id: 'm1', sender_id: PEER, created_at: '2026-01-01T10:00:00Z' }),
    deleted_at: '2026-01-01T12:00:00Z',
    ciphertext: '',
  };
  const prev = { 'conn-1': last };
  const merged = mergeLastMessage(prev, olderPeerDeleted);
  assert.equal(merged, prev, 'non-last message update must not change the map');
  assert.equal(deletedMessagePreview(merged['conn-1'], ME, 'benno'), null);
});

test('attribution is derived from the message row only (no stale actor state)', () => {
  // Re-computing the preview for the same row — as a re-render after a
  // reload does — must return the same actor, in both directions.
  const own = msg({ sender_id: ME, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  const theirs = msg({ sender_id: PEER, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(deletedMessagePreview(own, ME, 'benno'), 'You deleted this message.');
    assert.equal(deletedMessagePreview(theirs, ME, 'benno'), '@benno deleted this message.');
  }
});

/* ------------------------------------------------------------------ */
/* Localization (EN default, DE preserved) and interpolation safety    */
/* ------------------------------------------------------------------ */

test('German localization of both tombstone variants is preserved', () => {
  const own = msg({ sender_id: ME, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  const theirs = msg({ sender_id: PEER, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  inGerman(() => {
    assert.equal(
      deletedMessagePreview(own, ME, 'benno'),
      'Du hast diese Nachricht gelöscht.',
    );
    assert.equal(
      deletedMessagePreview(theirs, ME, 'benno'),
      '@benno hat diese Nachricht gelöscht.',
    );
  });
});

test('a username containing placeholder-like text is data, never a template', () => {
  const theirs = msg({ sender_id: PEER, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' });
  assert.equal(
    deletedMessagePreview(theirs, ME, 'ann {username} bee'),
    '@ann {username} bee deleted this message.',
  );
});
