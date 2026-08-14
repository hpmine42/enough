import { supabase } from './supabase';
import { errorMessage } from './errors';
import { t } from '../i18n';
import {
  ChatDeletion,
  Connection,
  ConnectionRead,
  Message,
  MessageDeletion,
  Profile,
  UnreadCount,
} from './types';

/* ------------------------------------------------------------------ */
/* profiles                                                            */
/* ------------------------------------------------------------------ */

export async function getMyProfile(id: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, created_at')
    .eq('id', id)
    .single();
  if (error) return null;
  return data as Profile;
}

// Idempotent: works whether or not a trigger already created the profile row
// for the new auth user. Used as an authenticated fallback for environments
// with auto-confirm enabled.
export async function upsertProfile(
  id: string,
  username: string,
  displayName?: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('profiles')
    .upsert(
      { id, username, ...(displayName ? { display_name: displayName } : {}) },
      { onConflict: 'id' },
    );
  if (error) {
    if (error.code === '23505') return t('errors.usernameTaken');
    return errorMessage(error, 'registration profiles.upsert');
  }
  return null;
}

export async function usernameExists(username: string): Promise<boolean> {
  if (!supabase) return false;
  // Try direct table access first (works when RLS allows anonymous reads).
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (!error) return Boolean(data);
  // Fallback: try the RPC function if it exists.
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'check_username_taken',
    { name: username },
  );
  if (!rpcError) return Boolean(rpcData);
  return false;
}

export async function searchUsers(
  query: string,
  me: string,
): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .ilike('username', `${query}%`)
    .neq('id', me)
    .limit(10);
  if (error) return [];
  return (data ?? []) as Profile[];
}

export async function updateMyDisplayName(
  me: string,
  displayName: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', me);
  if (error) return errorMessage(error, 'profile display_name update');
  return null;
}

/* ------------------------------------------------------------------ */
/* connections                                                         */
/* ------------------------------------------------------------------ */

export async function getMyConnections(me: string): Promise<Connection[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as Connection[];
}

export async function getConnection(id: string): Promise<Connection | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data as Connection | null;
}

export async function getProfiles(
  ids: string[],
): Promise<Record<string, Profile>> {
  if (!supabase || ids.length === 0) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', ids);
  if (error) return {};
  const map: Record<string, Profile> = {};
  for (const p of (data ?? []) as Profile[]) {
    map[p.id] = p;
  }
  return map;
}

/**
 * Send (or re-send) a connection request.
 * If a non-accepted attempt between the pair already exists, the outgoing
 * side is reset to pending (connection restoration). An incoming pending
 * request cannot be duplicated.
 */
