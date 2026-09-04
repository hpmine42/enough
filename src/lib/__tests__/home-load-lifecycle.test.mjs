// enough. — F-03 regression tests: Home overlapping load() race.
//
// Home can have several full `load()` calls in flight at once (initial load,
// reconnect load, Settings→Home transition, accept/decline/cancel, the P1-5
// drain fallback). Before F-03 the loader used a plain boolean gate plus a
// monotonic token:
//
//   loadingRef.current = true            (any load)
//   ...
//   finally { loadingRef.current = false }  (ANY load, including a stale one)
//
// so an older load finishing first reopened the realtime gate while a newer
// load was still about to replace the whole Home state — realtime events in
// that window were treated as steady-state and then silently overwritten.
//
// These tests drive the REAL lifecycle helper (`createHomeLoadLifecycle`)
// through a harness that mirrors Home's loader structure: start → await →
// `isCurrent()`-guarded commits → `finish()`-gated gate release + drain.
//
// Run with:
//   npm run test:home
//   node --test --experimental-strip-types \
//     src/lib/__tests__/home-load-lifecycle.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHomeLoadLifecycle, mergeLastMessage } from '../homeRealtime.ts';

/**
 * Minimal model of the Home loader lifecycle, wired exactly like
 * `Home.tsx`: the same lifecycle helper, the same gate mirror, the same
 * `isCurrent()` guard around every commit and the same drain on release.
 */
function createHomeModel() {
  // Mirrors Home's `lifecycleRef`: the account-change effect installs a
  // FRESH lifecycle, which invalidates every outstanding token.
  let lifecycle = createHomeLoadLifecycle();
  const state = {
    /** Committed snapshot label (which load owns the current state). */
    snapshot: null,
    /** Home's `lastMessages` map (realtime + load both write here). */
    lastMessages: {},
    /** Mirror of Home's `loadingRef` (the realtime loading gate). */
    gate: false,
    /** Conversations queued while a load was running (P1-5 drain). */
    pending: new Set(),
    /** Drains that actually ran. */
    drains: 0,
    /** Account identity, mirrors Home's `meRef`. */
    me: 'user-a',
  };

  /** Start a load; returns handles to resolve it later. */
  function startLoad(label, { account = state.me } = {}) {
    const owner = lifecycle;
    const token = owner.start();
    state.gate = true;
    // Home's guard: newest token of the CURRENT lifecycle, same account.
    const isCurrent = () => lifecycle === owner && lifecycle.isCurrent(token) && state.me === account;
    return {
      label,
      token,
      isCurrent,
      /** Resolve the load with the snapshot it fetched. */
      resolve(payload = {}) {
        try {
          if (!isCurrent()) return false;
          state.snapshot = label;
          if (payload.lastMessages) state.lastMessages = { ...payload.lastMessages };
          return true;
        } finally {
          // F-03: only the last active load releases the gate and drains.
          if (owner.finish(token) && lifecycle === owner) {
            state.gate = false;
            state.drains += 1;
            state.pending.clear();
          }
        }
      },
    };
  }

  /** Realtime event, routed like the Home bridge does. */
  function realtimeMessage(msg) {
    if (state.gate) {
      // Queued for the post-load narrow reconciliation, never applied to
      // state that a running load is about to replace.
      state.pending.add(msg.connection_id);
      return 'queued';
    }
    state.lastMessages = mergeLastMessage(state.lastMessages, msg);
    return 'applied';
  }

  /** Account switch, mirroring Home's `[me]` effect. */
  function switchAccount(next) {
    state.me = next;
    lifecycle = createHomeLoadLifecycle();
    state.gate = false;
  }

  return {
    lifecycle: () => lifecycle,
    state,
    startLoad,
    realtimeMessage,
    switchAccount,
  };
}

const message = (id, connectionId, createdAt) => ({
  id,
  connection_id: connectionId,
  sender_id: 'peer',
  ciphertext: 'x',
  created_at: createdAt,
});

/* ------------------------------------------------------------------ */
/* F03-1 — overlapping loads                                           */
/* ------------------------------------------------------------------ */

test('F03-1: A resolves, realtime event arrives, B resolves — A never wins', () => {
  const home = createHomeModel();
  const a = home.startLoad('A');
  const b = home.startLoad('B');

  assert.equal(a.resolve({ lastMessages: { c1: message('m-a', 'c1', '2026-01-01T10:00:00Z') } }), false,
    'the stale load A must not commit');
  assert.equal(home.state.snapshot, null);
  assert.equal(home.state.gate, true, 'the gate stays closed while B runs');

  assert.equal(home.realtimeMessage(message('m-rt', 'c1', '2026-01-01T11:00:00Z')), 'queued',
    'the event is not treated as steady-state while B is in flight');

  assert.equal(b.resolve({ lastMessages: { c1: message('m-b', 'c1', '2026-01-01T11:00:00Z') } }), true);
  assert.equal(home.state.snapshot, 'B');
  assert.equal(home.state.gate, false);
  assert.equal(home.state.drains, 1, 'exactly one drain, after the last load');
});

