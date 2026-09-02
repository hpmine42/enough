// enough. — P2-5 regression guard for the chat block-state channel.
//
// The chat subscribes to `user_blocks` to follow block state between the two
// chat participants. The old subscription used over-broad per-peer filters
// (`blocker_id=eq.<peerId>` / `blocked_id=eq.<peerId>`) that also delivered
// block events between the peer and *third* users. The fix scopes each filter
// to the exact me↔peer pair.
//
// This is a source-level guard: the realtime path itself is not exercised by
// the jsdom smoke harness (it stubs WebSocket). It would fail if the broad
// per-peer filters were reintroduced.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/chat-block-channel.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const chatSource = fs.readFileSync(`${__dirname}/../../components/Chat.tsx`, 'utf-8');

test('chat block-state channel filters are scoped to the exact me↔peer pair', () => {
  const channelStart = chatSource.indexOf("channel(`chat-blocks-");
  assert.ok(channelStart !== -1, 'chat-blocks channel must exist');

  // The over-broad per-peer filters must be gone.
  assert.ok(
    !chatSource.includes('filter: `blocker_id=eq.${peerId}`'),
    'must not subscribe with the broad blocker_id=peer filter',
  );
  assert.ok(
    !chatSource.includes('filter: `blocked_id=eq.${peerId}`'),
    'must not subscribe with the broad blocked_id=peer filter',
  );

  // The pair-scoped filters (AND of both columns) must be present.
  assert.ok(
    chatSource.includes('filter: `blocker_id=eq.${me},blocked_id=eq.${peerId}`'),
    'me → peer block filter must be present',
  );
  assert.ok(
    chatSource.includes('filter: `blocker_id=eq.${peerId},blocked_id=eq.${me}`'),
    'peer → me block filter must be present',
  );
});

// Blocked-composer invariant: after the current user removes their own block,
// the chat must re-derive the relation from the database instead of assuming
// 'none'. With a mutual block the peer's block remains, and hard-coding
// 'none' would re-enable the composer even though sending is still rejected.
// (The derivation itself is covered behaviorally in api.test.mjs; the
// runtime composer behavior is exercised by scripts/smoke-test.mjs.)
test('chat unblock re-derives the block state instead of assuming none', () => {
  const start = chatSource.indexOf('async function handleUnblock');
  assert.ok(start !== -1, 'handleUnblock must exist');
  const end = chatSource.indexOf('async function', start + 1);
  const body = chatSource.slice(start, end === -1 ? undefined : end);

  assert.ok(
    body.includes('getBlockState('),
    'handleUnblock must re-read the block relation through getBlockState',
  );
  assert.ok(
    !body.includes("setBlockState('none')"),
    "handleUnblock must not hard-code the state to 'none'",
  );
});
