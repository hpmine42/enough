-- =====================================================================
-- enough. — v0.3 migration: allow self-connections (My Notes)
-- =====================================================================
-- My Notes is an accepted connection from a user to themselves
-- (user_a = user_b = auth.uid()). Some deployments carry a legacy
-- CHECK constraint that forbids that (e.g. `CHECK (user_a <> user_b)`),
-- which makes the self-chat insert fail silently and My Notes appear
-- broken. This migration removes only such a constraint, if present.
--
-- Idempotent and non-destructive: it never touches data and only drops
-- a constraint that literally prevents self-connections.
-- =====================================================================

begin;

do $$
declare
  con record;
begin
  for con in
    select conname,
           pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.connections'::regclass
       and contype = 'c'
  loop
    -- Only a constraint that references both endpoints and enforces that they
    -- differ (e.g. `CHECK (user_a <> user_b)`) blocks the My Notes self-chat.
    if (con.def like '%user_a%' and con.def like '%user_b%')
       and (con.def like '%<>%' or con.def like '%!=%') then
      execute format('alter table public.connections drop constraint %I', con.conname);
      raise notice 'enough.: dropped self-connection-blocking constraint %', con.conname;
    end if;
  end loop;
end $$;

commit;
