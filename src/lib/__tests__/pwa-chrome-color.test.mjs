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
const workerPluginSource = read('scripts/pwa-plugin.ts');

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
// The manifest link element: render() must swap its href between the two
// theme variants (the installed app's bars are read from the manifest).
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
    if (sel.includes('rel="manifest"]')) return manifestLink;
    return null;
  },
  querySelectorAll: (sel) =>
    sel.includes('theme-color') ? metas.filter((m) => m.getAttribute('media')) : [],
};

// Controllable navigator: tests below attach/detach a service-worker stub to
// prove the theme sync posts to a controlling worker and no-ops everywhere
// else — jsdom/Node provide none, matching tab mode.
const navigatorStub = {};
Object.defineProperty(globalThis, 'navigator', {
  value: navigatorStub,
  configurable: true,
});

const { applyMode, THEME_CHROME_COLORS, THEME_MANIFEST_LINKS } = await import('../theme.ts');

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

/* ------------------------------------------------------------------ */
/* 5. Installed Android: the manifest itself is the chrome channel    */
/* ------------------------------------------------------------------ */
//
// Chrome/Android paints the installed app's status bar and gesture-bar band
// from the MANIFEST — not from the runtime metas (crbug 40759522 /
// 40686953 / 40634649) — and `color_scheme_dark` only answers to the OS
// scheme. So the manifest must become theme-aware on three legs: a dark
// variant file (fresh install, no worker yet), the page swapping the
// manifest link per theme (pre-paint + on change), and the service worker
// rewriting every manifest copy it serves from the stored in-app theme.
// Removing any leg reintroduces the light bands on a dark app — the
// original bug — so each one fails loudly here.

/** Every path where two manifests disagree, recursively (arrays by index). */
function deepDiffs(a, b, path = '') {
  const diffs = [];
  const keys = new Set([
    ...Object.keys(a ?? {}),
    ...Object.keys(b ?? {}),
  ]);
  for (const key of keys) {
    const p = path ? `${path}.${key}` : key;
    const av = a?.[key];
    const bv = b?.[key];
    if (av === bv) continue;
    if (av && bv && typeof av === 'object' && typeof bv === 'object') {
      diffs.push(...deepDiffs(av, bv, p));
    } else {
      diffs.push({ path: p, light: av, dark: bv });
    }
  }
  return diffs;
}

test('both manifest variants exist and differ ONLY in theme_color/background_color', () => {
  const diffs = deepDiffs(manifest, darkManifest);
  assert.deepEqual(
    diffs.map((d) => d.path).sort(),
    ['background_color', 'theme_color'],
    `the two manifest variants must be identical except the two chrome ` +
      `colours — drifted at: ${JSON.stringify(diffs)}`,
  );
});

test('the dark variant carries the dark canvas, the light base stays light', () => {
  assert.equal(norm(manifest.theme_color), lightCanvas, 'base theme_color');
  assert.equal(norm(manifest.background_color), lightCanvas, 'base background_color');
  assert.equal(norm(darkManifest.theme_color), darkCanvas, 'dark theme_color');
  assert.equal(norm(darkManifest.background_color), darkCanvas, 'dark background_color');
  // Chromium treats a changed `id` as a DIFFERENT app — the user would get
  // a second install entry. Every identity-bearing member must stay put.
  assert.equal(darkManifest.id, manifest.id, 'id must be byte-identical');
  assert.equal(darkManifest.start_url, manifest.start_url);
  assert.equal(darkManifest.scope, manifest.scope);
  assert.equal(darkManifest.name, manifest.name);
});

test('THEME_MANIFEST_LINKS are the two variant files under the document', () => {
  assert.deepEqual(THEME_MANIFEST_LINKS, {
    light: './manifest.webmanifest',
    dark: './manifest.dark.webmanifest',
  });
});

test('index.html keeps the light variant as the pre-JS default link target', () => {
  assert.match(
    html,
    /<link[^>]*rel=["']manifest["'][^>]*href=["']\.\/manifest\.webmanifest["']/,
    'enough. defaults to system mode; the static manifest must stay the light base',
  );
});

test('pre-paint bootstrap swaps the manifest link to the theme variant', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.ok(
    script.includes('link[rel="manifest"]'),
    'the inline script must own the manifest link before React mounts — a ' +
      'fresh install reads the manifest before any service worker is active',
  );
  assert.ok(
    script.includes('./manifest.dark.webmanifest') &&
      script.includes('./manifest.webmanifest'),
    'the bootstrap must know both variant URLs',
  );
  // The colour literals it applies must still be the two canvas colours.
  assert.ok(script.includes(darkCanvas) && script.includes(lightCanvas));
});

