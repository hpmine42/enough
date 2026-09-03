// enough. — Offline Read Mode tests (v0.3.x).
//
// Covered:
//   1. offline state detection (navigator.onLine + online/offline events);
//   2. distinction between "browser offline" and "online but unreachable";
//   3. rapid online/offline transitions;
//   4. sealed offline snapshots round-trip (Home + Chat);
//   5. account isolation: user B can never unseal user A's snapshot;
//   6. tampering / wrong record binding fails closed;
//   7. account-deletion cleanup wipes offline snapshots and the sealing key;
//   8. static guards over Home.tsx / Chat.tsx: the offline gate, the
//      no-network path, the disabled composer and the disabled
//      server-dependent actions actually exist in the shipped components.
//
// Run with:
//   npm run test:offline
//   node --test --experimental-strip-types src/lib/__tests__/offline.test.mjs

import '../crypto/__tests__/setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* Minimal browser surface for the connectivity module                 */
/* ------------------------------------------------------------------ */

const windowListeners = new Map();
const onLineState = { value: true };

Object.defineProperty(globalThis, 'navigator', {
  value: { get onLine() { return onLineState.value; } },
  configurable: true,
});
globalThis.window = {
  addEventListener(type, cb) {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type).add(cb);
  },
  removeEventListener(type, cb) {
    windowListeners.get(type)?.delete(cb);
  },
};

function setBrowserOnline(value) {
  onLineState.value = value;
  for (const cb of windowListeners.get(value ? 'online' : 'offline') ?? []) cb();
}

const {
  getConnectivityStatus,
  isOffline,
  shouldSkipNetwork,
  reportNetworkFailure,
  reportNetworkSuccess,
  subscribeConnectivity,
} = await import('../connectivity.ts');

const {
  buildOfflineAad,
  loadChatSnapshot,
  loadHomeSnapshot,
  offlineChatRecord,
  saveChatSnapshot,
  saveHomeSnapshot,
  sealSnapshot,
  unsealSnapshot,
  OFFLINE_CHAT_MESSAGE_LIMIT,
  OFFLINE_HOME_RECORD,
} = await import('../offlineStore.ts');

const { ensureSealingKey, loadSealingKey } = await import('../crypto/sealed-state.ts');
const { getState, deleteUserCryptoState } = await import('../crypto/storage.ts');

let seq = 0;
const freshUser = () => `offline-user-${++seq}-${Date.now()}`;

beforeEach(() => {
  onLineState.value = true;
  reportNetworkSuccess();
});

/* ------------------------------------------------------------------ */
/* 1. Offline detection                                                */
/* ------------------------------------------------------------------ */

test('O1: browser offline is detected', () => {
  assert.equal(getConnectivityStatus(), 'online');
  setBrowserOnline(false);
  assert.equal(getConnectivityStatus(), 'offline');
  assert.equal(isOffline(), true);
  assert.equal(shouldSkipNetwork(), true);
  setBrowserOnline(true);
  assert.equal(getConnectivityStatus(), 'online');
});

test('O2: navigator.onLine === true is not treated as proof of reachability', () => {
  assert.equal(getConnectivityStatus(), 'online');
  reportNetworkFailure();
  assert.equal(getConnectivityStatus(), 'unreachable');
  assert.equal(isOffline(), true);
  // A retry is still meaningful when the interface is up, so network calls
  // are NOT suppressed in the unreachable state.
  assert.equal(shouldSkipNetwork(), false);
  reportNetworkSuccess();
  assert.equal(getConnectivityStatus(), 'online');
});

test('O3: a returning interface clears a previous request failure', () => {
  reportNetworkFailure();
  assert.equal(getConnectivityStatus(), 'unreachable');
  setBrowserOnline(false);
  assert.equal(getConnectivityStatus(), 'offline');
  setBrowserOnline(true);
  assert.equal(getConnectivityStatus(), 'online');
});

test('O4: rapid transitions only notify on real status changes', () => {
  const seen = [];
  const off = subscribeConnectivity((s) => seen.push(s));
  for (let i = 0; i < 5; i++) {
    setBrowserOnline(false);
    setBrowserOnline(false);
    setBrowserOnline(true);
    setBrowserOnline(true);
  }
  off();
  assert.deepEqual(
    seen,
    ['offline', 'online', 'offline', 'online', 'offline', 'online', 'offline', 'online', 'offline', 'online'],
  );
  assert.equal(getConnectivityStatus(), 'online');
});

