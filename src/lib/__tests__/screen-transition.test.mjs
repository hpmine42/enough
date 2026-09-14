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
  // a Settings route renders the category overview. Which of the two pane
  // elements is rendered as the destination still follows that frozen route
  // (the swap below only adds the destination that is leaving).
  assert.match(
    settings,
    /const activeDestination: OverlayDestination = isNewChatRoute \? 'new-chat' : 'settings';/,
    'the rendered destination still follows the frozen route',
  );
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

/* ------------------------------------------------------------------ */
/* 4. the New chat ↔ Settings swap                                     */
/* ------------------------------------------------------------------ */
/*
 * `#/new-chat` and `#/settings` are two equal top-level destinations of the
 * same overlay, so switching between them is ONE horizontal movement played
 * in both directions: every pane travels the same distance, for the same
 * duration, with the same curve, and the reverse direction is literally the
 * same animation backwards. The destination that slides away keeps its own
 * content (and its scroll position — its pane element is not remounted) until
 * its exit is over, and the destination that arrives is rendered with its
 * content in the same commit that starts the swap.
 *
 * Like the reference transition (Chats ↔ New chat), the class change and the
 * content change happen in ONE React commit, and the swap animates the panes
 * only: the overlay, the stage, the subpanels and the bottom bar keep their
 * own transitions, so no second screen animation can ever run on top of the
 * overlay's slide.
 */

/** Keyframe declaration blocks: the flat rule list cannot see them, because
 *  a `@keyframes` block nests (`@keyframes name { from { … } to { … } }`). */
function keyframes(name) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = source.match(
    new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  if (block === undefined) return null;
  const frames = {};
  for (const frame of block.matchAll(/(from|to)\s*\{([^}]*)\}/g)) {
    frames[frame[1]] = declarations(frame[2]);
  }
  return frames;
}

/** `from`/`to` of a keyframe block as plain objects (order-independent). */
function keyframeValues(name) {
  const frames = keyframes(name);
  assert.ok(frames, `index.css declares @keyframes ${name}`);
  assert.ok(frames.from && frames.to, `${name} declares a from and a to frame`);
  return {
    from: Object.fromEntries(frames.from),
    to: Object.fromEntries(frames.to),
  };
}

/** The `animation` shorthand of a rule → { name, timing }. */
function animationOf(selector) {
  const body = ruleBody(selector);
  assert.ok(body, `index.css declares ${selector}`);
  const parts = transitionParts(declarations(body).get('animation') ?? '');
  assert.equal(parts.length, 1, `${selector} declares exactly one animation`);
  return { name: parts[0].property, timing: parts[0].timing };
}

