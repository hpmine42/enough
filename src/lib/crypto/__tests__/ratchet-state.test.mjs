// enough. E2EE-2D — crash-/rollback-hardening tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/crypto/__tests__/ratchet-state.test.mjs
//
// These tests run against Node's Web Crypto + fake-indexeddb. No Supabase,
// no network, no real key material. The "state" blobs here are opaque
// non-secret fixtures — this layer never interprets them.
//
// Emphasis is on proving that WRONG behaviour is REJECTED, not merely that
// the happy path works.

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_REVISION,
  commitRatchetState,
  deleteUserRatchetState,
  getRatchetWatermark,
  loadRatchetState,
  restoreRatchetSnapshot,
} from '../ratchet-state.ts';

import {
  SimulatedCrash,
  decryptAndCommit,
  encryptCommitSend,
  exportRatchetSnapshot,
} from '../ratchet-session.ts';

import { deleteCryptoDatabase, deleteUserCryptoState, openDatabase, CRYPTO_STORE_RATCHET } from '../storage.ts';
import { ratchetKeyFor, watermarkKeyFor } from '../types.ts';
import { isCryptoError } from '../errors.ts';

/** Deterministic opaque "state" fixture. Not secret, not a real ratchet. */
const S = (n) => new Uint8Array([n, n + 1, n + 2, n + 3]);

let seq = 0;
const freshUser = () => `user-${++seq}`;
const CONN = 'conn-A';

async function reset() {
  await deleteCryptoDatabase();
}

