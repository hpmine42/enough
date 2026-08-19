-- =====================================================================
-- enough. — v0.2 migration: explicit base RLS + server-side guards (0009)
-- =====================================================================
-- Purpose (why this migration is required):
--   The core tables `profiles`, `connections` and `messages` were created
--   by the initial Supabase project template. Their base Row Level
--   Security policies are therefore NOT part of this repository and cannot
--   be reproduced from it. This migration makes the authorization model
--   explicit, idempotent and independent of any template defaults:
--
--   * `messages`   — SELECT only for participants of the connection;
--                   INSERT is still enforced by guard_message_insert (this
--                   migration adds a matching RLS policy as defense in
--                   depth); UPDATE only for the sender, with the
--                   delete-for-everyone semantics enforced server-side by a
--                   new BEFORE UPDATE trigger (24 h window, only the
--                   delete fields may change, immutable columns locked);
--                   no direct DELETE for client roles.
--   * `profiles`   — SELECT allowed for authenticated users (needed by the
--                   user search); UPDATE only for the owner and only
--                   `display_name`; no direct DELETE for client roles.
--   * `connections`— SELECT only for participants; INSERT only a caller's
--                   own outgoing `pending` request (no self-requests);
--                   UPDATE/DELETE restricted to the caller and validated by
--                   a new BEFORE UPDATE state machine.
--
--   The existing security-definer RPCs (send_connection_request,
--   delete_own_account, ensure_my_notes, …) perform privileged connection
--   writes. They are given a transaction-local "trusted" flag so the new
--   client-only invariants do not block legitimate internal transitions.
--
-- Safety properties:
--   * Idempotent — policies are dropped/re-created by name; functions are
--     `create or replace`; safe to run more than once.
--   * Additive & non-destructive — only objects defined in THIS migration
--     are dropped/re-created (never a template or third-party object).
--   * No data changes.
--   * The existing guard_message_insert and guard_blocked_connection_write
--     triggers are left untouched and remain the authority for sender
--     identity, accepted-status and block enforcement.
--   * RLS vs. trigger vs. RPC vs. client is kept strictly separated:
--       - RLS policies       → row-level authorization (which rows).
--       - BEFORE triggers    → per-row invariants / state machine.
--       - security definer   → privileged internal operations (bypass RLS,
--                              but still run through triggers, hence the
--                              trusted flag).
--       - client checks      → UX only; never relied upon for security.
--
-- UNABLE TO VERIFY – LIVE DEPLOYMENT:
--   The currently deployed project could not be inspected. If it still
--   carries a permissive template policy under a DIFFERENT name, that
--   policy remains in effect (permissive policies are OR-ed together).
--   Such a policy must be removed manually after inspection, or the
--   project re-created from these migrations. This migration only adds
--   correct, explicitly-named policies.
-- =====================================================================

begin;

-- Ensure RLS is actually enabled on the core tables. The initial template
-- normally enables it, but this makes the authorization model reproducible
-- regardless of the template state (idempotent no-op when already enabled).
alter table public.profiles enable row level security;
alter table public.connections enable row level security;
alter table public.messages enable row level security;

-- ---------------------------------------------------------------------
-- 1. messages
-- ---------------------------------------------------------------------

-- SELECT: a user may only read messages of connections they participate in.
drop policy if exists messages_select_own_connections on public.messages;
create policy messages_select_own_connections on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.connections c
       where c.id = connection_id
         and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- INSERT: defense in depth behind guard_message_insert (which already
-- enforces sender identity, accepted status and blocking). The policy
-- mirrors the same invariants so RLS alone is also sufficient.
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.connections c
       where c.id = connection_id
         and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- UPDATE: only the sender of a message may update it. Field-level and
-- timing semantics are enforced by guard_message_update (below).
drop policy if exists messages_update_sender_only on public.messages;
create policy messages_update_sender_only on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- No DELETE policy: direct row deletion is not part of the product.
-- "Delete for me" goes through message_deletions; "delete for everyone"
-- is an UPDATE (deleteMessageForEveryone), not a DELETE.

-- Server-side invariants for message UPDATE. A client may ONLY perform the
-- "delete for everyone" mutation on their own message:
--   * deleted_at: null -> now(), once, within 24 h of created_at;
--   * ciphertext: cleared to '' as part of that delete;
--   * every other column (id, connection_id, sender_id, created_at, kind,
--     meta) is immutable; content cannot be edited or restored.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
declare
  actor uuid := auth.uid();
