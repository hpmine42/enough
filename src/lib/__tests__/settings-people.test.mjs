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
const { translations } = await import('../../i18n/translations.ts');
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

/* ------------------------------------------------------------------ */
/* v0.5 audit F-06 — the People loading states render no ellipsis       */
/*                                                                      */
/* Both People surfaces rendered `{t('loading')}` — the global          */
/* placeholder string, a bare '…' — as their visible loading state:     */
/* PeopleSearch while the debounced lookup runs, PeopleSettings while  */
/* the active connections load. That contradicts the loading UX the app */
/* established for the chat and the overview (quiet skeleton shapes,    */
/* state carried by a labelled status region, never placeholder text).  */
/* The fix reuses exactly that vocabulary; these guards fail if the     */
/* ellipsis placeholder returns, if a timer sneaks in, or if the        */
/* data/error/empty branches change shape.                              */
/* ------------------------------------------------------------------ */

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
 * JSX (the explaining comments legitimately describe the removed
 * placeholder; a comment never reaches the DOM).
 */
function rendered(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// The loading branch of each People surface, delimited by the branch that
// follows it (the data/error rendering — the branches are exclusive).
const searchLoadJsx = rendered(
  section(peopleSearch, '{searching && (', '{!searching && searchError && ('),
);
const connectionsLoadJsx = rendered(
  section(peopleSettings, '{loading && (', '{!loading && error && ('),
);

test('neither People surface renders the global loading ellipsis', () => {
  for (const [name, jsx] of [
    ['PeopleSearch', searchLoadJsx],
    ['PeopleSettings', connectionsLoadJsx],
  ]) {
    assert.ok(
      !jsx.includes("t('loading')"),
      `${name} no longer renders the global loading string`,
    );
    assert.ok(!jsx.includes('…'), `${name} renders no ellipsis character`);
    assert.ok(!jsx.includes('...'), `${name} renders no three-dot literal`);
    // No JSX text child at all: the state is shapes + an accessible name.
    assert.ok(
      !/>[^<>{}]*[A-Za-z0-9…][^<>{}]*</.test(jsx.replace(/\s+/g, ' ')),
      `${name} renders no text content while loading`,
    );
    // The old visible placeholder paragraph is gone from both components.
    assert.ok(
      !rendered(jsx).includes('className="muted"'),
      `${name} loading branch reuses no muted text paragraph`,
    );
  }
  assert.ok(
    !rendered(peopleSearch).includes("<p className=\"muted\">{t('loading')}</p>"),
    'the PeopleSearch ellipsis paragraph is gone',
  );
  assert.ok(
    !rendered(peopleSettings).includes('{t(\'loading\')}'),
    'PeopleSettings has no loading-string render left at all',
  );
});

test('both People loading states are labelled decorative skeletons', () => {
  for (const [name, jsx, testid] of [
    ['PeopleSearch', searchLoadJsx, 'people-search-loading'],
    ['PeopleSettings', connectionsLoadJsx, 'people-connections-loading'],
  ]) {
    assert.match(jsx, /className="settings-people-skeleton"/, `${name} uses the shared skeleton`);
    assert.match(jsx, /role="status"/, `${name} announces the state semantically`);
    assert.match(
      jsx,
      /aria-label=\{t\('settingsScreen\.(searchLoading|activeConnectionsLoading)'\)\}/,
      `${name} carries a real accessible name`,
    );
    assert.match(jsx, new RegExp(`data-testid="${testid}"`), `${name} keeps its loading testid`);
    assert.match(
      jsx,
      /className="settings-people-skeleton-rows" aria-hidden="true"/,
      `${name} shapes are decorative (the accessible name carries the state)`,
    );
    // The shapes reuse the existing skeleton vocabulary — no new dot or
    // text pattern.
    assert.match(jsx, /className="skeleton-lines"/, `${name} reuses the shared line shapes`);
    assert.ok(
      (jsx.match(/className="skeleton-line w\d+"/g) ?? []).length >= 2,
      `${name} mirrors text lines`,
    );
  }
  // The search results have no avatar; the connection rows do (44px like
  // the loaded Avatar rows).
  assert.ok(!searchLoadJsx.includes('skeleton-avatar'), 'search results mirror avatar-less rows');
  assert.match(
    connectionsLoadJsx,
    /className="settings-people-skeleton-avatar"/,
    'connection rows mirror the loaded avatar',
  );
});

test('the People loading labels are real status names in both languages', () => {
  for (const lang of ['en', 'de']) {
    for (const key of ['searchLoading', 'activeConnectionsLoading']) {
      const value = translations[lang].settingsScreen[key];
      assert.equal(typeof value, 'string', `${lang} exposes settingsScreen.${key}`);
      assert.ok(value.trim().length > 3, `${lang} ${key} is a real label`);
      assert.notEqual(value, '…', `${lang} ${key} is not the bare placeholder`);
      assert.notEqual(value, '...', `${lang} ${key} is not the bare placeholder`);
      // It must also not be the global 'loading' string that caused the bug.
      assert.notEqual(value, translations[lang].loading);
    }
  }
  assert.notEqual(
    translations.en.settingsScreen.searchLoading,
    translations.de.settingsScreen.searchLoading,
    'the German search label is translated, not copied',
  );
  assert.notEqual(
    translations.en.settingsScreen.activeConnectionsLoading,
    translations.de.settingsScreen.activeConnectionsLoading,
    'the German connections label is translated, not copied',
  );
  // The labels are accessible names only — never rendered as text children.
  for (const [name, jsx] of [
    ['PeopleSearch', rendered(peopleSearch)],
    ['PeopleSettings', rendered(peopleSettings)],
  ]) {
    assert.ok(
      !/\{t\('settingsScreen\.(searchLoading|activeConnectionsLoading)'\)\}</.test(jsx),
      `${name} never renders the loading label as visible text`,
    );
  }
});

test('the People skeleton reuses the shared pulse and invents no animation or color', () => {
  const rows = /\n\.settings-people-skeleton-rows \{([^}]*)\}/.exec(css);
  assert.ok(rows, 'the skeleton rows are styled');
  assert.match(rows[1], /animation:\s*skeleton-breathe/, 'reuses the shared skeleton keyframes');
  const skeletonCss = section(
    css,
    '.settings-people-skeleton-rows {',
    '/* settings category overview',
  );
  assert.ok(!skeletonCss.includes('@keyframes'), 'no new keyframes for the People skeleton');
  assert.ok(!/content:\s*['"]/.test(skeletonCss), 'no generated dot/text content');
  assert.ok(
    !/background:\s*var\(--accent|#[0-9a-f]{3,8}/i.test(skeletonCss),
    'the skeleton carries no accent or hardcoded colour',
  );
  const avatar = /\n\.settings-people-skeleton-avatar \{([^}]*)\}/.exec(css);
  assert.ok(avatar, 'the skeleton avatar is styled');
  assert.match(avatar[1], /background:\s*var\(--surface-2\)/, 'neutral skeleton surface');
  assert.match(avatar[1], /width:\s*44px;\s*\n\s*height:\s*44px/, 'mirrors the 44px connection avatar');
  // Reduced-motion handling stays global (v0.2 accessibility contract D1).
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the People loading path adds no artificial timeout or delay', () => {
  assert.ok(!searchLoadJsx.includes('setTimeout'), 'the search loading branch is not time-gated');
  assert.ok(!searchLoadJsx.includes('await new Promise'), 'no delay promise in the search branch');
  assert.ok(!connectionsLoadJsx.includes('setTimeout'), 'the connections loading branch is not time-gated');
  // PeopleSearch keeps having no timer at all; PeopleSettings keeps exactly
  // its one pre-existing 550ms long-press timer — a loading delay would add
  // another.
  assert.equal(
    [...rendered(peopleSearch).matchAll(/setTimeout/g)].length,
    0,
    'PeopleSearch keeps no timer',
  );
  assert.equal(
    [...rendered(peopleSettings).matchAll(/setTimeout/g)].length,
    1,
    'PeopleSettings keeps exactly the long-press timer',
  );
  assert.ok(peopleSettings.includes('550'), 'the remaining timer is the long-press slop');
});

test('the People data, error and empty states are unchanged', () => {
  // PeopleSearch: error alert → empty note → result rows, all gated on
  // !searching exactly as before.
  const search = rendered(peopleSearch);
  assert.match(
    search,
    /\{!searching && searchError && \(\s*<p className="error" role="alert">/,
    'the search error keeps its alert paragraph',
  );
  assert.match(
    search,
    /\{!searching && !searchError && results\.length === 0 && \(/,
    'the search empty state stays gated on a settled lookup',
  );
  assert.ok(search.includes("t('settingsScreen.searchNoResults')"), 'the no-results note stays');
  assert.match(search, /\{!searching &&\s*\n?\s*results\.map/, 'results render once the lookup settles');

  // PeopleSettings: error alert → empty note → connection rows, gated on
  // !loading exactly as before.
  const settings2 = rendered(peopleSettings);
  assert.match(
    settings2,
    /\{!loading && error && \(\s*<p className="error settings-connection-error" role="alert">/,
    'the connections error keeps its alert paragraph',
  );
  assert.match(
    settings2,
    /\{!loading && !error && connections\.length === 0 && \(/,
    'the connections empty state stays gated on a settled load',
  );
  assert.ok(
    settings2.includes("t('settingsScreen.activeConnectionsEmpty')"),
    'the active-connections empty note stays',
  );
  assert.match(
    settings2,
    /\{!loading &&\s*\n?\s*connections\.map/,
    'connections render once the load settles',
  );
});
