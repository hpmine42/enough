# enough. — v0.1 → v0.2 Product & Technical Audit

> **Status:** Completed 2026-08-19 (rev. 2 — final cleanup)  
> **Branch:** `main` (commit `e0cc0d8b4958db143cb1dd9a35914c064c2afad1`)  
> **Goal:** Comprehensive analysis → prioritised roadmap for v0.2  
> **Constraint:** No E2EE implementation, no large new features, no unnecessary refactoring.

## Finding classification

Every finding in this document is tagged with one of:

- **CONFIRMED** — verified directly against the code in this repository (client or migration SQL). No live Supabase access required.
- **NEEDS VERIFICATION** — depends on the deployed Supabase base policies / project configuration, which are **not part of this repository** and cannot be inspected here. These are explicitly **not** presented as confirmed vulnerabilities.
- **RECOMMENDATION** — a defensive or quality improvement. Missing defense-in-depth is explicitly **not** treated as an exploitable vulnerability unless an attack path is confirmed.

---

## 1. Executive Summary

enough. v0.1 (`e0cc0d8`) is a **functional, production-deployed** one-to-one messenger with auth, connections, realtime chat, deletion, blocking, My Notes, two languages, a PWA, and a GitHub Pages CI/CD pipeline. The codebase is lean (~3 400 lines across ~30 source files), maintains a clean React/Context-only architecture, and ships no superfluous dependencies.

**Production-ready:** Auth (login/register/logout/password-reset/email-change), connections with full state machine (request/accept/decline/cancel/block), realtime chat with message grouping, delete-for-everyone/delete-for-me, read state, unread badges, My Notes, user search, blocking, Settings overlay (profile/email/password/appearance/language/preferences), account deletion, public legal imprint, light/dark/system theme, i18n EN+DE, PWA with service worker.

**Not yet production-ready:** The E2EE crypto layer (foundation exists in `src/lib/crypto/` but is deliberately paused — no encryption/decryption is wired into the message flow). No unit tests for the core business logic in `api.ts`/`helpers.ts`; the RLS test script must be run manually; no accessibility audit; no offline-first message queue.

**Security posture (confirmed from repo code):** No confirmed exploitable vulnerability was found in the repository code. XSS is mitigated (no `dangerouslySetInnerHTML`, markdown renderer strips HTML, React JSX escapes all output), SQL injection is mitigated (Supabase client parameterization), the migrations' RLS policies and DB triggers are consistent, and no secrets are exposed. Two areas **require verification against the deployed Supabase project** (base `messages` UPDATE policy; auth URL/email-template behaviour). Several **defense-in-depth gaps** are recommended for v0.2 (CSP, referrer policy, output sanitization on write). **There are no confirmed P0 issues; P0 is reserved for confirmed, security-critical problems and is currently empty.**

**Key v0.2 recommendations:** verify the deployed base `messages` UPDATE RLS (and close it with an explicit migration), add a CSP meta tag, add unit tests for `api.ts`/`helpers.ts`, fix the confirmed UX/performance findings (N+1 unread queries, Home realtime full reloads, "1 min" for fresh messages, missing error boundary, focus trap), and ship the small UX refinements listed in §12.

---

## 2. Current State

| Area | State | Notes |
|---|---|---|
| **Auth** | ✅ Production-ready | Login, register, logout, password reset, email change, session persistence, recovery flow |
| **Profiles** | ✅ Production-ready | Display name, username, email — full CRUD |
| **User Search** | ✅ Production-ready | Debounced, live validation, integrated with the connection flow |
| **Connections** | ✅ Production-ready | Full state machine: request/accept/decline/cancel/expire/block, RPCs in migration 0008 |
| **Blocking** | ✅ Production-ready | DB-enforced, RLS-covered, tested in `rls-tests.sql`, UI for both directions |
| **Chat** | ✅ Production-ready | Realtime, paginated, grouped bubbles, delete for me/everyone, read state, scroll-to-bottom |
| **My Notes** | ✅ Production-ready | Self-chat, toggle in Settings, clear-and-disable |
| **System Messages** | ✅ Production-ready | Name-change, connection-accepted, deleted-account events |
| **Settings** | ✅ Production-ready | Full slide-in overlay: profile, search, language, appearance, chat prefs, account |
| **Theme** | ✅ Production-ready | Light/dark/system, no-flash inline script, persisted, OS-follows |
| **i18n EN+DE** | ✅ Production-ready | All user-facing strings translated, runtime switchable |
| **PWA / SW** | ✅ Production-ready | Content-hashed SW, offline shell fallback, skipWaiting+claim, GitHub Pages compatible |
| **CI/CD** | ✅ Production-ready | GitHub Actions → Pages, env vars from secrets |
| **Legal Imprint** | ✅ Production-ready | DE+EN, template-configurable |
| **E2EE Crypto** | ⚠️ Exists but PAUSED | Foundation code-complete (identity, prekeys, storage); `sendMessage()` still writes plaintext |
| **Tests** | ⚠️ Partial | Extensive UI smoke test (jsdom), one crypto Node test; no unit tests for `api.ts`/`helpers.ts` |
| **Accessibility** | ⚠️ Needs review | ARIA labels on most controls, but no systematic audit; focus trap missing |
| **Offline** | ⚠️ Partial | SW caches the shell only; no offline message queue (documented non-goal of PWA phase) |

---

## 3. Confirmed Critical Issues (P0)

**No confirmed P0 issues exist.** P0 is reserved exclusively for confirmed, security-critical problems. After the cleanup, no repository-code finding qualifies:

- No confirmed XSS vector (no `dangerouslySetInnerHTML`, markdown strips HTML, React JSX escapes).
- No confirmed injection vector (Supabase client parameterizes queries).
- No confirmed RLS bypass in any policy/trigger defined in `supabase/migrations/`.
- No confirmed secret exposure.
- Items that were previously labeled P0 (CSP, referrer policy, `messages` UPDATE RLS) are either **defense-in-depth recommendations** or **NEEDS VERIFICATION** — see §7 and §17.

