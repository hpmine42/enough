# enough.

A deliberately minimal, one-to-one text messenger. Register, pick a username,
find another `@username`, send a connection request, and chat.

> **Less, but enough.**

## Stack

- Vite + React + TypeScript
- Supabase (Auth, Postgres, Realtime) — the backend exists separately and is
  **not** part of this repository; schema changes are delivered as SQL in
  [`supabase/migrations/`](supabase/migrations/)

## Design references

The `design/` directory contains the original visual mockups
(`login.html`, `home.html`, `chat.html`). They are permanent references for the
production UI and should not be modified or turned into the app.

## Features (v0.1)

- Auth: login, registration (email, `@username`, display name, password × 2),
  email confirmation, forgot/reset password, email change, persistent sessions,
  self-service account deletion (frees the username; other participants keep the
  chat and are told the account was deleted)
- Localization: English (default) and German; auth screens have an EN/DE switch,
  Settings has the full language control; no page reload on switch
- Theme: Light / Dark / System (default), persisted, no flash of the wrong theme
- Minimal Home: logo, theme toggle, settings, chat list with relative
  timestamps and unread badges
- Settings as a full-screen slide-in: profile, people search (by `@username`),
  language, appearance, chat preferences (Enter to send, My Notes), account
  (email/password change, delete account), version/GitHub footer
- Connections: live search, requests with accept / decline (custom dialog) /
  cancel, 14-day expiration enforced by the database, re-request after decline
- Chat: grouped bubbles, compact timestamps, long-press bottom sheet
  (copy / delete for me / delete for everyone within 24 h), per-user chat
  deletion, display-name change events, My Notes self-chat
- Read state: viewport-based, per user, survives reloads; `↓ N` scroll button
  with progressive read counts
- Pagination with stable scroll position; Realtime for new messages,
  deletions, connection and profile changes
- Accessibility: semantic controls, focus states, no tap highlights,
  `prefers-reduced-motion` support

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
   `0001` through `0005`; do not stop after `0001`. The scripts are idempotent,
   so they are safe to run again after an update. In particular, My Notes needs
   `0003_allow_self_connections.sql` and `0005_my_notes_rpc.sql`.

   Without the migrations the app still opens, but database-backed features
   such as display names, unread badges, per-user deletion, request
   decline/expiry, account deletion, and My Notes are unavailable.

4. Run the app:

   ```sh
   npm run dev
   ```

## Database schema

The app reads and writes the existing tables plus the objects added by the
migration:

- `public.profiles` — `id` (= `auth.users.id`), `username` (unique),
  `display_name` (added)
- `public.connections` — `id`, `user_a`, `user_b`, `status`
  (`pending` | `accepted` | `declined` | `expired` | `ended`), `created_at`
- `public.messages` — `id`, `connection_id`, `sender_id`, `ciphertext`,
  `created_at`, `deleted_at`, `kind` (`text` | `name_change` |
  `connection_event` | `deleted_account`), `meta` (added)
- `public.delete_own_account()` — `security definer` RPC for self-service
  account deletion (added by migration 0004)
- `public.ensure_my_notes()` / `public.remove_my_notes()` — auth-bound RPCs
  that manage only the caller's self-chat without weakening normal connection
  RLS (added by migration 0005)
- `public.connection_reads` — per-user read position (added, RLS)
- `public.message_deletions` — per-user "delete for me" rows (added, RLS)
- `public.chat_deletions` — per-user "delete chat for me" rows (added, RLS)
- `public.connection_unread` — security-invoker view for unread counts (added)

Registration includes the username and display name in Supabase Auth user
metadata. The existing `auth.users` trigger creates the `profiles` row inside
the sign-up transaction; an idempotent authenticated upsert remains as a
fallback for auto-confirm setups.

`messages.ciphertext` currently stores the plaintext message — v0.1 does **not**
provide end-to-end encryption. The field name is preserved from the existing
schema so real E2EE can be introduced later without renaming columns.

## Testing

- `npm run build` — TypeScript check + production build
- `npm run smoke` — renders the production bundle in jsdom with a stubbed
  Supabase API and walks through the main flows (auth screens, localization,
  theme, settings, search, connection request lifecycle, chat, deletion,
  My Notes, sign out). It is not a substitute for live-backend testing.
- `supabase/rls-tests.sql` — authorization checks against the real database
  using your two existing test users (see `docs/MIGRATIONS.md`).

## Theme

Light/Dark/System is global, persisted in `localStorage`, defaults to System,
and is applied before first paint to avoid a flash. The theme module
(`src/lib/theme.ts`) is standalone; the header button toggles light/dark while
Settings offers the full three-way choice.

## Impressum anpassen

Das öffentliche Impressum ist unter `#/impressum` erreichbar und wird auf den
Anmeldeseiten sowie in den Einstellungen verlinkt. Es funktioniert auch ohne
eingerichtete Supabase-Verbindung.

Vor der Veröffentlichung müssen in
[`src/config/imprint.ts`](src/config/imprint.ts) alle Werte in eckigen Klammern
durch die eigenen Angaben ersetzt werden:

- vollständiger Name bzw. Firmenname
- ladungsfähige Anschrift
- E-Mail-Adresse und Telefonnummer
- falls zutreffend: Vertretungsberechtigte, Registereintrag,
  Umsatzsteuer-ID und redaktionell verantwortliche Person

Nicht benötigte optionale Felder bleiben leer und werden dann nicht angezeigt.
Welche Angaben im Einzelfall verpflichtend sind, hängt vom Betreiber und vom
Angebot ab; die Vorlage ersetzt keine rechtliche Prüfung.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` (base path `/enough/`). Only
browser-safe publishable Supabase credentials are injected at build time from
repository secrets.
