-- =====================================================================
-- enough. — minimal Supabase auth/role shim for local Postgres tests
-- =====================================================================
-- Provides the roles, auth.uid(), auth.users, and user_blocks surface that
-- migration 0011_crypto_prekeys.sql and crypto-prekeys-tests.sql need.
-- This is NOT a full Supabase stack and is only used by the local/CI
-- prekey RPC/RLS harness (scripts/run-crypto-prekeys-tests.mjs).
--
-- Safe to re-run (idempotent). Does not touch production.
-- =====================================================================

begin;

-- Roles used by Supabase RLS policies / grants.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- auth schema + uid() matching Supabase's JWT claim resolution order.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, public;

create table if not exists auth.users (
  id uuid primary key
);

grant select on auth.users to anon, authenticated, service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (
        nullif(current_setting('request.jwt.claims', true), '')::jsonb
        ->> 'sub'
      )
    ),
    ''
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role, public;

-- Minimal user_blocks (subset of 0008) — claim_prekey_bundle rejects blocked pairs.
create table if not exists public.user_blocks (
  id          bigserial primary key,
  blocker_id  uuid not null references auth.users (id) on delete cascade,
  blocked_id  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint user_blocks_no_self check (blocker_id <> blocked_id),
  constraint user_blocks_pair_unique unique (blocker_id, blocked_id)
);

alter table public.user_blocks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_blocks'
       and policyname = 'user_blocks_select_involved'
  ) then
    create policy user_blocks_select_involved on public.user_blocks
      for select to authenticated
      using (blocker_id = auth.uid() or blocked_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_blocks'
       and policyname = 'user_blocks_insert_own'
  ) then
    create policy user_blocks_insert_own on public.user_blocks
      for insert to authenticated
      with check (blocker_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_blocks'
       and policyname = 'user_blocks_delete_own'
  ) then
    create policy user_blocks_delete_own on public.user_blocks
      for delete to authenticated
      using (blocker_id = auth.uid());
  end if;
end $$;

grant select, insert, delete on public.user_blocks to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
