# enough.

A deliberately minimal, one-to-one text messenger. Register, pick a username,
find another `@username`, send a connection request, and chat.

> **Less, but enough.**

Current release: **v0.5.0** — the UX/UI redesign milestone ("Quiet Modern").
Every v0.4.0 feature remains functional; the release before it was the
privacy, reliability, security/recovery and release-foundation milestone.
Release history lives in [`CHANGELOG.md`](CHANGELOG.md).

## Stack

- Vite + React + TypeScript
- Supabase (Auth, Postgres, Realtime) — the backend exists separately and is
  **not** part of this repository; schema changes are delivered as SQL in
  [`supabase/migrations/`](supabase/migrations/)
- `@getmaapp/signal-wasm@0.6.6` — Signal Protocol (PQXDH + Double Ratchet)
  engine for 1:1 peer conversations. The wrapper is AGPL-3.0-only; its use in
  enough. was explicitly approved by the project owner.

## Design references

The `design/` directory contains the original visual mockups
(`login.html`, `home.html`, `chat.html`). They document the pre-v0.5.0
appearance and are kept as a historical reference — the production UI is the
redesigned one, defined by the design tokens and components in
[`src/index.css`](src/index.css). The mockups should not be modified or turned
into the app.

## Features (v0.5.0)

New in v0.5.0 — a full UX/UI redesign. It is a presentation-layer change:
authentication, Supabase/RLS, Realtime, E2EE, Offline Read Mode and every
existing flow are unchanged.

- **"Quiet Modern" design system** in `src/index.css`: one token set
  (colour, type, spacing, radii, borders, elevation) consumed by every
  component, so light/dark/system, focus states and the responsive rules stay
  consistent. Warm cream light mode (`#F7F5F0` canvas, `#FCFBF8` surfaces,
  anthracite text), soft warm dark mode (`#171614`), one restrained muted-green
  accent, subtle hairline borders and almost no shadows
- **Primary bottom navigation** — Chats | New chat | Settings — shown on the
  chat overview, the dedicated people-search screen and the Settings overview,
  using the existing hash routing. "New chat" opens the dedicated people-search
  screen (route `#/new-chat`, the same real search/connection-request flow as
  before, just its own first-class destination) and focuses the field.
  It is a **persistent top-level layer**: a fixed sibling of the app content
  and the Settings overlay, never a child of either, so screens and overlays
  animate underneath a bar that stays anchored to the viewport. A calm floating
  surface (warm card, hairline border, one soft shadow) with a quiet accent
  tint for the active destination — tapping changes colour only, never
  geometry: no font-weight reflow, no transform, the bar stays on the same
  pixel line
- **Chat overview**: a calm hairline-separated list instead of card-like rows,
  subtler unread state (tinted count, slightly stronger name), and an empty
  state that offers the real "Search people" action
- **Chat**: refined bubbles and composer, a quiet, icon-only end-to-end
  encryption marker in the header for peer conversations (a small labelled
  lock that never competes with the contact name for space) that disappears
  when the engine fails (the explicit recovery notice then carries the
  state), and unchanged long-press, deletion, recovery and offline behaviour
- **People search**: moved out of Settings to its own dedicated screen
  ("New chat" in the bottom navigation, route `#/new-chat`) — the same real
  search, connection-request and block-aware behaviour, now a first-class
  destination with the input focused on arrival
- **Settings**: the overview is grouped into Account / Preferences / Security /
  About with a centered header title matching its subpages. All categories,
  subpages, routes and actions are unchanged except that the user-search field
  no longer lives here
- **Authentication screens**: clearer hierarchy with the brand tagline, larger
  input surfaces, accent focus rings and tinted error surfaces. Validation,
  email confirmation, recovery and routing are unchanged

## Features (v0.4.0)

New in v0.4.0 (v0.3.0 features below remain):

- Visible E2EE state: an initializing / ready / failed lifecycle with a
  non-sensitive reason, a retry action, and a fail-closed composer — a failed
  engine is announced instead of silently emptying every peer bubble, and no
  peer message is ever sent or stored as plaintext while encryption is
  unavailable