/* ------------------------------------------------------------------ */
/* F03-2 — a stale load cannot clear a newer load's gate               */
/* ------------------------------------------------------------------ */

test('F03-2: an older load finishing first does not release the gate', () => {
  const home = createHomeModel();
  const a = home.startLoad('A');
  const b = home.startLoad('B');

  a.resolve();
  assert.equal(home.state.gate, true, 'gate still owned by B');
  assert.equal(home.lifecycle().isLoading(), true);
  assert.equal(home.lifecycle().active(), 1);
  assert.equal(home.state.drains, 0, 'no drain while a load is still running');

  b.resolve();
  assert.equal(home.state.gate, false);
  assert.equal(home.lifecycle().isLoading(), false);
});

test('F03-2b: a duplicate finish cannot release another load\'s gate', () => {
  const lifecycle = createHomeLoadLifecycle();
  const a = lifecycle.start();
  const b = lifecycle.start();
  assert.equal(lifecycle.finish(a), false);
  assert.equal(lifecycle.finish(a), false, 'double finish is a no-op');
  assert.equal(lifecycle.isLoading(), true, 'B still owns the gate');
  assert.equal(lifecycle.finish(b), true);
  assert.equal(lifecycle.isLoading(), false);
});

/* ------------------------------------------------------------------ */
/* F03-3 / F03-4 — latest started load wins in both resolution orders  */
/* ------------------------------------------------------------------ */

test('F03-3: B resolves before A — final state is B', () => {
  const home = createHomeModel();
  const a = home.startLoad('A');
  const b = home.startLoad('B');
  assert.equal(b.resolve(), true);
  assert.equal(a.resolve(), false, 'the older load must not overwrite B');
  assert.equal(home.state.snapshot, 'B');
});

test('F03-4: A resolves before B — final state is B', () => {
  const home = createHomeModel();
  const a = home.startLoad('A');
  const b = home.startLoad('B');
  assert.equal(a.resolve(), false);
  assert.equal(b.resolve(), true);
  assert.equal(home.state.snapshot, 'B');
});

/* ------------------------------------------------------------------ */
/* F03-5 — realtime during the overlap window                          */
/* ------------------------------------------------------------------ */

test('F03-5: a realtime update between A and B completion survives correctly', () => {
  const home = createHomeModel();
  const a = home.startLoad('A');
  const b = home.startLoad('B');
  a.resolve({ lastMessages: { c1: message('m-a', 'c1', '2026-01-01T09:00:00Z') } });

  // While B runs the event is queued for the narrow reconciliation instead
  // of being written to state B is about to replace.
  assert.equal(home.realtimeMessage(message('m-rt', 'c1', '2026-01-01T12:00:00Z')), 'queued');
  assert.deepEqual(Array.from(home.state.pending), ['c1']);

  b.resolve({ lastMessages: { c1: message('m-b', 'c1', '2026-01-01T11:00:00Z') } });
  assert.equal(home.state.drains, 1, 'the queued conversation is reconciled after B');

  // After the gate opened, further events apply incrementally again (P1-5).
  assert.equal(home.realtimeMessage(message('m-rt2', 'c1', '2026-01-01T13:00:00Z')), 'applied');
  assert.equal(home.state.lastMessages.c1.id, 'm-rt2');
});

/* ------------------------------------------------------------------ */
/* F03-6 — rapid consecutive loads, arbitrary resolution order         */
/* ------------------------------------------------------------------ */

test('F03-6: A→B→C→D resolved out of order — only D commits', () => {
  const home = createHomeModel();
  const loads = ['A', 'B', 'C', 'D'].map((l) => home.startLoad(l));
  const [a, b, c, d] = loads;
  assert.equal(home.lifecycle().active(), 4);

  assert.equal(c.resolve(), false);
  assert.equal(a.resolve(), false);
  assert.equal(d.resolve(), true, 'the newest started load commits');
  assert.equal(home.state.gate, true, 'B is still running');
  assert.equal(b.resolve(), false, 'a late older load must not overwrite D');

  assert.equal(home.state.snapshot, 'D');
  assert.equal(home.state.gate, false);
  assert.equal(home.state.drains, 1, 'the gate is released exactly once');
});

/* ------------------------------------------------------------------ */
/* F03-7 — account/session switch                                      */
/* ------------------------------------------------------------------ */

