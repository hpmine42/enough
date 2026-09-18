# Changelog — enough.

All notable changes to enough. are documented here, newest first.

Versioning follows the milestones of the approved roadmaps
(`docs/v02-roadmap-audit.md`, `docs/v03-roadmap.md`,
`docs/v04-roadmap-proposal.md`). Each entry lists what shipped, what was
verified, and what remains open.

---

## Unreleased

### Chat

- **Geometry-stable chat opening without composer layout shift (finding F-01).**
  Previously `<MessageComposer>` was rendered only inside the loaded ternary
  branch of `Chat.tsx`. During the loading/reveal phase, `.chat-messages-skeleton`
  occupied `flex: 1` down to the viewport bottom; mounting the composer upon
  reveal pushed message bubbles upward by ~75px. The composer is now rendered
  outside the loading ternary as a persistent structural element during chat open
  (`valid && !loadError`), disabled while `loading || revealPending` (and backed
  by a defensive early exit in `handleSend`). The skeleton occupies the exact
  vertical slot (`flex: 1`, `min-height: 0`) that the loaded message list takes
  over, eliminating layout shifts upon message reveal. Guarded by structural
  regression tests in `chat-loading-state.test.mjs` and first-frame composer
  presence/disabled assertions in `smoke-test.mjs`.

- **Opening a chat never shows the transient "Entschlüsseln…" state.** After
  the skeleton fix, the sequence still read *open chat → skeleton → every
  bubble says "Decrypting…"/"Entschlüsseln…" → messages*: the page commit
  unmasked the list in the same commit that delivered the rows, while their
  display plaintext (local cache read / engine decrypt) only resolves
  afterwards, row by row. A chat-open **reveal gate** now covers that window:
  the page commit arms it (`setRevealPending(true)` instead of a direct
  `setLoading(false)` in both the online and the offline-snapshot commit), and
  the gate releases `loading` on the render where every bubble-rendered row of
  the committed page has a FINAL display outcome — resolved plaintext, the
  localized undecryptable notice, or the settled E2EE-failure state the
  bubbles already report (`isChatPageDisplayReady` in
  `src/lib/chatDisplay.ts`, wired through the existing `resolveBubbleText`
  resolver). Tombstones and system events never block the reveal (they render
  as system lines and are exactly the rows the display path skips), an empty
  page releases immediately, and an explanation branch (`!valid` / load error)
  always releases the gate. This is a render-state change only: no decryption,
  ratchet, envelope, session or cache logic was touched, and the per-bubble
  pending/undecryptable contract (audit C1) stays as-is for realtime and
  pagination rows — the transient state is simply no longer visible while the
  first page arrives. No timer, no artificial delay, no added wait: the app
  waits exactly as long as the real load/decrypt pass needs. Guarded by
  extended `npm run test:chatloading` / `npm run test:e2eestate` tests and by
  chat-open frame assertions in `npm run smoke` that fail on any pending or
  partially resolved frame during open.

