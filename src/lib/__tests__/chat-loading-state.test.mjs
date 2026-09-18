// enough. — regression guards for the chat message-area loading state.
//
// The bug: opening a conversation from the overview rendered
//
//   <div className="chat-loading">{t('loading')}</div>   // t('loading') === '…'
//
// for as long as the initial load ran (connection → profiles → block state →
// deletions → first message page). That put a bare, centred "…" in the middle
// of the chat — the very placeholder string the overview and header guards
// (see chat-overview-loading.test.mjs / chat-open-identity.test.mjs) treat as
// *missing data* — so the sequence read as
//
//   open chat → "…" in the middle → messages
//
// The fix reuses the skeleton vocabulary the app already has (Home first-paint
// skeleton, chat-header identity skeleton): a quiet, decorative bubble
// skeleton that fills the same `flex: 1` slot with the same padding as
// `.messages`, anchored at the bottom like the newest messages. No text, no
// dots, no timer — `loading` flips exactly when the committed page can be
// read, never after a delay.
//
// The follow-up bug (this file's second half): unmasking the list at the
// page commit still flashed an intermediate state, because the loaded rows
// only resolve their display text afterwards (local cache read / engine
// decrypt run asynchronously). Every bubble rendered as "Decrypting…" /
// "Entschlüsseln…" until the display path caught up:
//
//   open chat → skeleton → "Entschlüsseln…" everywhere → messages
//
// The fix keeps the SAME skeleton and the SAME `loading` flag — only the
// moment of unmasking moves: the page commit now arms a reveal gate, and the
// gate releases `loading` on the render that carries the LAST display outcome
// of the first page (resolved plaintext, undecryptable notice, or the
// settled E2EE failure the bubbles report). Nothing is decrypted
// differently, and nothing waits for a clock: the app waits exactly as long
// as the real load/decrypt pass needs — one render tick for a fully cached
// or empty page, no added frame budget otherwise.
//
// These guards are source-level (the rendered counterpart — chat open,
// skeleton frame, messages after the load — is exercised by `npm run smoke`).
// They fail if the ellipsis or the decrypting placeholder becomes visible
// again during chat open, or if an artificial delay is introduced.
//
// Run with:
//   npm run test:chatloading
//   node --test --experimental-strip-types src/lib/__tests__/chat-loading-state.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { translations } from '../../i18n/translations.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const readRel = (path) => fs.readFileSync(`${__dirname}/../../${path}`, 'utf8');
const chat = readRel('components/Chat.tsx');
const css = readRel('index.css');

/** Slice `source` from `start` up to (excluding) `end`; both must exist. */
function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

/**
 * Remove comments so the assertions below can only be satisfied by rendered
 * JSX. The explanatory comment of the loading branch legitimately quotes the
 * removed placeholder; a comment never reaches the DOM.
 */
