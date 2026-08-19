# Database migrations — enough. v0.1

The Supabase backend is not part of this repository. Schema changes are delivered
as SQL files you run yourself in the Supabase dashboard (SQL editor) or with the
Supabase CLI. **Apply all migrations, not only `0001`.** Without them the app
still opens but database-backed features degrade or remain unavailable.

## How to run

1. Open your Supabase project → **SQL Editor**.
2. Run the full contents of every file in `supabase/migrations/` in numeric
   order (`0001` → `0009`). Each migration is idempotent and safe to run again
   after pulling a frontend update.
3. Optional but recommended: run `supabase/rls-tests.sql` to verify the
   authorization model with your two existing test users.

If Settings says that **My Notes could not be set up**, verify that both
`0003_allow_self_connections.sql` and `0005_my_notes_rpc.sql` have run. `0003`
removes a legacy self-connection check; `0005` provides a narrowly scoped RPC
that can create the accepted self-chat without relaxing the RLS policy for
normal connection requests.

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

## Later migrations

- `0002_username_check_rpc.sql` — makes username availability checks work while
  anonymous profile reads remain blocked by RLS.
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
- `0006_chat_deletion_hidden_until.sql` — adds `chat_deletions.hidden_until`
  so a later reconnect of the same pair does not restore history the deleting
  user already hid. Messages stay in the table for the other participant.
- `0005_my_notes_rpc.sql` — creates `public.ensure_my_notes()` and
  `public.remove_my_notes()`. Both functions take no IDs from the browser and
  operate only on `auth.uid()`'s self-connection. This is required when the
  normal connection-insert policy correctly permits only pending requests;
  weakening that policy to make My Notes work would let users bypass consent.
- `0008_user_blocks.sql` — user blocking:
  - creates `public.user_blocks` (`blocker_id`, `blocked_id`, `created_at`,
    unique pair, no self-blocks) with RLS: both involved users may read the
    row, only the blocker may create/delete it (no UPDATE policy at all),
  - adds a DB trigger that rejects new connection rows and transitions into
    `pending`/`accepted` between a blocked pair (`declined`/`expired`/`ended`
    transitions stay allowed so decline+block, expiry cleanup and account
    deletion keep working),
  - extends the existing message-insert guard: no messages in either
    direction while a block exists; trusted system events (name changes,
    accepted events, the deleted-account notice) set a transaction-local GUC
    so they keep working between blocked users,
  - creates `public.send_connection_request(target)` — the authoritative
    request state machine: restores a declined/expired attempt of the caller,
    reuses a dead attempt of the other side (no duplicate rows, no
    unique-constraint conflicts), keeps a live incoming request untouched,
    restarts the 14-day window, and rejects blocked pairs with SQLSTATE
    `BLCKD`,
  - creates `public.decline_connection(conn, block_peer)` — decline an
    incoming request and optionally block the requester in one step
    (recipient-only, idempotent).
- `0009_explicit_base_rls.sql` — v0.2: explicit, reproducible base RLS for
  the three core tables (previously only present in the untracked project
  template):
  - enables RLS on `profiles` / `connections` / `messages` (idempotent),
  - `messages`: SELECT only for participants of the connection; INSERT
    policy mirroring `guard_message_insert`; UPDATE only for the sender;
    a new BEFORE UPDATE trigger (`guard_message_update`) enforces the
    delete-for-everyone semantics server-side — only `deleted_at` (null →
    now, once, within 24 h) and clearing `ciphertext` are allowed, all other
    columns are immutable; no direct DELETE for client roles,
  - `profiles`: SELECT for all authenticated users (search); INSERT own
    profile; UPDATE only own profile and only `display_name`
    (`guard_profile_update`); no direct DELETE,
  - `connections`: SELECT only for participants; INSERT only the caller's
    own outgoing `pending` request (no self-requests); UPDATE only for
    participants with a `guard_connection_update` state machine (recipient
    accepts/declines, requester re-opens); DELETE only the caller's own
    pending request,
  - explicit `grant`/`revoke` on the three tables for `anon`/`authenticated`,
  - re-creates `send_connection_request` and `delete_own_account` to set a
    transaction-local trusted flag so their privileged connection writes
    pass the new state machine.

Run all of these after `0001` in numeric order. They are idempotent.

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
- **My Notes** uses the existing connection/message schema: it is an accepted
  self-connection (`user_a = user_b = auth.uid()`). Setup/removal goes through
  auth-bound `security definer` functions so normal users still cannot create
  arbitrary accepted connections. The functions accept no user-supplied IDs.
- **Blocking is a separate security dimension**, not a connection status:
  `user_blocks` rows never change `connections.status`. Instead, DB triggers
  and the request RPCs enforce that a blocked pair cannot create/restore
  requests or send messages while a block exists. Removing the block restores
  normal behavior without any status migration.

## RLS model (new objects)

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `connection_reads` | own rows | own rows | own rows | own rows |
| `message_deletions` | own rows | own rows **and** message in own connection | — | own rows |
| `chat_deletions` | own rows | own rows **and** connection involves me | — | own rows |
| `connection_unread` | via security-invoker RLS (own rows only) | — | — | — |
| `user_blocks` | rows where I am blocker **or** blocked | blocker = me | — | blocker = me |

`messages` and `connections` base RLS is defined explicitly in `0009` (see
above); the `0001`/`0008` guard triggers add DB-level checks on top: the
message insert guard enforces that the sender is `auth.uid()`, the
connection is accepted, and no block exists between the participants; the
connection guard enforces that no new connection (or transition into
`pending`/`accepted`) is possible between a blocked pair.

## Test plan (after applying the migration)

Run `supabase/rls-tests.sql` (uses the two existing test users). It verifies:

- A can read B's profile; A cannot modify B's profile.
- A cannot accept a request addressed to B; B cannot create a request as A.
- Messaging works in accepted connections; message insert into declined
  connections is rejected by the database.
- A can delete their own message for everyone; B cannot; an uninvolved user
  cannot; content cannot be edited; immutable columns (`sender_id`,
  `connection_id`, …) cannot be changed; delete-for-everyone is rejected
  after 24 h.
- Delete-for-me and read-state writes are restricted to own data and own
  connections.
- The unread view never leaks another user's rows.
- Blocking: the blocked user can read but not delete the block, cannot
  fabricate a block on someone else's behalf, cannot create or restore a
  connection request (direct SQL and via the RPC), cannot send messages in
  either direction while blocked — while system events still work.
- Re-request state machine: after a decline the requester can re-request via
  `send_connection_request()`; after a decline+block they cannot until the
  block is removed, after which the request works again.
