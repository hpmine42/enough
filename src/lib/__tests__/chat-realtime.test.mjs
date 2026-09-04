// enough. — Chat realtime message delivery regression tests.
//
// New messages in an already open 1:1 chat must appear via Supabase Realtime
// without a reload or full chat reload:
//
//   Realtime INSERT → verify it belongs to the current connection
//     → process through the existing E2EE decrypt/session path
//     → incrementally update Chat state → the message appears.
//
// The runtime tests exercise the ACTUAL merge logic the Chat.tsx handlers
// delegate to (src/lib/chatRealtime.ts — the same pure-helper pattern as the
// P1-5 Home bridge in src/lib/homeRealtime.ts), not a copy of it:
//   1. a new realtime message merges into the open chat's list
//      (the merge IS the incremental state update; no load() involved);
//   2. messages from another conversation are ignored
//      (payload is not authorization);
//   3. duplicate realtime events never duplicate a message;
//   4. rapid / out-of-order delivery converges to the loaded (created_at, id)
//      order;
//   5. merged rows keep their ciphertext byte-identical — opaque E2EE data
//      that flows into the unchanged, shared decryptForDisplay path;
//   6. rows captured while a page load was in flight are drained onto the
//      loaded page (no dropped message, no full reload);
//   7. UPDATE handling (delete-for-everyone tombstones) stays in place.
//
// The static guards (accepted repo pattern, supplement — not a substitute —
// for the runtime tests) pin the Chat.tsx wiring:
//   - a realtime event never triggers a full reload;
//   - rows are re-scoped to the open connection client-side;
//   - realtime never resolves display plaintext itself (one shared E2EE path);
//   - state updates are functional and duplicate-safe;
//   - the Offline Read Mode gates (offline gate, resubscribe, reload on
//     reconnect) remain intact.
//
// Run with:
//   npm run test:chatrealtime
//   node --test --experimental-strip-types src/lib/__tests__/chat-realtime.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isRealtimeMessageRow,
  mergeIncomingMessage,
  applyMessageUpdate,
  mergeLoadedPage,
} from '../chatRealtime.ts';

const CONN = 'conn-open';

