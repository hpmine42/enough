-- =====================================================================
-- enough. — chat deletion cutoff (0006)
-- =====================================================================
-- Per-user "delete chat for me" must survive a later reconnect of the
-- same pair. The unique pair index reuses the connection row, so we
-- store hidden_until and hide messages at or before that instant only
-- for the deleting user. Messages are never deleted globally.
-- =====================================================================

begin;

alter table public.chat_deletions
  add column if not exists hidden_until timestamptz not null default now();

-- Existing rows: treat created_at as the cutoff.
update public.chat_deletions
   set hidden_until = created_at
 where hidden_until is null;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'chat_deletions'
                    and policyname = 'chat_deletions_update_own') then
    create policy chat_deletions_update_own on public.chat_deletions
      for update to authenticated
      using (user_id = auth.uid())
      with check (
        user_id = auth.uid()
        and exists (
          select 1
            from public.connections c
           where c.id = connection_id
             and (c.user_a = auth.uid() or c.user_b = auth.uid())
        )
      );
  end if;
end $$;

commit;
