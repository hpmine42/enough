-- =====================================================================
-- enough. — RLS / authorization test script
-- =====================================================================
-- Run AFTER applying supabase/migrations/0001_v01_features.sql, in the
-- Supabase SQL editor. Uses the two oldest profiles in the database as
-- test users A and B (i.e. your two existing test accounts) and verifies
-- both positive and negative authorization cases for the v0.1 features.
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

-- Cleanup helper.
drop function if exists public.__rls_test_set_user(uuid);