- Identity reset / recovery: a changed peer identity (TOFU mismatch) offers an
  explicit, user-confirmed security reset for that one conversation (clears
  trust + session for that peer only; past unreadable messages stay
  unreadable), and a damaged local device state offers a confirmed reset that
  mints and publishes a fresh local identity (public keys only)
- Offline Read Mode: the cached Home overview and the last 40 messages of an
  opened chat stay readable while offline (sealed local snapshots, offline
  banner). No offline send queue — sending stays disabled while offline
- Realtime for the open 1:1 chat (delivery, tombstones, reconciliation),
  incremental Home realtime updates, and the F-01…F-07 race-condition fixes
  (conversation-switch guards, realtime captured during load/pagination,
  duplicate badge counting, cache persistence failures)
- Long-press action menu on Home/chat rows: block / unblock (with
  confirmation) and delete chat for me; blocked users see a locked composer
- People management in Settings: active connections with actions,
  blocked-users hierarchy (`#/settings/people/blocked`) — the search that
  shipped here in v0.4.0 moved to the dedicated "New chat" screen in v0.5.0
- Privacy policy (EN/DE) at `#/privacy` / `#/datenschutz`, rewritten against
  the actual app behavior, linked from every unauthenticated screen (before
  registration); imprint with two equal-ranking surfaces; contact form
  delivered through the `send-contact-email` Edge Function with a deploy +
  end-to-end CI workflow
- License: AGPL-3.0-only (`LICENSE` + `NOTICE`), the same license document
  served at `/LICENSE` on every deployment, guarded by `test:license`
- CI on pull requests: the full gate (signal-wasm verification, build, every
  `test:*` suite, smoke) runs on every PR with no secrets, so fork PRs are
  safe

### Features carried over from v0.3.0

- Auth: login, registration (email, `@username`, display name, password × 2),
  email confirmation, forgot/reset password, email change, persistent sessions,
  self-service account deletion (frees the username; other participants keep the
  chat and are told the account was deleted)
- Localization: English (default) and German; auth screens have an EN/DE switch,
  Settings has the full language control; no page reload on switch
- Theme: Light / Dark / System (default), persisted, no flash of the wrong theme
- Minimal Home: logo, theme toggle, two-line chat rows (display name
  with inline `@username` or My Notes tag, preview + unread badge), relative
  timestamps, 44 px avatars with a clear gap from the text. Settings is
  reached from the bottom navigation since v0.5.0 (it was a header icon)
- Settings as a full-screen slide-in with a grouped category overview
  (Account / Preferences / Security / About) and subpages:
  Profile, People (blocked-users count, with `#/settings/blocked` as a
  third-level page), Language, Appearance, Chat preferences (Enter to send,
  My Notes), Account (email/password change, sign out, delete account), plus a
  version / imprint / GitHub footer
- Connections: live search, requests with accept / decline (custom dialog) /
  cancel, 14-day expiration enforced by the database, re-request after decline
  (works in both directions via the `send_connection_request` RPC)
- Blocking: decline-and-block on incoming requests, block from an open chat,
  blocked-users management in Settings, block-aware search and request flows,
  disabled composer while blocked — all enforced in the database (RLS +
  triggers + RPCs), never only in the UI
- Chat: grouped bubbles, compact timestamps, long-press bottom sheet
  (copy / delete for me / delete for everyone within 24 h), per-user chat
  deletion, display-name change events, My Notes self-chat
- Safe markdown in message bodies (headings, lists, quotes, fenced/inline code,
  bold/italic/strikethrough, http(s)/mailto links). HTML in messages is never
  interpreted
- Opening a chat lands on the newest message. Initial anchoring waits for the
  rendered tail (including async E2EE plaintext) and stops as soon as the user
  scrolls
- Home previews of deleted messages name the deletion actor — "You deleted
  this message" for own deletions (including a peer message hidden with
  "delete for me"), "@peer deleted this message" for peer delete-for-everyone
  tombstones (only the sender can delete for everyone, enforced by RLS;
  "delete for me" hides the row only for the deleting user)
