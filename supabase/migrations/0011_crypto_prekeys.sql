-- =====================================================================
-- enough. — v0.2 E2EE prekey infrastructure (0011)
-- =====================================================================
-- Purpose (why this migration is required):
--   Publishes the PUBLIC prekey material devices need for asynchronous
--   session establishment (Signal PQXDH + Double Ratchet via
--   @getmaapp/signal-wasm@0.6.6). Four additive tables hold only PUBLIC
--   keys + signatures; an atomic security-definer RPC claims a bundle so
--   two callers can never successfully consume the same one-time prekey.
--
-- What this migration adds:
--   * crypto_devices           — identity public key + registration id
--   * crypto_signed_prekeys    — active signed prekey (public + signature)
--   * crypto_one_time_prekeys  — one-time X25519 prekeys (public only)
--   * crypto_kyber_prekeys     — Kyber1024 prekeys (public + signature),
--                                one-time or last-resort
--   * claim_prekey_bundle()    — atomic bundle claim (FOR UPDATE SKIP LOCKED)
--   * RLS: public material readable where the protocol needs it; one-time
--     and kyber prekeys are owner-SELECT only (the RPC is the only path a
--     peer can read them through).
--
-- Security invariants:
--   * NO private key material is ever stored here. Columns hold only public
--     keys and Ed25519 signatures (base64).
--   * A one-time prekey / one-time kyber is consumed exactly once: the claim
--     RPC locks the row (SKIP LOCKED) and stamps consumed_at inside the same
--     transaction; a concurrent claim gets a different row or none.
--   * The last-resort kyber is reusable: it is returned but never marked
--     consumed here (its anti-replay lives client-side in kyber_usage).
--   * Self-claims and blocked pairs (either direction) are rejected.
--
-- Safety properties:
--   * Idempotent — `create table if not exists`, `drop policy if exists` +
--     `create policy`, `create or replace function`.
--   * Additive & non-destructive — no existing table is altered or dropped.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.crypto_devices (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  device_id      int         not null default 1,           -- v0.2: one device per account
  identity_key   text        not null,                     -- base64 serialized Signal identity public key
  registration_id int        not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists public.crypto_signed_prekeys (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  device_id  int         not null default 1,
  key_id     int         not null,
  public_key text        not null,                         -- base64, 32-byte X25519 public key
  signature  text        not null,                         -- base64, 64-byte Ed25519 signature
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id, key_id)
);

create table if not exists public.crypto_one_time_prekeys (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  device_id   int         not null default 1,
  key_id      int         not null,
  public_key  text        not null,                         -- base64, 32-byte X25519 public key
  created_at  timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid,
  primary key (user_id, device_id, key_id)
);

create table if not exists public.crypto_kyber_prekeys (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  device_id      int         not null default 1,
  key_id         int         not null,
  public_key     text        not null,                      -- base64, Kyber1024 public key (~1184 bytes)
  signature      text        not null,                      -- base64, 64-byte Ed25519 signature
  is_last_resort boolean     not null default false,
  created_at     timestamptz not null default now(),
  consumed_at    timestamptz,
  consumed_by    uuid,
  primary key (user_id, device_id, key_id)
);

alter table public.crypto_devices          enable row level security;
alter table public.crypto_signed_prekeys   enable row level security;
alter table public.crypto_one_time_prekeys enable row level security;
alter table public.crypto_kyber_prekeys    enable row level security;

-- Partial indexes that make atomic claiming fast: only unconsumed rows.
create index if not exists crypto_otp_unconsumed_idx
  on public.crypto_one_time_prekeys (user_id, device_id, key_id)
  where consumed_at is null;
create index if not exists crypto_kyber_onetime_unconsumed_idx
  on public.crypto_kyber_prekeys (user_id, device_id, key_id)
  where consumed_at is null and is_last_resort = false;
create index if not exists crypto_kyber_lastresort_idx
  on public.crypto_kyber_prekeys (user_id, device_id, key_id)
  where is_last_resort = true;

-- ---------------------------------------------------------------------
-- 2. RLS policies
-- ---------------------------------------------------------------------
-- crypto_devices / crypto_signed_prekeys: the identity key and signed
-- prekey are PUBLIC protocol material (a peer needs them to build a
-- bundle), so any authenticated user may SELECT them. Only the owner may
-- write. crypto_one_time_prekeys / crypto_kyber_prekeys are NOT freely
-- SELECTable: a peer obtains one only through the atomic claim RPC, which
-- also marks it consumed. The owner may SELECT their own rows (pool mgmt).

