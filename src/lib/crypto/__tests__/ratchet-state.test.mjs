// enough. E2EE-2D / 2D.2 — crash-, rollback- and CAS-hardening tests.
//
// Run with:
//   node --test --experimental-strip-types src/lib/crypto/__tests__/ratchet-state.test.mjs
//
// These tests run against Node's Web Crypto + fake-indexeddb. No Supabase,
// no network, no real key material. The "state" blobs here are opaque
// non-secret fixtures — this layer never interprets them.
//
// Emphasis is on proving that WRONG behaviour is REJECTED, not merely that
// the happy path works. Several tests are written specifically as mutation
// guards and say so in a comment, so that deleting the corresponding check in
// the implementation turns a test red.

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_EPOCH,
  INITIAL_REVISION,
  MAX_REVISION,
  adoptSessionFromEstablishment,
  commitRatchetState,
  deleteUserRatchetState,
  getRatchetWatermark,
  loadRatchetState,
} from '../ratchet-state.ts';

import {
  SimulatedCrash,
  decryptAndCommit,
  encryptCommitSend,
  inspectSession,
} from '../ratchet-session.ts';

import { encodeRevision } from '../revision.ts';
import { ensureSealingKey, seal } from '../sealed-state.ts';
import {
  CRYPTO_STORE_RATCHET,
  deleteCryptoDatabase,
  deleteUserCryptoState,
  openDatabase,
} from '../storage.ts';
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

