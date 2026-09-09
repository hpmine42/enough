// enough. — C1: E2EE display-state resolution.
//
// The bug (audit F-01): a peer message whose plaintext had not resolved yet
// rendered as `''`, i.e. as an EMPTY bubble. When `E2EESessionManager`
// initialization failed, `manager` stayed null forever, so every peer bubble in
// the chat was permanently empty and the user had no explanation and no action.
//
// Invariants under test:
//   1. An unresolved row NEVER resolves to an empty display — it is either
//      visibly pending or visibly undecryptable.
//   2. A failed engine turns "pending" into "undecryptable": a row that can no
//      longer resolve must not spin forever.
//   3. A resolved plaintext always wins, and is returned VERBATIM (never
//      trimmed, normalized or otherwise mutated).
//   4. A peer send is only possible with an explicitly READY engine
//      (fail-closed); My Notes stays writable as the documented exception.
//
// Run with:
//   npm run test:e2eestate
//   node --test --experimental-strip-types src/lib/__tests__/chat-display.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('../../../scripts/load-enough-ts.mjs', import.meta.url), import.meta.url);

const { resolveBubbleText, canSendEncrypted, e2eeRecoveryOffersReset, classifyUserMismatch } = await import('../chatDisplay.ts');

/* ------------------------------------------------------------------ */
/* 1. Resolved plaintext wins                                          */
/* ------------------------------------------------------------------ */

test('CD1: a resolved plaintext is rendered as-is', () => {
  const r = resolveBubbleText({
    plaintext: 'Hello Benno',
    undecryptable: false,
    e2eeFailed: false,
  });
  assert.deepEqual(r, { kind: 'plaintext', text: 'Hello Benno' });
});

test('CD2: a resolved plaintext wins even when the engine failed', () => {
  // My Notes and legacy rows resolve WITHOUT the engine, so an unrelated E2EE
  // failure must not hide content that is already available.
  const r = resolveBubbleText({
    plaintext: 'cached text',
    undecryptable: false,
    e2eeFailed: true,
  });
  assert.deepEqual(r, { kind: 'plaintext', text: 'cached text' });
});

test('CD3: plaintext is returned verbatim — never trimmed or normalized', () => {
  // The display path must not mutate content: leading/trailing whitespace,
  // braces and angle brackets survive untouched (E2EE boundary discipline).
  for (const raw of ['  spaced  ', '<b>not html</b>', '{not-a-placeholder}', 'a\nb']) {
    const r = resolveBubbleText({ plaintext: raw, undecryptable: false, e2eeFailed: false });
    assert.equal(r.kind, 'plaintext');
    assert.equal(r.text, raw, `verbatim for ${JSON.stringify(raw)}`);
  }
});

/* ------------------------------------------------------------------ */
/* 2. Failure states                                                    */
/* ------------------------------------------------------------------ */

test('CD4: an explicit decrypt failure is reported as undecryptable', () => {
  const r = resolveBubbleText({
    plaintext: undefined,
    undecryptable: true,
    e2eeFailed: false,
  });
  assert.deepEqual(r, { kind: 'undecryptable' });
});

test('CD5: a failed engine turns an unresolved row into undecryptable, not pending', () => {
  // This is the core C1 fix: with no manager the row can NEVER resolve, so it
  // must not be presented as "still working on it".
  const r = resolveBubbleText({
    plaintext: undefined,
    undecryptable: false,
    e2eeFailed: true,
  });
  assert.deepEqual(r, { kind: 'undecryptable' });
});

test('CD6: a healthy engine leaves an unresolved row pending', () => {
  const r = resolveBubbleText({
    plaintext: undefined,
    undecryptable: false,
    e2eeFailed: false,
  });
  assert.deepEqual(r, { kind: 'pending' });
});

/* ------------------------------------------------------------------ */
/* 3. The "never empty" invariant, exhaustively                        */
/* ------------------------------------------------------------------ */

