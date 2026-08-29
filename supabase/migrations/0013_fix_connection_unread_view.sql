-- =====================================================================
-- enough. — v0.2 migration: fix connection_unread N+1 (P1-4)
-- =====================================================================
-- Purpose:
--   The original `connection_unread` view (0001) starts from
--   `connection_reads`, so brand-new conversations (no read state yet)
--   have no row in the view. The client was forced to fall back to one
--   messages-count query per missing connection — an N+1 problem that
--   degraded Home-load performance linearly with the number of new
--   conversations.
--
--   This migration recreates the view to start from `connections` with
--   a LEFT JOIN on `connection_reads`, so every connection of the
--   authenticated user is represented regardless of read state.
--
-- Safety:
--   * `security_invoker = on` is preserved — RLS of the underlying
--     tables (connections, messages) applies per user.
--   * No data changes.
--   * Idempotent (CREATE OR REPLACE VIEW).
--   * The `user_id` column is preserved for backward compatibility with
--     client code that filters by it.
-- =====================================================================

create or replace view public.connection_unread
with (security_invoker = on) as
select auth.uid() as user_id,
       c.id as connection_id,
       count(m.id)::int as unread
  from public.connections c
  left join public.connection_reads cr
    on cr.connection_id = c.id
   and cr.user_id = auth.uid()
  left join public.messages m
    on m.connection_id = c.id
   and (cr.last_read_at is null or m.created_at > cr.last_read_at)
   and m.sender_id <> auth.uid()
   and m.deleted_at is null
   and (m.kind is null or m.kind = 'text')
 where (c.user_a = auth.uid() or c.user_b = auth.uid())
   and c.status in ('accepted', 'ended')
 group by c.id;
