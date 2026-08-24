// enough. E2EE-v0.2 Phase 3/4 — production message-flow wiring tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/message-flow.test.mjs
//
// Tests the security-critical wiring logic (prepareSend / decryptForDisplay)
// with a MOCK session manager + a localStorage shim. The real engine path is
// covered by engine-adapter.test.mjs and session-manager.test.mjs; here we
// prove the SEND path never emits plaintext to the transport and the RECEIVE
// path resolves display plaintext only from cache/legacy/self/real-decrypt.

// localStorage shim (node has none); the message-cache keys on `window`.
const memStore = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => void memStore.set(k, String(v)),
  removeItem: (k) => void memStore.delete(k),
};

import '../../crypto/__tests__/setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { prepareSend, decryptForDisplay, isEnvelope } from '../message-flow.ts';
import { getCachedPlaintext, cachePlaintext, clearMessageCache } from '../message-cache.ts';
import { isCryptoError } from '../../crypto/errors.ts';

let seq = 0;
const freshUser = () => `mf-user-${++seq}`;
const CONN = 'conn-1';

function mockManager(opts = {}) {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    async encryptForPeer() {
      calls.encrypt += 1;
      if (opts.encryptThrows) throw opts.encryptThrows;
      return opts.encryptResult ?? '{"v":1,"e":"sw","t":2,"b":"YmFzZTY0"}';
    },
    async decryptFromPeer() {
      calls.decrypt += 1;
      return opts.decryptResult ?? { plaintext: 'DECRYPTED-TEXT', legacy: false };
    },
  };
}

function msg(over = {}) {
  return {
    id: over.id ?? 'm-1',
    connection_id: CONN,
    sender_id: over.sender_id ?? 'peer',
    ciphertext: over.ciphertext ?? 'hello',
    created_at: over.created_at ?? '2026-01-01T00:00:00Z',
    deleted_at: over.deleted_at ?? null,
    kind: over.kind ?? 'text',
    meta: over.meta ?? null,
  };
}

beforeEach(() => {
  memStore.clear();
});

test('MF1: prepareSend for a peer encrypts and returns an envelope (not plaintext)', async () => {
  const m = mockManager();
  const out = await prepareSend({ e2ee: m, isSelf: false, peerUserId: 'peer', connectionId: CONN, plaintext: 'secret' });
  assert.equal(m.calls.encrypt, 1);
  assert.equal(isEnvelope(out), true, 'result is an envelope');
  assert.notEqual(out, 'secret', 'plaintext is NOT returned to the transport');
});

test('MF2: prepareSend for My Notes (self) passes plaintext through (documented exception)', async () => {
  const m = mockManager();
  const out = await prepareSend({ e2ee: m, isSelf: true, peerUserId: 'me', connectionId: CONN, plaintext: 'note' });
  assert.equal(m.calls.encrypt, 0, 'self messages are not encrypted');
  assert.equal(out, 'note');
});

test('MF3: prepareSend for a peer with no manager FAILS CLOSED (NOT_AVAILABLE)', async () => {
  await assert.rejects(
    () => prepareSend({ e2ee: null, isSelf: false, peerUserId: 'peer', connectionId: CONN, plaintext: 'x' }),
    (e) => isCryptoError(e, 'NOT_AVAILABLE'),
  );
});

test('MF4: prepareSend on encryption failure throws and returns nothing (no plaintext send)', async () => {
  const m = mockManager({ encryptThrows: new Error('boom') });
  await assert.rejects(
    () => prepareSend({ e2ee: m, isSelf: false, peerUserId: 'peer', connectionId: CONN, plaintext: 'x' }),
  );
});

test('MF5: decryptForDisplay serves a cached plaintext without calling the engine', async () => {
  const me = freshUser();
  const m = mockManager();
  cachePlaintext(me, 'm-1', 'cached-text');
  const { plaintext } = await decryptForDisplay({ e2ee: m, isSelf: false, me, message: msg({ ciphertext: '{"v":1,"e":"sw","t":2,"b":"YQ=="}' }), connectionId: CONN });
  assert.equal(plaintext, 'cached-text');
  assert.equal(m.calls.decrypt, 0, 'cache hit must not invoke the engine');
});

test('MF6: decryptForDisplay for My Notes returns the row plaintext', async () => {
  const me = freshUser();
  const m = mockManager();
  const { plaintext } = await decryptForDisplay({ e2ee: m, isSelf: true, me, message: msg({ ciphertext: 'my note' }), connectionId: CONN });
  assert.equal(plaintext, 'my note');
  assert.equal(m.calls.decrypt, 0);
});

