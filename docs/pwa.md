# Progressive Web App — enough.

Date: 2026-08-18

## Goal

Make enough. installable as a mobile web app under the GitHub Pages base path
`/enough/`, without changing product features, routing, or Supabase behaviour.

## What was added

| File | Role |
|---|---|
| `public/manifest.webmanifest` + `public/manifest.dark.webmanifest` | Web App Manifest pair (`name`/`short_name` `enough.`, `display: standalone`, `orientation: portrait-primary`, relative `start_url`/`scope` `./`, per-scheme chrome colours). Byte-identical except `theme_color`/`background_color` — the dark variant exists so a fresh install already reads the right colours before any service worker is active |
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
- **Unhashed icons:** cache-first with background revalidate.
- **Manifest:** served by a dedicated themed handler (see below) — never by
  the cache-first static path, so a cached copy of the wrong theme cannot be
  replayed to Chromium's manifest re-read.
- **Theme record:** one tiny Cache Storage entry (`theme.txt` in the
  `enough-shell-*` cache) holding the effective theme. Presentation
  preference only — never sent anywhere, never part of an auth or trust
  decision. Migrated into the new cache on every rotation.
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
| Theme-aware manifest: the variant pair + the service worker's themed manifest responses (below) | the installed app's status bar and gesture-bar band on Chrome/Android, task-switcher tile, splash screen | in-app theme |
| Two `meta[name="theme-color"]`, one per scheme, both re-pinned before first paint (`index.html`) and on every theme change (`src/lib/theme.ts`) | Chrome/Edge tab and toolbar tint in *tab* mode. **Not** a usable channel inside an installed Android window: there the bar colour comes from the manifest, not the document (crbug 40759522 / 40686953 / 40634649) — `npm run smoke` proves both metas are set correctly while the bands stayed the manifest colour on the reporter's device | in-app theme |
| `meta[name="color-scheme"]`, narrowed to the *used* scheme | status-bar icons, form controls, find-in-page bar | in-app theme |

`<html>` must be painted explicitly: an unpainted root element leaves that
region on the UA default light canvas, which is exactly the pale band above an
otherwise dark app.

### The theme-aware manifest (installed Chrome/Android)

The manifest is the only channel that can carry the *in-app* theme into an
installed Chromium window's system bars (`meta[name="theme-color"]` does not
reach it there, and `color_scheme_dark` only answers to the *operating
system* scheme — which never triggers for the reported configuration: OS
light, app explicitly dark). `enough.` makes the manifest theme-aware on
three legs:

1. **Variant pair.** `public/manifest.dark.webmanifest` is byte-identical to
   `public/manifest.webmanifest` except `theme_color`/`background_color` —
   `id`, `scope`, icons and every other member stay put, otherwise Chromium
   would see a different app and create a second install entry. The page
   points `link[rel="manifest"]` at the theme's variant before first paint
   (`index.html` inline bootstrap) and on every change
   (`render()` in `src/lib/theme.ts`), so a fresh install and every Chromium
   manifest re-read already fetch the right file without any worker.
2. **Service-worker themed responses.** The worker intercepts every
   `*.webmanifest` request *before* the static-asset branch and answers
   network-first with the two chrome colours rewritten to the stored theme.
   The raw file (network, then precache offline) stays the single source of
   truth for the manifest body; the rewritten copy is deliberately *not*
   cached, so nothing stale can be replayed to Chrome's manifest re-read.
3. **Theme record.** The page posts `{ type: 'enough-theme', theme }` to the
   worker on every change (`navigator.serviceWorker.ready` → active worker);
   the worker stores it as a tiny `theme.txt` response in the
   `enough-shell-*` cache and migrates it across cache rotations on
   activate. The message handler accepts nothing else and only from this
   origin's own window clients (`event.origin` + `clients.matchAll` check).
   The record is a presentation preference only — it is never sent anywhere
   and never feeds an auth or trust decision.

`color_scheme_dark` stays in both files: it is the standard mechanism (W3C
manifest #1207), serves as the no-service-worker fallback for browsers that
implement it, and is ignored elsewhere. The light base stays the file
default because `enough.` defaults to `system` mode, so light is the correct
no-preference answer.

Remaining platform timing limitation: WebAPK metadata is frozen at install
time and refreshed by Chrome's app-update job, so an existing install's bars
may follow a theme change only after that update or a reinstall. The
Appearance settings note says so (i18n, EN + DE).

### Probe history

- **2026-09 (this change).** A build-level probe set the base manifest's
  `theme_color`/`background_color` to `#171614` and verified the value
  reaches `dist/` (and hence the Pages artifact) unmodified. The
  device-level half of the probe — does an installed app on **OS-light
  Android** repaint its bands from a dark manifest — could not be measured
  in this session: it needs a physical Android device, and Pages deploys
  only from `main`. The channel conclusion therefore rests on the evidence
  from PR #121's reporter screenshot (Samsung/OneUI, installed standalone
  app, OS light, app dark): the bands were exactly `#F7F5F0` — the manifest
  `theme_color` — while the runtime metas were proven correct by
  `npm run smoke`; i.e. Chromium paints the installed bars from the
  manifest, not the document. **Open:** confirm on a device (device /
  Android / Chrome version, reinstall vs. app-update) and tick the
  checklist items below.

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
- [ ] Manual (probe): Android, **OS light / app dark** — top and gesture-bar
  bands read `#171614` after a fresh install; note device, Android and Chrome
  version
- [ ] Manual (probe): Android, **OS dark / app light** — bands read `#F7F5F0`
- [ ] Manual (probe): for an *existing* install, note whether the bands
  followed a theme change immediately, after Chrome's app update, or only
  after a reinstall