- **Opening a chat no longer shows a centred "…" while the messages load.** The
  chat body rendered `t('loading')` — the global placeholder string, a bare
  '…' — inside `.chat-loading` for the whole initial load (connection →
  profiles → block state → deletions → first message page), so the sequence read
  as *open chat → "…" in the middle → messages*. That is the same string the
  overview and header guards treat as *missing identity data*, and it was the
  only loading state in the app that showed placeholder text instead of the
  established skeleton vocabulary. `src/components/Chat.tsx` now renders a
  quiet, decorative message skeleton (`.chat-messages-skeleton`: neutral
  `--surface-2`, the shared `skeleton-breathe` pulse, bottom-anchored like the
  newest messages) which fills the same `flex: 1` slot with the same padding as
  `.messages`, so the chat geometry stays stable and the real messages replace
  it without a layout shift. The state is carried by a labelled `role="status"`
  region (new `chat.loadingMessages`, EN + DE) rather than by visible text, and
  `.chat-loading` stays for the explanatory states ("not available" / "not
  available offline"). No timer was introduced, and the skeleton is never
  replaced by a text placeholder while the load runs. Guarded by
  `npm run test:chatloading` (`src/lib/__tests__/chat-loading-state.test.mjs`)
  and by new chat-open frame assertions in `npm run smoke`. See the next entry
  for the follow-up that also removed the per-bubble decrypting state.

### PWA chrome

- **Pale band in the installed app after #124 — root cause pinned, note and
  docs corrected.** Report: Chrome ≥ 152 / Android 15–16, app reinstalled
  while light/system and then switched to dark → the top band *and* the gesture
  bar stayed `#F7F5F0` in **both** OS schemes, also after a full restart. That
  shade is the manifest `theme_color` baked into the WebAPK at install — not
  `<html>`/`<body>`/`#root`, not the safe-area padding, not a surface token and
  not the UA default white — and Chromium (`WebappIntentDataProvider`,
  `WebApkUpdateManager`, `WebappDataStorage`, all `main`) shows why nothing in
  the document can repaint it: the WebAPK's `dark_theme_color` is never filled
  (Blink no longer parses `color_scheme_dark`), so one baked colour serves both
  OS schemes; the page metas are ignored for the top bar of an installed WebAPK
  (crbug 40759522 #39, tracked as 554055703); and the manifest is re-read at
  most once a day, with the rebuild queued as a 1–23 h charging + Wi‑Fi task.
  The #124 mechanism (theme-aware manifest pair + worker) is exactly what that
  re-read picks up, so it stays untouched. `settingsScreen.appearanceInstalledHint`
  (EN + DE) now states the real cadence and the immediate remedy (reinstall
  while the wanted theme is active); `docs/pwa.md` records the device probe,
  the Chromium timing and a new checklist item; `npm run test:pwachrome` pins
  that the note keeps naming the remedy.
- **The installed app's top is now the same colour as the app.** In dark mode the
  standalone window kept a pale band above the dark canvas, because the strip the
  platform draws around the cutout / status bar is not painted by the stylesheet:
  iOS 26+ ignores `meta name="theme-color"` in a standalone window and derives that
  region from the **root element's** background, and `<html>` carried none (only
  `<body>` did), so it fell back to the UA default light canvas. `src/index.css`
  now paints the `--bg` token on `<html>` and `#root` as well, with the same theme
  transition as `<body>`.
- **The manifest carries both schemes.** `public/manifest.webmanifest` declared
  only the light `theme_color` / `background_color`, and Chrome/Android read the
  manifest — not the document metas — for the installed status bar, the
  task-switcher tile and the splash screen. A `color_scheme_dark` block
  (W3C manifest #1207; ignored where unsupported) now supplies `#171614` for a
  dark operating system, so a cold start no longer flashes light.
- **`src/lib/theme.ts` exports `THEME_CHROME_COLORS`** as the single pair of chrome
  colours, and every theme change now also narrows `meta name="color-scheme"` to
  the *used* scheme — that is what makes the platform UI (status-bar icons, form
  controls, find-in-page bar) follow an explicitly selected theme even while the
  operating system prefers the opposite. The pre-paint bootstrap in `index.html`
  does the same before React mounts.
- **Theme-aware manifest for installed Android PWAs.** The follow-up to the entry
  above: #121 fixed iOS and the `prefers-color-scheme` channels, but an installed
  app on Chrome/Android paints its status bar and gesture-bar band from the
  *manifest* document — the runtime metas never reach a standalone window (crbug
  40759522 / 40686953 / 40634649) — and `color_scheme_dark` only answers to the
  operating-system scheme, which never triggers for OS light + app explicitly dark
  (the reported configuration: bands `#F7F5F0`, exactly the manifest
  `theme_color`, while `npm run smoke` proved both metas correct). So the manifest
  itself became theme-aware: new `public/manifest.dark.webmanifest`, byte-identical
  to `public/manifest.webmanifest` except `theme_color`/`background_color` (same
  `id`/`scope`/icons, so Chromium keeps seeing one app), with
  `index.html`'s pre-paint bootstrap and `render()` in `src/lib/theme.ts` pointing
  `link[rel="manifest"]` at the theme's variant before first paint and on every
  change — the path that works with no service worker at all, as on a fresh
  install. `color_scheme_dark` stays in both files as the standard/no-worker
  fallback, and the light base stays the file default because `system` is the
  default mode.
- **The service worker serves the manifest per theme.** `scripts/pwa-plugin.ts`
  intercepts every `*.webmanifest` request *before* the static-asset branch (never
  `cacheFirstStatic` again — a cached light copy would be replayed to Chrome's
  manifest re-read forever): network-first for the raw body, the two chrome colours
  rewritten from `THEME_CHROME_COLORS` (injected at build time) on every response,
  the precached raw copy as the offline fallback, and nothing rewritten ever
  cached, so the file on disk stays the single source of truth. The theme is a tiny
  `theme.txt` record in the existing `enough-shell-*` cache, posted by the page as
  `{ type: 'enough-theme', theme }` via `navigator.serviceWorker.ready` and
  migrated across cache rotations on activate. Privacy contract unchanged:
  same-origin static assets only, no Supabase traffic; the handler accepts that one
  message type and only from this origin's own window clients (`event.origin` +
  `clients.matchAll`), and the record is a presentation preference that is never
  sent anywhere and never feeds an auth or trust decision.
- **Expectation-setting for the update lag.** WebAPK metadata is frozen at install
  time and refreshed by Chrome's app-update job, so on an existing install the bars
  may only follow after that update or a reinstall; the Appearance settings note
  says so (new i18n key, EN + DE).
- **`npm run test:pwachrome`** (`src/lib/__tests__/pwa-chrome-color.test.mjs`) pins
  all four channels to the same two values and tests the runtime sync behaviourally
  against a stubbed document, and now also: the two manifest variants differ *only*
  in the two chrome colours (recursive diff), the worker's manifest branch precedes
  `cacheFirstStatic`, the themed response is network-first with the raw precache as
  fallback, the message handler's payload/origin/client validation, the activate
  migration of the theme record, the pre-paint manifest-link swap, and `render()`'s
  worker post including every no-worker no-throw path. The generated worker was
  additionally exercised against a stubbed Cache Storage (install, message, fetch,
  activate) during the change session.
- **Not verified on a device.** The on-device band colours (OS light/app dark and
  OS dark/app light, fresh vs. existing install) stay a manual checklist item in
  `docs/pwa.md`, which also documents the channels as they actually behave, the
  build-level probe of this change, and the edge-to-edge question (Chromium issue
  407420295) that only matters if the manifest channel fails on hardware. No
  Android device was available in the change session, so no device result is
  claimed.

### Accessibility and Settings chrome

- **Dark-mode danger controls are readable again (finding F-02).**
  `.btn-primary.danger` (the destructive dialog confirm) and
  `.scroll-down-count` (the unread counter on the scroll-down disc) painted
  their labels in hardcoded `#fff` on `background: var(--danger)`. Light mode
  was fine (white on `#a44a35`, 5.82:1), but the dark `--danger` is the warm
  light salmon `#d9907e`: white read at 2.55:1, and because the shared
  `.btn-primary:hover` rule repaints every primary button to `--button-press`
  (a near-white in dark mode), the hover label reached ~1.15:1. The fix is a
  semantic token pair, exactly like the existing `--button-text` /
  `--sent-text` / `--badge-text` chip pairings: new `--danger-text` stays
  `#ffffff` in light (unchanged appearance) and resolves to the same dark
  warm ink every dark-theme chip label already uses (`#171614`) — 7.10:1 on
  the salmon and 15.7:1 on the hover surface, while the shared hover
  mechanics, the global `:focus-visible` ring, the `--danger` surface colour
  itself (so text/border/tint consumers are untouched) and all geometry stay
  as they were. Guarded by the new `npm run test:danger`
  (`src/lib/__tests__/danger-contrast.test.mjs`), which computes the WCAG
  ratios from the parsed tokens for both themes, resting and hover.
- **The Settings header survives a top safe area (finding F-03).**
  `.settings-header` combined a fixed `height: 56px` with
  `padding-top: calc(env(safe-area-inset-top) + 2px)` under the global
  border-box model, so on devices with a notch the inset padding ate the
  56px box and squeezed the 40px back/theme controls and the title out of
  the frame. The header now uses the `.legal-header` model:
  `min-height: calc(env(safe-area-inset-top) + 56px)` — the pre-inset
  geometry (56px box, the same centred 53px content line) is preserved
  exactly where there is no inset, and the box grows additively with the
  inset where there is one. No transition, colour or child of the header was
  touched. Guarded by the new `npm run test:settingslayout`
  (`src/lib/__tests__/settings-layout.test.mjs`).
- **Settings subpages respect the bottom safe area (finding F-04).**
  `.settings-subpanel .settings-scroll` ended in a flat `32px` bottom
  padding, so on devices with a home indicator the last rows of a subpage —
  including Sign out / Delete account at the bottom of Account — could slide
  under the system gesture area. The bottom inset is now added to the same
  32px (`calc(32px + env(safe-area-inset-bottom))`): subpages keep their own
  end spacing where there is no inset, the chain stays single (the panel
  itself carries no bottom padding), the overview's `--nav-clearance` and
  the bottom navigation are untouched, and the nested blocked-users layer
  inherits the same rule. Guarded by `npm run test:settingslayout`.
- **The Settings header centers on the content column on desktop
  (finding F-05).** At `@media (min-width: 760px)` the header had
  `max-width: 480px` + `width: 100%` but no auto margins, so as a flex item
  of the full-width pane/subpanel it stayed left-aligned while the scroll
  body centered itself on the same column via its base `margin: 0 auto`.
  The header now centers identically (`margin: 0 auto` inside the existing
  breakpoint rule) — same 480px column, no width change, no animation
  change, mobile presentation untouched. Guarded by
  `npm run test:settingslayout`.
- **No visible "…" while People surfaces load (finding F-06).**
  `PeopleSearch` (while the debounced lookup runs) and `PeopleSettings`
  (while the active connections load) rendered `{t('loading')}` — the global
  placeholder string, a bare '…' — as their visible state, contradicting the
  loading UX the chat and the overview established. Both now show the app's
  quiet skeleton vocabulary (`settings-people-skeleton-*`: neutral
  `--surface-2` shapes, the shared `skeleton-breathe` pulse, `aria-hidden`,
  mirroring the avatar-less search-result rows and the 44px-avatar
  connection rows), with the state carried by a labelled `role="status"`
  region (new `settingsScreen.searchLoading` /
  `settingsScreen.activeConnectionsLoading`, EN + DE) instead of visible
  text. The skeletons are gated by the same `searching` / `loading` flags as
  the paragraphs they replaced: no timer, no delay, and the
  data/error/empty branches are unchanged. Guarded by extended
  `npm run test:settings` source-level tests and by a new frame-recording
  section in `npm run smoke` that fails if any committed frame of a person
  search shows an ellipsis (or any loading text placeholder).

---

## 0.5.0

The UX/UI redesign milestone — **"Quiet Modern"**: warm, minimal, calm,
mobile-first. This is a presentation-layer release — no schema, protocol,
authorization or cryptographic behavior changed.

### Design system

- **Token-driven stylesheet.** `src/index.css` is now a design system: one set
  of colour, typography, spacing, radius, border, elevation and motion tokens
  that every component consumes, instead of per-screen values. Light/dark/
  system, focus states and the responsive rules all derive from it.
- **Warm light / soft warm dark.** Light: `#F7F5F0` canvas, `#FCFBF8` surfaces,
  `#EFEEE8` secondary surfaces, `#232320` text, `#607A63` muted-green accent
  (used restrained: active navigation, focus rings, toggles, unread counts).
  Dark: `#171614` canvas with warm surfaces and `#ECE9E1` text. `--button` and
  `--sent` still collapse onto one anthracite in light mode, so the R6
  scroll-down knockout ring and its guard (`test:contrast`) apply unchanged.
- The palette moved with it: `#F7F5F0` / `#171614` are now the `theme-color`
  meta values, the manifest colours and the installed-app status bar colour
  (`index.html`, `src/lib/theme.ts`, `public/manifest.webmanifest`).
- **One list principle: no separator lines.** Every list and menu of the app —
  chat overview (and its first-paint skeleton), Settings groups and their
  subpages, people search on the dedicated "New chat" screen, bottom-sheet
  actions — separates its entries by spacing, typography and vertical
  hierarchy, never by a decorative hairline between single entries. Hover and
  press stay a quiet surface change (`--surface` / `--surface-2`, rounded, no
  glow, no gradient), Settings groups stay legible through distance alone, and
  the destructive "Delete account" row is set apart by a 44px gap instead of a
  divider. Guarded by `npm run test:lists`
  (`src/lib/__tests__/list-separators.test.mjs`).

### Navigation

- **Bottom navigation** (`src/components/BottomNav.tsx`): Chats | New chat |
  Settings, shown on the chat overview, the dedicated people-search screen and
  the Settings overview and driven by the existing hash routes.
- **Persistent top-level layer.** The bar is a fixed sibling of `.app-stage`
  and the Settings overlay, rendered once in `src/App.tsx`, and no longer a
  child of either. It used to live inside `Home` (which carries the
  `screen-in` slide) and inside the Settings overlay (which slides in with a
  transform), so it visibly moved with every screen change and every overlay
  open. Screens and overlays now animate underneath a bar that stays anchored
  to the viewport: `position: fixed` in its own stacking context, `z-index`
  above the overlay and below the dialog/sheet backdrops. Every screen it
  floats over reserves its height (`--nav-clearance`), so it covers no
  content, and `env(safe-area-inset-bottom)` is respected.
- **Floating navigation surface.** A calm raised card instead of a full-bleed
  bar: warm surface, hairline border, one soft shadow, moderate radius, three
  equally sized destinations. The active destination is a quiet accent tint
  (icon + label + accent-soft surface) that never moves the bar: no
  font-weight reflow of the labels, no transform/scale, colour-only
  transitions, and opacity-only dimming of the stage behind the overlays.
  "New chat" opens the dedicated people-search screen (route `#/new-chat`)
  and focuses its field — the existing real search, not a parallel flow.
  While a Settings subpanel covers the bar, the bar leaves the accessibility
  tree and the tab order.
- **One transition, both directions.** `#/` ↔ `#/new-chat` is a single
  animation: the overlay enters with `translateX(56px)` → `0` and `opacity`
  `0` → `1` (`transform 0.3s var(--ease)`, `opacity 0.3s ease`) while the chat
  overview behind it dims to 45% opacity, and leaving the screen is exactly
  that animation in reverse — same properties, same duration, same easing,
  same distance, without an additional fade, scale or movement. The overlay
  keeps the destination it is closing until the exit is over and renders the
  next destination in the same commit that adds `.open`, so the surface
  sliding back out is the screen that slid in (previously it had already
  flipped to the Settings overview, which made the return look like a
  different animation). The bottom bar is not part of it: it keeps its
  position, size, stacking and active-state timing on every frame.
- **Both directions inside the overlay as well.** `#/new-chat` ↔ `#/settings`
  is the same one movement between the overlay's two equal top-level
  destinations: each is a full-size surface with its own header and scroll
  body — New chat the left area, Settings the right one — the destination that
  leaves keeps its own content (and its scroll position; it is not remounted)
  for exactly its exit while the arriving destination is already rendered with
  its content, and the reverse direction is that movement played backwards:
  same distance, same duration, same easing, no additional fade, scale or
  second screen animation. Switching between the two destinations used to
  replace the overlay's content in the commit the route changed, so the
  surface the user was looking at vanished instead of moving. The overlay's
  own entrance/exit and the Settings subpages keep their transitions, and the
  bottom bar takes no part in the swap.
- Settings is no longer a Home header icon (the bar replaces that entry); the
  Home header keeps the logo and the theme toggle.

### Screens

- **Chat overview**: rows sit on the canvas and are told apart by their own
  rhythm (row padding + 4px list gap) instead of card-like blocks or inset
  dividers, subtler unread state (small tinted count, slightly stronger
  name), and an empty state that offers the real "Search people" action. The
  overview scrolls with the page and the bar sits in flow at the bottom
  (`position: sticky`), so it never covers a row.
- **Chat**: refined bubbles, grouping and composer; a quiet, icon-only
  end-to-end encryption marker in the header for peer conversations (a small
  lock with `role="img"` + `chat.e2eeLabel` as accessible name, EN/DE) that
  never competes with the contact name for horizontal space. It disappears
  when the engine failed, so the explicit recovery notice — not a reassuring
  icon — carries that state.
- **People search**: moved out of the Settings overview to the dedicated
  people-search screen behind the bottom navigation's "New chat" (route
  `#/new-chat`, its own header title, `BottomNav` active state, focused input
  — including via deep link through `autoFocus`). It reuses the single
  existing `PeopleSearch` implementation and all of its state (debounced
  lookup, connection-request handling, block-aware rows); no parallel search
  was introduced.