test('CD7: no input combination yields an empty display', () => {
  const plaintexts = [undefined, '', 'text'];
  const bools = [false, true];
  let checked = 0;
  for (const plaintext of plaintexts) {
    for (const undecryptable of bools) {
      for (const e2eeFailed of bools) {
        const r = resolveBubbleText({ plaintext, undecryptable, e2eeFailed });
        checked++;
        // Every outcome is one of the three known kinds...
        assert.ok(
          ['plaintext', 'pending', 'undecryptable'].includes(r.kind),
          `known kind for ${JSON.stringify({ plaintext, undecryptable, e2eeFailed })}`,
        );
        // ...and an UNRESOLVED row is never rendered as nothing. Only an
        // explicitly resolved (possibly empty) value may carry empty text.
        if (r.kind !== 'plaintext') {
          assert.ok(!('text' in r) || r.text !== '', 'unresolved rows carry no empty text');
        }
      }
    }
  }
  assert.equal(checked, 12, 'all 12 combinations exercised');
});

/* ------------------------------------------------------------------ */
/* 4. Send gating (fail-closed)                                         */
/* ------------------------------------------------------------------ */

test('CD8: a peer send requires an explicitly READY engine', () => {
  assert.equal(canSendEncrypted({ e2eeStatus: 'ready', isSelf: false }), true);
  assert.equal(
    canSendEncrypted({ e2eeStatus: 'initializing', isSelf: false }),
    false,
    'still initializing must refuse',
  );
  assert.equal(
    canSendEncrypted({ e2eeStatus: 'error', isSelf: false }),
    false,
    'failed engine must refuse',
  );
});

