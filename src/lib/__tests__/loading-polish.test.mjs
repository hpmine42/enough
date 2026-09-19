// enough. — regression guards for the v0.5 P3 loading polish.
//
// Three pre-existing polish issues, fixed without touching the chat reveal
// gate, E2EE, RLS, auth, realtime, PWA or navigation architecture:
//
//   P3-01  The boot state rendered `<main className="loading">{t('loading')}
//          </main>` — a bare centred '…' on every cold start. It now renders
//          a quiet empty viewport whose labelled role="status" region carries
//          the state for assistive technology only (new `appLoading`, EN+DE).
//   P3-02  Busy buttons swapped their label for `t('loading')` ('…'), which
//          collapsed the button width on every normal -> busy transition.
//          Buttons now keep their label; the busy state is carried by the
//          existing `disabled` attribute (plus the shared `:disabled`
//          dimming) alone. The resend link gains a scoped `.link:disabled`
//          rule — the only button class without one.
//   P3-03  The scroll-down disc was anchored to the screen bottom with a
//          fixed safe-area + 100px offset that only fit one composer height:
//          a maximised composer (110px input + chrome ≈ 139px + safe area)
//          could reach into the disc. The disc now anchors to the bottom of
//          a `.messages-wrap` positioning context at a constant 25px gap —
//          the exact gap the old offset produced above a normal-height
//          composer — at any composer height, with no JS measurement.
//
// These guards are source-level; the rendered counterparts ride on the
// existing suites (`test:contrast` pins the disc geometry, `test:profileemail`
// pins the new busy-label contract, `npm run smoke` records the chat-open
// frames). They fail if the ellipsis, the width-shifting label swap, or the
// screen-anchored disc offset is reintroduced.
//
// Run with:
//   npm run test:loadingpolish
//   node --test --experimental-strip-types src/lib/__tests__/loading-polish.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { translations } from '../../i18n/translations.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const readRel = (path) => fs.readFileSync(`${__dirname}/../../${path}`, 'utf8');
const app = readRel('App.tsx');
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

/** Body of the first CSS rule whose selector is exactly `selector`. */
function ruleBody(selector) {
  const needle = `\n${selector} {`;
  const at = css.indexOf(needle);
  assert.notEqual(at, -1, `missing CSS rule: ${selector}`);
  let depth = 1;
  let i = at + needle.length;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  assert.equal(depth, 0, `unbalanced rule: ${selector}`);
  return css.slice(start, i - 1);
}

/* ---------------- P3-01: quiet boot state ---------------- */

const bootBranch = section(app, 'if (loading) {', 'if (recovery) {');

test('the boot state renders no visible ellipsis or loading text', () => {
  assert.ok(!bootBranch.includes("t('loading')"), 'no global loading string in the boot branch');
  assert.ok(!bootBranch.includes('…'), 'no ellipsis character in the boot branch');
  assert.ok(!bootBranch.includes('...'), 'no three-dot literal in the boot branch');
  assert.ok(
    !/>[^<>{}]*[A-Za-z0-9…][^<>{}]*</.test(bootBranch.replace(/\s+/g, ' ')),
    'the boot branch renders no text content',
  );
});

test('the boot state is a labelled, empty quiet status region', () => {
  assert.match(bootBranch, /<main className="loading"/);
  assert.match(bootBranch, /role="status"/);
  assert.match(bootBranch, /aria-label=\{t\('appLoading'\)\}/);
  // Empty element: self-closing, so nothing can visually simulate content.
  assert.match(bootBranch, /<main className="loading" role="status" aria-label=\{t\('appLoading'\)\} \/>/);
  assert.ok(!bootBranch.includes('setTimeout'), 'the boot state is not time-gated');
});

