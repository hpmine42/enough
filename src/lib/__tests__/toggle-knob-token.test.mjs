// enough. — v0.5 audit F-08: source guard for the ON knob of `.toggle`.
//
// The bug: the knob of an active switch painted a literal colour instead of
// consuming the design system —
//
//   .toggle.on .toggle-knob {
//     transform: translateX(18px);
//     background: #fbfaf7;
//   }
//
// Every other state of the control already resolved through tokens (`--muted`
// for the resting knob, `--surface-2` / `--accent-strong` for the track), so
// this was the one value that could neither be retuned from the token block
// nor themed with the rest of the app.
//
// The fix follows the repository's existing token pattern (like
// `--badge-text` / `--sent-text` / `--danger-text`): a semantic
// `--toggle-knob-on` token carries the shipped value, declared once in the
// `:root` token block and deliberately NOT overridden by `:root.dark` — the
// knob marks the physical ON position, it is not a themed surface, and both
// themes therefore keep exactly the appearance that shipped. No geometry,
// no interaction, no other state and no other colour was touched.
//
// These are SOURCE-LEVEL guards, per the pattern already used by
// `danger-contrast.test.mjs` (F-02) and `scroll-down-contrast.test.mjs`:
// jsdom applies no stylesheets, so the CSS contract is pinned from the parsed
// stylesheet. The ratios below are computed from the parsed token hex values,
// so a future token refactor that breaks the knob/track pairing fails
// deterministically.
//
// Run with:
//   npm run test:toggle
//   node --test --experimental-strip-types src/lib/__tests__/toggle-knob-token.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const toggleComponent = readFileSync(
  new URL('../../components/Toggle.tsx', import.meta.url),
  'utf8',
);

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

/** Declarations of a rule body as a property -> normalized-value map. */
function declarations(body) {
  if (body === null) return {};
  const out = {};
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const raw of stripped.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
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
const toggle = declarations(ruleBody('.toggle'));
const knob = declarations(ruleBody('.toggle-knob'));
const toggleOn = declarations(ruleBody('.toggle.on'));
const knobOn = declarations(ruleBody('.toggle.on .toggle-knob'));
const toggleDisabled = declarations(ruleBody('.toggle:disabled'));

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
  assert.ok(
    /^#[0-9a-f]{6}$/i.test(hex ?? ''),
    `${context}: ${m[1]} resolves to a hex colour, got: ${hex}`,
  );
  return hex;
}

/* ------------------------------------------------------------------ */
/* 1. The ON state consumes the token instead of a literal              */
/* ------------------------------------------------------------------ */