/* ------------------------------------------------------------------ */
/* 2. Offline snapshots                                                */
/* ------------------------------------------------------------------ */

const conn = (id, a, b) => ({
  id,
  user_a: a,
  user_b: b,
  status: 'accepted',
  created_at: '2026-01-01T10:00:00Z',
});
const msg = (id, connectionId, createdAt) => ({
  id,
  connection_id: connectionId,
  sender_id: 'peer',
  ciphertext: 'ENVELOPE',
  created_at: createdAt,
});

test('O5: Home snapshot round-trips and preserves ordering, unread and previews', async () => {
  const me = freshUser();
  await ensureSealingKey(me);
  const connections = [conn('c1', me, 'peer'), conn('c2', me, 'peer2')];
  await saveHomeSnapshot(me, {
    connections,
    profiles: { peer: { id: 'peer', username: 'anna', display_name: 'Anna' } },
    lastMessages: { c1: msg('m1', 'c1', '2026-02-01T10:00:00Z') },
    unread: { c1: 3 },
    deletedForMe: ['m9'],
  });
  const snapshot = await loadHomeSnapshot(me);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.connections.map((c) => c.id), ['c1', 'c2']);
  assert.equal(snapshot.profiles.peer.username, 'anna');
  assert.equal(snapshot.lastMessages.c1.id, 'm1');
  assert.equal(snapshot.unread.c1, 3);
  assert.deepEqual(snapshot.deletedForMe, ['m9']);
});

test('O6: Chat snapshot round-trips and keeps only the newest page', async () => {
  const me = freshUser();
  await ensureSealingKey(me);
  const messages = Array.from({ length: OFFLINE_CHAT_MESSAGE_LIMIT + 10 }, (_, i) =>
    msg(`m${i}`, 'c1', `2026-02-01T10:${String(i).padStart(2, '0')}:00Z`),
  );
  await saveChatSnapshot(me, 'c1', {
    connection: conn('c1', me, 'peer'),
    peer: { id: 'peer', username: 'anna', display_name: 'Anna' },
    messages,
    hiddenUntil: null,
    deletedForMe: ['m3'],
  });
  const snapshot = await loadChatSnapshot(me, 'c1');
  assert.ok(snapshot);
  assert.equal(snapshot.messages.length, OFFLINE_CHAT_MESSAGE_LIMIT);
  // Newest kept, ordering preserved.
  assert.equal(snapshot.messages.at(-1).id, `m${OFFLINE_CHAT_MESSAGE_LIMIT + 9}`);
  assert.deepEqual(snapshot.deletedForMe, ['m3']);
});

test('O7: a conversation that was never loaded has no snapshot (no fake data)', async () => {
  const me = freshUser();
  await ensureSealingKey(me);
  assert.equal(await loadChatSnapshot(me, 'never-opened'), null);
});

test('O8: the persisted record contains no readable metadata', async () => {
  const me = freshUser();
  await ensureSealingKey(me);
  await saveChatSnapshot(me, 'c1', {
    connection: conn('c1', me, 'peer'),
    peer: { id: 'peer', username: 'top-secret-username', display_name: 'Anna' },
    messages: [msg('m1', 'c1', '2026-02-01T10:00:00Z')],
    hiddenUntil: null,
    deletedForMe: [],
  });
  const raw = await getState(me, offlineChatRecord('c1'));
  const serialized = JSON.stringify(raw);
  assert.ok(!serialized.includes('top-secret-username'));
  assert.ok(!serialized.includes('ENVELOPE'));
});

/* ------------------------------------------------------------------ */
/* 3. Account isolation                                                */
/* ------------------------------------------------------------------ */

test('O9: user B cannot read user A cached Home/chat data', async () => {
  const userA = freshUser();
  const userB = freshUser();
  await ensureSealingKey(userA);
  await ensureSealingKey(userB);

  await saveHomeSnapshot(userA, {
    connections: [conn('c1', userA, 'peer')],
    profiles: {},
    lastMessages: {},
    unread: {},
    deletedForMe: [],
  });
  await saveChatSnapshot(userA, 'c1', {
    connection: conn('c1', userA, 'peer'),
    peer: null,
    messages: [msg('m1', 'c1', '2026-02-01T10:00:00Z')],
    hiddenUntil: null,
    deletedForMe: [],
  });

  // B has its own, empty namespace.
  assert.equal(await loadHomeSnapshot(userB), null);
  assert.equal(await loadChatSnapshot(userB, 'c1'), null);

  // Even copying A's sealed record into B's slot fails: the AAD binds the
  // owning user id AND the record key.
  const stolen = await getState(userA, OFFLINE_HOME_RECORD);
  const keyB = await loadSealingKey(userB);
  assert.equal(await unsealSnapshot(keyB, stolen, userB, OFFLINE_HOME_RECORD), null);
  const keyA = await loadSealingKey(userA);
  assert.equal(await unsealSnapshot(keyA, stolen, userB, OFFLINE_HOME_RECORD), null);
});