function rendered(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The loading branch of the chat body ternary (skeleton → !valid → error). */
const loadingBranch = section(chat, '{loading ? (', ') : !valid ? (');
const loadingJsx = rendered(loadingBranch);

/* ---------- 1: the central loading state renders no ellipsis ---------- */

test('the central chat loading state renders no ellipsis placeholder', () => {
  assert.ok(
    !loadingJsx.includes("t('loading')"),
    'the loading branch no longer renders the global loading string',
  );
  assert.ok(!loadingJsx.includes('…'), 'no ellipsis character is rendered');
  assert.ok(!loadingJsx.includes('...'), 'no three-dot literal is rendered');
  assert.ok(
    !loadingJsx.includes('chat-loading"'),
    'the text placeholder element is not reused for the pure loading state',
  );
  // No JSX text child at all: the state is shapes + an accessible name.
  assert.ok(
    !/>[^<>{}]*[A-Za-z0-9…][^<>{}]*</.test(loadingJsx.replace(/\s+/g, ' ')),
    'the loading branch renders no text content',
  );
});

test('the loading state is a labelled, decorative skeleton', () => {
  assert.match(loadingJsx, /className="chat-messages-skeleton"/);
  assert.match(loadingJsx, /role="status"/);
  assert.match(loadingJsx, /aria-label=\{t\('chat\.loadingMessages'\)\}/);
  assert.match(loadingJsx, /data-testid="chat-loading-skeleton"/);
  // The shapes are decorative; the accessible name carries the state, so the
  // information is not visual-only (and nothing is announced twice).
  assert.match(loadingJsx, /className="chat-skeleton-bubbles" aria-hidden="true"/);
  assert.equal(
    loadingJsx.match(/className="chat-skeleton-bubble /g)?.length,
    3,
    'the skeleton mirrors a short conversation tail',
  );
  assert.ok(!loadingJsx.includes('<Avatar'), 'the loading branch renders no avatar');
});

test('the accessible loading name is a real label in both languages', () => {
  for (const lang of ['en', 'de']) {
    const value = translations[lang].chat.loadingMessages;
    assert.equal(typeof value, 'string', `${lang} exposes chat.loadingMessages`);
    assert.ok(value.trim().length > 3, `${lang} loading name is a real label`);
    assert.notEqual(value, '…', `${lang} loading name is not the bare placeholder`);
    assert.notEqual(value, '...', `${lang} loading name is not the bare placeholder`);
    // It must also not be the global 'loading' string that caused the bug.
    assert.notEqual(value, translations[lang].loading);
  }
  assert.notEqual(
    translations.en.chat.loadingMessages,
    translations.de.chat.loadingMessages,
    'the German label is translated, not copied',
  );
  // The label is an accessible name only — it must never be rendered as text.
  assert.ok(
    !loadingJsx.includes("{t('chat.loadingMessages')}<"),
    'the label is an attribute value, not a text child',
  );
});

/* ---------- 2: explanatory states keep their (real) text ---------- */

test('the unavailable states still explain themselves in text', () => {
  const invalidBranch = section(chat, ') : !valid ? (', ') : loadError ? (');
  assert.match(invalidBranch, /className="chat-loading"/);
  assert.match(invalidBranch, /t\('offline\.noCachedChat'\)/);
  assert.match(invalidBranch, /t\('chat\.unavailable'\)/);
});

test('a successful load still renders the message list', () => {
  // The ternary chain must stay: loading → !valid → loadError → messages.
  const body = section(chat, '{loading ? (', '{grouped.map(({ message, group })');
  assert.ok(body.indexOf('chat-messages-skeleton') < body.indexOf('className="messages"'));
  assert.match(body, /<section\s+className="messages"/);
  assert.match(body, /t\('chat\.noMessages'\)/);
  const list = body.slice(body.indexOf('className="messages"'));
  assert.ok(!rendered(list).includes('…'), 'the loaded list renders no ellipsis placeholder');
});

/* ---------- 3: geometry stays stable (no layout shift) ---------- */

function rule(selector) {
  const m = css.match(new RegExp(`\\n\\.${selector.replace(/[.+]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

test('the skeleton occupies exactly the message-area slot', () => {
  const skeleton = rule('chat-messages-skeleton');
  const bubbles = rule('chat-skeleton-bubbles');
  const messages = rule('messages');
  assert.ok(skeleton && bubbles && messages, 'skeleton and message list are both styled');

  // Same flex slot as the removed `.chat-loading` placeholder, so the header,
  // banner and composer keep their positions while loading.
  assert.match(skeleton, /flex:\s*1/);
  assert.match(skeleton, /min-height:\s*0/);
  // Anchored at the bottom, like the newest messages of a loaded conversation.
  assert.match(skeleton, /justify-content:\s*flex-end/);

  // Same padding as `.messages` — the skeleton reserves the real box.
  const padding = (body) => /padding:\s*([^;]+);/.exec(body)?.[1].trim();
  assert.equal(padding(bubbles), padding(messages), 'skeleton and list share the padding');

  // Neutral, theme-independent surfaces — the same token the other skeletons use.
  assert.match(rule('chat-skeleton-bubble'), /background:\s*var\(--surface-2\)/);
  assert.match(rule('chat-skeleton-bubble'), /border-radius:\s*var\(--radius-md\)/);
  assert.ok(
    !/background:\s*(var\(--accent|var\(--sent|#[0-9a-f]{3,8})/i.test(bubbles),
    'the skeleton carries no accent or bubble colour',
  );
});

test('the skeleton reuses the existing pulse and invents no dot animation', () => {
  const bubbles = rule('chat-skeleton-bubbles');
  assert.match(bubbles, /animation:\s*skeleton-breathe/, 'reuses the shared skeleton keyframes');
  const skeletonCss = section(css, '.chat-messages-skeleton {', '/* request banner */');
  assert.ok(!skeletonCss.includes('@keyframes'), 'no new keyframes for the loading state');
  assert.ok(!/content:\s*['"]/.test(skeletonCss), 'no generated dot/text content');
  // The global reduced-motion block stills every animation, so no extra
  // exception is needed (v0.2 accessibility contract D1).
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

/* ---------- 4: no artificial timeout / delay ---------- */

test('the chat loading path contains no artificial timeout or delay', () => {
  assert.ok(!loadingBranch.includes('setTimeout'), 'the loading branch is not time-gated');
  assert.ok(!loadingBranch.includes('await new Promise'), 'no delay promise');
  assert.ok(!loadingBranch.includes('sleep('), 'no sleep');

  // Chat.tsx keeps exactly its three pre-existing timers: the debounced
  // read-position save and the two initial-anchoring settle passes. A delay
  // for the loading state would add a fourth.
  assert.equal(
    [...chat.matchAll(/setTimeout/g)].length,
    3,
    'Chat keeps exactly the read-position and anchoring timers',
  );
  assert.ok(chat.includes('INITIAL_ANCHOR_SETTLE_MS'), 'the anchoring timers are the settle passes');
  assert.ok(chat.includes('saveTimerRef.current = window.setTimeout'), 'the third timer debounces the read position');

  // The skeleton is gated by data, not by time: the load effect commits the
  // page and ARMS the reveal gate in the same synchronous block; the gate
  // itself is a render-derived check with no time component.
  const loadStart = chat.indexOf('/* ----------------------------- data load');
  const loadEnd = chat.search(/\/\* -+ realtime/);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'the load effect is delimited');
  const loadEffect = chat.slice(loadStart, loadEnd);
  assert.ok(!loadEffect.includes('setTimeout'), 'the load effect uses no timer');
  assert.ok(!loadEffect.includes('sleep('), 'the load effect uses no sleep');
  const commit = loadEffect.indexOf('setMessages(committed)');
  const arm = loadEffect.indexOf('setRevealPending(true)', commit);
  assert.ok(commit >= 0 && arm > commit, 'the page commit arms the reveal gate');
  assert.ok(
    !loadEffect.slice(commit).includes('setLoading(false)'),
    'the online commit never unmasks the list directly',
  );
});

/* ---------- 5: the first page reveals only when fully display-ready ------ */

test('the loaded first page stays behind the skeleton until display-ready', () => {
  // The reveal gate is derived from the SAME per-bubble resolver the render
  // loop uses — pending means "do not unmask yet" — so the localized
  // "decrypting" notice can no longer appear for the freshly loaded page.
  const gate = section(chat, '// Reveal gate for the committed first page', '}, [revealPending');
  assert.ok(gate.includes('isChatPageDisplayReady(visibleMessages'), 'the gate checks the rendered list');
  assert.match(gate, /resolveBubbleText\(\{/, 'the gate reuses the per-bubble display resolver');
  assert.ok(gate.includes("kind !== 'pending'"), 'only a FINAL bubble outcome releases the gate');
  // Releasing must also disarm, so realtime rows can never re-hide the list.
  const disarm = gate.indexOf('setRevealPending(false);');
  const release = gate.indexOf('setLoading(false);', disarm);
  assert.ok(disarm >= 0 && release > disarm, 'reveal flips loading exactly as it disarms');
  // The gate can never strand the skeleton: the explanation branches release
  // it, and both success commits (online page, offline snapshot) arm it.
  assert.ok(gate.includes('!valid || loadError'), 'explanation branches release the gate');
  assert.ok(!gate.includes('setTimeout'), 'the reveal gate uses no timer');
  assert.ok(!gate.includes('await new Promise'), 'the reveal gate awaits no delay promise');
  assert.ok(!gate.includes('sleep('), 'the reveal gate uses no sleep');

  const offlineCommit = section(chat, 'if (shouldSkipNetwork()) {', 'const found = await getConnection');
  assert.ok(
    offlineCommit.includes('setMessages(snapshot.messages)') && offlineCommit.includes('setRevealPending(true)'),
    'the offline snapshot commit also goes through the reveal gate',
  );
  // A chat without a cached snapshot has nothing to decrypt: the explanation
  // branch must still be reached immediately, never gated behind the gate.
  assert.ok(
    offlineCommit.includes('setLoading(false)'),
    'the not-cached offline path still flips loading for its explanation',
  );

  // Conversation switching clears both the display state and the gate, so a
  // previous conversation's unresolved page can neither reveal nor block the
  // next one.
  const reset = section(chat, '// Reset display state when switching conversations', '}, [connectionId]);');
  assert.ok(reset.includes('setPlain({})') && reset.includes('setUndecryptable(new Set())'), 'display state clears on switch');
  assert.ok(reset.includes('setRevealPending(false)'), 'the gate is disarmed on switch');
  const loadStart = chat.indexOf('/* ----------------------------- data load');
  const loadEnd = chat.search(/\/\* -+ realtime/);
  const loadEffect = chat.slice(loadStart, loadEnd);
  assert.ok(
    loadEffect.indexOf('setRevealPending(false)') < loadEffect.indexOf('(async () => {'),
    'a superseded or retried load starts with the gate disarmed',
  );
});

test('opening a chat never renders the localized decrypting notice for the first page', () => {
  // The per-bubble notice itself stays (it is the audit C1 contract for
  // realtime and pagination rows: never an empty bubble) — what must not
  // exist is a render path that UNMASKS the list while a first-page row is
  // still pending. That is guaranteed structurally: the only setLoading(false)
  // after a page commit lives inside the reveal gate, and the gate is the
  // render condition of the whole message area (`loading` still owns the
  // skeleton branch).
  const renderGate = section(chat, '{loading ? (', ') : !valid ? (');
  assert.ok(
    chat.includes("t('chat.decrypting')"),
    'the pending bubble state itself is unchanged (realtime / pagination)',
  );
  assert.match(renderGate, /^\{loading \? \(/, 'the skeleton branch is still gated by `loading` alone');
  // `loading` is the single switch for the message area, so while the gate
  // is armed the list cannot be in the DOM at all. Only the two successful
  // commits arm it; every other unmask path stays direct.
  assert.equal(
    [...chat.matchAll(/setRevealPending\(true\);/g)].length,
    2,
    'exactly the online and offline page commits arm the reveal gate',
  );
});

/* ---------- 6: MessageComposer is permanently present and disabled during loading ---------- */

test('MessageComposer is rendered outside the loading branch and disabled during loading/reveal', () => {
  // F-01: The composer must NOT be nested inside the `loading === false` branch.
  // It must already be mounted in its final position while the skeleton is
  // active, so that unmasking the messages replaces the skeleton 1:1 without
  // pushing the messages upward.
  const loadingBranch = section(chat, '{loading ? (', ') : !valid ? (');
  assert.ok(
    !loadingBranch.includes('<MessageComposer'),
    'the composer is not nested inside the loading branch',
  );

  // The composer is rendered as a structural sibling of the message area:
  const composerTag = chat.match(/<MessageComposer[^>]*\/>/s);
  assert.ok(composerTag, 'the MessageComposer element exists');
  const disabledExpr = composerTag[0].match(/disabled=\{([^}]*)\}/);
  assert.ok(disabledExpr, 'the composer declares its disabled expression');
  const terms = disabledExpr[1].split('||').map((t) => t.trim());
  assert.ok(terms.includes('loading'), 'composer is disabled while loading');
  assert.ok(terms.includes('revealPending'), 'composer is disabled while revealPending');

  // Defense-in-depth: handleSend also rejects while loading/revealPending
  const sendFn = section(chat, 'async function handleSend(text: string): Promise<boolean> {', 'if (offline) return false;');
  assert.match(sendFn, /if \(loading \|\| revealPending/);

  // Conversation isolation: composer is keyed by connectionId so drafts never leak across chats
  assert.match(composerTag[0], /key=\{connectionId\}/, 'composer is keyed by connectionId');
});

