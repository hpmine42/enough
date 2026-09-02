// enough. — v0.3 R6: source guard for the scroll-to-bottom button contrast.
//
// The bug: `.scroll-down` paints `background: var(--button)` while the user's
// own bubble paints `background: var(--sent)`, and in the light theme both
// tokens resolve to #292925. The disc therefore has a 1:1 edge against sent
// bubbles, and the only separator — the shared dark drop shadow — composites
// to ~1.09:1 over an already-dark surface, i.e. nothing. Dark mode does not
// need help: the same shadow reaches ~1.51:1 against the light disc.
//
// The fix adds a light-mode-only knockout ring (`0 0 0 2px var(--bg)`) in
// front of the unchanged shadow. This suite pins the invariants that make the
// fix safe:
//   1. the light override really contrasts with the sent bubble token;
//   2. dark mode keeps the base rule verbatim (no dark-scoped override);
//   3. geometry, entrance animation, reduced-motion handling and the
//      `:focus-visible` outline are untouched;
//   4. the ring stays scoped to `.scroll-down` (other `var(--button)`
//      consumers must not inherit it).
//
// These are SOURCE-LEVEL guards, per the pattern already used by
// `accessibility.test.mjs` and `chat-block-channel.test.mjs`. There is no
// color-contrast automation in this repository and jsdom performs no layout,
// so the pixel verdict stays manual QA (see docs/v03-roadmap.md, R6).
//
// Run with:
//   npm run test:contrast
//   node --test --experimental-strip-types src/lib/__tests__/scroll-down-contrast.test.mjs

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
 *  A missing rule yields an empty map so the assertions below report a clean
 *  failure instead of crashing the whole file at import time. */
function declarations(body) {
  if (body === null) return {};
  const out = {};
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    if (!decl || decl.startsWith('/*')) continue;
    const colon = decl.indexOf(':');
    assert.ok(colon > 0, `not a declaration: ${JSON.stringify(decl)}`);
    out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** Stylesheet without comments, so a comment can never read as a selector. */
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector prelude in the stylesheet (crude, guard-level only). */
function selectors() {
  return [...bareCss.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
}

const LIGHT = ':root:not(.dark) .scroll-down';
const lightBody = ruleBody(LIGHT);
const lightDecls = declarations(lightBody);
const baseDecls = declarations(ruleBody('.scroll-down'));
const rootDecls = declarations(ruleBody(':root'));

/* ------------------------------------------------------------------ */
/* 1. The light-mode separation actually separates                      */
/* ------------------------------------------------------------------ */

test('light mode separates the disc from the sent bubble with a contrasting ring', () => {
  assert.ok(lightBody !== null, `${LIGHT} exists`);
  const shadow = lightDecls['box-shadow'];
  assert.ok(shadow, `${LIGHT} declares a box-shadow`);

  // Knockout ring first (painted on top of the drop shadow), then the
  // pre-existing shadow so the elevation stays identical to dark mode.
  const match = shadow.match(
    /^0 0 0 (\d+(?:\.\d+)?)px var\((--[\w-]+)\), 0 2px 10px rgba\(0, 0, 0, 0\.18\)$/,
  );
  assert.ok(match, `ring + original shadow, got: ${shadow}`);

  const [, width, ringToken] = match;
  assert.ok(Number(width) >= 1 && Number(width) <= 2, `ring is 1-2px, got ${width}px`);

  // The ring only works if its token resolves to a different color than the
  // sent bubble it floats over. This is the regression guard the roadmap
  // asks for: if a future token refactor re-collapses the two colors, or the
  // ring is repointed at --sent/--button, this fails.
  assert.notEqual(ringToken, '--sent');
  assert.notEqual(ringToken, '--button');
  assert.ok(rootDecls[ringToken], `${ringToken} is defined in the light palette`);
  assert.notEqual(rootDecls[ringToken], rootDecls['--sent']);
});

test('the light palette still collapses --button onto --sent (documented root cause)', () => {
  assert.equal(rootDecls['--button'], rootDecls['--sent']);
  assert.ok(ruleBody(LIGHT) !== null, 'the light-mode compensation rule exists');
});

/* ------------------------------------------------------------------ */
/* 2. Dark mode is untouched                                            */
/* ------------------------------------------------------------------ */

test('dark mode keeps the base disc shadow and has no override of its own', () => {
  assert.equal(baseDecls['box-shadow'], '0 2px 10px rgba(0, 0, 0, 0.18)');

  const darkOverrides = selectors().filter(
    (s) => /\.scroll-down(?![-\w])/.test(s) && /:root\.dark/.test(s),
  );
  assert.deepEqual(darkOverrides, [], 'no :root.dark .scroll-down rule may exist');

  // Dark mode inherits the base rule; light mode must not drift away from it
  // beyond the ring, so both themes keep the same elevation shadow.
  assert.match(
    lightDecls['box-shadow'] ?? '',
    /, 0 2px 10px rgba\(0, 0, 0, 0\.18\)$/,
    'light mode keeps the original shadow as its second layer',
  );
});

/* ------------------------------------------------------------------ */
/* 3. Geometry, animation, reduced motion and focus stay intact         */
/* ------------------------------------------------------------------ */

test('the fix leaves geometry, animation and focus visibility untouched', () => {
  // The override may only re-paint the shadow: no border/outline (would shift
  // the box or fight the focus ring), no geometry, no animation change.
  assert.deepEqual(Object.keys(lightDecls), ['box-shadow']);

  assert.equal(baseDecls.width, '42px');
  assert.equal(baseDecls.height, '42px');
  assert.equal(baseDecls.right, '18px');
  assert.equal(baseDecls.bottom, 'calc(env(safe-area-inset-bottom) + 100px)');
  assert.equal(baseDecls['border-radius'], '50%');
  assert.equal(baseDecls.background, 'var(--button)');
  assert.equal(baseDecls.animation, 'scroll-down-in 0.2s ease-out');
  assert.match(css, /@keyframes scroll-down-in \{/);
});

test('the keyboard focus indicator still reaches the disc', () => {
  // `.scroll-down` has no own outline, so the global :focus-visible outline is
  // what a keyboard user sees. Adding a resting-state ring must not replace it.
  const focus = declarations(ruleBody(':focus-visible'));
  assert.equal(focus.outline, '2px solid var(--muted)');
  assert.equal(focus['outline-offset'], '2px');
});

test('reduced motion still only suspends animation, not the separation', () => {
  const reducedMotion = css.match(
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/,
  );
  assert.ok(reducedMotion, 'reduced-motion block present');
  assert.doesNotMatch(reducedMotion[0], /box-shadow/);
  assert.doesNotMatch(reducedMotion[0], /scroll-down/);
});

/* ------------------------------------------------------------------ */
/* 4. Scope: no other var(--button) consumer inherits the ring          */
/* ------------------------------------------------------------------ */

test('the ring is scoped to .scroll-down only', () => {
  const scrollDownSelectors = selectors().filter((s) => /\.scroll-down(?![-\w])/.test(s));
  assert.deepEqual(scrollDownSelectors, ['.scroll-down', LIGHT]);

  const ring = '0 0 0 2px var(--bg)';
  const shadowDecls = bareCss.match(/box-shadow:[^;]*;/g) ?? [];
  const withRing = shadowDecls.filter((d) => d.includes(ring));
  assert.equal(withRing.length, 1, 'exactly one rule paints the knockout ring');
});
