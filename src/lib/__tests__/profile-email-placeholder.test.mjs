// enough. — v0.5 audit F-07: source guards for the Profile subpage.
//
// The bug: `ProfileSettings` rendered its data value slots through fallback
// literals, and the email row read
//
//   <span className="settings-static-value">{email || '…'}</span>
//
// while its parent passed `email={user?.email ?? ''}`. Two things that were
// never data could therefore appear as data:
//   * the email row showed a bare '…' whenever the auth session carried no
//     address, and
//   * the display-name input was seeded from `displayName(profile)`, which
//     answers '…' while the profile row has not arrived yet — a visible
//     placeholder that the input even saves on blur.
//
// Both are the same defect class the Overview/People/Chat fixes removed:
// a placeholder rendered where a value belongs. These guards fail if the
// fallback literals come back, if a value slot starts carrying literal text,
// or if the fix grows machinery (timers, fake data, new data sources).
//
// They are SOURCE-LEVEL guards, per the pattern already used by
// `chat-open-identity.test.mjs`, `settings-people.test.mjs` (F-06) and
// `danger-contrast.test.mjs` (F-02): the component is not renderable in the
// Node test runner, and its rendered behaviour is asserted by the jsdom
// smoke test (`npm run smoke`, F-07 section: the real address, the deferred
// profile window and the email-less session).
//
// Run with:
//   npm run test:profileemail
//   node --test --experimental-strip-types src/lib/__tests__/profile-email-placeholder.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* Browser surface stubs (set before the i18n import)                   */
/* ------------------------------------------------------------------ */

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
globalThis.document = { documentElement: { lang: 'en' } };

