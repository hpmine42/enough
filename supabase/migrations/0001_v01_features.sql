-- =====================================================================
-- enough. — v0.1 feature migration (0001)
-- =====================================================================
-- Purpose (why this migration is required):
--   The v0.1 feature set needs: display names, connection request
--   decline/expiry, system events (display-name changes), per-user
--   deletion state, per-user read state and Home unread counts.
--   None of these can be represented in the existing schema.
--
-- Safety properties:
--   * Idempotent — safe to run more than once.
--   * Non-destructive — no DROP TABLE, no DROP POLICY, no DELETE of
--     user data (the only DELETEs target duplicate connection rows
--     created by the same pair of users, keeping the newest/accepted).
--   * Existing triggers and policies are left untouched; new objects
--     are additive.
--
-- Run in the Supabase SQL editor (or via `supabase db push`).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. profiles.display_name
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name text;

-- Copy display_name from the auth sign-up metadata (fallback: username).
-- The existing auth.users trigger that creates the profile row is not
-- modified; this trigger only fills the new column.
create or replace function public.sync_profile_display_name()
returns trigger
language plpgsql
as $$
declare
  meta jsonb;
begin
  meta := (select raw_user_meta_data from auth.users where id = new.id);
  if new.display_name is null or new.display_name = '' then
    new.display_name := coalesce(meta->>'display_name', new.username);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_profile_display_name on public.profiles;
create trigger sync_profile_display_name
  before insert on public.profiles
  for each row execute function public.sync_profile_display_name();

-- ---------------------------------------------------------------------
-- 2. connections: declined / expired states + one row per user pair
-- ---------------------------------------------------------------------

-- Extend the status check constraint without knowing its name.
do $$
declare
  con_name text;
  con_def  text;
begin
  select pg_constraint.conname, pg_get_constraintdef(pg_constraint.oid)
    into con_name, con_def
    from pg_constraint
    join pg_class on pg_class.oid = pg_constraint.conrelid
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
   where pg_namespace.nspname = 'public'
     and pg_class.relname = 'connections'
     and pg_constraint.contype = 'c'
     and con_def like '%pending%accepted%'
   limit 1;

  if con_name is not null then
    execute format(
      'alter table public.connections drop constraint %I',
      con_name
    );
    execute format(
      'alter table public.connections add constraint %I check (status in (''pending''::text, ''accepted''::text, ''declined''::text, ''expired''::text))',
      con_name
    );
  end if;
end $$;

-- Normalize to one connection per user pair: remove duplicate rows
-- created by the same pair (keeps an accepted row over pending ones,
-- otherwise the newest). Required before the unique index below.
do $$
declare
  r record;
begin
  for r in
    select least(user_a, user_b) as ua, greatest(user_a, user_b) as ub
      from public.connections
     group by 1, 2
    having count(*) > 1
  loop
    delete from public.connections c
     where least(c.user_a, c.user_b) = r.ua
       and greatest(c.user_a, c.user_b) = r.ub
       and c.id not in (
             select c2.id
               from public.connections c2
              where least(c2.user_a, c2.user_b) = r.ua
                and greatest(c2.user_a, c2.user_b) = r.ub
              order by (c2.status = 'accepted') desc,
                       c2.created_at desc nulls last,
                       c2.id
              limit 1
           );
  end loop;
end $$;

create unique index if not exists connections_pair_unique
  on public.connections (least(user_a, user_b), greatest(user_a, user_b));

create index if not exists connections_user_a_idx on public.connections (user_a);
create index if not exists connections_user_b_idx on public.connections (user_b);

-- Lazy expiry cleanup: pending/declined attempts older than 14 days.
-- The client also treats such rows as expired; this keeps the stored
-- state consistent when the app is not running.
update public.connections
   set status = 'expired'
 where status in ('pending', 'declined')
   and created_at < now() - interval '14 days';

-- ---------------------------------------------------------------------
-- 3. messages: system-event support + DB-side enforcement
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists kind text not null default 'text';
alter table public.messages
  add column if not exists meta jsonb;

create index if not exists messages_connection_created_idx
  on public.messages (connection_id, created_at desc);

-- DB-side enforcement: no messaging into non-accepted or expired
-- connections (14-day lifetime is enforced here, not only in the UI),
-- and the sender must be the current user (defense in depth behind RLS).
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
as $$
declare
  conn public.connections%rowtype;
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
  return new;
end;
$$;

drop trigger if exists guard_message_insert on public.messages;
create trigger guard_message_insert
  before insert on public.messages
  for each row execute function public.guard_message_insert();

-- Display-name changes become system events in every accepted
-- conversation ("Anna Müller changed their name to Anna Schmidt.").
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
  insert into public.messages (connection_id, sender_id, ciphertext, kind, meta)
  select c.id, new.id, '', 'name_change',
         jsonb_build_object(
           'old_name', old.display_name,
           'new_name', new.display_name
         )
    from public.connections c
   where c.status = 'accepted'
     and (c.user_a = new.id or c.user_b = new.id);
  return new;