do $$
begin
  -- crypto_devices
  if not exists (select 1 from pg_policies where tablename = 'crypto_devices' and policyname = 'crypto_devices_select_auth') then
    create policy crypto_devices_select_auth on public.crypto_devices
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crypto_devices' and policyname = 'crypto_devices_owner_write') then
    create policy crypto_devices_owner_write on public.crypto_devices
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  -- crypto_signed_prekeys
  if not exists (select 1 from pg_policies where tablename = 'crypto_signed_prekeys' and policyname = 'crypto_spk_select_auth') then
    create policy crypto_spk_select_auth on public.crypto_signed_prekeys
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crypto_signed_prekeys' and policyname = 'crypto_spk_owner_write') then
    create policy crypto_spk_owner_write on public.crypto_signed_prekeys
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  -- crypto_one_time_prekeys: owner-only SELECT/INSERT/UPDATE/DELETE
  if not exists (select 1 from pg_policies where tablename = 'crypto_one_time_prekeys' and policyname = 'crypto_otp_owner_select') then
    create policy crypto_otp_owner_select on public.crypto_one_time_prekeys
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crypto_one_time_prekeys' and policyname = 'crypto_otp_owner_write') then
    create policy crypto_otp_owner_write on public.crypto_one_time_prekeys
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  -- crypto_kyber_prekeys: owner-only SELECT/INSERT/UPDATE/DELETE
  if not exists (select 1 from pg_policies where tablename = 'crypto_kyber_prekeys' and policyname = 'crypto_kpk_owner_select') then
    create policy crypto_kpk_owner_select on public.crypto_kyber_prekeys
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'crypto_kyber_prekeys' and policyname = 'crypto_kpk_owner_write') then
    create policy crypto_kpk_owner_write on public.crypto_kyber_prekeys
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Atomic bundle claim (security definer)
-- ---------------------------------------------------------------------
-- claim_prekey_bundle(p_target) returns one device's full public bundle for
-- the caller to run processPreKeyBundle locally, atomically consuming one
-- one-time X25519 prekey and (if available) one one-time Kyber prekey. The
-- last-resort Kyber is returned but NOT consumed (anti-replay is client-side).
--
-- Concurrency: rows are locked with FOR UPDATE SKIP LOCKED inside one
-- transaction; a concurrent claim for the same target gets a *different*
-- unconsumed row, or none. Two callers therefore never successfully claim
-- the same one-time prekey.
--
-- Runs as SECURITY DEFINER with a pinned search_path so it can read/lock the
-- peer's owner-only prekey rows despite RLS.

create or replace function public.claim_prekey_bundle(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_device     public.crypto_devices%rowtype;
  v_spk        public.crypto_signed_prekeys%rowtype;
  v_otp        public.crypto_one_time_prekeys%rowtype;
  v_kpk        public.crypto_kyber_prekeys%rowtype;
  v_has_otp    boolean := false;
  v_block      int;
  v_is_last    boolean := false;
begin
  if v_caller is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;
  if v_caller = p_target then
    raise exception 'Cannot claim your own prekey bundle.' using errcode = 'P0001';
  end if;

  -- Blocked in either direction -> no bundle.
  select 1 into v_block from public.user_blocks
   where (blocker_id = p_target and blocked_id = v_caller)
      or (blocker_id = v_caller and blocked_id = p_target)
   limit 1;
  if v_block = 1 then
    raise exception 'blocked' using errcode = 'BLCKD';
  end if;

  -- Device + active signed prekey.
  select * into v_device from public.crypto_devices
   where user_id = p_target and device_id = 1;
  if not found then
    raise exception 'Target has no published device.' using errcode = 'P0001';
  end if;

  select * into v_spk from public.crypto_signed_prekeys
   where user_id = p_target and device_id = 1 and is_active
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'Target has no active signed prekey.' using errcode = 'P0001';
  end if;

  -- One-time X25519 prekey: claim the lowest-id unconsumed one.
  select * into v_otp from public.crypto_one_time_prekeys
   where user_id = p_target and device_id = 1 and consumed_at is null
   order by key_id
   limit 1
   for update skip locked;
  v_has_otp := found;
  if v_has_otp then
    update public.crypto_one_time_prekeys
       set consumed_at = now(), consumed_by = v_caller
     where user_id = p_target and device_id = 1 and key_id = v_otp.key_id;
  end if;

  -- Kyber prekey: prefer an unconsumed one-time; fall back to last-resort.
  select * into v_kpk from public.crypto_kyber_prekeys
   where user_id = p_target and device_id = 1
     and consumed_at is null and is_last_resort = false
   order by key_id
   limit 1
   for update skip locked;
  if found then
    v_is_last := false;
    update public.crypto_kyber_prekeys
       set consumed_at = now(), consumed_by = v_caller
     where user_id = p_target and device_id = 1 and key_id = v_kpk.key_id;
  else
    select * into v_kpk from public.crypto_kyber_prekeys
     where user_id = p_target and device_id = 1 and is_last_resort = true
     order by key_id
     limit 1
     for update;
    if not found then
      raise exception 'Target has no kyber prekey.' using errcode = 'P0001';
    end if;
    v_is_last := true;
    -- last-resort is intentionally NOT consumed: it is reused, and the
    -- anti-replay for it is enforced client-side via kyber_usage.
  end if;

  return jsonb_build_object(
    'userId', p_target,
    'deviceId', 1,
    'registrationId', v_device.registration_id,
    'identityKey', v_device.identity_key,
    'signedPreKey', jsonb_build_object(
      'keyId', v_spk.key_id,
      'publicKey', v_spk.public_key,
      'signature', v_spk.signature
    ),
    'oneTimePreKey', case when v_has_otp then jsonb_build_object(
      'keyId', v_otp.key_id,
      'publicKey', v_otp.public_key
    ) else null end,
    'kyberPreKey', jsonb_build_object(
      'keyId', v_kpk.key_id,
      'publicKey', v_kpk.public_key,
      'signature', v_kpk.signature,
      'isLastResort', v_is_last
    )
  );
end;
$$;

-- Revoke public execute; grant only to authenticated (the caller identity).
revoke all on function public.claim_prekey_bundle(uuid) from public, anon;
grant execute on function public.claim_prekey_bundle(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------
grant select, insert, update, delete
  on public.crypto_devices, public.crypto_signed_prekeys,
      public.crypto_one_time_prekeys, public.crypto_kyber_prekeys
  to authenticated;

-- ---------------------------------------------------------------------
-- 5. Realtime publication (idempotent) — lets the owner observe pool drain.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public'
                      and tablename = 'crypto_one_time_prekeys') then
      alter publication supabase_realtime add table public.crypto_one_time_prekeys;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public'
                      and tablename = 'crypto_kyber_prekeys') then
      alter publication supabase_realtime add table public.crypto_kyber_prekeys;
    end if;
  end if;
end $$;

commit;
