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
//   7. UPDATE handling (delete-for-everyone tombstones) stays in place;
//   8. audit F-01: the conversation lifecycle guard — an async operation
//      (send / loadOlder) started for conversation A is discarded when the
//      component switched to conversation B, while the still-current
//      conversation's results are applied unchanged.
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
  createChatLifecycle,
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
/* 10. Conversation lifecycle guard (audit F-01)                       */
/* ------------------------------------------------------------------ */

/**
 * The lifecycle helper is the ACTUAL guard logic Chat.tsx uses: an async
 * operation captures `current()` before its first await and only commits its
 * result while `isCurrent(token)` is still true. These tests exercise that
 * exact decision under the switch sequences of the F-01 report.
 */
test('CRL1: a result of an operation started in A is discarded after A -> B', async () => {
  const lc = createChatLifecycle();
  const tokenA = lc.current();
  // The async operation resolves AFTER the user switched to B.
  lc.advance(); // A -> B
  await Promise.resolve();
  // The guarded commit decision (as in handleSend / loadOlder):
  const reachedCommit = lc.isCurrent(tokenA);
  assert.equal(reachedCommit, false, 'stale operation must not commit');
  // While the CURRENT conversation can still commit.
  assert.equal(lc.isCurrent(lc.current()), true);
});

test('CRL2: a result of an operation started in the still-current conversation is applied', async () => {
  const lc = createChatLifecycle();
  const token = lc.current();
  await Promise.resolve();
  assert.equal(lc.isCurrent(token), true, 'no switch -> commit allowed');
});

test('CRL3: only the newest generation survives rapid switches (A->B->C)', async () => {
  const lc = createChatLifecycle();
  const tokenA = lc.current();
  lc.advance(); // A -> B
  const tokenB = lc.current();
  lc.advance(); // B -> C
  const tokenC = lc.current();
  assert.equal(lc.isCurrent(tokenA), false, 'A is stale');
  assert.equal(lc.isCurrent(tokenB), false, 'B is stale');
  assert.equal(lc.isCurrent(tokenC), true, 'only C may commit');
});

test('CRL4: A -> B -> A starts a NEW generation, so the first A session stays stale', async () => {
  const lc = createChatLifecycle();
  const firstA = lc.current();
  lc.advance(); // A -> B
  lc.advance(); // B -> A (reopened)
  const reopenedA = lc.current();
  assert.notEqual(reopenedA, firstA, 'reopened conversation is a new generation');
  assert.equal(lc.isCurrent(firstA), false, 'the old A session must not leak into the reopened A');
  assert.equal(lc.isCurrent(reopenedA), true);
});

test('CRL5: the lifecycle is monotonic and stable while the conversation does not change', () => {
  const lc = createChatLifecycle();
  assert.equal(lc.current(), lc.current(), 'current() is stable without a switch');
  const first = lc.advance();
  assert.ok(first > 0, 'tokens are monotonically increasing');
  const second = lc.advance();
  assert.ok(second > first, 'each switch starts a newer generation');
  assert.equal(lc.isCurrent(first), false);
  assert.equal(lc.isCurrent(second), true);
});

