// enough. — bottom navigation architecture regression tests
//
// Run with:
//   npm run test:nav
//   node --test src/lib/__tests__/bottom-nav.test.mjs
//
// WHAT THIS GUARDS
//   The bottom navigation is a persistent top-level layer. It must never be
//   a child of an element that animates — the app stage (which dims) or the
//   Settings overlay (which slides in with a transform) — because a child
//   would inherit that motion and visibly move, translate, scale or fade
//   with it.
//
//   Regression history: the bar used to be rendered inside `Home` (which
//   carries the `screen-in` translateY animation) and inside the Settings
//   overlay (which carries a `translateX` transition), so it moved on every
//   screen change and every overlay open.
//
//   These are source-level assertions: the components are not renderable in
//   the Node test runner without a full React/E2EE harness. Their behavioral
//   counterparts run in the smoke test (scripts/smoke-test.mjs), which
//   renders the production bundle in jsdom and asserts the rendered DOM
//   hierarchy (the bar is a sibling of `.app-stage`, not a descendant).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const app = read('src/App.tsx');
const home = read('src/components/Home.tsx');
const settings = read('src/components/Settings.tsx');
const nav = read('src/components/BottomNav.tsx');
const css = read('src/index.css');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Index of the `</div>` that closes the `<div ...>` starting at `openIdx`.
 * Counts JSX `<div` / `</div>` tokens, so nested divs are handled.
 */
