// enough. — C-1 monotonic sequence counter tests.
//
// Verifies:
//   - outbound counters start at 1 and increment monotonically per peer,
//     scoped by userId, and are independent across peers;
//   - inbound high-water marks advance on Whisper messages;
//   - a PREKEY message resets the hwm even if the stored hwm was higher
//     (fresh session = new chain);
//   - a Whisper message whose c <= hwm is rejected as rollback/replay;
//   - malformed counter values are rejected;
//   - resetInboundFor wipes the hwm for that peer but leaves others intact.

import '../../crypto/__tests__/setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextOutboundSeq,
  checkInboundSeq,
  resetInboundFor,
} from '../seq-counter.ts';

const LOCAL_DEV = 1;
const SENDER_DEV = 1;
let seq = 0;
const freshUser = () => `c1-user-${++seq}`;

test('C1-1: outbound seq starts at 1 and increments monotonically per peer', async () => {
  const a = freshUser();
  assert.equal(await nextOutboundSeq(a, LOCAL_DEV, 'peer-x'), 1);
  assert.equal(await nextOutboundSeq(a, LOCAL_DEV, 'peer-x'), 2);
  assert.equal(await nextOutboundSeq(a, LOCAL_DEV, 'peer-x'), 3);
});

test('C1-2: outbound seq is independent across peers and users', async () => {
  const a = freshUser();
  const b = freshUser();
  assert.equal(await nextOutboundSeq(a, LOCAL_DEV, 'peer-x'), 1);
  assert.equal(await nextOutboundSeq(a, LOCAL_DEV, 'peer-y'), 1);
  assert.equal(await nextOutboundSeq(a, LOCAL_DEV, 'peer-x'), 2);
  assert.equal(await nextOutboundSeq(b, LOCAL_DEV, 'peer-x'), 1, 'other user starts at 1 for same peer');
});

test('C1-3: inbound Whisper rejects replay (c <= hwm)', async () => {
  const me = freshUser();
  const sender = 'sender';
  const r1 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 1);
  assert.equal(r1.accept, true);
  const r2 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 2);
  assert.equal(r2.accept, true);
  const replay = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 1);
  assert.equal(replay.accept, false);
  assert.equal(replay.reason, 'rollback');
  assert.equal(replay.seen, 2);
  assert.equal(replay.got, 1);
  const same = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 2);
  assert.equal(same.accept, false, 'same counter is also replay');
});

test('C1-4: PREKEY resets the hwm (new session)', async () => {
  const me = freshUser();
  const sender = 'sender';
  await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 10);
  await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 11);
  // After a PREKEY the chain resets: c=1 is accepted as the new base.
  const reset = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, true, 1);
  assert.equal(reset.accept, true);
  assert.equal(reset.reason, 'prekey-reset');
  const after = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 2);
  assert.equal(after.accept, true);
  // A replay of c=1 (the PREKEY base) or c=2 is rejected; c=3+ is the next
  // legitimate increment. This proves the hwm was reset to the new chain.
  const replay1 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 1);
  assert.equal(replay1.accept, false, 'replay of PREKEY base rejected');
  const replay2 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 2);
  assert.equal(replay2.accept, false, 'replay of c=2 rejected');
});

test('C1-5: malformed counter is rejected', async () => {
  const me = freshUser();
  const sender = 's2';
  for (const bad of [0, -1, 1.5]) {
    const r = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, bad);
    assert.equal(r.accept, false, `rejected c=${bad}`);
  }
});

test('C1-6: missing c (v1 envelope) is accepted without moving hwm', async () => {
  const me = freshUser();
  const sender = 's3';
  const r1 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, undefined);
  assert.equal(r1.accept, true);
  assert.equal(r1.reason, 'no-counter');
  const r2 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 1);
  assert.equal(r2.accept, true, 'first real counter accepted');
  const r3 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, undefined);
  assert.equal(r3.accept, true, 'v1 envelope still accepted after hwm set');
  const r4 = await checkInboundSeq(me, LOCAL_DEV, sender, SENDER_DEV, false, 1);
  assert.equal(r4.accept, false, 'replay of 1 still rejected (hwm was set by c:1)');
});

test('C1-7: resetInboundFor wipes only the named peer', async () => {
  const me = freshUser();
  await checkInboundSeq(me, LOCAL_DEV, 'alice', SENDER_DEV, false, 5);
  await checkInboundSeq(me, LOCAL_DEV, 'bob', SENDER_DEV, false, 7);
  await resetInboundFor(me, LOCAL_DEV, 'alice');
  const aliceReplay = await checkInboundSeq(me, LOCAL_DEV, 'alice', SENDER_DEV, false, 1);
  assert.equal(aliceReplay.accept, true, 'alice reset; seq 1 accepted');
  const bobReplay = await checkInboundSeq(me, LOCAL_DEV, 'bob', SENDER_DEV, false, 5);
  assert.equal(bobReplay.accept, false, 'bob hwm untouched; replay still rejected');
});

test('C1-8: hwm is per-sender', async () => {
  const me = freshUser();
  await checkInboundSeq(me, LOCAL_DEV, 'alice', SENDER_DEV, false, 3);
  const bobFirst = await checkInboundSeq(me, LOCAL_DEV, 'bob', SENDER_DEV, false, 1);
  assert.equal(bobFirst.accept, true, 'bob starts at his own chain');
});
