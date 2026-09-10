# Changelog — enough.

All notable changes to enough. are documented here, newest first.

Versioning follows the milestones of the approved roadmaps
(`docs/v02-roadmap-audit.md`, `docs/v03-roadmap.md`,
`docs/v04-roadmap-proposal.md`). Each entry lists what shipped, what was
verified, and what remains open.

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

### Navigation

- **Bottom navigation** (`src/components/BottomNav.tsx`): Chats | New chat |
  Settings, shown on the chat overview and on the Settings overview and driven
  by the existing hash routes. Active/inactive is a quiet accent tint.
  "New chat" is not a parallel flow: it opens the existing people search and
  focuses the field. While a Settings subpanel covers the bar, the bar keeps
  its box but leaves the accessibility tree and the tab order.
- Settings is no longer a Home header icon (the bar replaces that entry); the
  Home header keeps the logo and the theme toggle.

### Screens

- **Chat overview**: hairline-separated rows instead of card-like blocks,
  inset dividers, subtler unread state (small tinted count, slightly stronger
  name), and an empty state that offers the real "Search people" action. The
  overview scrolls with the page and the bar sits in flow at the bottom
  (`position: sticky`), so it never covers a row.
- **Chat**: refined bubbles, grouping and composer; a quiet end-to-end
  encryption marker in the header for peer conversations (`role="img"` +
  `chat.e2eeLabel`, EN/DE). It disappears when the engine failed, so the
  explicit recovery notice — not a reassuring icon — carries that state.
- **Settings**: the overview groups the six existing categories into
  Account / Preferences / Security / About and shows a centered title matching
  the subpages. Categories, order, subpages, routes and actions are unchanged.
- **Authentication**: brand tagline, larger input surfaces, accent focus rings,
  tinted error surfaces. Validation, username availability checks, email
  confirmation, recovery and routing are unchanged.

### Verification

- `npm run build`, every `test:*` suite (including the embedded-PostgreSQL
  `test:crypto:prekeys` and `test:rls`) and `npm run smoke` pass.
- The smoke test gained redesign coverage: the three navigation destinations
  and their order, the active state on both overviews, "New chat" opening the
  Settings overlay and focusing the people search, the Settings page heading
  and its four group headings, and the new pre-paint status-bar colour. It
  also asserts the labelled E2EE marker in a peer chat header and its absence
  in My Notes.
- `test:a11y` gained a `BottomNav` contract: each destination carries a visible
  label, the active one is announced with `aria-current="page"`, and a covered
  bar leaves both the accessibility tree and the tab order.
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