test('CD9: My Notes stays writable regardless of engine state (documented exception)', () => {
  for (const e2eeStatus of ['initializing', 'ready', 'error']) {
    assert.equal(
      canSendEncrypted({ e2eeStatus, isSelf: true }),
      true,
      `self-chat writable while ${e2eeStatus}`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 5. The UI must consume the lifecycle, not just the manager           */
/* ------------------------------------------------------------------ */

test('CD10: Chat consumes the E2EE lifecycle state and offers recovery', async () => {
  const { readFileSync } = await import('node:fs');
  const chat = readFileSync(
    new URL('../../components/Chat.tsx', import.meta.url),
    'utf8',
  );
  const ctx = readFileSync(
    new URL('../../context/E2EEContext.tsx', import.meta.url),
    'utf8',
  );

  // The provider publishes an explicit three-state lifecycle...
  assert.ok(ctx.includes("'initializing' | 'ready' | 'error'"), 'E2EEStatus is a three-state union');
  assert.ok(ctx.includes('retry'), 'the provider exposes a retry action');
  // ...and Chat actually uses it (the F-01 defect was that it used only
  // `manager`, so `error` was dead in the UI).
  assert.ok(
    chat.includes('status: e2eeStatus') && chat.includes('retry: retryE2EE'),
    'Chat consumes status and retry from useE2EE()',
  );
  assert.ok(chat.includes('resolveBubbleText'), 'Chat resolves bubble text through the pure helper');
  assert.ok(chat.includes('canSendEncrypted'), 'Chat gates the composer through the pure helper');
  // A failed send must not clear the draft.
  const composer = readFileSync(
    new URL('../../components/MessageComposer.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    composer.includes('if (result === false) return;'),
    'the composer keeps the draft when a send fails',
  );
});

test('CD11: the pending state is actually rendered and styled', async () => {
  // CD6 proves the helper decides "pending"; this proves the decision reaches
  // the DOM and is visually distinguishable, so a future refactor cannot
  // silently drop back to an empty bubble.
  const { readFileSync } = await import('node:fs');
  const bubble = readFileSync(
    new URL('../../components/MessageBubble.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

  assert.ok(bubble.includes("pending ? ' pending' : ''"), 'MessageBubble applies the pending class');
  assert.ok(bubble.includes("pending = false"), 'pending defaults to false');
  assert.ok(css.includes('.message.pending'), 'the pending bubble is styled');
  // The placeholder must not be an invisible/empty box.
  assert.ok(/\.message\.pending\s*\{[^}]*color:/s.test(css), 'pending text has an explicit colour');
  // Reduced motion is covered by the global block, which must stay in place.
  assert.ok(
    css.includes('@media (prefers-reduced-motion: reduce)'),
    'the global reduced-motion block still neutralizes the pending animation',
  );
});

/* ------------------------------------------------------------------ */
/* C2 — recovery UI decisions (IR13: purely statutory table tests)      */
/* ------------------------------------------------------------------ */

test('IR13: only local state/identity failures offer the device reset', () => {
  // Re-running initialization over broken local state cannot help — wiping
  // first is the only way forward, so the reset is offered.
  for (const code of ['USER_MISMATCH', 'CORRUPT_STATE', 'UNSEAL_FAILED', 'KEY_MISSING', 'WEDGED']) {
    assert.equal(e2eeRecoveryOffersReset(code), true, `${code} offers the reset`);
  }
  // Transient/operational failures (and everything unknown) offer a retry
  // ONLY — a destructive reset must never be suggested for a failure that a
  // retry can fix.
  for (const code of ['NOT_AVAILABLE', 'STORAGE_ERROR', 'INIT_FAILED', 'NEEDS_ESTABLISH', null, '', 'BOGUS']) {
    assert.equal(e2eeRecoveryOffersReset(code), false, `${String(code)} offers no reset`);
  }
});

test('IR11b: a USER_MISMATCH is classified blocked-first, then identity-changed', () => {
  // A block in EITHER direction is shown as a block, even when the trust
  // record is marked — a block must never be mistaken for an identity change.
  for (const block of ['blockedByMe', 'blockedByThem']) {
    assert.equal(
      classifyUserMismatch({ blockState: block, trustState: 'identity_changed' }),
      'blocked',
      `${block} with a marked trust record is still a block`,
    );
  }
  // The recoverable case: no block, but the trust record was persistently
  // marked identity_changed by the failed send.
  assert.equal(
    classifyUserMismatch({ blockState: 'none', trustState: 'identity_changed' }),
    'identity-changed',
    'unblocked plus marked record offers peer recovery',
  );
  // Without the mark no reset is offered — a missing or unreadable trust
  // record never leads a user into a destructive dialog.
  for (const trust of [null, 'unverified', 'verified', '']) {
    assert.equal(
      classifyUserMismatch({ blockState: 'none', trustState: trust }),
      'generic',
      `trust ${String(trust)} offers no reset`,
    );
  }
});

test('IR9b: Chat resets only from explicit confirmation (single call sites)', async () => {
  // Structural tripwire (same discipline as CD10 and the IR12c whitelist):
  // the peer reset must be callable from exactly one place — the onConfirm
  // handler performPeerReset — and the device reset from performDeviceReset.
  // Any second call site (auto-reset on error, realtime, effect) fails here.
  const { readFileSync } = await import('node:fs');
  const chat = readFileSync(
    new URL('../../components/Chat.tsx', import.meta.url),
    'utf8',
  );
  const count = (haystack, needle) => haystack.split(needle).length - 1;

  assert.equal(count(chat, 'resetPeerSecurityState('), 1, 'exactly one peer-reset call site');
  assert.equal(count(chat, 'async function performPeerReset'), 1, 'peer reset has one handler');
  assert.equal(count(chat, 'onConfirm={performPeerReset}'), 1, 'peer reset runs from onConfirm only');

  assert.equal(count(chat, 'resetDeviceE2EE()'), 1, 'exactly one device-reset call site');
  assert.equal(count(chat, 'async function performDeviceReset'), 1, 'device reset has one handler');
  assert.equal(count(chat, 'onConfirm={performDeviceReset}'), 1, 'device reset runs from onConfirm only');

  // Cancel closes the dialog and nothing else — no reset on cancel; and the
  // Review button only OPENS the dialog (no direct reset from the notice).
  assert.ok(
    chat.includes('onCancel={() => setResetDialog(null)}'),
    'cancel closes the peer dialog without side effects',
  );
  assert.ok(
    chat.includes('onCancel={() => setDeviceResetOpen(false)}'),
    'cancel closes the device dialog without side effects',
  );
  assert.ok(
    chat.includes('if (conn) setResetDialog({ peerId: identityChangedPeer, connectionId: conn.id })'),
    'the Review button opens the dialog instead of resetting',
  );
});