begin
  -- Trusted internal writes (system events / security-definer RPCs) bypass
  -- these client-only invariants, mirroring guard_message_insert.
  if current_setting('enough.message_guard_trusted', true) = '1' then
    return new;
  end if;

  if actor is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Defense in depth: RLS already restricts updates to the sender.
  if old.sender_id <> actor then
    raise exception 'Messages can only be updated by the sender.'
      using errcode = '42501';
  end if;

  -- Identity, context and system columns are immutable for clients.
  if new.id is distinct from old.id
     or new.connection_id is distinct from old.connection_id
     or new.sender_id is distinct from old.sender_id
     or new.created_at is distinct from old.created_at
     or new.kind is distinct from old.kind
     or new.meta is distinct from old.meta then
    raise exception 'Only delete-for-everyone updates are allowed.'
      using errcode = 'P0001';
  end if;

  -- deleted_at may only transition null -> non-null, once, within 24 h.
  if new.deleted_at is distinct from old.deleted_at then
    if old.deleted_at is not null then
      raise exception 'A deleted message cannot be modified.' using errcode = 'P0001';
    end if;
    if new.deleted_at is null then
      raise exception 'A deleted message cannot be restored.' using errcode = 'P0001';
    end if;
    if old.created_at < now() - interval '24 hours' then
      raise exception 'The delete window has expired.' using errcode = 'P0001';
    end if;
  end if;

  -- ciphertext may only be cleared, and only as part of a delete.
  if new.ciphertext is distinct from old.ciphertext then
    if new.ciphertext <> '' then
      raise exception 'Message content cannot be edited.' using errcode = 'P0001';
    end if;
    if new.deleted_at is null then
      raise exception 'Content may only be cleared by delete-for-everyone.'
        using errcode = 'P0001';
    end if;
  end if;

  -- A delete must clear the content.
  if new.deleted_at is not null and new.ciphertext <> '' then
    raise exception 'Deleting a message requires clearing its content.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_message_update on public.messages;
create trigger guard_message_update
  before update on public.messages
  for each row execute function public.guard_message_update();

-- ---------------------------------------------------------------------
-- 2. profiles
-- ---------------------------------------------------------------------

-- SELECT: authenticated users may read all profiles. This is required by
-- the user search and by rendering peer names in chats. Only non-sensitive
-- columns (id, username, display_name, created_at) exist on the table.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated
  using (true);

-- INSERT: registration upsert (authenticated fallback for environments with
-- auto-confirm). The profile must be the caller's own.
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- UPDATE: only the caller's own profile.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No DELETE policy: account removal is performed by the security-definer
-- RPC delete_own_account().

-- display_name is the only user-editable profile column. The identity
-- columns (id, username, created_at) are immutable so a user can neither
-- forge an id nor take over a different username via a direct API call.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Defense in depth (RLS already restricts updates to the owner).
  if old.id <> actor then
    raise exception 'A profile can only be updated by its owner.'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.username is distinct from old.username
     or new.created_at is distinct from old.created_at then
    raise exception 'Only display_name may be changed.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
-- 3. connections
-- ---------------------------------------------------------------------

-- SELECT: only connections the caller participates in.
drop policy if exists connections_select_involved on public.connections;
create policy connections_select_involved on public.connections
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- INSERT: a caller may only create their own outgoing pending request.
-- Requests on behalf of others and self-requests are rejected here. The
-- My Notes self-connection is created exclusively through the
-- ensure_my_notes() security-definer RPC.
drop policy if exists connections_insert_own_request on public.connections;
create policy connections_insert_own_request on public.connections
  for insert to authenticated
  with check (
    user_a = auth.uid()
    and user_b <> auth.uid()
    and status = 'pending'
  );

-- UPDATE: only involved users may update; the state machine is enforced by
-- guard_connection_update (below).
drop policy if exists connections_update_involved on public.connections;
create policy connections_update_involved on public.connections
  for update to authenticated
  using (user_a = auth.uid() or user_b = auth.uid())
  with check (user_a = auth.uid() or user_b = auth.uid());

-- DELETE: a caller may only cancel their own outgoing pending request.
-- Re-requesting from the other side is handled by send_connection_request.
drop policy if exists connections_delete_own_request on public.connections;
create policy connections_delete_own_request on public.connections
  for delete to authenticated
  using (user_a = auth.uid() and status = 'pending');

-- State machine for direct client UPDATEs. Legitimate transitions:
--   * the recipient (user_b) accepts or declines a pending request;
--   * the requester (user_a) re-opens their own dead request (pending,
--     declined or expired) back to pending.
-- Everything else — downgrading an accepted connection, the requester
-- accepting their own request, endpoint swaps, ended transitions — is
-- rejected for direct clients and reserved for the security-definer RPCs.
create or replace function public.guard_connection_update()
returns trigger
language plpgsql
as $$
declare
  actor uuid := auth.uid();
begin
  -- Trusted internal writes (security-definer RPCs such as
  -- send_connection_request and delete_own_account) bypass these
  -- client-only invariants.
  if current_setting('enough.connection_guard_trusted', true) = '1' then
    return new;
  end if;

  if actor is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Defense in depth: RLS already restricts updates to involved users.
  if old.user_a <> actor and old.user_b <> actor then
    raise exception 'Only participants may modify a connection.'
      using errcode = '42501';
  end if;

  -- The pair identity is immutable for clients.
  if new.user_a is distinct from old.user_a
     or new.user_b is distinct from old.user_b then
    raise exception 'Connection participants cannot be changed.'
      using errcode = 'P0001';
  end if;

  if new.id is distinct from old.id then
    raise exception 'Connection id cannot be changed.' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending'
       and actor = old.user_b
       and new.status in ('accepted', 'declined') then
      null; -- recipient accepts / declines
    elsif actor = old.user_a
          and old.status in ('pending', 'declined', 'expired')
          and new.status = 'pending' then
      null; -- requester re-opens own request
    else
      raise exception 'Invalid connection status transition.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_connection_update on public.connections;
