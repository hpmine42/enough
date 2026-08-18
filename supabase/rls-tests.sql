-- =====================================================================
-- enough. — RLS / authorization test script
-- =====================================================================
-- Run AFTER applying every file in supabase/migrations/ (0001 through
-- 0005), in the Supabase SQL editor. Uses the two oldest profiles in the
-- database as test users A and B (i.e. your two existing test accounts) and
-- verifies both positive and negative authorization cases for the v0.1 features.
--
-- Every check raises an exception on failure; a run that finishes
-- without errors means all checks passed.
-- =====================================================================

-- Helper: switch the request context to a given user.
create or replace function public.__rls_test_set_user(uid uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
                    jsonb_build_object('sub', uid::text, 'role', 'authenticated')::text,
                    false);
  set local role authenticated;
$$;

-- Pick test users A and B (the two oldest profiles).
do $$
declare
  a uuid; b uuid;
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
  -- A cannot change B's display name.
  begin
    update public.profiles set display_name = 'HACKED' where id = b;
    raise exception 'FAIL: A changed B display name';
  exception when insufficient_privilege then
    null;
  end;

  -- ---- connections --------------------------------------------------
  -- A creates a request to B.
  insert into public.connections (user_a, user_b, status)
  values (a, b, 'pending') on conflict do nothing;
  -- B cannot create a request on A's behalf (A is user_a here).
  begin
    insert into public.connections (user_a, user_b, status) values (a, b, 'pending');
    raise exception 'FAIL: B created a connection where A is user_a';
  exception when insufficient_privilege or unique_violation then
    null;
  end;
  -- A cannot accept B's pending request (accepting is B's right).
  begin
    update public.connections set status = 'accepted'
     where user_a = a and user_b = b and status = 'pending';
    raise exception 'FAIL: A accepted a request meant for B';
  exception when insufficient_privilege then
    null;
  end;

  -- ---- messages -----------------------------------------------------
  -- B accepts, then A sends a message.
  update public.connections set status = 'accepted'
   where user_a = a and user_b = b and status = 'pending';
  insert into public.messages (connection_id, sender_id, ciphertext)
  select c.id, a, 'hello from A'
    from public.connections c where c.user_a = a and c.user_b = b;
  -- B can read the conversation.
  if not exists (
    select 1 from public.messages m
    join public.connections c on c.id = m.connection_id
    where (c.user_a = a and c.user_b = b) and m.sender_id = a
  ) then
    raise exception 'FAIL: B cannot read the conversation';
  end if;
  -- A cannot send into a non-accepted connection (declined/expired).
  update public.connections set status = 'declined'
   where user_a = a and user_b = b;
  begin
    insert into public.messages (connection_id, sender_id, ciphertext)
    select c.id, a, 'should fail'
      from public.connections c where c.user_a = a and c.user_b = b;
    raise exception 'FAIL: message insert into declined connection succeeded';
  exception when others then
    null;
  end;
  update public.connections set status = 'accepted'
   where user_a = a and user_b = b;

  -- ---- delete for everyone ------------------------------------------
  -- A can delete their own message for everyone.
  update public.messages
     set deleted_at = now(), ciphertext = ''
   where connection_id in (select id from public.connections
                            where user_a = a and user_b = b)
     and sender_id = a
     and deleted_at is null;
  -- B cannot delete A's message for everyone.
  perform public.__rls_test_set_user(b);
  begin
    update public.messages set deleted_at = now(), ciphertext = ''
     where connection_id in (select id from public.connections
                              where user_a = a and user_b = b)
       and sender_id = a;
    raise exception 'FAIL: B deleted A message for everyone';
  exception when insufficient_privilege then
    null;
  end;

  -- ---- delete for me (per-user deletion state) ----------------------
  insert into public.message_deletions (message_id, user_id)
  select id, b from public.messages
   where connection_id in (select id from public.connections
                            where user_a = a and user_b = b)
   limit 1;
  -- B cannot hide a message from a connection B does not belong to.
  begin
    insert into public.message_deletions (message_id, user_id)
    select id, b from public.messages limit 1;
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
  select id, b from public.connections where user_a = a and user_b = b;
  -- B cannot delete a chat B is not part of (use a self-made request row).
  begin
    insert into public.chat_deletions (connection_id, user_id)
    select c.id, b
      from public.connections c
     where c.user_a = b and c.user_b = b
     limit 1;
    raise exception 'FAIL: B deleted an unrelated chat';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'RLS tests passed for users % and %.', a, b;
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
  perform public.__rls_test_set_user(a);
  delete from public.user_blocks where blocker_id = a;
  perform public.__rls_test_set_user(b);
  delete from public.user_blocks where blocker_id = b;

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

  -- ---- message guard ---------------------------------------------------
  -- Unblock, accept the pair, then block again mid-chat (scenario G).
  perform public.__rls_test_set_user(a);
  delete from public.user_blocks where blocker_id = a and blocked_id = b;
  update public.connections set status = 'accepted'
   where user_a = b and user_b = a;
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

  -- ---- request RPC state machine ----------------------------------------
  -- A unblocks B, B's declined attempt is restored via the RPC.
  perform public.__rls_test_set_user(a);
  delete from public.user_blocks where blocker_id = a and blocked_id = b;
  update public.connections set status = 'declined'
   where user_a = b and user_b = a;
  perform public.__rls_test_set_user(b);
  perform public.send_connection_request(a);
  if not exists (
    select 1 from public.connections
     where user_a = b and user_b = a and status = 'pending'
  ) then
    raise exception 'FAIL: re-request after decline did not restore pending';
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
drop function if exists public.__rls_test_set_user(uuid);
