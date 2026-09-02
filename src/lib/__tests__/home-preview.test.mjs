// enough. — regression tests for the Home chat-overview preview of deleted
// messages (delete for me and delete for everyone).
//
// Bug 1: the Home preview always rendered `@{peer} deleted this message` for
// a delete-for-everyone tombstone, even when the current user had deleted
// their own message. The wording must name the actual deletion actor.
//
// Bug 2: "delete for me" left the message row untouched and Home never
// consulted the per-user `message_deletions` state, so a message the current
// user deleted only for themselves was still rendered as the latest-message
// preview (its plaintext/ciphertext content was exposed).
//
// Actor model under test: only the SENDER of a message may delete it for
// everyone (RLS policy `messages_update_sender_only` + trigger
// `guard_message_update`, migration 0009), so the tombstone actor is the
// sender. "Delete for me" writes per-user `message_deletions` rows visible
// only to `auth.uid()` (RLS, migration 0001) and leaves `deleted_at` null —
// the actor is always the current user, and the peer's own deletion state
// never contains the id, so the peer keeps seeing the original message.
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
/* 4. Delete for me: the deleting user sees the placeholder, the peer  */
/*    keeps the original content                                      */
/* ------------------------------------------------------------------ */

test('own message deleted for me resolves to "You deleted this message"', () => {
  const own = msg({ sender_id: ME, deleted_at: null, ciphertext: 'secret own text' });
  assert.equal(
    deletedMessagePreview(own, ME, 'benno', new Set([own.id])),
    'You deleted this message.',
  );
});

test('other participant\'s message deleted for me resolves to "You deleted this message"', () => {
  // The deleting user is the actor regardless of the sender, so the preview
  // must not name the peer and must never reveal the original content.
  const theirs = msg({ sender_id: PEER, deleted_at: null, ciphertext: 'Secret peer text' });
  const preview = deletedMessagePreview(theirs, ME, 'benno', new Set([theirs.id]));
  assert.equal(preview, 'You deleted this message.');
  assert.equal(preview.includes('Secret peer text'), false);
  assert.equal(preview.includes('benno'), false);
});

test('peer keeps the original message after I delete it for me', () => {
  // The peer's own deletion set does not contain the id (RLS keeps the row
  // private to the deleter), so no deleted preview is produced and the
  // caller falls through to the normal content branch.
  const theirs = msg({ sender_id: PEER, deleted_at: null, ciphertext: 'Secret peer text' });
  assert.equal(deletedMessagePreview(theirs, PEER, 'anna', new Set()), null);
  assert.equal(
    deletedMessagePreview(theirs, PEER, 'anna', new Set(['other-message-id'])),
    null,
  );
});

test('delete for me placeholder is localized like the delete-for-everyone one', () => {
  const theirs = msg({ sender_id: PEER, deleted_at: null });
  inGerman(() => {
    assert.equal(
      deletedMessagePreview(theirs, ME, 'benno', new Set([theirs.id])),
      'Du hast diese Nachricht gelöscht.',
    );
  });
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
/* 6. Delete-for-me latest-message semantics                           */
/* ------------------------------------------------------------------ */

test('deleting an older message does not replace a newer message preview', () => {
  // Home keeps only the newest message per connection; a delete-for-me id
  // for an older message must not affect the newer message's preview.
  const newer = msg({ id: 'm2', sender_id: ME, created_at: '2026-01-01T11:00:00Z' });
  const olderId = 'm1';
  const deletedForMe = new Set([olderId, 'm0']);
  assert.equal(deletedMessagePreview(newer, ME, 'benno', deletedForMe), null);
  // The same holds after a realtime update of the older message (e.g. the
  // peer deletes it for everyone later): the newest message stays untouched.
  const older = msg({ id: olderId, sender_id: PEER, created_at: '2026-01-01T10:00:00Z' });
  const olderTombstone = { ...older, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const prev = { 'conn-1': newer };
  assert.equal(mergeLastMessage(prev, olderTombstone), prev);
  assert.equal(deletedMessagePreview(prev['conn-1'], ME, 'benno', deletedForMe), null);
});

test('a newer non-deleted message wins after an older message is deleted for me', () => {
  const newer = msg({ id: 'm2', sender_id: ME, created_at: '2026-01-01T11:00:00Z' });
  const deletedForMe = new Set(['m1']);
  assert.equal(deletedMessagePreview(newer, ME, 'benno', deletedForMe), null);
  // When the deleted message itself becomes the newest, the placeholder is
  // shown instead of its content.
  const deletedLatest = msg({ id: 'm3', sender_id: PEER, created_at: '2026-01-01T12:00:00Z' });
  assert.equal(
    deletedMessagePreview(deletedLatest, ME, 'benno', new Set([...deletedForMe, 'm3'])),
    'You deleted this message.',
  );
});

test('several messages deleted for me produce exactly one placeholder, no stale state', () => {
  const latest = msg({ id: 'm5', sender_id: PEER, created_at: '2026-01-01T11:00:00Z' });
  const deletedForMe = new Set(['m1', 'm2', 'm3', 'm5']);
  const preview = deletedMessagePreview(latest, ME, 'benno', deletedForMe);
  assert.equal(preview, 'You deleted this message.');
  // A second preview computation from a reconstructed set (what a Home
  // re-render after reload does) is identical and still not the content.
  assert.equal(
    deletedMessagePreview(latest, ME, 'benno', new Set(['m1', 'm2', 'm3', 'm5'])),
    preview,
  );
  assert.equal(preview.includes(latest.ciphertext), false);
});

test('reload/reconstruction re-applies delete-for-me state to the preview', () => {
  const theirs = msg({ sender_id: PEER, deleted_at: null });
  // First Home load after the deletion happened on another device.
  const first = deletedMessagePreview(theirs, ME, 'benno', new Set([theirs.id]));
  // Second load after a page reload (local storage + DB merged again).
  const second = deletedMessagePreview(theirs, ME, 'benno', new Set([theirs.id]));
  assert.equal(first, 'You deleted this message.');
  assert.equal(second, first);
});

test('a delete-for-me id must never fall through to the message content', () => {
  // The deletion branch runs before the normal (cached-plaintext / envelope /
  // legacy) preview branches, so a marked message can never expose content.
  const theirs = msg({ sender_id: PEER, deleted_at: null, ciphertext: 'secret legacy text' });
  assert.notEqual(
    deletedMessagePreview(theirs, ME, 'benno', new Set([theirs.id])),
    theirs.ciphertext,
  );
  assert.equal(
    deletedMessagePreview(theirs, ME, 'benno', new Set([theirs.id])),
    'You deleted this message.',
  );
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
