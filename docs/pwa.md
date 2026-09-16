# Progressive Web App — enough.

Date: 2026-08-18

## Goal

Make enough. installable as a mobile web app under the GitHub Pages base path
`/enough/`, without changing product features, routing, or Supabase behaviour.

## What was added

| File | Role |
|---|---|
| `public/manifest.webmanifest` | Web App Manifest (`name`/`short_name` `enough.`, `display: standalone`, `orientation: portrait-primary`, relative `start_url`/`scope` `./`, per-scheme chrome colours) |
| `src/lib/__tests__/pwa-chrome-color.test.mjs` | Regression guard that the four chrome-colour channels agree (`npm run test:pwachrome`) |
| `public/icons/*` | 192/512 any-purpose icons, 512 maskable, Apple touch icon, favicons, SVG mark |
| `public/favicon.ico` | Multi-size favicon |
| `scripts/pwa-plugin.ts` | Vite plugin — emits content-hashed `dist/sw.js` + `sw-build.json` after each production build |
| `src/lib/pwa.ts` | Production-only service-worker registration, update checks, one-shot reload on controller swap |
| `index.html` | Manifest + icon + apple-mobile-web-app meta tags; dual `theme-color`; pre-paint theme + used-scheme bootstrap |
| `src/lib/theme.ts` | Syncs every `theme-color` meta and the used `color-scheme` with light/dark |
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
- **Unhashed icons/manifest:** cache-first with background revalidate.
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
| `theme_color` + `background_color`, with `color_scheme_dark` overrides (`public/manifest.webmanifest`) | install-time theme colour, task-switcher tile, splash screen | OS scheme |

`<html>` must be painted explicitly: an unpainted root element leaves that
region on the UA default light canvas, which is exactly the pale band above an
otherwise dark app.

Known platform limitation: a manifest holds one colour per **operating-system**
scheme, not per in-app theme, and Chrome/Android still applies the install-time
value to the standalone status bar. An install that explicitly selects dark
while the OS stays light can therefore keep a light strip on that platform until
`color_scheme_dark` (W3C manifest #1207) ships there. Everything inside the
window already follows the theme. A changed manifest reaches existing installs
on the next app update; a fresh install picks it up immediately.

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
