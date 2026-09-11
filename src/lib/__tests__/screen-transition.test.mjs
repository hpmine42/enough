// enough. — bidirectional screen-transition regression tests
//
// Run with:
//   npm run test:transition
//   node --test src/lib/__tests__/screen-transition.test.mjs
//
// WHAT THIS GUARDS
//   The Chats ↔ New chat transition (`#/` ↔ `#/new-chat`) is ONE animation
//   that is played in both directions. Entering the dedicated people-search
//   screen is the Settings overlay's entrance: the overlay goes from
//   `transform: translateX(56px)` + `opacity: 0` (hidden) to
//   `transform: translateX(0)` + `opacity: 1` over `transform 0.3s var(--ease)`
//   and `opacity 0.3s ease`, while the chat overview behind it dims to 45%
//   opacity. Leaving the screen must be exactly that animation in reverse:
//   same properties, same duration, same easing, same distance, in the
//   opposite direction — no additional fade, bounce, scale or movement.
//
//   Regression history: the overlay used to swap its rendered destination in
//   the very frame the route changed, i.e. at the START of the exit. The
//   departing surface therefore showed the Settings overview instead of the
//   "New chat" screen it was supposed to slide back out, so returning to the
//   chats did not look like the entrance played backwards. The overlay now
//   keeps the destination it is closing for the whole exit animation, and the
//   next destination is rendered in the same commit that adds `.open`.
//
//   These are source-level assertions: the components are not renderable in
//   the Node test runner without the full React/E2EE harness. Their runtime
//   counterparts run in the smoke test (scripts/smoke-test.mjs), which renders
//   the production bundle in jsdom and records the DOM of every frame of both
//   directions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const css = read('src/index.css');
const settings = read('src/components/Settings.tsx');
const app = read('src/App.tsx');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

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

/**
 * Every rule whose selector mentions this class — including compound
 * selectors such as `.search-field .at-input` and grouped selector lists.
 */
function rulesMentioning(token) {
  return allRules.filter((rule) => rule.selector.includes(token));
}

/** Declarations of a rule body as a property → value map (newlines folded). */
function declarations(body) {
  const out = new Map();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim();
    if (!property) continue;
    out.set(property, part.slice(colon + 1).trim().replace(/\s+/g, ' '));
  }
  return out;
}

/** `transition` value → [{ property, timing }] in declaration order. */
function transitionParts(value) {
  return value
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((part) => {
      const [property, ...timing] = part.split(' ');
      return { property, timing: timing.join(' ') };
    });
}

/** The single entry of a transition list, or null. */
function transitionOf(parts, property) {
  return parts.find((part) => part.property === property) ?? null;
}