- **Settings**: the overview groups the six existing categories into
  Account / Preferences / Security / About and shows a centered title matching
  the subpages. Categories, order, subpages, routes and actions are unchanged
  except that the user-search field no longer lives on the overview (and with
  it the deferred-unmount logic that once kept the overview geometry stable
  while the bar coexisted with a sliding subpage).
- **Authentication**: brand tagline, larger input surfaces, accent focus rings,
  tinted error surfaces. Validation, username availability checks, email
  confirmation, recovery and routing are unchanged.

### Verification

- `npm run build`, every `test:*` suite (including the embedded-PostgreSQL
  `test:crypto:prekeys` and `test:rls`) and `npm run smoke` pass.
- The smoke test gained redesign coverage: the three navigation destinations
  and their order, the active state on the chat overview, the dedicated
  people-search screen and the Settings overview, "New chat" opening that
  dedicated screen (`#/new-chat`, own heading, `aria-current="page"`) and
  focusing the people search, the Settings page heading and its four group
  headings, and the new pre-paint status-bar colour. It also asserts the
  labelled, icon-only E2EE marker in a peer chat header (no verbose text
  beside the contact name) and its absence in My Notes, and that the Settings
  overview no longer contains the people search.
- `test:a11y` gained a `BottomNav` contract: each destination carries a visible
  label, the active one is announced with `aria-current="page"`, a covered bar
  leaves both the accessibility tree and the tab order, and the bar is
  layout-stable on interaction (no transform on the items or the dimmed stage,
  no font-weight change on the active label, colour-only transitions,
  `position: fixed` preserved).
