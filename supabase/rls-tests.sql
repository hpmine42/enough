-- =====================================================================
-- enough. — RLS / authorization test script
-- =====================================================================
-- Run AFTER applying every file in supabase/migrations/ (0001 through
-- 0009), in the Supabase SQL editor. Uses the two oldest profiles in the
-- database as test users A and B (i.e. your two existing test accounts) and
-- verifies both positive and negative authorization cases for the v0.1
-- feature set, the v0.2 base policies (0009) and blocking (0008).
--
-- Every check raises an exception on failure; a run that finishes
-- without errors means all checks passed.
--
-- Enforcement layers are deliberately kept visible in the tests:
--   * RLS policies  → rows are silently filtered (assert "unchanged").
--   * BEFORE trigger → raises P0001 (assert the exception / sqlstate).
--   * security definer RPCs → privileged operations (assert the effect).
-- =====================================================================

-- Helper: switch the request context to a given user.
create or replace function public.__rls_test_set_user(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', uid::text, 'role', 'authenticated')::text,
                     false);
  execute 'set role authenticated';
end;
$$;

create or replace function public.__rls_test_reset_role()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '', false);
end;
$$;

-- =====================================================================
-- 1. Base policies (0001 + 0009): profiles, connections, messages
-- =====================================================================
do $$
declare
  a uuid; b uuid;
  notes_id uuid;
