// enough. — v0.3 R1: initial chat anchoring regression tests.
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/chat-scroll.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';

register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

const { initialAnchorAction } = await import('../chatScroll.ts');

function action(overrides = {}) {
  return initialAnchorAction({
    pending: true,
    userHasScrolled: false,
    unresolvedMessages: 1,
    ...overrides,
  });
}

test('initial anchor remains active while display plaintext is unresolved', () => {
  assert.equal(action(), 'anchor-and-wait');
  assert.equal(action({ unresolvedMessages: 8 }), 'anchor-and-wait');
});

test('initial anchor applies one final time when display content settles', () => {
  assert.equal(action({ unresolvedMessages: 0 }), 'anchor-and-finish');
});

test('user scroll intent immediately releases initial anchor ownership', () => {
  assert.equal(action({ userHasScrolled: true }), 'none');
  assert.equal(
    action({ userHasScrolled: true, unresolvedMessages: 0 }),
    'none',
    'settlement must not pull a user back down after they scroll',
  );
});

test('completed initial anchoring is not restarted by later content updates', () => {
  assert.equal(action({ pending: false }), 'none');
  assert.equal(action({ pending: false, unresolvedMessages: 0 }), 'none');
});

test('Chat anchors before paint across plaintext layout updates', async () => {
  const chat = await readFile(new URL('../../components/Chat.tsx', import.meta.url), 'utf8');
  const anchorEffect = chat.match(
    /\/\/ Initial anchoring runs before paint[\s\S]*?useLayoutEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]+)\]\);/,
  );

  assert.ok(anchorEffect, 'the initial anchor must use a layout effect');
  assert.match(anchorEffect[1], /initialAnchorAction/);
  assert.match(anchorEffect[1], /scrollToBottom\(false\)/);
  assert.match(anchorEffect[2], /plain/);
  assert.match(anchorEffect[2], /undecryptable/);
  assert.doesNotMatch(
    chat,
    /\/\/ Initial load: open at the bottom\.[\s\S]*?useEffect/,
    'the one-shot passive loading effect must not return',
  );
});
