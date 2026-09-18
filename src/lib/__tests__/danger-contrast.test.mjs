// enough. — v0.5 audit F-02: source guard for the dark-mode danger contrast.
//
// The bug: `.btn-primary.danger` (the destructive dialog confirm) and
// `.scroll-down-count` (the unread counter on the scroll-down disc) painted
// their label in hardcoded `#fff` on `background: var(--danger)`. In the
// light theme --danger is #a44a35 (white on it: 5.82:1, WCAG AA pass). In
// the dark theme --danger is the warm light salmon #d9907e: white read at
// 2.55:1 — and because the shared `.btn-primary:hover` rule repaints every
// primary button to --button-press (a near-white in dark mode), the hover
// label disappeared almost entirely at ~1.15:1.
//
// The fix follows the repository's existing token pattern instead of
// hardcoded literals or a recolor: a semantic `--danger-text` token is
// paired with `--danger` in both palettes, exactly like `--button-text` /
// `--sent-text` / `--badge-text` are paired with their surfaces. Light keeps
// the white that always shipped (#ffffff, 5.82:1 — AA); dark resolves to
// the same dark warm ink every other dark-theme chip label uses (#171614,
// 7.10:1 on the salmon, 15.7:1 on the --button-press hover surface). The
// danger surface colour itself, its semantics (--danger-soft tints, danger
// text/border usages which pass on both backgrounds) and all geometry are
// untouched.
//
// These are SOURCE-LEVEL guards, per the pattern already used by
// `scroll-down-contrast.test.mjs` (R6). There is no rendered-contrast
// automation in this repository and jsdom performs no layout; the numeric
// WCAG ratios below are computed from the parsed token hex values, so a
// future token refactor that breaks the pairing fails deterministically.
//
// Run with:
//   npm run test:danger
//   node --test --experimental-strip-types src/lib/__tests__/danger-contrast.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

/* ------------------------------------------------------------------ */
/* Minimal stylesheet helpers (same brace-matched approach as the R6   */
/* scroll-down guard — no external CSS parser)                          */
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
 *  Comments are stripped first: an explanatory comment documents colours
 *  and ratios and may legally contain ':' / ';' characters. */
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

/** Stylesheet without comments, so a comment can never read as a rule. */
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

const light = declarations(ruleBody(':root'));
const dark = declarations(ruleBody(':root.dark'));
const dangerButton = declarations(ruleBody('.btn-primary.danger'));
const scrollDownCount = declarations(ruleBody('.scroll-down-count'));
const primaryHover = declarations(ruleBody('.btn-primary:hover:not(:disabled)'));

/* ------------------------------------------------------------------ */
/* WCAG 2.x relative luminance + contrast ratio                         */
/* ------------------------------------------------------------------ */

