// enough. — regression guards for the blocked-composer invariant and the
// Home long-press action menu.
//
// Blocked-composer invariant: the composer must stay disabled whenever the
// current user is blocked by the PEER — in particular across the sequence
//
//   blockedByThem + blockedByMe (mutual) → self-unblock → peer still blocks
//
// The fix re-derives the block state from user_blocks (getBlockState) after
// a self-unblock instead of assuming 'none', and the composer disable /
// send guard are wired to that two-directional state.
//
// These are source-level guards (the affected React components are not
// renderable in the Node test runner). Their behavioral counterparts are
// exercised by the smoke test (scripts/smoke-test.mjs), which renders the
// production bundle in jsdom and walks the mutual-block scenario end to
// end, and by api.test.mjs, which tests the actual getBlockState
// derivation against the real api.ts module.
//
// Run with:
//   npm run test:blocked
//   node --test src/lib/__tests__/blocked-composer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const read = (rel) => fs.readFileSync(`${__dirname}/../../${rel}`, 'utf-8');
const chat = read('components/Chat.tsx');
const home = read('components/Home.tsx');
const menu = read('components/ChatActionMenu.tsx');
const composer = read('components/MessageComposer.tsx');

/** Body of the (async) function named `name` in `src`. */
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = src.indexOf('function ', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
}

/* ------------------------------------------------------------------ */
/* Blocked composer: the unblock path re-derives the authoritative    */
/* block relation instead of assuming 'none'                           */
/* ------------------------------------------------------------------ */

test('self-unblock re-derives the block state from user_blocks', () => {
  const body = fnBody(chat, 'handleUnblock');
  assert.ok(
    body.includes('setBlockState(await getBlockState(me, peer.id))'),
    'after unblockUser the authoritative getBlockState(me, peer) result must be applied',
  );
  assert.ok(
    !body.includes("setBlockState('none')"),
    "the old assumption setBlockState('none') must be gone — it re-enabled the composer while the peer still blocks",
  );
});

test('composer disable and the client send guard are wired to the two-directional block state', () => {
  // The `blocked` derivation covers BOTH directions (blockedByMe and
  // blockedByThem), not merely "I blocked them".
  assert.match(chat, /const blocked = !self && blockState !== 'none';/);
  // The composer is disabled by it (Offline Read Mode adds `|| offline` as a
  // further disabling term; `blocked` must remain one of them).
  assert.match(
    chat,
    /<MessageComposer\s+onSend=\{handleSend\}\s+disabled=\{!canChat \|\| blocked(?: \|\| offline)?\}\s*\/>/,
  );
  // ...and the client-side send guard fails closed on the same state.
  const send = fnBody(chat, 'handleSend');
  assert.match(send, /if \(!conn \|\| blocked \|\| !text\) return;/);
  // The composer's own submit path refuses while disabled.
  assert.match(composer, /if \(!value \|\| disabled\) return;/);
});

test('block state is derived from the backend, not from local UI bookkeeping', () => {
  // Initial load fetches the relation...
  assert.ok(
    chat.includes('const state = await getBlockState(me, peerId);'),
    'chat load derives the block state via getBlockState',
  );
  // ...and realtime user_blocks changes re-derive it.
  assert.ok(
    chat.includes('getBlockState(me, peerId).then(setBlockState)'),
    'realtime user_blocks events re-derive the block state',
  );
});

/* ------------------------------------------------------------------ */
/* Home long-press: one shared action menu, correct target, no My     */
/* Notes Block user                                                    */
/* ------------------------------------------------------------------ */

test('Home long-press reuses the shared chat action menu (no second implementation)', () => {
  assert.ok(
    home.includes("import ChatActionMenu from './ChatActionMenu';"),
    'Home imports the shared menu component',
  );
  assert.ok(
    chat.includes("import ChatActionMenu from './ChatActionMenu';"),
    'Chat imports the SAME shared menu component',
  );
  // The old inline sheet items in Chat are gone.
  assert.ok(!chat.includes('onSelect: () => setBlockConfirmOpen(true)'));
  assert.ok(!chat.includes('onSelect: () => setDeleteChatOpen(true)'));
  assert.ok(!chat.includes('deleteChatOpen'), 'no leftover deleteChatOpen state in Chat');
  assert.ok(!chat.includes('blockConfirmOpen'), 'no leftover blockConfirmOpen state in Chat');
  // The menu items themselves exist exactly once, in the shared component.
  assert.equal([...menu.matchAll(/key: 'block'/g)].length, 1, 'Block user item implemented once');
  assert.equal([...menu.matchAll(/key: 'delete'/g)].length, 1, 'Delete chat item implemented once');
  assert.equal([...menu.matchAll(/key: 'unblock'/g)].length, 1, 'Unblock item implemented once');
});

test('Home long-press resolves the correct peer/connection for Block, Unblock and Delete', () => {
  for (const name of ['handleMenuBlock', 'handleMenuUnblock']) {
    const body = fnBody(home, name);
    assert.match(
      body,
      /otherUserId\(conn, me\)/,
      `${name} must target the peer of the long-pressed connection`,
    );
  }
  const del = fnBody(home, 'handleMenuDelete');
  assert.match(
    del,
    /deleteChatForMe\(me, conn\.id\)/,
    'delete must use the long-pressed connection id',
  );
});

test('My Notes never opens the action menu (no Block user for the self-chat)', () => {
  const press = fnBody(home, 'startRowPress');
  assert.match(
    press,
    /isSelfConnection\(conn\)/,
    'self-connections must never start the long-press menu',
  );
});

test('normal tap still navigates; only the long-press release click is suppressed', () => {
  const body = fnBody(home, 'handleRowClick');
  assert.match(
    body,
    /navigate\(`#\/chat\/\$\{conn\.id\}`\)/,
    'a normal tap opens the pressed chat exactly as before',
  );
  assert.match(
    body,
    /suppressClickRef/,
    'the click releasing a completed long-press is suppressed before navigating',
  );
  // Same gesture contract as the other long-press targets in the app.
  assert.match(home, /const LONG_PRESS_MS = 550;/);
  assert.ok(home.includes('onPointerDown={() => startRowPress(conn)}'));
  assert.ok(home.includes('onPointerUp={cancelRowPress}'));
  assert.ok(home.includes('onPointerLeave={cancelRowPress}'));
  assert.ok(home.includes('onPointerCancel={cancelRowPress}'));
});
