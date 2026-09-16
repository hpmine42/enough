# Progressive Web App — enough.

Date: 2026-08-18

## Goal

Make enough. installable as a mobile web app under the GitHub Pages base path
`/enough/`, without changing product features, routing, or Supabase behaviour.

## What was added

| File | Role |
|---|---|
| `public/manifest.webmanifest` | Web App Manifest for light mode (`name`/`short_name` `enough.`, `display: standalone`, `orientation: portrait-primary`, relative `start_url`/`scope` `./`, light chrome colours with `color_scheme_dark`) |
| `public/manifest.dark.webmanifest` | Web App Manifest for dark mode (byte-identical metadata, `id: "./"`, dark chrome colours) |
| `src/lib/__tests__/pwa-chrome-color.test.mjs` | Regression guard that the four chrome-colour channels agree, manifest variants match, SW intercepts manifest, and runtime syncs (`npm run test:pwachrome`) |
| `public/icons/*` | 192/512 any-purpose icons, 512 maskable, Apple touch icon, favicons, SVG mark |
| `public/favicon.ico` | Multi-size favicon |
| `scripts/pwa-plugin.ts` | Vite plugin — emits content-hashed `dist/sw.js` + `sw-build.json` after each production build, with dynamic theme-aware manifest rewriting |
| `src/lib/pwa.ts` | Production-only service-worker registration, update checks, one-shot reload on controller swap |
| `index.html` | Manifest + icon + apple-mobile-web-app meta tags; dual `theme-color`; pre-paint theme + manifest variant + used-scheme bootstrap |
| `src/lib/theme.ts` | Syncs every `theme-color` meta, manifest link variant, service-worker theme record, and the used `color-scheme` with light/dark |
| `src/index.css` | Standalone display-mode polish (edge-to-edge, overscroll lock); canvas token painted on `<html>`/`<body>`/`#root` so the cutout strip follows the theme |
| `vite.config.ts` | Registers `enoughPwa()` |
| `src/main.tsx` | Calls `registerServiceWorker()` |

## Caching strategy

- **In scope:** same-origin static app shell under the Vite base
  (`index.html`, hashed `/assets/*`, icons, manifest).
- **Out of scope:** any cross-origin request — Supabase Auth, REST, Realtime
  (`wss`), storage. Chat payloads and session tokens are never written to
  Cache Storage by the service worker.
- **Navigation:** network-first, offline fallback to precached `index.html`
  (hash router still works for deep links).
- **Hashed assets:** cache-first (immutable filenames).
- **Unhashed icons:** cache-first with background revalidate.
- **Manifest:** network-first with dynamic in-memory chrome-colour rewriting
  against the active in-app theme stored in `enough-theme.txt`; precached raw
  variants provide offline fallback.
- **Deploy freshness:** cache name is `enough-shell-<content-hash>`; install
  calls `skipWaiting()`, activate deletes previous `enough-shell-*` caches and
  `clients.claim()`. The page soft-reloads once on a post-install controller
  change so a deploy cannot pin a stale in-memory bundle.

## Chrome colours (status bar, splash, cutout strip)

The platform draws a strip around the display cutout / status bar and a splash
screen, and neither reads the app stylesheet. `enough.` therefore declares the
canvas colour on four channels, all pinned to the same two values
(`#F7F5F0` light / `#171614` dark) by
`src/lib/__tests__/pwa-chrome-color.test.mjs` (`npm run test:pwachrome`):

| Channel | What it colours | Follows |
| --- | --- | --- |
| `background: var(--bg)` on `<html>`, `<body>` **and** `#root` (`src/index.css`) | the strip iOS 26+ draws around the cutout — it ignores `meta name="theme-color"` in a standalone window and reads the root element's background instead; also the overscroll canvas | in-app theme |
| `meta[name="theme-color"]` × 2, one per scheme, both re-pinned before first paint (`index.html`) and on every theme change (`src/lib/theme.ts`) | Chrome/Edge tab, toolbar and installed-window tint | in-app theme |
| `meta[name="color-scheme"]`, narrowed to the *used* scheme | status-bar icons, form controls, find-in-page bar | in-app theme |
| `theme_color` + `background_color` (`manifest.webmanifest`, `manifest.dark.webmanifest`, dynamic SW response, with `color_scheme_dark` overrides) | install-time theme colour, WebAPK status bar and navigation bar on Android, task-switcher tile, splash screen | in-app theme (fresh install; existing install after app update) |

