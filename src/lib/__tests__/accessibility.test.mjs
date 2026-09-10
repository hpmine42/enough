// enough. — accessibility regression tests (roadmap D1)
//
// Run with:
//   npm run test:a11y
//   node --test --experimental-strip-types src/lib/__tests__/accessibility.test.mjs
//
// This file guards the D1 invariants:
//   * icon-only controls are real buttons with accessible names;
//   * icons stay decorative (aria-hidden) and are never clickable SVGs;
//   * dialogs/sheets expose correct accessible names (role, aria-modal, name);
//   * keyboard navigation stays functional (focus trap contract preserved);
//   * screen-reader output stays coherent (unread badge role, bubble names);
//   * reduced-motion preference is respected by BOTH the CSS block and the
//     JS-driven animations that CSS cannot cover.
//
// The reduced-motion helper and the i18n label are tested behaviorally (real
// function calls against stubbed browser APIs). The remaining invariants are
// source-level assertions: the affected components are not renderable in the
// Node test runner without a full React/E2EE harness. Their behavioral
// counterparts (rendered DOM: button toggles, focus-trap cycling, dialog
// names, badge role) are exercised by the smoke test, which renders the
// production bundle in jsdom (scripts/smoke-test.mjs, D1 section).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* Browser surface stubs (set before module import)                     */
/* ------------------------------------------------------------------ */

let mediaMatches = false;
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  matchMedia: (query) => ({ matches: mediaMatches, media: query }),
};
globalThis.document = { documentElement: { lang: 'en' } };

const { prefersReducedMotion } = await import('../theme.ts');
const { t, setLang } = await import('../../i18n/index.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
function readRel(rel) {
  return readFileSync(join(root, rel), 'utf8');
}
const components = readdirSync(join(root, 'src', 'components')).filter(
  (f) => f.endsWith('.tsx'),
);
const componentSource = Object.fromEntries(
  components.map((f) => [f, readRel(`src/components/${f}`)]),
);

/* ------------------------------------------------------------------ */
/* Reduced-motion helper (behavioral)                                   */
/* ------------------------------------------------------------------ */

test('prefersReducedMotion: follows the OS media query', () => {
  mediaMatches = false;
  assert.equal(prefersReducedMotion(), false, 'no reduce → normal motion');
  mediaMatches = true;
  assert.equal(prefersReducedMotion(), true, 'reduce → reduced motion');
  mediaMatches = false;
});

test('prefersReducedMotion: fails safe without a media query API', () => {
  const originalWindow = globalThis.window;
  try {
    // No window at all.
    delete globalThis.window;
    assert.equal(prefersReducedMotion(), false, 'no window → fail safe');
    // window exists but matchMedia is missing.
    globalThis.window = { localStorage: originalWindow.localStorage };
    assert.equal(prefersReducedMotion(), false, 'no matchMedia → fail safe');
  } finally {
    globalThis.window = originalWindow;
  }
});

/* ------------------------------------------------------------------ */
/* i18n: the info-toggle label exists in both languages (behavioral)    */
/* ------------------------------------------------------------------ */

test('connection.requestInfoLabel resolves in English and German', () => {
  setLang('en');
  const en = t('connection.requestInfoLabel');
  assert.notEqual(en, 'connection.requestInfoLabel', 'EN resolves');
  assert.ok(en.length > 0, 'EN label is non-empty');

  setLang('de');
  const de = t('connection.requestInfoLabel');
  assert.notEqual(de, 'connection.requestInfoLabel', 'DE resolves');
  assert.ok(de.length > 0, 'DE label is non-empty');
  assert.notEqual(en, de, 'EN and DE labels differ');
  setLang('en');
});

/* ------------------------------------------------------------------ */
/* Source invariants                                                    */
/* ------------------------------------------------------------------ */

// Attributes of a JSX opening tag, counting braces so `=>` / ternaries inside
// attribute expressions do not terminate the scan early.
function attrsOf(src, tagStart) {
  let i = tagStart + 1;
  let depth = 0;
  let end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) {
      end = i;
      break;
    }
  }
  return {
    attrs: src.slice(tagStart, end + 1),
    selfClosing: end > 0 && src[end - 1] === '/',
  };
}

