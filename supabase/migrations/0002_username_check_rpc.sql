-- =====================================================================
-- enough. — v0.2 migration: username availability RPC
-- =====================================================================
-- Provides a public RPC to check whether a username is already taken.
-- This is needed because the profiles table's RLS policies may block
-- anonymous reads during registration.
-- =====================================================================

begin;

create or replace function public.check_username_taken(name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where username = name
  );
$$;

grant execute on function public.check_username_taken(text) to anon, authenticated;

commit;