- Read state: monotonic per user, survives reloads. Scrolling up never creates
  unread. Leaving a chat marks messages already present in that session as
  read; only messages that arrive afterwards raise the Home badge. `↓ N`
  scroll-down button with a light-mode contrast ring over sent bubbles
- Pagination with stable scroll position; Realtime for new messages,
  deletions, connection and profile changes
- Accessibility: semantic controls, focus states, no tap highlights,
  `prefers-reduced-motion` support, dialog/sheet focus traps
- Public imprint at `#/imprint` (English) and `#/impressum` (German), linked
  from auth screens and Settings; reachable without a configured backend
- Installable PWA: Web App Manifest + production service worker under the
  GitHub Pages base path `/enough/`; standalone display, portrait orientation,
  theme-colored status bar, app icons (any + maskable). The service worker
  caches only the static app shell — never Supabase/auth/chat payloads. No
  push notifications and no notification permission prompts

### End-to-end encryption (1:1 peer chats)

Peer conversations are end-to-end encrypted:

- The sender encrypts through `src/lib/e2ee/` **before** insert
- `sendMessage()` is a transport boundary: it stores the already-prepared
  envelope in `messages.ciphertext` and never receives peer plaintext
- Supabase stores opaque ciphertext envelopes, not chat bodies
- The receiver decrypts on load and Realtime through the session manager
- Private keys, ratchet state and the local message cache stay in the browser
  (IndexedDB `enough-crypto`, AES-GCM sealed). Supabase holds public prekey
  material only (`crypto_devices`, `crypto_signed_prekeys`,
  `crypto_one_time_prekeys`, `crypto_kyber_prekeys`)

Documented exceptions and limits:

- **My Notes** (self-connections) remain plaintext by design. The peer E2EE
  path cannot apply to a self-connection; no self-session mechanism is invented
- Pre-E2EE rows still stored as plaintext are shown as legacy text
- System messages (`name_change`, `connection_event`, `deleted_account`) stay
  unencrypted metadata
- Single cryptographic device per account (`deviceId = 1`). A second browser
  is a new identity
- **C-1** (coordinated full-origin storage rollback) remains an open,
  documented limitation
- There is no safety-number / fingerprint UI yet. Peer identity changes are
  rejected locally (TOFU), not compared in the product UI — but they are
  **recoverable**: the conversation offers an explicit, user-confirmed
  security reset that clears the stored identity and session for that peer
  only (messages unreadable under the old state stay unreadable). A damaged
  local device state offers a confirmed reset that mints and publishes a
  fresh local identity
