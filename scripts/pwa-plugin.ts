/**
 * Minimal Vite plugin that emits a production service worker with a
 * content-hashed precache of the built app shell.
 *
 * Design goals for enough.:
 * - Cache only same-origin static assets (HTML/JS/CSS/icons/manifest).
 * - Never touch Supabase / cross-origin traffic (auth + chat stay online).
 * - Bust stale caches on every deploy via a build-id derived from assets.
 * - Activate new workers immediately (skipWaiting + clients.claim) so a
 *   deploy cannot pin users on an obsolete shell forever.
 */
import type { Plugin, ResolvedConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import { THEME_CHROME_COLORS } from '../src/lib/theme.ts';

const SW_FILENAME = 'sw.js';

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

function buildSwSource(opts: {
  cacheId: string;
  precache: string[];
  base: string;
}): string {
  // Paths in the SW are absolute from the origin and already include the
  // Vite base (e.g. "/enough/assets/index-….js").
  const precacheJson = JSON.stringify(opts.precache, null, 2);
  const baseJson = JSON.stringify(opts.base);
  const cacheIdJson = JSON.stringify(opts.cacheId);
  const swNameJson = JSON.stringify(SW_FILENAME);
  // The two canvas colours are injected from THEME_CHROME_COLORS so the
  // worker can never drift from the stylesheet (single source of truth;
  // pinned by `npm run test:pwachrome`).
  const lightCanvasJson = JSON.stringify(THEME_CHROME_COLORS.light);
  const darkCanvasJson = JSON.stringify(THEME_CHROME_COLORS.dark);

  return `/* enough. service worker — generated at build time. Do not edit. */
/* eslint-disable no-restricted-globals */
const CACHE_ID = ${cacheIdJson};
const PRECACHE = ${precacheJson};
const BASE = ${baseJson};
const SW_NAME = ${swNameJson};

// The app canvas per theme, injected from THEME_CHROME_COLORS in
// src/lib/theme.ts at build time. An installed app on Chrome/Android paints
// its status bar and gesture-bar band from the MANIFEST document — the
// runtime metas never reach an installed window — so this worker rewrites
// that document to the stored in-app theme on every manifest fetch.
const LIGHT_CANVAS = ${lightCanvasJson};
const DARK_CANVAS = ${darkCanvasJson};

// The page's effective theme, written by the message handler below as a tiny
// Cache Storage entry next to the app shell. It is a presentation preference
// only: it is never sent anywhere, never leaves this origin, and never feeds
// an authentication or trust decision.
const THEME_RECORD_URL = new URL('theme.txt', self.location.origin + BASE).href;
const THEME_MESSAGE_TYPE = 'enough-theme';

// Only same-origin GETs for static app-shell assets are eligible for caching.
// Supabase Auth, REST, Realtime (wss) and any other cross-origin traffic is
// intentionally left alone so chat data and tokens never land in Cache Storage.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_ID);
      // addAll fails the whole install if one URL 404s; add individually so a
      // missing optional asset cannot brick updates.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok) await cache.put(url, res);
          } catch (_) {
            /* offline during install — skip */
          }
        }),
      );
      // Take over as soon as possible so the next navigation sees the new shell.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter(
        (key) => key.startsWith('enough-shell-') && key !== CACHE_ID,
      );
      // The theme record must survive the cache rotation: otherwise the
      // first manifest fetch after every deploy would be answered with the
      // raw file colours until the page posts its theme again. Copy it into
      // the new cache before the old ones are deleted.
      const cache = await caches.open(CACHE_ID);
      if (!(await cache.match(THEME_RECORD_URL))) {
        for (const key of stale) {
          const oldCache = await caches.open(key);
          const record = await oldCache.match(THEME_RECORD_URL);
          if (record) {
            await cache.put(THEME_RECORD_URL, record.clone());
            break;
          }
        }
      }
      await Promise.all(stale.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept') &&
      request.headers.get('accept').includes('text/html'))
  );
}

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function underScope(url) {
  // BASE is "/" or "/enough/". Anything outside the app scope is ignored.
  if (BASE === '/') return true;
  return url.pathname === BASE.slice(0, -1) || url.pathname.startsWith(BASE);
}

function isStaticAsset(url) {
  // Hashed Vite assets + icons + manifest + the SW itself.
  if (url.pathname.includes('/assets/')) return true;
  if (/\\.(?:js|css|png|svg|ico|webmanifest|woff2?|ttf|map)$/i.test(url.pathname)) {
    return true;
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // Cross-origin (Supabase REST/Auth/Storage/Realtime upgrade): network only.
  if (!sameOrigin(url)) return;

  // Outside this app's GitHub Pages subpath: ignore.
  if (!underScope(url)) return;

  // Never cache the service worker script itself through the SW.
  if (url.pathname.endsWith('/' + SW_NAME) || url.pathname.endsWith(SW_NAME)) {
    return;
  }

  // Installed-app chrome: an installed Chromium window paints its status bar
  // and gesture-bar band from the manifest document, not from the document
  // metas (crbug 40759522 / 40686953 / 40634649). Answer every manifest
  // request from the stored in-app theme BEFORE the generic static-asset
  // branch — a cache-first replay of a light copy would pin the installed
  // bars to the wrong theme forever.
  if (isManifestRequest(url)) {
    event.respondWith(serveThemedManifest(request));
    return;
  }

  if (isNavigationRequest(request)) {
    // App shell: network-first so deploys win; fall back to cached index.html
    // only when offline. Hash routing means every deep link is still index.html.
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    // Immutable hashed assets: cache-first. Unhashed icons/manifest still
    // revalidate in the background.
    event.respondWith(cacheFirstStatic(request, event));
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_ID);
  const indexUrl = new URL('index.html', self.location.origin + BASE).href;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      // Keep a fresh copy of the shell for offline fallback.
      try {
        await cache.put(indexUrl, fresh.clone());
      } catch (_) {
        /* ignore quota errors */
      }
      return fresh;
    }
  } catch (_) {
    /* offline */
  }
  const cached =
    (await cache.match(request, { ignoreSearch: true })) ||
    (await cache.match(indexUrl, { ignoreSearch: true })) ||
    (await cache.match(BASE, { ignoreSearch: true }));
  if (cached) return cached;
  return new Response('enough. is offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function cacheFirstStatic(request, event) {
  const cache = await caches.open(CACHE_ID);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) {
    // Background revalidate for non-hashed assets (icons, manifest).
    const url = new URL(request.url);
    if (!url.pathname.includes('/assets/') && event && event.waitUntil) {
      event.waitUntil(revalidate(cache, request));
    }
    return cached;
  }
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      try {
        await cache.put(request, fresh.clone());
      } catch (_) {
        /* ignore */
      }
    }
    return fresh;
  } catch (err) {
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    throw err;
  }
}

async function revalidate(cache, request) {
  try {
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (fresh && fresh.ok) await cache.put(request, fresh.clone());
  } catch (_) {
    /* offline */
  }
}

/* ----- themed manifest (installed-app chrome colours) --------------- */

function isManifestRequest(url) {
  return url.pathname.endsWith('.webmanifest');
}

async function readThemeRecord() {
  try {
    const cache = await caches.open(CACHE_ID);
    const record = await cache.match(THEME_RECORD_URL);
    if (!record) return null;
    const value = (await record.text()).trim();
    return value === 'dark' || value === 'light' ? value : null;
  } catch (_) {
    return null;
  }
}

function themeManifestBody(body, theme) {
  // Collapse BOTH colour constants onto the theme's canvas so the response
  // follows the in-app theme no matter which variant file the raw copy came
  // from and what its color_scheme_dark block declares. With no stored theme
  // (before the first page load ever posted one) the raw copy is served
  // unchanged — still correct, because the page points the manifest link at
  // the theme's variant file from before first paint.
  if (theme === 'dark') return body.split(LIGHT_CANVAS).join(DARK_CANVAS);
  if (theme === 'light') return body.split(DARK_CANVAS).join(LIGHT_CANVAS);
  return body;
}

async function serveThemedManifest(request) {
  const cache = await caches.open(CACHE_ID);
  const theme = await readThemeRecord();

  // Strategy: keep the RAW file — precached at install, refreshed
  // network-first here — as the single source of truth for icons, scope and
  // id, and rewrite the two chrome colours from the theme record on EVERY
  // response. The rewritten copy is deliberately never cached: cache entries
  // keyed by theme would have to be invalidated on every deploy, and one
  // forgotten entry would replay stale colours to Chrome's manifest re-read.
  let body = null;
  try {
    // Network-first: a deploy may have changed the manifest body, and the
    // installed app's manifest re-read must not receive a stale copy while
    // the network is reachable.
    const fresh = await fetch(request);
    if (fresh && fresh.ok) body = await fresh.text();
  } catch (_) {
    /* offline — fall back to the precached raw copy below */
  }
  if (body === null) {
    const raw =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(
        new URL('manifest.webmanifest', self.location.origin + BASE).href,
      ));
    if (raw) body = await raw.text();
  }
  if (body === null) {
    // Nothing precached yet (worker racing its own install): pass through.
    return fetch(request);
  }

  return new Response(themeManifestBody(body, theme), {
    status: 200,
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}

// The only message this worker accepts is the page's effective theme, and
// only from this origin's own window clients: a foreign source cannot set
// even a presentation preference here. Everything else is ignored.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== THEME_MESSAGE_TYPE) return;
  if (data.theme !== 'light' && data.theme !== 'dark') return;
  if (event.origin !== self.location.origin) return;
  const source = event.source;
  if (!source || typeof source.id !== 'string') return;
  event.waitUntil(
    (async () => {
      const known = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      if (!known.some((client) => client.id === source.id)) return;
      const cache = await caches.open(CACHE_ID);
      await cache.put(THEME_RECORD_URL, new Response(data.theme));
    })(),
  );
});
`;
}

export function enoughPwa(): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'enough-pwa',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      const outDir = config.build.outDir;
      const absOut = join(config.root, outDir);
      const base = config.base.endsWith('/') ? config.base : `${config.base}/`;

      let files: string[] = [];
      try {
        files = listFiles(absOut);
      } catch {
        return;
      }

      // Precache the app shell only — never anything that looks like API data.
      const include = files.filter((f) => {
        if (f === SW_FILENAME) return false;
        if (f === 'sw-build.json') return false;
        if (f.endsWith('.map')) return false;
        return (
          f === 'index.html' ||
          f.endsWith('.js') ||
          f.endsWith('.css') ||
          f.endsWith('.png') ||
          f.endsWith('.svg') ||
          f.endsWith('.ico') ||
          f.endsWith('.webmanifest') ||
          f.endsWith('.woff') ||
          f.endsWith('.woff2') ||
          f.endsWith('.ttf')
        );
      });

      const urls = include.map((f) => {
        // posix.join collapses leading "/" of base when given absolute-ish paths;
        // build manually so "/enough/" + "index.html" → "/enough/index.html".
        const cleaned = f.replace(/^\/+/, '');
        return `${base}${cleaned}`;
      });

      // Ensure index.html is always in the precache for offline navigation.
      const indexUrl = `${base}index.html`;
      if (!urls.includes(indexUrl)) urls.unshift(indexUrl);

      const hash = createHash('sha256');
      hash.update(urls.join('\n'));
      for (const f of include) {
        try {
          hash.update(readFileSync(join(absOut, f)));
        } catch {
          /* skip */
        }
      }
      const cacheId = `enough-shell-${hash.digest('hex').slice(0, 12)}`;
      const source = buildSwSource({ cacheId, precache: urls, base });
      writeFileSync(join(absOut, SW_FILENAME), source, 'utf8');

      // Mirror a tiny build stamp next to the SW so diagnostics / smoke tests
      // can assert a fresh worker was emitted and see the precache list.
      writeFileSync(
        join(absOut, 'sw-build.json'),
        `${JSON.stringify(
          { cacheId, base, precacheCount: urls.length, precache: urls },
          null,
          2,
        )}\n`,
        'utf8',
      );
    },
  };
}
