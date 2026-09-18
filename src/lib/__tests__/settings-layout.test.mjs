// enough. — v0.5 audit F-03 / F-04 / F-05: source guards for the Settings
// chrome box model (header safe area, subpanel bottom inset, desktop column
// alignment).
//
//   F-03: `.settings-header` used a fixed `height: 56px` together with
//     `padding-top: calc(env(safe-area-inset-top) + 2px)` under the global
//     border-box model, so on devices with a top inset the padding ate the
//     box and the 40px back/theme controls and the title were squeezed out
//     of it. The fix uses the `.legal-header` model: `min-height` includes
//     the inset additively, so the pre-inset geometry (56px box, 53px
//     content line) is preserved where there is no inset and grows where
//     there is one.
//   F-04: `.settings-subpanel .settings-scroll` ended in a flat 32px bottom
//     padding, so on devices with a home indicator the last rows of a
//     subpage (including Account → Delete account) could slide under the
//     system gesture area. The bottom inset is now added to the same 32px.
//   F-05: at the desktop breakpoint the header got `max-width: 480px` +
//     `width: 100%` but no auto margins, so as a flex item of the
//     full-width pane/subpanel it stayed left-aligned while the scroll body
//     centered itself on the same column. The header now centers identically.
//
// These are SOURCE-LEVEL guards, per the pattern already used by
// `scroll-down-contrast.test.mjs` and `bottom-nav.test.mjs`. jsdom performs
// no layout; the guards pin the box model that produces the behaviour.
//
// Run with:
//   npm run test:settingslayout
//   node --test --experimental-strip-types src/lib/__tests__/settings-layout.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

/* ------------------------------------------------------------------ */
/* Minimal stylesheet helpers (brace-matched, no external CSS parser)    */
/* ------------------------------------------------------------------ */

/** Body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector) {
  const needle = `\n${selector} {`;
  const at = css.indexOf(needle);
  if (at === -1) return null;
  let depth = 1;
  let i = at + needle.length;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return depth === 0 ? css.slice(start, i - 1) : null;
}

/** Declarations of a rule body as a property -> normalized-value map.
 *  Comments are stripped first: an explanatory comment documents the box
 *  model and may legally contain ':' / ';' characters. */