begin
  select id into a from public.profiles order by created_at asc limit 1;
  select id into b from public.profiles order by created_at asc offset 1 limit 1;
  if a is null or b is null then
    raise exception 'Need at least two profiles for RLS tests.';
  end if;
  perform public.__rls_test_set_user(a);

  -- ---- profiles -----------------------------------------------------
  -- A can read B's public profile (needed for search).
  if not exists (select 1 from public.profiles where id = b) then
    raise exception 'FAIL: A cannot read B profile';
  end if;

  -- A cannot change B's display name (RLS restricts UPDATE to the owner;
  -- a foreign row is silently left untouched).
  update public.profiles set display_name = 'HACKED' where id = b;
  if exists (select 1 from public.profiles where id = b and display_name = 'HACKED') then
    raise exception 'FAIL: A changed B display name';
  end if;

  -- A can change their own display name.
  update public.profiles set display_name = 'A-ok' where id = a;
  if not exists (select 1 from public.profiles where id = a and display_name = 'A-ok') then
    raise exception 'FAIL: A cannot update own display name';
  end if;

  -- A cannot change their own username (only display_name is user-editable;
  -- guard_profile_update raises P0001).
  begin
    update public.profiles set username = 'hijacked' where id = a;
    raise exception 'FAIL: A changed own username';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- ---- connections --------------------------------------------------
  -- A creates a request to B.
  insert into public.connections (user_a, user_b, status)
  values (a, b, 'pending') on conflict do nothing;

  -- B cannot create a request on A's behalf (user_a must be the caller).
  perform public.__rls_test_set_user(b);
  begin
    insert into public.connections (user_a, user_b, status) values (a, b, 'pending');
    raise exception 'FAIL: B created a connection where A is user_a';
  exception when insufficient_privilege then
    null;
  end;

  -- B cannot create a self-request (self-requests are rejected by the
  -- INSERT policy; My Notes goes through the ensure_my_notes() RPC).
  begin
    insert into public.connections (user_a, user_b, status) values (b, b, 'pending');
    raise exception 'FAIL: B created a self-request';
  exception when insufficient_privilege then
    null;
  end;

  -- A cannot accept their own pending request (accepting is B's right;
  -- guard_connection_update raises P0001).
  perform public.__rls_test_set_user(a);
  begin
    update public.connections set status = 'accepted'
     where user_a = a and user_b = b and status = 'pending';
    raise exception 'FAIL: A accepted a request meant for B';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- ---- messages -----------------------------------------------------
  -- A cannot send into a non-accepted (still pending) connection.
  begin
    insert into public.messages (connection_id, sender_id, ciphertext)
    select c.id, a, 'should fail'
      from public.connections c where c.user_a = a and c.user_b = b;
    raise exception 'FAIL: message insert into pending connection succeeded';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- B accepts, then A sends a message.
  perform public.__rls_test_set_user(b);
  update public.connections set status = 'accepted'
   where user_a = a and user_b = b and status = 'pending';
  perform public.__rls_test_set_user(a);
  insert into public.messages (connection_id, sender_id, ciphertext)
  select c.id, a, 'hello from A'
    from public.connections c where c.user_a = a and c.user_b = b;

  -- B can read the conversation.
  perform public.__rls_test_set_user(b);
  if not exists (
    select 1 from public.messages m
    join public.connections c on c.id = m.connection_id
    where (c.user_a = a and c.user_b = b) and m.sender_id = a
  ) then
    raise exception 'FAIL: B cannot read the conversation';
  end if;
  perform public.__rls_test_set_user(a);

  -- ---- foreign conversation isolation ------------------------------
  -- B's My Notes self-connection; A is uninvolved.
  perform public.__rls_test_set_user(b);
  select public.ensure_my_notes() into notes_id;
  insert into public.messages (connection_id, sender_id, ciphertext)
  values (notes_id, b, 'B private note');

  -- A cannot read messages of a conversation A is not part of.
  perform public.__rls_test_set_user(a);
  if exists (select 1 from public.messages where connection_id = notes_id) then
    raise exception 'FAIL: A read a foreign conversation';
  end if;

  -- A cannot manipulate a connection A is not part of.
  update public.connections set status = 'declined' where id = notes_id;
  if exists (select 1 from public.connections where id = notes_id and status = 'declined') then
    raise exception 'FAIL: A manipulated a foreign connection';
  end if;

  -- ---- delete for everyone ------------------------------------------
  -- B cannot delete A's message for everyone (RLS restricts UPDATE to the
  -- sender; the foreign row is silently left untouched).
  perform public.__rls_test_set_user(b);
  update public.messages set deleted_at = now(), ciphertext = ''
   where connection_id in (select id from public.connections
                            where user_a = a and user_b = b)
     and sender_id = a;
  if not exists (
    select 1 from public.messages m
     where m.connection_id in (select id from public.connections
                                where user_a = a and user_b = b)
       and m.sender_id = a
       and m.deleted_at is null
  ) then
    raise exception 'FAIL: B deleted A message for everyone';
  end if;

  -- A can delete their own message for everyone (sender-only, within 24 h).
  perform public.__rls_test_set_user(a);
  update public.messages
     set deleted_at = now(), ciphertext = ''
   where connection_id in (select id from public.connections
                            where user_a = a and user_b = b)
     and sender_id = a
     and deleted_at is null;
  if exists (
    select 1 from public.messages m
     where m.connection_id in (select id from public.connections
                                where user_a = a and user_b = b)
       and m.sender_id = a
       and m.deleted_at is null
  ) then
    raise exception 'FAIL: A could not delete own message for everyone';
  end if;

  -- ---- delete for me (per-user deletion state) ----------------------
  perform public.__rls_test_set_user(b);
  insert into public.message_deletions (message_id, user_id)
  select id, b from public.messages
   where connection_id in (select id from public.connections
                            where user_a = a and user_b = b)
   limit 1
  on conflict (message_id, user_id) do nothing;
  -- B cannot hide a message from a connection B does not belong to.
  begin
    insert into public.message_deletions (message_id, user_id)
    values (gen_random_uuid(), b);
    raise exception 'FAIL: B hid an unrelated message';
  exception when insufficient_privilege then
    null;
  end;

  -- ---- read state ---------------------------------------------------
  update public.connection_reads
     set last_read_at = now()
   where connection_id in (select id from public.connections
                            where user_a = a and user_b = b)
     and user_id = b;
  -- B cannot write A's read state.
  perform public.__rls_test_set_user(b);
  begin
    insert into public.connection_reads (connection_id, user_id, last_read_at)
    select id, a, now() from public.connections
     where user_a = a and user_b = b;
    raise exception 'FAIL: B wrote A read state';
  exception when insufficient_privilege or unique_violation then
    null;
  end;

  -- ---- unread view --------------------------------------------------
  -- The unread view only exposes B's own rows.
  perform public.__rls_test_set_user(b);
  if exists (
    select 1 from public.connection_unread where user_id = a
  ) then
    raise exception 'FAIL: unread view leaked A rows to B';
  end if;

  -- ---- chat deletion ------------------------------------------------
  insert into public.chat_deletions (connection_id, user_id)
  select id, b from public.connections where user_a = a and user_b = b
  on conflict (connection_id, user_id) do nothing;
  -- B cannot delete a chat B is not part of.
  begin
    insert into public.chat_deletions (connection_id, user_id)
    values (gen_random_uuid(), b);
    raise exception 'FAIL: B deleted an unrelated chat';
  exception when insufficient_privilege then
    null;
  end;

  -- Tidy up the self-connection used for the foreign-isolation checks.
  perform public.__rls_test_set_user(b);
  begin
    perform public.remove_my_notes();
  exception when others then
    null;
  end;

  raise notice 'RLS tests passed for users % and %.', a, b;
