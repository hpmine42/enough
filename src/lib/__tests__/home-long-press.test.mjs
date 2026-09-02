// enough. — regression guards for the Home chat-overview long-press menu.
//
// A long press on a conversation row in the Home overview opens the SAME
// action menu the trash button opens inside the conversation (shared
// BottomSheet/Dialog components, existing block and chat-deletion flows).
// A normal tap keeps opening the chat, and the My Notes row routes to its
// clear-and-disable dialog instead of the block/delete sheet.
//
// These are source-level guards: Home.tsx is not renderable in the Node test
// runner without a full React/E2EE harness. Their behavioral counterparts
// (rendered DOM: tap navigation, long-press sheet, block/delete dialogs and
// database effects, My Notes dialog) are exercised by the smoke test, which
// renders the production bundle in jsdom (scripts/smoke-test.mjs).
//
// Run with:
//   npm run test:home
//   node --test --experimental-strip-types src/lib/__tests__/home-long-press.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const homeSource = fs.readFileSync(`${__dirname}/../../components/Home.tsx`, 'utf-8');

/** The overview row button JSX (from its class name to the closing tag). */
function overviewRowJsx() {
  const start = homeSource.indexOf('className="chat chat-overview-row"');
  assert.ok(start !== -1, 'the overview row button must exist');
  const end = homeSource.indexOf('</button>', start);
  return homeSource.slice(start, end);
}

test('overview row implements the pointer long-press with slop + cancel', () => {
  const row = overviewRowJsx();
  assert.ok(
    row.includes('onPointerDown={() => startRowPress(conn, other)}'),
    'pointer down must start the long-press timer for this row',
  );
  for (const cancel of ['onPointerUp', 'onPointerLeave', 'onPointerCancel']) {
    assert.ok(row.includes(`${cancel}={cancelRowPress}`), `${cancel} must cancel the press`);
  }
  assert.ok(row.includes('onPointerMove'), 'pointer movement must be able to cancel the press');
  assert.ok(
    homeSource.includes('}, LONG_PRESS_MS);') && homeSource.includes('const LONG_PRESS_MS = 550;'),
    'the long-press threshold matches the app-wide 550 ms hold',
  );
});

test('normal tap still opens the chat; only a fired long press suppresses it', () => {
  const row = overviewRowJsx();
  assert.ok(
    row.includes('onClick={() => handleRowClick(conn)}'),
    'the row click must route through the suppression-aware handler',
  );
  const clickHandler = homeSource.slice(
    homeSource.indexOf('function handleRowClick'),
    homeSource.indexOf('}\n', homeSource.indexOf('navigate(`#/chat/${conn.id}`)', homeSource.indexOf('function handleRowClick'))),
  );
  assert.ok(
    clickHandler.includes('navigate(`#/chat/${conn.id}`)'),
    'an unsuppressed tap must open the chat exactly as before',
  );
  assert.ok(
    clickHandler.includes('suppressClickRef.current'),
    'the click handler must consume the long-press suppression flag',
  );
  // The flag is only raised inside the long-press timeout.
  const press = homeSource.slice(
    homeSource.indexOf('function startRowPress'),
    homeSource.indexOf('function cancelRowPress'),
  );
  assert.ok(
    press.includes('suppressClickRef.current = true;'),
    'only a fired long press may suppress the following click',
  );
});

test('long press opens the shared BottomSheet, not a bespoke menu', () => {
  assert.ok(
    homeSource.includes("import BottomSheet from './BottomSheet';"),
    'Home must reuse the shared BottomSheet component',
  );
  assert.ok(
    !homeSource.includes('className="sheet'),
    'Home must not re-implement the sheet markup',
  );
});

test('the menu offers the existing Block user and Delete chat flows', () => {
  assert.ok(
    homeSource.includes("label: t('block.blockUser')"),
    'the sheet must offer Block user',
  );
  assert.ok(
    homeSource.includes("label: t('chat.deleteChatForMe')"),
    'the sheet must offer the per-user Delete chat action',
  );
  // Block goes through the existing confirmation dialog + blockUser API.
  assert.ok(
    homeSource.includes("t('block.blockTitle'") && homeSource.includes('blockUser(me, blockConfirmTarget.id)'),
    'blocking must use the existing confirmation dialog and blockUser API',
  );
  // Delete chat goes through the existing confirmation + per-user deletion.
  assert.ok(
    homeSource.includes("t('chat.deleteChatConfirmTitle')") &&
      homeSource.includes('deleteChatForMe(me, deleteChatTarget.id)'),
    'deleting must use the existing confirmation dialog and deleteChatForMe API',
  );
  // "Delete chat" must stay per-user — never the for-everyone message path.
  assert.ok(
    !homeSource.includes('deleteMessageForEveryone'),
    'Home must not turn delete chat into delete-for-everyone',
  );
});

test('the menu block state is re-derived from the database, not local UI state', () => {
  const openMenu = homeSource.slice(
    homeSource.indexOf('async function openRowMenu'),
    homeSource.indexOf('function startRowPress'),
  );
  assert.ok(
    openMenu.includes('getBlockState(me, otherUserId(conn, me))'),
    'the sheet must read the current block relation through getBlockState',
  );
});

test('My Notes routes to its clear dialog and never exposes Block user', () => {
  const openMenu = homeSource.slice(
    homeSource.indexOf('async function openRowMenu'),
    homeSource.indexOf('function startRowPress'),
  );
  const selfBranch = openMenu.indexOf('isSelfConnection(conn)');
  const notesDialog = openMenu.indexOf('setNotesClearTarget(conn)');
  const sheetOpen = openMenu.indexOf('setMenuTarget(');
  assert.ok(selfBranch !== -1, 'openRowMenu must detect the self connection');
  assert.ok(
    notesDialog !== -1 && notesDialog < sheetOpen,
    'the self connection must return into the My Notes dialog before any sheet opens',
  );
  assert.ok(
    openMenu.slice(selfBranch, notesDialog).includes('{') &&
      openMenu.includes('return;'),
    'the self branch must return without reaching the block/delete sheet',
  );
  // The notes dialog reuses the existing clear-and-disable flow.
  assert.ok(
    homeSource.includes("t('chat.myNotesClearTitle')") &&
      homeSource.includes('removeMyNotes(me, notesClearTarget.id)'),
    'My Notes must reuse the existing remove_my_notes flow',
  );
});