- `test:nav` (new, CI-discovered) guards the layering invariant itself: the bar
  is rendered as a sibling of the app stage and after the Settings overlay —
  never inside `Home` or `Settings` — no CSS rule targets it as a descendant
  of an animated layer, it is `position: fixed` with a `z-index` above the
  overlay and below dialogs/sheets, no `.bottom-nav*` rule animates geometry
  (no transform, no font-weight change, colour/background-only transitions),
  and the screens it floats over reserve `--nav-clearance`. The smoke test
  asserts the same invariants against the rendered DOM (same element across
  destinations, sibling of `.app-stage`, covered state on a Settings
  subpage).
- `test:transition` (new, CI-discovered) guards the bidirectional screen
  transition between `#/` and `#/new-chat`: entrance and exit declare the same
  transition properties, duration and easing and the mirrored distance
  (horizontal only, `opacity`-only dim behind it, no additional animation on
  the dedicated screen), the overlay renders a destination in the same commit
  as its `.open` class, and no `.bottom-nav*` rule takes part in the
  transition. It also guards the swap between the overlay's two top-level
  destinations (`#/new-chat` ↔ `#/settings`): the four pane animations are
  mirrored keyframe for keyframe, both directions use the same duration,
  easing and distance, the leaving pane rests at the end state of its exit,
  and no element other than the two panes is animated. The smoke test records
  every DOM frame of both the transition and the swap and asserts that the
  closing overlay still shows the New chat screen, that the opening one
  already shows the destination it opens, and that on every frame of a swap
  the leaving pane keeps its own content while the arriving pane is already
  rendered with its own; the overlay's class list and the persistent bar stay
  untouched on every frame.