end $$;

-- =====================================================================
-- 2. messages UPDATE (NV-1): delete-for-everyone invariants (0009)
-- =====================================================================
do $$
declare
  a uuid; b uuid;
  m_old uuid;
begin
  select id into a from public.profiles order by created_at asc limit 1;
  select id into b from public.profiles order by created_at asc offset 1 limit 1;
  if a is null or b is null then
    raise exception 'Need at least two profiles for RLS tests.';
  end if;

  -- Ensure an accepted (a → b) connection and a fresh message from A.
  perform public.__rls_test_set_user(a);
  insert into public.connections (user_a, user_b, status)
  values (a, b, 'pending') on conflict do nothing;
  perform public.__rls_test_set_user(b);
  update public.connections set status = 'accepted'
   where user_a = a and user_b = b and status = 'pending';
  perform public.__rls_test_set_user(a);
  insert into public.messages (connection_id, sender_id, ciphertext)
  select c.id, a, 'NV-1 fresh'
    from public.connections c where c.user_a = a and c.user_b = b
  returning id into m_old;

  -- ---- own update (delete-for-everyone) is allowed ------------------
  update public.messages set deleted_at = now(), ciphertext = ''
   where id = m_old;
  if not exists (select 1 from public.messages where id = m_old and deleted_at is not null) then
    raise exception 'FAIL: A could not delete own message';
  end if;

  -- ---- a sender cannot edit content --------------------------------
  insert into public.messages (connection_id, sender_id, ciphertext)
  select c.id, a, 'editable?'
    from public.connections c where c.user_a = a and c.user_b = b
  returning id into m_old;
  begin
    update public.messages set ciphertext = 'edited'
     where id = m_old;
    raise exception 'FAIL: A edited message content';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- ---- a sender cannot change immutable columns --------------------
  begin
    update public.messages set sender_id = b where id = m_old;
    raise exception 'FAIL: A changed sender_id';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    update public.messages set connection_id = gen_random_uuid() where id = m_old;
    raise exception 'FAIL: A changed connection_id';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- ---- foreign update by the recipient is rejected -----------------
  perform public.__rls_test_set_user(b);
  update public.messages set deleted_at = now(), ciphertext = ''
   where id = m_old;
  if exists (select 1 from public.messages where id = m_old and deleted_at is not null) then
    raise exception 'FAIL: B deleted A message for everyone';
  end if;

  -- ---- delete-for-everyone after 24 h is rejected ------------------
  perform public.__rls_test_set_user(a);
  insert into public.messages (connection_id, sender_id, ciphertext, created_at)
  select c.id, a, 'too old', now() - interval '25 hours'
    from public.connections c where c.user_a = a and c.user_b = b
  returning id into m_old;
  begin
    update public.messages set deleted_at = now(), ciphertext = '' where id = m_old;
    raise exception 'FAIL: delete after 24 h succeeded';
  exception when others then
    if sqlstate <> 'P0001' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  raise notice 'NV-1 message UPDATE tests passed for users % and %.', a, b;