/** Assert that a promise rejects with a CryptoError of the given code. */
async function assertRejectsWithCode(fn, code) {
  await assert.rejects(fn, (err) => {
    assert.ok(isCryptoError(err), `expected CryptoError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* A. Revision semantics                                               */
/* ------------------------------------------------------------------ */

test('A1: first commit starts at revision 1 and is readable', async () => {
  await reset();
  const u = freshUser();
  const rev = await commitRatchetState(u, CONN, INITIAL_REVISION, S(1));
  assert.equal(rev, 1);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'VALID');
  assert.equal(loaded.record.revision, 1);
  assert.deepEqual(loaded.record.state, S(1));
});

test('A2: revisions increase monotonically across many commits', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  let previous = -1;
  for (let i = 0; i < 25; i++) {
    rev = await commitRatchetState(u, CONN, rev, S(i));
    assert.ok(rev > previous, `revision must increase: ${rev} !> ${previous}`);
    previous = rev;
  }
  assert.equal(rev, 25);
  assert.equal(await getRatchetWatermark(u, CONN), 25);
});

test('A3: committing with an OLDER expected revision is REJECTED', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 0; i < 8; i++) rev = await commitRatchetState(u, CONN, rev, S(i));
  assert.equal(rev, 8);

  // current = 8, incoming claims to have seen 7 -> must fail (task §5 A).
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, 7, S(99)), 'REVISION_CONFLICT');

  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 8, 'state must be untouched after a rejected write');
});

test('A4: committing with a FUTURE expected revision is REJECTED', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(1));
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, 5, S(2)), 'REVISION_CONFLICT');
});

test('A5: state and revision are always mutually consistent', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 1; i <= 6; i++) {
    rev = await commitRatchetState(u, CONN, rev, S(i * 10));
    const loaded = await loadRatchetState(u, CONN);
    // The record carries both, written in one transaction — they cannot drift.
    assert.equal(loaded.record.revision, rev);
    assert.deepEqual(loaded.record.state, S(i * 10));
  }
});

/* ------------------------------------------------------------------ */
/* B. Crash consistency                                                */
/* ------------------------------------------------------------------ */

test('B1: crash BEFORE commit leaves the previous state current (nothing externalized)', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0)); // rev 1 = S0

  let sent = false;
  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: S(1) }),
        send: () => {
          sent = true;
        },
        failAt: 'BeforeCommit',
      }),
    SimulatedCrash,
  );

  assert.equal(sent, false, 'nothing may be sent when the commit did not happen');
  const after = await loadRatchetState(u, CONN);
  assert.equal(after.status, 'VALID');
  assert.equal(after.record.revision, 1, 'uncommitted state must not be adopted');
  assert.deepEqual(after.record.state, S(0));
});

test('B2: crash AFTER commit keeps S1 — S0 is never reloaded', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));

  let sent = false;
  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: S(1) }),
        send: () => {
          sent = true;
        },
        failAt: 'AfterCommit',
      }),
    SimulatedCrash,
  );

  assert.equal(sent, false, 'crash fired before send');
  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 2);
  assert.deepEqual(after.record.state, S(1), 'committed S1 must survive; S0 must not come back');
});

test('B3: crash BEFORE send keeps the committed state (message lost, key never reused)', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));

  let sent = false;
  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        encrypt: () => ({ ciphertext: new Uint8Array([7]), nextState: S(1) }),
        send: () => {
          sent = true;
        },
        failAt: 'BeforeSend',
      }),
    SimulatedCrash,
  );

  assert.equal(sent, false);
  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 2, 'state stays advanced: losing a message beats reusing a key');
});

test('B4: crash AFTER send keeps the committed state', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));

  let sent = false;
  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        encrypt: () => ({ ciphertext: new Uint8Array([9]), nextState: S(1) }),
        send: () => {
          sent = true;
        },
        failAt: 'AfterSend',
      }),
    SimulatedCrash,
  );

  assert.equal(sent, true, 'the message did go out');
  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 2);
  assert.deepEqual(after.record.state, S(1));
});

test('B5: the sequencer commits BEFORE it sends (ordering is observable)', async () => {
  await reset();
  const u = freshUser();
  const order = [];

  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    encrypt: () => {
      order.push('encrypt');
      return { ciphertext: new Uint8Array([1]), nextState: S(1) };
    },
    send: async () => {
      // Observe the durable state at the moment of sending.
      const at = await loadRatchetState(u, CONN);
      order.push(`send(rev=${at.record.revision})`);
    },
  });

  assert.deepEqual(order, ['encrypt', 'send(rev=1)'],
    'the state must already be committed when send() runs');
});

test('B6: a failing send does NOT roll the committed state back', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));

  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: S(1) }),
        send: () => {
          throw new Error('network down');
        },
      }),
    /network down/,
  );

  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 2, 'a transport failure must never rewind the ratchet');
});

/* ------------------------------------------------------------------ */
/* C. Rollback                                                         */
/* ------------------------------------------------------------------ */

test('C1: restoring an older snapshot is REJECTED (snapshot A=10 vs B=11)', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 0; i < 10; i++) rev = await commitRatchetState(u, CONN, rev, S(i));
  const snapshotA = await exportRatchetSnapshot(u, CONN); // revision 10
  assert.equal(snapshotA.revision, 10);

  rev = await commitRatchetState(u, CONN, rev, S(11));
  const snapshotB = await exportRatchetSnapshot(u, CONN); // revision 11
  assert.equal(snapshotB.revision, 11);

  // Restoring B over B is not newer than the watermark -> rejected as well.
  await assertRejectsWithCode(() => restoreRatchetSnapshot(u, CONN, snapshotB), 'ROLLBACK_DETECTED');

  // The important one: A must never come back.
  await assertRejectsWithCode(() => restoreRatchetSnapshot(u, CONN, snapshotA), 'ROLLBACK_DETECTED');

  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 11, 'newer state must remain');
});

test('C2: a stale writer (old tab) cannot overwrite a newer revision', async () => {
  await reset();
  const u = freshUser();
  const r5 = await commitRatchetState(u, CONN, INITIAL_REVISION, S(5));
  assert.equal(r5, 1);

  // Two tabs both read revision 1.
  const tabA = (await loadRatchetState(u, CONN)).record.revision;
  const tabB = (await loadRatchetState(u, CONN)).record.revision;
  assert.equal(tabA, tabB);

  // Tab A commits -> revision 2.
  const advanced = await commitRatchetState(u, CONN, tabA, S(6));
  assert.equal(advanced, 2);

  // Tab B still believes it is at revision 1 -> must fail, not overwrite.
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, tabB, S(66)), 'REVISION_CONFLICT');

  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 2);
  assert.deepEqual(after.record.state, S(6), "tab A's state must win");
});

test('C3: a rolled-back store (record older than watermark) is DETECTED on load', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 0; i < 4; i++) rev = await commitRatchetState(u, CONN, rev, S(i));
  assert.equal(rev, 4);

  // Simulate a restored backup / partially rolled-back IndexedDB by writing an
  // older record directly behind the abstraction's back. The watermark, which
  // a naive restore would not know about, still says 4.
  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).put(
    { version: 1, userId: u, connectionId: CONN, revision: 2, state: S(2), committedAt: Date.now() },
    ratchetKeyFor(u, CONN),
  );
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'ROLLBACK_DETECTED');
  assert.equal(loaded.watermark, 4);
});

test('C4: encrypting on a rollback-detected state is REFUSED', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 0; i < 3; i++) rev = await commitRatchetState(u, CONN, rev, S(i));

  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).put(
    { version: 1, userId: u, connectionId: CONN, revision: 1, state: S(1), committedAt: Date.now() },
    ratchetKeyFor(u, CONN),
  );
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  let encryptCalled = false;
  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        encrypt: () => {
          encryptCalled = true;
          return { ciphertext: new Uint8Array([1]), nextState: S(9) };
        },
        send: () => {},
      }),
    'ROLLBACK_DETECTED',
  );
  assert.equal(encryptCalled, false, 'must refuse BEFORE deriving another message key');
});

test('C5: a vanished record with a live watermark is a rollback, not a fresh session', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(1));

  // Wipe only the record, leaving the watermark (partial storage loss).
  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).delete(ratchetKeyFor(u, CONN));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'ROLLBACK_DETECTED',
    'a missing record with a non-zero watermark must not look like a new session');
});

/* ------------------------------------------------------------------ */
/* D. Concurrency                                                      */
/* ------------------------------------------------------------------ */

test('D1: concurrent commits from the same revision — exactly one wins', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));
  const base = (await loadRatchetState(u, CONN)).record.revision;

  const results = await Promise.allSettled([
    commitRatchetState(u, CONN, base, S(1)),
    commitRatchetState(u, CONN, base, S(2)),
    commitRatchetState(u, CONN, base, S(3)),
  ]);

  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1, 'exactly one writer may win');
  assert.equal(failed.length, 2);
  for (const f of failed) {
    assert.ok(isCryptoError(f.reason, 'REVISION_CONFLICT'), `expected REVISION_CONFLICT, got ${f.reason?.code}`);
  }

  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, base + 1, 'no double increment, no silent overwrite');
});

test('D2: concurrent encryptCommitSend — losers do not send', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));

  let sends = 0;
  const attempt = (n) =>
    encryptCommitSend({
      userId: u,
      connectionId: CONN,
      encrypt: () => ({ ciphertext: new Uint8Array([n]), nextState: S(n) }),
      send: () => {
        sends++;
      },
    });

  const results = await Promise.allSettled([attempt(1), attempt(2), attempt(3)]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1, 'only one concurrent send may proceed');
  assert.equal(sends, 1, 'a ciphertext from a losing writer must never be transmitted');
});

test('D3: sequential commits after a conflict recover correctly', async () => {
  await reset();
  const u = freshUser();
  let rev = await commitRatchetState(u, CONN, INITIAL_REVISION, S(0));
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, INITIAL_REVISION, S(1)), 'REVISION_CONFLICT');
  // Re-read and retry with the correct revision.
  rev = (await loadRatchetState(u, CONN)).record.revision;
  const next = await commitRatchetState(u, CONN, rev, S(2));
  assert.equal(next, rev + 1);
});

/* ------------------------------------------------------------------ */
/* E. Isolation                                                        */
/* ------------------------------------------------------------------ */

test('E1: two connections of the same user have independent revisions', async () => {
  await reset();
  const u = freshUser();
  let a = INITIAL_REVISION;
  for (let i = 0; i < 10; i++) a = await commitRatchetState(u, 'conn-A', a, S(i));
  let b = INITIAL_REVISION;
  for (let i = 0; i < 4; i++) b = await commitRatchetState(u, 'conn-B', b, S(i));

  assert.equal(a, 10);
  assert.equal(b, 4);
  assert.equal((await loadRatchetState(u, 'conn-A')).record.revision, 10);
  assert.equal((await loadRatchetState(u, 'conn-B')).record.revision, 4, 'writes to A must not touch B');
});

test('E2: the same connectionId under two users never shares state', async () => {
  await reset();
  const userA = freshUser();
  const userB = freshUser();
  const shared = 'conn-SHARED';

  await commitRatchetState(userA, shared, INITIAL_REVISION, S(1));
  await commitRatchetState(userA, shared, 1, S(2));
  await commitRatchetState(userB, shared, INITIAL_REVISION, S(50));

  const a = await loadRatchetState(userA, shared);
  const b = await loadRatchetState(userB, shared);
  assert.equal(a.record.revision, 2);
  assert.equal(b.record.revision, 1);
  assert.deepEqual(a.record.state, S(2));
  assert.deepEqual(b.record.state, S(50), 'cross-account state leak would be a critical bug');
});

test('E3: a record whose embedded userId disagrees with the key is USER_MISMATCH', async () => {
  await reset();
  const u = freshUser();
  const other = freshUser();
  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).put(
    { version: 1, userId: other, connectionId: CONN, revision: 3, state: S(1), committedAt: Date.now() },
    ratchetKeyFor(u, CONN),
  );
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'USER_MISMATCH');
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, 3, S(4)), 'USER_MISMATCH');
});

test('E4: account deletion removes ratchet state AND its watermark', async () => {
  await reset();
  const u = freshUser();
  const keep = freshUser();
  await commitRatchetState(u, 'conn-A', INITIAL_REVISION, S(1));
  await commitRatchetState(u, 'conn-B', INITIAL_REVISION, S(2));
  await commitRatchetState(keep, 'conn-A', INITIAL_REVISION, S(3));

  await deleteUserRatchetState(u);

  assert.equal((await loadRatchetState(u, 'conn-A')).status, 'MISSING');
  assert.equal((await loadRatchetState(u, 'conn-B')).status, 'MISSING');
  assert.equal(await getRatchetWatermark(u, 'conn-A'), 0, 'watermark must go too, else the account cannot restart');
  assert.equal((await loadRatchetState(keep, 'conn-A')).status, 'VALID', 'other users must be untouched');
});

test('E5: deleteUserCryptoState also clears ratchet state', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(1));
  await deleteUserCryptoState(u);
  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'MISSING');
  assert.equal(loaded.watermark, 0);
});

/* ------------------------------------------------------------------ */
/* F. Recovery                                                         */
/* ------------------------------------------------------------------ */

test('F1: missing state reports MISSING (and may start a fresh session)', async () => {
  await reset();
  const u = freshUser();
  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'MISSING');
  assert.equal(loaded.watermark, 0);
});

test('F2: corrupted records are reported, never silently repaired', async () => {
  await reset();
  const u = freshUser();
  const bad = [
    'not-an-object',
    42,
    { version: 1, userId: 'x', connectionId: 'y' }, // no state/revision
    { version: 1, userId: null, connectionId: CONN, revision: -1, state: S(1) }, // negative revision
    { version: 1, userId: null, connectionId: CONN, revision: 1.5, state: S(1) }, // non-integer revision
    { version: 1, userId: null, connectionId: CONN, revision: 1, state: 'nope' }, // state not bytes
    { userId: null, connectionId: CONN, revision: 1, state: S(1) }, // missing version
  ];

  for (const [i, value] of bad.entries()) {
    const u2 = `${u}-corrupt-${i}`;
    const db = await openDatabase();
    const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
    const payload =
      value && typeof value === 'object' && 'userId' in value && value.userId === null
        ? { ...value, userId: u2 }
        : value;
    t.objectStore(CRYPTO_STORE_RATCHET).put(payload, ratchetKeyFor(u2, CONN));
    await new Promise((res, rej) => {
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    db.close();

    const loaded = await loadRatchetState(u2, CONN);
    assert.equal(loaded.status, 'CORRUPTED', `case ${i} should be CORRUPTED, got ${loaded.status}`);
  }
});

test('F3: committing over a corrupt record is REFUSED (no blind overwrite)', async () => {
  await reset();
  const u = freshUser();
  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).put({ garbage: true }, ratchetKeyFor(u, CONN));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  await assertRejectsWithCode(() => commitRatchetState(u, CONN, INITIAL_REVISION, S(1)), 'CORRUPT_STATE');
});

test('F4: a tampered (inflated) revision cannot be used to force a downgrade later', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 0; i < 3; i++) rev = await commitRatchetState(u, CONN, rev, S(i));

  // Attacker inflates the revision field of the record but cannot lower the
  // watermark. Load still succeeds (record >= watermark) — this is the
  // documented limit of an unauthenticated store — but the subsequent commit
  // raises the watermark, so the real state can never be replayed afterwards.
  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).put(
    { version: 1, userId: u, connectionId: CONN, revision: 999, state: S(3), committedAt: Date.now() },
    ratchetKeyFor(u, CONN),
  );
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'VALID');
  await commitRatchetState(u, CONN, 999, S(4)); // watermark jumps to 1000
  // The genuine older state can no longer be reinstated.
  await assertRejectsWithCode(
    () =>
      restoreRatchetSnapshot(u, CONN, {
        version: 1,
        userId: u,
        connectionId: CONN,
        revision: 3,
        state: S(3),
        committedAt: Date.now(),
      }),
    'ROLLBACK_DETECTED',
  );
});

test('F5: invalid arguments are rejected before touching storage', async () => {
  await reset();
  const u = freshUser();
  await assertRejectsWithCode(() => commitRatchetState('', CONN, 0, S(1)), 'NOT_INITIALIZED');
  await assertRejectsWithCode(() => commitRatchetState(u, '', 0, S(1)), 'NOT_INITIALIZED');
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, -1, S(1)), 'CORRUPT_STATE');
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, 1.5, S(1)), 'CORRUPT_STATE');
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, 0, 'not-bytes'), 'CORRUPT_STATE');
});

/* ------------------------------------------------------------------ */
/* G. Replay / duplicate / idempotency                                 */
/* ------------------------------------------------------------------ */

test('G1: idempotency ladder — commit S1, S1, S0, S2, S1', async () => {
  await reset();
  const u = freshUser();

  // commit(S1) from revision 0 -> revision 1
  const r1 = await commitRatchetState(u, CONN, INITIAL_REVISION, S(1));
  assert.equal(r1, 1);

  // commit(S1) again with the SAME expected revision -> rejected (already committed)
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, INITIAL_REVISION, S(1)), 'REVISION_CONFLICT');

  // commit(S0) as a downgrade attempt -> rejected
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, INITIAL_REVISION, S(0)), 'REVISION_CONFLICT');

  // commit(S2) from the current revision -> success
  const r2 = await commitRatchetState(u, CONN, r1, S(2));
  assert.equal(r2, 2);

  // commit(S1) again from the stale revision -> rejected
  await assertRejectsWithCode(() => commitRatchetState(u, CONN, r1, S(1)), 'REVISION_CONFLICT');

  const after = await loadRatchetState(u, CONN);
  assert.equal(after.record.revision, 2);
  assert.deepEqual(after.record.state, S(2));
});

test('G2: re-encrypting after a restored older state is prevented at the persistence layer', async () => {
  await reset();
  const u = freshUser();

  // Send message A: state advances S0 -> S1, committed at revision 1.
  const ciphertexts = [];
  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    encrypt: () => ({ ciphertext: new Uint8Array([0xaa]), nextState: S(1) }),
    send: (ct) => {
      ciphertexts.push(ct);
    },
  });
  assert.equal((await loadRatchetState(u, CONN)).record.revision, 1);

  // An attacker/backup restores the pre-send state S0 at revision 0.
  await assertRejectsWithCode(
    () =>
      restoreRatchetSnapshot(u, CONN, {
        version: 1,
        userId: u,
        connectionId: CONN,
        revision: 0,
        state: S(0),
        committedAt: Date.now(),
      }),
    'ROLLBACK_DETECTED',
  );

  // The next encrypt therefore proceeds from S1, never re-deriving the message
  // key that ciphertext A already consumed.
  const seen = [];
  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    encrypt: (cur) => {
      seen.push(cur);
      return { ciphertext: new Uint8Array([0xbb]), nextState: S(2) };
    },
    send: () => {},
  });
  assert.deepEqual(seen[0], S(1), 'must continue from the committed state, not the restored one');
});

test('G3: receive side — decrypt commits and cannot be rolled back', async () => {
  await reset();
  const u = freshUser();
  await commitRatchetState(u, CONN, INITIAL_REVISION, S(10)); // R10 at revision 1

  const res = await decryptAndCommit({
    userId: u,
    connectionId: CONN,
    decrypt: () => ({ plaintext: new Uint8Array([1, 2]), nextState: S(11) }),
  });
  assert.equal(res.revision, 2);

  // Restoring R10 must fail.
  await assertRejectsWithCode(
    () =>
      restoreRatchetSnapshot(u, CONN, {
        version: 1,
        userId: u,
        connectionId: CONN,
        revision: 1,
        state: S(10),
        committedAt: Date.now(),
      }),
    'ROLLBACK_DETECTED',
  );

  const after = await loadRatchetState(u, CONN);
  assert.deepEqual(after.record.state, S(11), 'receive-side replay window must stay closed');
});

test('G4: receive side refuses to decrypt on a rolled-back state', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  for (let i = 0; i < 3; i++) rev = await commitRatchetState(u, CONN, rev, S(i));

  const db = await openDatabase();
  const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
  t.objectStore(CRYPTO_STORE_RATCHET).put(
    { version: 1, userId: u, connectionId: CONN, revision: 1, state: S(0), committedAt: Date.now() },
    ratchetKeyFor(u, CONN),
  );
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();

  let decryptCalled = false;
  await assertRejectsWithCode(
    () =>
      decryptAndCommit({
        userId: u,
        connectionId: CONN,
        decrypt: () => {
          decryptCalled = true;
          return { plaintext: new Uint8Array([1]), nextState: S(9) };
        },
      }),
    'ROLLBACK_DETECTED',
  );
  assert.equal(decryptCalled, false);
});

/* ------------------------------------------------------------------ */
/* H. Deterministic state-machine property check                       */
/* ------------------------------------------------------------------ */

test('H1: property — persisted revision never decreases under a random operation mix', async () => {
  await reset();
  const u = freshUser();

  // Small deterministic LCG so the sequence is reproducible across runs.
  let seed = 0x2d2d2d;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  const ops = ['commit', 'staleCommit', 'crashBeforeCommit', 'crashAfterCommit', 'rollback', 'load'];
  let highest = 0;
  let staleRevision = 0; // a deliberately outdated view, like a parked tab
  const snapshots = [];

  for (let i = 0; i < 240; i++) {
    const op = ops[rnd(ops.length)];
    const before = await loadRatchetState(u, CONN);
    const beforeRev = before.status === 'VALID' ? before.record.revision : 0;
    assert.ok(beforeRev >= highest, `observed revision went backwards: ${beforeRev} < ${highest}`);

    try {
      if (op === 'commit') {
        const rev = await commitRatchetState(u, CONN, beforeRev, S(i % 250));
        if (rnd(4) === 0) snapshots.push(await exportRatchetSnapshot(u, CONN));
      } else if (op === 'staleCommit') {
        await commitRatchetState(u, CONN, staleRevision, S(i % 250));
      } else if (op === 'crashBeforeCommit') {
        await encryptCommitSend({
          userId: u,
          connectionId: CONN,
          encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: S(i % 250) }),
          send: () => {},
          failAt: 'BeforeCommit',
        });
      } else if (op === 'crashAfterCommit') {
        await encryptCommitSend({
          userId: u,
          connectionId: CONN,
          encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: S(i % 250) }),
          send: () => {},
          failAt: 'AfterCommit',
        });
      } else if (op === 'rollback' && snapshots.length) {
        await restoreRatchetSnapshot(u, CONN, snapshots[rnd(snapshots.length)]);
      } else if (op === 'load') {
        staleRevision = beforeRev > 0 ? beforeRev - 1 : 0;
      }
    } catch (err) {
      // Only the anticipated, explicit rejections may occur.
      const okCodes = ['REVISION_CONFLICT', 'ROLLBACK_DETECTED', 'CORRUPT_STATE'];
      const isExpected = err instanceof SimulatedCrash || (isCryptoError(err) && okCodes.includes(err.code));
      assert.ok(isExpected, `unexpected failure: ${err?.name} ${err?.code ?? ''} ${err?.message}`);
    }

    const after = await loadRatchetState(u, CONN);
    const afterRev = after.status === 'VALID' ? after.record.revision : 0;
    assert.notEqual(after.status, 'ROLLBACK_DETECTED', 'no operation may leave the store rolled back');
    assert.notEqual(after.status, 'CORRUPTED', 'no operation may corrupt the store');
    assert.ok(afterRev >= beforeRev, `revision decreased: ${afterRev} < ${beforeRev} after ${op}`);
    highest = Math.max(highest, afterRev);

    const wm = await getRatchetWatermark(u, CONN);
    assert.ok(wm >= highest, `watermark ${wm} fell behind highest revision ${highest}`);
  }

  assert.ok(highest > 0, 'the run should have committed at least once');
});

test('H2: property — watermark is never exceeded by a later downgrade', async () => {
  await reset();
  const u = freshUser();
  let rev = INITIAL_REVISION;
  const taken = [];
  for (let i = 0; i < 12; i++) {
    rev = await commitRatchetState(u, CONN, rev, S(i));
    taken.push(await exportRatchetSnapshot(u, CONN));
  }
  const wm = await getRatchetWatermark(u, CONN);
  // Every historical snapshot must now be refused.
  for (const snap of taken) {
    await assertRejectsWithCode(() => restoreRatchetSnapshot(u, CONN, snap), 'ROLLBACK_DETECTED');
  }
  assert.equal(await getRatchetWatermark(u, CONN), wm, 'failed restores must not move the watermark');
});
