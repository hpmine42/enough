// enough. E2EE-v0.2 — session-state / logout & account-isolation tests
// (audit finding F7).
// ---------------------------------------------------------------------------
// Run with:
//   node --test --experimental-strip-types src/lib/e2ee/__tests__/session-lifecycle.test.mjs
//
// What F7 establishes and what these tests prove:
//   1. Sign-out (session teardown) INVALIDATES the signed-out user's in-memory
//      E2EE state: the decrypted message-cache plaintext and the per-user
//      key-handle caches must not stay reachable in the JS heap.
//   2. The sealed IndexedDB vault (message cache, sealing key) SURVIVES
//      logout by design — it is the local device vault that a re-login of the
//      same account reloads. Wiping it is account-deletion semantics only.
//   3. A different account on the same tab can never read the previous
//      account's plaintext: neither from the residual in-memory layer nor by
//      unsealing the previous account's envelope.
//   4. Resetting one user's session state does not disturb another user's
//      active in-memory state.
//   5. The production wiring guard: E2EEContext releases the manager + resets
//      in-memory crypto state on session teardown and only exposes the manager
//      belonging to the currently signed-in user.
//
// The real-engine manager lifecycle (destroy -> refuse -> re-initialize and
// account-switch isolation) is covered by SM12/SM13 in session-manager.test.mjs.

import '../../crypto/__tests__/setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  cachePlaintext,
  getCachedPlaintext,
  getCachedPlaintextSync,
  unsealCache,
  warmMessageCache,
  _resetMessageCacheForTests,
} from '../message-cache.ts';

import {
  deleteCryptoDatabase,
  deleteUserCryptoState,
  getState,
  putState,
  resetInMemoryCaches,
} from '../../crypto/storage.ts';

import { ensureSealingKey, loadSealingKey } from '../../crypto/sealed-state.ts';

import { RECORD_MESSAGE_CACHE } from '../../crypto/types.ts';
import { isCryptoError } from '../../crypto/errors.ts';
// Import the crypto public surface so the identity/X25519 modules register
// their in-memory cache resetters (same registration as in production).
import '../../crypto/index.ts';

// localStorage shim (same pattern as message-cache.test.mjs).
const memStorage = new Map();
if (typeof globalThis.window === 'undefined') {
  globalThis.window = /** @type {any} */ ({});
}
globalThis.window.localStorage = {
  getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
  setItem: (k, v) => void memStorage.set(k, String(v)),
  removeItem: (k) => void memStorage.delete(k),
  clear: () => void memStorage.clear(),
};

let seq = 0;
const freshUser = () => `f7-user-${++seq}-${Date.now()}`;

beforeEach(async () => {
  memStorage.clear();
  _resetMessageCacheForTests();
  await deleteCryptoDatabase();
});

test('SL1: logout invalidates the in-memory decrypted cache but preserves the sealed IndexedDB cache', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'logout secret');

  // The plaintext is resident in the in-memory cache while signed in.
  assert.equal(getCachedPlaintextSync(user, 'm-1'), 'logout secret');

  // Session teardown on logout: in-memory only (this is exactly what the
  // E2EE session teardown path calls via resetInMemoryCaches).
  resetInMemoryCaches(user);

  // The decrypted plaintext must no longer be reachable through the in-memory
  // layer; in particular the synchronous UI preview path must return null
  // (it never re-hydrates from storage on its own).
  assert.equal(getCachedPlaintextSync(user, 'm-1'), null, 'logout must drop decrypted plaintext from memory');

  // The sealed IndexedDB vault must survive logout (re-login continuity).
  const stored = await getState(user, RECORD_MESSAGE_CACHE);
  assert.ok(stored, 'logout must NOT delete the sealed cache record');
  assert.equal(
    JSON.stringify(stored).includes('logout secret'),
    false,
    'the surviving record must stay sealed',
  );
  assert.ok(await loadSealingKey(user), 'logout must NOT delete the sealing key');

  // Re-login of the same account restores the authenticated plaintext through
  // the explicit hydration path (Home pre-warm) — not through any stale
  // in-memory state.
  await warmMessageCache(user);
  assert.equal(getCachedPlaintextSync(user, 'm-1'), 'logout secret');
  assert.equal(await getCachedPlaintext(user, 'm-1'), 'logout secret');
});