async function assertRejectsWithCode(fn, code) {
  await assert.rejects(fn, (err) => {
    assert.ok(isCryptoError(err), `expected CryptoError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

/** Establish a session and return its {epoch, revision}. */
async function establish(userId, connectionId = CONN, state = S(0)) {
  return adoptSessionFromEstablishment(userId, connectionId, state);
}

/** Raw read/write helpers used to simulate tampering and storage damage. */
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

async function rawPut(key, value) {
  const db = await openDatabase();
  try {
    const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
    t.objectStore(CRYPTO_STORE_RATCHET).put(value, key);
    await new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

async function rawDelete(key) {
  const db = await openDatabase();
  try {
    const t = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite');
    t.objectStore(CRYPTO_STORE_RATCHET).delete(key);
    await new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

/** A minimal engine factory: deterministic, disposable, no real crypto. */
function makeEngineFactory(log = []) {
  return (state) => {
    const instance = {
      id: log.length,
      disposed: false,
      used: false,
      encrypt(plaintext) {
        assert.equal(this.used, false, 'an ephemeral engine must be used at most once');
        assert.equal(this.disposed, false, 'a disposed engine must not encrypt');
        this.used = true;
        return {
          ciphertext: new Uint8Array([...state, ...plaintext]),
          nextState: new Uint8Array([...state, plaintext.length]),
        };
      },
      decrypt(ciphertext) {
        assert.equal(this.used, false, 'an ephemeral engine must be used at most once');
        this.used = true;
        return {
          plaintext: new Uint8Array([...ciphertext].reverse()),
          nextState: new Uint8Array([...state, 0xff]),
        };
      },
      dispose() {
        this.disposed = true;
      },
    };
    log.push(instance);
    return instance;
  };
}

/* ------------------------------------------------------------------ */
/* A. Revision semantics                                               */
/* ------------------------------------------------------------------ */

test('A1: an established session starts at epoch 1 / revision 1', async () => {
  await reset();
  const u = freshUser();
  const { epoch, revision } = await establish(u);
  assert.equal(epoch, 1n);
  assert.equal(revision, 1n);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'VALID');
  assert.equal(loaded.record.revision, 1n);
  assert.deepEqual(loaded.record.state, S(0));
});

test('A2: revisions increase monotonically across many commits', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u);
  let revision = 1n;
  let previous = 0n;
  for (let i = 0; i < 25; i++) {
    revision = await commitRatchetState(u, CONN, { epoch, revision }, S(i));
    assert.ok(revision > previous, `revision must increase: ${revision} !> ${previous}`);
    previous = revision;
  }
  assert.equal(revision, 26n);
  const wm = await getRatchetWatermark(u, CONN);
  assert.equal(wm.revision, 26n);
});

test('A3: committing with an OLDER expected revision is REJECTED', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u);
  const r2 = await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2));
  await commitRatchetState(u, CONN, { epoch, revision: r2 }, S(3));

  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, { epoch, revision: 1n }, S(9)),
    'REVISION_CONFLICT',
  );
});

test('A4: committing with a FUTURE expected revision is REJECTED', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u);
  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, { epoch, revision: 99n }, S(9)),
    'REVISION_CONFLICT',
  );
});

test('A5: state and revision stay mutually consistent', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  let revision = 1n;
  const seen = new Map([[1n, S(1)]]);
  for (let i = 2; i <= 6; i++) {
    revision = await commitRatchetState(u, CONN, { epoch, revision }, S(i));
    seen.set(revision, S(i));
    const loaded = await loadRatchetState(u, CONN);
    assert.equal(loaded.status, 'VALID');
    assert.deepEqual(loaded.record.state, seen.get(loaded.record.revision));
  }
});

test('A6: a commit at the uint64 ceiling FAILS CLOSED (H-2)', async () => {
  await reset();
  const u = freshUser();
  await establish(u);
  // Mutation guard #10: without the overflow check this wraps or repeats.
  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, { epoch: 1n, revision: MAX_REVISION }, S(1)),
    'REVISION_OVERFLOW',
  );
});

test('A7: a Number revision is refused at the API boundary', async () => {
  await reset();
  const u = freshUser();
  await establish(u);
  for (const bad of [1, 1e308, 2 ** 53, -1, 1.5, NaN, '1']) {
    await assertRejectsWithCode(
      () => commitRatchetState(u, CONN, { epoch: 1n, revision: bad }, S(1)),
      'CORRUPT_STATE',
    );
  }
});

/* ------------------------------------------------------------------ */
/* B. Crash points and ordering                                        */
/* ------------------------------------------------------------------ */

test('B1: crash BEFORE commit leaves the previous state current', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  const sent = [];

  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
        send: (c) => void sent.push(c),
        failAt: 'BeforeCommit',
      }),
    SimulatedCrash,
  );

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.record.revision, 1n);
  assert.deepEqual(loaded.record.state, S(1));
  assert.equal(sent.length, 0, 'nothing may be externalized before a commit');
});

test('B2: crash AFTER commit keeps the advanced state', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
        send: () => {},
        failAt: 'AfterCommit',
      }),
    SimulatedCrash,
  );

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.record.revision, 2n, 'the committed state must survive');
});

test('B3: crash BEFORE send keeps the committed state (message lost, key never reused)', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  const sent = [];

  await assert.rejects(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
        send: (c) => void sent.push(c),
        failAt: 'BeforeSend',
      }),
    SimulatedCrash,
  );

  assert.equal(sent.length, 0);
  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.record.revision, 2n);
});

test('B4: the sequencer commits BEFORE it sends (ordering is observable)', async () => {
  // Mutation guard #8: swapping commit and send reverses this order.
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  const order = [];

  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    plaintext: new Uint8Array([1]),
    createEngine: (state) => ({
      encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: new Uint8Array([...state, 1]) }),
      dispose: () => {},
    }),
    send: async () => {
      // At the moment of sending, the new revision must already be durable.
      const loaded = await loadRatchetState(u, CONN);
      order.push(`send@rev${loaded.record.revision}`);
    },
  });

  assert.deepEqual(order, ['send@rev2'], 'send must observe the committed revision');
});

test('B5: a failing send does NOT roll the committed state back', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  await assert.rejects(() =>
    encryptCommitSend({
      userId: u,
      connectionId: CONN,
      plaintext: new Uint8Array([1]),
      createEngine: makeEngineFactory(),
      send: () => {
        throw new Error('network down');
      },
    }),
  );

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.record.revision, 2n, 'a transport failure must not undo the ratchet');
});

/* ------------------------------------------------------------------ */
/* C. Rollback                                                         */
/* ------------------------------------------------------------------ */

test('C1: a stale record beneath a live watermark is DETECTED on load', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  let revision = 1n;
  const key = await ensureSealingKey(u);
  const oldEnvelope = await seal(key, u, CONN, epoch, 2n, S(2));
  for (let i = 0; i < 4; i++) {
    revision = await commitRatchetState(u, CONN, { epoch, revision }, S(i));
  }
  assert.equal(revision, 5n);

  // Put back a genuinely sealed OLD envelope, leaving the watermark at 5.
  await rawPut(ratchetKeyFor(u, CONN), oldEnvelope);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'ROLLBACK_DETECTED');
  assert.equal(loaded.watermark.revision, 5n);
});

test('C2: forging a higher revision onto an old state is REJECTED (audit C-2)', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  const key = await ensureSealingKey(u);

  // A genuine state committed at revision 5 …
  const genuine = await seal(key, u, CONN, epoch, 5n, S(5));
  // … re-labelled as revision 500, exactly as in the audit.
  const forged = { ...genuine, revision: encodeRevision(500n) };
  await rawPut(ratchetKeyFor(u, CONN), forged);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'UNSEAL_FAILED', 'a forged revision must not authenticate');
  assert.notEqual(loaded.status, 'VALID');
  assert.equal(loaded.record, undefined);

  // And it must not be usable as a base for further commits either.
  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, { epoch, revision: 500n }, S(9)),
    'UNSEAL_FAILED',
  );
});

test('C3: a vanished record with a live watermark is a rollback, not a fresh session', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2));

  await rawDelete(ratchetKeyFor(u, CONN));

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'ROLLBACK_DETECTED');
  assert.notEqual(loaded.status, 'MISSING');
});

test('C4: encrypting on a rollback-detected state is REFUSED', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2));
  await rawDelete(ratchetKeyFor(u, CONN));

  const sent = [];
  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
        send: (c) => void sent.push(c),
      }),
    'ROLLBACK_DETECTED',
  );
  assert.equal(sent.length, 0);
});

test('C5: a deleted watermark beside a live record is WEDGED, not "no watermark"', async () => {
  // Mutation guard #1 (watermark check removed) and audit finding C-3:
  // treating an absent watermark as zero switches rollback detection off.
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2));

  await rawDelete(watermarkKeyFor(u, CONN));

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'WEDGED');
  assert.notEqual(loaded.status, 'VALID');
});

test('C6: a malformed watermark is WEDGED and blocks commits', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));

  for (const bad of [{ epoch: 1, revision: 2 }, 'nope', { epoch: new Uint8Array(3) }, 1e308]) {
    await rawPut(watermarkKeyFor(u, CONN), bad);
    const loaded = await loadRatchetState(u, CONN);
    assert.equal(loaded.status, 'WEDGED', `watermark ${JSON.stringify(String(bad))} must wedge`);
    await assertRejectsWithCode(
      () => commitRatchetState(u, CONN, { epoch, revision: 1n }, S(3)),
      'WEDGED',
    );
  }
});

test('C7: a stale writer (old tab) cannot overwrite a newer revision', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  const staleView = { epoch, revision: 1n };

  await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2)); // other tab
  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, staleView, S(99)),
    'REVISION_CONFLICT',
  );

  const loaded = await loadRatchetState(u, CONN);
  assert.deepEqual(loaded.record.state, S(2));
});

test('C8: EXPECTED_LIMITATION — a coordinated full-origin rollback is NOT detectable locally', async () => {
  // Audit finding C-1, deliberately left open at the end of E2EE-2D.2.
  //
  // This test does not assert that the system detects the attack. It asserts
  // the OPPOSITE, so the gap stays visible in CI and cannot be quietly
  // re-labelled as solved. A full origin restore rolls the record, the
  // watermark AND the sealing key back together; every local check then
  // passes because everything the checks consult was restored consistently.
  //
  // Closing this requires an anchor outside the origin. Note that a
  // server-side epoch incremented at ESTABLISHMENT would not be enough: it is
  // constant during a session and so takes the same value before and after the
  // rollback performed here. See C9 for the cross-epoch variant and
  // docs/e2ee-crash-rollback-hardening.md §8.1 for the rejected designs.
  // Either way it is explicitly NOT part of this stage.
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  let revision = 1n;

  // Take a snapshot of the whole origin state at revision 2.
  revision = await commitRatchetState(u, CONN, { epoch, revision }, S(2));
  assert.equal(revision, 2n);
  const snapshotRecord = await rawGet(ratchetKeyFor(u, CONN));
  const snapshotWatermark = await rawGet(watermarkKeyFor(u, CONN));

  // Advance to revision 5.
  for (let i = 0; i < 3; i++) {
    revision = await commitRatchetState(u, CONN, { epoch, revision }, S(10 + i));
  }
  assert.equal(revision, 5n);
  assert.equal((await getRatchetWatermark(u, CONN)).revision, 5n);

  // Restore BOTH record and watermark, as a profile/backup restore would.
  await rawPut(ratchetKeyFor(u, CONN), snapshotRecord);
  await rawPut(watermarkKeyFor(u, CONN), snapshotWatermark);

  const loaded = await loadRatchetState(u, CONN);

  // EXPECTED_LIMITATION: full-origin rollback cannot be detected by a local
  // anchor. The state is genuinely sealed and internally consistent.
  assert.equal(loaded.status, 'VALID', 'EXPECTED_LIMITATION: C-1 is not locally detectable');
  assert.equal(loaded.record.revision, 2n);
  assert.equal(loaded.watermark.revision, 2n);

  // The tampering-based rollbacks REMAIN detected — only the *coordinated*
  // whole-origin case slips through.
  await rawPut(watermarkKeyFor(u, CONN), { epoch: encodeRevision(1n), revision: encodeRevision(5n) });
  assert.equal((await loadRatchetState(u, CONN)).status, 'ROLLBACK_DETECTED');
});

test('C9: EXPECTED_LIMITATION — a coordinated rollback ACROSS an epoch boundary is not detected either', async () => {
  // Audit finding C-1, second half. C8 covers the INTRA-epoch case
  // (revision 5 → 2 while the epoch stays constant). This test covers the
  // complementary CROSS-epoch case: a whole-origin restore that also undoes a
  // later re-establishment, taking the session from epoch 2 back to epoch 1.
  //
  // Why it needs its own test: the `record.epoch < watermark.epoch` check in
  // `loadRatchetState` looks like it would catch an epoch regression, and it
  // does — but only when the watermark is NOT restored along with the record.
  // A coordinated restore moves both, so the comparison is satisfied again at
  // the older epoch. This test pins that distinction so nobody concludes from
  // the presence of `EPOCH_STALE` that cross-epoch rollback is covered.
  //
  // It also records the practical consequence, which C8 does not assert: the
  // rolled-back state is not merely readable, it is WRITABLE. That is what
  // turns C-1 from a stale-read problem into re-use of already-consumed
  // (cipher key, IV) pairs.
  //
  // As in C8 the assertions describe the CURRENT, deliberately open behaviour.
  // If a future external freshness anchor closes C-1, this test is expected to
  // fail and must be rewritten — it is not a guarantee that must be preserved.
  await reset();
  const u = freshUser();

  // Epoch 1, advanced to revision 3.
  const first = await establish(u, CONN, S(1));
  assert.deepEqual(first, { epoch: 1n, revision: 1n });
  let revision = await commitRatchetState(u, CONN, { epoch: 1n, revision: 1n }, S(2));
  revision = await commitRatchetState(u, CONN, { epoch: 1n, revision }, S(3));
  assert.equal(revision, 3n);

  // Snapshot the entire origin state while it is still on epoch 1.
  const snapshotRecord = await rawGet(ratchetKeyFor(u, CONN));
  const snapshotWatermark = await rawGet(watermarkKeyFor(u, CONN));

  // A new establishment supersedes it: epoch 2, revision back to 1.
  const second = await adoptSessionFromEstablishment(u, CONN, S(9), { replacesEpoch: 1n });
  assert.deepEqual(second, { epoch: 2n, revision: 1n });

  const live = await loadRatchetState(u, CONN);
  assert.equal(live.status, 'VALID');
  assert.equal(live.record.epoch, 2n, 'the live session must be on the new epoch');

  // Restore record AND watermark together, as a profile/backup restore would.
  await rawPut(ratchetKeyFor(u, CONN), snapshotRecord);
  await rawPut(watermarkKeyFor(u, CONN), snapshotWatermark);

  // EXPECTED_LIMITATION: the epoch regression 2 → 1 is NOT detected. Both the
  // record and the watermark are genuine, sealed and mutually consistent.
  const rolled = await loadRatchetState(u, CONN);
  assert.equal(
    rolled.status,
    'VALID',
    'EXPECTED_LIMITATION: C-1 also covers cross-epoch rollback, which is not locally detectable',
  );
  assert.equal(rolled.record.epoch, 1n, 'the session is back on the superseded epoch');
  assert.equal(rolled.record.revision, 3n);
  assert.equal(rolled.watermark.epoch, 1n);

  // EXPECTED_LIMITATION: and the superseded state accepts further commits, so
  // the ratchet would keep deriving keys from a chain that was already retired.
  const next = await commitRatchetState(u, CONN, { epoch: 1n, revision: 3n }, S(7));
  assert.equal(next, 4n, 'EXPECTED_LIMITATION: the rolled-back epoch is still writable');
  const after = await loadRatchetState(u, CONN);
  assert.equal(after.status, 'VALID');
  assert.equal(after.record.epoch, 1n);
  assert.equal(after.record.revision, 4n);

  // Contrast — the UNCOORDINATED variant is still caught. Restoring only the
  // record while the watermark stays on the newer epoch is `EPOCH_STALE`, so
  // the epoch check itself is intact; only the coordinated restore defeats it.
  await rawPut(ratchetKeyFor(u, CONN), snapshotRecord);
  await rawPut(watermarkKeyFor(u, CONN), { epoch: encodeRevision(2n), revision: encodeRevision(1n) });
  assert.equal((await loadRatchetState(u, CONN)).status, 'EPOCH_STALE');
});

/* ------------------------------------------------------------------ */
/* D. Concurrency                                                      */
/* ------------------------------------------------------------------ */

test('D1: concurrent commits from the same revision — exactly one wins', async () => {
  // Mutation guard #7: removing the CAS check lets more than one win.
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));

  const attempts = Array.from({ length: 50 }, (_, i) =>
    commitRatchetState(u, CONN, { epoch, revision: 1n }, S(i)).then(
      (r) => ({ ok: true, r }),
      (e) => ({ ok: false, e }),
    ),
  );
  const results = await Promise.all(attempts);
  const winners = results.filter((x) => x.ok);
  assert.equal(winners.length, 1, `exactly one writer may win, got ${winners.length}`);
  assert.equal(winners[0].r, 2n);
  for (const loser of results.filter((x) => !x.ok)) {
    assert.ok(isCryptoError(loser.e, 'REVISION_CONFLICT'));
  }
});

test('D2: concurrent encryptCommitSend — losers do not send, and leave no engine residue', async () => {
  // Audit finding H-1. Each attempt gets its OWN engine; the losing attempts
  // must send nothing and must have disposed their engines.
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  const engines = [];
  const sent = [];
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([i]),
        createEngine: makeEngineFactory(engines),
        send: (c) => void sent.push(c),
      }).then(
        (r) => ({ ok: true, r }),
        (e) => ({ ok: false, e }),
      ),
    ),
  );

  assert.equal(results.filter((x) => x.ok).length, 1, 'exactly one attempt may succeed');
  assert.equal(sent.length, 1, 'exactly one ciphertext may be externalized');
  assert.equal(engines.length, 5, 'every attempt must build its own engine');
  for (const e of engines) {
    assert.equal(e.disposed, true, 'every ephemeral engine must be disposed');
  }

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.record.revision, 2n, 'only one advance may be persisted');
});

test('D3: sequential commits after a conflict recover correctly', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2));

  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, { epoch, revision: 1n }, S(3)),
    'REVISION_CONFLICT',
  );

  const loaded = await loadRatchetState(u, CONN);
  const revision = await commitRatchetState(
    u,
    CONN,
    { epoch: loaded.record.epoch, revision: loaded.record.revision },
    S(4),
  );
  assert.equal(revision, 3n);
});

/* ------------------------------------------------------------------ */
/* E. Isolation and deletion                                           */
/* ------------------------------------------------------------------ */

test('E1: two connections of the same user have independent state', async () => {
  await reset();
  const u = freshUser();
  const a = await establish(u, 'conn-1', S(1));
  const b = await establish(u, 'conn-2', S(2));
  await commitRatchetState(u, 'conn-1', { epoch: a.epoch, revision: a.revision }, S(3));

  const l1 = await loadRatchetState(u, 'conn-1');
  const l2 = await loadRatchetState(u, 'conn-2');
  assert.equal(l1.record.revision, 2n);
  assert.equal(l2.record.revision, 1n);
  assert.deepEqual(l2.record.state, S(2));
});

test('E2: the same connectionId under two users never shares state', async () => {
  await reset();
  const u1 = freshUser();
  const u2 = freshUser();
  await establish(u1, CONN, S(1));
  await establish(u2, CONN, S(2));

  assert.deepEqual((await loadRatchetState(u1, CONN)).record.state, S(1));
  assert.deepEqual((await loadRatchetState(u2, CONN)).record.state, S(2));
});

test('E3: a record whose sealed identity disagrees with the slot is rejected', async () => {
  await reset();
  const u1 = freshUser();
  const u2 = freshUser();
  await establish(u1, CONN, S(1));
  await establish(u2, CONN, S(2));

  // Move user 1's genuine envelope into user 2's slot.
  const stolen = await rawGet(ratchetKeyFor(u1, CONN));
  await rawPut(ratchetKeyFor(u2, CONN), stolen);

  const loaded = await loadRatchetState(u2, CONN);
  assert.equal(loaded.status, 'USER_MISMATCH');
  assert.notEqual(loaded.status, 'VALID');
});

test('E4: account deletion removes ratchet state AND its watermark', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  await deleteUserRatchetState(u);

  assert.equal(await rawGet(ratchetKeyFor(u, CONN)), undefined);
  assert.equal(await rawGet(watermarkKeyFor(u, CONN)), undefined);
  assert.equal((await getRatchetWatermark(u, CONN)).revision, 0n);
});

test('E5: deleteUserCryptoState also clears ratchet state and the sealing key', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  await deleteUserCryptoState(u);

  assert.equal(await rawGet(ratchetKeyFor(u, CONN)), undefined);
  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'MISSING');
});

/* ------------------------------------------------------------------ */
/* F. Missing state / fail-closed (audit H-3)                          */
/* ------------------------------------------------------------------ */

test('F1: a never-used connection reports MISSING', async () => {
  await reset();
  const u = freshUser();
  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'MISSING');
  assert.equal(loaded.record, undefined);
});

test('F2: MISSING never becomes a fresh session on the send path (H-3)', async () => {
  // Mutation guard #9: re-enabling "MISSING → fresh session" turns this green
  // only if the test insists on the refusal.
  await reset();
  const u = freshUser();
  const sent = [];
  const engines = [];

  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(engines),
        send: (c) => void sent.push(c),
      }),
    'NEEDS_ESTABLISH',
  );

  assert.equal(sent.length, 0);
  assert.equal(engines.length, 0, 'no engine may even be constructed');
  // Crucially: the failed send must not have created anything.
  assert.equal((await loadRatchetState(u, CONN)).status, 'MISSING');
  assert.equal((await getRatchetWatermark(u, CONN)).revision, 0n);
});

test('F3: the receive path also refuses to create a session', async () => {
  await reset();
  const u = freshUser();
  await assertRejectsWithCode(
    () =>
      decryptAndCommit({
        userId: u,
        connectionId: CONN,
        ciphertext: new Uint8Array([1, 2, 3]),
        createEngine: makeEngineFactory(),
      }),
    'NEEDS_ESTABLISH',
  );
  assert.equal((await loadRatchetState(u, CONN)).status, 'MISSING');
});

test('F4: existing identity + missing ratchet state still halts (no implicit session)', async () => {
  await reset();
  const u = freshUser();
  // A sealing key exists (the user has used crypto before) but no session.
  await ensureSealingKey(u);

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'MISSING');
  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
        send: () => {},
      }),
    'NEEDS_ESTABLISH',
  );
});

test('F5: a sealed record whose key disappeared is KEY_MISSING, not MISSING', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  // Simulate the key being lost while the sealed data survives.
  const db = await openDatabase();
  try {
    const t = db.transaction('vaultkeys', 'readwrite');
    t.objectStore('vaultkeys').delete(`${u}:sealing-key`);
    await new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } finally {
    db.close();
  }

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'KEY_MISSING');
  assert.notEqual(loaded.status, 'MISSING', 'an unreadable session must not look like a new one');

  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
        send: () => {},
      }),
    'KEY_MISSING',
  );
});

test('F6: corrupted records are reported, never silently repaired', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  for (const bad of [
    null,
    42,
    'garbage',
    {},
    { version: 3, userId: u, connectionId: CONN },
    { version: 99, userId: u, connectionId: CONN, epoch: encodeRevision(1n), revision: encodeRevision(1n), iv: new Uint8Array(12), sealed: new Uint8Array(32) },
  ]) {
    await rawPut(ratchetKeyFor(u, CONN), bad);
    const loaded = await loadRatchetState(u, CONN);
    // `null` reads as "no record"; beneath a live watermark that is a
    // rollback, which is the correct fail-closed answer for it.
    assert.ok(
      ['CORRUPTED', 'UNSEAL_FAILED', 'WEDGED', 'ROLLBACK_DETECTED'].includes(loaded.status),
      `expected a failure status for ${String(bad)}, got ${loaded.status}`,
    );
    assert.notEqual(loaded.status, 'VALID');
    assert.notEqual(loaded.status, 'MISSING');
    // The bad record must still be there — never auto-deleted.
    assert.notEqual(await rawGet(ratchetKeyFor(u, CONN)), undefined);
  }
});

test('F7: committing over a corrupt record is REFUSED (no blind overwrite)', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  await rawPut(ratchetKeyFor(u, CONN), { totally: 'broken' });

  await assertRejectsWithCode(
    () => commitRatchetState(u, CONN, { epoch: 1n, revision: 1n }, S(9)),
    'CORRUPT_STATE',
  );
});

test('F8: invalid arguments are rejected before touching storage', async () => {
  await assertRejectsWithCode(() => loadRatchetState('', CONN), 'NOT_INITIALIZED');
  await assertRejectsWithCode(() => loadRatchetState('u', ''), 'NOT_INITIALIZED');
  await assertRejectsWithCode(
    () => commitRatchetState('u', CONN, { epoch: 0n, revision: 0n }, 'not-bytes'),
    'CORRUPT_STATE',
  );
});

/* ------------------------------------------------------------------ */
/* G. Establishment semantics                                          */
/* ------------------------------------------------------------------ */

test('G1: establishment advances the epoch and restarts the revision', async () => {
  await reset();
  const u = freshUser();
  const first = await establish(u, CONN, S(1));
  assert.deepEqual(first, { epoch: 1n, revision: 1n });

  await commitRatchetState(u, CONN, { epoch: 1n, revision: 1n }, S(2));

  const second = await adoptSessionFromEstablishment(u, CONN, S(3), { replacesEpoch: 1n });
  assert.deepEqual(second, { epoch: 2n, revision: 1n });

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.status, 'VALID', 'a new epoch at revision 1 is NEWER, not a rollback');
  assert.equal(loaded.record.epoch, 2n);
  assert.equal(loaded.record.revision, 1n);
});

test('G2: establishment over a live session requires naming the epoch it replaces', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  await assertRejectsWithCode(
    () => adoptSessionFromEstablishment(u, CONN, S(2)),
    'REVISION_CONFLICT',
  );
  await assertRejectsWithCode(
    () => adoptSessionFromEstablishment(u, CONN, S(2), { replacesEpoch: 7n }),
    'REVISION_CONFLICT',
  );

  const loaded = await loadRatchetState(u, CONN);
  assert.deepEqual(loaded.record.state, S(1), 'the live session must be untouched');
});

test('G3: there is no way to choose the revision of an adopted session', async () => {
  await reset();
  const u = freshUser();
  // The old restoreRatchetSnapshot took a full record including a revision.
  // The replacement takes only bytes, so a caller cannot express "revision
  // 500" at all — the C-2 shape is gone from the API surface.
  const { revision } = await adoptSessionFromEstablishment(u, CONN, S(1));
  assert.equal(revision, 1n);
  assert.equal(adoptSessionFromEstablishment.length <= 4, true);
});

test('G4: establishment rejects empty state', async () => {
  await reset();
  const u = freshUser();
  await assertRejectsWithCode(
    () => adoptSessionFromEstablishment(u, CONN, new Uint8Array(0)),
    'CORRUPT_STATE',
  );
});

test('G5: restoreRatchetSnapshot no longer exists in the module surface', async () => {
  const mod = await import('../ratchet-state.ts');
  assert.equal('restoreRatchetSnapshot' in mod, false);
  assert.equal(Object.keys(mod).some((k) => /restore/i.test(k)), false);
  const session = await import('../ratchet-session.ts');
  assert.equal(Object.keys(session).some((k) => /restore|snapshot/i.test(k)), false);
});

/* ------------------------------------------------------------------ */
/* H. Ephemeral engine (audit H-1)                                     */
/* ------------------------------------------------------------------ */

test('H1: the engine is created per attempt and always disposed', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  const engines = [];

  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    plaintext: new Uint8Array([1]),
    createEngine: makeEngineFactory(engines),
    send: () => {},
  });
  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    plaintext: new Uint8Array([2]),
    createEngine: makeEngineFactory(engines),
    send: () => {},
  });

  assert.equal(engines.length, 2, 'each send must build a new engine');
  assert.ok(engines.every((e) => e.disposed), 'engines must not outlive the attempt');
});

test('H2: a losing CAS writer disposes its engine and externalizes nothing', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  const engines = [];
  const sent = [];

  // Advance the state behind the sequencer's back, after it has loaded but
  // before it commits: the classic lost-race.
  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: (state) => {
          const inst = makeEngineFactory(engines)(state);
          const originalEncrypt = inst.encrypt.bind(inst);
          inst.encrypt = async (p) => {
            const out = await originalEncrypt(p);
            await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(50));
            return out;
          };
          return inst;
        },
        send: (c) => void sent.push(c),
      }),
    'REVISION_CONFLICT',
  );

  assert.equal(sent.length, 0, 'a losing writer must never send');
  assert.equal(engines.length, 1);
  assert.equal(engines[0].disposed, true, 'the losing engine must be disposed');

  // The winner's state is intact; the loser left nothing behind.
  const loaded = await loadRatchetState(u, CONN);
  assert.deepEqual(loaded.record.state, S(50));
  assert.equal(loaded.record.revision, 2n);
});

test('H3: an engine failure disposes the engine and commits nothing', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));
  const engines = [];

  await assert.rejects(() =>
    encryptCommitSend({
      userId: u,
      connectionId: CONN,
      plaintext: new Uint8Array([1]),
      createEngine: (state) => {
        const inst = makeEngineFactory(engines)(state);
        inst.encrypt = () => {
          throw new Error('engine exploded');
        };
        return inst;
      },
      send: () => {},
    }),
  );

  assert.equal(engines[0].disposed, true);
  assert.equal((await loadRatchetState(u, CONN)).record.revision, 1n);
});

test('H4: a malformed engine result is rejected before any commit', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  await assertRejectsWithCode(
    () =>
      encryptCommitSend({
        userId: u,
        connectionId: CONN,
        plaintext: new Uint8Array([1]),
        createEngine: () => ({
          encrypt: () => ({ ciphertext: 'not-bytes', nextState: null }),
          dispose: () => {},
        }),
        send: () => {},
      }),
    'CRYPTO_ERROR',
  );

  assert.equal((await loadRatchetState(u, CONN)).record.revision, 1n);
});

test('H5: the engine receives a COPY of the state, not the stored buffer', async () => {
  // Mutation guard #3 (defensive copy removed).
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  await encryptCommitSend({
    userId: u,
    connectionId: CONN,
    plaintext: new Uint8Array([1]),
    createEngine: (state) => {
      state.fill(0xff); // hostile engine scribbles over its input
      return {
        encrypt: () => ({ ciphertext: new Uint8Array([1]), nextState: new Uint8Array([2, 2]) }),
        dispose: () => {},
      };
    },
    send: () => {},
  });

  // The commit must have stored the engine's declared nextState, unaffected
  // by the scribbling, and the previous record must not have been altered.
  const loaded = await loadRatchetState(u, CONN);
  assert.deepEqual(loaded.record.state, new Uint8Array([2, 2]));
});

test('H6: mutating the caller buffer after commit does not change what was stored', async () => {
  // Mutation guard #3, persistence side.
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));

  const mutable = new Uint8Array([1, 2, 3, 4]);
  await commitRatchetState(u, CONN, { epoch, revision: 1n }, mutable);
  mutable.fill(0xaa);

  const loaded = await loadRatchetState(u, CONN);
  assert.deepEqual(loaded.record.state, new Uint8Array([1, 2, 3, 4]));
});

test('H7: the loaded record is a copy — mutating it cannot corrupt storage', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  const first = await loadRatchetState(u, CONN);
  first.record.state.fill(0xee);

  const second = await loadRatchetState(u, CONN);
  assert.deepEqual(second.record.state, S(1));
});

/* ------------------------------------------------------------------ */
/* I. Receive side                                                     */
/* ------------------------------------------------------------------ */

test('I1: decrypt commits the advanced state', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  const result = await decryptAndCommit({
    userId: u,
    connectionId: CONN,
    ciphertext: new Uint8Array([1, 2, 3]),
    createEngine: makeEngineFactory(),
  });
  assert.equal(result.revision, 2n);
  assert.deepEqual(result.plaintext, new Uint8Array([3, 2, 1]));

  const loaded = await loadRatchetState(u, CONN);
  assert.equal(loaded.record.revision, 2n);
});

test('I2: the receive side refuses a rolled-back state', async () => {
  await reset();
  const u = freshUser();
  const { epoch } = await establish(u, CONN, S(1));
  const key = await ensureSealingKey(u);
  const old = await seal(key, u, CONN, epoch, 1n, S(1));
  await commitRatchetState(u, CONN, { epoch, revision: 1n }, S(2));
  await rawPut(ratchetKeyFor(u, CONN), old);

  await assertRejectsWithCode(
    () =>
      decryptAndCommit({
        userId: u,
        connectionId: CONN,
        ciphertext: new Uint8Array([1]),
        createEngine: makeEngineFactory(),
      }),
    'ROLLBACK_DETECTED',
  );
});

/* ------------------------------------------------------------------ */
/* J. Property                                                         */
/* ------------------------------------------------------------------ */

test('J1: property — the persisted version never decreases under a random mix', async () => {
  await reset();
  const u = freshUser();
  await establish(u, CONN, S(1));

  // Deterministic LCG, so a failure is reproducible.
  let s = 12345;
  const rnd = (n) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };

  let last = { epoch: 1n, revision: 1n };
  for (let i = 0; i < 200; i++) {
    const op = rnd(4);
    try {
      if (op === 0) {
        const l = await loadRatchetState(u, CONN);
        if (l.status === 'VALID') {
          await commitRatchetState(u, CONN, { epoch: l.record.epoch, revision: l.record.revision }, S(i % 200));
        }
      } else if (op === 1) {
        // stale writer
        await commitRatchetState(u, CONN, { epoch: 1n, revision: BigInt(rnd(5)) }, S(i % 200));
      } else if (op === 2) {
        await adoptSessionFromEstablishment(u, CONN, S(i % 200), { replacesEpoch: BigInt(rnd(3)) });
      } else {
        await getRatchetWatermark(u, CONN);
      }
    } catch (e) {
      assert.ok(isCryptoError(e), `unexpected error class: ${e?.name}: ${e?.message}`);
    }

    const l = await loadRatchetState(u, CONN);
    assert.equal(l.status, 'VALID', `state must stay usable at step ${i}`);
    const now = { epoch: l.record.epoch, revision: l.record.revision };
    const decreased =
      now.epoch < last.epoch || (now.epoch === last.epoch && now.revision < last.revision);
    assert.equal(decreased, false, `version decreased at step ${i}`);
    last = now;
  }
});