function msg(id, connectionId = CONN, createdAt = '2026-01-01T10:00:00Z', over = {}) {
  return {
    id,
    connection_id: connectionId,
    sender_id: 'peer',
    ciphertext: 'CIPHERTEXT',
    created_at: createdAt,
    deleted_at: null,
    kind: 'text',
    meta: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* 1. A new realtime message appears via the incremental merge         */
/* ------------------------------------------------------------------ */

test('CR1: a realtime INSERT appends the message to the open chat (no reload)', () => {
  const prev = [msg('m1', CONN, '2026-01-01T09:00:00Z')];
  const next = mergeIncomingMessage(prev, msg('m2', CONN, '2026-01-01T10:00:01Z'), CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm2']);
  assert.notEqual(next, prev, 'a real change allocates a new array');
  assert.equal(prev.length, 1, 'previous state is never mutated');
  // An empty chat (first message ever) renders the row as well.
  const fromEmpty = mergeIncomingMessage([], msg('m1', CONN), CONN, null);
  assert.deepEqual(fromEmpty.map((m) => m.id), ['m1']);
});

/* ------------------------------------------------------------------ */
/* 2. Messages from another conversation are ignored                   */
/* ------------------------------------------------------------------ */

test('CR2: a row from another conversation is ignored (payload is not authorization)', () => {
  const prev = [msg('m1', CONN)];
  const foreign = msg('m2', 'conn-other');
  const next = mergeIncomingMessage(prev, foreign, CONN, null);
  assert.equal(next, prev, 'same reference — no state change, no re-render');
  assert.equal(applyMessageUpdate(prev, foreign, CONN), prev);
  // A malformed row that even claims the open connection id must still be
  // rejected by the structural check.
  assert.equal(mergeIncomingMessage(prev, { id: '', connection_id: CONN }, CONN, null), prev);
});

/* ------------------------------------------------------------------ */
/* 3. Duplicate events never duplicate a message                       */
/* ------------------------------------------------------------------ */

test('CR3: duplicate realtime events do not duplicate a message', () => {
  const prev = [msg('m1', CONN)];
  // Replays: the same object, then fresh objects with the same id.
  assert.equal(mergeIncomingMessage(prev, prev[0], CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, { ...prev[0] }, CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, { ...prev[0] }, CONN, null), prev);
  assert.equal(prev.length, 1, 'the list never gains a second copy');
});

/* ------------------------------------------------------------------ */
/* 4. Ordering under rapid / out-of-order delivery                     */
/* ------------------------------------------------------------------ */

test('CR4: out-of-order and rapid events converge to the loaded (created_at, id) order', () => {
  const t = '2026-01-01T10:00:00Z';
  let list = [];
  // Scrambled arrival order, a duplicate, and equal timestamps (id tiebreak).
  list = mergeIncomingMessage(list, msg('m3', CONN, t), CONN, null);
  list = mergeIncomingMessage(list, msg('m1', CONN, '2026-01-01T09:00:00Z'), CONN, null);
  list = mergeIncomingMessage(list, msg('m2', CONN, t), CONN, null);
  list = mergeIncomingMessage(list, msg('m3', CONN, t), CONN, null); // duplicate
  list = mergeIncomingMessage(list, msg('m0', CONN, '2026-01-01T08:00:00Z'), CONN, null);
  assert.deepEqual(list.map((m) => m.id), ['m0', 'm1', 'm2', 'm3']);
});

test('CR4b: the same-timestamp tiebreak matches database pagination order', () => {
  const t = '2026-01-01T10:00:00Z';
  let list = mergeIncomingMessage([], msg('b', CONN, t), CONN, null);
  list = mergeIncomingMessage(list, msg('a', CONN, t), CONN, null);
  assert.deepEqual(list.map((m) => m.id), ['a', 'b'], '(created_at, id) ascending, as getMessagesPage loads');
});

/* ------------------------------------------------------------------ */
/* 5. Ciphertext stays opaque (the E2EE path is untouched)             */
/* ------------------------------------------------------------------ */

test('CR5: merged rows keep their ciphertext byte-identical (opaque E2EE data)', () => {
  const envelope = '{"v":1,"e":"sw","t":2,"b":"YmFzZTY0"}';
  const row = msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: envelope });
  const next = mergeIncomingMessage([], row, CONN, null);
  assert.equal(next[0], row, 'the exact row object is kept — no copy, no mutation');
  assert.equal(next[0].ciphertext, envelope, 'ciphertext is never parsed, trimmed or sanitized');
  // System rows (kind != text, empty ciphertext) merge the same way.
  const sys = msg('m2', CONN, '2026-01-01T10:00:01Z', { ciphertext: '', kind: 'connection_event' });
  const next2 = mergeIncomingMessage(next, sys, CONN, null);
  assert.equal(next2[1].ciphertext, '');
  assert.equal(next2[1].kind, 'connection_event');
});

test('CR5b: an incoming envelope reaches the decrypt path exactly as the server sent it', async () => {
  const { isEnvelope } = await import('../e2ee/message-flow.ts');
  const envelope = '{"v":1,"e":"sw","t":3,"b":"YmFzZTY0"}';
  const row = msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: envelope });
  const next = mergeIncomingMessage([], row, CONN, null);
  assert.ok(isEnvelope(next[0].ciphertext), 'the merged row is still a parseable E2EE envelope');
  // ...and so is a row drained from the in-flight-load queue.
  const drained = mergeLoadedPage([], [row], CONN, null);
  assert.ok(isEnvelope(drained[0].ciphertext));
});

/* ------------------------------------------------------------------ */
/* 6. Malformed payloads and the chat-deletion cutoff                  */
/* ------------------------------------------------------------------ */

test('CR6: malformed payloads are dropped fail-closed', () => {
  const prev = [msg('m1', CONN)];
  assert.equal(mergeIncomingMessage(prev, null, CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, 'not-a-row', CONN, null), prev);
  assert.equal(mergeIncomingMessage(prev, { id: 'm2' }, CONN, null), prev);
  assert.equal(
    mergeIncomingMessage(prev, { id: 'm2', connection_id: CONN, sender_id: 'peer', created_at: 'x' }, CONN, null),
    prev,
    'missing ciphertext is malformed',
  );
  assert.equal(applyMessageUpdate(prev, { connection_id: CONN }, CONN), prev);
  assert.equal(applyMessageUpdate(prev, null, CONN), prev);
});