const { t, setLang } = await import('../../i18n/index.ts');
const { translations } = await import('../../i18n/translations.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const profile = read('src/components/settings/ProfileSettings.tsx');
const settings = read('src/components/Settings.tsx');

/** Source without comments: an explaining comment must never satisfy a guard. */
function rendered(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Slice `source` from `start` up to (excluding) `end`; both must exist. */
function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

const profileJsx = rendered(profile);
const settingsJsx = rendered(settings);

// The email row of the Profile subpage: the button element that carries the
// label and the value slot (the opening tag is part of the slice).
const emailRowAt = profileJsx.indexOf('className="settings-static-row settings-email-row"');
assert.notEqual(emailRowAt, -1, 'the Profile subpage has an email row');
const emailRowOpen = profileJsx
  .slice(profileJsx.lastIndexOf('<button', emailRowAt), emailRowAt)
  .replace(/\s+/g, ' ');
const emailRow = (
  emailRowOpen + ' ' + section(profileJsx, 'settings-static-row settings-email-row', '</button>')
).replace(/\s+/g, ' ');

/** Every data value slot of the subpage (`.settings-static-value` bodies). */
const valueSlots = [
  ...profileJsx.matchAll(/<span className="settings-static-value">([\s\S]*?)<\/span>/g),
].map((m) => m[1].trim());

/* ------------------------------------------------------------------ */
/* 1. The email row renders the address, never a placeholder            */
/* ------------------------------------------------------------------ */

test('the Profile email row renders the session address and no placeholder', () => {
  assert.ok(
    emailRow.includes('<span className="settings-static-label">{t(\'settingsScreen.email\')}</span>'),
    'the row still carries its localized label',
  );
  // The value slot is the prop itself — no literal, no concatenation, no
  // fallback operator can produce anything else.
  assert.ok(
    emailRow.includes('<span className="settings-static-value">{email}</span>'),
    'the value slot renders the email prop verbatim',
  );
  assert.ok(
    !/\|\|/.test(emailRow) && !/\?\?/.test(emailRow),
    'no fallback operator survives in the email row',
  );
  // The old bug, spelled out: this is what the guard below must catch.
  assert.ok(
    !/\{email\s*\|\|\s*'…'\}/.test(emailRow) && !/email\s*\|\|\s*'…'/.test(profileJsx),
    'the removed `email || …` fallback is gone',
  );
});

test('an empty address renders the label alone instead of placeholder data', () => {
  // `email && <span>` is the whole rule: a missing address adds no node and
  // no text. The row itself stays, so the change-email entry point remains
  // reachable exactly where it was.
  assert.match(
    emailRow,
    /\{email && <span className="settings-static-value">\{email\}<\/span>\}/,
    'the value slot exists only when the session carries an address',
  );
  assert.ok(
    !/\{email \?/.test(emailRow),
    'no ternary can substitute another value for a missing address',
  );
  assert.ok(
    !/t\('loading'\)/.test(emailRow),
    'the row does not fall back to the global loading placeholder',
  );
});

/* ------------------------------------------------------------------ */
/* 2. No data slot of the subpage can carry placeholder text            */
/* ------------------------------------------------------------------ */

test('no value slot of the Profile subpage renders literal text', () => {
  assert.ok(valueSlots.length >= 2, 'the subpage keeps its username and email value slots');
  for (const slot of valueSlots) {
    assert.ok(
      !slot.includes('…'),
      `value slot renders no ellipsis character: ${JSON.stringify(slot)}`,
    );
    assert.ok(
      !slot.includes('...'),
      `value slot renders no three-dot literal: ${JSON.stringify(slot)}`,
    );
    // A slot is a data expression (optionally prefixed by the '@' sigil of
    // the username) — never a quoted string and never a translated literal.
    assert.ok(
      !/['"]/.test(slot),
      `value slot carries no quoted literal: ${JSON.stringify(slot)}`,
    );
    assert.ok(
      !/\bt\(/.test(slot),
      `value slot is not a translation key: ${JSON.stringify(slot)}`,
    );
  }
});

test('ProfileSettings contains no ellipsis literal at all', () => {
  assert.ok(!profileJsx.includes('…'), 'no ellipsis character anywhere in the component');
  assert.ok(!profileJsx.includes('...'), 'no three-dot literal anywhere in the component');
  // The save action keeps its label while busy (P3-02): the old
  // `{nameBusy ? t('loading') : t('save')}` swap collapsed the button to a
  // bare '…' and shifted its width. The busy state is now carried by
  // `disabled` (plus the shared `:disabled` dimming) alone, so no loading
  // placeholder remains anywhere in this component.
  assert.equal(
    [...profileJsx.matchAll(/t\('loading'\)/g)].length,
    0,
    'no loading placeholder usage remains in the component',
  );
  assert.match(
    profileJsx,
    /disabled=\{nameBusy\}/,
    'the save button stays disabled while its request runs',
  );
  assert.match(profileJsx, /\{t\('save'\)\}/, 'the save button keeps its label while busy');
});

/* ------------------------------------------------------------------ */
/* 3. The prop chain never fabricates a value                           */
/* ------------------------------------------------------------------ */

test('the parent passes the session address through without inventing one', () => {
  assert.ok(
    settingsJsx.includes('email={user?.email}'),
    'the email prop is the auth session value itself',
  );
  assert.ok(
    !/email=\{user\?\.email \?\? ''\}/.test(settingsJsx),
    'the fabricated empty string is gone from the call site',
  );
  assert.ok(
    !/email=\{[^}]*\?\?/.test(settingsJsx),
    'no fallback expression feeds the email prop',
  );
  assert.match(
    profile,
    /email: string \| undefined;/,
    'the prop contract admits the legitimate "no address" state',
  );
});

/* ------------------------------------------------------------------ */
/* 4. The incomplete-profile window feeds no placeholder into the input */
/* ------------------------------------------------------------------ */

test('the display-name draft never takes the "…" fallback of displayName()', () => {
  // `displayName(profile)` answers '…' for a profile row that has not
  // arrived yet. That placeholder must not become an input value (it is
  // visible, and the input saves on blur), so the call sites guard it.
  assert.ok(
    settingsJsx.includes("setNameDraft(profile ? displayName(profile) : '')"),
    'an absent profile leaves the draft empty',
  );
  assert.ok(
    !settingsJsx.includes('setNameDraft(displayName(profile))'),
    'the unguarded draft assignment is gone',
  );
  assert.ok(
    settingsJsx.includes("displayNameValue={profile ? displayName(profile) : ''}"),
    'the dirty-check value is guarded the same way (no phantom Save button)',
  );
  assert.ok(
    !/displayNameValue=\{displayName\(/.test(settingsJsx),
    'no unguarded displayName() value reaches the subpage',
  );
  // The helper itself is shared with Home/Chat and keeps its documented
  // contract — F-07 fixes the Profile call sites, not the shared fallback.
  const helpers = read('src/lib/helpers.ts');
  assert.ok(
    helpers.includes("return dn ? dn : profile?.username ?? '…';"),
    'the shared displayName() contract is untouched',
  );
});

/* ------------------------------------------------------------------ */
/* 5. Presentation-only: no timer, no fake data, no new data source     */
/* ------------------------------------------------------------------ */

test('the fix adds no timer, no fake address and no new data source', () => {
  for (const forbidden of ['setTimeout', 'setInterval', 'new Promise', 'await ']) {
    assert.ok(
      !profileJsx.includes(forbidden),
      `ProfileSettings stays synchronous (no ${forbidden})`,
    );
  }
  assert.ok(
    !/@[a-z]+@example\.com/.test(profileJsx) && !/example\.com/.test(profileJsx),
    'no invented address is rendered',
  );
  // The import list is the whole data surface of this component: props only.
  const imports = [...profileJsx.matchAll(/import\s+\{([^}]*)\}\s+from\s+'([^']+)'/g)].map(
    (m) => [m[1].trim(), m[2]],
  );
  assert.deepEqual(
    imports.map(([names]) => names),
    ['t', 'MAX_DISPLAY_NAME_LENGTH', 'Section'],
    'the component still depends on i18n, input limits and the shared Section',
  );
  assert.deepEqual(
    imports.map(([, from]) => from),
    ['../../i18n', '../../lib/input', './settings-ui'],
    'no auth, Supabase or session import was added',
  );
});

test('the change keeps the row interaction and the existing error semantics', () => {
  assert.ok(
    emailRow.includes('type="button"') && emailRow.includes('onClick={onEmailClick}'),
    'the email row is still the same real button opening the change-email flow',
  );
  assert.equal(
    profileJsx.split('settings-email-row').length - 1,
    1,
    'exactly one email row is rendered (the row is never conditionally hidden)',
  );
  assert.ok(
    profileJsx.includes('role="alert"') && profileJsx.includes('field-hint ok'),
    'the display-name error and saved states are unchanged',
  );
});

/* ------------------------------------------------------------------ */
/* 6. The label-alone state stays a real, accessible name               */
/* ------------------------------------------------------------------ */

test('the row keeps a real accessible name in both languages', () => {
  for (const lang of ['en', 'de']) {
    const value = translations[lang].settingsScreen.email;
    assert.ok(typeof value === 'string' && value.trim().length > 3, `${lang} email label is real`);
    assert.notEqual(value, '…', `${lang} email label is not the bare placeholder`);
    assert.notEqual(value, translations[lang].loading, `${lang} email label is not 'loading'`);
  }
  assert.equal(t('settingsScreen.email'), 'Email');
  setLang('de');
  assert.equal(t('settingsScreen.email'), 'E-Mail');
  setLang('en');
});
