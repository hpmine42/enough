-- =====================================================================
-- enough. — v0.2 migration: fix send_connection_request least/greatest
-- =====================================================================
-- Purpose:
--   In PostgreSQL, `least(...)` and `greatest(...)` are built-in SQL
--   scalar expressions/constructs, not schema-qualified functions in
--   `pg_catalog`. Calling `pg_catalog.least(...)` raises error 42883
--   ("function pg_catalog.least(text, text) does not exist").
--
--   This migration replaces `send_connection_request` with the corrected
--   lock key expression using standard unqualified `least(...)` and
--   `greatest(...)`.
--
-- Safety:
--   * `security definer` and `set search_path = public` are preserved.
--   * `enough.connection_guard_trusted` setting is preserved.
--   * Advisory transaction locks and block checks are preserved.
--   * State machine transitions are unchanged.
--   * Idempotent (CREATE OR REPLACE FUNCTION).
-- =====================================================================

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
    least(my_id::text, target::text) || ':' ||
    greatest(my_id::text, target::text), 0
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
