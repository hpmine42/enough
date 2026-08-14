# enough.

A deliberately minimal, one-to-one text messenger. Register, pick a username,
find another `@username`, send a connection request, and chat.

## Stack

- Vite + React + TypeScript
- Supabase (Auth, Postgres, Realtime) — the backend already exists and is not
  part of this repository

## Design references

The `design/` directory contains the original visual mockups
(`login.html`, `home.html`, `chat.html`). They are permanent references for the
production UI and should not be modified or turned into the app.

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

3. Run the app:

   ```sh
   npm run dev
   ```

## Database schema (existing backend)

The app reads and writes the existing tables without modifying them:

- `public.profiles` — `id` (= `auth.users.id`), `username` (unique)
- `public.connections` — `id`, `user_a`, `user_b`, `status`
  (`pending` | `accepted`)
- `public.messages` — `id`, `connection_id`, `sender_id`, `ciphertext`,
  `created_at`, `deleted_at`

Registration writes the username via an idempotent upsert on `profiles`, so it
works whether or not a trigger already creates the profile row.

`messages.ciphertext` currently stores the plaintext message — v0.1 does **not**
provide end-to-end encryption. The field name is preserved from the existing
schema so real E2EE can be introduced later without renaming columns.

## Theme

Light/Dark theme is global, persisted in `localStorage`, and respects the
system preference on first launch. The floating `◐` button is a temporary
development control; the theme module (`src/lib/theme.ts`) is standalone so the
button can later move to a settings area or be removed without rewriting the app.