end;
$$;

drop trigger if exists on_profile_display_name_change on public.profiles;
create trigger on_profile_display_name_change
  after update of display_name on public.profiles
  for each row execute function public.on_profile_display_name_change();

-- When a connection request is accepted, the requester gets a system
-- event in the conversation: "@anna accepted your connection."
create or replace function public.on_connection_accepted()
returns trigger
language plpgsql
as $$
begin
  if new.user_a = new.user_b then
    return new; -- My Notes self-connection: no event
  end if;
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
  return new;
end;
$$;

drop trigger if exists on_connection_accepted on public.connections;
create trigger on_connection_accepted
  after update of status on public.connections
  for each row
  when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function public.on_connection_accepted();

-- ---------------------------------------------------------------------
-- 4. Per-user read state
-- ---------------------------------------------------------------------
create table if not exists public.connection_reads (
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  primary key (connection_id, user_id)
);

alter table public.connection_reads enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'connection_reads'
                    and policyname = 'connection_reads_select_own') then
    create policy connection_reads_select_own on public.connection_reads
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'connection_reads'
                    and policyname = 'connection_reads_insert_own') then
    create policy connection_reads_insert_own on public.connection_reads
      for insert to authenticated with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'connection_reads'
                    and policyname = 'connection_reads_update_own') then
    create policy connection_reads_update_own on public.connection_reads
      for update to authenticated using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'connection_reads'
                    and policyname = 'connection_reads_delete_own') then
    create policy connection_reads_delete_own on public.connection_reads
      for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Per-user message deletion ("delete for me")
-- ---------------------------------------------------------------------
create table if not exists public.message_deletions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_deletions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'message_deletions'
                    and policyname = 'message_deletions_select_own') then
    create policy message_deletions_select_own on public.message_deletions
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'message_deletions'
                    and policyname = 'message_deletions_insert_own') then
    -- A user may only hide a message inside a connection they belong to.
    create policy message_deletions_insert_own on public.message_deletions
      for insert to authenticated
      with check (
        user_id = auth.uid()
        and exists (
          select 1
            from public.messages m
            join public.connections c on c.id = m.connection_id
           where m.id = message_id
             and (c.user_a = auth.uid() or c.user_b = auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'message_deletions'
                    and policyname = 'message_deletions_delete_own') then
    create policy message_deletions_delete_own on public.message_deletions
      for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Per-user chat deletion ("delete chat for me")
-- ---------------------------------------------------------------------
create table if not exists public.chat_deletions (
  connection_id uuid not null references public.connections (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (connection_id, user_id)
);

alter table public.chat_deletions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'chat_deletions'
                    and policyname = 'chat_deletions_select_own') then
    create policy chat_deletions_select_own on public.chat_deletions
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'chat_deletions'
                    and policyname = 'chat_deletions_insert_own') then
    create policy chat_deletions_insert_own on public.chat_deletions
      for insert to authenticated
      with check (
        user_id = auth.uid()
        and exists (
          select 1
            from public.connections c
           where c.id = connection_id
             and (c.user_a = auth.uid() or c.user_b = auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'chat_deletions'
                    and policyname = 'chat_deletions_delete_own') then
    create policy chat_deletions_delete_own on public.chat_deletions
      for delete to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Home unread counts (security-invoker view → RLS of the underlying
--    tables applies per user)
-- ---------------------------------------------------------------------
create or replace view public.connection_unread
with (security_invoker = on) as
select cr.user_id,
       c.id as connection_id,
       count(m.id)::int as unread
  from public.connection_reads cr
  join public.connections c on c.id = cr.connection_id
  left join public.messages m
    on m.connection_id = c.id
   and m.created_at > cr.last_read_at
   and m.sender_id <> cr.user_id
   and m.deleted_at is null
   and (m.kind is null or m.kind = 'text')
 group by cr.user_id, c.id;

-- ---------------------------------------------------------------------
-- 8. Grants for the Data API (authenticated role)
-- ---------------------------------------------------------------------
grant select, insert, update, delete
  on public.connection_reads, public.message_deletions, public.chat_deletions
  to authenticated;

grant select on public.connection_unread to authenticated;

-- ---------------------------------------------------------------------
-- 9. Realtime publications (idempotent)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public'
                      and tablename = 'message_deletions') then
      alter publication supabase_realtime add table public.message_deletions;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public'
                      and tablename = 'chat_deletions') then
      alter publication supabase_realtime add table public.chat_deletions;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public'
                      and tablename = 'connection_reads') then
      alter publication supabase_realtime add table public.connection_reads;
    end if;
  end if;
end $$;

commit;