- `test:settings` gained source-level guards for the dedicated people-search
  screen: the single `PeopleSearch` render is gated to `#/new-chat` (through
  the destination the overlay renders), the overview carries no search input
  or search-specific layout machinery, and "New chat" is the only entry point
  (bottom navigation + Home empty state).
- Unchanged by design: E2EE (Signal Protocol, PQXDH, Double Ratchet,
  Kyber-1024, pinned WASM), RLS and migrations, Realtime behavior, Offline
  Read Mode, local crypto-state protection, and every existing i18n string.

### Open / notes

- No safety-number / fingerprint UI yet (unchanged); **C-1** (coordinated
  full-origin storage rollback) remains an open documented limitation.
- The `design/` mockups still show the pre-v0.5.0 appearance and are kept as a
  historical reference; the app icons were not regenerated.

---

## 0.4.0

The privacy, reliability, security/recovery and release-foundation milestone.
Prepared 2026-09-09; the `v0.4.0` tag is created when the release decision
report is accepted (release-preparation pass, per `docs/v04-roadmap-proposal.md`
item C5).

### End-to-end encryption: visible state and recovery (C1, C2)

- **Visible E2EE lifecycle (C1).** The E2EE provider now publishes an explicit
  three-state lifecycle — `initializing` / `ready` / `error` — instead of a
  single `manager` reference. A failed engine initialization (blocked
  IndexedDB, refused WASM, unreachable prekey publication, corrupted local
  state) is announced with a non-sensitive reason, a **retry** action, and a
  fail-closed composer: no peer message is ever sent or stored as plaintext
  while encryption is unavailable, and unresolved peer messages render a
  pending state instead of a visually empty bubble.