test('each destination keeps its side, so both directions are one mirrored move', () => {
  const inLeft = keyframeValues('pane-in-left');
  const outLeft = keyframeValues('pane-out-left');
  const inRight = keyframeValues('pane-in-right');
  const outRight = keyframeValues('pane-out-right');

  // New chat is the left area: it enters from and leaves to the left while
  // the Settings overview arrives from the right …
  assert.deepEqual(
    inLeft,
    { from: { opacity: '0', transform: 'translateX(-56px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
    'New chat enters from the left',
  );
  assert.deepEqual(
    outLeft,
    { from: { opacity: '1', transform: 'translateX(0)' }, to: { opacity: '0', transform: 'translateX(-56px)' } },
    'New chat leaves to the left',
  );
  // … and Settings is the mirror image on the right side.
  assert.deepEqual(
    inRight,
    { from: { opacity: '0', transform: 'translateX(56px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
    'Settings arrives from the right',
  );
  assert.deepEqual(
    outRight,
    { from: { opacity: '1', transform: 'translateX(0)' }, to: { opacity: '0', transform: 'translateX(56px)' } },
    'Settings leaves to the right',
  );

  // The exit is the entrance played backwards — in both directions.
  assert.deepEqual(outLeft, { from: inLeft.to, to: inLeft.from }, 'New chat exit mirrors its entrance');
  assert.deepEqual(outRight, { from: inRight.to, to: inRight.from }, 'Settings exit mirrors its entrance');

  // A pure horizontal translation, identical in both directions: no scale, no
  // vertical movement, no bounce — and the same distance as the reference
  // transition (`.settings-overlay` slides in by 56px).
  for (const [name, frames] of Object.entries({
    'pane-in-left': inLeft,
    'pane-out-left': outLeft,
    'pane-in-right': inRight,
    'pane-out-right': outRight,
  })) {
    for (const phase of ['from', 'to']) {
      assert.ok(
        !/scale|translateY|rotate|skew/.test(frames[phase].transform),
        `${name} ${phase} is a pure horizontal translation`,
      );
    }
    const offsets = [frames.from.transform, frames.to.transform];
    assert.ok(
      offsets.includes('translateX(0)'),
      `${name} starts or ends at the resting position`,
    );
    const travelled = offsets
      .map((transform) => /^translateX\((-?\d+)px\)$/.exec(transform)?.[1])
      .find((value) => value !== undefined);
    assert.ok(travelled, `${name} travels one offset away`);
    assert.equal(
      Math.abs(Number(travelled)),
      56,
      `${name} travels the same distance as the reference transition`,
    );
  }
});

test('both directions use the same duration, easing and distance', () => {
  const entering = {
    'new-chat': animationOf('.settings-pane-new-chat.entering'),
    settings: animationOf('.settings-pane-settings.entering'),
  };
  const leaving = {
    'new-chat': animationOf('.settings-pane-new-chat.leaving'),
    settings: animationOf('.settings-pane-settings.leaving'),
  };
  assert.deepEqual(
    {
      'new-chat': entering['new-chat'].name,
      settings: entering.settings.name,
      ...Object.fromEntries(
        Object.entries(leaving).map(([side, value]) => [`out-${side}`, value.name]),
      ),
    },
    {
      'new-chat': 'pane-in-left',
      settings: 'pane-in-right',
      'out-new-chat': 'pane-out-left',
      'out-settings': 'pane-out-right',
    },
    'each side enters from and leaves towards its own side',
  );

  // One shared motion token: same duration and easing in all four
  // animations, so neither direction can feel faster or softer than the other.
  // (`forwards` only holds the exit at its end state until the pane is
  // unmounted — it changes neither duration nor curve.)
  const motionOf = (animation) => animation.timing.split(' ').slice(0, 2).join(' ');
  for (const [side, animation] of Object.entries({ ...entering, ...leaving })) {
    assert.equal(
      motionOf(animation),
      '0.3s var(--ease)',
      `${side} uses the shared duration and easing token`,
    );
    const fill = animation.timing.split(' ')[2];
    assert.ok(
      fill === undefined || fill === 'forwards',
      `${side} adds no fill mode that could keep a departed pane visible`,
    );
  }

  // The swap uses the reference transition's own timing: same duration, same
  // curve as the overlay's slide (only the distance is applied to both panes).
  const overlayTransform = transitionOf(closedTransition, 'transform');
  assert.ok(overlayTransform, 'the overlay transitions its transform');
  assert.equal(
    motionOf(leaving['new-chat']),
    overlayTransform.timing,
    'the swap and the overlay slide share duration and easing',
  );

  // The leaving pane rests where its exit ends: without animations (reduced
  // motion) or in an environment that never runs them, only the arriving pane
  // is visible instead of two stacked screens.
  for (const [selector, name] of [
    ['.settings-pane-new-chat.leaving', 'pane-out-left'],
    ['.settings-pane-settings.leaving', 'pane-out-right'],
  ]) {
    const base = declarations(ruleBody(selector));
    const frames = keyframeValues(name);
    assert.equal(base.get('transform'), frames.to.transform, `${selector} rests where ${name} ends`);
    assert.equal(base.get('opacity'), frames.to.opacity, `${selector} fades out like ${name}`);
  }
});

test('the swap never animates anything else (no competing screen animation)', () => {
  // A pane at rest carries no motion at all: the swap animations exist only
  // while a swap is running (`entering` / `leaving`), which is why a plain
  // (active) pane declares no animation and no transform.
  const paneShell = ruleBody('.settings-pane');
  assert.ok(paneShell, 'index.css declares the pane shell');
  assert.ok(!/animation\s*:/.test(paneShell), 'the pane shell declares no animation');
  assert.equal(ruleBody('.settings-pane.active'), null, 'the active pane is the plain pane state');
  const leavingBase = ruleBody('.settings-pane.leaving');
  assert.ok(leavingBase, 'index.css declares the leaving pane base state');
  assert.ok(
    !/animation\s*:/.test(leavingBase),
    'the leaving base state declares no animation of its own',
  );
  assert.ok(
    /pointer-events:\s*none/.test(leavingBase),
    'the leaving pane is not interactive while it slides away',
  );
  // The arriving pane fades in over the one that slides away, whatever the
  // DOM order of the two panes is.
  const paneZ = Number(/z-index:\s*(\d+)/.exec(paneShell)?.[1]);
  const leavingZ = Number(/z-index:\s*(\d+)/.exec(leavingBase)?.[1]);
  assert.ok(
    paneZ > leavingZ,
    'the arriving pane stacks above the leaving one (the exit stays underneath)',
  );

  // Exactly the four swap rules animate a pane — nothing else in the
  // overlay chain does, so the overlay entrance/exit and the subpanels can
  // never run a second animation on top of the swap (and vice versa).
  const animatedPanes = allRules
    .filter((rule) => rule.selector.includes('.settings-pane') && /animation\s*:/.test(rule.body))
    .map((rule) => rule.selector)
    .sort();
  assert.deepEqual(
    animatedPanes,
    [
      '.settings-pane-new-chat.entering',
      '.settings-pane-new-chat.leaving',
      '.settings-pane-settings.entering',
      '.settings-pane-settings.leaving',
    ],
    'only the entering and leaving panes are animated',
  );
  for (const selector of [
    '.settings-overlay',
    '.settings-overlay.open',
    '.settings-subpanel',
    '.settings-subpanel.open',
    '.app-stage',
    '.app-stage.shifted',
  ]) {
    assert.ok(
      !/animation\s*:/.test(ruleBody(selector) ?? ''),
      `${selector} keeps its own transition (no animation of its own)`,
    );
  }

  // The swap has nothing to do with the bottom bar: no rule for the panes may
  // even mention it, and the bar keeps its colour-only transitions.
  for (const rule of allRules.filter((rule) => /\.settings-pane/.test(rule.selector))) {
    assert.ok(
      !/\.bottom-nav/.test(rule.selector),
      `no swap rule targets the bar ("${rule.selector}")`,
    );
    assert.ok(
      !/animation\s*:/.test(rule.body) || !/nav/.test(rule.body),
      'no swap rule animates the bar',
    );
  }
});

test('the leaving destination keeps its own content for exactly its exit', () => {
  // Both panes are the same shell, so each one can only ever render its own
  // destination: the pane that slides away shows the screen it was, never the
  // one that is arriving.
  const newChatPane = settings.slice(
    settings.indexOf("{paneState('new-chat') !== null && ("),
    settings.indexOf("{paneState('settings') !== null && ("),
  );
  const settingsPane = settings.slice(
    settings.indexOf("{paneState('settings') !== null && ("),
    settings.indexOf('{/* The primary navigation is NOT rendered here'),
  );
  assert.ok(newChatPane.includes('{newChatBody}'), 'the New chat pane renders the search screen');
  assert.ok(!newChatPane.includes('{settingsBody}'), 'the New chat pane never renders the overview');
  assert.ok(settingsPane.includes('{settingsBody}'), 'the Settings pane renders the category overview');
  assert.ok(!settingsPane.includes('{newChatBody}'), 'the Settings pane never renders the search');

  // Render-phase state machine, exactly like the frozen destination above:
  // the route of the previous commit is compared before it is updated, in the
  // same render phase, so the destination that is leaving is known in the
  // commit that already renders the arriving one — exit and entry are
  // therefore deterministic and never one frame apart.
  assert.ok(
    settings.includes('const previousRoute = seenRoute;'),
    'the swap compares against the route of the previous commit',
  );
  assert.match(
    settings,
    /if \(previousRoute !== route\) \{[\s\S]*?setLeavingDestination\(/,
    'the swap state is set in the same render phase',
  );
  assert.match(
    settings,
    /const previousDestination = topLevelDestination\(previousRoute\);/,
    'only a top-level destination can start a swap',
  );
  assert.ok(
    settings.includes('previousDestination !== null && destination !== null'),
    'a swap needs two top-level destinations (the overlay entrance and the subpages stay untouched)',
  );
  assert.ok(
    settings.includes('leavingDestination === activeDestination'),
    'the leaving pane is never the destination that is already shown',
  );

  // The pane hooks the runtime assertions use, and the accessibility rule
  // that only the leaving pane ends the swap — the arriving pane must never
  // cut the exit short.
  assert.ok(settings.includes('data-pane={destination}'), 'panes expose their destination');
  assert.ok(settings.includes('data-pane-state={state}'), 'panes expose their swap state');
  assert.ok(
    settings.includes("onAnimationEnd={state === 'leaving' ? onExitEnd : undefined}"),
    'only the exit animation ends the swap',
  );
  assert.ok(
    settings.includes("aria-hidden={state === 'leaving' || undefined}"),
    'the leaving pane leaves the accessibility tree while it slides away',
  );

  // The JS duration and the CSS animation duration are one value: the smoke
  // test waits for the pane to be unmounted, the browser for `animationend`.
  const duration = settings.match(/const SWAP_DURATION_MS = (\d+);/);
  assert.ok(duration, 'Settings.tsx declares the swap duration');
  assert.equal(
    `${Number(duration[1]) / 1000}s`,
    animationOf('.settings-pane-settings.entering').timing.split(' ')[0],
    'the JS swap duration equals the CSS animation duration',
  );
  assert.match(
    settings,
    /const SWAP_CLEANUP_MS = SWAP_DURATION_MS \+ \d+;/,
    'the cleanup timer is a bounded fallback on top of the animation',
  );
  assert.match(
    settings,
    /window\.setTimeout\(\(\) => setLeavingDestination\(null\), SWAP_CLEANUP_MS\)/,
    'the fallback ends a swap that never fires animationend (jsdom smoke test)',
  );
});
