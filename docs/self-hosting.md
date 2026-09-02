# Self-hosting enough.

This guide explains how to run your own independent enough. instance. A
self-hosted deployment has its **own Supabase backend, users, messages and
database** — it is fully isolated from the upstream deployment at
`https://hpmine42.github.io/enough/`.

## 1. Prerequisites

- **Node.js 24** or newer (the CI workflow uses Node 24; earlier versions may
  work but are not verified)
- **npm** (bundled with Node.js)
- A **Supabase project** — either on [supabase.com](https://supabase.com) or
  a self-hosted Supabase stack. The project provides Auth, Postgres and
  Realtime.
- A web host for the built static site (any static-file server, GitHub Pages,
  Netlify, Vercel, a VPS with nginx, etc.)

## 2. Clone the repository

```sh
git clone https://github.com/hpmine42/enough.git
cd enough
```

## 3. Install dependencies

```sh
npm install
```

This installs all runtime and development dependencies, including
`@getmaapp/signal-wasm@0.6.6` (Signal Protocol engine) and the Supabase
client.

## 4. Create a Supabase project

Create a new project on [supabase.com](https://supabase.com/dashboard) or
start a self-hosted Supabase stack. Note the **project URL** and the
**publishable (anon) key** from the project's API settings — you need them
in step 8.

## 5. Create the base schema

The repository migrations (`supabase/migrations/0001`–`0014`) extend a base
schema that is **not** part of this repository. The base schema consists of
three application tables and an `auth.users` signup trigger. It originally
came from a Supabase starter template.

Before applying the migrations, create the following objects in the Supabase
SQL editor. This is the minimum base schema the migrations and application
code require:

```sql
-- Base schema for enough. (run once before the migrations)
-- Supabase already provides auth.users, auth.uid(), and the
-- anon / authenticated / service_role roles.

begin;

-- profiles: one row per auth user, created by the signup trigger below.
create table if not exists public.profiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  username   text        not null unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- connections: one row per user pair (request / chat).
create table if not exists public.connections (
  id         uuid        primary key default gen_random_uuid(),
  user_a     uuid        not null,
  user_b     uuid        not null,
  status     text        not null default 'pending'
                           check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now()
);

alter table public.connections enable row level security;

-- messages: one row per chat message.
create table if not exists public.messages (
  id            uuid        primary key default gen_random_uuid(),
  connection_id uuid        not null references public.connections (id) on delete cascade,
  sender_id     uuid        not null,
  ciphertext    text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

alter table public.messages enable row level security;

-- Signup trigger: when a new auth user is created, insert a profiles row
-- using the username from the user's metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', new.id::text)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
```

> **Note:** Migration `0009` replaces the RLS policies on these three tables
> with explicit, restrictive policies. Any permissive template policies that
> come with a Supabase starter are removed by `0009` (which drops and
> re-creates its own named policies). If your Supabase project adds
> additional permissive policies under unknown names, remove them manually
> after inspecting `pg_policies` — permissive policies are OR-ed together
> and weaken the restrictive ones.

## 6. Apply the migrations

Open the Supabase SQL editor and run every file in `supabase/migrations/` in
numeric order: `0001` through `0014`. Each migration is idempotent and safe
to run again after an update.

Do **not** stop after `0001`. Without the full chain, features such as
display names, unread badges, per-user deletion, request decline/expiry,
account deletion, My Notes, blocking, E2EE prekeys, profile input
hardening, and the corrected unread view are unavailable or degrade.

After applying all migrations, verify that:

- RLS is enabled on `profiles`, `connections`, `messages`, and all new
  tables.
- The `supabase_realtime` publication includes `message_deletions`,
  `chat_deletions`, `connection_reads`, `user_blocks`,
  `crypto_one_time_prekeys`, and `crypto_kyber_prekeys`. The migrations add
  these tables to the publication automatically.
- No permissive (e.g. `USING (true)`) policies remain on the core tables.

See [`MIGRATIONS.md`](MIGRATIONS.md) for a detailed description of every
migration.

## 7. Configure Supabase Auth

enough. uses Supabase Auth with email and password. Configure the following
in the Supabase Auth settings:

- **Email provider:** enable email auth.
- **Email confirmation:** enable or disable depending on your preference.
  The app handles both confirmed and auto-confirmed flows. With confirmation
  enabled, users receive a confirmation email before they can log in. With
  auto-confirm enabled (e.g. for development), the `handle_new_user` trigger
  creates the profile row during sign-up and the authenticated upsert in
  the app acts as a fallback.
- **Password reset:** enable the "Forgot password" flow and configure the
  redirect URL to point to your deployed app (the app uses the hash-based
  route `#/reset-password`).
- **Email change:** enable if you want users to change their email from
  Settings → Account.
- **Site URL:** set to your deployed app URL (used for email redirect links).

## 8. Configure environment variables

Copy the example file and fill in your Supabase project values:

```sh
cp .env.example .env
```

Required variables:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://<project-ref>.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable (or legacy "anon") key from your Supabase API settings |

Optional:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_ANON_KEY` | Legacy fallback if your project only provides an "anon" key. Only one of `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` is required |
| `VITE_BASE` | URL base path for the built assets (see [Hosting and base path](#11-hosting-and-base-path)) |

Never put a `service_role` or secret key into a `VITE_*` variable. The app
only uses the public client; security comes from Supabase Auth + Row Level
Security.

## 9. Run locally

```sh
npm run dev
```

The development server starts on `http://localhost:5173` by default. The app
opens without a configured backend (the auth screen explains what is
missing); once `.env` is populated and the migrations are applied, all
features work.

## 10. Build for production

```sh
npm run build
```

This runs the TypeScript checker and produces a static site in `dist/`. The
built site has no server-side component — it is pure HTML, CSS and
JavaScript.

## 11. Hosting and base path

The Vite `base` configuration controls the URL prefix for built assets. It
defaults to `/` (root deployment) and can be overridden with the `VITE_BASE`
environment variable at build time:

| Hosting target | `VITE_BASE` | Example |
|---|---|---|
| Root deployment (e.g. `https://chat.example.com/`) | `/` (default) | `npm run build` |
| Subpath deployment (e.g. `https://example.com/enough/`) | `/enough/` | `VITE_BASE=/enough/ npm run build` |
| GitHub Pages (`https://<user>.github.io/enough/`) | `/enough/` | `VITE_BASE=/enough/ npm run build` |

The Web App Manifest uses relative `./` paths for `start_url` and `scope`,
so the same build works under any base path. The service worker is scoped
to the Vite `base` and precaches only same-origin static assets.

Upload the contents of `dist/` to your static-file host. No server-side
runtime is required.

### GitHub Pages

The upstream deployment uses GitHub Pages with the workflow in
`.github/workflows/deploy.yml`. To deploy your own fork to GitHub Pages:

1. Enable GitHub Pages in your repository settings (source: GitHub Actions).
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as
   repository secrets.
3. Adjust the `VITE_BASE` value in the workflow if your repository name
   differs from `enough`.
4. Push to `main` to trigger the deploy workflow.

## 12. Security considerations

### Row Level Security

All authorization is enforced server-side through Supabase RLS policies and
database triggers. The client-side checks are UX only. Migration `0009`
establishes explicit, restrictive RLS on the three core tables; later
migrations add RLS to every additional table. No permissive policy should
remain on any application table.

### End-to-end encryption

Self-hosting changes the **server** but not the **client-side encryption**:

- **Private E2EE key material remains on the user's device.** Identity keys,
  ratchet state, and the local message cache are stored in the browser's
  IndexedDB (`enough-crypto` database, AES-GCM sealed). They are never
  transmitted to or stored on the server, regardless of who operates it.
- **Supabase stores ciphertext and metadata.** For peer 1:1 conversations,
  `messages.ciphertext` holds an opaque Signal Protocol envelope. The
  server sees message timestamps, connection membership, and delivery
  patterns, but not the chat body.
- **Self-hosting does not transfer users' private keys to the server.**
  Migrating or operating your own Supabase project does not expose key
  material that was never there.
- **E2EE does not hide all metadata.** The server operator can observe
  which users exist, which users are connected, message timestamps and
  sizes, connection request patterns, and online activity via Realtime
  subscriptions.
- **My Notes** (self-chat) messages are stored as plaintext by design —
  the peer E2EE path cannot apply to a self-connection and no self-session
  mechanism is implemented.
- **System messages** (`name_change`, `connection_event`,
  `deleted_account`) are unencrypted metadata.
- **Pre-E2EE rows** (messages created before E2EE was enabled on an
  instance) remain stored as plaintext and are displayed as legacy text.

### Supply-chain verification

The `@getmaapp/signal-wasm@0.6.6` package is verified by
`npm run verify:signal-wasm`, which performs a byte-exact SHA-256 check of
the installed WASM and crypto artifacts against the audited manifest. The
CI workflow runs this check before build and deploy. Run it locally after
`npm install` to confirm the installed package matches the audit:

```sh
npm run verify:signal-wasm
```

### Imprint

Replace the placeholder values in `src/config/imprint.ts` with your own
operator details before publishing. The imprint page is reachable at
`#/imprint` (English) and `#/impressum` (German) without a configured
backend.

## 13. What is and is not shared with the upstream instance

A self-hosted enough. instance is fully independent:

| Aspect | Shared with upstream? |
|---|---|
| Application source code | Yes — same repository |
| Supabase project (database, auth, realtime) | **No** — your own project |
| Users and accounts | **No** — your own user base |
| Messages and connections | **No** — your own data |
| E2EE key material | **No** — each user's keys are on their own device |
| E2EE prekey tables | **No** — your own database |
| Imprint / legal information | **No** — your own operator details |
| `@getmaapp/signal-wasm` package | Same version (0.6.6), independently verified |

Users of your instance cannot communicate with users of the upstream
instance or any other self-hosted instance. Each deployment is a separate
messaging network.

## 14. Testing your deployment

After applying the migrations and creating at least two test accounts, run
the RLS test suite to verify the authorization model:

```sh
npm run test:rls
```

This uses an embedded Postgres instance and applies the migrations
automatically. For a live-database check, run `supabase/rls-tests.sql` in
the Supabase SQL editor with two existing test users (see
[`MIGRATIONS.md`](MIGRATIONS.md)).

The full test suite can be run with:

```sh
npm run build
npm run smoke
npm run test:crypto
npm run test:crypto:engine
npm run test:crypto:prekeys
```
