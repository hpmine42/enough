-- =====================================================================
-- enough. — E2EE-v0.2 prekey RPC & RLS tests (0011)
-- =====================================================================
-- Executable SQL-level tests for claim_prekey_bundle() and the crypto_*
-- RLS policies. They REQUIRE a live Postgres/Supabase instance with the
-- auth shim (supabase/tests/bootstrap_supabase_auth.sql) and migration
-- 0011_crypto_prekeys.sql applied.
--
-- Run via:  npm run test:crypto:prekeys
--   (starts embedded Postgres, applies bootstrap + 0011, then this file)
-- Or manually in a provisioned Supabase SQL editor after 0011 is applied
-- (create the four test users in auth.users first).
--
-- Every check raises an exception on failure; a clean run means all cases
-- passed. Conventions match supabase/rls-tests.sql: switch identity with
-- set_config(request.jwt.claims) + set local role authenticated.
-- =====================================================================

-- Helper: switch the request context to a given user (transaction-local).
create or replace function public.__crypto_test_set_user(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixed UUIDs for reproducible runs (not real accounts).
-- T = target publisher; C1/C2/C3 = claimants.
do $$
begin
  insert into auth.users (id) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'), -- T
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'), -- C1
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'), -- C2
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3')  -- C3
  on conflict (id) do nothing;
end $$;

-- =====================================================================
-- Shared publish helper (as target T): device + SPK + optional OTP/Kyber
-- =====================================================================
create or replace function public.__crypto_test_publish(
  p_user uuid,
  p_otp_count int default 3,
  p_kyber_onetime_count int default 1,
  p_include_last_resort boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
begin
  insert into public.crypto_devices (user_id, device_id, identity_key, registration_id)
  values (p_user, 1, 'ik-' || p_user::text, 42)
  on conflict (user_id, device_id) do update
    set identity_key = excluded.identity_key,
        registration_id = excluded.registration_id;

  update public.crypto_signed_prekeys
     set is_active = false
   where user_id = p_user and device_id = 1 and is_active;

  insert into public.crypto_signed_prekeys (
    user_id, device_id, key_id, public_key, signature, is_active
  ) values (
    p_user, 1, 1, 'spk-pub-' || p_user::text, 'spk-sig-' || p_user::text, true
  )
  on conflict (user_id, device_id, key_id) do update
    set public_key = excluded.public_key,
        signature = excluded.signature,
        is_active = true;

  delete from public.crypto_one_time_prekeys where user_id = p_user;
  delete from public.crypto_kyber_prekeys where user_id = p_user;

  for i in 1..p_otp_count loop
    insert into public.crypto_one_time_prekeys (user_id, device_id, key_id, public_key)
    values (p_user, 1, i, 'otp-pub-' || i::text);
  end loop;

  if p_include_last_resort then
    insert into public.crypto_kyber_prekeys (
      user_id, device_id, key_id, public_key, signature, is_last_resort
    ) values (
      p_user, 1, 1, 'kpk-lr-pub', 'kpk-lr-sig', true
    );
  end if;

  for i in 1..p_kyber_onetime_count loop
    insert into public.crypto_kyber_prekeys (
      user_id, device_id, key_id, public_key, signature, is_last_resort
    ) values (
      p_user, 1, i + 1, 'kpk-ot-pub-' || i::text, 'kpk-ot-sig-' || i::text, false
    );
  end loop;
end;
$$;

-- =====================================================================
-- Case 1: two claims never get the same one-time prekey
-- =====================================================================
-- Sequential claims still exercise the consumption path (consumed_at stamp).
-- True concurrent SKIP LOCKED locking is additionally verified by the Node
-- harness (two simultaneous connections) in scripts/run-crypto-prekeys-tests.mjs.
do $$
declare
  t  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  c1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  c2 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  b1 jsonb;
  b2 jsonb;
  id1 int;
  id2 int;
  n_consumed int;
begin
  perform public.__crypto_test_publish(t, 3, 2, true);

  perform public.__crypto_test_set_user(c1);
  b1 := public.claim_prekey_bundle(t);

  perform public.__crypto_test_set_user(c2);
  b2 := public.claim_prekey_bundle(t);

  id1 := (b1 -> 'oneTimePreKey' ->> 'keyId')::int;
  id2 := (b2 -> 'oneTimePreKey' ->> 'keyId')::int;

  if id1 is null or id2 is null then
    raise exception 'FAIL Case1: expected one-time prekeys, got % / %', b1, b2;
  end if;
  if id1 = id2 then
    raise exception 'FAIL Case1: both claims received the same OTP keyId %', id1;
  end if;

  -- Count as table owner: peer RLS would hide target rows (that is Case 6).
  reset role;
  select count(*) into n_consumed
    from public.crypto_one_time_prekeys
   where user_id = t and consumed_at is not null;
  if n_consumed <> 2 then
    raise exception 'FAIL Case1: expected 2 consumed OTPs, got %', n_consumed;
  end if;

  raise notice 'PASS Case1: distinct OTP claims (% / %), consumed=%', id1, id2, n_consumed;
end $$;

-- =====================================================================
-- Case 2: self-claim is rejected
-- =====================================================================
do $$
declare
  t uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
begin
  perform public.__crypto_test_publish(t, 1, 0, true);
  perform public.__crypto_test_set_user(t);
  begin
    perform public.claim_prekey_bundle(t);
    raise exception 'FAIL Case2: self-claim succeeded';
  exception
    when others then
      if sqlstate = 'P0001' and sqlerrm ilike '%own%' then
        null; -- expected
      elsif sqlstate = 'P0001' and position('own' in lower(sqlerrm)) > 0 then
        null;
      else
        -- Re-raise our own FAIL; otherwise require P0001 + "own".
        if sqlerrm like 'FAIL Case2%' then
          raise;
        end if;
        if sqlstate <> 'P0001' or position('own' in lower(sqlerrm)) = 0 then
          raise exception 'FAIL Case2: unexpected sqlstate % (%)', sqlstate, sqlerrm;
        end if;
      end if;
  end;
  raise notice 'PASS Case2: self-claim rejected';
end $$;

-- =====================================================================
-- Case 3: blocked pair is rejected (either direction)
-- =====================================================================
do $$
declare
  t  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  c1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
begin
  perform public.__crypto_test_publish(t, 1, 0, true);

  -- T blocks C1
  delete from public.user_blocks
   where (blocker_id = t and blocked_id = c1)
      or (blocker_id = c1 and blocked_id = t);
  perform public.__crypto_test_set_user(t);
  insert into public.user_blocks (blocker_id, blocked_id) values (t, c1);

  perform public.__crypto_test_set_user(c1);
  begin
    perform public.claim_prekey_bundle(t);
    raise exception 'FAIL Case3a: claim while blocked by target succeeded';
  exception
    when others then
      if sqlerrm like 'FAIL Case3%' then raise; end if;
      if sqlstate <> 'BLCKD' then
        raise exception 'FAIL Case3a: unexpected sqlstate % (%)', sqlstate, sqlerrm;
      end if;
  end;

  -- Clear, then C1 blocks T (symmetric)
  perform public.__crypto_test_set_user(t);
  delete from public.user_blocks where blocker_id = t and blocked_id = c1;
  perform public.__crypto_test_set_user(c1);
  insert into public.user_blocks (blocker_id, blocked_id) values (c1, t);

  begin
    perform public.claim_prekey_bundle(t);
    raise exception 'FAIL Case3b: claim while caller blocks target succeeded';
  exception
    when others then
      if sqlerrm like 'FAIL Case3%' then raise; end if;
      if sqlstate <> 'BLCKD' then
        raise exception 'FAIL Case3b: unexpected sqlstate % (%)', sqlstate, sqlerrm;
      end if;
  end;

  -- Cleanup blocks
  delete from public.user_blocks
   where (blocker_id = t and blocked_id = c1)
      or (blocker_id = c1 and blocked_id = t);

  raise notice 'PASS Case3: blocked pair rejected both directions';
end $$;

-- =====================================================================
-- Case 4: exhausted one-time pool → oneTimePreKey null, bundle still ok
-- =====================================================================
do $$
declare
  t  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  c1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  b  jsonb;
begin
  perform public.__crypto_test_publish(t, 0, 1, true);
  perform public.__crypto_test_set_user(c1);
  b := public.claim_prekey_bundle(t);

  if b -> 'oneTimePreKey' is not null and jsonb_typeof(b -> 'oneTimePreKey') <> 'null' then
    raise exception 'FAIL Case4: expected null oneTimePreKey, got %', b -> 'oneTimePreKey';
  end if;
  if b -> 'kyberPreKey' is null or jsonb_typeof(b -> 'kyberPreKey') = 'null' then
    raise exception 'FAIL Case4: expected kyberPreKey, got null';
  end if;

  raise notice 'PASS Case4: exhausted OTP pool yields null OTP + kyber present';
end $$;

-- =====================================================================
-- Case 5: last-resort Kyber returned but never marked consumed
-- =====================================================================
do $$
declare
  t  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  c1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  c2 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  c3 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  b1 jsonb; b2 jsonb; b3 jsonb;
  k1 int; k2 int; k3 int;
  n_consumed int;
begin
  -- 0 one-time kyber, only last-resort
  perform public.__crypto_test_publish(t, 3, 0, true);

  perform public.__crypto_test_set_user(c1);
  b1 := public.claim_prekey_bundle(t);
  perform public.__crypto_test_set_user(c2);
  b2 := public.claim_prekey_bundle(t);
  perform public.__crypto_test_set_user(c3);
  b3 := public.claim_prekey_bundle(t);

  k1 := (b1 -> 'kyberPreKey' ->> 'keyId')::int;
  k2 := (b2 -> 'kyberPreKey' ->> 'keyId')::int;
  k3 := (b3 -> 'kyberPreKey' ->> 'keyId')::int;

  if not (k1 = k2 and k2 = k3) then
    raise exception 'FAIL Case5: last-resort keyIds differ: % % %', k1, k2, k3;
  end if;
  if (b1 -> 'kyberPreKey' ->> 'isLastResort')::boolean is not true then
    raise exception 'FAIL Case5: expected isLastResort=true';
  end if;

  reset role;
  select count(*) into n_consumed
    from public.crypto_kyber_prekeys
   where user_id = t and consumed_at is not null;
  if n_consumed <> 0 then
    raise exception 'FAIL Case5: last-resort must not be consumed, got %', n_consumed;
  end if;

  raise notice 'PASS Case5: last-resort kyber reused (keyId=%), never consumed', k1;
end $$;

-- =====================================================================
-- Case 6: RLS — peer cannot SELECT another user's OTP/Kyber; identity ok
-- =====================================================================
do $$
declare
  t  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  c1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  n int;
begin
  perform public.__crypto_test_publish(t, 2, 1, true);
  perform public.__crypto_test_set_user(c1);

  select count(*) into n from public.crypto_one_time_prekeys where user_id = t;
  if n <> 0 then
    raise exception 'FAIL Case6: peer SELECT on crypto_one_time_prekeys returned % rows', n;
  end if;

  select count(*) into n from public.crypto_kyber_prekeys where user_id = t;
  if n <> 0 then
    raise exception 'FAIL Case6: peer SELECT on crypto_kyber_prekeys returned % rows', n;
  end if;

  select count(*) into n from public.crypto_devices where user_id = t;
  if n <> 1 then
    raise exception 'FAIL Case6: peer should read public identity, got % rows', n;
  end if;

  select count(*) into n
    from public.crypto_signed_prekeys
   where user_id = t and is_active;
  if n <> 1 then
    raise exception 'FAIL Case6: peer should read active signed prekey, got % rows', n;
  end if;

  raise notice 'PASS Case6: OTP/Kyber owner-only SELECT; identity/SPK public';
end $$;

-- =====================================================================
-- Case 7: RLS — only owner may INSERT/UPDATE peer prekeys
-- =====================================================================
do $$
declare
  t  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  c1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
begin
  perform public.__crypto_test_publish(t, 1, 0, true);
  perform public.__crypto_test_set_user(c1);

  begin
    insert into public.crypto_one_time_prekeys (user_id, device_id, key_id, public_key)
    values (t, 1, 99, 'evil');
    raise exception 'FAIL Case7a: peer INSERT into target OTP succeeded';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL Case7%' then raise; end if;
      if sqlstate <> '42501' then
        raise exception 'FAIL Case7a: unexpected sqlstate % (%)', sqlstate, sqlerrm;
      end if;
  end;

  -- Drop the authenticated role so the verification SELECT is not RLS-filtered.
  reset role;
  if exists (
    select 1 from public.crypto_one_time_prekeys
     where user_id = t and key_id = 99
  ) then
    raise exception 'FAIL Case7a: evil OTP row exists';
  end if;

  -- Owner INSERT works.
  perform public.__crypto_test_set_user(t);
  insert into public.crypto_one_time_prekeys (user_id, device_id, key_id, public_key)
  values (t, 1, 77, 'owner-otp')
  on conflict do nothing;
  if not exists (
    select 1 from public.crypto_one_time_prekeys
     where user_id = t and key_id = 77
  ) then
    raise exception 'FAIL Case7b: owner could not INSERT own OTP';
  end if;

  -- Peer cannot UPDATE consumed_at on target rows (RLS filters / rejects).
  perform public.__crypto_test_set_user(c1);
  update public.crypto_one_time_prekeys
     set consumed_at = now(), consumed_by = c1
   where user_id = t and key_id = 77;
  -- As peer, the row is invisible so UPDATE affects 0 rows.
  perform public.__crypto_test_set_user(t);
  if exists (
    select 1 from public.crypto_one_time_prekeys
     where user_id = t and key_id = 77 and consumed_at is not null
  ) then
    raise exception 'FAIL Case7c: peer stamped consumed_at on owner OTP';
  end if;

  raise notice 'PASS Case7: owner-only write; peer cannot stamp consumed_at';
end $$;

-- =====================================================================
-- Case 8: private material is never stored (schema invariant)
-- =====================================================================
do $$
declare
  bad text;
begin
  select c.table_name || '.' || c.column_name into bad
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in (
       'crypto_devices',
       'crypto_signed_prekeys',
       'crypto_one_time_prekeys',
       'crypto_kyber_prekeys'
     )
     and (
       c.column_name ilike '%private%'
       or c.column_name ilike '%secret%'
       or c.column_name ilike '%record%'
       or c.column_name ilike '%seed%'
     )
   limit 1;

  if bad is not null then
    raise exception 'FAIL Case8: forbidden column present: %', bad;
  end if;

  -- Allowed public-protocol columns must exist.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crypto_devices'
       and column_name = 'identity_key'
  ) then
    raise exception 'FAIL Case8: crypto_devices.identity_key missing';
  end if;

  raise notice 'PASS Case8: no private/secret/record columns on crypto_* tables';
end $$;

-- Cleanup test helpers (leave schema/data for optional inspection; harness
-- uses a throwaway cluster so residual rows are fine). Must run as the
-- session owner — last cases leave role = authenticated.
reset role;
drop function if exists public.__crypto_test_set_user(uuid);
drop function if exists public.__crypto_test_publish(uuid, int, int, boolean);

do $$ begin
  raise notice 'crypto-prekeys-tests.sql: all cases passed';
end $$;