test('O10: tampering with the sealed body or record binding fails closed', async () => {
  const me = freshUser();
  const key = await ensureSealingKey(me);
  const envelope = await sealSnapshot(key, me, OFFLINE_HOME_RECORD, { connections: [] });
  // Genuine envelope unseals.
  assert.ok(await unsealSnapshot(key, envelope, me, OFFLINE_HOME_RECORD));
  // Flipped ciphertext byte.
  const tampered = { ...envelope, sealed: Uint8Array.from(envelope.sealed) };
  tampered.sealed[0] ^= 0xff;
  assert.equal(await unsealSnapshot(key, tampered, me, OFFLINE_HOME_RECORD), null);
  // Re-labelled record.
  const moved = { ...envelope, record: offlineChatRecord('c1') };
  assert.equal(await unsealSnapshot(key, moved, me, offlineChatRecord('c1')), null);
});

test('O11: AAD is injective and rejects separator injection', () => {
  const a = new TextDecoder().decode(buildOfflineAad('u1', 'offline:home'));
  const b = new TextDecoder().decode(buildOfflineAad('u1', 'offline:chat:home'));
  assert.notEqual(a, b);
  assert.throws(() => buildOfflineAad('u|1', 'offline:home'));
});

test('O12: account deletion wipes offline snapshots and the sealing key', async () => {
  const me = freshUser();
  await ensureSealingKey(me);
  await saveHomeSnapshot(me, {
    connections: [conn('c1', me, 'peer')],
    profiles: {},
    lastMessages: {},
    unread: {},
    deletedForMe: [],
  });
  await saveChatSnapshot(me, 'c1', {
    connection: conn('c1', me, 'peer'),
    peer: null,
    messages: [msg('m1', 'c1', '2026-02-01T10:00:00Z')],
    hiddenUntil: null,
    deletedForMe: [],
  });
  assert.ok(await getState(me, OFFLINE_HOME_RECORD));

  await deleteUserCryptoState(me);

  assert.equal(await getState(me, OFFLINE_HOME_RECORD), undefined);
  assert.equal(await getState(me, offlineChatRecord('c1')), undefined);
  assert.equal(await loadSealingKey(me), null);
  assert.equal(await loadHomeSnapshot(me), null);
});

test('O13: without the sealing key cached data is unreadable (fail closed)', async () => {
  const me = freshUser();
  await ensureSealingKey(me);
  await saveHomeSnapshot(me, {
    connections: [conn('c1', me, 'peer')],
    profiles: {},
    lastMessages: {},
    unread: {},
    deletedForMe: [],
  });
  const { deleteSealingKey } = await import('../crypto/sealed-state.ts');
  await deleteSealingKey(me);
  assert.equal(await loadHomeSnapshot(me), null);
});