test('icons stay decorative: base() keeps aria-hidden', () => {
  assert.ok(
    /function base\([\s\S]*?'aria-hidden': true/.test(componentSource['icons.tsx']),
    'every icon must render aria-hidden by default',
  );
});

test('no icon component is ever used as a clickable SVG', () => {
  for (const [file, src] of Object.entries(componentSource)) {
    for (const m of src.matchAll(/<([A-Za-z]\w*Icon)\b/g)) {
      const { attrs, selfClosing } = attrsOf(src, m.index);
      assert.ok(
        selfClosing,
        `${file}: <${m[1]} must be self-closing`,
      );
      assert.ok(
        !attrs.includes('onClick'),
        `${file}: <${m[1]} must not carry onClick — interactive SVGs are invisible to keyboard and screen readers; use a <button>`,
      );
    }
  }
});

test('every icon-only button has an accessible name', () => {
  for (const [file, src] of Object.entries(componentSource)) {
    for (const m of src.matchAll(/<button\b/g)) {
      const close = src.indexOf('</button>', m.index);
      assert.ok(close > 0, `${file}: unclosed <button>`);
      const block = src.slice(m.index, close);
      if (!block.includes('icon-button')) continue;
      assert.ok(
        /aria-label|title=/.test(block),
        `${file}: icon-button without aria-label/title`,
      );
    }
  }
});

test('settings overview rows are real buttons with names and the subpage back button is accessible', () => {
  const src = componentSource['Settings.tsx'];
  // Every overview row is a real <button> with type="button", carries the
  // category marker used by navigation, and has an accessible name via its
  // text label (never an icon-only affordance).
  const row = src.match(
    /<button\b[\s\S]*?className="settings-row clickable settings-category-row"[\s\S]*?<\/button>/,
  );
  assert.ok(row, 'Settings overview row element exists');
  assert.ok(row[0].includes('type="button"'), 'overview row is a real button');
  assert.ok(
    /data-category=/.test(row[0]),
    'overview row carries its category marker',
  );
  assert.ok(
    /aria-label=/.test(row[0]) || /settings-row-label/.test(row[0]),
    'overview row has an accessible name (text label or aria-label)',
  );
  // The subpage header back button must be keyboard-operable with a
  // localized accessible name so screen-reader users can leave a subpage.
  // It navigates back to the overview (#/settings) or, for the nested Blocked
  // Users subpage, back to People. Match it inside the subpanel block so the
  // regex cannot accidentally land on an overview row (whose template-literal
  // href also contains "#/settings/").
  const subpanel = src.slice(src.indexOf('className={`settings-subpanel'));
  const back = subpanel.match(
    /<button\b[^>]*\bonClick=\{\(\) => navigate\(subpanelBackTarget\)\}[^>]*\baria-label=\{t\('back'\)\}[^>]*>\s*<BackIcon/,
  );
  assert.ok(back, 'subpage back button element exists');
  assert.ok(
    back[0].includes('className="icon-button"'),
    'subpage back button is an icon button',
  );
  assert.ok(
    src.includes("onClick={() => navigate('#/settings/people')}"),
    'nested Blocked Users back button returns to People',
  );
  assert.ok(
    src.includes('aria-hidden={!subpageOpen || blockedSubpageOpen}'),
    'subpage container keeps aria-hidden in sync with visibility',
  );
  assert.ok(
    src.includes('aria-hidden={!blockedSubpageOpen}'),
    'nested subpage container keeps aria-hidden in sync with visibility',
  );
});

test('bottom navigation: named items, and a covered bar leaves the a11y tree', () => {
  const src = componentSource['BottomNav.tsx'];
  // Three real buttons, each with a visible text label (never icon-only), so
  // every destination has an accessible name without an extra aria-label.
  assert.equal(
    src.split('bottom-nav-label').length - 1,
    3,
    'each of the three destinations renders a visible text label',
  );
  assert.ok(
    src.includes("aria-current={active === 'chats' ? 'page' : undefined}"),
    'the active chats destination exposes aria-current',
  );
  assert.ok(
    src.includes("aria-current={active === 'new-chat' ? 'page' : undefined}"),
    'the active new chat destination exposes aria-current',
  );
  assert.ok(
    src.includes("aria-current={active === 'settings' ? 'page' : undefined}"),
    'the active settings destination exposes aria-current',
  );
  // While a Settings subpanel covers the bar it must not stay reachable: a
  // focusable element inside aria-hidden content is an a11y violation.
  assert.ok(
    src.includes('aria-hidden={covered || undefined}'),
    'a covered bar is hidden from assistive technology',
  );
  assert.ok(
    src.includes('const tabIndex = covered ? -1 : undefined;'),
    'a covered bar leaves the tab order',
  );
  assert.ok(
    src.includes('tabIndex={tabIndex}'),
    'every nav item applies that tab index',
  );
  assert.equal(
    src.split('tabIndex={tabIndex}').length - 1,
    3,
    'all three nav items apply it',
  );
  // Localized labels: the bar re-renders on a language change.
  assert.ok(src.includes('useLang()'), 'nav labels follow the language switch');
});

test('bottom navigation: layout-stable on interaction (no movement or scale)', () => {
  // Regression guard for the visible "jump" of the bar on tap. The bar must
  // stay on exactly the same pixel line: the active state is a colour tint
  // only, and the stage behind the Settings / new-chat overlays dims with
  // opacity only.
  const css = readRel('src/index.css');

  // 1) The dimmed stage must never move or scale — a transform there would
  //    shift the nav bar that lives inside it (old: translateX + scale).
  const shifted = css.match(/\.app-stage\.shifted \{([^}]*)\}/);
  assert.ok(shifted, 'index.css declares the shifted app-stage state');
  assert.ok(
    !/transform/.test(shifted[1]),
    'the shifted stage applies no transform (no movement, no scale)',
  );
  assert.ok(
    /opacity/.test(shifted[1]),
    'the shifted stage keeps its opacity-only dim',
  );

  // 2) The active state must not reflow the centered label: a font-weight
  //    change would visibly nudge the item (old: weight 500 -> 600).
  assert.ok(
    !/\.bottom-nav-item\.active[^{]*\{[^}]*font-weight/.test(css),
    'the active item keeps the inactive font weight (no label reflow)',
  );

  // 3) Neither the bar nor its items use transform/scale, and the item
  //    transition only animates layout-stable properties.
  assert.ok(
    !/\.bottom-nav \{[^}]*transform/.test(css),
    'the bar itself uses no transform',
  );
  assert.ok(
    !/\.bottom-nav-item[^{]*\{[^}]*transform/.test(css),
    'nav items use no transform (no translate/scale on tap or active state)',
  );
  const item = css.match(/\.bottom-nav-item \{([^}]*)\}/);
  assert.ok(item, 'index.css declares the nav item rule');
  const transition = item[1].match(/transition:([^;]*);/);
  assert.ok(transition, 'the nav item declares its transition properties');
  assert.ok(
    !/(transform|width|height|font|margin|padding|top|left|right|bottom)/.test(
      transition[1],
    ),
    'the item transition only animates layout-stable properties (color/background)',
  );

  // 4) The sticky in-flow placement is what pins the bar to the same line on
  //    every destination — it must not be replaced by a fixed/absolute box.
  assert.ok(
    /\.bottom-nav \{[^}]*position: sticky;/.test(css),
    'the bar keeps its position: sticky in-flow placement',
  );
});

test('request info toggle is a real button with label + expansion state', () => {
  const src = componentSource['Chat.tsx'];
  const at = src.indexOf('className="request-info-button"');
  assert.ok(at > 0, 'the info toggle renders the request-info-button element');
  // Bound the element: nearest <button start before, first </button> after.
  const start = src.lastIndexOf('<button', at);
  const end = src.indexOf('</button>', at);
  assert.ok(start > 0 && end > at, 'request-info-button element is a <button>');
  const block = src.slice(start, end + '</button>'.length);
  assert.ok(
    block.includes("aria-label={t('connection.requestInfoLabel')}"),
    'info toggle has a localized accessible name',
  );
  assert.ok(
    block.includes('aria-expanded={infoOpen}'),
    'info toggle exposes its expansion state',
  );
});

test('dialogs and sheets keep their accessible-name contract', () => {
  const dialog = componentSource['Dialog.tsx'];
  for (const needle of ['role="dialog"', 'aria-modal="true"', 'aria-label={title}']) {
    assert.ok(dialog.includes(needle), `Dialog.tsx must keep ${needle}`);
  }
  const sheet = componentSource['BottomSheet.tsx'];
  for (const needle of [
    'role="dialog"',
    'aria-modal="true"',
    'aria-label={title ?? cancelLabel}',
  ]) {
    assert.ok(sheet.includes(needle), `BottomSheet.tsx must keep ${needle}`);
  }
});

test('unread badge announces its count (role + label)', () => {
  const src = componentSource['Home.tsx'];
  const m = src.match(/<span className="unread-badge"[^]*?>/);
  assert.ok(m, 'unread badge element exists');
  assert.ok(m[0].includes('role="status"'), 'unread badge must keep role="status"');
  assert.ok(
    m[0].includes('aria-label=') && m[0].includes('unread.unreadCount'),
    'unread badge must keep its aria-label',
  );
});

test('message bubble always has an accessible name', () => {
  const src = componentSource['MessageBubble.tsx'];
  assert.ok(
    src.includes("aria-label={text || t('loading')}"),
    'bubble aria-label must fall back while text is unresolved',
  );
  assert.ok(src.includes("role={focusable ? 'button' : undefined}"), 'bubble keeps its button role');
});

test('focus-trap contract is preserved in Dialog and BottomSheet', () => {
  for (const file of ['Dialog.tsx', 'BottomSheet.tsx']) {
    const src = componentSource[file];
    assert.ok(
      src.includes('useFocusTrap('),
      `${file} must keep the focus trap (keyboard navigation)`,
    );
    assert.ok(
      /e\.key === 'Escape'/.test(src),
      `${file} must keep Escape handling`,
    );
  }
});

test('CSS reduced-motion block stays intact', () => {
  const css = readRel('src/index.css');
  const m = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'prefers-reduced-motion block exists');
  for (const decl of [
    'animation-duration: 0.01ms !important',
    'transition-duration: 0.01ms !important',
    'scroll-behavior: auto !important',
  ]) {
    assert.ok(m[0].includes(decl), `reduced-motion block keeps ${decl}`);
  }
});

