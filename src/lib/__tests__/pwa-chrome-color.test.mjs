// enough. — PWA chrome colour regression tests
//
// THE BUG THIS GUARDS
//   In the installed app the top of the screen stayed the LIGHT canvas while
//   the app itself was in dark mode. The reason: an installed PWA paints the
//   strip around the cutout / status bar from channels outside the stylesheet
//   —
//     * iOS 26+ ignores `meta name="theme-color"` there entirely and derives
//       the region from the ROOT element's `background-color`; <html> carried
//       no background at all (only <body> did), so it fell back to the UA
//       default light canvas.
//     * Chrome/Android take the standalone status-bar and splash colour from
//       the MANIFEST, which declared only the light `theme_color` /
//       `background_color` — the media-qualified metas cannot reach it.
//
//   The fix therefore has to hold on four channels at once, and they must all
//   agree: `--bg` on <html> + <body> + #root (index.css), the per-scheme
//   manifest colours (public/manifest.webmanifest, `color_scheme_dark`), the
//   two metas and the pre-paint bootstrap (index.html), and the runtime sync
//   (src/lib/theme.ts). One channel drifting is invisible in review and
//   visible on a phone, so it is pinned here.
//
// WHAT IS TESTED HOW
//   The colour agreement across the four channels is a source-level assertion:
//   there is no colour automation in this repository and jsdom performs no
//   layout, so a pixel verdict stays manual QA (see docs/pwa.md). The theme
//   sync itself is tested behaviorally — `applyMode()` really runs against the
//   stubbed document below, and would fail if it stopped writing either the
//   theme-color metas or the used-scheme meta.
//
// Run with:
//   npm run test:pwachrome
//   node --test --experimental-strip-types src/lib/__tests__/pwa-chrome-color.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const css = read('src/index.css');
const html = read('index.html');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const darkManifest = JSON.parse(read('public/manifest.dark.webmanifest'));

/* ------------------------------------------------------------------ */
/* Stylesheet helpers (brace-matched, no external CSS parser)         */
/* ------------------------------------------------------------------ */

/**
 * Every rule of the stylesheet as `{ selector, body }`. Top level rules are
 * returned as written; rules nested inside an at-rule (e.g. the
 * `display-mode: standalone` block) are returned too, since that block is part
 * of the contract below. Comments are stripped first: they sit between the
 * previous rule and a selector, and must not end up inside it.
 */
function rules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  let depth = 0;
  let selStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        const bodyEnd = matchingBrace(text, i);
        const selector = text.slice(selStart, i).replace(/\s+/g, ' ').trim();
        const body = text.slice(i + 1, bodyEnd);
        if (!selector.startsWith('@')) {
          out.push({ selector, body });
        }
        // Descend one level so nested rules are scanned as well.
        for (const nested of rules(body)) out.push(nested);
        i = bodyEnd;
        selStart = bodyEnd + 1;
        continue;
      }
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) depth -= 1;
    }
  }
  return out;
}

/** Index of the `}` closing the `{` at `open`. */
function matchingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

/** A rule body as a `property -> value` map (comments and blanks dropped). */
function parseDecls(body) {
  const out = {};
  if (typeof body !== 'string') return out;
  for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const [prop, ...rest] = decl.split(':');
    if (!prop || rest.length === 0) continue;
    out[prop.trim()] = rest.join(':').trim();
  }
  return out;
}

/** Declarations of `selector` (exact, whitespace-normalised) as a property map. */
function declarations(source, selector) {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  return parseDecls(rules(source).find((r) => r.selector === wanted)?.body);
}

/**
 * True when some rule paints `element` itself (i.e. `element` appears as its
 * own simple selector in the rule's selector list) with `prop: value`.
 */
function paints(source, element, prop, value) {
  return rules(source).some(
    (rule) =>
      rule.selector
        .split(',')
        .some((part) => part.replace(/\s+/g, ' ').trim() === element) &&
      parseDecls(rule.body)[prop] === value,
  );
}

