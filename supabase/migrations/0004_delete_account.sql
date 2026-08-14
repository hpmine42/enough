-- =====================================================================
-- enough. — v0.4 migration: self-service account deletion
-- =====================================================================
-- Lets a signed-in user permanently delete their own account:
--   * the username is freed (profile row removed, so it can be re-registered),
--   * the auth user is removed from Supabase,
--   * any accepted conversations the user had are kept, but they are marked
--     `ended` and receive a "@username deleted their account" system message;
--     the other participant can still read the chat but can no longer reply
--     (the message-insert guard only allows writes to `accepted` connections).
--
-- Idempotent and non-destructive (it only adds a status value, drops legacy
-- foreign keys that would otherwise cascade-delete chat history, and creates
-- one RPC). Run in the Supabase SQL editor.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Allow the `ended` connection status
-- ---------------------------------------------------------------------
do $$
declare
  con_name text;
begin
  select pg_constraint.conname
    into con_name
    from pg_constraint
    join pg_class on pg_class.oid = pg_constraint.conrelid
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
   where pg_namespace.nspname = 'public'
     and pg_class.relname = 'connections'
     and pg_constraint.contype = 'c'
     and pg_get_constraintdef(pg_constraint.oid) like '%pending%'
     and pg_get_constraintdef(pg_constraint.oid) like '%accepted%'
   limit 1;

  if con_name is not null then
    execute format('alter table public.connections drop constraint %I', con_name);
    execute format(
      'alter table public.connections add constraint %I check (status in (''pending''::text, ''accepted''::text, ''declined''::text, ''expired''::text, ''ended''::text))',
      con_name
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Decouple chat history from the auth user
-- ---------------------------------------------------------------------
-- Chat history (connections + messages) must survive an account deletion.
-- Drop any legacy foreign key from `connections`/`messages` to `auth.users`
-- or `profiles` so deleting the user neither cascades into the history nor
-- is blocked by a RESTRICT/NO ACTION reference. The columns keep their
-- values; the deleted user is rendered from the system message / `ended`
-- status instead.
do $$
declare
  fk record;
begin
  for fk in
    select con.conname,
           con.conrelid::regclass as tbl,
           con.confrelid::regclass as ref
      from pg_constraint con
     where con.contype = 'f'
       and con.conrelid in ('public.connections'::regclass, 'public.messages'::regclass)
       and con.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  loop
    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    raise notice 'enough.: dropped FK % on % -> % to preserve chat history', fk.conname, fk.tbl, fk.ref;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. delete_own_account() RPC
-- ---------------------------------------------------------------------
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
  insert into public.messages (connection_id, sender_id, ciphertext, kind, meta)
  select c.id, my_id, '', 'deleted_account',
         jsonb_build_object('username', coalesce(my_username, 'unknown'))
    from public.connections c
   where (c.user_a = my_id or c.user_b = my_id)
     and c.status = 'accepted'
     and c.user_a <> c.user_b;  -- My Notes self-chat needs no notice

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

grant execute on function public.delete_own_account() to authenticated;

commit;