- **Peer identity reset (C2).** When a peer's TOFU identity key changes, the
  conversation offers an explicit, user-confirmed **security reset** (chat
  long-press action menu and the send-error state). It clears the stored
  identity trust and the session for that one peer only, warns that messages
  unreadable under the old state stay unreadable, and then continues securely.
- **Device reset (C2).** When the local crypto state itself is damaged and
  retrying cannot help, the E2EE error state offers a confirmed **reset**: the
  broken device state is wiped through the manager's explicit reset (own
  identity + ratchet sessions only — sealing key, message cache and Offline
  Read Mode snapshots are kept) and a fresh identity is minted and published
  (public keys only). Neither reset ever runs without explicit user
  confirmation.
- Regression coverage: `test:e2eestate` (display states, fail-closed send),
  `test:crypto:engine` → `identity-recovery.test.mjs`, plus a dedicated smoke
  section that breaks engine initialization and asserts the visible, safe and
  recoverable error state.

### Privacy, legal surface and contact (C6 + #100–#104)

- **Privacy policy** (English and German) at `#/privacy` / `#/datenschutz`,
  rewritten against what the app actually does: data categories, Supabase
  sub-processing, E2EE limits, contact data, and the explicit statement that
  there are no push notifications and no notification permission is ever
  requested.