export async function sendConnectionRequest(
  me: string,
  otherId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');

  const { data: existing, error: findError } = await supabase
    .from('connections')
    .select('*')
    .or(
      `and(user_a.eq.${me},user_b.eq.${otherId}),and(user_a.eq.${otherId},user_b.eq.${me})`,
    )
    .maybeSingle();
  if (findError) return errorMessage(findError, 'request find existing');

  if (existing) {
    if (existing.status === 'accepted') {
      return t('errors.connectionExists');
    }
    if (existing.user_a === me) {
      // My outgoing attempt: restore it as a fresh pending request.
      const { error } = await supabase
        .from('connections')
        .update({ status: 'pending', created_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) return errorMessage(error, 'request restore');
      return null;
    }
    return t('errors.connectionExists');
  }

  const { error } = await supabase.from('connections').insert({
    user_a: me,
    user_b: otherId,
    status: 'pending',
  });
  if (error) {
    if (error.code === '23505') return t('errors.connectionExists');
    return errorMessage(error, 'request insert');
  }
  return null;
}

export async function acceptConnection(
  connectionId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('connections')
    .update({ status: 'accepted' })
    .eq('id', connectionId)
    .eq('status', 'pending');
  if (error) return errorMessage(error, 'request accept');
  return null;
}

export async function declineConnection(
  connectionId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('connections')
    .update({ status: 'declined' })
    .eq('id', connectionId)
    .eq('status', 'pending');
  if (error) return errorMessage(error, 'request decline');
  return null;
}

/** Remove the request attempt entirely (requester cancels). */
export async function cancelConnectionRequest(
  connectionId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('connections')
    .delete()
    .eq('id', connectionId);
  if (error) return errorMessage(error, 'request cancel');
  return null;
}

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */

/**
 * Newest-first page of messages, optionally strictly before `before`
 * (used by pagination). `limit + 1` detects whether more pages exist.
 * `beforeId` breaks ties for messages with identical timestamps.
 */
export async function getMessagesPage(
  connectionId: string,
  before?: string,
  beforeId?: string,
  limit = 40,
): Promise<{ messages: Message[]; hasMore: boolean }> {
  if (!supabase) return { messages: [], hasMore: false };
  let query = supabase
    .from('messages')
    .select('id, connection_id, sender_id, ciphertext, created_at, deleted_at, kind, meta')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (before) {
    query = query.or(
      `created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId ?? ''})`,
    );
  }
  const { data, error } = await query;
  if (error) return { messages: [], hasMore: false };
  const rows = (data ?? []) as Message[];
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return { messages, hasMore };
}

export async function getLastMessages(
  connectionIds: string[],
): Promise<Record<string, Message>> {
  if (!supabase || connectionIds.length === 0) return {};
  const { data, error } = await supabase
    .from('messages')
    .select('id, connection_id, sender_id, ciphertext, created_at, deleted_at, kind')
    .in('connection_id', connectionIds)
    .order('created_at', { ascending: false });
  if (error) return {};
  const map: Record<string, Message> = {};
  for (const m of (data ?? []) as Message[]) {
    if (!(m.connection_id in map)) map[m.connection_id] = m;
  }
  return map;
}

export async function sendMessage(
  connectionId: string,
  senderId: string,
  text: string,
): Promise<{ message: Message | null; error: string | null }> {
  if (!supabase) {
    return { message: null, error: t('errors.network') };
  }
  const { data, error } = await supabase
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: senderId, ciphertext: text })
    .select()
    .single();
  if (error) {
    if (error.code === '42501') {
      return { message: null, error: t('errors.connectionFailed') };
    }
    return { message: null, error: errorMessage(error, 'message insert') };
  }
  return { message: data as Message, error: null };
}

/** Delete for everyone: only meaningful for the sender, within 24 h. */
export async function deleteMessageForEveryone(
  messageId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), ciphertext: '' })
    .eq('id', messageId);
  if (error) return errorMessage(error, 'message delete for everyone');
  return null;
}

/* ------------------------------------------------------------------ */
/* per-user deletion state (delete for me)                             */
/* ------------------------------------------------------------------ */