test('the boot accessible name is a real label in both languages', () => {
  for (const lang of ['en', 'de']) {
    const value = translations[lang].appLoading;
    assert.equal(typeof value, 'string', `${lang} exposes appLoading`);
    assert.ok(value.trim().length > 3, `${lang} boot name is a real label`);
    assert.notEqual(value, '…', `${lang} boot name is not the bare placeholder`);
    assert.notEqual(value, '...', `${lang} boot name is not the bare placeholder`);
    assert.notEqual(value, translations[lang].loading);
  }
  assert.notEqual(
    translations.en.appLoading,
    translations.de.appLoading,
    'the German label is translated, not copied',
  );
});

test('the boot slot invents no generated content or animation', () => {
  const loading = ruleBody('.loading');
  assert.ok(!/(^|[;{])\s*content\s*:/.test(loading), 'no generated text content');
  assert.ok(!/animation/.test(loading), 'no boot animation');
});

/* ---------------- P3-02: width-stable busy buttons ---------------- */

const BUSY_BUTTON_FILES = [
  'components/Dialog.tsx',
  'components/Login.tsx',
  'components/Register.tsx',
  'components/ForgotPassword.tsx',
  'components/ResetPassword.tsx',
  'components/settings/AccountSettings.tsx',
  'components/settings/ProfileSettings.tsx',
  'components/Chat.tsx',
];

test('no busy button swaps its label for the global loading placeholder', () => {
  for (const file of BUSY_BUTTON_FILES) {
    const src = readRel(file);
    assert.ok(
      !/\?\s*t\('loading'\)/.test(src),
      `${file} renders no busy ? t('loading') label swap`,
    );
  }
  // Belt and braces across every component: the swap pattern must be gone
  // project-wide, not just at the thirteen known sites.
  const componentsDir = `${__dirname}/../../components`;
  for (const entry of fs.readdirSync(componentsDir, { recursive: true })) {
    if (typeof entry !== 'string' || !entry.endsWith('.tsx')) continue;
    const src = fs.readFileSync(`${componentsDir}/${entry}`, 'utf8');
    assert.ok(
      !/\?\s*t\('loading'\)/.test(src),
      `components/${entry} renders no busy ? t('loading') label swap`,
    );
  }
  assert.ok(!/\?\s*t\('loading'\)/.test(app), 'App.tsx renders no busy label swap');
});

test('every busy button stays disabled while its request runs', () => {
  const dialog = readRel('components/Dialog.tsx');
  assert.match(dialog, /disabled=\{busy \|\| confirmDisabled\}/);
  for (const file of ['components/Login.tsx', 'components/ForgotPassword.tsx', 'components/ResetPassword.tsx']) {
    assert.match(readRel(file), /disabled=\{busy\}/, `${file} disables its submit while busy`);
  }
  const register = readRel('components/Register.tsx');
  assert.match(register, /disabled=\{\s*busy \|\|/);
  assert.match(register, /disabled=\{resendBusy\}/);
  const account = readRel('components/settings/AccountSettings.tsx');
  assert.match(account, /disabled=\{emailBusy\}/);
  assert.match(account, /disabled=\{pwBusy\}/);
  assert.match(readRel('components/settings/ProfileSettings.tsx'), /disabled=\{nameBusy\}/);
  const bannerButtons = [...chat.matchAll(/disabled=\{busyId === conn\?\.id\}/g)].length;
  assert.ok(bannerButtons >= 4, 'all four request-banner actions disable while busy');
});

test('every busy button keeps its own label', () => {
  assert.match(readRel('components/Dialog.tsx'), /\{confirmLabel\}/);
  assert.match(readRel('components/Login.tsx'), /\{t\('auth\.login'\)\}/);
  assert.match(readRel('components/Register.tsx'), /\{t\('auth\.register'\)\}/);
  assert.match(readRel('components/Register.tsx'), /\{t\('auth\.confirmResend'\)\}/);
  assert.match(readRel('components/ForgotPassword.tsx'), /\{t\('auth\.sendResetLink'\)\}/);
  assert.match(readRel('components/ResetPassword.tsx'), /\{t\('auth\.setNewPassword'\)\}/);
  assert.match(readRel('components/settings/AccountSettings.tsx'), /\{t\('settingsScreen\.changeEmailSubmit'\)\}/);
  assert.match(readRel('components/settings/AccountSettings.tsx'), /\{t\('settingsScreen\.changePasswordSubmit'\)\}/);
  assert.match(readRel('components/settings/ProfileSettings.tsx'), /\{t\('save'\)\}/);
  assert.match(chat, /\{t\('connection\.accept'\)\}/);
  assert.match(chat, /\{t\('connection\.cancelRequest'\)\}/);
  assert.ok(
    [...chat.matchAll(/\{t\('connection\.requestAgain'\)\}/g)].length >= 2,
    'both request-again actions keep their label',
  );
});

test('the link-button gains a scoped disabled state; other buttons keep theirs', () => {
  const linkDisabled = ruleBody('.link:disabled');
  assert.match(linkDisabled, /opacity:\s*0\.5/);
  assert.match(linkDisabled, /cursor:\s*default/);
  // No new global button rule: the existing classes already dim via their
  // own :disabled rules, which stay untouched.
  for (const selector of ['.button:disabled', '.btn-small:disabled', '.btn-primary:disabled']) {
    assert.match(ruleBody(selector), /opacity:\s*0\.5/);
  }
});

test('the global loading string survives for its non-visible fallback only', () => {
  assert.equal(translations.en.loading, '…', 'the key itself is retained');
  assert.equal(translations.de.loading, '…', 'the key itself is retained');
  const bubble = readRel('components/MessageBubble.tsx');
  assert.match(
    bubble,
    /aria-label=\{text \|\| t\('loading'\)\}/,
    'the only remaining use is the non-visible accessible-name fallback',
  );
});

/* ---------------- P3-03: scroll disc above any composer height ---------------- */

test('the message viewport owns a positioning wrapper with the list slot', () => {
  const wrap = ruleBody('.messages-wrap');
  assert.match(wrap, /flex:\s*1/);
  assert.match(wrap, /min-height:\s*0/);
  assert.match(wrap, /position:\s*relative/);
  assert.match(wrap, /display:\s*flex/);
  assert.match(wrap, /flex-direction:\s*column/);
  // The list keeps its own slot inside the wrapper; the loading skeleton
  // keeps the identical slot for the unloaded branch (F-01 geometry).
  assert.match(ruleBody('.messages'), /flex:\s*1/);
  assert.match(ruleBody('.chat-messages-skeleton'), /flex:\s*1/);
});

test('the scroll disc anchors to the wrapper at a constant gap', () => {
  const disc = ruleBody('.scroll-down');
  assert.match(disc, /position:\s*absolute/);
  assert.match(disc, /right:\s*18px/);
  assert.match(disc, /bottom:\s*25px/);
  assert.ok(!disc.includes('env('), 'no screen-anchored safe-area offset remains');
  assert.ok(!disc.includes('100px'), 'the one-height offset is gone');
});

test('the scroll disc renders inside the loaded message viewport', () => {
  const wrapOpen = chat.indexOf('<div className="messages-wrap">');
  const disc = chat.indexOf('className="scroll-down"');
  assert.ok(wrapOpen >= 0 && disc > wrapOpen, 'the disc renders inside the wrapper');
  const wrapClose = chat.indexOf('</div>', chat.indexOf('scroll-down-count'));
  assert.ok(wrapClose > disc, 'the wrapper closes after the disc');
  // Exactly one disc, and it no longer floats at the screen level behind
  // the composer — so it can neither overlap a maximised composer nor hover
  // over the loading skeleton or an explanatory state.
  assert.equal([...chat.matchAll(/className="scroll-down"/g)].length, 1);
  assert.ok(
    disc < chat.indexOf('<MessageComposer'),
    'the disc is not rendered after the composer at screen level',
  );
});

test('the composer height bound the fix clears is still documented in code', () => {
  assert.match(ruleBody('.composer-input'), /max-height:\s*110px/);
  assert.match(
    readRel('components/MessageComposer.tsx'),
    /const MAX_LINES = 4;/,
    'the textarea auto-grow cap stays the dimensioning input',
  );
});