test('the worker special-cases the manifest BEFORE cacheFirstStatic can replay it', () => {
  const fetchHandler = workerPluginSource.slice(
    workerPluginSource.indexOf("self.addEventListener('fetch'"),
  );
  assert.ok(fetchHandler.length > 0, 'the generated worker has a fetch handler');
  const manifestBranch = fetchHandler.indexOf('isManifestRequest(url)');
  const staticBranch = fetchHandler.indexOf('isStaticAsset(url)');
  assert.ok(
    manifestBranch !== -1,
    'the worker must intercept manifest requests itself — a cached light ' +
      'manifest replayed to Chrome’s manifest re-read pins the installed ' +
      'bars to the wrong theme forever',
  );
  assert.ok(staticBranch !== -1, 'the static-asset branch still exists');
  assert.ok(
    manifestBranch < staticBranch,
    'the manifest branch must run before the generic static-asset branch',
  );
  const branch = fetchHandler.slice(manifestBranch, staticBranch);
  assert.ok(
    branch.includes('serveThemedManifest(request)'),
    'the manifest branch answers with the themed manifest handler',
  );
  assert.ok(
    !branch.includes('cacheFirstStatic'),
    'the manifest must not be served through cacheFirstStatic',
  );
});

test('the themed manifest is network-first with the raw precache as fallback', () => {
  const serve = workerPluginSource.slice(
    workerPluginSource.indexOf('async function serveThemedManifest'),
  );
  assert.ok(serve.length > 0, 'serveThemedManifest must exist');
  assert.ok(serve.includes('fetch(request)'), 'the raw body comes network-first');
  assert.ok(
    serve.includes('ignoreSearch: true'),
    'offline falls back to the precached raw copy',
  );
  assert.ok(
    serve.includes('themeManifestBody(body, theme)'),
    'every response is rewritten to the stored theme',
  );
});

test('the worker accepts only theme messages from known same-origin clients', () => {
  const message = workerPluginSource.slice(
    workerPluginSource.indexOf("self.addEventListener('message'"),
  );
  assert.ok(message.length > 0, 'the worker has a message handler');
  assert.ok(
    message.includes('data.type !== THEME_MESSAGE_TYPE'),
    'every other message type is ignored',
  );
  assert.ok(
    workerPluginSource.includes("const THEME_MESSAGE_TYPE = 'enough-theme'"),
    'the only accepted message type is the theme update',
  );
  assert.ok(
    message.includes("data.theme !== 'light' && data.theme !== 'dark'"),
    'the payload is validated to the two known values',
  );
  assert.ok(
    message.includes('event.origin !== self.location.origin'),
    'messages from any other origin are ignored',
  );
  assert.ok(
    message.includes('clients.matchAll'),
    'the sender must be one of this worker’s own window clients',
  );
});

test('the theme record survives a cache rotation (activate migration)', () => {
  const activate = workerPluginSource.slice(
    workerPluginSource.indexOf("self.addEventListener('activate'"),
    workerPluginSource.indexOf('function isNavigationRequest'),
  );
  assert.ok(
    activate.includes('THEME_RECORD_URL'),
    'without migration the first manifest fetch after every deploy would ' +
      'fall back to the raw file colours',
  );
});

test('render() swaps the manifest link href per theme', () => {
  delete navigatorStub.serviceWorker;
  applyMode('dark');
  assert.equal(manifestLink.getAttribute('href'), THEME_MANIFEST_LINKS.dark);
  applyMode('light');
  assert.equal(manifestLink.getAttribute('href'), THEME_MANIFEST_LINKS.light);
});

test('render() posts the effective theme to a controlling worker', async () => {
  const posted = [];
  navigatorStub.serviceWorker = {
    ready: Promise.resolve({
      active: { postMessage: (msg) => posted.push(msg) },
    }),
  };
  applyMode('dark');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posted.at(-1), { type: 'enough-theme', theme: 'dark' });
  applyMode('light');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posted.at(-1), { type: 'enough-theme', theme: 'light' });
  delete navigatorStub.serviceWorker;
});

test('render() no-ops without a service worker (tab mode, no throw)', () => {
  delete navigatorStub.serviceWorker;
  applyMode('dark'); // must not throw
  assert.ok(isDark(), 'the theme itself still applies');
});

test('render() no-ops when the worker API is unsupported (no throw)', () => {
  navigatorStub.serviceWorker = {}; // no `ready` promise at all
  applyMode('light'); // must not throw
  navigatorStub.serviceWorker = { ready: Promise.resolve({}) }; // no active worker
  applyMode('dark'); // must not throw either
  delete navigatorStub.serviceWorker;
});

test('render() survives a rejecting service-worker ready promise', async () => {
  navigatorStub.serviceWorker = {
    ready: Promise.reject(new Error('registration failed')),
  };
  applyMode('light'); // the .catch must swallow the rejection
  await new Promise((r) => setTimeout(r, 0));
  delete navigatorStub.serviceWorker;
});

/* ------------------------------------------------------------------ */
/* 6. The Appearance note about installed-app update timing           */
/* ------------------------------------------------------------------ */

const { translations } = await import('../../i18n/translations.ts');

test('the Appearance section explains the installed-app timing (EN + DE)', () => {
  for (const lang of ['en', 'de']) {
    const note = translations[lang].settingsScreen.appearanceInstalledHint;
    assert.ok(
      typeof note === 'string' && note.trim().length > 10,
      `settingsScreen.appearanceInstalledHint must exist in ${lang} — the ` +
        'installed bars only follow the theme after Chrome re-reads the ' +
        'manifest, and users need to know that',
    );
  }
});