function closingDivIndex(src, openIdx) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = openIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[0] === '</div>') {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

/**
 * Flat rule list of the stylesheet: comments removed, then every
 * `selector { body }` pair without nested braces (rules inside `@media` are
 * picked up as well).
 */
const allRules = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((m) => ({ selector: m[1].trim(), body: m[2] }));

/** Body of the first rule declared for exactly this selector. */
function ruleBody(selector) {
  const found = allRules.find((rule) => rule.selector === selector);
  return found ? found.body : null;
}

/** Every rule whose selector mentions `.bottom-nav`. */
function navRules() {
  return allRules.filter((rule) => rule.selector.includes('.bottom-nav'));
}

const GEOMETRY = [
  'transform',
  'translate',
  'scale',
  'animation',
  'font-weight',
  'font-size',
  'width:',
  'height:',
  'margin',
  'padding',
  'top:',
  'left:',
  'right:',
  'bottom:',
  'letter-spacing',
  'line-height',
  'border-width',
];

/* ------------------------------------------------------------------ */
/* 1. hierarchy: the bar is a sibling of the animated layers            */
/* ------------------------------------------------------------------ */

test('App renders the bottom navigation outside the app stage', () => {
  const stageOpen = app.indexOf('<div className={`app-stage');
  assert.ok(stageOpen > 0, 'App.tsx renders the app-stage element');
  const stageClose = closingDivIndex(app, stageOpen);
  assert.ok(stageClose > stageOpen, 'the app-stage element is closed');

  const stageBody = app.slice(stageOpen, stageClose);
  assert.ok(
    !stageBody.includes('BottomNav'),
    'the app stage (which dims behind overlays) must not contain the bar',
  );

  const navIndex = app.indexOf('<BottomNav');
  assert.ok(navIndex > 0, 'App.tsx renders the bottom navigation');
  assert.ok(
    navIndex > stageClose,
    'the bar is a sibling rendered AFTER the app stage closes',
  );
});

test('the bar is rendered after the Settings overlay, never inside it', () => {
  const navIndex = app.indexOf('<BottomNav');
  const settingsIndex = app.indexOf('<Settings');
  assert.ok(settingsIndex > 0, 'App.tsx renders the Settings overlay');
  assert.ok(
    navIndex > settingsIndex,
    'the bar is a sibling rendered after the Settings overlay (not a child: ' +
      'a child would inherit the overlay slide-in transform)',
  );
});

test('neither Home nor Settings renders the bar', () => {
  // Home carries the `screen-in` translateY animation and Settings carries
  // the overlay slide: rendering the bar inside either one moves it.
  assert.ok(
    !/<BottomNav\b/.test(home),
    'Home must not render the bar (it would inherit the screen-in slide)',
  );
  assert.ok(
    !/<BottomNav\b/.test(settings),
    'Settings must not render the bar (it would inherit the overlay slide)',
  );
  // Home still reuses the single "New chat" entry point from the bar module.
  assert.ok(
    home.includes("import { openNewChat } from './BottomNav';"),
    'Home keeps reusing the shared openNewChat entry point',
  );
});

test('the covered state is derived from the route, not from overlay internals', () => {
  // The bar lives outside the overlay but still has to know when a Settings
  // subpage covers it. The route parser is exported for exactly that.
  assert.ok(
    /export function settingsCategoryFromRoute\(/.test(settings),
    'Settings exports its route → category parser for the top-level bar',
  );
  assert.ok(
    app.includes('settingsCategoryFromRoute'),
    'App imports that parser instead of duplicating route logic',
  );
  assert.ok(
    app.includes('const navCovered = settingsCategoryFromRoute(route) !== null;'),
    'the bar is covered exactly while a Settings subpage is open',
  );
});

/* ------------------------------------------------------------------ */
/* 2. CSS: fixed layer, correct stacking, no motion                    */
/* ------------------------------------------------------------------ */

test('the bar is a fixed viewport layer above the animated content', () => {
  const body = ruleBody('.bottom-nav');
  assert.ok(body, 'index.css declares the .bottom-nav rule');
  assert.ok(
    /position:\s*fixed;/.test(body),
    'the bar is pinned to the viewport (position: fixed)',
  );
  assert.ok(
    !/position:\s*(sticky|absolute|relative)/.test(body),
    'the bar is not in flow, so no screen can push it around',
  );
  assert.ok(/z-index:\s*\d+/.test(body), 'the bar declares its stacking order');
  assert.ok(
    /env\(safe-area-inset-bottom\)/.test(body),
    'the bar respects env(safe-area-inset-bottom)',
  );
  // No transform anywhere in the rule: not even a centering translate, so
  // nothing can accidentally animate it later.
  assert.ok(!/transform|translate/.test(body), 'the bar carries no transform');
});

test('the bar stacks above the app stage and the overlay, below dialogs', () => {
  const z = (selector) => {
    const body = ruleBody(selector);
    assert.ok(body, `index.css declares ${selector}`);
    const m = body.match(/z-index:\s*(\d+)/);
    assert.ok(m, `${selector} declares a z-index`);
    return Number(m[1]);
  };
  const navZ = z('.bottom-nav');
  const overlayZ = z('.settings-overlay');
  const sheetZ = z('.sheet-backdrop');
  const dialogZ = z('.dialog-backdrop');
  assert.ok(
    navZ > overlayZ,
    'the bar sits above the Settings overlay, so content cannot pass over it',
  );
  assert.ok(
    navZ < sheetZ && navZ < dialogZ,
    'modal sheets and dialogs still cover the bar',
  );
});

test('no rule targets the bar as a descendant of an animated layer', () => {
  for (const { selector } of navRules()) {
    assert.ok(
      !/\.app-stage|\.home-screen|\.chat-screen|\.settings-overlay|\.settings-subpanel|\.settings-scroll/.test(
        selector,
      ),
      `the bar must not be selected inside an animated layer: "${selector}"`,
    );
  }
});

test('no bottom-nav rule animates geometry', () => {
  const rules = navRules();
  assert.ok(rules.length >= 4, 'the bar, its items and its label are styled');
  for (const { selector, body } of rules) {
    assert.ok(
      !/animation\s*:/.test(body),
      `"${selector}" must not declare an animation`,
    );
    assert.ok(
      !/(^|[^-])transform\s*:/.test(body),
      `"${selector}" must not use transform (no translate/scale on the bar)`,
    );
    // A transition may only animate colour/opacity — never geometry.
    const transition = body.match(/transition:([^;]*);/);
    if (transition) {
      assert.ok(
        !/(transform|width|height|font|margin|padding|top|left|right|bottom)/.test(
          transition[1],
        ),
        `"${selector}" only transitions layout-stable properties`,
      );
    }
  }
});

test('the active state is colour-only (no reflow, no movement)', () => {
  const body = ruleBody('.bottom-nav-item.active');
  assert.ok(body, 'index.css declares the active nav item');
  for (const property of GEOMETRY) {
    assert.ok(
      !body.includes(property),
      `the active item must not change "${property}" — it would move or reflow the bar`,
    );
  }
  assert.ok(
    /color|background/.test(body),
    'the active state stays visible through colour, not geometry',
  );
});

test('the label keeps one font weight and never grows the bar', () => {
  const body = ruleBody('.bottom-nav-label');
  assert.ok(body, 'index.css declares the nav label');
  assert.ok(/font-weight:\s*\d+/.test(body), 'the label declares one font weight');
  assert.equal(
    body.match(/font-weight:/g).length,
    1,
    'exactly one font weight — the active state must not switch weights',
  );
  assert.ok(
    /white-space:\s*nowrap/.test(body) && /text-overflow:\s*ellipsis/.test(body),
    'a long localized label is clipped instead of wrapping the bar taller',
  );
  // The active state must not touch the label either.
  assert.ok(
    !/\.bottom-nav-item\.active\s+\.bottom-nav-label|\.active\s+\.bottom-nav-label/.test(
      css,
    ),
    'no active-state rule restyles the label',
  );
});

/* ------------------------------------------------------------------ */
/* 3. the animated layers stay animation-only for themselves           */
/* ------------------------------------------------------------------ */

test('the app stage still dims with opacity only', () => {
  const body = ruleBody('.app-stage');
  assert.ok(body, 'index.css declares .app-stage');
  assert.ok(!/transform/.test(body), 'the stage applies no transform');
  const shifted = ruleBody('.app-stage.shifted');
  assert.ok(shifted, 'index.css declares the shifted stage');
  assert.ok(!/transform/.test(shifted), 'the dimmed stage never moves or scales');
  assert.ok(/opacity/.test(shifted), 'the shifted stage keeps its opacity-only dim');
});

/* ------------------------------------------------------------------ */
/* 4. the reserved space: the fixed bar must not cover content         */
/* ------------------------------------------------------------------ */

test('screens the bar floats over reserve its height', () => {
  const homeScreen = ruleBody('.home-screen');
  assert.ok(homeScreen, 'index.css declares .home-screen');
  assert.ok(
    /padding:[^;]*var\(--nav-clearance\)/.test(homeScreen),
    'the chat overview reserves the bar\'s space at the bottom',
  );

  const scroll = ruleBody('.settings-scroll');
  assert.ok(scroll, 'index.css declares .settings-scroll');
  assert.ok(
    /padding-bottom:\s*var\(--nav-clearance\)/.test(scroll),
    'the Settings / New chat destinations reserve the bar\'s space',
  );

  const newChat = ruleBody('.newchat-screen');
  assert.ok(newChat, 'index.css declares .newchat-screen');
  assert.ok(
    /padding-bottom:\s*var\(--nav-clearance\)/.test(newChat),
    'the dedicated people-search screen reserves the bar\'s space',
  );

  // The clearance is derived from the bar, not hard-coded, so the bar can
  // never grow past the space its screens reserve for it.
  const clearance = css.match(/--nav-clearance:\s*calc\(([^;]*)\);/);
  assert.ok(clearance, 'index.css derives --nav-clearance');
  assert.ok(
    clearance[1].includes('--nav-height') &&
      clearance[1].includes('env(safe-area-inset-bottom)'),
    '--nav-clearance follows the bar height and the safe-area inset',
  );
});

/* ------------------------------------------------------------------ */
/* 5. routing and destinations stay unchanged                          */
/* ------------------------------------------------------------------ */

test('the three destinations keep their routes and semantics', () => {
  assert.ok(nav.includes("navigate('#/')"), 'Chats keeps the chat overview route');
  assert.ok(
    nav.includes("navigate('#/new-chat')"),
    'New chat keeps the dedicated #/new-chat route',
  );
  assert.ok(
    nav.includes("navigate('#/settings')"),
    'Settings keeps the #/settings route',
  );
  for (const destination of ['chats', 'new-chat', 'settings']) {
    assert.ok(
      nav.includes(`data-nav="${destination}"`),
      `the ${destination} destination keeps its data-nav hook`,
    );
    assert.ok(
      nav.includes(`aria-current={active === '${destination}' ? 'page' : undefined}`),
      `the ${destination} destination keeps aria-current`,
    );
  }
});

test('a covered bar still leaves the accessibility tree and the tab order', () => {
  assert.ok(
    nav.includes('aria-hidden={covered || undefined}'),
    'a covered bar is hidden from assistive technology',
  );
  assert.ok(
    nav.includes('const tabIndex = covered ? -1 : undefined;'),
    'a covered bar leaves the tab order',
  );
  assert.equal(
    nav.split('tabIndex={tabIndex}').length - 1,
    3,
    'all three nav items apply it',
  );
});
