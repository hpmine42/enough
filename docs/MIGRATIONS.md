# Database migrations — enough. v0.1

The Supabase backend is not part of this repository. Schema changes are delivered
as SQL files you run yourself in the Supabase dashboard (SQL editor) or with the
Supabase CLI. **Apply all migrations, not only `0001`.** Without them the app
still opens but database-backed features degrade or remain unavailable.

## Verified deployment state (after `0009`)

The files in `supabase/migrations/` (`0001`–`0009`) are the **versioned
backend and security history** of this project. This section documents the
**live production state** as it was inspected and verified after the
successful deployment of `0009`:

- The original Supabase **base schema** (`profiles`, `connections`, `messages`
  and their base constraints/triggers, including the `auth.users → profiles`
  signup trigger) originates from an **external Supabase template that is not
  part of this repository**.
- Before `0009`, the live project additionally carried **permissive template
  policies** on the core tables. These came from that external template —
  **not** from the repository migrations `0001`–`0008` (every policy defined
  by `0001`–`0008` is restrictive and still intended).
- During the deployment of `0009`, these permissive template policies were
  removed **once and manually, after live inspection**. This manual step is
  not (and cannot be) part of a migration file, because `0009` deliberately
  drops and re-creates **only the policies it defines itself**: it
  intentionally does not remove unknown third-party/template policies under
  unknown names (permissive policies are OR-ed, which is exactly why the
  manual inspection was required — see the `0009` migration header).

The production state was verified after the `0009` deployment through direct
live queries. Confirmed:

- **RLS is enabled** on all relevant tables.
- The **new policies from `0009`** are present on `profiles`, `connections`
  and `messages`.
- The **old permissive template policies are removed**.
- The **relevant security triggers** are present (the guard triggers:
  `guard_message_insert`, `guard_message_update`, `guard_profile_update`,
  `guard_connection_update`, `guard_blocked_connection_write`).
- The **relevant security-definer RPCs** are present (`check_username_taken`,
  `delete_own_account`, `ensure_my_notes`, `remove_my_notes`,
  `send_connection_request`, `decline_connection`).
- The **required grants for `authenticated`** on `profiles`, `connections`
  and `messages` are present.

**The current production state is therefore correct and verified.**

Two documented consequences for the future:

- A completely fresh Supabase environment **cannot be reproduced from this
  repository alone**: the external base schema and the one-time manual removal
  of the template policies lie outside the migrations. Full reproducibility
  (e.g. a new staging or disaster-recovery project) would additionally require
  a **versioned schema baseline or a database dump of the external base
  schema**.
- Migration `0010` (E2EE identity public key) is additive and nullable — it
  does not affect existing data and is safe to apply to the verified `0009`
  production state when the frontend that publishes `profiles.identity_public_key`
  is deployed.

## Verified deployment state (2026-08-30 — A1 authorization re-verification)

The deployed Supabase production instance was re-inspected on **2026-08-30**
using **read-only SQL queries only**; no database changes were made during the
verification. This round documents roadmap item **A1** (deployed authorization
policies) and the deployed-migration evidence for `0010`–`0014`.

### Deployed RLS policies (`pg_policies`)

`pg_policies` was inspected for `messages`, `profiles` and `connections`. The
deployed policy set matches the explicit policies defined by
`0009_explicit_base_rls.sql` exactly, and a second independent listing returned
the same complete set:

- `messages` — `messages_select_own_connections` (SELECT),
  `messages_insert_own` (INSERT), `messages_update_sender_only` (UPDATE).
  No DELETE policy, matching the repository model (direct row deletion is not
  part of the product).
- `profiles` — `profiles_select_all` (SELECT), `profiles_insert_own` (INSERT),
  `profiles_update_own` (UPDATE). No DELETE policy.
- `connections` — `connections_select_involved` (SELECT),
  `connections_insert_own_request` (INSERT), `connections_update_involved`
  (UPDATE), `connections_delete_own_request` (DELETE).

**No permissive legacy policy remains active:** there are no additional
`FOR ALL` policies, no permissive `USING (true)` policies, and no other
unexpected policies on these three tables.

### Deployed triggers and functions

The deployed trigger set contains: `guard_profile_update` (profiles),
`guard_blocked_connection_write` (connections), `guard_connection_update`
(connections), `on_connection_accepted` (connections), `guard_message_insert`
(messages), `guard_message_update` (messages),
`on_profile_display_name_change` (profiles), `sync_profile_display_name`
(profiles).

The deployed function set contains the expected security-definer RPCs:
`claim_prekey_bundle`, `decline_connection`, `delete_own_account`,
`ensure_my_notes`, `remove_my_notes`, `send_connection_request`. The guard
functions themselves are not `SECURITY DEFINER`.

### Deployed migration evidence (`0010`–`0014`)

- `0010` — `profiles.identity_public_key` (text, nullable) is present.
- `0011` — the crypto tables are present: `crypto_devices`,
  `crypto_kyber_prekeys`, `crypto_one_time_prekeys`, `crypto_signed_prekeys`.