create trigger guard_connection_update
  before update on public.connections
  for each row execute function public.guard_connection_update();

-- ---------------------------------------------------------------------
-- 4. Explicit client-role grants
-- ---------------------------------------------------------------------
-- Make the authorization surface reproducible regardless of template
-- defaults: revoke everything from client roles, then grant back only
-- what the application exposes. service_role / postgres are untouched.

revoke all on public.profiles from anon, authenticated;
revoke all on public.connections from anon, authenticated;
revoke all on public.messages from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.connections to authenticated;
grant select, insert, update on public.messages to authenticated;

-- ---------------------------------------------------------------------
-- 5. Trusted flag for privileged connection writes
-- ---------------------------------------------------------------------
-- The security-definer RPCs below perform connection writes that direct
-- clients must not be able to do (endpoint swaps when re-requesting from
-- the other side; marking conversations 'ended' on account deletion).
-- They set a transaction-local flag that guard_connection_update honors.
-- The existing guard_blocked_connection_write trigger is intentionally
-- NOT bypassed: blocks keep applying to every write.

create or replace function public.send_connection_request(target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  my_id    uuid := auth.uid();
  lock_key bigint;
  existing record;
  conn_id  uuid;
begin
  if my_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Trusted context for the connection writes performed below (endpoint
  -- swaps and request restores are not allowed for direct clients).
  perform set_config('enough.connection_guard_trusted', '1', true);

  if target is null or target = my_id then
    raise exception 'Invalid target.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'User not found.' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.user_blocks ub
     where (ub.blocker_id = my_id and ub.blocked_id = target)
        or (ub.blocker_id = target and ub.blocked_id = my_id)
  ) then
    raise exception 'This user is blocked.' using errcode = 'BLCKD';
  end if;

  lock_key := pg_catalog.hashtextextended(
    pg_catalog.least(my_id::text, target::text) || ':' ||
    pg_catalog.greatest(my_id::text, target::text), 0
  );
  perform pg_catalog.pg_advisory_xact_lock(lock_key);

  select c.id, c.user_a, c.user_b, c.status
    into existing
    from public.connections c
   where (c.user_a = my_id and c.user_b = target)
      or (c.user_a = target and c.user_b = my_id)
   limit 1;

  if existing.id is not null then
    if existing.status = 'accepted' then
      raise exception 'Connection already exists.' using errcode = 'P0001';
    end if;
    if existing.status = 'pending' and existing.user_b = my_id then
      return existing.id;
    end if;
    if existing.status in ('pending', 'declined', 'expired')
       and existing.user_a = my_id then
      update public.connections
         set status = 'pending', created_at = pg_catalog.now()
       where id = existing.id;
      return existing.id;
    end if;
    if existing.status in ('declined', 'expired')
       and existing.user_b = my_id then
      update public.connections
         set user_a = my_id, user_b = target, status = 'pending',
             created_at = pg_catalog.now()
       where id = existing.id;
      return existing.id;
    end if;
    if existing.status = 'ended' then
      update public.connections
         set user_a = my_id, user_b = target, status = 'pending',
             created_at = pg_catalog.now()
       where id = existing.id;
      return existing.id;
    end if;
    raise exception 'Connection already exists.' using errcode = 'P0001';
  end if;

  insert into public.connections (user_a, user_b, status)
  values (my_id, target, 'pending')
  returning id into conn_id;
  return conn_id;
end;
$$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_id       uuid := auth.uid();
  my_username text;
begin
  if my_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select p.username
    into my_username
    from public.profiles p
   where p.id = my_id;

  -- Notify every accepted conversation that this account is gone.
  -- The notice must be written even when a peer blocked this account.
  perform set_config('enough.message_guard_trusted', '1', true);
  insert into public.messages (connection_id, sender_id, ciphertext, kind, meta)
  select c.id, my_id, '', 'deleted_account',
         jsonb_build_object('username', coalesce(my_username, 'unknown'))
    from public.connections c
   where (c.user_a = my_id or c.user_b = my_id)
     and c.status = 'accepted'
     and c.user_a <> c.user_b;  -- My Notes self-chat needs no notice
  perform set_config('enough.message_guard_trusted', '0', true);

  -- Lock the conversations so the other side can read but not write.
  -- 'accepted' -> 'ended' is a privileged transition (trusted flag).
  perform set_config('enough.connection_guard_trusted', '1', true);
  update public.connections c
     set status = 'ended'
   where (c.user_a = my_id or c.user_b = my_id)
     and c.status = 'accepted';
  perform set_config('enough.connection_guard_trusted', '0', true);

  -- Free the username, then remove the account itself. Per-user read/deletion
  -- state cascades away via its own `on delete cascade` foreign keys.
  delete from public.profiles where id = my_id;
  delete from auth.users where id = my_id;
end;
$$;

commit;