/** Matches a declaration of a motion property inside a rule body. */
const MOTION = /(^|[;{\s])(animation|transform|translate|scale|rotate)\s*:/;

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

/** The overlay states of the Chats ↔ New chat transition. */
const closedOverlay = declarations(ruleBody('.settings-overlay') ?? '');
const openOverlay = declarations(ruleBody('.settings-overlay.open') ?? '');
const closedTransition = transitionParts(closedOverlay.get('transition') ?? '');
const openTransition = transitionParts(openOverlay.get('transition') ?? '');

/* ------------------------------------------------------------------ */
/* 1. one animation, mirrored: entrance == exit                        */
/* ------------------------------------------------------------------ */

test('New chat enters and leaves with the same transition properties', () => {
  assert.ok(
    ruleBody('.settings-overlay') && ruleBody('.settings-overlay.open'),
    'index.css declares the closed and the open overlay state',
  );

  // The exit runs when `.open` is removed, so both rules carry the transition
  // of the SAME animation. A property (or a duration/easing) that exists in
  // only one direction would visibly desynchronize the two directions.
  assert.deepEqual(
    closedTransition.map((part) => part.property).sort(),
    openTransition.map((part) => part.property).sort(),
    'both directions animate exactly the same properties',
  );
  assert.deepEqual(
    closedTransition.map((part) => part.property).sort(),
    ['opacity', 'transform', 'visibility'],
    'the transition animates transform + opacity only (plus visibility gating)',
  );

  const closedTransform = transitionOf(closedTransition, 'transform');
  const openTransform = transitionOf(openTransition, 'transform');
  const closedOpacity = transitionOf(closedTransition, 'opacity');
  const openOpacity = transitionOf(openTransition, 'opacity');
  assert.ok(
    closedTransform && openTransform && closedOpacity && openOpacity,
    'both states transition transform and opacity',
  );

  // Same duration and easing in both directions — this is what makes the
  // return feel like the same movement instead of a second animation.
  assert.equal(
    closedTransform.timing,
    openTransform.timing,
    'the transform uses the same duration and easing in both directions',
  );
  assert.equal(
    closedOpacity.timing,
    openOpacity.timing,
    'the opacity uses the same duration and easing in both directions',
  );

  // One shared motion token for the transform, no per-direction curve.
  assert.match(
    closedTransform.timing,
    /^\d+(\.\d+)?s var\(--ease\)$/,
    'the transform uses the shared --ease token (same curve both ways)',
  );
});

test('the exit is the entrance mirrored (same distance, opposite direction)', () => {
  // The screen slides in from `translateX(56px)` to `translateX(0)`; leaving
  // must travel the exact same distance back out — no other axis, no scale.
  assert.equal(
    closedOverlay.get('transform'),
    'translateX(56px)',
    'the closed overlay rests one entry distance to the right',
  );
  assert.equal(
    openOverlay.get('transform'),
    'translateX(0)',
    'the open overlay sits at the neutral position',
  );
  const transforms = `${closedOverlay.get('transform')} ${openOverlay.get('transform')}`;
  assert.ok(
    !/scale|translateY|rotate|skew/.test(transforms),
    'the transition is a pure horizontal translation (no scale, no vertical movement)',
  );

  assert.equal(closedOverlay.get('opacity'), '0', 'the closed overlay is fully transparent');
  assert.equal(openOverlay.get('opacity'), '1', 'the open overlay is fully opaque');

  // The fade must never be clipped by the visibility switch: hiding is
  // delayed by exactly the transform duration, so removing `.open` plays the
  // full slide-out before the element leaves the visual tree.
  const closedTransform = transitionOf(closedTransition, 'transform');
  const closedVisibility = transitionOf(closedTransition, 'visibility');
  const openVisibility = transitionOf(openTransition, 'visibility');
  assert.ok(closedVisibility && openVisibility, 'both states transition visibility');
  assert.equal(openVisibility.timing, '0s', 'opening shows the overlay immediately');
  assert.ok(closedTransform, 'the closed overlay transitions its transform');
  const duration = closedTransform.timing.match(/^(\d+(?:\.\d+)?s)/)?.[1];
  assert.ok(duration, 'the transform duration is declared');
  assert.equal(
    closedVisibility.timing,
    `0s linear ${duration}`,
    'closing delays the visibility switch by the transform duration (the exit is never cut short)',
  );
  assert.equal(closedOverlay.get('visibility'), 'hidden', 'the closed overlay is hidden');
  assert.equal(openOverlay.get('visibility'), 'visible', 'the open overlay is visible');
});

test('the dedicated screen brings no motion of its own', () => {
  // The only movement of the New chat screen is the overlay's slide, and the
  // only change behind it is the stage dim. Any `animation`, `transform` or
  // scale on these rules would add motion that only one direction shows.
  for (const token of [
    '.newchat-screen',
    '.settings-scroll',
    '.settings-header',
    '.settings-page-title',
    '.settings-section',
    '.settings-row',
    '.settings-search-results',
    '.settings-search-row',
    '.blocked-search-row',
    '.at-field',
    '.at-input',
    '.at-prefix',
  ]) {
    const rules = rulesMentioning(token);
    assert.ok(rules.length > 0, `index.css styles ${token}`);
    for (const rule of rules) {
      assert.ok(
        !MOTION.test(rule.body),
        `${rule.selector} declares no motion of its own`,
      );
    }
  }

  // The stage behind the overlay dims with opacity only, so the reverse
  // direction brightens it with exactly the same transition.
  const stage = declarations(ruleBody('.app-stage') ?? '');
  const stageTransition = transitionParts(stage.get('transition') ?? '');
  assert.deepEqual(
    stageTransition.map((part) => part.property),
    ['opacity'],
    'the stage dim animates opacity only',
  );
  const shifted = ruleBody('.app-stage.shifted') ?? '';
  assert.ok(!MOTION.test(shifted), 'the dimmed stage never moves or scales');
  assert.equal(
    declarations(shifted).get('opacity'),
    '0.45',
    'the dimmed stage is the same 45% in both directions',
  );
});

/* ------------------------------------------------------------------ */
/* 2. the closing overlay keeps the screen it is sliding out           */
/* ------------------------------------------------------------------ */

test('the overlay renders a destination in the same commit as its .open class', () => {
  // The open state must still follow the LIVE route: the transition starts
  // with the class change, so it can never lag behind by a commit.
  assert.ok(
    settings.includes(
      "const open = route.startsWith('#/settings') || route.startsWith('#/new-chat');",
    ),
    'the overlay opens from the live hash route',
  );

  // The rendered destination is kept in state, follows the route while the
  // overlay is open and stays on the last opened destination while it is
  // closed — that is the screen the exit animation plays with.
  assert.ok(
    settings.includes('const [renderedRoute, setRenderedRoute] = useState(route);'),
    'the rendered destination is kept in state',
  );
  assert.ok(
    settings.includes('if (open && renderedRoute !== route) setRenderedRoute(route);'),
    'the rendered destination follows the route in the frame that opens the overlay',
  );
  assert.ok(
    settings.includes("const isNewChatRoute = renderedRoute.startsWith('#/new-chat')"),
    'the header title and the body both render the frozen destination',
  );

  // The switch has exactly one call site, and it is the render-phase guard
  // above — not an effect or a timer. Deferring it would render one frame
  // with `.open` and the stale destination (a visible hop at the start of the
  // entrance) and would delay the frozen screen past the exit.
  assert.equal(
    settings.split('setRenderedRoute').length - 1,
    2,
    'the rendered destination is switched in exactly one place',
  );

  // The frozen destination is only ever one of the two overlay destinations:
  // PeopleSearch renders for `#/new-chat` (see `npm run test:settings`), and
  // a Settings route renders the category overview.
  const newChatBranch = settings.indexOf('{isNewChatRoute ? (');
  assert.ok(newChatBranch > 0, 'the dedicated screen is still gated on the rendered route');
});

/* ------------------------------------------------------------------ */
/* 3. the bottom navigation is not part of the transition              */
/* ------------------------------------------------------------------ */

test('the transition never moves, scales or animates the bottom bar', () => {
  // The bar is a fixed top-level layer (npm run test:nav). Nothing about this
  // transition may reach it: no motion property on any `.bottom-nav*` rule,
  // and no rule that nests the bar inside an animated layer.
  const navRules = allRules.filter((rule) => rule.selector.includes('.bottom-nav'));
  assert.ok(navRules.length > 0, 'index.css declares the navigation rules');
  for (const rule of navRules) {
    assert.ok(
      !MOTION.test(rule.body),
      `${rule.selector} carries no motion during the transition`,
    );
  }
  const animatedLayers = [
    '.settings-overlay',
    '.app-stage',
    '.newchat-screen',
    '.settings-scroll',
  ];
  for (const rule of navRules) {
    for (const layer of animatedLayers) {
      assert.ok(
        !rule.selector.includes(layer),
        `no rule nests the bar inside ${layer} ("${rule.selector}")`,
      );
    }
  }

  // The bar is rendered as a sibling of both animated layers, so it cannot
  // inherit the overlay transform the New chat transition runs (full
  // architecture guard: npm run test:nav).
  const stageOpen = app.indexOf('<div className={`app-stage');
  const stageClose = closingDivIndex(app, stageOpen);
  assert.ok(stageOpen > 0 && stageClose > stageOpen, 'App.tsx renders the app stage');
  assert.ok(
    !app.slice(stageOpen, stageClose).includes('BottomNav'),
    'the bar is not rendered inside the app stage (it would inherit the transition)',
  );
  assert.ok(
    app.indexOf('<BottomNav') > app.indexOf('<Settings'),
    'the bar is rendered after the Settings overlay, never inside it',
  );
});