- Browser E2EE residual: XSS, a compromised extension, or device access is a
  full compromise

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env` file from the example and fill in your Supabase project:

   ```sh
   cp .env.example .env
   ```

   Required variables:

   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — the publishable (or legacy "anon") key

   Never put a `service_role` / secret key into a `VITE_*` variable. The app
   only uses the public client; security comes from Supabase Auth + Row Level
   Security.

3. **Apply every database migration in numeric order** — see
   [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md). In the Supabase SQL editor, run
   `0001` through `0014`; do not stop after `0001`. The scripts are idempotent,
   so they are safe to run again after an update.

   Without the migrations the app still opens, but database-backed features
   such as display names, unread badges, per-user deletion, request
   decline/expiry, account deletion, My Notes, blocking, and E2EE prekeys are
   unavailable or degrade.

4. Run the app:

   ```sh
   npm run dev
   ```

## Database schema

The app reads and writes the existing tables plus the objects added by the
migrations:

- `public.profiles` — `id` (= `auth.users.id`), `username` (unique),
  `display_name`, `identity_public_key` (nullable; E2EE-1 column, unused by
  the production Signal path)
- `public.connections` — `id`, `user_a`, `user_b`, `status`
  (`pending` | `accepted` | `declined` | `expired` | `ended`), `created_at`
- `public.messages` — `id`, `connection_id`, `sender_id`, `ciphertext`
  (E2EE envelope for peer text; plaintext for My Notes and legacy rows),
  `created_at`, `deleted_at`, `kind` (`text` | `name_change` |
  `connection_event` | `deleted_account`), `meta`
- `public.delete_own_account()` — `security definer` RPC for self-service
  account deletion (migration 0004)
- `public.ensure_my_notes()` / `public.remove_my_notes()` — auth-bound RPCs
  that manage only the caller's self-chat without weakening normal connection
  RLS (migration 0005)
- `public.connection_reads` — per-user read position (RLS)
- `public.message_deletions` — per-user "delete for me" rows (RLS)
- `public.chat_deletions` — per-user "delete chat for me" rows with
  `hidden_until` so a later reconnect does not restore that user's history
  (RLS)
- `public.connection_unread` — security-invoker view for unread counts
  (starts from `connections` with a LEFT JOIN on `connection_reads`;
  migration 0013)
- `public.user_blocks` — one row per (blocker, blocked) pair with `created_at`
  (RLS; unique pair, no self-blocks). Blocking is a separate security
  dimension: it never changes `connections.status`; DB triggers reject new
  requests and messages between a blocked pair instead
- `public.send_connection_request(target)` — auth-bound RPC implementing the
  request state machine (restore after decline/expiry in both directions,
  14-day window restart, block enforcement)
- `public.decline_connection(conn, block_peer)` — auth-bound RPC to decline
  an incoming request and optionally block the requester in one step
- `public.crypto_devices`, `public.crypto_signed_prekeys`,
  `public.crypto_one_time_prekeys`, `public.crypto_kyber_prekeys` — public
  E2EE prekey material only (migration 0011). Private keys never leave the
  browser
- `public.claim_prekey_bundle(target)` — atomic prekey claim
  (`FOR UPDATE SKIP LOCKED`; one-time prekeys consumed once; last-resort
  Kyber is never consumed)

Registration includes the username and display name in Supabase Auth user
metadata. The existing `auth.users` trigger creates the `profiles` row inside
the sign-up transaction; an idempotent authenticated upsert remains as a
fallback for auto-confirm setups.

## Testing

- `npm run build` — TypeScript check + production build
- `npm run test:crypto` / `npm run test:crypto:engine` — Node crypto and
  Signal-engine suites (no database)
- `npm run test:preview` — Home chat-overview preview: deleted messages are
  attributed to the actual deletion actor; "delete for me" shows the
  "You deleted this message" placeholder in the deleting user's Home and
  never exposes the original content
- `npm run test:unread` / `npm run test:read` / `npm run test:scroll` /
  `npm run test:contrast` — unread, monotonic read position, initial chat
  anchoring, and scroll-down contrast regressions
- `npm run test:e2eestate` — E2EE display-state resolution: an unresolved peer
  message is never an empty bubble, a failed engine reports instead of spinning
  forever, plaintext is passed through verbatim, and a peer send requires an
  explicitly ready engine (fail-closed; My Notes stays writable)
- `npm run test:chatrealtime` — realtime merge, dedupe and reconciliation for
  the open 1:1 chat (delivery, tombstones, load/pagination races)
- `npm run test:offline` — Offline Read Mode: sealed snapshot round-trip,
  offline gating, the 40-messages-per-chat bound
- `npm run test:i18n` / `npm run test:input` / `npm run test:a11y` /
  `npm run test:api` / `npm run test:errors` / `npm run test:helpers` —
  localization, input hardening, accessibility, API, error mapping, helpers
- `npm run test:license` — license declaration guards (audit C4): `LICENSE` is
  the pinned canonical AGPL-3.0-only text, the copy served by the deployed app
  is identical to it, `package.json` and `package-lock.json` declare that same
  SPDX id, and `NOTICE` accounts for every runtime dependency — so adding a
  dependency fails CI until `NOTICE` records its license id
- `npm run test:home` / `npm run test:chatblocks` / `npm run test:api-errors` —
  Home realtime updates, chat block-channel behavior, API error surfacing
- `npm run test:settings` / `npm run test:blocked` — the dedicated
  people-search screen (its `#/new-chat` entry point, focus, absence from
  Settings) and People settings (active connections, blocked hierarchy), plus
  the blocked-composer lock
