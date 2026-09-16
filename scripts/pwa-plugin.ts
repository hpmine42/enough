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

export function buildSwSource(opts: {
  cacheId: string;
  precache: string[];
  base: string;
  themeColors?: { light: string; dark: string };
}): string {
  // Paths in the SW are absolute from the origin and already include the
  // Vite base (e.g. "/enough/assets/index-….js").
  const precacheJson = JSON.stringify(opts.precache, null, 2);
  const baseJson = JSON.stringify(opts.base);
  const cacheIdJson = JSON.stringify(opts.cacheId);
  const swNameJson = JSON.stringify(SW_FILENAME);
  const themeColors = opts.themeColors ?? THEME_CHROME_COLORS;
  const themeLightJson = JSON.stringify(themeColors.light);
  const themeDarkJson = JSON.stringify(themeColors.dark);

  return `/* enough. service worker — generated at build time. Do not edit. */
/* eslint-disable no-restricted-globals */
const CACHE_ID = ${cacheIdJson};
const PRECACHE = ${precacheJson};
const BASE = ${baseJson};
const SW_NAME = ${swNameJson};
const THEME_LIGHT_COLOR = ${themeLightJson};
const THEME_DARK_COLOR = ${themeDarkJson};
const THEME_RECORD_URL = new URL('enough-theme.txt', self.location.origin + BASE).href;

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
      await Promise.all(
        keys
          .filter((key) => key.startsWith('enough-shell-') && key !== CACHE_ID)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// The worker stores a tiny theme record in Cache Storage (enough-theme.txt).
// It is set by the page via:
//   navigator.serviceWorker.ready.then(reg => reg.active.postMessage({ type: 'enough-theme', theme }))
// Privacy contract: same-origin only, never touch Supabase, ignore unknown clients.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type !== 'enough-theme') return;

  const theme = data.theme;
  if (theme !== 'light' && theme !== 'dark') return;

  if (event.origin && event.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      if (event.source && event.source.id) {
        if (self.clients && typeof self.clients.get === 'function') {
          const client = await self.clients.get(event.source.id);
          if (!client) return;
          try {
            const clientUrl = new URL(client.url);
            if (clientUrl.origin !== self.location.origin) return;
          } catch (_) {
            return;
          }
        }
      } else {
        return;
      }

      try {
        const cache = await caches.open(CACHE_ID);
        await cache.put(
          THEME_RECORD_URL,
          new Response(theme, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }),
        );
      } catch (_) {
        /* storage quota / cache put error */
      }
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

function isManifestRequest(url) {
  return (
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/manifest.dark.webmanifest')
  );
}

function isStaticAsset(url) {
  // Hashed Vite assets + icons + the SW itself (manifests are handled separately).
  if (url.pathname.includes('/assets/')) return true;
  if (/\\.(?:js|css|png|svg|ico|woff2?|ttf|map)$/i.test(url.pathname)) {
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

  if (isNavigationRequest(request)) {
    // App shell: network-first so deploys win; fall back to cached index.html
    // only when offline. Hash routing means every deep link is still index.html.
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isManifestRequest(url)) {
    // Manifest: network-first with dynamic chrome-colour rewriting to match the
    // active in-app theme. We do not use cacheFirstStatic here so Chrome never
    // receives a stale manifest on install or update.
    event.respondWith(networkFirstManifest(request, url));
    return;
  }

  if (isStaticAsset(url)) {
    // Immutable hashed assets: cache-first. Unhashed icons still
    // revalidate in the background.
    event.respondWith(cacheFirstStatic(request, event));
  }
});

function rewriteManifestColors(rawText, theme) {
  const color = theme === 'dark' ? THEME_DARK_COLOR : THEME_LIGHT_COLOR;
  // Replace only the first (top-level) occurrence of background_color and theme_color.
  // color_scheme_dark retains its standard values.
  return rawText
    .replace(
      /"background_color"\\s*:\\s*"#[0-9a-fA-F]{6}"/,
      \`"background_color": "\${color}"\`,
    )
    .replace(
      /"theme_color"\\s*:\\s*"#[0-9a-fA-F]{6}"/,
      \`"theme_color": "\${color}"\`,
    );
}

// We keep the raw manifest file in cache alongside the tiny theme record and rewrite
// the colours on every response rather than caching multiple rewritten variants.
// This guarantees that all other manifest members (id, scope, icons, name) remain
// byte-identical to the deployed build and cannot drift or become desynchronized.
async function networkFirstManifest(request, url) {
  const cache = await caches.open(CACHE_ID);

  let targetTheme = null;
  const paramTheme = url.searchParams.get('theme');
  if (paramTheme === 'dark' || paramTheme === 'light') {
    targetTheme = paramTheme;
  }

  if (!targetTheme) {
    try {
      const stored = await cache.match(THEME_RECORD_URL);
      if (stored) {
        const text = (await stored.text()).trim();
        if (text === 'dark' || text === 'light') {
          targetTheme = text;
        }
      }
    } catch (_) {}
  }

  if (!targetTheme) {
    targetTheme = url.pathname.endsWith('manifest.dark.webmanifest') ? 'dark' : 'light';
  }

  let rawText = null;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      rawText = await fresh.text();
      try {
        await cache.put(
          request,
          new Response(rawText, {
            headers: fresh.headers,
            status: fresh.status,
            statusText: fresh.statusText,
          }),
        );
      } catch (_) {}
    }
  } catch (_) {
    /* offline */
  }

  if (!rawText) {
    const fallbackUrls = [
      request,
      new URL('manifest.webmanifest', self.location.origin + BASE).href,
      new URL('manifest.dark.webmanifest', self.location.origin + BASE).href,
    ];
    for (const fb of fallbackUrls) {
      const cached =
        (await cache.match(fb, { ignoreSearch: false })) ||
        (await cache.match(fb, { ignoreSearch: true }));
      if (cached) {
        rawText = await cached.text();
        break;
      }
    }
  }

  if (rawText) {
    const rewritten = rewriteManifestColors(rawText, targetTheme);
    return new Response(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  return new Response('Manifest unavailable', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

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
    // Background revalidate for non-hashed assets (icons).
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
      // can assert a fresh worker was emitted.
      writeFileSync(
        join(absOut, 'sw-build.json'),
        `${JSON.stringify({ cacheId, base, precacheCount: urls.length }, null, 2)}\n`,
        'utf8',
      );
    },
  };
}