/* ------------------------------------------------------------------ */
/* 4. Static guards over the shipped components                        */
/* ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');
const homeSrc = read('components/Home.tsx');
const chatSrc = read('components/Chat.tsx');
const composerSrc = read('components/MessageComposer.tsx');
const settingsSrc = read('components/Settings.tsx');

test('O14: Home renders the offline indicator and hydrates from the snapshot', () => {
  assert.match(homeSrc, /<OfflineBanner status=\{connectivity\} \/>/);
  assert.match(homeSrc, /if \(shouldSkipNetwork\(\)\) \{/);
  assert.match(homeSrc, /loadHomeSnapshot\(me\)/);
  assert.match(homeSrc, /saveHomeSnapshot\(me, \{/);
});

test('O15: Home does not query Supabase on the offline path', () => {
  const start = homeSrc.indexOf('if (shouldSkipNetwork()) {');
  const end = homeSrc.indexOf('const connsResult = await getMyConnections(me);');
  assert.ok(start > 0 && end > start);
  const offlineBranch = homeSrc.slice(start, end);
  for (const call of [
    'getMyConnections(',
    'getLastMessages(',
    'getProfiles(',
    'getReadState(',
    'getUnreadCounts(',
    'loadDeletionsForUser(',
  ]) {
    assert.ok(!offlineBranch.includes(call), `offline Home branch must not call ${call}`);
  }
  // And it must return before reaching the online path.
  assert.match(offlineBranch, /\n {8}return;\n {6}\}/);
});

test('O16: Chat renders cached messages offline without a network request', () => {
  assert.match(chatSrc, /<OfflineBanner status=\{connectivity\} \/>/);
  const start = chatSrc.indexOf('if (shouldSkipNetwork()) {');
  const end = chatSrc.indexOf('const found = await getConnection(connectionId);');
  assert.ok(start > 0 && end > start);
  const branch = chatSrc.slice(start, end);
  assert.ok(branch.includes('loadChatSnapshot(me, connectionId)'));
  for (const call of ['getConnection(', 'getProfiles(', 'getMessagesPage(', 'getBlockState(']) {
    assert.ok(!branch.includes(call), `offline Chat branch must not call ${call}`);
  }
});

test('O17: sending is disabled offline and nothing is queued', () => {
  assert.match(chatSrc, /disabled=\{!canChat \|\| blocked \|\| offline\}/);
  assert.match(chatSrc, /if \(offline\) return;/);
  // No outbox anywhere.
  for (const src of [homeSrc, chatSrc, composerSrc]) {
    assert.ok(!/outbox/i.test(src), 'no offline outbox may exist');
  }
});

test('O18: server-dependent actions are unavailable offline', () => {
  // Home: accept / decline / cancel buttons and the row action menu.
  assert.match(homeSrc, /disabled=\{busyId === conn\.id \|\| offline\}/);
  assert.match(homeSrc, /if \(offline\) return;\n {4}if \(isSelfConnection\(conn\)\)/);
  // Chat: message deletions and the chat menu.
  assert.match(chatSrc, /\.\.\.\(!offline && sheetTarget\.mine/);
  assert.match(chatSrc, /\.\.\.\(!offline && !sheetTarget\.message\.deleted_at/);
  // Chat: read state is not written to the server offline.
  assert.match(chatSrc, /if \(shouldSkipNetwork\(\)\) return;/);
  // Pagination is never attempted offline.
  assert.match(chatSrc, /!loadingOlder && !offline/);
  // People Search.
  assert.match(settingsSrc, /if \(shouldSkipNetwork\(\)\) \{/);
});

test('O19: reconnection resumes the existing online loading/realtime behavior', () => {
  assert.match(homeSrc, /if \(wasOffline && !offline && me\) load\(\);/);
  assert.match(chatSrc, /if \(wasOffline && !offline\) setReloadKey\(\(k\) => k \+ 1\);/);
  // Reconnection reuses the existing loaders and the unchanged P1-5 bridge:
  // no additional synchronization module was introduced.
  assert.match(homeSrc, /createHomeRealtimeBridge\(/);
  assert.ok(!/from '\.\.\/lib\/(sync|offlineSync|outbox)/.test(homeSrc));
});

test('O20: a stale async load result cannot overwrite current Home state', () => {
  // Every commit of the Home loader is gated by the monotonic load token.
  assert.match(homeSrc, /const token = \+\+loadTokenRef\.current;/);
  assert.match(
    homeSrc,
    /const isCurrent = \(\) =>\s*loadTokenRef\.current === token && meRef\.current === me;/,
  );
  const guards = homeSrc.match(/if \(!isCurrent\(\)\) return;/g) ?? [];
  assert.ok(guards.length >= 5, `expected the loader commits to be guarded, saw ${guards.length}`);
});

test('O21: E2EE display path is unchanged (cache + decryptForDisplay only)', () => {
  assert.match(chatSrc, /const cached = await getCachedPlaintext\(me, m\.id\)/);
  assert.match(chatSrc, /await decryptForDisplay\(\{/);
  // No plaintext fallback for peer messages was introduced.
  assert.ok(!/plaintextFallback|allowPlaintext/i.test(chatSrc));
  // The offline store never persists private key material.
  const storeSrc = read('lib/offlineStore.ts');
  assert.ok(!/privateKey|identityPair|prekey/i.test(storeSrc.replace(/^ *\*.*$/gm, '')));
});