/** `--bg` of a token block, normalised to an upper-case 6-digit hex colour. */
function canvasToken(blockSelector) {
  const token = declarations(css, blockSelector)['--bg'];
  assert.ok(
    typeof token === 'string',
    `the ${blockSelector} block must define --bg (found: ${token})`,
  );
  const hex = token.trim().match(/^#([0-9a-fA-F]{6})$/);
  assert.ok(hex, `--bg of ${blockSelector} must be a 6-digit hex colour: ${token}`);
  return `#${hex[1].toUpperCase()}`;
}

const lightCanvas = canvasToken(':root');
const darkCanvas = canvasToken(':root.dark');

const norm = (color) => (color ?? '').toString().trim().toUpperCase();

/* ------------------------------------------------------------------ */
/* 1. The canvas token is painted on the root element, not only <body> */
/* ------------------------------------------------------------------ */

test('index.css paints <html> with the canvas token (PWA status-bar strip)', () => {
  for (const selector of ['html', 'body', '#root']) {
    assert.ok(
      paints(css, selector, 'background', 'var(--bg)') ||
        paints(css, selector, 'background-color', 'var(--bg)'),
      `<${selector}> must carry background: var(--bg) — an unpainted element ` +
        `falls back to the UA default light canvas and shows as a pale band ` +
        `above a dark installed app`,
    );
  }
});

test('the two canvas tokens are the two theme colours, and stay distinct', () => {
  assert.equal(lightCanvas, '#F7F5F0', 'light --bg drifted from the app canvas');
  assert.equal(darkCanvas, '#171614', 'dark --bg drifted from the app canvas');
  assert.notEqual(lightCanvas, darkCanvas);
});

test('no standalone/installed rule pins a hardcoded canvas colour', () => {
  // A literal in the `display-mode: standalone` block would stop following
  // the theme class and reintroduce exactly the light top strip.
  for (const rule of rules(css)) {
    if (!/display-mode/.test(rule.selector)) continue;
    assert.ok(
      !/#f7f5f0|#171614|#fff\b|#ffffff|white/i.test(rule.body),
      `standalone rule "${rule.selector}" must use tokens, not a literal colour`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* 2. The manifest carries BOTH schemes (the installed app reads it)  */
/* ------------------------------------------------------------------ */

test('manifest light colours match the light canvas token', () => {
  assert.equal(norm(manifest.theme_color), lightCanvas, 'manifest theme_color');
  assert.equal(
    norm(manifest.background_color),
    lightCanvas,
    'manifest background_color (splash screen)',
  );
});

test('both colour variants of the manifest exist and differ only in theme_color/background_color', () => {
  assert.deepEqual(
    Object.keys(manifest).sort(),
    Object.keys(darkManifest).sort(),
    'manifest key sets must match exactly',
  );

  for (const key of Object.keys(manifest)) {
    if (key === 'theme_color') {
      assert.equal(norm(manifest.theme_color), lightCanvas, 'light manifest theme_color');
      assert.equal(norm(darkManifest.theme_color), darkCanvas, 'dark manifest theme_color');
    } else if (key === 'background_color') {
      assert.equal(
        norm(manifest.background_color),
        lightCanvas,
        'light manifest background_color',
      );
      assert.equal(
        norm(darkManifest.background_color),
        darkCanvas,
        'dark manifest background_color',
      );
    } else {
      assert.deepEqual(
        manifest[key],
        darkManifest[key],
        `key "${key}" must be byte-identical between manifest variants so Chromium does not fork the install`,
      );
    }
  }

  assert.equal(manifest.id, './', 'manifest id must be "./"');
  assert.equal(manifest.id, darkManifest.id, 'id member must match across variants');
});

test('manifest declares a dark scheme so a standalone window is not light', () => {
  const dark = manifest.color_scheme_dark;
  assert.ok(
    dark && typeof dark === 'object',
    'public/manifest.webmanifest must declare color_scheme_dark: an installed ' +
      "PWA reads its chrome colour from the manifest, which cannot answer to " +
      'the document metas',
  );
  assert.equal(norm(dark.theme_color), darkCanvas, 'color_scheme_dark.theme_color');
  assert.equal(
    norm(dark.background_color),
    darkCanvas,
    'color_scheme_dark.background_color',
  );
});

test('manifest colours are fully opaque (transparency is dropped by browsers)', () => {
  for (const color of [
    manifest.theme_color,
    manifest.background_color,
    manifest.color_scheme_dark?.theme_color,
    manifest.color_scheme_dark?.background_color,
  ]) {
    assert.match(String(color), /^#[0-9a-fA-F]{6}$/, `${color} must be #rrggbb`);
  }
});

test('standalone display mode is declared, so the chrome colours apply', () => {
  assert.equal(manifest.display, 'standalone');
});

/* ------------------------------------------------------------------ */
/* 3. index.html: per-scheme metas, the used scheme, the iOS strip     */
/* ------------------------------------------------------------------ */

const themeMetas = [...html.matchAll(/<meta[^>]*name=["']theme-color["'][^>]*>/gi)];

test('index.html declares one theme-color meta per colour scheme', () => {
  assert.equal(themeMetas.length, 2, 'expected exactly two theme-color metas');
  const byScheme = new Map();
  for (const tag of themeMetas.map((m) => m[0])) {
    const media = tag.match(/media=["']\(\s*prefers-color-scheme:\s*(\w+)\s*\)/i)?.[1];
    const content = tag.match(/content=["'](#[0-9a-fA-F]{6})["']/i)?.[1];
    assert.ok(media, `each theme-color meta needs a prefers-color-scheme media: ${tag}`);
    byScheme.set(media.toLowerCase(), norm(content));
  }
  assert.equal(byScheme.get('light'), lightCanvas, 'light theme-color meta');
  assert.equal(byScheme.get('dark'), darkCanvas, 'dark theme-color meta');
});

test('pre-paint bootstrap re-pins both metas and the used colour scheme', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.ok(
    script.includes('meta[name="theme-color"]'),
    'the inline script must update every theme-color meta, so an explicit ' +
      'in-app theme also wins against an opposite OS preference',
  );
  assert.ok(
    script.includes(darkCanvas) && script.includes(lightCanvas),
    `the inline bootstrap must apply ${lightCanvas} / ${darkCanvas} before ` +
      'first paint (it runs before the module graph, so it duplicates them)',
  );
  assert.ok(
    script.includes('meta[name="color-scheme"]'),
    'the inline bootstrap must also narrow the used colour scheme',
  );
});

test('index.html swaps the manifest link inside the pre-paint script, and the literals still equal THEME_CHROME_COLORS', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.ok(
    script.includes('link[rel="manifest"]') || script.includes('manifest.setAttribute'),
    'pre-paint script must query and update the manifest link',
  );
  assert.ok(
    script.includes('manifest.dark.webmanifest'),
    'pre-paint script must reference the dark manifest variant',
  );
  assert.ok(
    script.includes('manifest.webmanifest'),
    'pre-paint script must reference the light manifest variant',
  );
  assert.ok(
    script.includes(darkCanvas) && script.includes(lightCanvas),
    `pre-paint script literals must equal THEME_CHROME_COLORS: ${lightCanvas} / ${darkCanvas}`,
  );
});

test('iOS keeps drawing the standalone strip from the page background', () => {
  assert.match(
    html,
    /<meta[^>]*name=["']apple-mobile-web-app-status-bar-style["'][^>]*content=["']black-translucent["']/,
    'default would paint an opaque light bar above the app in standalone mode',
  );
  assert.match(
    html,
    /<meta[^>]*name=["']color-scheme["'][^>]*content=["']light dark["']/,
    'the static meta must advertise both schemes for the pre-JS paint',
  );
});

/* ------------------------------------------------------------------ */
/* 4. Runtime: theme.ts really drives every channel it can reach      */
/* ------------------------------------------------------------------ */

function fakeMeta(attrs) {
  const map = new Map(Object.entries(attrs));
  return {
    getAttribute: (name) => map.get(name) ?? null,
    setAttribute: (name, value) => map.set(name, String(value)),
  };
}

const metas = [
  fakeMeta({ name: 'theme-color', content: '#F7F5F0', media: '(prefers-color-scheme: light)' }),
  fakeMeta({ name: 'theme-color', content: '#171614', media: '(prefers-color-scheme: dark)' }),
  fakeMeta({ name: 'color-scheme', content: 'light dark' }),
];
const manifestLink = fakeMeta({ rel: 'manifest', href: './manifest.webmanifest' });

const store = new Map();
const rootClasses = new Set();
let osDark = false;

globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  matchMedia: (query) => ({
    matches: query.includes('prefers-color-scheme: dark') ? osDark : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
  dispatchEvent() {
    return true;
  },
};
globalThis.document = {
  documentElement: {
    classList: {
      add: (c) => rootClasses.add(c),
      remove: (c) => rootClasses.delete(c),
      toggle: (c, on) => (on ? rootClasses.add(c) : rootClasses.delete(c)),
      contains: (c) => rootClasses.has(c),
    },
  },
  querySelector: (sel) => {
    if (sel.includes('color-scheme')) return metas[2];
    if (sel.includes('manifest')) return manifestLink;
    return null;
  },
  querySelectorAll: (sel) =>
    sel.includes('theme-color') ? metas.filter((m) => m.getAttribute('media')) : [],
};

const { applyMode, THEME_CHROME_COLORS } = await import('../theme.ts');

const themeColorMetas = () => metas.slice(0, 2);
const isDark = () => rootClasses.has('dark');

test('THEME_CHROME_COLORS are the very colours the static channels declare', () => {
  assert.deepEqual(
    { light: norm(THEME_CHROME_COLORS.light), dark: norm(THEME_CHROME_COLORS.dark) },
    { light: lightCanvas, dark: darkCanvas },
    'theme.ts and index.css must not drift apart',
  );
});

test('applyMode("dark") paints every theme-color meta and the used scheme', () => {
  osDark = false; // OS light + explicit dark: the app choice has to win.
  applyMode('dark');
  assert.ok(isDark(), 'the dark class is applied');
  for (const meta of themeColorMetas()) {
    assert.equal(
      meta.getAttribute('content'),
      darkCanvas,
      'both media-qualified metas are pinned to the dark canvas',
    );
  }
  assert.equal(metas[2].getAttribute('content'), 'dark', 'used colour scheme');
});

test('applyMode("light") returns the chrome to the light canvas', () => {
  applyMode('light');
  assert.ok(!isDark(), 'the dark class is removed');
  for (const meta of themeColorMetas()) {
    assert.equal(meta.getAttribute('content'), lightCanvas);
  }
  assert.equal(metas[2].getAttribute('content'), 'light', 'used colour scheme');
});

test('system mode follows the OS on both channels', () => {
  osDark = true;
  applyMode('system');
  assert.ok(isDark(), 'system + OS dark → dark');
  assert.equal(themeColorMetas()[0].getAttribute('content'), darkCanvas);
  assert.equal(metas[2].getAttribute('content'), 'dark');

  osDark = false;
  applyMode('system');
  assert.ok(!isDark(), 'system + OS light → light');
  assert.equal(themeColorMetas()[1].getAttribute('content'), lightCanvas);
  assert.equal(metas[2].getAttribute('content'), 'light');
});

test('render() updates the manifest link to match the active theme', () => {
  applyMode('dark');
  assert.equal(
    manifestLink.getAttribute('href'),
    './manifest.dark.webmanifest',
    'manifest link must point to dark variant in dark mode',
  );

  applyMode('light');
  assert.equal(
    manifestLink.getAttribute('href'),
    './manifest.webmanifest',
    'manifest link must point to light variant in light mode',
  );
});

function setNavigator(val) {
  Object.defineProperty(globalThis, 'navigator', {
    value: val,
    configurable: true,
    writable: true,
  });
}

test('render() posts the theme to the worker when one is controlling the page', () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const messages = [];
  setNavigator({
    serviceWorker: {
      controller: {
        postMessage: (msg) => messages.push(msg),
      },
      ready: Promise.resolve({
        active: {
          postMessage: (msg) => messages.push(msg),
        },
      }),
    },
  });

  try {
    applyMode('dark');
    assert.ok(
      messages.some((m) => m.type === 'enough-theme' && m.theme === 'dark'),
      'dark mode must be posted to the active/controlling service worker',
    );

    messages.length = 0;
    applyMode('light');
    assert.ok(
      messages.some((m) => m.type === 'enough-theme' && m.theme === 'light'),
      'light mode must be posted to the active/controlling service worker',
    );
  } finally {
    if (origDesc) {
      Object.defineProperty(globalThis, 'navigator', origDesc);
    }
  }
});

test('render() no-ops without throwing when navigator.serviceWorker is missing, unsupported, or has no active worker', () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  try {
    // Case A: navigator is undefined
    setNavigator(undefined);
    assert.doesNotThrow(() => applyMode('dark'), 'must not throw when navigator is undefined');

    // Case B: serviceWorker not in navigator
    setNavigator({});
    assert.doesNotThrow(() => applyMode('light'), 'must not throw when serviceWorker not in navigator');

    // Case C: registration has no active worker
    setNavigator({
      serviceWorker: {
        controller: null,
        ready: Promise.resolve({ active: null }),
      },
    });
    assert.doesNotThrow(() => applyMode('dark'), 'must not throw when registration has no active worker');
  } finally {
    if (origDesc) {
      Object.defineProperty(globalThis, 'navigator', origDesc);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 5. Service worker: theme-aware manifest and bypass of cacheFirst   */
/* ------------------------------------------------------------------ */

test('the worker source (scripts/pwa-plugin.ts, as generated) special-cases the manifest URL and does not use cacheFirstStatic for it', async () => {
  const pluginSource = read('scripts/pwa-plugin.ts');
  assert.ok(
    pluginSource.includes('isManifestRequest'),
    'scripts/pwa-plugin.ts must special-case manifest requests',
  );
  assert.ok(
    pluginSource.includes('networkFirstManifest'),
    'scripts/pwa-plugin.ts must route manifest requests to networkFirstManifest',
  );

  const { buildSwSource } = await import('../../../scripts/pwa-plugin.ts');
  const swCode = buildSwSource({
    cacheId: 'test-cache-id',
    precache: ['/index.html', '/manifest.webmanifest', '/manifest.dark.webmanifest'],
    base: '/',
  });

  const fetchIdx = swCode.indexOf("self.addEventListener('fetch'");
  assert.ok(fetchIdx !== -1, 'fetch event listener must exist in generated sw.js');
  const fetchBlock = swCode.slice(fetchIdx);

  const manifestCallIdx = fetchBlock.indexOf('isManifestRequest(url)');
  const staticCallIdx = fetchBlock.indexOf('isStaticAsset(url)');

  assert.ok(
    manifestCallIdx !== -1,
    'fetch listener must check isManifestRequest',
  );
  assert.ok(
    staticCallIdx !== -1,
    'fetch listener must check isStaticAsset',
  );
  assert.ok(
    manifestCallIdx < staticCallIdx,
    'isManifestRequest must be checked before isStaticAsset in fetch handler',
  );

  // Assert manifest branch returns networkFirstManifest and does NOT hit cacheFirstStatic
  const manifestBlock = fetchBlock.slice(manifestCallIdx, staticCallIdx);
  assert.ok(
    manifestBlock.includes('event.respondWith(networkFirstManifest(request, url))'),
    'manifest handler must call networkFirstManifest',
  );
  assert.ok(
    !manifestBlock.includes('event.respondWith(cacheFirstStatic'),
    'manifest handler must not call cacheFirstStatic',
  );

  // Assert service worker listens for enough-theme messages and stores theme in cache
  assert.ok(
    swCode.includes('enough-theme'),
    'service worker must handle enough-theme message event',
  );
  assert.ok(
    swCode.includes('enough-theme.txt'),
    'service worker must persist theme to enough-theme.txt in Cache Storage',
  );

  // Assert colors injected in worker match THEME_CHROME_COLORS
  assert.ok(
    swCode.includes(JSON.stringify(THEME_CHROME_COLORS.light)) &&
      swCode.includes(JSON.stringify(THEME_CHROME_COLORS.dark)),
    'generated worker must contain THEME_CHROME_COLORS values',
  );
});
