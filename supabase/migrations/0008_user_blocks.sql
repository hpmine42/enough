-- =====================================================================
-- enough. — v0.3 migration: user blocking (0008)
-- =====================================================================
-- Purpose (why this migration is required):
--   Users must be able to block each other. Blocking is a separate
--   security dimension from the connection status machine
--   (pending | accepted | declined | expired | ended) and must be
--   enforced in the database — not only in the client — so a blocked
--   user cannot create requests or send messages via direct API calls.
--
-- What this migration adds:
--   1. public.user_blocks — one row per (blocker, blocked) pair with
--      RLS so a user can only read involved rows, only create blocks
--      they are the blocker of, and only delete their own blocks.
--   2. A BEFORE INSERT/UPDATE guard on connections: no new connection
--      rows and no transitions into pending/accepted between a blocked
--      pair (declined/expired/ended transitions stay allowed so
--      decline+block, expiry cleanup and account deletion keep working).
--   3. An extension of the existing message-insert guard: no messages
--      in either direction while a block exists. Trusted system events
--      (name-change events, connection-accepted events, the
--      deleted-account notice) set a transaction-local GUC so they
--      keep working even between blocked users.
--   4. Two auth-bound RPCs:
--        send_connection_request(target) — the single authoritative
--          way to create/restore a request; re-request after decline
--          or expiry works in both directions and reuses the one-row-
--          per-pair model (no unique-constraint conflicts).
--        decline_connection(conn, block_peer) — decline an incoming
--          request and optionally block the requester in one step.
--
-- Safety properties:
--   * Idempotent — safe to run more than once.
--   * Additive — no DROP POLICY on existing objects, no data deletion,
--     no weakening of existing RLS rules.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. user_blocks
-- ---------------------------------------------------------------------
create table if not exists public.user_blocks (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references auth.users (id) on delete cascade,
  blocked_id  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint user_blocks_no_self check (blocker_id <> blocked_id),
  constraint user_blocks_pair_unique unique (blocker_id, blocked_id)
);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

do $$
begin
  -- Both sides may read the relation: the blocker manages it in
  -- Settings, the blocked user must be able to see why they cannot
  -- message or request this user anymore.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'user_blocks'
                    and policyname = 'user_blocks_select_involved') then
    create policy user_blocks_select_involved on public.user_blocks
      for select to authenticated
      using (blocker_id = auth.uid() or blocked_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'user_blocks'
                    and policyname = 'user_blocks_insert_own') then
    create policy user_blocks_insert_own on public.user_blocks
      for insert to authenticated
      with check (blocker_id = auth.uid());
  end if;
  -- Only the blocker may remove the block. No UPDATE policy exists:
  -- block rows cannot be manipulated, only created/deleted.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'user_blocks'
                    and policyname = 'user_blocks_delete_own') then
    create policy user_blocks_delete_own on public.user_blocks
      for delete to authenticated
      using (blocker_id = auth.uid());
  end if;
end $$;

grant select, insert, delete on public.user_blocks to authenticated;

-- ---------------------------------------------------------------------
-- 2. Connection guard: no connections between a blocked pair
-- ---------------------------------------------------------------------
create or replace function public.guard_blocked_connection_write()
returns trigger
language plpgsql
as $$
declare
  is_blocked boolean;
begin
  if (tg_op = 'INSERT')
     or (tg_op = 'UPDATE'
         and new.status in ('pending', 'accepted')
         and (new.status is distinct from old.status
              or new.user_a is distinct from old.user_a
              or new.user_b is distinct from old.user_b)) then
    select exists (
      select 1
        from public.user_blocks ub
       where (ub.blocker_id = new.user_a and ub.blocked_id = new.user_b)
          or (ub.blocker_id = new.user_b and ub.blocked_id = new.user_a)
    ) into is_blocked;
    if is_blocked then
      raise exception 'This connection is blocked.' using errcode = 'BLCKD';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_blocked_connection_write on public.connections;
create trigger guard_blocked_connection_write
  before insert or update on public.connections
  for each row execute function public.guard_blocked_connection_write();

-- ---------------------------------------------------------------------
-- 3. Message guard: no messages in either direction while blocked
-- ---------------------------------------------------------------------
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
as $$
declare
  conn public.connections%rowtype;
  other uuid;
  is_blocked boolean;
begin
  select * into conn from public.connections where id = new.connection_id;
  if conn.id is null then
    raise exception 'Connection does not exist.' using errcode = 'P0001';
  end if;
  if conn.status <> 'accepted' then
    raise exception 'This conversation is not active.' using errcode = 'P0001';
  end if;
  if new.sender_id <> auth.uid() then
    raise exception 'Messages can only be sent by the sender.' using errcode = 'P0001';
  end if;

  -- Block check. Trusted system events (display-name changes, the
  -- accepted-connection event, the deleted-account notice) set a
  -- transaction-local GUC and must keep working even between blocked
  -- users. Regular inserts — including direct PostgREST calls — are
  -- blocked in both directions while a block exists.
  if current_setting('enough.message_guard_trusted', true) is distinct from '1' then
    other := case
      when conn.user_a = new.sender_id then conn.user_b
      else conn.user_a
    end;
    select exists (
      select 1
        from public.user_blocks ub
       where (ub.blocker_id = new.sender_id and ub.blocked_id = other)
          or (ub.blocker_id = other and ub.blocked_id = new.sender_id)
    ) into is_blocked;
    if is_blocked then
      raise exception 'This conversation is blocked.' using errcode = 'BLCKD';
    end if;
  end if;
  return new;
