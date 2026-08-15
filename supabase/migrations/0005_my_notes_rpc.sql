-- =====================================================================
-- enough. — v0.5 migration: reliable My Notes setup
-- =====================================================================
-- A normal connection request must not be allowed to create an already
-- accepted connection. Well-configured Row Level Security therefore commonly
-- restricts browser inserts to `status = 'pending'`. My Notes is the one safe
-- exception: it is an accepted connection from the signed-in user to itself.
--
-- These narrowly scoped SECURITY DEFINER functions create/remove only the
-- caller's own self-connection. This keeps the normal connection policies
-- strict instead of weakening them for every browser insert.
--
-- The migration also repeats the legacy CHECK-constraint cleanup from 0003 so
-- it is safe to apply directly to an installation where self-connections are
-- still blocked. It is idempotent.
-- =====================================================================

begin;

-- Some early schemas explicitly required the two connection endpoints to be
-- different. Remove only a CHECK constraint that refers to both endpoint
-- columns and compares them for inequality.
do $$
declare
  con record;
begin
  for con in
    select conname,
           pg_get_constraintdef(oid) as definition
      from pg_constraint
     where conrelid = 'public.connections'::regclass
       and contype = 'c'
  loop
    if (con.definition like '%user_a%' and con.definition like '%user_b%')
       and (con.definition like '%<>%' or con.definition like '%!=%') then
      execute format(
        'alter table public.connections drop constraint %I',
        con.conname
      );
      raise notice 'enough.: dropped self-connection-blocking constraint %', con.conname;
    end if;
  end loop;
end $$;

create or replace function public.ensure_my_notes()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_id uuid := auth.uid();
  notes_id uuid;
begin
  if my_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Serialize setup attempts for one account. This avoids a unique-index race
  -- when two tabs enable My Notes at the same time.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(my_id::text, 0)
  );

  select c.id
    into notes_id
    from public.connections c
   where c.user_a = my_id
     and c.user_b = my_id
   order by c.created_at desc nulls last, c.id
   limit 1;

  if notes_id is not null then
    update public.connections
       set status = 'accepted',
           created_at = case
             when status = 'accepted' then created_at
             else pg_catalog.now()
           end
     where id = notes_id;
    return notes_id;
  end if;

  insert into public.connections (user_a, user_b, status)
  values (my_id, my_id, 'accepted')
  returning id into notes_id;

  return notes_id;
end;
$$;

create or replace function public.remove_my_notes()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_id uuid := auth.uid();
  removed_count integer;
begin
  if my_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Delete the private note messages explicitly so this works with both
  -- CASCADE and older restrictive messages.connection_id foreign keys.
  delete from public.messages m
   where m.connection_id in (
     select c.id
       from public.connections c
      where c.user_a = my_id
        and c.user_b = my_id
   );

  delete from public.connections c
   where c.user_a = my_id
     and c.user_b = my_id;

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

-- Functions are executable by PUBLIC unless explicitly revoked. Only signed-in
-- users may call these functions; each function is additionally bound to
-- auth.uid() and accepts no user or connection identifier from the client.
revoke all on function public.ensure_my_notes() from public, anon;
revoke all on function public.remove_my_notes() from public, anon;
grant execute on function public.ensure_my_notes() to authenticated;
grant execute on function public.remove_my_notes() to authenticated;

comment on function public.ensure_my_notes() is
  'Creates or restores the authenticated user''s accepted My Notes self-connection.';
comment on function public.remove_my_notes() is
  'Deletes only the authenticated user''s My Notes self-connection and messages.';

commit;