test('JS-driven motion is gated on prefersReducedMotion', () => {
  // Chat: the rAF scroll animation must be skipped for reduced-motion users.
  const chat = componentSource['Chat.tsx'];
  const m = chat.match(/const scrollToBottom = useCallback\(\(smooth: boolean\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(m, 'scrollToBottom exists');
  assert.ok(
    m[0].includes('prefersReducedMotion()'),
    'scrollToBottom must check prefersReducedMotion before animating',
  );
  assert.ok(
    m[0].includes('if (!smooth || prefersReducedMotion())'),
    'reduced motion forces an instant scroll',
  );

  // Settings: programmatic smooth scrolling must honor the preference.
  const settings = componentSource['Settings.tsx'];
  assert.ok(
    settings.includes("behavior: prefersReducedMotion() ? 'auto' : 'smooth'"),
    'Settings scrollIntoView must fall back to an instant jump',
  );

  // BottomSheet: the pre-existing close-animation gate must stay.
  const sheet = componentSource['BottomSheet.tsx'];
  assert.ok(
    sheet.includes("'(prefers-reduced-motion: reduce)'"),
    'BottomSheet must keep its reduced-motion close gate',
  );
});

test('prefersReducedMotion is exported from lib/theme', () => {
  const src = readRel('src/lib/theme.ts');
  assert.ok(
    /export function prefersReducedMotion\(\): boolean/.test(src),
    'the shared reduced-motion helper lives in lib/theme.ts',
  );
});