- `0012` — `profiles_display_name_max_length`
  (`CHECK (display_name IS NULL OR char_length(display_name) <= 60)`) and
  `normalize_display_name(value text)` are present. The constraint is currently
  `NOT VALID` — a deployment characteristic, **not** a failure: it means
  existing rows were not retroactively validated when the constraint was added
  (new writes are enforced). No change was made.
- `0013` — the deployed `connection_unread` view starts from `connections`
  with `LEFT JOIN connection_reads` and the expected unread semantics (only
  involved users; accepted/ended connections; messages newer than
  `last_read_at`; own, deleted and non-text messages excluded).
- `0014` — **open item, see below.** The deployed `send_connection_request`
  exists as `SECURITY DEFINER` with `SET search_path TO 'public'` and uses
  `pg_catalog.hashtextextended` and `pg_catalog.pg_advisory_xact_lock`. The
  inspection report additionally lists `pg_catalog.least` and
  `pg_catalog.greatest` in the deployed body — **this contradicts migration
  `0014`**, which replaces the `pg_catalog.`-qualified forms with unqualified
  `least(...)` / `greatest(...)` because `pg_catalog.least(...)` raises
  SQLSTATE 42883 ("function pg_catalog.least(text, text) does not exist").
  The listed identifiers match the pre-fix (`0009`) body instead. The exact
  deployed function definition must be re-checked with
  `select pg_get_functiondef('public.send_connection_request'::regproc);`
  before `0014` deployment can be confirmed; if the deployed body really
  contains the `pg_catalog.`-qualified forms, new connection requests
  currently fail in production with 42883.

### A1 conclusion

Roadmap item **A1** is complete: the deployed RLS policies, triggers,
functions and the relevant migration artifacts (`0010`–`0013`) were inspected
directly in production and match the expected repository security model. The
`0014` function-body detail above is tracked as an open G3 (migration
deployment) item, not an authorization-policy finding.

### Open G3 items (not covered by this round)

The following were **not** re-inspected in this round and remain open for the
roadmap G3 gate (G3.3–G3.5): the exact `send_connection_request` body (see
`0014` above), the Supabase Realtime publication membership, the `user_blocks`
table, `chat_deletions.hidden_until`, the absence of the legacy `0003`
self-connection CHECK, the `connections.status = 'ended'` path, and a re-check
of the `authenticated` grants on `profiles` / `connections` / `messages`.

## Verified deployment state (2026-08-30 — G3 production migration verification)

The deployed Supabase production instance was re-inspected on **2026-08-30**
with **read-only SQL queries only**; no database changes were made during this
verification and none are performed from this round. This round documents
roadmap item **G3** (database migration verification). It supersedes the
"Open G3 items" list of the A1 section above.

### G3 status

- G3.1 (migration ordering) — **verified**: the repository chain `0001`–`0014`
  is correctly sequenced and the production artifacts are consistent with
  sequential application up to `0013`.
- G3.2 (migration compatibility) — **open**: the repository chain is
  internally consistent, but the unresolved `0014` production mismatch (below)
  keeps this item open under the strict verification criterion.
- G3.3 (required migrations deployed) — **open**: `0014` is confirmed **not**
  deployed, and `0012` was not directly covered by this round's evidence.
- G3.4 (views / functions / triggers / RLS / grants) — **open**: a grant
  anomaly on the non-core tables (below) is under investigation.
- G3.5 (no migration missing) — **open**: `0014` is missing from the deployed
  state.

### Deployed migration evidence

- `0010` — `profiles.identity_public_key` (`text`, nullable) is present.
- `0011` — the four crypto tables (`crypto_devices`, `crypto_kyber_prekeys`,
  `crypto_one_time_prekeys`, `crypto_signed_prekeys`) are present.
- `0012` — not directly evidenced in this round; the
  `profiles_display_name_max_length` constraint state remains to be re-checked.
- `0013` — the deployed `connection_unread` view matches migration `0013`
  exactly (starts from `connections` with `LEFT JOIN connection_reads`, unread
  semantics, `status IN ('accepted','ended')`).
- `0014` — **confirmed mismatch, see below.**
- Earlier chain — the `connections` status CHECK `valid_status` contains all
  five states including `ended` (`0004`); `chat_deletions.hidden_until`
  (`timestamptz`, not null) is present (`0006`); `user_blocks` has the
  expected `id` / `blocker_id` / `blocked_id` / `created_at` columns (`0008`).
- Realtime — the `supabase_realtime` publication contains exactly the
  expected relevant tables: `chat_deletions`, `connection_reads`,
  `crypto_kyber_prekeys`, `crypto_one_time_prekeys`, `message_deletions`,
  `user_blocks`.

### `0014` — confirmed repository-vs-production mismatch

The deployed `send_connection_request(uuid)` body contains

