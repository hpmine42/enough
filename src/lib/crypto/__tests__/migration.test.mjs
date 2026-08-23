// enough. E2EE-2D.2 — migration, account deletion and schema-upgrade tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/crypto/__tests__/migration.test.mjs
//
// Covers:
//   * lazy migration of E2EE-2D (unsealed, Number-revision) records,
//   * account deletion clearing persistent state AND in-memory caches,
//   * the `onversionchange` upgrade blocker.

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadRatchetState, commitRatchetState, adoptSessionFromEstablishment } from '../ratchet-state.ts';
import { ensureSealingKey, loadSealingKey, isEnvelopeShaped } from '../sealed-state.ts';
import {
  CRYPTO_STORE_RATCHET,
  _resetSchemaObsoleteForTests,
  deleteCryptoDatabase,
  deleteUserCryptoState,
  isSchemaObsolete,
  onSchemaObsolete,
  openDatabase,
} from '../storage.ts';
import { CRYPTO_DB_NAME, CRYPTO_DB_VERSION, ratchetKeyFor, watermarkKeyFor } from '../types.ts';
import { hasIdentity, generateIdentity, loadIdentity } from '../identity.ts';
import { loadIdentityKeyPair, generateIdentityKeyPair, saveIdentityKeyPair } from '../keys.ts';

let seq = 0;
const freshUser = () => `mig-user-${++seq}`;
const CONN = 'conn-M';

async function reset() {
  _resetSchemaObsoleteForTests();
  await deleteCryptoDatabase();
}

async function rawPut(key, value) {
  const db = await openDatabase();
  try {
    const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
    t.objectStore(CRYPTO_STORE_RATCHET).put(value, key);
    await new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

async function rawGet(key) {
  const db = await openDatabase();
  try {
    const t = db.transaction(CRYPTO_STORE_RATCHET, 'readonly');
    const req = t.objectStore(CRYPTO_STORE_RATCHET).get(key);
    return await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } finally {
    db.close();
  }
}

/** A record in the exact E2EE-2D (v2) shape: unsealed, Number revision. */
function legacyRecord(userId, connectionId, revision, state) {
  return {
    version: 1,
    userId,
    connectionId,
    revision,
    state,
    committedAt: 1700000000000,
  };
}

/* ------------------------------------------------------------------ */
/* M1-M4. Lazy migration of v2 records                                 */
/* ------------------------------------------------------------------ */

test('M1: a healthy v2 record is migrated to a sealed envelope on first read', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);

  const state = new Uint8Array([1, 2, 3, 4, 5]);
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord(u, CONN, 4, state));
  await rawPut(watermarkKeyFor(u, CONN), 4);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'VALID');
  assert.equal(loaded.record.revision, 4n, 'the revision must be preserved exactly');
  assert.equal(loaded.record.epoch, 0n, 'migrated records land at epoch 0');
  assert.deepEqual(loaded.record.state, state, 'the state bytes must be preserved exactly');

  // On disk it must now be a sealed envelope, not the legacy shape.
  const stored = await rawGet(ratchetKeyFor(u, CONN));
  assert.equal(isEnvelopeShaped(stored), true);
  assert.equal(stored.revision instanceof Uint8Array, true);

  // And the session continues from there.
  const next = await commitRatchetState(u, CONN, { epoch: 0n, revision: 4n }, new Uint8Array([9]));
  assert.equal(next, 5n);
});

test('M2: migration is idempotent and stable across repeated loads', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord(u, CONN, 2, new Uint8Array([7, 7])));
  await rawPut(watermarkKeyFor(u, CONN), 2);

  const a = await loadRatchetState(u, CONN);
  const b = await loadRatchetState(u, CONN);
  const c = await loadRatchetState(u, CONN);
  for (const l of [a, b, c]) {
    assert.equal(l.status, 'VALID');
    assert.equal(l.revision, undefined);
    assert.equal(l.record.revision, 2n);
    assert.deepEqual(l.record.state, new Uint8Array([7, 7]));
  }
});

test('M3: a malformed v2 record is REJECTED, not migrated', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);

  // The H-2 payload in a legacy record: it must not be carried forward.
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord(u, CONN, 1e308, new Uint8Array([1])));
  await rawPut(watermarkKeyFor(u, CONN), 1);
  assert.equal((await loadRatchetState(u, CONN)).status, 'CORRUPTED');

  // Foreign owner in a legacy record.
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord('someone-else', CONN, 3, new Uint8Array([1])));
  assert.equal((await loadRatchetState(u, CONN)).status, 'USER_MISMATCH');

  // Negative and fractional revisions.
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord(u, CONN, -1, new Uint8Array([1])));
  assert.equal((await loadRatchetState(u, CONN)).status, 'CORRUPTED');
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord(u, CONN, 1.5, new Uint8Array([1])));
  assert.equal((await loadRatchetState(u, CONN)).status, 'CORRUPTED');
});