- `npm run test:nav` — bottom-navigation layering: the bar is a fixed sibling
  of the app stage (never a child of `Home` or the Settings overlay), stacked
  above the overlay and below dialogs, and it animates no geometry (no
  transform, no font-weight reflow, colour-only transitions)
- `npm run test:transition` — the bidirectional screen transition between
  `#/` (chats) and `#/new-chat`: entrance and exit declare the same transition
  properties, duration and easing and the mirrored distance, the dedicated
  screen adds no motion of its own, the overlay renders its destination in the
  same commit as its `.open` class, and the bottom bar is excluded from the
  transition. The same guards cover the swap between the overlay's two
  top-level destinations (`#/new-chat` ↔ `#/settings`): mirrored keyframes,
  one duration, easing and distance for both directions, and no motion on any
  other element. The runtime counterpart lives in `npm run smoke`
- `npm run test:privacy` — privacy routing, contact form validation, and
  Edge-Function runtime guards
- `npm run test:crypto:prekeys` — **live PostgreSQL** RPC/RLS tests for
  `claim_prekey_bundle` and the `crypto_*` policies. Starts an embedded
  real Postgres, applies `supabase/tests/bootstrap_supabase_auth.sql` +
  migration `0011_crypto_prekeys.sql`, runs `supabase/crypto-prekeys-tests.sql`,
  then probes concurrent claims / `FOR UPDATE SKIP LOCKED`.
  No Supabase cloud credentials or service-role keys required
- `npm run smoke` — renders the production bundle in jsdom with a stubbed
  Supabase API and walks through the main flows (auth screens, localization,
  theme, settings overview/subpages, search, connection request lifecycle,
  chat, deletion, My Notes, sign out). It is not a substitute for live-backend
  testing. It also asserts the rendered accessibility contract: dialog and
  sheet accessible names, the focus trap, the keyboard-reachable request
  info toggle, the unread-badge role and message-bubble names. Since v0.5.0
  it also walks the bottom navigation: the three destinations, the active
  state on the chat overview, the dedicated people-search screen and the
  Settings overview, and "New chat" opening that dedicated screen (`#/new-chat`)
  with the field focused — plus the bar's layering (one persistent element
  that is a sibling of the app stage, never a descendant of an animated layer)
  and its covered state on a Settings subpage. It asserts the peer chat
  carries a labelled, icon-only E2EE marker while My Notes carries none
- `npm run verify:signal-wasm` — byte-exact SHA-256 check of the installed
  `@getmaapp/signal-wasm@0.6.6` artifacts against the audited manifest
- `supabase/rls-tests.sql` — authorization checks against the real database
  using your two existing test users (see `docs/MIGRATIONS.md`).
  `npm run test:rls` runs that suite against embedded Postgres

GitHub Actions coverage:

- **`.github/workflows/ci.yml`** — the pull-request gate. Runs on every
  `pull_request` and on `push` to `main` (plus manual `workflow_dispatch`):
  signal-wasm verification, build (typecheck + production bundle), **every**
  `test:*` script discovered from `package.json` at runtime (so a new suite is
  picked up automatically and the gate cannot drift away from the inventory),
  and the smoke test. All suites run even if an earlier one fails, so a single
  log shows the complete picture; the step then fails if any suite failed. It
  references **no secrets** — every suite runs against stubs or the embedded
  PostgreSQL started by `scripts/run-*.mjs` — so fork PRs are safe: they run
  under `pull_request` with a read-only token and no access to repository
  credentials. Permissions are pinned to the minimum (`contents: read`),
  actions are pinned to full commit SHAs, dependencies install with
  `npm ci`, and the Node major matches `deploy.yml`; a newer push to the same
  branch cancels the superseded run.
- **`.github/workflows/deploy.yml`** — the release gate. Runs signal-wasm
  verification, build, crypto/engine tests, smoke, and the live prekey tests
  **before** the Pages deploy steps, so a failed gate blocks shipping.

## Theme

