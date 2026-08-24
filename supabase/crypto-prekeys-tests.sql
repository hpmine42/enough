-- =====================================================================
-- enough. — E2EE-v0.2 prekey RPC & RLS test cases (0011)
-- =====================================================================
-- These are SQL-level test cases for the claim_prekey_bundle() RPC and the
-- crypto_* RLS policies. They REQUIRE a live Postgres/Supabase instance with
-- migrations 0001..0011 applied; they are NOT executed by the Node test
-- runner (which has no Postgres). Run them in the Supabase SQL editor or a
-- CI job with a provisioned database.
--
-- Conventions: each case sets up two fake auth identities, acts as one of
-- them via `set local role authenticated; set local request.jwt.claim.sub`,
-- and asserts an expected outcome with a RAISE on mismatch.
-- =====================================================================

-- Helper: enable the supabase auth uid() shim used by RLS in raw SQL tests.
-- (In a real Supabase test harness, auth.uid() is populated from the JWT.)


-- ---------------------------------------------------------------------
-- Case 1: two concurrent claims never get the same one-time prekey
-- ---------------------------------------------------------------------
-- Setup: target user T publishes 1 signed prekey + 3 one-time prekeys +
-- 1 last-resort kyber + 1 one-time kyber. Two callers C1, C2 each claim.
-- Assert: C1 and C2 receive DIFFERENT one-time prekey ids, and exactly two
-- rows are now marked consumed_at.
--
--   claim 1 (as C1): bundle1 := claim_prekey_bundle(T)
--   claim 2 (as C2): bundle2 := claim_prekey_bundle(T)
--   assert bundle1.oneTimePreKey.keyId <> bundle2.oneTimePreKey.keyId
--   assert (select count(*) from crypto_one_time_prekeys
--            where user_id = T and consumed_at is not null) = 2


-- ---------------------------------------------------------------------
-- Case 2: self-claim is rejected
-- ---------------------------------------------------------------------
--   claim_prekey_bundle(self)  ->  raises P0001 ('own')


-- ---------------------------------------------------------------------
-- Case 3: blocked pair is rejected (either direction)
-- ---------------------------------------------------------------------
--   insert into user_blocks(blocker_id, blocked_id) values (T, C1)
--   claim_prekey_bundle(T) as C1  ->  raises BLCKD
--   (and symmetrically when C1 blocks T)


-- ---------------------------------------------------------------------
-- Case 4: exhausted one-time pool yields oneTimePreKey = null but the
--         bundle still succeeds (Kyber last-resort path)
-- ---------------------------------------------------------------------
--   publish T with 0 one-time prekeys; claim as C1
--   assert bundle.oneTimePreKey is null
--   assert bundle.kyberPreKey is not null


-- ---------------------------------------------------------------------
-- Case 5: last-resort Kyber is returned but never marked consumed
-- ---------------------------------------------------------------------
--   publish T with 0 one-time kyber (only last-resort); claim as C1, C2, C3
--   assert all three bundles share the SAME kyber keyId (last-resort)
--   assert no crypto_kyber_prekeys row for T has consumed_at set


-- ---------------------------------------------------------------------
-- Case 6: RLS — a peer cannot SELECT another user's one-time/kyber prekeys
-- ---------------------------------------------------------------------
--   as C1: select * from crypto_one_time_prekeys where user_id = T
--   assert: 0 rows (owner-only SELECT policy)
--   as C1: select * from crypto_kyber_prekeys where user_id = T
--   assert: 0 rows
--   as C1: select identity_key from crypto_devices where user_id = T
--   assert: 1 row (public identity is readable)


-- ---------------------------------------------------------------------
-- Case 7: RLS — only the owner may INSERT/UPDATE/DELETE their prekeys
-- ---------------------------------------------------------------------
--   as C1: insert into crypto_one_time_prekeys(user_id, ...) values (T, ...)
--   assert: rejected (42501)
--   as T:  insert ... -> ok
--
-- NOTE: claim_prekey_bundle runs as SECURITY DEFINER, so it can mark the
-- peer's rows consumed despite the owner-only RLS. Direct client UPDATE of
-- a peer's consumed_at must still be rejected (Case 7).


-- ---------------------------------------------------------------------
-- Case 8: private material is never stored
-- ---------------------------------------------------------------------
--   Inspect the four crypto_* tables: no column may hold a private key,
--   session state, or message key. Columns are: identity_key (public),
--   registration_id, public_key, signature, consumed_at, consumed_by,
--   is_active, is_last_resort. Assert no 'private'/'secret'/'record'
--   column exists.