function luminance(hex) {
  const c = hex.replace('#', '');
  assert.equal(c.length, 6, `expected #rrggbb, got ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Resolve a `var(--token)` declaration value against a palette map. */
function resolve(value, palette, context) {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? '');
  assert.ok(m, `${context} must be a single token reference, got: ${value}`);
  const hex = palette[m[1]];
  assert.ok(/^#[0-9a-f]{6}$/i.test(hex ?? ''), `${context}: ${m[1]} resolves to a hex colour, got: ${hex}`);
  return hex;
}

/* ------------------------------------------------------------------ */
/* 1. The pairing: every label-on-danger combination meets WCAG AA      */
/* ------------------------------------------------------------------ */

// AA for normal-size text. The scroll-down counter is 11px/600 and the
// dialog confirm is 15px/550, so the 4.5:1 bar applies to both (not the
// 3:1 large-text bar). Hover is included: the shared primary hover repaints
// the surface to --button-press, and the label token must hold up on it.
for (const [theme, palette] of [['light', light], ['dark', dark]]) {
  test(`${theme}: the danger label token meets WCAG AA on every surface it appears on`, () => {
    const label = resolve('var(--danger-text)', palette, `${theme} --danger-text`);
    const danger = palette['--danger'];
    const press = palette['--button-press'];

    const onDanger = contrast(label, danger);
    const onHover = contrast(label, press);
    console.log(
      `  ${theme}: ${label} on --danger ${danger} = ${onDanger.toFixed(2)}:1; ` +
        `on --button-press ${press} (hover) = ${onHover.toFixed(2)}:1`,
    );

    assert.ok(
      onDanger >= 4.5,
      `${theme}: label on --danger must be >= 4.5:1 (AA), got ${onDanger.toFixed(2)}:1`,
    );
    assert.ok(
      onHover >= 4.5,
      `${theme}: label on the --button-press hover surface must be >= 4.5:1 (AA), got ${onHover.toFixed(2)}:1`,
    );
  });
}

test('dark mode specifically fixes the audited failing combination', () => {
  // The exact regression the audit measured: hardcoded white on the dark
  // --danger salmon was ~2.6:1. Pin both halves: the old pairing stays
  // provably broken (documentation of the root cause) and the shipped
  // pairing clears AA with the same margin the theme's other chips have.
  assert.ok(
    contrast('#ffffff', dark['--danger']) < 3,
    'the pre-fix combination (white on the dark salmon) is the documented failure',
  );
  assert.ok(
    contrast(resolve('var(--danger-text)', dark, 'dark --danger-text'), dark['--danger']) >= 7,
    'dark --danger-text on --danger matches the AAA margin of the other dark-theme chips',
  );
});

/* ------------------------------------------------------------------ */
/* 2. Both consumers use the token — no hardcoded label colour remains  */
/* ------------------------------------------------------------------ */

test('both text-on-danger consumers paint the paired label token', () => {
  assert.equal(dangerButton.background, 'var(--danger)');
  assert.equal(dangerButton.color, 'var(--danger-text)');
  assert.equal(scrollDownCount.background, 'var(--danger)');
  assert.equal(scrollDownCount.color, 'var(--danger-text)');
});

test('no rule paints text on a danger surface without the token', () => {
  // `background: var(--danger)` must only ever appear together with the
  // paired label — a third consumer hardcoding a colour would not be
  // covered by the contrast guards above.
  const dangerBackgrounds = bareCss.match(/background:\s*var\(--danger\)\s*;/g) ?? [];
  assert.equal(dangerBackgrounds.length, 2, 'exactly two rules paint a --danger surface');
  assert.ok(!/#fff([^0-9a-f]|$)/i.test(
    [ruleBody('.btn-primary.danger'), ruleBody('.scroll-down-count')].join('\n'),
  ), 'no hardcoded white remains on a danger surface');
});

test('the token mirrors the chip-label pairing of both themes', () => {
  // Light keeps the exact white that always shipped (AA on #a44a35).
  assert.equal(light['--danger-text'], '#ffffff');
  // Dark uses the same warm ink as --button-text / --sent-text / --badge-text.
  assert.equal(dark['--danger-text'], dark['--button-text']);
  assert.equal(dark['--danger-text'], dark['--sent-text']);
  assert.equal(dark['--danger-text'], dark['--badge-text']);
});

/* ------------------------------------------------------------------ */
/* 3. Scope: the danger surface, hover mechanics and focus are untouched */
/* ------------------------------------------------------------------ */

test('the danger surface colour and its soft tint are unchanged in both themes', () => {
  // The fix changes the label, never the semantically warm danger surface —
  // every other --danger consumer (text, borders, soft tints) passes on its
  // background and must not be dragged along.
  assert.equal(light['--danger'], '#a44a35');
  assert.equal(light['--danger-soft'], 'rgba(164, 74, 53, 0.1)');
  assert.equal(dark['--danger'], '#d9907e');
  assert.equal(dark['--danger-soft'], 'rgba(217, 144, 126, 0.14)');
});

test('the shared primary hover mechanics are unchanged', () => {
  // The hover still repaints every primary button to --button-press; only
  // the previously invisible label is now readable on it (asserted above).
  assert.equal(primaryHover.background, 'var(--button-press)');
  assert.ok(
    !('color' in primaryHover),
    'the hover keeps inheriting the label colour (no per-hover text restyle)',
  );
  // The danger variant declares no hover override of its own: its resting
  // label already contrasts with the hover surface in both themes.
  const dangerHover = ruleBody('.btn-primary.danger:hover:not(:disabled)');
  assert.equal(dangerHover, null, 'no danger-specific hover rule is needed');
});

test('the keyboard focus indicator is not touched by the fix', () => {
  const focus = declarations(ruleBody(':focus-visible'));
  assert.equal(focus.outline, '2px solid var(--muted)');
  assert.equal(focus['outline-offset'], '2px');
});

test('danger geometry and danger text usages elsewhere are unchanged', () => {
  // The counter keeps its pill geometry (no layout change, per the audit).
  assert.equal(scrollDownCount['min-width'], '19px');
  assert.equal(scrollDownCount.height, '19px');
  assert.equal(scrollDownCount['font-size'], '11px');
  assert.equal(scrollDownCount['border-radius'], '10px');
  // Danger as TEXT (not as a surface) keeps passing on the canvas: it is
  // why the dark --danger is light in the first place — dimming the surface
  // token globally would have broken these consumers.
  assert.ok(contrast(light['--danger'], light['--bg']) >= 4.5, 'light danger text on the canvas passes');
  assert.ok(contrast(dark['--danger'], dark['--bg']) >= 4.5, 'dark danger text on the canvas passes');
});