`<html>` must be painted explicitly: an unpainted root element leaves that
region on the UA default light canvas, which is exactly the pale band above an
otherwise dark app.

### Android / Chromium WebAPK behaviour

Chrome on Android compiles standalone PWAs into WebAPKs at install time. Inside a
standalone WebAPK window, Chromium ignores runtime `meta[name="theme-color"]` DOM
mutations for system bars (crbug 40759522 / 40686953 / 40634649) and paints the
status bar and gesture navigation bar strictly from the manifest metadata.
Furthermore, the standard `color_scheme_dark` member keys off the *operating system*
preference, which fails to take effect when the user configures the device in light mode
but explicitly selects dark mode inside the app (e.g. on Samsung OneUI / Android 14+).

To ensure system chrome matches the in-app theme across all configurations:
1. **Initial install:** `index.html` inline pre-paint bootstrap swaps the
   `<link rel="manifest">` href between `./manifest.webmanifest` and
   `./manifest.dark.webmanifest` before React mounts. Fresh installs immediately
   receive the active theme colours. Both files share identical `id: "./"`,
   `scope`, `start_url`, and icons so Chromium does not treat them as separate apps.
2. **Runtime sync & background updates:** `src/lib/theme.ts` updates `link[rel="manifest"]`
   on every theme change and sends `{ type: 'enough-theme', theme }` to the service
   worker. The worker saves the theme in `enough-theme.txt` inside the shell cache.
3. **Dynamic manifest rewriting:** The service worker intercepts manifest fetches
   before static asset checks. It uses network-first retrieval (falling back to the
   precached raw manifest offline) and dynamically replaces the top-level
   `theme_color` and `background_color` with the active theme colours.

**App update latency note:** Chromium WebAPKs freeze manifest metadata into the
Android package upon installation and refresh it via Chrome's periodic background
app-update task (or on reinstall). On an existing install, system bars follow the
new theme once Chromium performs its background manifest re-read or when the app is
reinstalled.

### Edge-to-edge research (status bar underlay)

Chromium issue 407420295 (and related Gerrit changes) track edge-to-edge rendering
with short-edges cutout mode for installed WebApps/PWAs. In current stable Chrome on
Android, standalone PWAs (`display: standalone`) draw within a viewport bounded below
the status bar unless using `display: fullscreen` (which hides the clock). `enough.`
already pads `env(safe-area-inset-top)` in `.home-screen`, `.chat-screen`,
`.settings-*` and `.legal-header`, and paints `<html>`, so as soon as Chromium
ships edge-to-edge status bar pass-through for standalone apps, the UI will blend
seamlessly without additional layout work.

## Base path

- Deploy workflow sets `VITE_BASE=/enough/`.
- Manifest paths are relative (`./`, `icons/…`) so resolution is correct both
  at `https://<user>.github.io/enough/` and at a local `/` preview.
- The service worker is registered with `scope: import.meta.env.BASE_URL` and
  only handles fetches under that prefix.

## Explicit non-goals

- No push notifications.
- No notification permission prompts.
- No offline chat / offline-first message queue.
- No change to hash routing, auth flows, or Supabase client configuration.

## Verification checklist

- [x] `npm run build` with `VITE_BASE=/enough/` succeeds
- [x] `dist/manifest.webmanifest` present with correct fields
- [x] `dist/sw.js` precaches only `/enough/…` static URLs
- [x] `dist/sw.js` does not intercept Supabase hosts
- [x] `npm run smoke` (existing UI smoke + recovery) passes
- [x] TypeScript (`tsc --noEmit`) clean
- [ ] Manual: Chrome/Android “Install app” on `/enough/`
- [ ] Manual: iOS Safari “Add to Home Screen”
- [ ] Manual: Login / Register / Chat / Settings / Logout / deep-link reload
  inside the installed standalone window
- [ ] Manual: status bar, splash screen and cutout strip match the app canvas in
  each mode (light, dark, system) inside the installed window — the chrome
  colours are a platform-drawn surface and no test in this repository can read
  those pixels