- **Privacy link before registration (C6).** The privacy policy is now linked
  from every unauthenticated screen (Login, Register, Forgot/Reset password,
  not-configured screen) via the legal footer — a visitor can read the policy
  before handing over credentials.
- **Imprint** at `#/imprint` / `#/impressum`: two equal-ranking surfaces
  (public imprint + contact), provider details in the provider block, card
  layout; operator data filled in (`src/config/imprint.ts`).
- **Contact form** delivered through the `send-contact-email` Supabase Edge
  Function (HTML-escaping, CRLF filtering, rate limiting, method and origin
  guards), with a dedicated deploy workflow (`.github/workflows/
  deploy-supabase-functions.yml`) that deploys the function and runs a real
  end-to-end submission check after every change.

### Reliability: realtime delivery and offline reading

- **Realtime delivery for the open 1:1 chat** (#94) with server-side filters
  and client-side re-scoping; realtime payloads are still never treated as
  proof of authorization.
- **Incremental Home realtime** (#86) — events update the overview in place
  instead of triggering a full reload.
- **Race-condition fixes (F-01…F-07, #95–#99):** async send/pagination
  results are guarded against conversation switches; realtime UPDATEs and
  tombstones captured during initial load or `loadOlder` pagination are
  reconciled; overlapping Home `load()` calls can no longer corrupt realtime
  state; duplicate unread-badges and cache-persistence failures are fixed.
- **Offline Read Mode** (#93): while offline, the cached Home overview and
  the last 40 messages of an opened chat stay readable from sealed local
  snapshots (AES-256-GCM, bounded at 40 messages per chat), with an offline
  banner. There is deliberately **no offline send queue** — sending stays
  impossible while offline, and so does everything else that would touch the
  network.
- Coverage: `test:home`, `test:chatrealtime`, `test:offline`,
  `test:preview`, plus smoke assertions.

### Home and Settings

- **Long-press action menu** on Home overview rows and chat rows (#90, #91):
  block / unblock (with confirmation naming the peer) and **delete chat for
  me**; blocked users additionally see the composer locked, and the security
  reset from C2 appears in the menu when applicable.
- **People management in Settings** (#88–#92): global search over people,
  active connections with actions, and the blocked-users hierarchy
  (`#/settings/people/blocked`), with the search bar kept stable during the
  subpage slide.
- **Home preview correctness** (#81, #85): previews of deleted messages name
  the deletion actor, and "delete for me" content is never exposed in the
  deleting user's Home preview.
- Settings spacing polish (#82).
- Coverage: `test:settings`, `test:blocked`, `test:chatblocks`,
  `test:unread`, `test:read`, `test:scroll`, `test:contrast`,
  `test:preview`, `test:home`.

### Release foundation (C3, C4, C5)

- **CI on pull requests (C3).** `.github/workflows/ci.yml` runs the whole
  gate on every PR and on push to `main`: `verify:signal-wasm`, build
  (typecheck + production bundle), **every** `test:*` suite discovered from
  `package.json` at runtime (so the gate cannot drift from the suite
  inventory), and the jsdom smoke test. All suites run even if an earlier one
  fails; the step fails if any suite failed. The workflow references **no
  secrets** (every suite runs against stubs or embedded PostgreSQL), so fork
  PRs are safe; permissions are pinned to `contents: read` and actions are
  pinned to full commit SHAs.
- **License and distribution (C4).** The project is declared
  **AGPL-3.0-only**: `LICENSE` (canonical AGPL-3.0 text), `NOTICE` (verified
  third-party inventory, Signal trademark non-endorsement statement, and the
  one open item — per-crate licenses of the engine's 240 transitive Rust
  crates, Gate H), the `license` field in `package.json` /
  `package-lock.json`, and the same license document shipped to users at
  `/LICENSE` in every deployment. `test:license` guards the declaration, the
  byte-identity of the served copy, and that `NOTICE` accounts for every
  runtime dependency.
- **Version metadata (C5).** `package.json` / `package-lock.json` bumped to
  `0.4.0` (the Settings footer is injected from `package.json` at build time
  and the smoke test asserts it matches); this changelog is the new single
  place for release history.
- **Documentation.** README updated to the shipped state (features, E2EE
  limits including the new recovery flows, full test-suite inventory, CI
  description); self-hosting guide; English-only documentation cleanup;
  production E2EE architecture clarified.

### Verified for this release

- Production build (`tsc --noEmit` + Vite) — pass
- All 24 `test:*` suites from `package.json`, including the two live
  PostgreSQL harnesses (`test:crypto:prekeys`: SQL cases 1–8 + concurrency
  probes; `test:rls`: migrations 0001→0014 applied to embedded Postgres 18.4)
  — pass
- `npm run verify:signal-wasm` — 12/12 byte-exact SHA-256 checks, including
  byte-identity of the shipped `dist/assets/signal_wasm_bg-*.wasm` to the
  audited `@getmaapp/signal-wasm@0.6.6` artifact
- `npm run smoke` — jsdom render of the production bundle with the **real**
  Signal engine: auth screens, localization, theme, settings, connection
  lifecycle, chat, deletions, My Notes, the C1 E2EE error-state section, the
  recovery flow, and the security meta tags (CSP, referrer policy,
  robots.txt, security.txt, shipped LICENSE) — pass
- EN/DE translation key parity — exact (662/662 keys, zero one-sided keys)
- GitHub Pages deployment configuration — verified locally by building with
  `VITE_BASE=/enough/` (correct base-prefixed asset URLs, service-worker
  precache and manifest scope under `/enough/`)

### Known limitations (unchanged or intentionally open in 0.4.0)

- **C-1** — coordinated full-origin storage rollback remains an open,
  documented limitation (`docs/e2ee-crash-rollback-hardening.md`).
- No safety-number / fingerprint UI; trust is TOFU, and a changed identity is
  now **recoverable** (C2) but never compared in the product UI.
- Single cryptographic device per account; no key backup / recovery phrase.
- My Notes stays plaintext by design; pre-E2EE legacy rows stay plaintext.
- No push notifications, typing indicators, presence, reactions, groups,
  media, offline send queue, or multi-device — all explicitly out of scope.
- The audit items **W1–W8** from `docs/v04-roadmap-proposal.md` (smoke
  envelope assertion, message length limit, cache bounding, Edge-Function
  hardening, base-schema single source of truth, docs index, i18n parity
  guard, E2EE failure-path regression tests) are **not** part of 0.4.0 and
  remain backlog.

---

## 0.3.0

Released 2026-09-02. Chat behavior, UX and visual polish — the six approved
items of `docs/v03-roadmap.md` (R1–R6).

- **R1** — chat opens reliably at the newest message; initial anchoring
  waits for the rendered tail (including async E2EE plaintext) and stops as
  soon as the user scrolls (`test:scroll`).
- **R2** — per-user read position is monotonic; scrolling up never creates
  phantom unread (`test:read`).
- **R3** — two-line Home chat rows: display name with inline `@username`
  (or My Notes tag), preview + unread badge.
- **R4** — Settings category overview with subpages (Profile, People,
  Language, Appearance, Chat, Account), full-screen slide-in.
- **R5** — 44 px avatars with a clear gap from the row text; row layout
  clarified.
- **R6** — scroll-to-bottom button contrast in light mode over sent bubbles
  (`test:contrast`).

Also in this cycle: English-only documentation cleanup, production E2EE
architecture clarified, self-hosting guide added, Supabase
`same_password` vs `weak_password` error distinction.

---

## 0.2.0

Released 2026-08-31. Technical, security and quality release — the
`docs/v02-roadmap-audit.md` gate (phases A–G) completed and verified.

- **E2EE v0.2** — 1:1 peer conversations are end-to-end encrypted with the
  Signal Protocol (PQXDH + Double Ratchet) via the pinned
  `@getmaapp/signal-wasm@0.6.6` engine; byte-exact supply-chain
  verification of the shipped WASM artifact (`verify:signal-wasm`, F5);
  private keys and ratchet state stay in the browser (IndexedDB
  `enough-crypto`, AES-256-GCM sealed), Supabase stores opaque envelopes and
  public prekey material only.
- **PWA** — installable static-shell service worker under the GitHub Pages
  base path `/enough/` (no push, no notification permission).
- **Security & deployment verification (A1–A5)** — deployed RLS policies and
  auth configuration re-verified against production, CSP + Referrer-Policy
  meta tags, input and data-boundary hardening, i18n interpolation
  correctness (values are data, never templates).
- **Reliability & UX correctness (B1–C4)** — bounded unread-count queries,
  incremental Home realtime foundations, data-layer error surfacing instead
  of empty states, global error boundary, dialog/sheet focus management,
  fresh-message timestamps.
- **Accessibility (D1)** — consistent accessible names, focus behavior,
  `prefers-reduced-motion` support.
- **Testing (E1–E5)** — Node test suites for helpers, API, error mapping,
  crypto/E2EE, and the live-Postgres RLS + prekey harnesses
  (`test:rls`, `test:crypto:prekeys` on embedded Postgres).
- **Release readiness (G1–G4)** — full manual QA, production build and
  deployment, database migrations 0001–0014 deployed and verified, security
  release review with no open blocker.