end;
$$;

-- System events stay reliable between blocked users: mark their inserts
-- as trusted for the transaction.
create or replace function public.on_profile_display_name_change()
returns trigger
language plpgsql
as $$
begin
  if new.display_name is not distinct from old.display_name then
    return new;
  end if;
  -- A first-time name (previously NULL/empty) is not a "change".
  if old.display_name is null or old.display_name = '' then
    return new;
  end if;
  perform set_config('enough.message_guard_trusted', '1', true);
  insert into public.messages (connection_id, sender_id, ciphertext, kind, meta)
  select c.id, new.id, '', 'name_change',
         jsonb_build_object(
           'old_name', old.display_name,
           'new_name', new.display_name
         )
    from public.connections c
   where c.status = 'accepted'
     and (c.user_a = new.id or c.user_b = new.id);
  perform set_config('enough.message_guard_trusted', '0', true);
  return new;
end;
$$;

create or replace function public.on_connection_accepted()
returns trigger
language plpgsql
as $$
begin
  if new.user_a = new.user_b then
    return new; -- My Notes self-connection: no event
  end if;
  perform set_config('enough.message_guard_trusted', '1', true);
  insert into public.messages (connection_id, sender_id, ciphertext, kind, meta)
  values (
    new.id,
    new.user_b, -- the acceptor
    '',
    'connection_event',
    jsonb_build_object(
      'type', 'accepted',
      'username', (select username from public.profiles where id = new.user_b)
    )
  );
  perform set_config('enough.message_guard_trusted', '0', true);
  return new;
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
  update public.connections c
     set status = 'ended'
   where (c.user_a = my_id or c.user_b = my_id)
     and c.status = 'accepted';

  -- Free the username, then remove the account itself. Per-user read/deletion
  -- state cascades away via its own `on delete cascade` foreign keys.
  delete from public.profiles where id = my_id;
  delete from auth.users where id = my_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. RPCs: request state machine + decline (+block)
-- ---------------------------------------------------------------------

-- The single authoritative way to create or restore a connection
-- request. Restores a previous declined/expired attempt of the caller,
-- reuses a dead attempt of the other side (the one-row-per-pair model
-- stays intact, so no unique-constraint conflicts), keeps a live
-- incoming request untouched, and rejects everything while a block
-- exists between the two users.
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

  -- Serialize request creation for one pair (both directions share the
  -- same key) to avoid unique-index races between two clients.
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
    -- Already connected: consent states must not be downgraded.
    if existing.status = 'accepted' then
      raise exception 'Connection already exists.' using errcode = 'P0001';
    end if;
    -- The other side already has a live request to me: leave it alone.
    if existing.status = 'pending' and existing.user_b = my_id then
      return existing.id;
    end if;
    -- My own previous attempt (pending/declined/expired): restore it as
    -- a fresh request — the 14-day window restarts.
    if existing.status in ('pending', 'declined', 'expired')
       and existing.user_a = my_id then
      update public.connections
         set status = 'pending', created_at = pg_catalog.now()
       where id = existing.id;
      return existing.id;
    end if;
    -- Their previous attempt was declined or expired: the pair row is
    -- reused for my new outgoing request.
    if existing.status in ('declined', 'expired')
       and existing.user_b = my_id then
      update public.connections
         set user_a = my_id, user_b = target, status = 'pending',
             created_at = pg_catalog.now()
       where id = existing.id;
      return existing.id;
    end if;
    -- Ended conversations can be re-requested (the row and its history
    -- are reused; the deleted account itself cannot be found anymore).
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

-- Decline an incoming request and optionally block the requester in the
-- same step. Only the recipient (user_b) of a pending request may call
-- this. Idempotent: a request that is no longer pending is left alone.
create or replace function public.decline_connection(conn uuid, block_peer boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_id uuid := auth.uid();
  row record;
begin
  if my_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  select c.user_a, c.user_b, c.status
    into row
    from public.connections c
   where c.id = conn;
  if row.user_b is null then
    raise exception 'Connection not found.' using errcode = 'P0001';
  end if;
  if row.user_b <> my_id then
    raise exception 'Only the recipient can decline.' using errcode = '42501';
  end if;
  if row.status <> 'pending' then
    return;
  end if;
  if block_peer and row.user_a <> my_id then
    insert into public.user_blocks (blocker_id, blocked_id)
    values (my_id, row.user_a)
    on conflict (blocker_id, blocked_id) do nothing;
  end if;
  update public.connections
     set status = 'declined'
   where id = conn and status = 'pending';
end;
$$;

revoke all on function public.send_connection_request(uuid) from public, anon;
revoke all on function public.decline_connection(uuid, boolean) from public, anon;
grant execute on function public.send_connection_request(uuid) to authenticated;
grant execute on function public.decline_connection(uuid, boolean) to authenticated;

comment on function public.send_connection_request(uuid) is
  'Creates or restores a pending connection request for the authenticated user; enforces blocking.';
comment on function public.decline_connection(uuid, boolean) is
  'Declines an incoming pending request and optionally blocks the requester; recipient-only.';

-- ---------------------------------------------------------------------
-- 5. Realtime publication
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public'
                      and tablename = 'user_blocks') then
      alter publication supabase_realtime add table public.user_blocks;
    end if;
  end if;
end $$;

commit;