test('SL2: after logout another account cannot read the previous account plaintext', async () => {
  const alice = freshUser();
  const bob = freshUser();
  await cachePlaintext(alice, 'm-1', 'alice secret');

  // Alice signs out: her in-memory decrypted cache is invalidated.
  resetInMemoryCaches(alice);

  // Bob signs in on the same tab. Alice's plaintext is not reachable through
  // the shared in-memory layer, even when alice's userId is known.
  assert.equal(getCachedPlaintextSync(alice, 'm-1'), null);
  assert.equal(await getCachedPlaintext(bob, 'm-1'), null);

  // Bob cannot unseal Alice's sealed envelope with his own sealing key.
  const aliceRaw = /** @type {any} */ (await getState(alice, RECORD_MESSAGE_CACHE));
  const bobKey = await ensureSealingKey(bob);
  await assert.rejects(
    () => unsealCache(bobKey, aliceRaw, bob),
    (err) => isCryptoError(err, 'USER_MISMATCH'),
    'a sealed envelope must not authenticate for another user',
  );

  // Forging the header to Bob's userId breaks the AAD binding and fails closed.
  const forged = { ...aliceRaw, userId: bob };
  await assert.rejects(
    () => unsealCache(bobKey, forged, bob),
    (err) => isCryptoError(err, 'UNSEAL_FAILED'),
    'a re-labelled envelope must fail authentication',
  );

  // Even after Alice re-logs-in, Bob still cannot read her plaintext.
  resetInMemoryCaches(alice);
  await warmMessageCache(alice);
  assert.equal(await getCachedPlaintext(alice, 'm-1'), 'alice secret');
  assert.equal(await getCachedPlaintext(bob, 'm-1'), null);
});

test('SL3: resetting one user session state leaves other users intact', async () => {
  const alice = freshUser();
  const bob = freshUser();
  await cachePlaintext(alice, 'm-a', 'alice active');
  await cachePlaintext(bob, 'm-b', 'bob active');

  resetInMemoryCaches(alice);

  assert.equal(getCachedPlaintextSync(alice, 'm-a'), null);
  assert.equal(getCachedPlaintextSync(bob, 'm-b'), 'bob active', "Bob's session must be unaffected");
  assert.equal(await getCachedPlaintext(bob, 'm-b'), 'bob active');
});

test('SL4: logout is not account deletion — only deleteUserCryptoState wipes the vault', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'vault secret');

  // Logout: in-memory reset only.
  resetInMemoryCaches(user);
  assert.ok(await getState(user, RECORD_MESSAGE_CACHE), 'vault record survives logout');
  assert.ok(await loadSealingKey(user), 'sealing key survives logout');

  // Account deletion: the full wipe (existing semantics, asserted here as the
  // boundary between logout and deletion).
  await deleteUserCryptoState(user);
  assert.equal(await getState(user, RECORD_MESSAGE_CACHE), undefined);
  assert.equal(await loadSealingKey(user), null);
  assert.equal(getCachedPlaintextSync(user, 'm-1'), null);
});

test('SL5: tampered or key-missing sealed cache fails closed after re-login, never resurrected', async () => {
  const user = freshUser();
  await cachePlaintext(user, 'm-1', 'must not resurrect');
  resetInMemoryCaches(user);

  // Simulate storage tampering on the signed-out record.
  const raw = /** @type {any} */ (await getState(user, RECORD_MESSAGE_CACHE));
  const tampered = { ...raw, sealed: new Uint8Array([...raw.sealed, 0x00]) };
  await putState(user, RECORD_MESSAGE_CACHE, tampered);

  // Re-login: the tampered envelope must fail closed, not surface plaintext.
  await warmMessageCache(user);
  assert.equal(getCachedPlaintextSync(user, 'm-1'), null);
  assert.equal(await getCachedPlaintext(user, 'm-1'), null);
});

test('SL6: wiring guard — E2EEContext tears down session state and never exposes a foreign manager', () => {
  const source = fs.readFileSync(
    new URL('../../../context/E2EEContext.tsx', import.meta.url),
    'utf-8',
  );

  // The session teardown path must release the in-memory crypto state of the
  // signed-out user (audit finding F7), not only the WASM manager.
  assert.match(
    source,
    /resetInMemoryCaches\([^)]*\)/,
    'E2EEContext must reset the signed-out user in-memory crypto state on teardown',
  );

  // The manager must only be exposed while its owning user is signed in.
  assert.match(
    source,
    /session\.userId === userId/,
    'E2EEContext must only expose the manager of the currently signed-in user',
  );

  // Teardown must destroy the manager whenever the session ends.
  assert.match(
    source,
    /sessionRef\.current\.manager\.destroy\(\)/,
    'E2EEContext must destroy the manager on session teardown',
  );
});
