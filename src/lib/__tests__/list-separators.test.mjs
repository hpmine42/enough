// enough. — regression guard for one list principle: no separator lines.
//
// Every list and menu of the app — the chat overview, the Settings groups
// and their subpages, the people search on the dedicated "New chat" screen
// and the bottom sheet — separates its entries by spacing, typography and
// the entry's own hover/press surface. Decorative hairlines between single
// entries are what made the app read like a generated dashboard, so they
// are gone and must not come back.
//
// These are source-level guards: the app is not renderable in the Node test
// runner without the full React/E2EE harness (the rendered counterpart —
// navigation, long-press menu, empty state — is exercised by the smoke
// test). The stylesheet is parsed, so a reintroduced divider fails here.
//
// Run with:
//   npm run test:lists
//   node --test --experimental-strip-types src/lib/__tests__/list-separators.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const css = read('src/index.css');
const accountSettings = read('src/components/settings/AccountSettings.tsx');

/**
 * Flat rule list of the stylesheet: comments removed, then every
 * `selector { body }` pair without nested braces (rules inside `@media` are
 * picked up as well).
 */
const allRules = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((m) => ({ selector: m[1].trim(), body: m[2] }));

/** Every rule whose selector mentions this token. */
const rulesMentioning = (token) =>
  allRules.filter((rule) => rule.selector.includes(token));

/** The joined bodies of every rule declared for exactly this selector. */
const bodyOf = (selector) =>
  allRules
    .filter((rule) => rule.selector === selector)
    .map((rule) => rule.body)
    .join(';');

/** Every entry class of every list and menu of the app. */
const ENTRIES = [
  '.chat-row', // chat overview rows
  '.skeleton-row', // their first-paint placeholders
  '.settings-row', // Settings groups + subpage rows
  '.settings-static-row', // Profile facts (username, e-mail)
  '.settings-search-row', // people-search results ("New chat")
  '.blocked-search-row', // blocked people-search results
  '.settings-connection-row', // Settings → People active connections
  '.sheet-item', // bottom-sheet actions
];

const SEPARATOR_BORDER = /\bborder-(top|bottom)\s*:/;
const ONE_PIXEL_LINE = /(height:\s*1px|border(-|-top|-bottom)?:\s*1px)/;

test('no list or menu entry draws a separator line', () => {
  for (const token of ENTRIES) {
    const rules = rulesMentioning(token);
    assert.ok(rules.length > 0, `index.css styles ${token}`);
    for (const rule of rules) {
      assert.ok(
        !SEPARATOR_BORDER.test(rule.body),
        `${rule.selector} must not draw a horizontal line between entries`,
      );
      // A pseudo-element hairline is the same divider in disguise: entries
      // may not own a `::before`/`::after` of their own at all.
      assert.ok(
        !/::(before|after)/.test(rule.selector),
        `${rule.selector} must not exist — no pseudo-element separators`,
      );
    }
  }
});

test('the removed divider rules stay removed', () => {
  for (const selector of [
    '.chat-row + .chat-row::before',
    '.skeleton-row + .skeleton-row::before',
    '.settings-delete-separator',
  ]) {
    assert.ok(
      !allRules.some((rule) => rule.selector === selector),
      `${selector} must not come back`,
    );
  }
  assert.ok(
    !css.includes('settings-delete-separator'),
    'the stylesheet has no Delete Account divider left',
  );
  assert.ok(
    !accountSettings.includes('settings-delete-separator'),
    'AccountSettings renders no separator element above Delete Account',
  );
  // Rows themselves are not one-pixel surfaces either.
  for (const selector of ['.settings-row', '.settings-static-row']) {
    assert.ok(
      !ONE_PIXEL_LINE.test(bodyOf(selector)),
      `${selector} is not a one-pixel surface`,
    );
  }
});

test('entries are told apart by spacing instead', () => {
  // The lists themselves carry the rhythm …
  for (const selector of [
    '.chat-list',
    '.chat-list-skeleton',
    '.settings-search-results',
    '.sheet-items',
  ]) {
    const body = bodyOf(selector);
    assert.ok(body, `${selector} is styled`);
    assert.ok(/gap:/.test(body), `${selector} separates its entries with a gap`);
  }
  // … and so do rows that sit directly next to each other.
  for (const selector of [
    '.settings-row + .settings-row',
    '.settings-static-row + .settings-static-row',
  ]) {
    const rules = rulesMentioning(selector);
    assert.ok(rules.length > 0, `${selector} is styled`);
    assert.ok(
      rules.some((rule) => /margin-top:/.test(rule.body)),
      `${selector} separates two entries with a margin`,
    );
  }
  // Settings groups stay legible as groups through distance alone.
  const groupGap = bodyOf('.settings-section + .settings-section');
  assert.ok(groupGap && /padding-top:/.test(groupGap), 'groups keep their distance');
  const section = bodyOf('.settings-section');
  assert.ok(
    section && /padding:\s*24px 22px 12px/.test(section),
    'a group closes with space, not a line',
  );
  // The destructive account action is set apart by distance, not by a rule.
  const deleteRow = bodyOf('.settings-row.delete-spaced');
  assert.ok(
    deleteRow && /margin-top:\s*44px/.test(deleteRow),
    'Delete Account stands apart through distance alone',
  );
});

test('rows stay plain canvas, not cards in cards', () => {
  for (const selector of ['.settings-row', '.settings-static-row']) {
    const body = bodyOf(selector);
    assert.ok(body, `${selector} is styled`);
    assert.ok(/background:\s*transparent/.test(body), `${selector} sits on the canvas`);
    assert.ok(!/box-shadow/.test(body), `${selector} gets no card elevation`);
    assert.ok(/border:\s*0/.test(body), `${selector} gets no card border`);
    // The rounded surface is inset, so the label stays on the reading axis.
    assert.ok(
      /margin:\s*0 calc\(var\(--row-inset\) \* -1\)/.test(body),
      `${selector} keeps its label on the section's reading axis`,
    );
  }
  const overlay = bodyOf('.settings-overlay');
  assert.ok(
    overlay && /--row-inset:/.test(overlay),
    'the row inset is declared on the Settings surface',
  );
});

test('entries keep a quiet hover and press surface', () => {
  // Without a line, the interaction surface is what tells entries apart
  // under the pointer. It stays subtle: a surface change, no glow, no
  // gradient, no movement.
  const surfaces = [
    '.chat:hover',
    '.chat:active',
    '.settings-row.clickable:hover',
    '.settings-row.clickable:active',
    '.settings-email-row:hover',
    '.sheet-item:hover:not(:disabled)',
  ];
  for (const selector of surfaces) {
    const body = bodyOf(selector);
    assert.ok(body, `${selector} is styled`);
    assert.ok(
      /background:\s*var\(--surface(-2)?\)/.test(body),
      `${selector} changes the row surface`,
    );
    assert.ok(
      !/box-shadow/.test(body) && !/gradient/.test(body) && !/\btransform\s*:/.test(body),
      `${selector} stays a flat surface change`,
    );
  }
});
