# Database migrations — enough. v0.1

The Supabase backend is not part of this repository. Schema changes are delivered
as SQL files you run yourself in the Supabase dashboard (SQL editor) or with the
Supabase CLI. **The frontend requires `0001` to be applied before the new
features work**; without it the app still runs but degrades (no display names,
no unread badges, no per-user deletion, no request decline).

## How to run

1. Open your Supabase project → **SQL Editor**.
2. Paste the full contents of `supabase/migrations/0001_v01_features.sql` and run it.
   It is idempotent and non-destructive — safe to run more than once.
3. Optional but recommended: run `supabase/rls-tests.sql` to verify the
   authorization model with your two existing test users.

## What the migration does

| # | Change | Why |
|---|--------|-----|
| 1 | `profiles.display_name` (text) + signup sync trigger | Human-readable name in chats; registration includes a display name |
| 2 | `connections.status` extended with `declined` / `expired`; one row per user pair (unique index after dedupe); expiry cleanup | Request lifecycle: decline, cancel, restore, 14-day expiration |
| 3 | `messages.kind` (`text`/`name_change`) + `messages.meta` (jsonb); insert guard trigger; name-change event trigger; index on `(connection_id, created_at desc)` | System events ("X changed their name to Y"), DB-side enforcement that messaging only happens in active connections, fast pagination |
| 4 | `connection_reads` (per-user read state, RLS) | Unread badges survive reloads; read position is per user |
| 5 | `message_deletions` (per-user rows, RLS) | "Delete for me" hides a message only for the current user — the row is never destroyed |
| 6 | `chat_deletions` (per-user rows, RLS) | "Delete chat for me" is per user |
| 7 | `connection_unread` view (security invoker) | Home unread counts computed in SQL, filtered by RLS per user |
| 8 | Grants to `authenticated` | PostgREST Data API access for the new objects (RLS remains the authority) |
| 9 | Realtime publication for the new tables | Live sync of deletions/read state across devices |

## Migrations 0003 + 0004

- `0003_allow_self_connections.sql` — drops a legacy `CHECK (user_a <> user_b)`
  constraint on `connections` (if present) so the My Notes self-chat
  (`user_a = user_b`) can be created.
- `0004_delete_account.sql` — self-service account deletion:
  - adds the `ended` connection status,
  - drops legacy foreign keys from `connections`/`messages` to `auth.users`
    and `profiles` so chat history survives user deletion,
  - creates `public.delete_own_account()` (`security definer`), which writes a
    `@username deleted their account` system message into each accepted chat,
    marks those chats `ended` (blocking further messages), then removes the
    profile (freeing the username) and the auth user.

Run these after `0001`/`0002` in the Supabase SQL editor; both are idempotent.

## Design decisions

- **Nothing is dropped or reset.** Existing tables, policies, triggers and users
  are untouched. The only `DELETE` statements remove duplicate connection rows
  for the same user pair (keeping the accepted/newest one) so the new unique
  index can be created.
- **14-day expiration is enforced in the database**, not only in the UI:
  the message-insert guard rejects writes to any connection whose status is not
  `accepted`, and the cleanup `UPDATE` marks stale pending/declined attempts as
  `expired`. The client additionally hides expired attempts.
- **Delete for everyone** uses the pre-existing `messages.deleted_at` column and
  clears `ciphertext`, so the original content is not exposed afterwards.
- **Name-change events** are created by a database trigger on
  `profiles.display_name`, so they appear in every accepted conversation even
  when the change comes from another client.
- **New policies are only added** (never replacing existing ones). All new RLS
  policies are scoped to `auth.uid()` and, where needed, to membership in the
  relevant connection.
- **My Notes** needs no new schema: it is an accepted self-connection
  (`user_a = user_b = auth.uid()`), which the pair-unique index permits.

## RLS model (new objects)

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `connection_reads` | own rows | own rows | own rows | own rows |
| `message_deletions` | own rows | own rows **and** message in own connection | — | own rows |
| `chat_deletions` | own rows | own rows **and** connection involves me | — | own rows |
| `connection_unread` | via security-invoker RLS (own rows only) | — | — | — |

`messages` keeps its existing RLS; the new guard trigger adds a second,
DB-level check that the sender is `auth.uid()` and the connection is accepted.

## Test plan (after applying the migration)

Run `supabase/rls-tests.sql` (uses the two existing test users). It verifies:

- A can read B's profile; A cannot modify B's profile.
- A cannot accept a request addressed to B; B cannot create a request as A.
- Messaging works in accepted connections; message insert into declined
  connections is rejected by the database.
- A can delete their own message for everyone; B cannot.
- Delete-for-me and read-state writes are restricted to own data and own
  connections.
- The unread view never leaks another user's rows.
