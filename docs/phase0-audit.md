# Phase 0 — Audit Report (enough. v0.1)

Date: 2026-08-14
Branch: `arena/01a00172-enough`

## 1. Repository architecture summary

| Layer | Technology | Location |
|---|---|---|
| Build | Vite 5 + React 18 + TypeScript 5 | `vite.config.ts`, `tsconfig.json` |
| Deployment | GitHub Pages via GitHub Actions | `.github/workflows/deploy.yml` |
| Backend | Supabase (Auth, Postgres, Realtime) — external, not in repo | — |
| Routing | Minimal hash router (`useHashRoute`, `navigate`) | `src/lib/router.ts` |
| State | React Context only (no state library) | `src/context/AuthContext.tsx` |
| Styling | Single global stylesheet, CSS custom properties | `src/index.css` |
| Design refs | Static HTML mockups (login/home/chat) | `design/` |

Dependencies: `@supabase/supabase-js`, `react`, `react-dom` only. No UI kit, no state
library, no router library. This minimalism is deliberate and should be preserved.

### Files
- `src/App.tsx` — top-level route switch (`#/`, `#/register`, `#/chat/{id}`)
- `src/context/AuthContext.tsx` — session restore, signIn/signUp/signOut, profile load
- `src/lib/api.ts` — all Supabase data calls (profiles, connections, messages)
- `src/lib/supabase.ts` — client factory (anon/publishable key only)
- `src/lib/errors.ts` — error-code → human message mapping (currently German-only)
- `src/lib/helpers.ts` — `otherUserId`, username normalize/validate, `formatTime`
- `src/lib/theme.ts` — light/dark theme, `localStorage` persistence, no-flash friendly
- `src/components/` — Login, Register, Home, Chat, MessageBubble, MessageComposer,
  UserSearch, ThemeToggle

## 2. Existing Supabase schema summary (source: README + client code)

> The backend is not part of this repository. No SQL files exist in the repo.
> Schema below is reconstructed from `README.md` and the columns the client reads/writes.

- `public.profiles` — `id` (= `auth.users.id`), `username` (unique), `created_at`.
  Created by an existing `auth.users` trigger that reads `username` from
  `raw_user_meta_data` inside the sign-up transaction.
- `public.connections` — `id`, `user_a`, `user_b`, `status` (`pending` | `accepted`),
  `created_at`. Client uses `.or(user_a.eq.me,user_b.eq.me)` and unique-pair semantics.
- `public.messages` — `id`, `connection_id`, `sender_id`, `ciphertext` (currently
  plaintext; field name preserved for future E2EE), `created_at`, `deleted_at` (unused
  by the client so far — intended for "delete for everyone").

No display name column, no per-user deletion state, no read state, no connection
request decline/expiry state, no system-event/kind column.

## 3. Existing RLS summary

Policies are not observable from this repository (no SQL, no DB access from the
sandbox). The client code behaves as if the standard Supabase tutorial policies
exist: users can read/write their own profile, read/write connections they belong to,
read/insert messages of their connections. Registration deliberately writes no
profile from the browser when email confirmation is enabled — the Auth trigger owns
profile creation — because anonymous profile writes would be rejected by RLS.

## 4. Existing Realtime summary

- Home: one channel (`home-connections`), `postgres_changes` on `connections`
  (all events) → full reload.
- Chat: one channel (`messages-{id}`), `postgres_changes` INSERT on `messages`
  filtered by `connection_id` → append + sort.
- Channels removed on unmount. No duplicate-event guard beyond id de-duplication.

## 5. Feature gap analysis (vs. master spec)

