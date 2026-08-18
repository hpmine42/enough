# Progressive Web App — enough.

Date: 2026-08-18

## Goal

Make enough. installable as a mobile web app under the GitHub Pages base path
`/enough/`, without changing product features, routing, or Supabase behaviour.

## What was added

| File | Role |
|---|---|
| `public/manifest.webmanifest` | Web App Manifest (`name`/`short_name` `enough.`, `display: standalone`, `orientation: portrait-primary`, relative `start_url`/`scope` `./`) |
| `public/icons/*` | 192/512 any-purpose icons, 512 maskable, Apple touch icon, favicons, SVG mark |
| `public/favicon.ico` | Multi-size favicon |
| `scripts/pwa-plugin.ts` | Vite plugin — emits content-hashed `dist/sw.js` + `sw-build.json` after each production build |
| `src/lib/pwa.ts` | Production-only service-worker registration, update checks, one-shot reload on controller swap |
| `index.html` | Manifest + icon + apple-mobile-web-app meta tags; dual `theme-color` |
| `src/lib/theme.ts` | Syncs every `theme-color` meta with light/dark |
| `src/index.css` | Standalone display-mode polish (edge-to-edge, overscroll lock) |
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
