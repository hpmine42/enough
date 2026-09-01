// enough. — v0.3 R1: regression tests for the initial chat scroll anchoring.
//
// The bug: the initial scroll ran once on the `loading -> false` transition.
// At that moment E2EE plaintext is not resolved yet, the bubbles are empty and
// short, so the captured `scrollHeight` is too small and the chat settles
// above the newest message.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/chat-scroll.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

const {
  INITIAL_ANCHOR_MAX_WAIT_MS,
  INITIAL_ANCHOR_SETTLE_MS,
  anchorTailIds,
  isInitialAnchorSettled,
  isTailResolved,
  shouldAnchorInitial,
} = await import('../chatScroll.ts');

const base = {
  pending: true,
  userScrolled: false,
  hasMessages: true,
  tailResolved: false,
  elapsedMs: 0,
  sinceTailResolvedMs: null,
};

test('anchors while the phase is pending and the tail is still decrypting', () => {
  assert.equal(shouldAnchorInitial(base), true);
  assert.equal(isInitialAnchorSettled(base), false);
});

test('never anchors an empty chat', () => {
  assert.equal(shouldAnchorInitial({ ...base, hasMessages: false }), false);
});

test('a user scroll ends anchoring immediately', () => {
  const state = { ...base, userScrolled: true };
  assert.equal(shouldAnchorInitial(state), false);
  assert.equal(isInitialAnchorSettled(state), true);
});

test('anchoring continues briefly after the tail resolved, then settles', () => {
  const justResolved = { ...base, tailResolved: true, sinceTailResolvedMs: 0 };
  assert.equal(shouldAnchorInitial(justResolved), true);
  assert.equal(isInitialAnchorSettled(justResolved), false);

  const settled = {
    ...base,
    tailResolved: true,
    sinceTailResolvedMs: INITIAL_ANCHOR_SETTLE_MS,
  };
  assert.equal(isInitialAnchorSettled(settled), true);
});

test('the safety timeout ends anchoring even if the tail never resolves', () => {
  assert.equal(
    isInitialAnchorSettled({ ...base, elapsedMs: INITIAL_ANCHOR_MAX_WAIT_MS }),
    true,
  );
  assert.equal(
    isInitialAnchorSettled({ ...base, elapsedMs: INITIAL_ANCHOR_MAX_WAIT_MS - 1 }),
    false,
  );
});

test('a finished phase stays finished', () => {
  assert.equal(isInitialAnchorSettled({ ...base, pending: false }), true);
  assert.equal(shouldAnchorInitial({ ...base, pending: false }), false);
});

test('only the rendered tail is awaited, not the whole page', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}` }));
  const tail = anchorTailIds(messages);
  assert.equal(tail.length, 20);
  assert.equal(tail[0], 'm30');
  assert.equal(tail.at(-1), 'm49');
  // Undecrypted old history must not block anchoring.
  assert.equal(
    isTailResolved(tail, (id) => Number(id.slice(1)) >= 30),
    true,
  );
});

test('tail resolution counts plaintext and permanently undecryptable alike', () => {
  const plain = { a: 'hi' };
  const undecryptable = new Set(['b']);
  const resolved = (id) => plain[id] !== undefined || undecryptable.has(id);
  assert.equal(isTailResolved(['a', 'b'], resolved), true);
  assert.equal(isTailResolved(['a', 'b', 'c'], resolved), false);
  assert.equal(isTailResolved([], resolved), true);
});

test('source guard: the initial scroll no longer relies on the [loading] pass alone', () => {
  const src = readFileSync(new URL('../../components/Chat.tsx', import.meta.url), 'utf8');
  assert.match(src, /initialAnchorPendingRef\.current = true/);
  assert.match(src, /shouldAnchorInitial\(/);
  assert.match(src, /isInitialAnchorSettled\(/);
  // Pagination compensation keeps priority over anchoring.
  assert.match(src, /if \(pendingDeltaRef\.current > 0\) return;/);
  // A genuine user scroll latches and stops anchoring.
  assert.match(src, /userScrolledRef\.current = true/);
});
