-- =====================================================================
-- enough. — chat deletion: revealed flag (0007)
-- =====================================================================
-- After deleting a chat the user may rediscover the same person via
-- search.  revealChatForMe() re-shows the conversation in the Home
-- list without removing the hidden_until cutoff — old messages stay
-- hidden for the deleting user while new messages work normally.
-- =====================================================================

begin;

alter table public.chat_deletions
  add column if not exists revealed boolean not null default false;

commit;