test('the ON knob is painted from a token, not from a literal', () => {
  assert.equal(
    knobOn.background,
    'var(--toggle-knob-on)',
    'the ON knob resolves through the semantic token',
  );
  for (const [property, value] of Object.entries(knobOn)) {
    assert.ok(
      !/#[0-9a-f]{3,8}\b/i.test(value),
      `${property} carries no hex literal: ${value}`,
    );
    assert.ok(
      !/\b(rgba?|hsla?)\(/i.test(value),
      `${property} carries no colour function: ${value}`,
    );
  }
});

test('the ON knob rule keeps its shipped geometry and nothing else', () => {
  assert.deepEqual(
    Object.keys(knobOn).sort(),
    ['background', 'transform'],
    'the rule still carries exactly the slide and the fill',
  );
  assert.equal(knobOn.transform, 'translateX(18px)', 'the ON position is unchanged');
});

/* ------------------------------------------------------------------ */
/* 2. The token holds the shipped value, in one place, for both themes  */
/* ------------------------------------------------------------------ */

test('the token is declared once, in the token block, with the shipped value', () => {
  assert.equal(light['--toggle-knob-on'], '#fbfaf7', 'the token keeps the shipped colour');
  // The literal may exist in the stylesheet exactly once: as the token
  // definition. Any other occurrence is the hardcode this fix removed.
  const literals = [...bareCss.matchAll(/#fbfaf7/gi)].length;
  assert.equal(literals, 1, 'no #fbfaf7 hardcode survives outside the token block');
});

test('both themes resolve the knob to the same shipped value', () => {
  // Theme-independent by design (see the token comment): dark must inherit
  // the base declaration instead of redefining it, so switching themes can
  // never change the knob.
  assert.ok(
    !('--toggle-knob-on' in dark),
    'the dark palette does not override the knob token',
  );
  const darkPalette = { ...light, ...dark };
  assert.equal(
    resolve(knobOn.background, light, 'light ON knob'),
    resolve(knobOn.background, darkPalette, 'dark ON knob'),
    'the ON knob is identical in light and dark',
  );
});

/* ------------------------------------------------------------------ */
/* 3. The knob stays visibly distinct from its track in both themes     */
/* ------------------------------------------------------------------ */

test('the ON knob stays distinguishable from its track in both themes', () => {
  // WCAG 1.4.11 (non-text contrast) asks for 3:1 at the component boundary;
  // the shipped pairing measures 6.27:1 in light and 3.02:1 in dark. The
  // guard keeps a clear margin (2.5:1) so it fails on a real regression
  // (knob and track collapsing into one another) without failing on
  // sub-perceptual colour rounding — the exact value is pinned above.
  const lightPalette = light;
  const darkPalette = { ...light, ...dark };
  const lightKnob = resolve(knobOn.background, lightPalette, 'light ON knob');
  const darkKnob = resolve(knobOn.background, darkPalette, 'dark ON knob');
  const lightTrack = resolve(toggleOn.background, lightPalette, 'light ON track');
  const darkTrack = resolve(toggleOn.background, darkPalette, 'dark ON track');
  assert.ok(
    contrast(lightKnob, lightTrack) >= 2.5,
    `light ON knob/track contrast ${contrast(lightKnob, lightTrack).toFixed(2)}:1`,
  );
  assert.ok(
    contrast(darkKnob, darkTrack) >= 2.5,
    `dark ON knob/track contrast ${contrast(darkKnob, darkTrack).toFixed(2)}:1`,
  );
});

/* ------------------------------------------------------------------ */
/* 4. off / disabled / focus and the geometry are untouched            */
/* ------------------------------------------------------------------ */

test('the OFF state and the track keep their tokens and geometry', () => {
  assert.deepEqual(
    {
      width: toggle.width,
      height: toggle.height,
      border: toggle.border,
      'border-radius': toggle['border-radius'],
      background: toggle.background,
      padding: toggle.padding,
    },
    {
      width: '46px',
      height: '28px',
      border: '1px solid var(--border-strong)',
      'border-radius': 'var(--radius-pill)',
      background: 'var(--surface-2)',
      padding: '2px',
    },
    'the track geometry and its tokens are unchanged',
  );
  assert.deepEqual(
    {
      width: knob.width,
      height: knob.height,
      'border-radius': knob['border-radius'],
      background: knob.background,
    },
    {
      width: '22px',
      height: '22px',
      'border-radius': '50%',
      background: 'var(--muted)',
    },
    'the resting knob is unchanged and still consumes --muted',
  );
  assert.deepEqual(
    { background: toggleOn.background, 'border-color': toggleOn['border-color'] },
    { background: 'var(--accent-strong)', 'border-color': 'var(--accent-strong)' },
    'the ON track still resolves through --accent-strong',
  );
  // The OFF knob must stay visible on its track in both themes too.
  const darkPalette = { ...light, ...dark };
  for (const palette of [light, darkPalette]) {
    const ratio = contrast(
      resolve(knob.background, palette, 'OFF knob'),
      resolve(toggle.background, palette, 'OFF track'),
    );
    assert.ok(ratio >= 3, `OFF knob/track contrast ${ratio.toFixed(2)}:1`);
  }
});

test('the disabled and focus contracts are unchanged', () => {
  assert.deepEqual(
    toggleDisabled,
    { opacity: '0.55', cursor: 'default' },
    'the disabled state is still the same two declarations',
  );
  // The control adds no colour of its own for disabled: it dims uniformly.
  assert.ok(
    !Object.keys(knobOn).includes('opacity'),
    'the fix adds no disabled handling to the ON knob',
  );
  // Focus stays the global ring (the control carries no outline override).
  assert.match(
    bareCss,
    /\n:focus-visible \{\s*\n\s*outline: 2px solid var\(--muted\);\s*\n\s*outline-offset: 2px;\s*\n\}/,
    'the global focus-visible ring is intact',
  );
  for (const [selector, rule] of [
    ['.toggle', toggle],
    ['.toggle-knob', knob],
    ['.toggle.on', toggleOn],
    ['.toggle.on .toggle-knob', knobOn],
    ['.toggle:disabled', toggleDisabled],
  ]) {
    assert.ok(
      !('outline' in rule) && !('outline-offset' in rule),
      `${selector} does not replace the global focus ring`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 5. The component still drives the state through the same hooks        */
/* ------------------------------------------------------------------ */

test('the component keeps the class hook and the switch semantics', () => {
  assert.ok(
    toggleComponent.includes('className={`toggle${checked ? \' on\' : \'\'}`}'),
    'the ON state is still exposed as the `on` class',
  );
  assert.ok(
    toggleComponent.includes('<span className="toggle-knob" />'),
    'the knob is still the single .toggle-knob element',
  );
  assert.ok(
    toggleComponent.includes('role="switch"') &&
      toggleComponent.includes('aria-checked={checked}'),
    'the switch semantics are unchanged',
  );
  assert.ok(
    toggleComponent.includes('disabled={disabled}'),
    'the disabled prop still reaches the button',
  );
});