test('M4: a legacy watermark alone is honoured for rollback detection', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);

  // Legacy record at 2, legacy watermark at 9 → the record is stale.
  await rawPut(ratchetKeyFor(u, CONN), legacyRecord(u, CONN, 2, new Uint8Array([1])));
  await rawPut(watermarkKeyFor(u, CONN), 9);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'ROLLBACK_DETECTED');
  assert.equal(loaded.watermark.revision, 9n);
});

test('M5: missing state on an upgraded DB is MISSING, not an error', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);
  assert.equal((await loadRatchetState(u, CONN)).status, 'MISSING');
});

test('M6: the DB opens at version 3 with all four stores', async () => {
  await reset();
  const db = await openDatabase();
  try {
    assert.equal(db.version, CRYPTO_DB_VERSION);
    assert.equal(db.name, CRYPTO_DB_NAME);
    for (const store of ['state', 'prekeys', 'ratchet', 'vaultkeys']) {
      assert.equal(db.objectStoreNames.contains(store), true, `missing store ${store}`);
    }
  } finally {
    db.close();
  }
});

/* ------------------------------------------------------------------ */
/* M7-M9. Account deletion                                            */
/* ------------------------------------------------------------------ */

test('M7: after account deletion the identity is unusable WITHOUT a manual cache reset', async () => {
  await reset();
  const u = freshUser();

  await generateIdentity(u);
  const kp = await generateIdentityKeyPair();
  await saveIdentityKeyPair(u, kp);
  await adoptSessionFromEstablishment(u, CONN, new Uint8Array([1, 2, 3]));

  // Warm every in-memory cache, which is what a running tab would have done.
  assert.equal(await hasIdentity(u), true);
  assert.ok(await loadIdentity(u));
  assert.ok(await loadIdentityKeyPair(u));
  assert.ok(await loadSealingKey(u));

  await deleteUserCryptoState(u);

  // No _resetIdentityCacheForTests() / _resetX25519CacheForTests() here — that
  // is the point of the test. The audit found deletion left the caches live.
  assert.equal(await hasIdentity(u), false);
  assert.equal(await loadIdentityKeyPair(u), null);
  assert.equal(await loadIdentity(u), null);
  assert.equal(await loadSealingKey(u), null);
  assert.equal((await loadRatchetState(u, CONN)).status, 'MISSING');
});

test('M8: deleting one account leaves another account on the device intact', async () => {
  await reset();
  const keep = freshUser();
  const drop = freshUser();

  for (const u of [keep, drop]) {
    await generateIdentity(u);
    await saveIdentityKeyPair(u, await generateIdentityKeyPair());
    await adoptSessionFromEstablishment(u, CONN, new Uint8Array([1]));
  }

  await deleteUserCryptoState(drop);

  assert.equal(await hasIdentity(drop), false);
  assert.equal(await hasIdentity(keep), true, 'the other account must survive');
  assert.ok(await loadIdentityKeyPair(keep));
  assert.ok(await loadSealingKey(keep));
  assert.equal((await loadRatchetState(keep, CONN)).status, 'VALID');
});

test('M9: a recreated account does not inherit the deleted sealing key', async () => {
  await reset();
  const u = freshUser();
  await ensureSealingKey(u);
  const before = await loadSealingKey(u);
  await adoptSessionFromEstablishment(u, CONN, new Uint8Array([1]));

  await deleteUserCryptoState(u);
  const after = await ensureSealingKey(u);

  assert.notEqual(before, after, 'a fresh key object must be created');
  // The new session starts clean at epoch 1.
  const established = await adoptSessionFromEstablishment(u, CONN, new Uint8Array([2]));
  assert.deepEqual(established, { epoch: 1n, revision: 1n });
});

/* ------------------------------------------------------------------ */
/* M10-M12. onversionchange                                            */
/* ------------------------------------------------------------------ */