| Spec requirement | Status |
|---|---|
| Auth (login/register/confirm/logout/session persistence) | ✅ exists (German-only UI) |
| Email confirmation | ✅ exists |
| Localization EN default + DE, auth language switch | ❌ missing (UI hard-coded German) |
| Theme System/Light/Dark | ⚠️ light/dark only, floating dev toggle |
| Settings full-screen slide-in | ❌ missing |
| Display name (registration + profile) | ❌ missing (no column, no UI) |
| Forgot password / password reset | ❌ missing |
| Email change | ❌ missing |
| Name-change system events | ❌ missing |
| Home minimal (logo/theme/settings/chat list) | ⚠️ has + button + search + logout on Home |
| Search inside Settings only | ❌ search is on Home |
| Chat list ordering by activity, unread badge | ❌ missing |
| Relative timestamps (min/h/weekday/date) | ❌ missing (absolute HH:MM only) |
| Connection request Accept/Decline/Cancel/14-day expiry | ⚠️ accept exists; decline/cancel/expiry missing |
| Request UI in conversation, disabled composer | ❌ missing |
| Chat deletion (delete for me) | ❌ missing |
| My Notes self-chat (default OFF) | ❌ missing |
| Chat header (display name + @username, two lines) | ❌ missing |
| Message grouping / bubble corners | ❌ missing (flat list, pill-ish radius) |
| Compact message timestamps | ❌ missing |
| Long-press bottom sheet (copy/delete) | ❌ missing |
| Delete for me / delete for everyone / deleted states | ⚠️ `deleted_at` column exists, unused |
| Read state (viewport-based, survives reload) | ❌ missing |
| Unread ↓N scroll button | ❌ missing |
| Pagination / stable scroll on prepend | ❌ loads entire history |
| Composer textarea (4-line growth, Enter-to-send OFF default) | ⚠️ single-line input, Enter always sends |
| Notifications preference | ❌ missing |
| Reduced-motion support | ❌ missing |
| Tap-highlight removal | ❌ missing |
| Icons (outline SVG, sun/moon, send, back) | ⚠️ text glyphs (← ↑ ◐ +) |
| Desktop responsive layout | ⚠️ centered column only |
| 14-day DB enforcement | ❌ missing (client-only impossible) |

## 6. Migration requirements

Non-destructive, additive migrations are required for:

1. `profiles.display_name` (text, nullable) + metadata copy on signup.
2. `connections.status` extended with `declined` and `expired`.
3. `messages.kind` (`text` | `name_change`) + `messages.meta` (jsonb) for system events.
4. `connection_reads` (per-user read state, RLS).
5. `message_deletions` (per-user delete-for-me rows, RLS).
6. `chat_deletions` (per-user delete-for-me chat rows, RLS).
7. `connection_unread` security-invoker view (Home unread badges).
8. DB-side enforcement: message inserts blocked for non-accepted/expired connections;
   profile name-change trigger emitting system events; expiry cleanup.
9. Realtime publication for the new tables.

Full SQL lives in `supabase/migrations/0001_v01_features.sql` (idempotent, runnable
in the Supabase SQL editor; nothing destructive, nothing dropped, existing policies
untouched).

## 7. Risk list

| Risk | Mitigation |
|---|---|
| Sandbox has no network access to the Supabase project → no live RLS/realtime/2-user testing | All DB work delivered as idempotent migration SQL + RLS test script; frontend degrades gracefully when new tables/columns are absent; explicit test plan in `docs/MIGRATIONS.md` |
| Unknown exact RLS policies / trigger bodies | Client never relies on new columns being present; errors surface human-readable messages; migrations only add, never replace policies |
| Unique constraint on `connections(user_a,user_b)` may be absent | Migration adds a normalized unique pair index after deduplicating (documented) |
| `connections.status` check constraint name unknown | Migration alters it via `pg_constraint` lookup, never assumes a name |
| Realtime publications unknown | Migration adds tables to `supabase_realtime` idempotently |
| `deleted_at` semantics for "delete for everyone" | Sender updates own message: `deleted_at = now()`, `ciphertext = ''`; clients render the localized deleted state instead of content |
| Self-chat (My Notes) may collide with a `user_a <> user_b` check | Client creates it as a normal accepted connection to self; if RLS rejects, the error is surfaced in Settings |

## 8. Constraints honored

- No secrets in the frontend: only `VITE_SUPABASE_URL` + publishable/anon key.
- No destructive SQL; no dropped tables/policies; no reset; no user deletion.
- No new runtime dependencies.
- Existing functionality (auth, messaging, realtime, RLS, Pages deploy) preserved.