end $$;

-- =====================================================================
-- Blocking (migration 0008): authorization checks
-- =====================================================================
do $$
declare
  a uuid; b uuid;
  conn_id uuid;
begin
  select id into a from public.profiles order by created_at asc limit 1;
  select id into b from public.profiles order by created_at asc offset 1 limit 1;
  if a is null or b is null then
    raise exception 'Need at least two profiles for RLS tests.';
  end if;

  -- Cleanup from previous runs.
  perform public.__rls_test_reset_role();
  delete from public.user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a);
  delete from public.messages where connection_id in (select id from public.connections where (user_a = a and user_b = b) or (user_a = b and user_b = a));
  delete from public.connections where (user_a = a and user_b = b) or (user_a = b and user_b = a);

  -- ---- block lifecycle -------------------------------------------------
  -- A blocks B.
  perform public.__rls_test_set_user(a);
  insert into public.user_blocks (blocker_id, blocked_id) values (a, b);

  -- B can read the relation (needed to explain the block in the UI).
  perform public.__rls_test_set_user(b);
  if not exists (
    select 1 from public.user_blocks where blocker_id = a and blocked_id = b
  ) then
    raise exception 'FAIL: B cannot see that A blocked them';
  end if;

  -- B cannot remove the block (only the blocker may).
  delete from public.user_blocks where blocker_id = a and blocked_id = b;
  if not exists (
    select 1 from public.user_blocks where blocker_id = a and blocked_id = b
  ) then
    raise exception 'FAIL: blocked user removed the block';
  end if;

  -- B cannot fabricate a block "by A" (manipulating other users' blocks).
  begin
    insert into public.user_blocks (blocker_id, blocked_id) values (a, b);
    raise exception 'FAIL: B inserted a block as A';
  exception when insufficient_privilege or unique_violation then
    null;
  end;

  -- ---- connection guard ------------------------------------------------
  -- B cannot create a new connection request to A while blocked
  -- (scenario F: direct API write must be rejected server-side).
  begin
    insert into public.connections (user_a, user_b, status)
    values (b, a, 'pending');
    raise exception 'FAIL: blocked user created a connection';
  exception when others then
    if sqlstate not in ('BLCKD', '42501') then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- B cannot restore a declined attempt to pending while blocked.
  perform public.__rls_test_set_user(a);
  delete from public.user_blocks where blocker_id = a and blocked_id = b;
  perform public.__rls_test_set_user(b);
  insert into public.connections (user_a, user_b, status)
  values (b, a, 'pending') on conflict do nothing;
  perform public.__rls_test_set_user(a);
  update public.connections set status = 'declined'
   where user_a = b and user_b = a and status = 'pending';
  insert into public.user_blocks (blocker_id, blocked_id) values (a, b);
  perform public.__rls_test_set_user(b);
  begin
    update public.connections
       set status = 'pending', created_at = now()
     where user_a = b and user_b = a and status = 'declined';
    raise exception 'FAIL: blocked user restored a request';
  exception when others then
    if sqlstate not in ('BLCKD', '42501') then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- ---- request RPC state machine ----------------------------------------
  -- A unblocks B; B's declined attempt is restored via the RPC.
  perform public.__rls_test_set_user(a);
  delete from public.user_blocks where blocker_id = a and blocked_id = b;
  perform public.__rls_test_set_user(b);
  perform public.send_connection_request(a);
  if not exists (
    select 1 from public.connections
     where user_a = b and user_b = a and status = 'pending'
  ) then
    raise exception 'FAIL: re-request did not restore pending';
  end if;

  -- Decline-and-block via the RPC (scenario B), then B cannot re-request.
  select c.id into conn_id
    from public.connections c
   where c.user_a = b and c.user_b = a and c.status = 'pending';
  perform public.__rls_test_set_user(a);
  perform public.decline_connection(conn_id, true);
  if not exists (
    select 1 from public.connections where id = conn_id and status = 'declined'
  ) then
    raise exception 'FAIL: decline did not mark the request declined';
  end if;
  if not exists (
    select 1 from public.user_blocks where blocker_id = a and blocked_id = b
  ) then
    raise exception 'FAIL: decline-and-block did not create the block';
  end if;
  perform public.__rls_test_set_user(b);
  begin
    perform public.send_connection_request(a);
    raise exception 'FAIL: blocked user re-requested via RPC';
  exception when others then
    if sqlstate <> 'BLCKD' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- Only the recipient may decline; B cannot decline on A's behalf.
  perform public.__rls_test_set_user(b);
  begin
    perform public.decline_connection(conn_id, false);
    raise exception 'FAIL: non-recipient declined a request';
  exception when others then
    if sqlstate <> '42501' then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- Unblock → B can request again (scenario E).
  perform public.__rls_test_set_user(a);
  delete from public.user_blocks where blocker_id = a and blocked_id = b;
  perform public.__rls_test_set_user(b);
  perform public.send_connection_request(a);
  if not exists (
    select 1 from public.connections
     where user_a = b and user_b = a and status = 'pending'
  ) then
    raise exception 'FAIL: request after unblock did not work';
  end if;

  -- ---- message guard ---------------------------------------------------
  -- Accept the pair, then block again mid-chat (scenario G).
  perform public.__rls_test_set_user(a);
  update public.connections set status = 'accepted'
   where user_a = b and user_b = a and status = 'pending';
  insert into public.user_blocks (blocker_id, blocked_id) values (a, b);

  -- B cannot send a message into the blocked conversation.
  perform public.__rls_test_set_user(b);
  begin
    insert into public.messages (connection_id, sender_id, ciphertext)
    select id, b, 'should fail'
      from public.connections where user_a = b and user_b = a;
    raise exception 'FAIL: blocked user sent a message';
  exception when others then
    if sqlstate not in ('BLCKD', '42501') then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- A cannot message into it either while the block exists (the block
  -- pauses the conversation for both sides; A controls the unblock).
  perform public.__rls_test_set_user(a);
  begin
    insert into public.messages (connection_id, sender_id, ciphertext)
    select id, a, 'should fail'
      from public.connections where user_a = b and user_b = a;
    raise exception 'FAIL: message into blocked conversation succeeded';
  exception when others then
    if sqlstate not in ('BLCKD', '42501') then
      raise exception 'FAIL: unexpected sqlstate % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- System events (display-name change) still work between blocked users.
  begin
    update public.profiles set display_name = 'name while blocked'
     where id = a;
  exception when others then
    raise exception 'FAIL: name change between blocked users failed: %', sqlerrm;
  end;

  -- ---- restore the (a → b, accepted) state for re-runs -----------------
  -- The exact base RLS policies of the connections table are
  -- deployment-specific, so the restore is best-effort: every block
  -- check above has already passed when this runs.
  perform public.__rls_test_set_user(a);
  begin
    update public.connections
       set user_a = a, user_b = b, status = 'accepted', created_at = now()
     where user_a = b and user_b = a;
  exception when others then
    raise notice 'enough.: pair state restore skipped (%); reset the test pair manually before re-running.', sqlerrm;
  end;

  raise notice 'Block RLS tests passed for users % and %.', a, b;
end $$;

-- Cleanup helper.
reset role;
drop function if exists public.__rls_test_set_user(uuid);
drop function if exists public.__rls_test_reset_role();