Light/Dark/System is global, persisted in `localStorage`, defaults to System,
and is applied before first paint to avoid a flash. The theme module
(`src/lib/theme.ts`) is standalone; the header button cycles through all three
modes (light → dark → system → light) without a dialog, and Settings offers
the same three-way choice. `system` follows the operating-system preference
while the app is running; light and dark are independent of the OS.

Both palettes are warm: light uses a `#F7F5F0` canvas, dark a `#171614` one.
Those same two values are used for the `theme-color` meta tags, the manifest
colours and the installed-app status bar.

## Imprint

The public imprint is available at `#/impressum` (German) and `#/imprint`
(English). It is linked from the authentication screens and from Settings,
and it works without a configured Supabase connection.

Before publishing, replace every value in square brackets in
[`src/config/imprint.ts`](src/config/imprint.ts) with the operator's own
details:

- full name or company name
- serviceable postal address
- email address and telephone number
- where applicable: authorized representatives, register entry, VAT ID, and
  the person editorially responsible

Unused optional fields stay empty and are then omitted from the page. Which
details are legally required depends on the operator and the offering; the
template is not a legal review.

## Progressive Web App

enough. is installable on mobile (and desktop) as a standalone app:

| Piece | Location |
|---|---|
| Web App Manifest | `public/manifest.webmanifest` |
| Icons | `public/icons/` (+ `public/favicon.ico`) |
| Service worker generator | `scripts/pwa-plugin.ts` (emits `dist/sw.js` at build) |
| Client registration | `src/lib/pwa.ts` (production only) |

Manifest `start_url` / `scope` use relative `./` paths so the same build works
under `/enough/` on GitHub Pages and under `/` locally. The service worker is
scoped to the Vite `base`, precaches only same-origin static assets (HTML/JS/
CSS/icons/manifest), and leaves every cross-origin request (Supabase Auth,
REST, Realtime) on the network. Each deploy gets a content-hashed cache name
plus `skipWaiting` + `clients.claim`, so an old worker cannot pin users on a
stale shell. Navigation uses network-first; hashed assets use cache-first.

No push notifications are implemented and no notification permission is
requested.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` (base path `/enough/`). Only
browser-safe publishable Supabase credentials are injected at build time from
repository secrets. The production service worker and manifest are emitted
into `dist/` by the build and deployed with the rest of the static site.

## Self-hosting

enough. can be self-hosted with your own Supabase project. See
[`docs/self-hosting.md`](docs/self-hosting.md) for a complete guide covering
database setup, environment configuration, build options, and the security
model. A self-hosted instance has its own Supabase backend, users, messages,
and database — it is fully independent of the upstream deployment.

## License

enough. is licensed under the **GNU Affero General Public License version 3.0
only** (`AGPL-3.0-only`). The full text lives in
[`LICENSE`](LICENSE) at the repository root, and the same document is served
at `/LICENSE` on any deployment (copied from
[`public/LICENSE`](public/LICENSE)) because the built bundle carries no
attribution of its own.

Why this matters for this repository specifically: the E2EE engine
`@getmaapp/signal-wasm@0.6.6`, the libsignal release it wraps, and the Kyber
code compiled into its WASM are all AGPL-3.0. That code is conveyed to every
visitor's browser and the app is interacted with over a network, so AGPL's
source-availability obligations apply to the released client and to anyone
self-hosting it. [`NOTICE`](NOTICE) records the verified third-party inventory,
the Signal trademark non-endorsement statement, and the single item that is
**not** verified: the per-crate license status of the 240 transitive Rust
crates in the engine's pinned `Cargo.lock` (open gate `Gate H` in
[`docs/e2ee-2c-readiness-gate.md`](docs/e2ee-2c-readiness-gate.md) §13).

The license choice and the documented acceptance of that open item are a
project-owner decision, recorded on 2026-09-09 in
[`docs/e2ee-2c-legal-review.md`](docs/e2ee-2c-legal-review.md) §8. It is not
legal advice, and no legal counsel reviewed or approved it. The app remains
`private` in npm terms and is not published to a registry; the declaration in
`package.json` is a grant to recipients of the source and of the built app.