test('CR6b: rows hidden behind the chat-deletion cutoff are dropped', () => {
  const cutoff = '2026-01-01T12:00:00Z';
  const prev = [msg('m1', CONN, '2026-01-01T10:00:00Z')];
  const hidden = msg('m2', CONN, '2026-01-01T11:59:59Z');
  assert.equal(mergeIncomingMessage(prev, hidden, CONN, cutoff), prev, 'a hidden row is not rendered');
  const visible = msg('m3', CONN, '2026-01-01T12:00:01Z');
  const next = mergeIncomingMessage(prev, visible, CONN, cutoff);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm3'], 'a row after the cutoff is rendered');
});

/* ------------------------------------------------------------------ */
/* 7. UPDATE handling (delete-for-everyone tombstones)                 */
/* ------------------------------------------------------------------ */

test('CR7: a delete-for-everyone UPDATE replaces the row in place', () => {
  const original = msg('m1', CONN, '2026-01-01T10:00:00Z');
  const prev = [
    msg('m0', CONN, '2026-01-01T09:00:00Z'),
    original,
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const tombstone = { ...original, deleted_at: '2026-01-01T12:00:00Z', ciphertext: '' };
  const next = applyMessageUpdate(prev, tombstone, CONN);
  assert.equal(next.length, 3, 'no row is added or removed');
  assert.equal(next[1], tombstone, 'only the affected row changed');
  assert.equal(next[0], prev[0], 'untouched rows keep identity');
  // Duplicate update of the same row: same reference.
  assert.equal(applyMessageUpdate(next, tombstone, CONN), next);
  // Unknown id (row never rendered) and foreign row: same reference.
  assert.equal(applyMessageUpdate(prev, { ...tombstone, id: 'zzz' }, CONN), prev);
  assert.equal(applyMessageUpdate(prev, { ...tombstone, connection_id: 'conn-other' }, CONN), prev);
});

/* ------------------------------------------------------------------ */
/* 8. The in-flight-load drain (no dropped message, no full reload)    */
/* ------------------------------------------------------------------ */

test('CR8: rows captured while a load was in flight are drained onto the loaded page', () => {
  const page = [
    msg('m1', CONN, '2026-01-01T10:00:00Z'),
    msg('m2', CONN, '2026-01-01T11:00:00Z'),
  ];
  const pending = [
    msg('m3', CONN, '2026-01-01T12:00:00Z'), // landed mid-fetch → appended
    msg('m2', CONN, '2026-01-01T11:00:00Z'), // already in the page → deduped
    msg('m4', 'conn-other', '2026-01-01T13:00:00Z'), // foreign → dropped
  ];
  const next = mergeLoadedPage(page, pending, CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1', 'm2', 'm3']);
});

test('CR8b: a pending row older than the loaded page keeps its sorted position', () => {
  const page = [msg('m10', CONN, '2026-01-01T12:00:00Z')];
  const next = mergeLoadedPage(page, [msg('m0', CONN, '2026-01-01T09:00:00Z')], CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m0', 'm10']);
});

test('CR8c: an empty page with pending rows renders exactly the pending rows', () => {
  const next = mergeLoadedPage([], [msg('m1', CONN, '2026-01-01T10:00:00Z')], CONN, null);
  assert.deepEqual(next.map((m) => m.id), ['m1']);
});

test('CR8d: a pending row behind the (re-derived) cutoff is dropped at drain time', () => {
  const page = [msg('m1', CONN, '2026-01-01T13:00:00Z')];
  const pending = [msg('m0', CONN, '2026-01-01T09:00:00Z')];
  const next = mergeLoadedPage(page, pending, CONN, '2026-01-01T12:00:00Z');
  assert.deepEqual(next.map((m) => m.id), ['m1']);
});

test('CR8e: an unchanged drain returns the same page reference', () => {
  const page = [msg('m1', CONN)];
  assert.equal(mergeLoadedPage(page, [], CONN, null), page);
  assert.equal(mergeLoadedPage(page, [msg('m1', CONN)], CONN, null), page, 'dedupe against the page');
  assert.equal(mergeLoadedPage(page, [msg('m9', 'conn-other')], CONN, null), page, 'scoping at drain time');
});

/* ------------------------------------------------------------------ */
/* 9. Structural validation                                            */
/* ------------------------------------------------------------------ */

test('CR9: isRealtimeMessageRow validates the payload shape', () => {
  assert.equal(isRealtimeMessageRow(msg('m1')), true);
  assert.equal(isRealtimeMessageRow(msg('m1', CONN, '2026-01-01T10:00:00Z', { ciphertext: '' })), true, 'system rows have an empty ciphertext');
  assert.equal(isRealtimeMessageRow(null), false);
  assert.equal(isRealtimeMessageRow('x'), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), id: '' }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), connection_id: '' }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), sender_id: undefined }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), created_at: undefined }), false);
  assert.equal(isRealtimeMessageRow({ ...msg('m1'), ciphertext: null }), false);
});