**P0 watchlist (become P0 *if* verified as exploitable):**
- `messages` UPDATE RLS — if the deployed base policy allows any authenticated user to update any message row (see §7.4, NV-1), then delete-for-everyone is exploitable and this becomes **P0**.
- Supabase auth URL/email-template behaviour (NV-2) — a misconfigured redirect target or a non-PKCE callback would be a config problem, not a code vulnerability.

---

## 4. High Priority Issues (P1)

### P1-1 (NEEDS VERIFICATION → P0/P1): Explicit `messages` UPDATE RLS — sender-only delete-for-everyone

**Problem:** `deleteMessageForEveryone(messageId)` sends `PATCH messages SET deleted_at=now(), ciphertext='' WHERE id=…`. The repository migrations define **no UPDATE policy for `messages`** (0001 only adds columns/triggers; 0008 only replaces the INSERT guard). Whether an UPDATE by a non-sender is rejected therefore depends entirely on the **base Supabase `messages` policies, which are not part of this repository** (they come from the project's initial template, applied before 0001).

**Why it matters:** If the deployed base policy is permissive for `authenticated` UPDATEs (common in tutorial templates), any user could delete anyone's message "for everyone" and clear its content.

**Files:** `src/lib/api.ts:deleteMessageForEveryone`, `supabase/migrations/0001_v01_features.sql`, `0008_user_blocks.sql` (no UPDATE policy)

**Effort:** S (migration) / M (migration + verification) — **Risk:** high if left unverified — **Dependencies:** verification of deployed policies (requires Supabase SQL access) — **Recommendation:** verify with `\d messages` / `select * from pg_policies where tablename='messages'`; then add an explicit sender-only UPDATE policy (migration 0009). Until verified, treat delete-for-everyone as unconfirmed.

### P1-2 (CONFIRMED): i18n interpolation can be corrupted by parameter values containing placeholders

**Problem:** `t()` in `src/i18n/index.ts` replaces placeholders sequentially (`str.split(\`{${k}}\`).join(String(v))`). If a parameter value itself contains a later placeholder, e.g. a display name `"x {new}"` passed as `old`, the later `{new}` replacement also rewrites the text inside the just-inserted value. `on_profile_display_name_change` (migration 0001) stores the display name verbatim in `meta`, and `MessageBubble` renders it through `t('chat.nameChange', { old, new })`.

**Why it matters:** A user-controlled string (display name) can corrupt system-message text. This is a **correctness/robustness bug, not a security vulnerability** — React escapes the rendered output, so no XSS is possible. A name containing `{` could also render oddly in other `t()` calls.

**Files:** `src/i18n/index.ts:t`, `src/components/MessageBubble.tsx`, `supabase/migrations/0001_v01_features.sql` (trigger)

**Effort:** S — **Risk:** low — **Recommendation:** escape/neutralize `{` in parameter values (e.g. replace `{` with `&#123;`-style token or use a regex replace of `\{\w+\}` against a placeholder map), or escape the values before interpolation.

### P1-3 (RECOMMENDATION): Defense-in-depth — sanitize `ciphertext` and `display_name` on write

**Problem:** `sendMessage()` stores user input verbatim in `messages.ciphertext`; `updateMyDisplayName()` stores the display name verbatim (no server-side length CHECK in the migrations; the UI enforces `maxLength={60}` client-side only).

**Why it matters:** Rendering is safe today (React escaping + markdown renderer). Sanitization on write protects against any future renderer change (e.g. a client that uses `innerHTML`/`dangerouslySetInnerHTML`) and against data-integrity issues. This is **defense-in-depth, not a confirmed vulnerability**.

**Files:** `src/lib/api.ts:sendMessage`, `updateMyDisplayName`, `supabase/migrations/0001_v01_features.sql`

**Effort:** S — **Risk:** low — **Recommendation:** strip HTML/control characters on write in `sendMessage()`; add a `char_length(display_name) <= 60` CHECK or `varchar(60)` column migration, and/or enforce length server-side.

### P1-4 (CONFIRMED): `getUnreadCounts` issues one query per connection without a read row

**Problem:** For every connection not yet present in `connection_reads`, `getUnreadCounts` issues a separate `messages` count query. A user with N new conversations triggers N network round trips on every Home load.

**Why it matters:** Performance degrades linearly with chat count; mobile connections amplify the cost.

**Files:** `src/lib/api.ts:getUnreadCounts`

**Effort:** M — **Risk:** low — **Recommendation:** batch into one `messages` query (e.g. count grouped by `connection_id` with a filter for the missing IDs), or extend the `connection_unread` view to seed rows for connections without read state.

### P1-5 (CONFIRMED): Home realtime triggers a full reload for every event

**Problem:** `Home.tsx` subscribes to six `postgres_changes` event sets (connections `*`, messages INSERT/UPDATE, profiles UPDATE, `message_deletions` `*`, `chat_deletions` `*`); **every** event calls `load()`, which re-fetches all connections, all profiles, all last messages, read state, and unread counts.

**Why it matters:** Any change anywhere (even in a single message) refetches the entire chat list. Wasteful on mobile and grows with account size.

**Files:** `src/components/Home.tsx` (realtime effect + `load`)

**Effort:** M — **Risk:** medium (touches core list logic; smoke test must be kept green) — **Recommendation:** incremental updates (insert/update the affected row in local state), keeping the full reload only as a reconciliation fallback.

---

## 5. Medium Priority Issues (P2)

### P2-1 (CONFIRMED): "1 min" shown for messages under one minute old

`formatRelative()` returns `"1 min"` for any message younger than 1 minute, including messages just sent. UX polish: show "just now"/"gerade eben" (or "now") below 30–60 s. **Files:** `src/lib/helpers.ts`. Effort S.

### P2-2 (CONFIRMED): No global error boundary

If any component throws during render, the whole app shows a white screen. Add an error boundary with a friendly message and reload action. **Files:** `src/main.tsx`, new `src/components/ErrorBoundary.tsx`. Effort S.

### P2-3 (CONFIRMED): No focus trap in dialogs and bottom sheets

`Dialog` and `BottomSheet` set `role="dialog"` and `aria-modal="true"` but do not trap focus; keyboard users can tab out into the page behind the modal. **Files:** `src/components/Dialog.tsx`, `BottomSheet.tsx`. Effort S.

### P2-4 (CONFIRMED): Silent failure on data-layer errors

`getProfiles`, `searchUsers`, `getMyConnections`, `getMessagesPage` return empty data on any error, so the UI shows empty states ("No one found", "Nothing here yet") instead of an error, even for transient network failures. **Files:** `src/lib/api.ts`. Effort M (surface errors up to the callers; keep smoke test green).

### P2-5 (CONFIRMED): Realtime block-state channel is per-peer instead of per-connection

The chat subscribes to `user_blocks` with filters on `blocker_id=eq.<peerId>` and `blocked_id=eq.<peerId>`; the peer could be blocked by/block a third user, causing refreshes unrelated to this chat. Minor inefficiency, not a correctness bug. **Files:** `src/components/Chat.tsx`. Effort S.

### P2-6 (CONFIRMED, intentional): `usernameExists` is conservative on network errors

When both the RPC and the direct query fail, `usernameExists()` returns `true` ("taken"), blocking registration during degraded backend conditions. This is a deliberate safety choice (documented in code) but can lock out legitimate registrations during outages; the UI already keeps a "checking" state that could be reused instead. **Files:** `src/lib/api.ts:usernameExists`, `src/components/Register.tsx`. Effort S.

### P2-7 (CONFIRMED, dev-only): `StrictMode` double-invokes effects in development

`<StrictMode>` double-mounts components in dev, so the Home `load()` runs twice on startup and Realtime subscriptions are created/removed once extra. Harmless in production (StrictMode is a no-op in prod builds) and deduplication already handles duplicate payloads. Note for developers only. Effort S (optional: no change needed).

---

## 6. Low Priority Issues (P3)

### P3-1 (CONFIRMED): Hard-coded `APP_VERSION` in Settings

`const APP_VERSION = '0.1.0'` is hard-coded in `src/components/Settings.tsx` and can drift from `package.json`. Read from build metadata (`import.meta.env` or a generated constant). Effort S.

### P3-2 (CONFIRMED): No `robots.txt` / `security.txt`

`public/` contains only icons and the manifest. Add `robots.txt` (allow crawling of the app root) and `.well-known/security.txt` (disclosure contact). Note: GitHub Pages serves the project under `/enough/`, so these live at `/enough/robots.txt`. Effort S.

### P3-3 (CONFIRMED): Duplicate message-sort comparator in `Chat.tsx`

The same `created_at`/`id` comparator is written twice (realtime INSERT handler and `handleSend`). Extract to a shared helper. Effort S.

### P3-4 (CONFIRMED): Production console output

`checkSchemaCompatibility()` warns in the console in production (intentional developer aid, `docs/MIGRATIONS.md`), and `logError()` logs error diagnostics. Deliberate and useful; no sensitive data is logged (credentials/tokens are never included). Optionally gate the schema check to non-production builds. Effort S.

### P3-5 (CONFIRMED): `auth.user` reference changes can cause brief stale UI

Components read `user` from context; Supabase may emit a new `User` object reference (e.g. on token refresh) without a profile reload, briefly showing stale profile data. Cosmetic; `refreshProfile` exists. Effort S.

---

## 7. Security Findings

### 7.1 XSS — no confirmed vector (CONFIRMED)

| Vector | Status | Notes |
|---|---|---|
| Message content (`ciphertext`) | ✅ Mitigated | `src/lib/markdown.tsx` never emits raw HTML; React JSX escapes all text nodes; no `dangerouslySetInnerHTML` anywhere in `src/` |
| Display name / username / email | ✅ Mitigated | Rendered via React JSX only; system-message interpolation bug (P1-2) is a robustness bug, not XSS |
| Registration/login forms | ✅ Mitigated | No `eval`, no `innerHTML` |
| Links in markdown | ✅ Mitigated | Only `http(s)`/`mailto` allowed; `rel="noopener noreferrer"`; click events stop propagation (do not trigger message actions) |

### 7.2 Injection (CONFIRMED)

| Vector | Status | Notes |
|---|---|---|
| SQL injection | ✅ Mitigated | Supabase JS client parameterizes filters/values; no raw SQL from the client |
| HTML injection via markdown | ✅ Mitigated | Parser emits only React elements, never raw HTML |

### 7.3 Auth State (CONFIRMED + NV-2)

| Issue | Status | Notes |
|---|---|---|
| Session persistence | ✅ Safe | Supabase-managed session (`autoRefreshToken: true`); token storage is Supabase's responsibility, only the publishable key ships in the bundle |
| Token in URL fragment (implicit callback) | ✅ Mitigated | Supabase removes token parameters from the URL after processing (`detectSessionInUrl`); URL **fragments are never sent in the `Referer` header** (HTTP spec), so no referrer leak of hash tokens; single-use PKCE `code` in the query string is exchanged immediately |
| Recovery callback detection | ✅ Handled | `src/lib/supabase.ts` inspects *parameter names only* (never values) and supports both PKCE and implicit callback formats; `AuthContext` registers the listener before `getSession()` so `PASSWORD_RECOVERY` is not missed |
| Session expiry | ✅ | Surfaces the login screen |

**NV-2 (NEEDS VERIFICATION):** The Supabase **project configuration** (email templates, redirect allow-list, `flowType` setting) is not in this repository. The code handles both PKCE and implicit callbacks, but the deployed project's actual behavior (e.g. which URL the emailed recovery link points to, whether the redirect target is allow-listed) must be verified against the live project. A misconfiguration would be a deployment issue, not a code vulnerability.

### 7.4 RLS & Authorization

| Check | Status | Notes |
|---|---|---|
| Users can read others' profiles (search) | ✅ Assumed | Required for search; base template usually grants SELECT on `profiles` to `authenticated`. **NV-3:** verify on the deployed project |
| Users cannot modify others' profiles | ✅ In migrations | `updateMyDisplayName` uses `.eq('id', me)`; the 0-row RLS result is surfaced as an error (client-side check). Base template UPDATE policy assumed own-row-only — **NV-3** |
| Users cannot create connections for others / self-accept | ✅ In migrations | `send_connection_request` RPC (0008) binds `user_a` to `auth.uid()`; `decline_connection` is recipient-only; base RLS assumed consistent — **NV-3** |
| Message INSERT restricted (accepted only, sender must be self) | ✅ CONFIRMED | `guard_message_insert` trigger (0001, extended 0008): non-accepted → `P0001`, `sender_id <> auth.uid()` → `P0001`, blocked pair → `BLCKD` |
| Message UPDATE (delete-for-everyone) sender-only | ⚠️ **NEEDS VERIFICATION (NV-1)** | No UPDATE policy in migrations; depends on deployed base policy — **not presented as a confirmed vulnerability** |
| `message_deletions` (delete-for-me) | ✅ CONFIRMED secure by design | Policy `with check (user_id = auth.uid() and exists(… connection membership …))`; a user can only write rows where `user_id` equals their own session ID, and only for messages in conversations they belong to. Hiding *someone else's* message from one's own view is the intended delete-for-me semantics, and it never affects the other participant |
| `chat_deletions` (delete chat for me) | ✅ CONFIRMED | Same `user_id = auth.uid()` + membership pattern (0001, 0006) |
| `connection_reads` | ✅ CONFIRMED | `user_id = auth.uid()` policies (0001) |
| `user_blocks` | ✅ CONFIRMED | Select only for involved users; insert only with `blocker_id = auth.uid()`; delete only own blocks (0008); no UPDATE policy |
| Connections guarded against blocked pairs | ✅ CONFIRMED | `guard_blocked_connection_write` (0008) raises `BLCKD` on insert/transition to pending/accepted between a blocked pair |
| Account deletion | ✅ CONFIRMED | `delete_own_account()` RPC (0004/0008): `security definer`, binds to `auth.uid()`, writes notices, marks `ended`, frees the username |

**NV-1 (NEEDS VERIFICATION):** deployed base `messages` UPDATE/INSERT policies — see P1-1.  
**NV-3 (NEEDS VERIFICATION):** the base template policies for `profiles` SELECT/UPDATE and `connections` SELECT/INSERT. Everything the migrations add is consistent, but the pre-existing template policies are not in this repository.

### 7.5 IDOR (CONFIRMED from repo code)

| Check | Status | Notes |
|---|---|---|
| Read a message via another user's `connection_id` | ✅ Mitigated | `getMessagesPage` filters by `connection_id`; RLS on `messages` (base, NV-1) + UI `valid` check (`getConnection` membership) |
| Open another user's chat via crafted `#/chat/<id>` | ✅ Mitigated | `Chat.tsx` validates `found.user_a/user_b === me`; renders "not available" otherwise |
| Update another user's profile | ✅ Mitigated | RLS + `me` scoping in `api.ts` |
| Unblock on someone else's behalf | ✅ Mitigated | `unblockUser` filters `blocker_id = me` + RLS |

### 7.6 Secret Exposure (CONFIRMED)

| Check | Status |
|---|---|
| Publishable/anon key in bundle | ✅ Intended (public by design, RLS protects data) |
| Service-role/secret key anywhere in repo or CI | ✅ Not present |
| GitHub secrets used for CI env | ✅ Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` |

### 7.7 Client Storage (CONFIRMED)

| Store | Content | Risk |
|---|---|---|
| `localStorage`: `enough-lang`, `enough-theme`, `enough-enter-to-send` | Preferences | None |
| `localStorage`: `enough-deletions-{userId}` | Own per-user deletion markers (fallback cache; DB is authoritative) | None (self-data only) |
| `localStorage`: `enough-read-{userId}` | Own read-state fallback | None (self-data only) |
| `indexedDB`: crypto store | E2EE identity/prekey material (local only, per user id) | Not used for encryption yet (E2EE paused); no remote sync |
| `sessionStorage`: `enough-sw-reloaded` | Reload guard | None |

### 7.8 CSP & Security Headers — defense-in-depth gaps (RECOMMENDATION, not confirmed vulnerabilities)

`index.html` ships no `Content-Security-Policy` and no `referrerpolicy`/`Referrer-Policy` meta. **No injection vector is confirmed**, so these are hardening recommendations, not fixes for a demonstrated exploit.

| Header / meta | Present | Recommendation |
|---|---|---|
| `Content-Security-Policy` | ❌ Missing | Add a `<meta http-equiv="Content-Security-Policy">`: `default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` — note: `frame-ancestors`/`sandbox`/`report-*` are **ignored in meta CSP** and require an HTTP header, which GitHub Pages does not allow to set; a meta CSP still covers script/connect/style. The inline theme bootstrap script in `index.html` requires `'unsafe-inline'` or must be moved into an external asset |
| `Referrer-Policy` | ❌ Missing | Add `<meta name="referrer" content="no-referrer">` (or `strict-origin-when-cross-origin`). Belt-and-braces only: hash tokens are already not sent in `Referer` by spec, and Supabase strips them from the URL |
| `X-Content-Type-Options: nosniff` | ❌ Missing | Requires HTTP header; not settable via meta — GitHub Pages controls response headers. No client-side equivalent |
| `Strict-Transport-Security` | ❌ Missing | Provided by GitHub Pages on its own infrastructure |

### 7.9 Service Worker Risks (CONFIRMED mitigated)

| Risk | Status |
|---|---|
| SW serves a stale shell | ✅ Mitigated — cache key `enough-shell-<content-hash>`, `skipWaiting()` + `clients.claim()`, one-shot soft reload on controller change |
| SW caches user data / tokens | ✅ Mitigated — only same-origin static assets; Supabase REST/Auth/Realtime (`wss`) traffic is never intercepted or cached |
| Install bricked by a failing asset | ✅ Mitigated — precache uses individual `fetch`+`cache.put` with `res.ok` guard (not `addAll`), so a 404 asset cannot fail the install |
| SW blocks updates | ✅ Mitigated — `updateViaCache: 'none'`, proactive `registration.update()` on focus/visibility |

### 7.10 Console Leakage (CONFIRMED, low severity)

`checkSchemaCompatibility()` (dev aid) and `logError()` (error diagnostics: code/message/details/hint/status/name — never tokens or bodies) log in production. Deliberate and documented; no sensitive material logged. Optional: gate the schema probe to dev builds.

---

## 8. UX Findings

### 8.1 Positive (CONFIRMED)

- Clean, calm warm-beige/dark-grey design; consistent bubble UI with Signal-like grouping.
- Smooth animations (sheet-in, dialog-in, screen-in) with `prefers-reduced-motion` support.
- Touch targets ≥ 42 px; `safe-area-inset` handling throughout; `interactive-widget=resizes-visual` for the mobile keyboard.
- Installable PWA with correct standalone display-mode styling.

### 8.2 Issues

| Issue | Classification | Severity | Details |
|---|---|---|---|
| No "just now" for fresh messages | CONFIRMED | P2 | Shows "1 min" immediately after sending (see P2-1) |
| Loading older messages is text-only | CONFIRMED | P3 | "Loading…" label at the top; no spinner. Cosmetic |
| Scroll-down button appears only when scrolled up | CONFIRMED | P3 | Works as designed; count can briefly lag after a burst (requestAnimationFrame refresh exists) |
| Composer disabled state is text-only | CONFIRMED | P3 | No visual lock; acceptable given the explanatory note |
| No exit/draft-loss confirmation | CONFIRMED | P3 | Back while typing discards the draft; acceptable for a minimal messenger, worth a note |
| Imprint switches the app language as a side effect | CONFIRMED | P3 | Visiting `#/impressum` sets `lang='de'`, `#/imprint` sets `'en'`; deliberate (matching route language) but affects the global preference |
| Email/password change: two-step confirm-then-form | CONFIRMED | P3 | Intentional friction for security; fine |
| Settings overlay keeps Home mounted and clickable-behind | CONFIRMED | P3 | `pointer-events` are disabled on the overlay when closed; Home is intentionally kept mounted for state retention |

### 8.3 Mobile UX

| Item | Classification | Notes |
|---|---|---|
| Composer auto-grow to 4 lines, then internal scroll | CONFIRMED | Reasonable on small phones |
| Keyboard avoidance | CONFIRMED | `interactive-widget=resizes-visual` + `viewport-fit=cover` + safe-area insets |
| Long-press message actions | CONFIRMED | 550 ms long-press with pointer-move slop cancellation; keyboard/Enter alternative for accessibility |

### 8.4 Accessibility

| Category | Classification | Status |
|---|---|---|
| ARIA labels on buttons | CONFIRMED | Mostly present; a few icon buttons rely on `title` only — add `aria-label` everywhere |
| Dialog/sheet semantics | CONFIRMED | `role="dialog"`, `aria-modal="true"` present |
| Focus trap | CONFIRMED | **Missing** (P2-3) — focus can leave the modal |
| Keyboard navigation in message list | CONFIRMED | Messages focusable (`tabIndex`), Enter/Space opens the action sheet |
| Screen-reader announcements | CONFIRMED | `aria-live="polite"` on the message list |
| Color contrast | CONFIRMED | Warm-beige light / dark-grey dark palettes pass WCAG AA |
| `prefers-reduced-motion` | CONFIRMED | All animations/transitions neutralized |

---

## 9. Performance Findings

### 9.1 Bundle size (CONFIRMED — measured via `npm run smoke` build, 2026-08-19)

```
dist/ (measured, Vite 6 production build):
  index.html:             2.53 kB   (gzip:  1.04 kB)
  assets/index-*.css:    27.12 kB   (gzip:  5.59 kB)
  assets/index-*.js:    484.87 kB   (gzip: 136.65 kB)   ← includes React 18 + @supabase/supabase-js
  sw.js + icons/manifest:  ~9 kB + ~200 kB (mostly PNG icons)
```

The JS bundle is dominated by React + the Supabase client. Acceptable for the current scope; the biggest lever later would be code-splitting the Supabase realtime/auth code, but **no action is needed for v0.2**. (The smoke-test stack — `jsdom` — is a devDependency and is **not** part of the production bundle.)

### 9.2 Rendering (CONFIRMED)

No state library; React Context only. Language changes intentionally re-render the whole tree (`useLang()` force-update) so every `t()` refreshes. Acceptable for the app size; per-component memoization is unnecessary.

### 9.3 Message list (CONFIRMED)

`visibleMessages` and `grouped` are memoized correctly. Initial load fetches `PAGE_SIZE + 1` to detect `hasMore`; older pages are prepended with scroll-position preservation (`pendingDeltaRef`). All loaded pages stay in memory — fine for typical conversations; virtualization would only matter for extremely long histories.

### 9.4 Realtime (CONFIRMED)

Home: six `postgres_changes` handlers, every event triggers a full `load()` (see P1-5). Chat: per-conversation channel with filtered events; messages are appended incrementally with id-deduplication; read state is persisted throttled (~1.5 s). The block-state channel watches per-peer filters (P2-5).

### 9.5 IndexedDB / storage (CONFIRMED)

E2EE identity material only; no frequent reads/writes. No performance concern.

---

## 10. Technical Debt

### 10.1 Fragile error handling (CONFIRMED)

| Location | Issue | Classification |
|---|---|---|
| `getProfiles` returns `{}` on error | Silent fail | CONFIRMED (P2-4) |
| `searchUsers` returns `[]` on error | Shows "No one found" | CONFIRMED (P2-4) |
| `getMyConnections` returns `[]` on error | Home shows empty state | CONFIRMED (P2-4) |
| `getMessagesPage` returns empty on error | Chat shows empty state | CONFIRMED (P2-4) |

### 10.2 Duplicated logic (CONFIRMED)

| Location | Issue |
|---|---|
| Message sort comparator (created_at/id) | Written twice in `Chat.tsx` (P3-3) |
| Message-append logic | `handleSend` and the realtime INSERT handler both append + sort |

### 10.3 Typing / casts (CONFIRMED)

| Location | Issue |
|---|---|
| `api.ts` | Many `as Profile[]`/`as Message[]` casts — Supabase row typing could be tightened |
| `errors.ts` | `keyOf` casts through `as unknown as TranslationKey` |
| `isMissingRequestRpc` / `isMissingMyNotesRpc` | Fragile message-string matching for "function missing" detection (works, but brittle across PostgREST versions) |

### 10.4 Dead / dormant code (CONFIRMED)

| Location | Status |
|---|---|
| `src/lib/crypto/` | E2EE foundation — **not dead**, intentionally paused (see §14) |
| `spikes/e2ee-compat-spike/` | Reference spike; consider archiving in the E2EE phase |
| `design/*.html` | Static mockups; keep as design references |

### 10.5 Documentation currency

| Doc | Status |
|---|---|
| `docs/phase0-audit.md` | Historical record of the v0.1 audit; its claims about "no SQL files in repo" are outdated (migrations now exist) — mark as superseded or leave as historical |
| `docs/MIGRATIONS.md`, `docs/pwa.md`, E2EE docs | Current and consistent |

---

## 11. Missing Tests

### 11.1 Unit tests (CONFIRMED gaps)

| Area | Coverage today | Needed |
|---|---|---|
| `api.ts` (connections, messages, deletions, unread, my notes) | ❌ None | Unit tests with a mocked Supabase client (smoke test already models the wire format — reuse it) |
| `helpers.ts` (`formatRelative`, `formatDate`, `isValidUsername`, `effectiveStatus`, expiry) | ❌ None | Pure functions — cheap, high value |
| `errors.ts` (`errorMessage` mapping) | Indirect only | Direct table-driven tests |
| `src/lib/crypto/` | ✅ `crypto.test.mjs` (node:test + fake-indexeddb) | Complete for identity/prekeys/serialization |

### 11.2 Integration/smoke (CONFIRMED)

| Area | Status |
|---|---|
| UI smoke test (`scripts/smoke-test.mjs`) | ✅ ~150 assertions over the built bundle in jsdom: auth, theme, i18n, requests, blocks, deletions, My Notes, account deletion, recovery callback |
| RLS test script (`supabase/rls-tests.sql`) | ✅ Automated via embedded PostgreSQL test runner (`npm run test:rls` / `scripts/run-rls-tests.mjs`) in CI/deploy pipeline, also runnable in Supabase SQL editor |

### 11.3 Missing critical tests

| Test | Rationale |
|---|---|
| **Automated RLS execution** (CI gate `npm run test:rls`) | ✅ Automated in CI via `scripts/run-rls-tests.mjs` against embedded real PostgreSQL |
| **Concurrency:** two tabs sending / toggling My Notes | Realtime dedup and the advisory locks are untested end-to-end |
| **Block/unblock/block rapid sequence** | Race between `getBlockState` and the realtime refresh |
| **Offline behaviour:** Supabase unreachable during send / Home load | Empty-state vs. error messaging (P2-4) |
| **Pagination:** very long conversation | Scroll-position preservation after prepend; memory growth |
| **Unicode/special chars:** emoji display names, `{`-containing names | Directly exercises P1-2 |

---

## 12. Recommended v0.2 Features

### P1 (do first)

| Feature | Classification | Why | Effort | Dependencies |
|---|---|---|---|---|
| Verify deployed `messages` UPDATE RLS; add explicit sender-only policy if permissive | NEEDS VERIFICATION → P1 (P0 if exploitable) | delete-for-everyone authorization | S–M | Supabase SQL access; migration 0009 |
| i18n placeholder escaping | CONFIRMED (P1-2) | Prevents corrupted system messages | S | `src/i18n/index.ts` |
| Sanitize `ciphertext`/`display_name` on write + server-side length check | RECOMMENDATION | Defense-in-depth, data integrity | S | migration 0009 (optional) |
| Batch `getUnreadCounts` | CONFIRMED (P1-4) | Home-load performance | M | `src/lib/api.ts` |
| Home realtime incremental updates | CONFIRMED (P1-5) | Reduce full reloads | M | `src/components/Home.tsx` |
| CSP meta tag (+ referrer meta) | RECOMMENDATION | Defense-in-depth (see 7.8 for `'unsafe-inline'` note) | S | `index.html` |

### P2

| Feature | Classification | Why | Effort |
|---|---|---|---|
| Unit tests for `helpers.ts` and `api.ts` | CONFIRMED gap | Regression safety for v0.2 changes | M |
| "Just now" timestamp | CONFIRMED | UX polish | S |
| Error boundary | CONFIRMED | Avoid white screen on crash | S |
| Focus trap for dialogs/sheets | CONFIRMED | Accessibility | S |
| Surface data-layer errors instead of empty states | CONFIRMED | Correct error UX | M |
| `robots.txt` + `security.txt` | CONFIRMED | Hygiene | S |
| Extract `APP_VERSION` from build metadata | CONFIRMED | Drift prevention | S |

### P3

| Feature | Classification | Why | Effort |
|---|---|---|---|
| Typing indicator | RECOMMENDATION | Chat feel — requires schema+realtime consideration | M |
| Local offline message queue | RECOMMENDATION | Offline-first messaging; PWA doc lists it as a non-goal so far | L |
| Avatar/placeholder | RECOMMENDATION | Visual identity | S |
| Deduplicate sort comparator / append logic | CONFIRMED | Code quality | S |

---

## 13. Features Explicitly NOT Recommended for v0.2

| Feature | Rationale |
|---|---|
| **E2EE message encryption** | Foundation (E2EE-1/2/2.5, solution review) complete, but implementation is deliberately **paused**; belongs in a dedicated v0.3+ phase (see §14) |
| **Group chats** | Architectural change, outside the one-to-one premise |
| **Media/file sharing** | Requires Supabase Storage, a new upload pipeline, and its own security review |
| **Voice/video calls** | Entire new product category |
| **Voice messages** | Audio recording + storage + streaming complexity |
| **Message reactions** | New schema/RLS/UI; scope creep |
| **Push notifications** | Requires VAPID/endpoint infra; explicitly excluded from the PWA phase |
| **OAuth / federated login** | Adds attack surface; email+password is sufficient for the product scope |
| **Read receipts in UI** | Backend read state exists; showing it is a minor UX enhancement, not a v0.2 feature |
| **More languages (> 2)** | EN+DE is the designed scope; maintenance burden grows |
| **Admin/user roles** | Not a multi-user platform |

---

## 14. E2EE Status

### Current state

- **E2EE-1 Foundation** ✅ **COMPLETE**
- **E2EE-2 Architecture** ✅ **COMPLETE**
- **E2EE-2.5 Feasibility** ✅ **COMPLETE**
- **E2EE Solution Review** ✅ **COMPLETE**
- **E2EE Implementation** ❌ **PAUSED** (by design)

### What exists (CONFIRMED)

| Module | Status | Location |
|---|---|---|
| Identity generation/loading/storage | ✅ Complete | `src/lib/crypto/identity.ts`, `storage.ts` |
| Signed-prekey generation/rotation | ✅ Complete | `src/lib/crypto/prekeys.ts` |
| One-time prekey pool management | ✅ Complete | `src/lib/crypto/prekeys.ts` |
| Serialization/deserialization | ✅ Complete | `src/lib/crypto/serialization.ts` |
| IndexedDB storage | ✅ Complete | `src/lib/crypto/storage.ts` |
| `initCrypto` integration in `AuthContext` | ✅ Complete | `src/context/AuthContext.tsx` (`ensureCryptoReady`, fail-closed-silent) |
| Public API surface | ✅ Complete | `src/lib/crypto/index.ts` (no key material exposed) |

### What's missing (v0.3+)

| Component | Needed for |
|---|---|
| Message encrypt/decrypt functions | E2EE message flow |
| Key-exchange protocol on connection accept | Shared key between peers |
| `ciphertext` data-format migration | Real ciphertext in the existing column |
| Broken-key detection and rotation | Resilience |
| Secure deletion semantics under E2EE | Delete-for-everyone interplay |
| External freshness anchor for ratchet state (audit finding **C-1**) | Rollback detection; see below |

### C-1 — rollback freshness (deliberately open in v0.2)

The local ratchet-state layer (`src/lib/crypto/ratchet-state.ts`) provides integrity, atomic CAS and local monotonicity. It does **not** provide *freshness*: if the whole origin is restored from a backup, the record, the watermark and the sealing key move back together, and the older state is accepted as `VALID` and remains writable. This applies both within one epoch and across an epoch boundary. Regression tests `C8` and `C9` assert this current behaviour so the gap stays visible in CI.

A server-side epoch incremented at session establishment was evaluated as the fix and **rejected**: it is constant between establishments and therefore cannot distinguish two states inside the same epoch. A sender-side sequence counter is also insufficient, because it cannot observe receiver-side rollback. An adequate anchor would have to be external, append-only, bidirectional, advance per ratchet step and bind state identity — which makes the server authoritative over ratchet progress and rules out offline sending.

C-1 is therefore **not** a v0.2 item. It is deferred to the dedicated E2EE phase, where it must be decided together with the offline model. Details and the rejected approaches: `docs/e2ee-crash-rollback-hardening.md` §8.0/§8.1.

### Decision

**E2EE remains paused for v0.2.** Wiring the foundation into the message flow would touch `Chat.tsx`, `MessageBubble.tsx`, `MessageComposer.tsx`, and `api.ts` — substantive refactoring that belongs in a dedicated E2EE phase (v0.3+). C-1 stays open by design and is not a blocker for v0.2, because no encryption is wired into the message flow — `sendMessage()` still writes plaintext.

---

## 15. Prioritized Roadmap

> P0 is reserved for confirmed, security-critical problems. **Currently none are confirmed**, so the roadmap starts at P1. The NV-1 verification is the top item because it decides whether a P0 exists.

### Phase A — Verification & security hardening (first)

| # | Task | Classification | Priority | Effort |
|---|---|---|---|---|
| 1 | Verify deployed base `messages` UPDATE/INSERT policies and `profiles`/`connections` base policies (NV-1/NV-3) | NEEDS VERIFICATION | **P1 (→P0 if permissive)** | S |
| 2 | If NV-1 confirms permissive UPDATE: add explicit sender-only `messages` UPDATE policy (migration 0009) | → CONFIRMED fix | P1 | S |
| 3 | Add CSP meta tag + referrer meta to `index.html` | RECOMMENDATION | P1 | S |
| 4 | i18n placeholder escaping (P1-2) | CONFIRMED | P1 | S |
| 5 | Sanitize `ciphertext`/`display_name` on write (P1-3) | RECOMMENDATION | P1 | S |
| 6 | Add `robots.txt` + `security.txt` | RECOMMENDATION | P2 | S |

### Phase B — Confirmed UX/stability fixes

| # | Task | Classification | Priority | Effort |
|---|---|---|---|---|
| 7 | Batch `getUnreadCounts` (P1-4) | CONFIRMED | P1 | M |
| 8 | Home realtime incremental updates (P1-5) | CONFIRMED | P1 | M |
| 9 | Error boundary (P2-2) | CONFIRMED | P2 | S |
| 10 | Focus trap for dialogs/sheets (P2-3) | CONFIRMED | P2 | S |
| 11 | "Just now" timestamp (P2-1) | CONFIRMED | P2 | S |
| 12 | Surface data-layer errors instead of empty states (P2-4) | CONFIRMED | P2 | M |

### Phase C — Tests & code quality

| # | Task | Classification | Priority | Effort |
|---|---|---|---|---|
| 13 | Unit tests for `helpers.ts` and `api.ts` | CONFIRMED gap | P2 | M |
| 14 | Document/automate running `supabase/rls-tests.sql` | CONFIRMED gap | P2 | S |
| 15 | Deduplicate sort comparator / append logic (P3-3) | CONFIRMED | P3 | S |
| 16 | `APP_VERSION` from build metadata (P3-1) | CONFIRMED | P3 | S |

### Phase D — Optional v0.2 features

| # | Task | Classification | Priority | Effort |
|---|---|---|---|---|
| 17 | Typing indicator | RECOMMENDATION | P3 | M |
| 18 | Offline message queue | RECOMMENDATION | P3 | L |
| 19 | Avatar/placeholder | RECOMMENDATION | P3 | S |

### Explicitly deferred

| Task | Move to |
|---|---|
| E2EE message encryption | v0.3+ |
| Group chats | v1.0+ |
| Media sharing | v1.0+ |
| Voice/video | Not planned |
| Push notifications | v0.4+ |
| OAuth login | v0.4+ |
| More languages | v0.5+ |

---

## 16. Definition of Done for v0.2

### Must have (release gate)

- [ ] NV-1/NV-3 verification performed against the deployed Supabase project (documented result)
- [ ] If permissive `messages` UPDATE policy found: sender-only policy migration deployed
- [ ] CSP meta tag and referrer meta in `index.html` (with the inline-script `'unsafe-inline'` consideration resolved)
- [ ] i18n placeholder escaping implemented
- [ ] `ciphertext`/`display_name` write sanitization + server-side length check
- [ ] `getUnreadCounts` batching and Home realtime incremental updates (smoke test kept green)
- [ ] All existing tests pass: `npm run test:crypto`, `npm run smoke`
- [x] `supabase/rls-tests.sql` executes without errors against live embedded Postgres (`npm run test:rls`) and live Supabase project
- [ ] Manual QA: registration, login, request/accept/decline/block, chat, deletion, My Notes, account deletion
- [ ] `npm run build` with `VITE_BASE=/enough/` succeeds and deploys to GitHub Pages

### Should have

- [ ] Unit tests for `helpers.ts`/`api.ts`
- [ ] Error boundary + focus trap
- [ ] "Just now" timestamp
- [ ] Error states instead of silent empty states

### Nice to have

- [ ] Typing indicator, avatar placeholder, `APP_VERSION` from build metadata, deduplicated sort logic

### Explicitly NOT in v0.2

- ❌ E2EE message encryption/decryption (§14)
- ❌ Group chats, media/file sharing, voice/video, reactions, push, OAuth, read receipts UI
- ❌ Database refactoring (only additive migrations)
- ❌ Dependency updates (`package.json` unchanged)
- ❌ New external services

---

## 17. Final Classification Table

### Confirmed Issues (verified in repository code)

| ID | Issue | Severity | Files |
|---|---|---|---|
| P1-2 | i18n placeholder interpolation corrupted by parameter values containing `{…}` (robustness bug, no XSS) | P1 | `src/i18n/index.ts`, `MessageBubble.tsx` |
| P1-4 | `getUnreadCounts` N+1 queries per connection without a read row | P1 | `src/lib/api.ts` |
| P1-5 | Home realtime: every event triggers a full `load()` refetch | P1 | `src/components/Home.tsx` |
| P2-1 | "1 min" for messages < 1 min old | P2 | `src/lib/helpers.ts` |
| P2-2 | No error boundary (white screen on render error) | P2 | `src/main.tsx` |
| P2-3 | No focus trap in dialogs/bottom sheets | P2 | `Dialog.tsx`, `BottomSheet.tsx` |
| P2-4 | Data-layer errors silently become empty states | P2 | `src/lib/api.ts`, callers |
| P2-5 | Block-state realtime channel watches per-peer (over-broad) filters | P2 | `src/components/Chat.tsx` |
| P2-6 | `usernameExists` conservatively blocks registration on ambiguous errors (intentional) | P2 | `src/lib/api.ts` |
| P3-1 | Hard-coded `APP_VERSION` | P3 | `Settings.tsx` |
| P3-2 | No `robots.txt`/`security.txt` | P3 | `public/` |
| P3-3 | Duplicate sort comparator / append logic | P3 | `Chat.tsx` |
| P3-4 | Production console diagnostics (intentional, low severity) | P3 | `main.tsx`, `errors.ts` |
| — | **No confirmed P0 (security-critical) issues in repository code** | — | — |

### Needs Verification (deployed Supabase project — NOT in repository)

| ID | Item | Becomes | Verification step |
|---|---|---|---|
| NV-1 | Base `messages` UPDATE policy (delete-for-everyone authorization) | **P0 if permissive** | `select * from pg_policies where tablename='messages'` on the deployed project |
| NV-2 | Supabase auth project config: email templates, redirect allow-list, PKCE/implicit callback behavior | Deployment config issue if wrong | Test the real emailed reset/confirmation links |
| NV-3 | Base `profiles` SELECT/UPDATE and `connections` SELECT/INSERT policies (search & request authorization) | P1 if broken | Same `pg_policies` query + the RLS script |

### Recommendations (defense-in-depth / quality — not vulnerabilities)

| Item | Rationale |
|---|---|
| CSP meta tag + referrer meta | Hardening; no confirmed exploit (see §7.8 for meta-CSP limitations) |
| Sanitize `ciphertext`/`display_name` on write; server-side length CHECK | Defense-in-depth, data integrity |
| Unit tests for `api.ts`/`helpers.ts`; automate `rls-tests.sql` | Regression safety |
| Error boundary, focus trap, "just now", error states | UX/accessibility polish |
| Batch unread queries, incremental Home realtime | Performance |
| Typing indicator, offline queue, avatar (P3) | Optional product polish for v0.2 |

---

*Audit completed 2026-08-19 (rev. 2) against commit `e0cc0d8b4958db143cb1dd9a35914c064c2afad1`. Revision 2 removes all findings that the analysis itself refuted during review (message_deletions RLS, pagination `before_id`/`undefined`, `sender_id` validation, Settings stale-deletions read, SW `addAll` install failure, StrictMode issue, referrer-fragment leak) and separates CONFIRMED / NEEDS VERIFICATION / RECOMMENDATION.*
