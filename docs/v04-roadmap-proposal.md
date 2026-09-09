# enough. — v0.4 Repository Audit and Roadmap Proposal

> **Status:** Proposed. Not approved for implementation.
>
> **Basis:** Repository state at `a472fcc` ("Update Supabase CLI setup and
> deployment script"), branch `arena/01a07d2d-enough`, audited 2026-09-07.
> Remote `main` = `a472fcc` (63 commits ahead of the `v0.3.0` tag).
>
> **Method:** Every statement below was produced by reading the code or by
> running a command in this checkout. Commands and their results are quoted.
> Statements that could **not** be verified are marked `UNVERIFIED` with the
> reason.
>
> **Relation to earlier documents:** `docs/v03-roadmap.md` is fully worked off
> (see §2.3). `docs/v02-roadmap-audit.md` remains frozen. This document does not
> reopen either.

---

## 1. Verification baseline (what was actually run)

| Check | Command | Result |
|---|---|---|
| Type check + production build | `npm run build` | **PASS** — 144 modules, `index-*.js` 663.89 kB (gzip 191.24 kB), `signal_wasm_bg-*.wasm` 797.75 kB |
| All `node --test` suites | 21 suites (see §5.1) | **PASS** — 773 / 773 tests, 0 failures |
| Smoke test (jsdom render of the built bundle) | `npm run smoke` | **PASS** — CSP/referrer/robots/security.txt block + UI walkthrough + recovery flow |
| Signal-WASM supply-chain verification | `npm run verify:signal-wasm` | **PASS** — 12/12 hash checks, incl. byte-identity of the built WASM asset |
| Live Postgres prekey RPC/RLS | `npm run test:crypto:prekeys` | **PASS** — SQL cases 1–8 + 2 concurrency probes (`FOR UPDATE SKIP LOCKED`) |
| Live Postgres migration-chain RLS | `npm run test:rls` | **PASS** — migrations 0001→0014 applied, base + NV-1 + block sections green |
| `git diff --check` | — | clean |
| Working tree | `git status --short` | clean (this document is the only addition) |

**Not verifiable in this environment:**

* `UNVERIFIED` — deployed production state. `https://hpmine42.github.io/enough/`
  is unreachable from this sandbox (`curl: (35) OpenSSL SSL_connect:
  SSL_ERROR_SYSCALL`). No claim is made about what is currently live.
* `UNVERIFIED` — whether migrations 0001–0014 are applied to the live Supabase
  project, whether the `send-contact-email` Edge Function is deployed, and
  whether its runtime secrets are set. All require project credentials.
* `UNVERIFIED` — manual/visual QA (both themes, real viewport, real devices,
  screen readers). jsdom performs no layout.

---

## 2. Current state inventory

### 2.1 Features and their real implementation status

Verified against source, not against documentation.

| Area | Status | Evidence |
|---|---|---|
| Auth (login, register, confirm, forgot/reset, email change, sign out) | **Implemented** | `src/context/AuthContext.tsx`, `Login/Register/ForgotPassword/ResetPassword.tsx` |
| Self-service account deletion | **Implemented** | migration `0004`, `deleteOwnAccount`, `AuthContext.tsx:268-271` wipes local vault + cache |
| Profile, display name, `@username` search | **Implemented** | `ProfileSettings.tsx`, `PeopleSearch.tsx`, migration `0002` |
| Connections: request / accept / decline / cancel / 14-day expiry / re-request | **Implemented** | `send_connection_request` RPC (0001, fixed in 0014), `decline_connection` (0008) |
| Blocking (request-time, from chat, settings page, composer lock) | **Implemented, DB-enforced** | migration `0008` (triggers + `BLCKD`), `test:rls` block section |
| Chat: grouped bubbles, long-press sheet, copy, delete for me / for everyone (24 h) | **Implemented** | `Chat.tsx`, `MessageBubble.tsx`, `guard_message_update` (0009) |
| My Notes (self-chat) | **Implemented, plaintext by design** | `ensure_my_notes`/`remove_my_notes` (0005), `message-flow.ts` self branch |
| Safe markdown rendering | **Implemented** | `src/lib/markdown.tsx`; the only `dangerouslySetInnerHTML` occurrence under `src/` is `privacy-routing.test.mjs:1017`, a guard asserting its absence — production code is clean |
| E2EE for 1:1 peer chats (PQXDH + Double Ratchet) | **Implemented and working** | see §2.2 — proven by an instrumented smoke run |
| Read state (monotonic), unread badges, `↓ N` | **Implemented** | `helpers.advanceReadPosition`, `test:read` (16), `test:unread` (27) |
| Initial chat anchoring at newest message | **Implemented** | `src/lib/chatScroll.ts`, `test:scroll` (9) |
| Pagination with scroll compensation | **Implemented** | `Chat.tsx` `pendingDeltaRef` + `useLayoutEffect` |
| Realtime: Home + open chat, deletions, connections, profiles, blocks | **Implemented** | `homeRealtime.ts` (658 LOC), `chatRealtime.ts`, PRs #94–#99 |
| Offline Read Mode (sealed local snapshots) | **Implemented** | `offlineStore.ts`, `test:offline` (21), bounded at 40 msgs/chat |
| PWA (manifest + generated service worker) | **Implemented** | `scripts/pwa-plugin.ts`, static-shell-only caching |
| Settings: overview + 6 subpages + 3rd-level blocked page | **Implemented** | `Settings.tsx:69-93`, `src/components/settings/*` |
| Imprint (`#/imprint`, `#/impressum`) | **Implemented, operator data filled in** | `src/config/imprint.ts` — no bracket placeholders remain |
| Privacy policy (`#/privacy`, `#/datenschutz`) | **Implemented** | `Privacy.tsx`, 58 privacy tests |
| Contact form → Edge Function | **Implemented** | `ContactForm.tsx`, `supabase/functions/send-contact-email/index.ts` |
| Multi-device / second browser | **Not implemented (by design)** | `DEVICE_ID = 1`; a second browser is a new identity |
| Key backup / recovery, safety numbers | **Not implemented** | `docs/e2ee-architecture.md:551-555` |
| Typing / presence / reactions / groups / media / push / offline send queue | **Not implemented (out of scope)** | `Chat.tsx:951` explicit guard |

### 2.2 Is E2EE actually working? (verified, not assumed)

The smoke test injects a **real** `E2EESessionManager` over the real
`@getmaapp/signal-wasm` engine (`scripts/smoke-test.mjs:859-925`) and sends a
peer message through the real UI (`:1874-1882`).

To confirm what actually lands in the (fake) database, a **temporary
instrumented copy** of the smoke test was run (the probe file was deleted
afterwards; the working tree is clean). Result:

```
PROBE sent rows: [{"id":"msg-2","len":2377,"head":"{\"v\":1,\"e\":\"sw\",\"t\":3,\"b\":\"RAgBEiEFe0Po5"}]
PROBE stored-as-envelope: [ true ]
```

**Conclusion:** peer messages really are stored as versioned Signal envelopes.
The E2EE path works end to end through the UI. What is missing is an
*assertion* for that property (see F-11).

### 2.3 Roadmap status: v0.3 is complete

All six approved v0.3 items are implemented and covered:

| Item | Merged as | Verified in code |
|---|---|---|
| R1 — chat opens at newest message | PR #75 | `chatScroll.ts` + `Chat.tsx:918-938`, `test:scroll` |
| R2 — monotonic read position | PR #73 | `helpers.advanceReadPosition` used at every `lastReadRef` write, `test:read` |
| R3 — two-line chat rows, inline `@username` | PR #76 | `.chat-topline` / `.chat-identity` (`index.css:635-649`), `Home.tsx:985` |
| R4 — Settings overview + subpages | PR #77 | 6 overview categories + `#/settings/people/blocked` + legacy `#/settings/blocked` |
| R5 — avatar size / gap / centering | (with #76/#82) | `<Avatar size={44} />` (`Home.tsx:974`), `.chat-overview-row { gap: 14px }` (`index.css:622`) |
| R6 — scroll-down contrast | PR #79 | `test:contrast` (7 tests) |

**Per the governance model in `docs/v02-roadmap-audit.md` §18, the approved
technical roadmap is therefore `COMPLETE`.** There is no remaining approved
autonomous item. Everything below needs an explicit product decision.

### 2.4 What changed since the v0.3.0 release

`gh api repos/hpmine42/enough/compare/v0.3.0...main` → **ahead_by: 63**.
24 PRs merged after the release (2026-09-02), in three clusters:

1. **Home/Chat correctness & realtime** (#81, #85, #86, #90–#99): preview
   attribution, delete-for-me leakage into previews, incremental Home realtime,
   long-press menus, then the F-01…F-07 race-condition series (conversation
   switch guards, realtime captured during load/pagination, duplicate badge
   counting, cache persistence failures).
2. **Offline Read Mode** (#93) and **Settings people management** (#88, #89, #92).
3. **Legal surface** (#100–#104): privacy policy, imprint rework, contact form,
   and the Edge-Function deployment pipeline. Two direct commits to `main`
   followed PR #104 (`d62015d`, `a472fcc`) adding `supabase/config.toml` and the
   deploy workflow.

**Observation:** PR titles and commit messages already say "v0.4" / "v0.4.1"
(#100, `b42308a`) while `package.json` still says `0.3.0` and the latest GitHub
release is `v0.3.0`. The release train and the version metadata have drifted.

---

## 3. Architecture (as actually built)

### 3.1 Frontend

Vite 6 + React 18 + TypeScript 5.7 strict, ~20.7 k lines under `src/`.
No router library (13-line hash router, `src/lib/router.ts`), no state library
(three React contexts: `AuthContext`, `E2EEContext`, `PreferencesContext`).
Four dependencies total (`@getmaapp/signal-wasm`, `@supabase/supabase-js`,
`react`, `react-dom`).

Consistent, deliberate pattern: **pure logic lives in `src/lib/*.ts` and is
unit-tested by the Node runner; React components stay thin.** This is why 773
tests exist without a DOM test framework. The trade-off is visible in the file
sizes of the components that were never decomposed: `Chat.tsx` 1720 lines,
`Settings.tsx` 1159, `Home.tsx` 1130.

### 3.2 Supabase / backend

There is no backend code in this repository other than one Edge Function. The
database is delivered as 14 ordered, idempotent SQL migrations. The RLS model
is genuinely defence-in-depth and is the strongest part of the codebase:

* `messages` SELECT scoped to connections the caller participates in; INSERT
  `with check (sender_id = auth.uid() and …)`; UPDATE sender-only
  (`0009_explicit_base_rls.sql:73-104`).
* `guard_message_update()` makes every column immutable except a one-way,
  24-hour `deleted_at` transition plus clearing `ciphertext` — content edit and
  restore are impossible at the database layer.
* Blocking is a separate dimension from `connections.status` and is enforced by
  triggers + RPCs (`0008`), not by the UI.
* `crypto_*` tables expose **public prekey material only**; owner-only writes;
  `claim_prekey_bundle` is atomic (`FOR UPDATE SKIP LOCKED`), verified under
  real concurrency by `npm run test:crypto:prekeys`.
* Live-Postgres verification exists for the whole chain: `npm run test:rls`
  applies 0001→0014 to an embedded Postgres 18.4 and runs the suite.

**Structural gap:** the base schema (`profiles`, `connections`, `messages`, the
`handle_new_user` signup trigger) is **not** in the repository. It is
reproduced as a SQL snippet in `docs/self-hosting.md` and, independently, as
inline SQL in `scripts/run-rls-tests.mjs:112-133`. The two copies already
diverge (see F-10).

### 3.3 Auth

Supabase Auth via `@supabase/supabase-js`, publishable/anon key only
(`.env.example` explicitly warns against `VITE_*` secrets). Sessions persist;
`onAuthStateChange` is registered **before** `getSession()` so the implicit
`PASSWORD_RECOVERY` callback is not missed (`AuthContext.tsx:82-90`) — and the
smoke test asserts exactly that. `errors.ts` maps GoTrue codes including the
`same_password` vs `weak_password` distinction, and funnels genuine network
failures into `reportNetworkFailure()` for offline detection.

### 3.4 Realtime

`postgres_changes` channels, one per concern, always with server-side filters
and **client-side re-scoping** ("a Realtime payload is never treated as proof of
authorization"). Rows are validated structurally and dropped fail-closed
(`chatRealtime.isRealtimeMessageRow`). The F-01…F-07 series closed the
load/pagination race windows; `test:chatrealtime` (68) and `test:home` (84)
cover them.

### 3.5 Crypto / E2EE

`UI → message-flow → session-manager → ratchet-session → engine-adapter →
signal-wasm`. Layering is respected: `message-flow.ts` and `session-manager.ts`
perform no cryptography themselves. Notable properties verified in code:

* `prepareSend` **fails closed**: no manager → `NOT_AVAILABLE` throw, never a
  plaintext insert for a peer conversation.
* `sendMessage()` (`api.ts:631-651`) is a pure transport insert; it never
  touches the payload. Ciphertext is never trimmed/normalized anywhere.
* Local vault: IndexedDB `enough-crypto`, AES-256-GCM sealed, AAD-bound to user
  + record key; commit-before-send with monotonic uint64 revision and a
  two-phase CAS.
* Web Locks are mandatory — if unavailable the manager fails closed rather than
  falling back.
* Signed-prekey rotation with bounded retention; OTP pool 50/threshold 10,
  Kyber 5/2, refilled on `initialize()`.
* TOFU on peer identity keys; a changed key throws.

**Known, deliberate, documented limits:** C-1 (coordinated full-origin storage
rollback) remains OPEN by design (`docs/e2ee-crash-rollback-hardening.md:28`);
single device per account; no key backup; no safety-number UI; My Notes
plaintext; browser-E2EE residual (XSS / extension / device access = full
compromise).

---

## 4. Findings

Severity: **P0** = blocks a stable release · **P1** = should land soon ·
**P2** = debt · **P3** = optional.

### F-01 (P0) E2EE failure states are invisible to the user

`E2EEContext` exposes `{ manager, ready, error }`, but **only `manager` is ever
consumed**. `grep -rn "useE2EE" src` returns exactly three lines: the import
(`Chat.tsx:55`), the single call site (`Chat.tsx:87`, which destructures
`{ manager }`), and the definition (`E2EEContext.tsx:161`). There is one
consumer, and it takes one field. `ready` and `error` are dead in the UI.

Consequences, all verified in code:

* `Chat.tsx:1553` renders
  `text={plain[id] ?? (undecryptable.has(id) ? t('chat.undecryptable') : '')}`.
  A message whose plaintext is merely *unresolved* renders as `''`.
* `MessageBubble.tsx` then renders `<MarkdownText text="" />` — a **visually
  empty bubble**. Only the `aria-label` falls back to `t('loading')`, so sighted
  users get nothing while screen readers get "Loading…".
* If `initialize()` rejects (IndexedDB blocked in private mode, WASM refused,
  prekey publish failing on a flaky network), `manager` stays `null` forever:
  every peer bubble is empty, and every send fails with the generic
  `chat.e2eeFailed`. No cause, no action, no retry.

This is the single most likely source of "the app is broken and I cannot tell
why" support reports.

### F-02 (P0) Identity change permanently bricks a conversation, with no recovery

`session-manager.ts:790-792` throws `USER_MISMATCH` when a peer's identity key
differs from the stored TOFU record. `removePeerTrust`
(`device-store.ts:642`) has **zero callers in the entire repository**. There is
no UI, no setting, and no code path that clears a stale trust record.

Combined with the documented single-device model ("A second browser is a new
identity", README), the ordinary user events *clear browser data*, *switch
browser*, *reinstall* silently and permanently break the conversation **in both
directions** — the peer sees "Couldn't decrypt this message.", the other side
sees "Message could not be encrypted." Neither can fix it.

Related: `errors.ts` never maps `CryptoError` codes, and `Chat.tsx:980-983`
collapses everything except `NOT_AVAILABLE` into `chat.e2eeFailed`.

### F-03 (P0) No CI on pull requests; 485 of 773 tests never run automatically

`.github/workflows/deploy.yml` triggers on `push: branches: [main]` and
`workflow_dispatch` only — **no `pull_request:` trigger in either workflow.**
PRs are merged unverified.

Measured coverage of the automatic gate (`npm run` steps in both workflows):
`verify:signal-wasm`, `build`, `test:crypto` (239), `test:crypto:engine` (49),
`smoke`, `test:crypto:prekeys`.

```
TOTAL node --test: 773 | in CI: 288 | NOT in CI: 485
```

`npm run test:rls` — the only suite that applies the full migration chain
0001→0014 and checks authorization — is **not in CI at all**. Neither are
i18n (29), home (84), chatrealtime (68), privacy (58), api (53), unread (27),
errors (26), offline (21), preview (20), read (16), helpers (16), a11y (15),
api-errors (13), scroll (9), settings/input/contrast/blocked (7 each),
chatblocks (2).

### F-04 (P0) No license, while shipping AGPL-3.0-only code to browsers

No `LICENSE`, no `NOTICE`, and `package.json` has no `license` field
(`node -e` → `license: undefined`). The production bundle contains
`@getmaapp/signal-wasm@0.6.6`, which the repository's own due diligence records
as **AGPL-3.0-only** (`docs/e2ee-2b-due-diligence.md:903-916`), and which is
conveyed to every visitor as a 797 kB WASM asset.

The project's own gate document records this as unresolved:
`docs/e2ee-2c-readiness-gate-p0.md` Gate A → `BLOCKED`, "LEGAL REVIEW
REQUIRED". This is a decision, not a coding task — but it cannot stay open for
a public "stable" release.

### F-05 (P1) Privacy policy is not reachable before registration

`LegalFooter.tsx` — used by `Login`, `Register`, `ForgotPassword`,
`ResetPassword` and the unconfigured screen — links **only** the imprint.
The privacy policy is reachable only from Settings (authenticated,
`Settings.tsx:847`) and from the Imprint page (`Imprint.tsx:163`).

A visitor creating an account cannot reach the privacy notice without first
opening the imprint. For a German-audience messenger this is an Art. 13 GDPR
transparency problem and an easy fix (one link in `LegalFooter`).

### F-06 (P1) No message length limit — client or server

`MessageComposer.tsx` has no `maxLength` on the textarea and no length check in
`submit()`. No migration adds a `char_length` constraint to
`messages.ciphertext` (only `profiles.display_name`, in `0012`). The column is
`text`. Any authenticated user can insert arbitrarily large rows into a
conversation, which the peer then has to download, decrypt and render.

Note: the base schema is external, so the claim is "nothing in this repository
enforces a limit", not "the live column is unlimited" — the latter is
`UNVERIFIED`.

### F-07 (P1) Unbounded growth of the sealed plaintext cache

`src/lib/e2ee/message-cache.ts` stores one entry per message with **no cap and
no eviction** — the only removal paths are `clearMessageCache` (account
deletion) and the legacy-localStorage cleanup. `warmMessageCache()` →
`ensureLoaded()` loads and unseals the **entire** envelope into an in-memory map
on every Home load (`message-cache.ts:402-404`, called from `Home.tsx:60`).

Storage and memory therefore grow linearly with lifetime message volume. The
data is sealed with AES-GCM, so this is a scaling/memory issue, not a
confidentiality regression.

### F-08 (P1) Contact-form Edge Function: weak abuse protection, fail-open mock

`supabase/functions/send-contact-email/index.ts`:

* Rate limiting is an in-memory `Map` (`rateLimitMap`) — it resets on every cold
  start of the isolate and **is never pruned**, so it grows with every distinct
  IP for the lifetime of a warm isolate.
* `verify_jwt = false` (`supabase/config.toml`) — the endpoint is public, and
  every accepted request costs a Resend API call.
* If `RESEND_API_KEY` is absent the function returns `200 {ok:true, note:"Mock
  mode…"}` — a silent success. The deploy workflow greps for "Mock mode" and
  warns, which is good, but the client cannot distinguish it.
* `isAllowedOrigin` accepts any `*.e2b.app` subdomain and any
  `localhost`/`127.0.0.1` port.

### F-09 (P1) Release hygiene: version, changelog, tag drift

63 commits and 24 PRs sit on `main` past the `v0.3.0` tag, `package.json` still
reads `0.3.0`, commits already reference "v0.4"/"v0.4.1", and there is no
`CHANGELOG`. The Settings footer shows `__APP_VERSION__` (build-injected), so
users will keep seeing 0.3.0 after all of this work ships.

### F-10 (P2) The base schema exists in two divergent copies

| | `docs/self-hosting.md` | `scripts/run-rls-tests.mjs:112-133` |
|---|---|---|
| `messages.ciphertext` | `text` (nullable) | `text not null` |
| `connections.user_a/b` | no FK | `references auth.users(id)` |
| `connections.updated_at` | absent | present |
| `handle_new_user` trigger | present | absent |

There is no `0000_base.sql`, so `supabase db push` on a fresh project cannot
reproduce the schema. A self-hoster following the doc gets a schema the RLS
suite has never actually tested.

### F-11 (P2) The smoke test does not assert its most important property

`grep -n "isEnvelope\|parseEnvelope\|Envelope" scripts/smoke-test.mjs` → **no
hits**. The suite sends a real encrypted peer message (§2.2) but never checks
that the stored value is an envelope. Worse, two assertions would also pass on
a plaintext row:

```js
db.messages.some((m) => m.ciphertext === 'Hey Benno!' || m.ciphertext === '')   // :2207
```

A regression that silently disabled encryption would keep the whole suite green.

### F-12 (P2) 30 dead translation keys; no parity guard

Probe over `src/` (excluding `translations.ts`): **322 EN keys, 30 unreferenced**
(~9%), incl. `message.copied`, `chat.newMessages`, `contact.title`,
`contact.subtitle`, `errors.loadFailed`, `errors.messagesLoadFailed`,
`errors.searchFailed`, `legal.phone`, `auth.theme`. Verified individually that
these strings appear nowhere in `src/`; the only dynamic `t(key)` call site
(`Privacy.tsx:229`) draws from literal `privacy.*` keys in the same file.

Concrete UX consequence: the copy action (`Chat.tsx:1139`,
`navigator.clipboard.writeText`) gives **no user feedback at all**, while
`message.copied` sits unused in both languages.

EN/DE parity is currently exact (322 / 322, zero one-sided keys — probe), but
**no test guards it**; `t()` silently falls back to English on a missing DE key.

### F-13 (P2) Documentation contradicts the code

Four documents still describe a state that no longer exists:

* `docs/e2ee-crash-rollback-hardening.md:3` — "The complete E2EE integration
  still does NOT exist."; `:11` — "`sendMessage()` still writes plaintext to
  `messages.ciphertext`".
* `docs/e2ee-2c-readiness-gate.md:38,603` — "production E2EE layer is NOT
  STARTED".
* `docs/e2ee-2c-readiness-gate-p0.md:17` — "Production implementation remains
  NOT STARTED and not approved."

All false since E2EE-v0.2. `docs/` holds 24 files / ~13.2 k lines with **no
index and no "historical vs current" marking**, while
`docs/arena-instructions.md` §2 instructs every agent to read the project
documentation first. Stale statements in security documentation are an active
hazard for the agent workflow this repository runs on.

### F-14 (P2) Deploy-path hygiene

* `scripts/deploy-supabase-functions.yml` is a **stale duplicate** of
  `.github/workflows/deploy-supabase-functions.yml` and already diverges
  (missing `node-version: 20`, missing the `PROJECT_REF` guard).
* `supabase/setup-cli@v1` with `version: latest` — unpinned in a workflow that
  holds a Supabase management token.
* The E2E step hardcodes `origin="https://hpmine42.github.io"`, so it cannot
  validate a self-hosted deployment.
* Bundle: 663.89 kB JS with no code splitting (Vite emits the >500 kB warning);
  auth screens download the Signal engine they do not need.

### F-15 (P3) Minor UX inconsistencies

* `aria-label={t('unread.down')}` on the scroll-to-bottom button — an
  `unread.*` key naming a scroll control (`Chat.tsx:1624`).
* `npm run test:rls` prints "pair state restore skipped (This connection is
  blocked.)" and still exits 0. This is **not** a skipped assertion (the notice
  comes from the post-test cleanup block, `rls-tests.sql:561-571`, and the
  harness uses a fresh temp database each run) — but it reads like one.

---

## 5. Tests and their real assertion power

### 5.1 Inventory

| Suite | Tests | What it really proves |
|---|---|---|
| `test:crypto` | 239 | crypto primitives, KDF, sealed state, ratchet state CAS/rollback, revision, migration |
| `test:crypto:engine` | 49 | engine adapter, session manager, SPK rotation, real-engine integration |
| `test:home` | 84 | Home realtime merge, load lifecycle, long-press |
| `test:chatrealtime` | 68 | realtime merge/dedupe/reconciliation for the open chat |
| `test:privacy` | 58 | privacy routing, contact form, Edge-Function runtime |
| `test:api` | 53 | `api.ts` behaviour incl. missing-RPC detection |
| `test:i18n` | 29 | interpolation hardening (values are data, not templates) |
| `test:unread` / `test:read` | 27 / 16 | phantom-unread and monotonic-read regressions |
| `test:errors` | 26 | error-code → message mapping |
| `test:offline` | 21 | sealed snapshot round-trip, offline gating |
| `test:preview` | 20 | deletion attribution in Home previews |
| `test:a11y` | 15 | source-level accessibility contract |
| `test:helpers` | 16 | ordering / hidden-until semantics |
| `test:api-errors` | 13 | data-layer errors surface instead of empty states |
| `test:scroll` / `test:contrast` | 9 / 7 | anchoring decisions; scroll-down contrast rule |
| `test:settings` / `test:input` / `test:blocked` | 7 each | people settings, input hardening, blocked composer |
| `test:chatblocks` | 2 | block-channel scoping |
| **Total** | **773** | |

Plus two live-Postgres harnesses (`test:crypto:prekeys`, `test:rls`) and the
jsdom smoke test.

### 5.2 Honest assessment

**Genuinely strong:** the crypto/ratchet suites (real WASM, real CAS, real
rollback cases), both live-Postgres suites (real RLS, real
`FOR UPDATE SKIP LOCKED` concurrency), the i18n interpolation-hardening suite,
and the smoke test's use of the *real* engine rather than a mock.

**Weak spots:**

1. **Coverage of the automatic gate** — F-03. 485/773 tests and the whole
   migration-chain RLS suite only run when a human remembers to.
2. **Source-level assertions** are an accepted repo pattern
   (`accessibility.test.mjs`, `chat-block-channel.test.mjs`,
   `scroll-down-contrast.test.mjs`) and are *not* runtime verification. The repo
   says so itself (`docs/v03-roadmap.md` §1.3) — that honesty should be kept.
3. **No pixel/layout verification is possible in jsdom.** Every visual
   acceptance criterion (R5/R6, anchoring, contrast) is manual QA that has no
   automated record.
4. **The single most important security property is unasserted** — F-11.
5. **No test asserts EN/DE key parity** or the absence of unused keys — F-12.
6. **No test exercises the E2EE failure states** (manager `null`, identity
   change, `no-device`) end to end — which is exactly where F-01/F-02 live.

---

## 6. UX / UI state

Consistent, calm, mobile-first visual language; the design references in
`design/` are respected. Accessibility work is real (focus traps,
`role="status"` badges, reduced-motion handling, accessible names on bubbles and
dialogs) and partly guarded by tests.

Noticeable inconsistencies:

* **Empty bubbles** while/when decryption is unresolved (F-01) — the most
  visible defect.
* **No feedback on copy** (F-12).
* **Dead ends on crypto errors**: three very different causes (E2EE not ready /
  peer has no device yet / peer identity changed) all surface as one sentence,
  and none of them tells the user what to do (F-01, F-02).
* **Privacy policy unreachable pre-registration** (F-05).
* **Three 1100–1700-line components** make UI changes expensive and are where
  the F-01…F-07 race bugs lived.
* Bundle weight on first paint (F-14).

---

## 7. Proposed roadmap

> Grouping requested by the project owner: **1 critical / before the next
> release · 2 important · 3 sensible later · 4 optional new features.**
> Nothing here is approved. Each item is independent and sized for one focused
> PR, per the repository's established workflow.

### 7.1 CRITICAL — before the next release

| # | Item | Fixes | Shape |
|---|---|---|---|
| **C1** | **Surface E2EE state in the UI.** Consume `ready`/`error` from `useE2EE()`; render a distinct pending state for unresolved bubbles (not `''`) and a distinct failed state with the reason and a retry. Distinguish `NOT_AVAILABLE` / `NEEDS_ESTABLISH` ("peer hasn't opened enough. yet") / `USER_MISMATCH` (identity changed) / storage failure. | F-01, F-02 (partly) | `E2EEContext` (no change), `Chat.tsx`, `MessageBubble.tsx`, ~6 new i18n keys ×2, `errors.ts` CryptoError mapping |
| **C2** | **Identity-change recovery.** A deliberate, explicit, user-confirmed action that clears the TOFU record + the affected session for one peer, with a warning that past messages stay undecryptable. Wire the already-exported `removePeerTrust`. No silent auto-reset. | F-02 | `device-store` (exists), `session-manager`, a Settings/chat entry point, regression tests for "reset only affects that peer" |
| **C3** | **CI on pull requests + full test matrix.** Add a `pull_request` workflow that runs *all* 21 suites plus `test:rls`, `verify:signal-wasm`, `build` and `smoke`. Keep `deploy.yml` as the release gate. | F-03 | `.github/workflows/` — **protected file: propose contents to the owner, do not edit** (v02-roadmap §15, arena-instructions §4) |
| **C4** | **License decision.** Add `LICENSE` + `NOTICE`, set `package.json.license`, and record the AGPL-3.0-only obligation for the shipped WASM. Requires an owner/legal decision, not an implementation. | F-04 | decision + 3 files |
| **C5** | **Cut the release.** Decide the version (0.4.0 is implied by the merged work), bump `package.json`, write `CHANGELOG.md`, tag, and verify the deployed origin afterwards. | F-09 | `package.json`, new `CHANGELOG.md`, release |
| **C6** | **Privacy link on the auth screens.** Add the policy to `LegalFooter`. | F-05 | `LegalFooter.tsx`, 1 existing i18n key, smoke assertion |

Suggested order: **C6 → C3 → C1 → C2 → C4 → C5** (smallest first; C3 gives every
later PR a real gate; C5 last).

### 7.2 IMPORTANT

| # | Item | Fixes |
|---|---|---|
| **W1** | Assert the encryption invariant in the smoke test: peer messages must be stored as envelopes (`isEnvelope(row.ciphertext) === true`) and must **not** equal the plaintext; My Notes must remain plaintext. Replace the `=== 'Hey Benno!' \|\| === ''` assertions. | F-11 |
| **W2** | Message length limit at both boundaries: `maxLength` + counter in the composer, and a server-side `char_length(ciphertext)` constraint in a **new** migration (0015). Report as `SUPABASE MIGRATION / Applied: UNKNOWN`. | F-06 |
| **W3** | Bound the message cache: LRU or per-conversation cap, and load lazily per visible page instead of warming the whole envelope on Home. | F-07 |
| **W4** | Harden the Edge Function: prune/expire rate-limit entries, treat "no API key" as a 503 in production, tighten the origin allowlist, document the abuse ceiling. | F-08 |
| **W5** | Single source of truth for the base schema: add `0000_base.sql` (or make the harness and the doc consume one file) and reconcile the four divergences. | F-10 |
| **W6** | Documentation triage: add `docs/README.md` as an index that marks each file *current* or *historical*, and add a dated status banner to the four documents that contradict the code. Do not rewrite them. | F-13 |
| **W7** | i18n hygiene: automated EN/DE parity test + unused-key test; then either wire up `message.copied` (copy feedback) or delete the dead keys. | F-12 |
| **W8** | Regression tests for the E2EE failure paths (manager `null`, `no-device`, identity change) — the negative cases C1/C2 introduce UI for. | F-01, F-02 |

### 7.3 SENSIBLE LATER

* **S1** — Decompose `Chat.tsx` (1720 lines) into scroll/read, realtime,
  decryption and rendering modules with pure helpers in `src/lib/`, following
  the existing pattern. This is where the F-01…F-07 race bugs lived.
* **S2** — Code-split the Signal engine behind a dynamic `import()` so auth and
  legal screens do not download 797 kB of WASM. (Touches E2EE loading order —
  needs its own plan and the full crypto suite.)
* **S3** — Deploy-path hygiene: remove the stale `scripts/deploy-supabase-functions.yml`
  duplicate, pin `supabase/setup-cli` to a version, parameterize the E2E origin.
* **S4** — Safety-number / fingerprint UI: display and compare peer identity
  keys, so "verified" becomes a real state instead of a `PeerTrustState` value
  that is always `'unverified'`.
* **S5** — Key backup / recovery, or at minimum an explicit "you will lose this
  conversation if you clear browser data" warning at the moments that matter.
* **S6** — Automated visual/contrast checks (Playwright + axe against the built
  bundle) to replace the manual verdicts the repo currently cannot record.
* **S7** — Rate/abuse limits on message insertion (per-connection frequency),
  server-side.
* **S8** — Observability for crypto failures: a privacy-preserving, content-free
  counter of failure classes, so F-01-type problems become visible.

### 7.4 OPTIONAL NEW FEATURES (product decisions, not technical work)

All of these were explicitly excluded by `docs/v02-roadmap-audit.md` §11 and
`docs/v03-roadmap.md` §6. Each needs its own approved feature roadmap:

* Typing indicator · presence/online · read receipts toward peers
* Message reactions
* "Mark as unread"
* Offline send queue (currently a deliberate `return` in `Chat.tsx:951`)
* Push notifications (note: would change the privacy policy and the PWA posture)
* Multi-device support (large architecture change; conflicts with the
  single-device E2EE model)
* Group chats · media/file sharing · voice messages · calls
* Avatar/profile-picture upload
* Additional languages · OAuth / federated login · admin roles

---

## 8. Recommendation — what to work on next

**Do C6, then C3, then C1.**

* **C6 (privacy link on auth screens)** is a one-line, zero-risk fix that closes
  a legal-transparency gap. Ship it first.
* **C3 (PR CI)** is the highest leverage item in the whole list: it is pure
  configuration, changes no application behaviour, and it is the precondition
  for trusting anything that follows. Today, 485 tests and the entire
  migration-chain RLS suite run only if someone remembers to.
* **C1 (surface E2EE state)** is the highest-value user-facing fix. The
  encryption itself is demonstrably correct (§2.2); what is missing is that the
  app cannot tell the user anything when it is not. Until C1 lands, every
  crypto-adjacent failure looks identical and unsolvable from the inside.

**C2 (identity-change recovery)** should follow C1 immediately — C1 makes the
problem visible, C2 makes it recoverable. Together they close the two P0
findings that affect real users.

**C4 (license)** needs an owner decision and should be started in parallel
because it does not depend on code.

**C5 (release)** comes last and should not be cut before C1/C2/C6.

Then, and only then, W1 — asserting the encryption invariant — because it is the
cheapest way to make sure none of the above ever regresses silently.

---

## 9. Explicitly out of scope for this document

No source code, migration, workflow, translation, or configuration file was
modified. No E2EE architecture change is proposed. `docs/arena-instructions.md`,
`docs/v02-roadmap-audit.md` and `docs/v03-roadmap.md` were read and not
touched. No secrets were introduced. Nothing was deployed.