test('F03-7: a load started for user A cannot populate user B Home state', () => {
  const home = createHomeModel();
  const a = home.startLoad('A-load', { account: 'user-a' });
  home.switchAccount('user-b');
  const b = home.startLoad('B-load', { account: 'user-b' });

  assert.equal(a.resolve({ lastMessages: { c1: message('leak', 'c1', '2026-01-01T10:00:00Z') } }), false,
    'the previous account load must not commit');
  assert.deepEqual(home.state.lastMessages, {}, 'no cross-account data');

  assert.equal(b.resolve({ lastMessages: { c2: message('own', 'c2', '2026-01-01T10:00:00Z') } }), true);
  assert.equal(home.state.snapshot, 'B-load');
  assert.deepEqual(Object.keys(home.state.lastMessages), ['c2']);
});

test('F03-7c: a stale load survives logout with no new load started', () => {
  const home = createHomeModel();
  // Only ONE load exists, so a token comparison alone would call it current.
  const a = home.startLoad('A-load', { account: 'user-a' });
  home.switchAccount('user-b');
  assert.equal(
    a.resolve({ lastMessages: { c1: message('leak', 'c1', '2026-01-01T10:00:00Z') } }),
    false,
    'the previous account load must not commit into user B Home state',
  );
  assert.deepEqual(home.state.lastMessages, {});
  assert.equal(home.state.snapshot, null);
});

test('F03-7d: Home resets the load lifecycle on account change', () => {
  const accountEffect = homeSrc.slice(
    homeSrc.indexOf('// Account change: drop cross-account bookkeeping immediately.'),
    homeSrc.indexOf('const load = useCallback'),
  );
  assert.ok(accountEffect.length > 0, 'account-change effect found');
  assert.match(accountEffect, /lifecycleRef\.current = createHomeLoadLifecycle\(\);/);
  assert.match(accountEffect, /loadingRef\.current = false;/);
  assert.match(homeSrc, /meRef\.current === me;/, 'the loader guard also compares the account');
});

test('F03-7b: a fresh lifecycle invalidates every outstanding token', () => {
  const lifecycle = createHomeLoadLifecycle();
  const stale = lifecycle.start();
  const next = createHomeLoadLifecycle();
  assert.equal(next.isCurrent(stale), false, 'tokens do not survive an account switch');
});

/* ------------------------------------------------------------------ */
/* static guards over the shipped Home wiring                          */
/* ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const homeSrc = fs.readFileSync(
  path.resolve(here, '../../components/Home.tsx'),
  'utf8',
);

test('F03-8: Home releases the gate only when the last load finished', () => {
  assert.match(homeSrc, /const owner = lifecycle\(\);/);
  assert.match(homeSrc, /const token = owner\.start\(\);/);
  assert.match(homeSrc, /const last = owner\.finish\(token\);/);
  const finallyStart = homeSrc.indexOf('const last = owner.finish(token);');
  assert.ok(finallyStart > 0);
  const block = homeSrc.slice(finallyStart, finallyStart + 600);
  assert.match(block, /if \(last && lifecycleRef\.current === owner && meRef\.current === me\) \{[\s\S]*loadingRef\.current = false;/,
    'the gate is only cleared inside the last-load branch');
  assert.match(block, /if \(last && [\s\S]*\) \{[\s\S]*drainRef\.current\?\.\(\);/,
    'the drain only runs after the last load');
  // No unconditional release anywhere else in the loader.
  const releases = homeSrc.match(/loadingRef\.current = false;/g) ?? [];
  assert.equal(releases.length, 2,
    'exactly two releases: the last-load branch and the account-switch reset');
});

test('F03-8b: P1-5 incremental realtime behavior is untouched', () => {
  // A realtime handler still never triggers an unconditional full load().
  const channelStart = homeSrc.indexOf(".channel('home')");
  const effectEnd = homeSrc.indexOf('.subscribe();', channelStart);
  assert.ok(channelStart > 0 && effectEnd > channelStart);
  const wiring = homeSrc.slice(channelStart, effectEnd);
  assert.ok(!/\bload\(/.test(wiring), 'no realtime handler may call load()');
  // The gate the bridge reads is still the mirrored loadingRef.
  assert.match(homeSrc, /isLoading: \(\) => loadingRef\.current,/);
  assert.match(homeSrc, /if \(loadingRef\.current\) pendingReconcileRef\.current\.add\(id\);/);
});

test('F03-9: offline hydration and reconnect load share the same lifecycle', () => {
  // The offline branch commits under the same `isCurrent()` guard...
  const offlineStart = homeSrc.indexOf('if (shouldSkipNetwork()) {');
  const offlineEnd = homeSrc.indexOf('const connsResult = await getMyConnections(me);');
  assert.ok(offlineStart > 0 && offlineEnd > offlineStart);
  assert.match(homeSrc.slice(offlineStart, offlineEnd), /if \(!isCurrent\(\)\) return;/);
  // ...and reconnect simply calls the same loader (no second mechanism).
  assert.match(homeSrc, /if \(wasOffline && !offline && me\) load\(\);/);
  assert.ok(!/createHomeLoadLifecycle\(\)/.test(homeSrc.slice(offlineStart, offlineEnd)));
});
