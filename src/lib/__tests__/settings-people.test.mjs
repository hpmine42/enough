// enough. — People search & Settings People regression tests
//
// Run with:
//   npm run test:settings
//
// The runtime navigation/state coverage lives in scripts/smoke-test.mjs
// (active connections, long-press block, Blocked Users hierarchy, back
// navigation). This file adds focused source-level guards so the most
// important invariants fail fast and deterministically:
//   * the people search is a dedicated screen (route #/new-chat) reached
//     from the bottom navigation, not a search inside the Settings overview;
//   * the Settings overview carries no search input and no search-specific
//     layout machinery;
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

test('People search lives on its dedicated screen, not in the Settings overview', () => {
  // The Settings component still hosts the single shared search component…
  assert.ok(
    settings.includes('<PeopleSearch'),
    'the app keeps the single shared people-search component',
  );
  assert.equal(
    settings.split('<PeopleSearch').length - 1,
    1,
    'exactly one PeopleSearch render (no duplicate search implementation)',
  );
  // …mounted only on the dedicated #/new-chat route, never on the Settings
  // overview or any subpage. The overlay renders the route it was opened with
  // and keeps it while it closes (`npm run test:transition`), so the rendered
  // destination can only ever be a route the overlay was actually open at.
  assert.ok(
    settings.includes("const isNewChatRoute = renderedRoute.startsWith('#/new-chat')"),
    'the dedicated people-search screen is detected from the rendered route',
  );
  assert.ok(
    settings.includes(
      "const open = route.startsWith('#/settings') || route.startsWith('#/new-chat');",
    ),
    'the overlay opens exactly for the Settings and New chat hash routes',
  );
  // The overlay renders each top-level destination as its own pane (the
  // New chat ↔ Settings swap, `npm run test:transition`). The search body
  // belongs to the New chat pane alone — the Settings pane never renders it —
  // and that pane only exists while the overlay shows the New chat
  // destination (or, for the duration of a swap, the destination it is
  // leaving, which must keep its own content).
  const searchBody = settings.slice(
    settings.indexOf('const newChatBody'),
    settings.indexOf('const settingsBody'),
  );
  assert.ok(
    searchBody.includes('<PeopleSearch'),
    'the search body belongs to the New chat pane',
  );
  assert.ok(
    settings.includes("{paneState('new-chat') !== null && ("),
    'the search pane exists only for the New chat destination',
  );
  assert.ok(
    !settings
      .slice(settings.indexOf("paneState('settings')"))
      .includes('newChatBody'),
    'the Settings pane never renders the search',
  );
  assert.ok(
    settings.includes('newchat-screen'),
    'the dedicated screen has its own scroll container',
  );
  assert.ok(
    !settings.includes('settings-search-wrap'),
    'the old Settings-overview search wrapper is gone',
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

test('New chat is the only entry point to the people search', () => {
  const bottomNav = read('src/components/BottomNav.tsx');
  const home = read('src/components/Home.tsx');
  assert.ok(
    bottomNav.includes("navigate('#/new-chat')"),
    'the bottom navigation routes New chat to the dedicated #/new-chat screen',
  );
  assert.ok(
    bottomNav.includes('input.focus()'),
    'tapping New chat focuses the search input once the screen has rendered',
  );
  assert.ok(
    home.includes('openNewChat'),
    'the Home empty state reuses the same entry point (no parallel flow)',
  );
  // Deep links land on the ready field as well.
  assert.ok(
    peopleSearch.includes('autoFocus'),
    'the dedicated screen focuses the input on mount (deep links)',
  );
});

test('the Settings overview carries no people-search state or layout machinery', () => {
  // The deferred-unmount helper that once kept the overview search bar
  // mounted during the subpanel slide is obsolete: nothing on the overview
  // can leave the layout mid-slide because the search bar is gone.
  assert.ok(
    !settings.includes('searchCollapse'),
    'no deferred search unmount remains in Settings',
  );
  assert.ok(
    !settings.includes('SUBPANEL_TRANSITION_MS'),
    'no search-specific transition constant remains in Settings',
  );
  // The overview itself is unchanged: grouped categories, footer, subpages.
  assert.ok(
    settings.includes('OVERVIEW_GROUPS'),
    'the grouped category overview remains',
  );
  assert.ok(
    settings.includes('settings-subpanel-nested'),
    'the nested blocked-users subpage remains',
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