test('M10: an open connection closes itself on versionchange and does not block', async () => {
  await reset();

  // Hold a connection open, exactly as a stale tab would.
  const stale = await openDatabase();
  assert.equal(isSchemaObsolete(), false);

  let notified = false;
  onSchemaObsolete(() => {
    notified = true;
  });

  // Another "tab" upgrades the database to a higher version.
  const upgraded = await new Promise((resolve, reject) => {
    const req = indexedDB.open(CRYPTO_DB_NAME, CRYPTO_DB_VERSION + 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('future-store');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // If the stale connection did not close itself this fires and the upgrade
    // hangs — that is the blocker the audit found.
    req.onblocked = () => reject(new Error('UPGRADE BLOCKED by the stale connection'));
  });

  try {
    assert.equal(upgraded.version, CRYPTO_DB_VERSION + 1, 'the upgrade must complete');
    assert.equal(isSchemaObsolete(), true, 'the obsolescence latch must be set');
    assert.equal(notified, true, 'subscribers must be notified');
  } finally {
    upgraded.close();
    try {
      stale.close();
    } catch {
      /* already closed by the handler */
    }
    _resetSchemaObsoleteForTests();
    await deleteCryptoDatabase();
  }
});

test('M11: a late subscriber is notified immediately when the latch is set', async () => {
  await reset();
  const stale = await openDatabase();
  const upgraded = await new Promise((resolve, reject) => {
    const req = indexedDB.open(CRYPTO_DB_NAME, CRYPTO_DB_VERSION + 1);
    req.onupgradeneeded = () => req.result.createObjectStore('future-store-2');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('UPGRADE BLOCKED'));
  });

  try {
    let late = false;
    onSchemaObsolete(() => {
      late = true;
    });
    assert.equal(late, true, 'subscribing after the fact must fire immediately');
  } finally {
    upgraded.close();
    try {
      stale.close();
    } catch {
      /* ignore */
    }
    _resetSchemaObsoleteForTests();
    await deleteCryptoDatabase();
  }
});

test('M12: unsubscribing stops notifications', async () => {
  await reset();
  let count = 0;
  const off = onSchemaObsolete(() => {
    count += 1;
  });
  off();

  const stale = await openDatabase();
  const upgraded = await new Promise((resolve, reject) => {
    const req = indexedDB.open(CRYPTO_DB_NAME, CRYPTO_DB_VERSION + 1);
    req.onupgradeneeded = () => req.result.createObjectStore('future-store-3');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('UPGRADE BLOCKED'));
  });

  try {
    assert.equal(count, 0, 'an unsubscribed listener must not fire');
    assert.equal(isSchemaObsolete(), true);
  } finally {
    upgraded.close();
    try {
      stale.close();
    } catch {
      /* ignore */
    }
    _resetSchemaObsoleteForTests();
    await deleteCryptoDatabase();
  }
});

/* ------------------------------------------------------------------ */
/* M13. durability: 'strict'                                           */
/* ------------------------------------------------------------------ */

test("M13: security-critical writes request durability: 'strict'", async () => {
  // Mutation guard #2. Scope of this test, stated honestly:
  //
  // `fake-indexeddb` cannot simulate real durability — there is no disk, no
  // fsync and no power loss, so no test in this environment can prove that a
  // committed record survives an OS crash. What IS observable is the
  // `durability` property of the transaction, which the spec exposes. So this
  // test verifies that the flag is actually requested on the write paths,
  // which is what deleting it from the source would change.
  //
  // What remains unverified: whether the browser honours the request. That
  // needs a real browser on real hardware and is listed as an open item in
  // docs/e2ee-crash-rollback-hardening.md.
  await reset();
  const db = await openDatabase();
  try {
    const strict = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', { durability: 'strict' });
    const relaxed = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', { durability: 'relaxed' });
    assert.equal(strict.durability, 'strict');
    assert.equal(relaxed.durability, 'relaxed');
    assert.notEqual(
      strict.durability,
      relaxed.durability,
      'the environment must be able to distinguish the two, or this guard is vacuous',
    );
  } finally {
    db.close();
  }

  // Now assert it on the real code paths by observing the transactions the
  // implementation opens.
  const observed = [];
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function patched(stores, mode, opts) {
    const t = original.call(this, stores, mode, opts);
    if (mode === 'readwrite') observed.push({ stores: String(stores), durability: t.durability });
    return t;
  };
  try {
    const u = freshUser();
    await adoptSessionFromEstablishment(u, CONN, new Uint8Array([1, 2, 3]));
    await commitRatchetState(u, CONN, { epoch: 1n, revision: 1n }, new Uint8Array([4, 5, 6]));
    await deleteUserCryptoState(u);
  } finally {
    IDBDatabase.prototype.transaction = original;
  }

  assert.ok(observed.length > 0, 'the code must have opened readwrite transactions');
  for (const t of observed) {
    assert.equal(
      t.durability,
      'strict',
      `readwrite transaction on ${t.stores} must request strict durability`,
    );
  }
});