test('MF7: decryptForDisplay for a legacy plaintext row shows it as-is', async () => {
  const me = freshUser();
  const m = mockManager();
  const { plaintext } = await decryptForDisplay({ e2ee: m, isSelf: false, me, message: msg({ ciphertext: 'old plaintext', sender_id: 'peer' }), connectionId: CONN });
  assert.equal(plaintext, 'old plaintext');
  assert.equal(m.calls.decrypt, 0, 'legacy rows are not passed through the engine');
});

test('MF8: decryptForDisplay for an outgoing envelope without a cache returns null (sender cannot decrypt own message)', async () => {
  const me = freshUser();
  const m = mockManager();
  const { plaintext } = await decryptForDisplay({ e2ee: m, isSelf: false, me, message: msg({ ciphertext: '{"v":1,"e":"sw","t":2,"b":"YQ=="}', sender_id: me }), connectionId: CONN });
  assert.equal(plaintext, null);
  assert.equal(m.calls.decrypt, 0, 'must not attempt to decrypt the sender own message');
});

test('MF9: decryptForDisplay for an incoming envelope decrypts once and caches the plaintext', async () => {
  const me = freshUser();
  const m = mockManager();
  const { plaintext } = await decryptForDisplay({ e2ee: m, isSelf: false, me, message: msg({ ciphertext: '{"v":1,"e":"sw","t":2,"b":"YQ=="}', sender_id: 'peer' }), connectionId: CONN });
  assert.equal(plaintext, 'DECRYPTED-TEXT');
  assert.equal(m.calls.decrypt, 1);
  assert.equal(getCachedPlaintext(me, 'm-1'), 'DECRYPTED-TEXT', 'decrypted plaintext is cached locally');
});

test('MF10: decryptForDisplay for an incoming envelope with no manager returns null (no invented text)', async () => {
  const me = freshUser();
  const { plaintext } = await decryptForDisplay({ e2ee: null, isSelf: false, me, message: msg({ ciphertext: '{"v":1,"e":"sw","t":2,"b":"YQ=="}', sender_id: 'peer' }), connectionId: CONN });
  assert.equal(plaintext, null);
});

test('MF11: decryptForDisplay returns null for deleted and system messages', async () => {
  const me = freshUser();
  const m = mockManager();
  const d = await decryptForDisplay({ e2ee: m, isSelf: false, me, message: msg({ deleted_at: '2026-01-02T00:00:00Z' }), connectionId: CONN });
  assert.equal(d.plaintext, null);
  const s = await decryptForDisplay({ e2ee: m, isSelf: false, me, message: msg({ kind: 'name_change' }), connectionId: CONN });
  assert.equal(s.plaintext, null);
  assert.equal(m.calls.decrypt, 0);
});

test('MF12: a tampered / unparseable value is treated as legacy plaintext, never as an envelope', async () => {
  assert.equal(isEnvelope(''), false);
  assert.equal(isEnvelope('hello'), false);
  assert.equal(isEnvelope('{not json'), false);
  assert.equal(isEnvelope('{"v":2,"e":"sw","t":2,"b":"x"}'), false, 'wrong version rejected');
  assert.equal(isEnvelope('{"v":1,"e":"other","t":2,"b":"x"}'), false, 'wrong engine rejected');
  assert.equal(isEnvelope('{"v":1,"e":"sw","t":9,"b":"x"}'), false, 'bad type rejected');
  assert.equal(isEnvelope('{"v":1,"e":"sw","t":2,"b":"YQ=="}'), true);
});

test('MF13: clearMessageCache wipes local plaintext but is local-only', async () => {
  const me = freshUser();
  cachePlaintext(me, 'm-1', 'secret');
  assert.equal(getCachedPlaintext(me, 'm-1'), 'secret');
  clearMessageCache(me);
  assert.equal(getCachedPlaintext(me, 'm-1'), null);
});

test('MF14: user isolation — A and B caches do not cross', async () => {
  const a = freshUser();
  const b = freshUser();
  cachePlaintext(a, 'm-1', 'alice-text');
  assert.equal(getCachedPlaintext(a, 'm-1'), 'alice-text');
  assert.equal(getCachedPlaintext(b, 'm-1'), null, 'B cannot read A cache');
});