function declarations(body) {
  if (body === null) return {};
  const out = {};
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const raw of stripped.split(';')) {
    const decl = raw.trim();
    if (!decl || decl.startsWith('/*')) continue;
    const colon = decl.indexOf(':');
    assert.ok(colon > 0, `not a declaration: ${JSON.stringify(decl)}`);
    out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** Body of a `@media (...)` block, brace-matched. */
function atRuleBody(prelude) {
  const at = css.indexOf(prelude);
  assert.notEqual(at, -1, `${prelude} exists`);
  const open = css.indexOf('{', at);
  let depth = 1;
  let i = open + 1;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(start, i - 1);
}

const universal = declarations(ruleBody('*'));
const header = declarations(ruleBody('.settings-header'));
const scroll = declarations(ruleBody('.settings-scroll'));
const subpanelScroll = declarations(ruleBody('.settings-subpanel .settings-scroll'));
const subpanel = declarations(ruleBody('.settings-subpanel'));
const desktop = atRuleBody('@media (min-width: 760px)');

/* ------------------------------------------------------------------ */
/* F-03: the header keeps its 56px line THROUGH any top safe area       */
/* ------------------------------------------------------------------ */

test('the global box model is border-box (the premise of the fix)', () => {
  assert.equal(universal['box-sizing'], 'border-box');
});

test('the settings header uses a safe-area-aware min-height, not a fixed height', () => {
  // The box must include the inset: with border-box, a fixed 56px height
  // minus a large padding-top left no room for the 40px controls.
  assert.equal(
    header['min-height'],
    'calc(env(safe-area-inset-top) + 56px)',
    'min-height = top inset + the pre-inset 56px box',
  );
  assert.ok(!('height' in header), 'no fixed height remains on the settings header');
});

test('the header keeps its insets, alignment and chrome of the pre-fix geometry', () => {
  // Same visual line as before on devices without a notch: 56px box,
  // 2px top padding, 1px hairline → the same 53px content line.
  assert.equal(header.padding, 'calc(env(safe-area-inset-top) + 2px) 14px 0');
  assert.equal(header['flex-shrink'], '0', 'the header never collapses in the column layout');
  assert.equal(header.display, 'flex');
  assert.equal(header['align-items'], 'center');
  assert.equal(header['justify-content'], 'space-between');
  assert.equal(header['border-bottom'], '1px solid var(--border)');
});

test('the header pattern follows the already-proven legal-header safe-area model', () => {
  // `.legal-header` has shipped with exactly this model since v0.4: a
  // min-height that includes the inset plus the padding that carries it.
  const legal = declarations(ruleBody('.legal-header'));
  assert.match(legal['min-height'] ?? '', /^calc\(env\(safe-area-inset-top\) \+ \d+px\)$/);
  assert.match(legal.padding ?? '', /^env\(safe-area-inset-top\) /);
});

test('no settings pane or panel compensates for the old fixed header height', () => {
  // The header lives in normal flex flow; a leftover fixed-height
  // compensation (negative margins, absolute offsets) would double-shift
  // the scroll body now that the header can grow.
  for (const selector of ['.settings-pane', '.settings-overlay', '.settings-subpanel']) {
    const body = ruleBody(selector) ?? '';
    assert.ok(!/margin-top|top:/.test(body), `${selector} carries no header-height compensation`);
  }
});

/* ------------------------------------------------------------------ */
/* F-04: subpanel content stays above the bottom safe area              */
/* ------------------------------------------------------------------ */

test('the settings subpanel scroll body adds the bottom inset to its end spacing', () => {
  assert.equal(
    subpanelScroll.padding,
    '8px 22px calc(32px + env(safe-area-inset-bottom))',
    'same top/inline spacing, 32px + inset at the bottom',
  );
});

test('the safe-area chain is single: the subpanel itself carries no bottom padding', () => {
  assert.ok(!('padding-bottom' in subpanel) && !('padding' in subpanel),
    'the panel adds no second safe-area padding below the scroll body');
  assert.ok(!/env\(safe-area-inset-bottom\)/.test(ruleBody('.settings-subpanel') ?? ''),
    'the panel does not add its own bottom inset');
});

test('the overview and the bottom navigation clearance are untouched', () => {
  // The overview keeps reserving the floating bar's clearance (already
  // inset-aware via --nav-clearance); only subpanels changed.
  assert.equal(scroll['padding-bottom'], 'var(--nav-clearance)');
  const root = declarations(ruleBody(':root'));
  assert.match(
    root['--nav-clearance'] ?? '',
    /env\(safe-area-inset-bottom\)/,
    'the nav clearance keeps its bottom inset',
  );
});

test('the nested blocked-users subpanel inherits the same bottom inset', () => {
  // `.settings-subpanel-nested` stacks the SAME `.settings-subpanel .settings-scroll`
  // structure one level higher; it must not re-declare padding.
  const nested = ruleBody('.settings-subpanel-nested');
  assert.ok(nested !== null, 'the nested subpanel layer exists');
  assert.ok(!/padding/.test(nested), 'the nested layer adds no padding of its own');
});

/* ------------------------------------------------------------------ */
/* F-05: header and content share one centered column on desktop        */
/* ------------------------------------------------------------------ */

test('the desktop header centers on the same 480px column as the scroll body', () => {
  // Column width unchanged (both rules stay max-width: 480px)…
  assert.match(desktop, /\.settings-header,\s*\n?\s*\.settings-scroll\s*\{\s*max-width: 480px;?\s*\}/);
  // …and the header now centers itself exactly like the content does.
  const headerRule = /\.settings-header\s*\{([^}]*)\}/.exec(desktop);
  assert.ok(headerRule, 'the desktop breakpoint declares a .settings-header rule');
  assert.match(headerRule[1], /width:\s*100%/);
  assert.match(
    headerRule[1],
    /margin:\s*0 auto|margin-inline:\s*auto/,
    'the desktop header uses auto inline margins (centering)',
  );
});

test('the scroll body was and is the centering reference', () => {
  assert.equal(scroll.margin, '0 auto', 'base rule: the content column centers itself');
  assert.equal(scroll['max-width'], '480px', 'base rule: the content column width');
});

test('mobile presentation is unchanged by the alignment fix', () => {
  // The base header (outside the media query) keeps full-bleed behaviour:
  // no width, no margins — nothing the 0-auto margins could alter below
  // 760px, where auto margins resolve against no free space anyway.
  assert.ok(!('width' in header), 'the base header declares no width');
  assert.ok(!('margin' in header), 'the base header declares no margin');
  // The 760px column rules still exclude everything but header + scroll.
  const columnRules = desktop.match(/\.settings-header,|\.settings-scroll|\.settings-overlay/g) ?? [];
  assert.deepEqual(
    [...new Set(columnRules)].sort(),
    ['.settings-header,', '.settings-overlay', '.settings-scroll'],
    'the desktop settings rules still only cover overlay, header and scroll',
  );
});