const deletionStorage = {
  read(me: string): { messages: string[]; chats: string[] } {
    try {
      const raw = window.localStorage.getItem(`enough-deletions-${me}`);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          messages?: string[];
          chats?: string[];
        };
        return {
          messages: parsed.messages ?? [],
          chats: parsed.chats ?? [],
        };
      }
    } catch {
      /* ignore */
    }
    return { messages: [], chats: [] };
  },
  write(me: string, value: { messages: string[]; chats: string[] }): void {
    try {
      window.localStorage.setItem(`enough-deletions-${me}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

let deletionsCache: { me: string; messages: Set<string>; chats: Set<string> } | null =
  null;

async function loadDeletions(me: string): Promise<{
  messages: Set<string>;
  chats: Set<string>;
}> {
  const local = deletionStorage.read(me);
  if (!supabase) {
    return {
      messages: new Set(local.messages),
      chats: new Set(local.chats),
    };
  }
  const [msgRes, chatRes] = await Promise.all([
    supabase.from('message_deletions').select('message_id').eq('user_id', me),
    supabase.from('chat_deletions').select('connection_id').eq('user_id', me),
  ]);
  const dbMessages = (msgRes.data ?? []) as Pick<MessageDeletion, 'message_id'>[];
  const dbChats = (chatRes.data ?? []) as Pick<ChatDeletion, 'connection_id'>[];
  // Merge DB rows (source of truth) with the local fallback set.
  const merged = {
    messages: new Set([...local.messages, ...dbMessages.map((m) => m.message_id)]),
    chats: new Set([...local.chats, ...dbChats.map((c) => c.connection_id)]),
  };
  deletionsCache = { me, messages: merged.messages, chats: merged.chats };
  return merged;
}

/** Always re-fetch from the database so deletions made elsewhere (or by
 *  another mounted screen) are visible; merges the local fallback set. */
export async function loadDeletionsForUser(me: string): Promise<{
  messages: Set<string>;
  chats: Set<string>;
}> {
  return loadDeletions(me);
}

export async function deleteMessageForMe(
  me: string,
  messageId: string,
): Promise<string | null> {
  const local = deletionStorage.read(me);
  local.messages.push(messageId);
  deletionStorage.write(me, local);
  if (deletionsCache?.me === me) deletionsCache.messages.add(messageId);
  if (supabase) {
    const { error } = await supabase
      .from('message_deletions')
      .insert({ message_id: messageId, user_id: me });
    if (error && error.code !== '23505') {
      // The row is still hidden locally; the DB write failed (e.g. migration
      // not applied). Keep the local fallback so the action is not fake.
      return errorMessage(error, 'message delete for me');
    }
  }
  return null;
}

export async function deleteChatForMe(
  me: string,
  connectionId: string,
): Promise<string | null> {
  const local = deletionStorage.read(me);
  if (!local.chats.includes(connectionId)) local.chats.push(connectionId);
  deletionStorage.write(me, local);
  if (deletionsCache?.me === me) deletionsCache.chats.add(connectionId);
  if (supabase) {
    const { error } = await supabase
      .from('chat_deletions')
      .insert({ connection_id: connectionId, user_id: me });
    if (error && error.code !== '23505') {
      return errorMessage(error, 'chat delete for me');
    }
  }
  return null;
}

export async function restoreChatForMe(
  me: string,
  connectionId: string,
): Promise<void> {
  const local = deletionStorage.read(me);
  local.chats = local.chats.filter((c) => c !== connectionId);
  deletionStorage.write(me, local);
  if (deletionsCache?.me === me) deletionsCache.chats.delete(connectionId);
  if (supabase) {
    await supabase
      .from('chat_deletions')
      .delete()
      .eq('connection_id', connectionId)
      .eq('user_id', me);
  }
}

/* ------------------------------------------------------------------ */
/* read state                                                          */
/* ------------------------------------------------------------------ */

const readStorage = {
  read(me: string): Record<string, string> {
    try {
      const raw = window.localStorage.getItem(`enough-read-${me}`);
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch {
      /* ignore */
    }
    return {};
  },
  write(me: string, map: Record<string, string>): void {
    try {
      window.localStorage.setItem(`enough-read-${me}`, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  },
};

/** last_read_at per connection for the current user. */
export async function getReadState(
  me: string,
): Promise<Record<string, string>> {
  const local = readStorage.read(me);
  if (!supabase) return local;
  const { data, error } = await supabase
    .from('connection_reads')
    .select('connection_id, last_read_at')
    .eq('user_id', me);
  if (error) return local;
  const map: Record<string, string> = { ...local };
  for (const row of (data ?? []) as ConnectionRead[]) {
    map[row.connection_id] = row.last_read_at;
  }
  return map;
}

/** Persist the read position (DB first, localStorage as fallback). */
export async function saveReadState(
  me: string,
  connectionId: string,
  lastReadAt: string,
): Promise<void> {
  const local = readStorage.read(me);
  local[connectionId] = lastReadAt;
  readStorage.write(me, local);
  if (!supabase) return;
  await supabase
    .from('connection_reads')
    .upsert(
      { connection_id: connectionId, user_id: me, last_read_at: lastReadAt },
      { onConflict: 'connection_id,user_id' },
    );
}

/** Unread counts per connection (view-first; degrades to no badges). */
export async function getUnreadCounts(
  me: string,
  connectionIds: string[],
  readState: Record<string, string>,
): Promise<Record<string, number>> {
  if (!supabase || connectionIds.length === 0) return {};
  // Preferred: the connection_unread view (RLS via security invoker).
  const { data, error } = await supabase
    .from('connection_unread')
    .select('connection_id, unread')
    .eq('user_id', me);
  if (!error && data) {
    const map: Record<string, number> = {};
    for (const row of (data ?? []) as UnreadCount[]) {
      map[row.connection_id] = row.unread;
    }
    return map;
  }
  // Fallback: per-connection counts from the messages table.
  const client = supabase;
  const map: Record<string, number> = {};
  await Promise.all(
    connectionIds.map(async (cid) => {
      const since = readState[cid];
      if (!since) {
        map[cid] = 0;
        return;
      }
      const { count, error: countError } = await client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', cid)
        .gt('created_at', since)
        .neq('sender_id', me)
        .is('deleted_at', null);
      map[cid] = countError ? 0 : (count ?? 0);
    }),
  );
  return map;
}

/* ------------------------------------------------------------------ */
/* schema compatibility check                                          */
/* ------------------------------------------------------------------ */

/**
 * Probes for columns/tables added by supabase/migrations/0001 and warns
 * in the developer console when the migration has not been applied.
 * The app degrades gracefully; this makes the cause visible.
 */
export async function checkSchemaCompatibility(): Promise<void> {
  if (!supabase) return;
  const probes: Array<{ table: string; column: string }> = [
    { table: 'profiles', column: 'display_name' },
    { table: 'messages', column: 'kind' },
    { table: 'connection_reads', column: 'user_id' },
    { table: 'connection_unread', column: 'unread' },
  ];
  const client = supabase;
  const missing: string[] = [];
  await Promise.all(
    probes.map(async ({ table, column }) => {
      const { error } = await client.from(table).select(column).limit(1);
      if (error) missing.push(`${table}.${column}`);
    }),
  );
  if (missing.length > 0) {
    console.warn(
      `enough.: database migration not applied — missing ${missing.join(', ')}. ` +
        'Run supabase/migrations/0001_v01_features.sql (see docs/MIGRATIONS.md).',
    );
  }
}

/* ------------------------------------------------------------------ */
/* My Notes (self-chat)                                                */
/* ------------------------------------------------------------------ */

/** Find or create the accepted self-connection used by My Notes. */
export async function ensureMyNotes(me: string): Promise<string | null> {
  if (!supabase) return null;
  // First, look for any existing self-connection (any status).
  const { data: existing, error: findError } = await supabase
    .from('connections')
    .select('id, status')
    .eq('user_a', me)
    .eq('user_b', me)
    .maybeSingle();
  if (findError) return null;
  if (existing) {
    // If it exists but is not accepted, update it to accepted.
    if (existing.status !== 'accepted') {
      const { error: updateError } = await supabase
        .from('connections')
        .update({ status: 'accepted', created_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (updateError) return null;
    }
    return existing.id as string;
  }
  // No existing self-connection: create one.
  const { data: inserted, error: insertError } = await supabase
    .from('connections')
    .insert({ user_a: me, user_b: me, status: 'accepted' })
    .select('id')
    .single();
  if (insertError) return null;
  return inserted.id as string;
}

export async function removeMyNotes(connectionId: string): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('connections')
    .delete()
    .eq('id', connectionId);
  if (error) return errorMessage(error, 'my notes remove');
  return null;
}