/* ------------------------------------------------------------------ */
/* Static guards over the Chat.tsx wiring (supplement, NOT a           */
/* substitute for the runtime tests above)                             */
/* ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const chatSrc = fs.readFileSync(path.join(here, '..', '..', 'components', 'Chat.tsx'), 'utf8');

/** The chat realtime channel wiring, from `.channel(`chat-${connectionId}`)` to `.subscribe()`. */
function realtimeWiring() {
  const start = chatSrc.indexOf('.channel(`chat-${connectionId}`)');
  const end = chatSrc.indexOf('.subscribe();', start);
  assert.ok(start >= 0 && end > start, 'the chat realtime channel wiring exists');
  return chatSrc.slice(start, end);
}

test('CRG1: a realtime message event never triggers a full reload', () => {
  const wiring = realtimeWiring();
  assert.ok(!/setReloadKey/.test(wiring), 'no reload-key bump from a realtime handler');
  assert.ok(!/getMessagesPage\(/.test(wiring), 'no page fetch from a realtime handler');
  // The message events route through the shared pure merge helpers.
  assert.match(wiring, /mergeIncomingMessage\(prev, row, connectionId, hiddenUntil\)/);
  assert.match(wiring, /applyMessageUpdate\(prev, row, connectionId\)/);
});

test('CRG2: realtime rows are re-scoped to the open connection client-side', () => {
  const wiring = realtimeWiring();
  assert.ok(
    wiring.includes('filter: `connection_id=eq.${connectionId}`'),
    'the channel filter scopes the subscription to the open chat',
  );
  const scopes = wiring.match(/row\.connection_id !== connectionId/g) ?? [];
  assert.ok(scopes.length >= 2, 'INSERT and UPDATE handlers both re-scope the row');
  assert.ok(wiring.match(/isRealtimeMessageRow\(row\)/g) !== null, 'malformed payloads are validated');
});

test('CRG3: realtime messages flow into the shared E2EE display path (no plaintext shortcut)', () => {
  const wiring = realtimeWiring();
  // The realtime wiring must not resolve display plaintext itself: it never
  // touches the plain-text state, the undecryptable set or the plaintext cache.
  assert.ok(!/setPlain\(/.test(wiring), 'realtime never writes plaintext state');
  assert.ok(!/setUndecryptable\(/.test(wiring), 'realtime never marks messages undecryptable');
  assert.ok(!/cachePlaintext\(/.test(wiring), 'realtime never caches plaintext');
  assert.ok(!/ciphertext\s*=\s*['"]/.test(wiring), 'realtime never rewrites ciphertext');
  // The single shared decrypt path (load + realtime) is intact, keyed on the
  // message list so every merged row goes through it exactly once.
  const decryptStart = chatSrc.indexOf('/* Decrypt message bodies for display');
  const decryptEnd = chatSrc.indexOf('/* --------------------------- scroll / read');
  assert.ok(decryptStart >= 0 && decryptEnd > decryptStart, 'the shared decrypt effect exists');
  const decryptEffect = chatSrc.slice(decryptStart, decryptEnd);
  assert.match(decryptEffect, /const cached = await getCachedPlaintext\(me, m\.id\)/);
  assert.match(decryptEffect, /const \{ plaintext \} = await decryptForDisplay\(\{/);
  assert.match(decryptEffect, /if \(resolvedRef\.current\.has\(m\.id\)\) continue;/);
  assert.match(decryptEffect, /if \(decryptedRef\.current\.has\(m\.id\)\) continue;/);
  assert.match(decryptEffect, /\[messages, manager, conn, me\]\)/);
});

test('CRG4: realtime state updates are functional and duplicate-safe', () => {
  const wiring = realtimeWiring();
  assert.match(wiring, /setMessages\(\(prev\) =>\s*mergeIncomingMessage\(prev, row, connectionId, hiddenUntil\)/);
  assert.match(wiring, /setMessages\(\(prev\) => applyMessageUpdate\(prev, row, connectionId\)\)/);
  // The unread-below counter is updated OUTSIDE any state updater (the old
  // code called setNewSinceUp inside the setMessages updater, which React
  // may invoke twice under StrictMode).
  assert.ok(!/setMessages\(\(prev\) => \{[\s\S]*setNewSinceUp/.test(wiring), 'no setState nested in an updater');
});

test('CRG5: a load in flight does not drop realtime rows (gate + drain at commit)', () => {
  const wiring = realtimeWiring();
  assert.match(wiring, /if \(loadingRef\.current\)/, 'the handler checks the load gate');
  assert.match(wiring, /pendingRealtimeRef\.current\.push\(row\)/, 'in-flight events are captured');
  assert.match(
    chatSrc,
    /const drained = pendingRealtimeRef\.current;/,
    'the loader drains the captured rows',
  );
  assert.match(
    chatSrc,
    /mergeLoadedPage\(\s*pageResult\.messages,\s*drained,\s*connectionId,\s*until,?\s*\)/,
    'the drain merges onto the loaded page',
  );
  // The offline snapshot mirrors the committed (drained) list, so an
  // offline render cannot miss a message that was visible online.
  assert.match(chatSrc, /messages: committed,/);
  // The gate is opened by the loader and released on every terminal commit.
  assert.ok(chatSrc.match(/loadingRef\.current = true/g) !== null, 'the loader opens the gate');
  const releases = chatSrc.match(/loadingRef\.current = false/g) ?? [];
  assert.ok(releases.length >= 5, `the loader releases the gate on every terminal commit, saw ${releases.length}`);
});

test('CRG6: Offline Read Mode is untouched by the realtime wiring', () => {
  // The realtime effect is not subscribed while the browser has no network,
  // and re-runs (re-subscribes) when connectivity returns (`offline` dep).
  const effectStart = chatSrc.indexOf('/* ------------------------------ realtime');
  const effectEnd = chatSrc.indexOf('/* Block state follows changes from the other device');
  assert.ok(effectStart >= 0 && effectEnd > effectStart, 'the realtime effect region exists');
  const effect = chatSrc.slice(effectStart, effectEnd);
  assert.match(effect, /if \(shouldSkipNetwork\(\)\) return;/, 'offline: no realtime channel is opened');
  assert.match(effect, /\[connectionId, valid, peer, hiddenUntil, me, offline\]\)/, 'reconnection re-subscribes via the effect deps');
  // Reconnection still reruns the EXISTING loader (unchanged behavior).
  assert.match(chatSrc, /if \(wasOffline && !offline\) setReloadKey\(\(k\) => k \+ 1\);/);
  // The offline snapshot path of the loader is untouched.
  assert.match(chatSrc, /const snapshot = await loadChatSnapshot\(me, connectionId\);/);
});

test('CRG7: existing send, pagination and deletion behavior is preserved', () => {
  // Own sends keep their dedupe + (created_at, id) sort.
  assert.match(
    chatSrc,
    /setMessages\(\(prev\) =>\s*prev\.some\(\(m\) => m\.id === message\.id\)/,
  );
  assert.match(chatSrc, /\[\.\.\.prev, message\]\.sort\(compareMessagesAsc\)/);
  // Pagination still prepends older pages with the existing shape.
  assert.match(chatSrc, /setMessages\(\(prev\) => \[\.\.\.result\.messages, \.\.\.prev\]\)/);
  // Delete-for-me is still pure per-user tombstone bookkeeping.
  assert.match(chatSrc, /setDeletedForMe\(\(prev\) => new Set\(prev\)\.add\(target\.message\.id\)\)/);
});
