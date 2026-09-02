// enough. — Settings People & text-selection regression tests
//
// Run with:
//   npm run test:settings
//
// The runtime navigation/state coverage lives in scripts/smoke-test.mjs
// (active connections, long-press block, Blocked Users hierarchy, back
// navigation). This file adds focused source-level guards so the most
// important invariants fail fast and deterministically:
//   * Settings search renders only on the overview, never on a subpage;
//   * PeopleSettings renders active-connection rows with long-press support;
//   * the Settings → People → Blocked Users hierarchy is route-driven;
//   * UI chrome is non-selectable while editable fields stay selectable;
//   * the new user-facing strings resolve in English and German.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* Browser surface stubs (set before i18n import)                       */
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
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const settings = read('src/components/Settings.tsx');
const peopleSettings = read('src/components/settings/PeopleSettings.tsx');
const peopleSearch = read('src/components/settings/PeopleSearch.tsx');
const css = read('src/index.css');

test('People search is rendered only on the Settings overview and not by PeopleSettings', () => {
  assert.ok(
    settings.includes('<PeopleSearch'),
    'Settings renders the shared people-search component',
  );
  assert.equal(
    settings.split('<PeopleSearch').length - 1,
    1,
    'Settings renders exactly one PeopleSearch (the overview; subpages do not duplicate it)',
  );
  assert.ok(
    settings.includes('settings-search-wrap') &&
      !settings.includes('settings-subpanel-search'),
    'the search wrapper exists only for the overview (subpanel search removed)',
  );
  assert.ok(
    !peopleSettings.includes('SearchIcon'),
    'PeopleSettings no longer owns the search icon/UI',
  );
  assert.ok(
    !peopleSettings.includes('searchPlaceholder'),
    'PeopleSettings no longer renders the search input',
  );
  assert.ok(
    peopleSearch.includes('settingsScreen.searchPeople'),
    'the shared search component keeps the localized People search label',
  );
});

test('People search is gated to the Settings overview route', () => {
  assert.ok(
    settings.includes('const onOverview = open && category === null'),
    'overview detection compares the open route against the selected category',
  );
  assert.ok(
    settings.includes('{onOverview && ('),
    'the overview search is conditionally rendered on the overview route only',
  );
});

test('People settings renders active-connection rows with long-press support', () => {
  assert.ok(
    peopleSettings.includes('settings-connection-row'),
    'PeopleSettings renders an active-connection row element',
  );
  assert.ok(
    peopleSettings.includes('data-connection-id'),
    'active-connection rows carry the connection id for navigation testing',
  );
  assert.ok(
    peopleSettings.includes('onPointerDown={startPress}'),
    'active-connection rows implement pointer long-press',
  );
  assert.ok(
    peopleSettings.includes('onOpenConversation(profile)'),
    'a normal active-connection tap opens the correct chat',
  );
  assert.ok(
    peopleSettings.includes('onLongPress(profile)'),
    'a long-press routes to the row action handler',
  );
});

test('Blocked Users is driven by the People→Blocked route hierarchy', () => {
  assert.ok(
    peopleSettings.includes("navigate('#/settings/people/blocked')"),
    'People navigates to the nested Blocked Users route',
  );
  assert.ok(
    settings.includes('blockedFromPeople'),
    'Settings tracks whether Blocked Users came through People',
  );
  assert.ok(
    settings.includes("navigate('#/settings/people')"),
    'Settings keeps the legacy deep-link target for People',
  );
  assert.ok(
    settings.includes('settings-subpanel-nested'),
    'Blocked Users renders as the nested Settings subpanel',
  );
  assert.ok(
    settings.includes('subpanelBackTarget'),
    'subpage back navigation follows the route hierarchy',
  );
});

test('UI chrome is non-selectable while editable fields remain selectable', () => {
  // Settings covers labels/rows/buttons/logo/icons/navigation/controls.
  assert.ok(
    css.includes('.settings-overlay,\n.settings-overlay *') &&
      css.includes('user-select: none') &&
      css.includes('-webkit-touch-callout: none'),
    'Settings overlay disables selection for its non-editable UI surface',
  );
  assert.ok(css.includes('button,'), 'buttons are covered by the non-selectable UI rule');
  assert.ok(css.includes('.logo,'), 'the enough. logo is non-selectable');
  // Editable fields must stay selectable, including inside Settings.
  assert.ok(
    css.includes(
      ".settings-overlay input,\n.settings-overlay textarea,\n.settings-overlay [contenteditable='true'] {\n  -webkit-user-select: text;\n  user-select: text;",
    ),
    'Settings re-enables selection for editable inputs/fields',
  );
  // Messages keep their existing selection behavior.
  assert.match(css, /\.message,\n\.message \*/);
  assert.ok(
    /\.message,\n\.message \* \{[\s\S]*?user-select: none/.test(css),
    'message bubbles keep their existing non-selectable behavior',
  );
});

test('new Settings People strings resolve in English and German', () => {
  setLang('en');
  assert.equal(t('settingsScreen.activeConnections'), 'Active connections');
  assert.equal(
    t('settingsScreen.activeConnectionsEmpty'),
    'No active connections yet.',
  );
  setLang('de');
  assert.equal(t('settingsScreen.activeConnections'), 'Aktive Verbindungen');
  assert.equal(
    t('settingsScreen.activeConnectionsEmpty'),
    'Noch keine aktiven Verbindungen.',
  );
  setLang('en');
});