```sql
pg_catalog.least(my_id::text, target::text) || ':' ||
pg_catalog.greatest(my_id::text, target::text)
```

while migration `0014` requires the unqualified `least(...)` /
`greatest(...)` forms. The deployed body otherwise matches the `0009` version
of the function (`SECURITY DEFINER`, `SET search_path TO 'public'`, the
`enough.connection_guard_trusted` flag). Migration `0014` is therefore
**not deployed**; the production migration state corresponds to `0013`.

PostgreSQL resolves `least` / `greatest` as grammar constructs, not as
schema-qualifiable functions, so the deployed expression raises SQLSTATE
`42883` ("function pg_catalog.least(text, text) does not exist") when
executed. The statement is unconditional in the function body, so every
invocation of the RPC fails — new connection requests made through
`send_connection_request` currently fail in production. Existing connections,
accepted chats, the decline/block flow and My Notes are unaffected (none of
them depends on this RPC's lock-key expression). Migration `0014` exists
precisely to fix this. **No repair was performed** and none is performed from
this verification round — applying `0014` remains a manual step in the
Supabase SQL editor.

### Grant anomaly on the non-core tables (under investigation)

The production grant state is:

- `profiles`, `connections`, `messages` — exactly the `0009` grant surface
  (only `authenticated`, only the intended DML privileges; no `anon` rows).
- All other inspected tables (`chat_deletions`, `connection_reads`,
  `crypto_devices`, `crypto_kyber_prekeys`, `crypto_one_time_prekeys`,
  `crypto_signed_prekeys`, `message_deletions`, `user_blocks`) — **both**
  `anon` and `authenticated` hold all seven table privileges (`SELECT`,
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`). This is
  wider than the explicit grants of migrations `0001` / `0008` / `0011` (the
  migrations never grant anything to `anon` and never grant `UPDATE` on
  `user_blocks`).

The pattern is consistent with the platform-level default privileges that
Supabase applies to new tables in the `public` schema (broad grants to
`anon` / `authenticated` recorded as default ACLs at table-creation time):
the repository migrations only ever add grants and never revoke, so they
could not narrow the inherited privileges. The three core tables show the
exact `0009` surface because `0009` performs an explicit `revoke all` before
re-granting.

Practical reachability: the Data API (PostgREST) exposes only `SELECT`,
`INSERT`, `UPDATE` and `DELETE`; `TRUNCATE`, `TRIGGER` and `REFERENCES`
cannot be exercised through the API, and `anon` / `authenticated` are
non-login roles. Row access through the API is therefore decided by RLS,
which every relevant migration enables (`0001`, `0008`, `0011`). Whether RLS
is actually enabled on these tables in production, and whether the expected
policies are present, has **not yet been confirmed** by this round's
evidence. Follow-up read-only queries were handed to the operator; until
they confirm the RLS state, the anomaly is documented as **unexplained** and
G3.4 stays open. No grant changes were made and none should be made without
an explicit decision.

## How to run

1. Open your Supabase project → **SQL Editor**.
2. Run the full contents of every file in `supabase/migrations/` in numeric
   order (`0001` → `0014`). Each migration is idempotent and safe to run again
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
- `0010_identity_public_key.sql` — E2EE foundation: adds `profiles.identity_public_key`
  (`text`, nullable) for the public identity key (base64, 32-byte raw
  X25519/Ed25519). No private material is ever stored; existing rows keep
  `NULL` until the client publishes its key via `updateMyIdentityPublicKey()`.
  No new RLS policies — the existing `profiles` SELECT (`authenticated`,
  `USING true`) and UPDATE (owner-only) from `0009` already govern the column.
- `0011_crypto_prekeys.sql` — E2EE prekey infrastructure: the four public-only
  crypto tables (`crypto_devices`, `crypto_signed_prekeys`,
  `crypto_one_time_prekeys`, `crypto_kyber_prekeys`) and the atomic
  `claim_prekey_bundle()` RPC (`FOR UPDATE SKIP LOCKED`, one-time prekeys
  consumed exactly once). No private key material is ever stored.
- `0012_profile_input_hardening.sql` — defense-in-depth for profile writes:
  normalizes `profiles.display_name` by stripping control characters and
  trimming surrounding whitespace in the existing profile triggers, and adds a
  `NOT VALID` database check so new writes cannot exceed 60 characters even if
  they bypass the UI's `maxLength`.
- `0013_fix_connection_unread_view.sql` — recreates the `connection_unread`
  view to start from `connections` with a LEFT JOIN on `connection_reads`, so
  every connection of the user is represented regardless of read state
  (removes the per-connection N+1 fallback queries).
- `0014_fix_send_connection_request_least_greatest.sql` — replaces
  `send_connection_request` with the corrected advisory-lock key expression
  using unqualified `least(...)` / `greatest(...)` (the `pg_catalog.`-qualified
  forms do not exist in PostgreSQL; SQLSTATE 42883).
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