test('CRL6: the guarded commit decision keeps ordering when the current result is applied', async () => {
  // Simulates the exact "apply only if current" shape used by handleSend and
  // loadOlder: the same row that was mid-flight is merged only via the shared
  // comparator path, and only when the token is still current.
  const lc = createChatLifecycle();
  const token = lc.current();
  let list = [];
  const apply = (row) => {
    if (!lc.isCurrent(token)) return list;
    return mergeIncomingMessage(list, row, CONN, null);
  };
  list = apply(msg('m2', CONN, '2026-01-01T10:00:01Z'));
  list = apply(msg('m1', CONN, '2026-01-01T10:00:00Z'));
  assert.deepEqual(list.map((m) => m.id), ['m1', 'm2'], 'current results keep (created_at, id) order');
  // A later switch invalidates the same closure's next result.
  lc.advance();
  const before = list;
  list = apply(msg('m3', CONN, '2026-01-01T10:00:02Z'));
  assert.equal(list, before, 'stale result is discarded without re-allocation');
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

/* ---------------- 11. F-01 lifecycle wiring (static guards) ---------------- */

test('CRL-G1: the lifecycle is advanced synchronously with the connectionId prop', () => {
  // The token must be invalidated in the render body (ref compare), not only
  // in an effect, so a promise resolving between render and effect already
  // sees the new generation.
  assert.match(chatSrc, /lifecycleConnectionRef\.current !== connectionId/);
  assert.match(chatSrc, /lifecycleRef\.current\.advance\(\)/);
  // The reset effect clears the shared pagination latch on every switch so
  // the new conversation can never start with a stuck "loading older" state.
  const resetStart = chatSrc.indexOf('// Reset display state when switching conversations.');
  const resetEnd = chatSrc.indexOf('/* --------------------------- scroll / read');
  assert.ok(resetStart >= 0 && resetEnd > resetStart, 'the conversation reset effect exists');
  const reset = chatSrc.slice(resetStart, resetEnd);
  assert.match(reset, /loadingOlderRef\.current = false;/);
  assert.match(reset, /setLoadingOlder\(false\);/);
});

test('CRL-G2: a send started in A cannot commit into B after switching', () => {
  const start = chatSrc.indexOf('async function handleSend');
  const end = chatSrc.indexOf('async function handleAccept', start);
  assert.ok(start >= 0 && end > start, 'handleSend exists');
  const send = chatSrc.slice(start, end);
  // The operation is bound to the conversation before its first await.
  assert.match(send, /const token = lifecycleRef\.current\.current\(\);/);
  // It re-checks the token after EVERY await that can cross a switch
  // (prepareSend, sendMessage, cachePlaintext).
  const checks = send.match(/lifecycleRef\.current\.isCurrent\(token\)/g) ?? [];
  assert.ok(checks.length >= 3, `expected 3+ lifecycle checks, saw ${checks.length}`);
  const lastCheck = send.lastIndexOf('lifecycleRef.current.isCurrent(token)');
  // The message-state commits (and their plaintext cache write) are only
  // reachable after the LAST stale check: any commit before it would be an
  // unguarded cross-conversation write.
  assert.ok(
    send.indexOf('setMessages') > lastCheck,
    'setMessages must be guarded by the final isCurrent check',
  );
  assert.ok(
    send.indexOf('setPlain') > lastCheck,
    'setPlain must be guarded by the final isCurrent check',
  );
  // No new crypto path: sending still encrypts via the existing session
  // manager and stores the resulting ciphertext via the existing API.
  assert.match(send, /await prepareSend\(\{/);
  assert.match(send, /await sendMessage\(conn\.id, me, ciphertext\)/);
  assert.ok(!/decryptFromPeer|parseEnvelope|setCiphertext/.test(send), 'send never parses or decrypts');
});

test('CRL-G3: loadOlder started in A cannot prepend A pages into B after switching', () => {
  const start = chatSrc.indexOf('async function loadOlder');
  const end = chatSrc.indexOf('useLayoutEffect(() =>', start);
  assert.ok(start >= 0 && end > start, 'loadOlder exists');
  const load = chatSrc.slice(start, end);
  // Bound to the conversation before the page request.
  assert.match(load, /const token = lifecycleRef\.current\.current\(\);/);
  const checks = load.match(/lifecycleRef\.current\.isCurrent\(token\)/g) ?? [];
  assert.ok(checks.length >= 1, 'the page fetch result is checked for staleness');
  const lastCheck = load.lastIndexOf('lifecycleRef.current.isCurrent(token)');
  assert.ok(
    load.indexOf('setMessages') > lastCheck,
    'setMessages must be guarded by the isCurrent check',
  );
  assert.ok(
    load.indexOf('pendingDeltaRef.current = prevHeight') > lastCheck,
    'scroll compensation must not run for a stale page',
  );
  // The stale path releases the shared single-flight latch without touching
  // the new conversation's visual state.
  assert.match(load, /if \(!lifecycleRef\.current\.isCurrent\(token\)\) \{\s*\/\/ Conversation changed/);
  assert.match(load, /loadingOlderRef\.current = false;/);
});

test('CRL-G4: the E2EE display path is unchanged (guard never touches decrypt)', () => {
  // The single shared decrypt effect still exists on the message list, and
  // no second decrypt path was added anywhere in Chat.tsx.
  assert.match(chatSrc, /const \{ plaintext \} = await decryptForDisplay\(\{/);
  assert.match(chatSrc, /\[messages, manager, conn, me\]\)/);
  assert.match(chatSrc, /resolvedRef\.current\.has\(m\.id\)\) continue;/);
  assert.match(chatSrc, /decryptedRef\.current\.has\(m\.id\)\) continue;/);
});
