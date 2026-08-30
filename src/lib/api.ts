import { supabase } from './supabase';
import { errorMessage } from './errors';
import { sanitizeDisplayName } from './input';
import { t } from '../i18n';
import type {
  BlockRelation,
  BlockState,
  ChatDeletion,
  Connection,
  ConnectionRead,
  Message,
  MessageDeletion,
  Profile,
  UnreadCount,
} from './types';

/* ------------------------------------------------------------------ */
/* result type                                                         */
/* ------------------------------------------------------------------ */

/**
 * Wrapper for data-layer read results. `error` is a localized human-readable
 * message when the request failed; `null` on success. An empty array/object
 * with `error === null` is a genuine empty state, not a failure.
 */
export type ApiResult<T> = { data: T; error: string | null };

/** Read optional PostgREST error fields without asserting an arbitrary value. */
function supabaseErrorField(
  error: unknown,
  field: 'code' | 'message',
): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

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
  const cleanDisplayName = displayName ? sanitizeDisplayName(displayName) : '';
  const { error } = await supabase
    .from('profiles')
    .upsert(
      { id, username, ...(cleanDisplayName ? { display_name: cleanDisplayName } : {}) },
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
  // Preferred: RPC that works for anon users (see migration 0002).
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'check_username_taken',
    { name: username },
  );
  if (!rpcError) return Boolean(rpcData);

  // Fallback: direct table access (works when RLS allows anonymous reads
  // or when the user is already authenticated).
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (!error) return Boolean(data);

  // If both checks fail (e.g. network issue or missing RPC), do NOT
  // report \"available\". Treat it as taken to be safe — the submit handler
  // will re-check and will show the taken error instead of allowing a
  // duplicate username.
  // We still return false only when we are sure the name is free, so on
  // ambiguous errors we pretend it is taken to prevent the false
  // \"available\" badge.
  // However, to avoid locking users out completely on a transient failure,
  // we only return true when we have evidence of an error; the caller
  // can keep the state as \"checking\"/unknown if needed. For the
  // boolean API we conservatively return true on hard errors only if the
  // RPC error code is not a missing-function error. Missing RPC should
  // have been caught by the direct query fallback.
  const rpcCode = supabaseErrorField(rpcError, 'code');
  const isRpcMissing = rpcCode === 'PGRST202' || rpcCode === '42883';
  if (isRpcMissing && error) {
    // Both failed, but RPC is simply not deployed — direct query already
    // said \"no row\" when error is null. If we reach here direct query
    // also errored, so we cannot confirm free.
    return true;
  }
  if (rpcError && error) {
    // Network / permission error on both paths — be conservative.
    return true;
  }
  return false;
}

export async function searchUsers(
  query: string,
  me: string,
): Promise<ApiResult<Profile[]>> {
  if (!supabase) return { data: [], error: t('errors.network') };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .ilike('username', `${query}%`)
    .neq('id', me)
    .limit(10);
  if (error) {
    return { data: [], error: errorMessage(error, 'searchUsers') };
  }
  return { data: (data ?? []) as Profile[], error: null };
}

export async function updateMyDisplayName(
  me: string,
  displayName: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const cleanDisplayName = sanitizeDisplayName(displayName);
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: cleanDisplayName })
    .eq('id', me)
    .select('id');
  if (error) return errorMessage(error, 'profile display_name update');
  // A 0-row result means RLS silently rejected the update (PostgREST does not
  // error on RLS-filtered writes) — surface it instead of pretending it saved.
  if (!data || data.length === 0) return t('errors.displayNameFailed');
  return null;
}

/* ------------------------------------------------------------------ */
/* connections                                                         */
/* ------------------------------------------------------------------ */

export async function getMyConnections(me: string): Promise<ApiResult<Connection[]>> {
  if (!supabase) return { data: [], error: t('errors.network') };
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .or(`user_a.eq.${me},user_b.eq.${me}`)
    .order('created_at', { ascending: false });
  if (error) {
    return { data: [], error: errorMessage(error, 'getMyConnections') };
  }
  return { data: (data ?? []) as Connection[], error: null };
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
): Promise<ApiResult<Record<string, Profile>>> {
  if (!supabase || ids.length === 0) return { data: {}, error: null };
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', ids);
  if (error) {
    return { data: {}, error: errorMessage(error, 'getProfiles') };
  }
  const map: Record<string, Profile> = {};
  for (const p of (data ?? []) as Profile[]) {
    map[p.id] = p;
  }
  return { data: map, error: null };
}

/**
 * Send (or re-send) a connection request.
 *
 * Primary path is the auth-bound RPC `send_connection_request` (migration
 * 0008), which implements the request state machine in the database:
 * re-request after decline/expiry works in both directions, the
 * one-row-per-pair model stays intact (no unique-constraint conflicts)
 * and blocked pairs are rejected server-side.
 */
export async function sendConnectionRequest(
  me: string,
  otherId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');

  // Fast client-side block check (the database enforces this as well;
  // this only avoids the failing request in the first place).
  const block = await getBlockState(me, otherId);
  if (block === 'blockedByThem') return t('block.byThem');
  if (block === 'blockedByMe') return t('block.byYou');

  // Preserve the existing UX for already-accepted pairs: a deleted chat
  // is revealed instead of re-requested, an existing chat is reported.
  const { data: existing, error: findError } = await supabase
    .from('connections')
    .select('*')
    .or(
      `and(user_a.eq.${me},user_b.eq.${otherId}),and(user_a.eq.${otherId},user_b.eq.${me})`,
    )
    .maybeSingle();
  if (findError) return errorMessage(findError, 'request find existing');

  if (existing) {
    const deletedForMe = (await loadDeletions(me)).chatUntil.has(existing.id);
    if (existing.status === 'accepted' && !deletedForMe) {
      return t('errors.connectionExists');
    }
    if (existing.status === 'accepted' && deletedForMe) {
      // Do NOT set accepted → pending — RLS blocks browser clients from
      // downgrading an accepted connection (42501). The caller is
      // responsible for calling revealChatForMe() so the chat reappears
      // in the Home list while hidden_until keeps old messages hidden.
      return null;
    }
    // A live incoming request already exists: the caller opens the chat
    // to accept it instead of duplicating anything.
    if (existing.status === 'pending' && existing.user_b === me) {
      return null;
    }
  }

  const { data: rpcId, error: rpcError } = await supabase.rpc(
    'send_connection_request',
    { target: otherId },
  );
  if (!rpcError && typeof rpcId === 'string' && rpcId) {
    return null;
  }
  if (rpcError && !isMissingRequestRpc(rpcError)) {
    if (supabaseErrorField(rpcError, 'code') === 'BLCKD') {
      return t('errors.blockedRequest');
    }
    if (supabaseErrorField(rpcError, 'code') === 'P0001') {
      return t('errors.connectionExists');
    }
    return errorMessage(rpcError, 'request RPC');
  }

  // Compatibility fallback for backends without migration 0008. The
  // legacy logic restores the caller's own dead attempt and reuses a
  // dead attempt of the other side (delete + insert) so a declined
  // request never blocks a re-request in either direction.
  if (existing) {
    if (existing.status === 'accepted') {
      return t('errors.connectionExists');
    }
    if (existing.status === 'pending') {
      return null; // incoming pending request — handled by the caller
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
    if (existing.status === 'declined' || existing.status === 'expired') {
      // Their dead attempt: a declined/expired row never held messages,
      // so it is safe to remove and re-create it as my outgoing request.
      const { error: deleteError } = await supabase
        .from('connections')
        .delete()
        .eq('id', existing.id);
      if (deleteError) return errorMessage(deleteError, 'request reset');
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
    // `ended` rows may hold chat history — never delete them in the
    // fallback path (the RPC above handles them correctly).
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

/**
 * Decline an incoming request. With `blockPeer` the requester is blocked
 * in the same database step (migration 0008 RPC), so they cannot send
 * another request until the block is removed.
 */
export async function declineConnection(
  connectionId: string,
  blockPeer = false,
): Promise<string | null> {
  if (!supabase) return t('errors.network');

  const { error: rpcError } = await supabase.rpc('decline_connection', {
    conn: connectionId,
    block_peer: blockPeer,
  });
  if (!rpcError) return null;
  if (!isMissingRequestRpc(rpcError)) {
    if (supabaseErrorField(rpcError, 'code') === 'BLCKD') {
      return t('errors.blockedRequest');
    }
    return errorMessage(rpcError, 'request decline');
  }

  // Compatibility fallback for backends without migration 0008: plain
  // decline. Decline+block needs the block table from 0008, so a
  // requested block that cannot be stored is logged, not faked.
  const { error } = await supabase
    .from('connections')
    .update({ status: 'declined' })
    .eq('id', connectionId)
    .eq('status', 'pending');
  if (error) return errorMessage(error, 'request decline');

  if (blockPeer) {
    const { data: row } = await supabase
      .from('connections')
      .select('user_a, user_b')
      .eq('id', connectionId)
      .maybeSingle();
    if (row) {
      const { error: blockError } = await supabase
        .from('user_blocks')
        .insert({ blocker_id: row.user_b, blocked_id: row.user_a });
      if (blockError && blockError.code !== '23505') {
        errorMessage(blockError, 'user block insert (legacy decline+block)');
      }
    }
  }
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
/* blocking                                                            */
/* ------------------------------------------------------------------ */

function isMissingRequestRpc(error: unknown): boolean {
  const code = supabaseErrorField(error, 'code');
  const message = supabaseErrorField(error, 'message')?.toLowerCase() ?? '';
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    (message.includes('function') &&
      (message.includes('send_connection_request') ||
        message.includes('decline_connection')) &&
      (message.includes('not find') || message.includes('does not exist')))
  );
}

/**
 * Block relation between the current user and one peer. The database
 * (RLS + guards) is the authority; this only drives the UI.
 */
export async function getBlockState(
  me: string,
  other: string,
): Promise<BlockState> {
  if (!supabase || !other || other === me) return 'none';
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${other}),and(blocker_id.eq.${other},blocked_id.eq.${me})`,
    )
    .limit(2);
  if (error || !data) return 'none';
  let blockedByMe = false;
  let blockedByThem = false;
  for (const row of data as { blocker_id: string; blocked_id: string }[]) {
    if (row.blocker_id === me) blockedByMe = true;
    else blockedByThem = true;
  }
  // Mutual blocks: the caller can remove their own side, so the UI
  // treats it as blockedByMe (with the Unblock action available).
  if (blockedByMe) return 'blockedByMe';
  if (blockedByThem) return 'blockedByThem';
  return 'none';
}

/** All block relations of the current user (both directions). */
export async function getBlockRelations(me: string): Promise<BlockRelation> {
  const blockedIds = new Set<string>();
  const blockedByIds = new Set<string>();
  if (!supabase) return { blockedIds, blockedByIds };
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${me},blocked_id.eq.${me}`);
  if (error || !data) return { blockedIds, blockedByIds };
  for (const row of data as { blocker_id: string; blocked_id: string }[]) {
    if (row.blocker_id === me) blockedIds.add(row.blocked_id);
    else blockedByIds.add(row.blocker_id);
  }
  return { blockedIds, blockedByIds };
}

/** Users the current user has blocked, newest block first. */
export async function getBlockedUsers(
  me: string,
): Promise<ApiResult<{ blockedId: string; createdAt: string }[]>> {
  if (!supabase) return { data: [], error: t('errors.network') };
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id, created_at')
    .eq('blocker_id', me)
    .order('created_at', { ascending: false });
  if (error) {
    return { data: [], error: errorMessage(error, 'getBlockedUsers') };
  }
  return {
    data: (data ?? []).map(
      (row: { blocked_id: string; created_at: string }) => ({
        blockedId: row.blocked_id,
        createdAt: row.created_at,
      }),
    ),
    error: null,
  };
}

/** Block another user. The RLS insert policy enforces blocker = caller. */
export async function blockUser(
  me: string,
  otherId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: me, blocked_id: otherId });
  if (error && error.code !== '23505') {
    return errorMessage(error, 'user block insert');
  }
  return null;
}

/** Remove the caller's own block. The blocked user cannot do this (RLS). */
export async function unblockUser(
  me: string,
  otherId: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', me)
    .eq('blocked_id', otherId);
  if (error) return errorMessage(error, 'user block delete');
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
  hiddenUntil?: string | null,
): Promise<{ messages: Message[]; hasMore: boolean; error: string | null }> {
  if (!supabase) {
    return { messages: [], hasMore: false, error: t('errors.network') };
  }
  let query = supabase
    .from('messages')
    .select('id, connection_id, sender_id, ciphertext, created_at, deleted_at, kind, meta')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (hiddenUntil) {
    query = query.gt('created_at', hiddenUntil);
  }
  if (before) {
    query = query.or(
      `created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId ?? ''})`,
    );
  }
  const { data, error } = await query;
  if (error) {
    return {
      messages: [],
      hasMore: false,
      error: errorMessage(error, 'getMessagesPage'),
    };
  }
  const rows = (data ?? []) as Message[];
  const hasMore = rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).reverse();
  return { messages, hasMore, error: null };
}

export async function getLastMessages(
  connectionIds: string[],
): Promise<ApiResult<Record<string, Message>>> {
  if (!supabase || connectionIds.length === 0) return { data: {}, error: null };
  const { data, error } = await supabase
    .from('messages')
    .select('id, connection_id, sender_id, ciphertext, created_at, deleted_at, kind')
    .in('connection_id', connectionIds)
    .order('created_at', { ascending: false });
  if (error) {
    return { data: {}, error: errorMessage(error, 'getLastMessages') };
  }
  const map: Record<string, Message> = {};
  for (const m of (data ?? []) as Message[]) {
    if (!(m.connection_id in map)) map[m.connection_id] = m;
  }
  return { data: map, error: null };
}

/**
 * Insert a message. `ciphertext` is the ALREADY-PREPARED value to store:
 * an E2EE envelope for peer conversations, or plaintext for My Notes
 * (self-connections). The caller (Chat) encrypts first via the session
 * manager; this function performs no cryptography and never receives raw
 * user text for a peer conversation. Supabase therefore never sees peer
 * plaintext.
 */
export async function sendMessage(
  connectionId: string,
  senderId: string,
  ciphertext: string,
): Promise<{ message: Message | null; error: string | null }> {
  if (!supabase) {
    return { message: null, error: t('errors.network') };
  }
  const { data, error } = await supabase
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: senderId, ciphertext })
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

export const CHAT_HIDDEN_EVENT = 'enough-chat-hidden';

export function isHiddenByChatDeletion(
  createdAt: string | undefined,
  hiddenUntil: string | null | undefined,
): boolean {
  if (!createdAt || !hiddenUntil) return false;
  return createdAt <= hiddenUntil;
}

interface StoredChatDeletion {
  id: string;
  hiddenUntil: string;
  revealed?: boolean;
}

interface StoredDeletions {
  messages: string[];
  chats: StoredChatDeletion[];
}

function normalizeStoredChats(raw: unknown): StoredChatDeletion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, hiddenUntil: new Date().toISOString() };
      }
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as StoredChatDeletion).id === 'string'
      ) {
        const row = entry as StoredChatDeletion;
        return {
          id: row.id,
          hiddenUntil: row.hiddenUntil || new Date().toISOString(),
          revealed: row.revealed ?? false,
        };
      }
      return null;
    })
    .filter((row): row is StoredChatDeletion => Boolean(row));
}

const deletionStorage = {
  read(me: string): StoredDeletions {
    try {
      const raw = window.localStorage.getItem(`enough-deletions-${me}`);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          messages?: string[];
          chats?: unknown;
        };
        return {
          messages: parsed.messages ?? [],
          chats: normalizeStoredChats(parsed.chats),
        };
      }
    } catch {
      /* ignore */
    }
    return { messages: [], chats: [] };
  },
  write(me: string, value: StoredDeletions): void {
    try {
      window.localStorage.setItem(`enough-deletions-${me}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

export interface UserDeletions {
  messages: Set<string>;
  chats: Set<string>;
  chatUntil: Map<string, string>;
  revealed: Set<string>;
}

let deletionsCache: { me: string } & UserDeletions | null = null;

function mergeChatUntil(
  local: StoredChatDeletion[],
  dbRows: ChatDeletion[],
): { until: Map<string, string>; revealed: Set<string> } {
  const until = new Map<string, string>();
  const revealed = new Set<string>();
  for (const row of local) {
    until.set(row.id, row.hiddenUntil);
    if (row.revealed) revealed.add(row.id);
  }
  for (const row of dbRows) {
    const t = row.hidden_until || row.created_at;
    if (t) until.set(row.connection_id, t);
    if (row.revealed) revealed.add(row.connection_id);
  }
  return { until, revealed };
}

async function loadDeletions(me: string): Promise<UserDeletions> {
  const local = deletionStorage.read(me);
  if (!supabase) {
    const { until: chatUntil, revealed } = mergeChatUntil(local.chats, []);
    const merged: UserDeletions = {
      messages: new Set(local.messages),
      chats: new Set(chatUntil.keys()),
      chatUntil,
      revealed,
    };
    deletionsCache = { me, ...merged };
    return merged;
  }
  const [msgRes, chatRes] = await Promise.all([
    supabase.from('message_deletions').select('message_id').eq('user_id', me),
    supabase
      .from('chat_deletions')
      .select('connection_id, hidden_until, created_at, revealed')
      .eq('user_id', me),
  ]);
  const dbMessages = (msgRes.data ?? []) as Pick<MessageDeletion, 'message_id'>[];
  const dbChats = (chatRes.data ?? []) as ChatDeletion[];
  const { until: chatUntil, revealed } = mergeChatUntil(local.chats, dbChats);
  const merged: UserDeletions = {
    messages: new Set([...local.messages, ...dbMessages.map((m) => m.message_id)]),
    chats: new Set(chatUntil.keys()),
    chatUntil,
    revealed,
  };
  deletionsCache = { me, ...merged };
  return merged;
}

/** Always re-fetch from the database so deletions made elsewhere (or by
 *  another mounted screen) are visible; merges the local fallback set. */
export async function loadDeletionsForUser(me: string): Promise<UserDeletions> {
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
  const hiddenUntil = new Date().toISOString();
  const local = deletionStorage.read(me);
  const existing = local.chats.find((c) => c.id === connectionId);
  if (existing) {
    existing.hiddenUntil = hiddenUntil;
    existing.revealed = false;
  } else {
    local.chats.push({ id: connectionId, hiddenUntil, revealed: false });
  }
  deletionStorage.write(me, local);
  if (deletionsCache?.me === me) {
    deletionsCache.chats.add(connectionId);
    deletionsCache.chatUntil.set(connectionId, hiddenUntil);
    deletionsCache.revealed.delete(connectionId);
  }
  if (supabase) {
    const { error } = await supabase.from('chat_deletions').upsert(
      {
        connection_id: connectionId,
        user_id: me,
        hidden_until: hiddenUntil,
        revealed: false,
      },
      { onConflict: 'connection_id,user_id' },
    );
    if (error) {
      // Fallback for backends that only allow insert (pre-0006).
      const inserted = await supabase
        .from('chat_deletions')
        .insert({
          connection_id: connectionId,
          user_id: me,
          hidden_until: hiddenUntil,
        });
      if (inserted.error && inserted.error.code !== '23505') {
        return errorMessage(error, 'chat delete for me');
      }
    }
  }
  try {
    window.dispatchEvent(
      new CustomEvent(CHAT_HIDDEN_EVENT, {
        detail: { connectionId, userId: me, hiddenUntil },
      }),
    );
  } catch {
    /* ignore */
  }
  return null;
}

export async function restoreChatForMe(
  me: string,
  connectionId: string,
): Promise<void> {
  const local = deletionStorage.read(me);
  local.chats = local.chats.filter((c) => c.id !== connectionId);
  deletionStorage.write(me, local);
  if (deletionsCache?.me === me) {
    deletionsCache.chats.delete(connectionId);
    deletionsCache.chatUntil.delete(connectionId);
    deletionsCache.revealed.delete(connectionId);
  }
  if (supabase) {
    await supabase
      .from('chat_deletions')
      .delete()
      .eq('connection_id', connectionId)
      .eq('user_id', me);
  }
}

/**
 * Re-show a previously deleted chat in the Home list while keeping the
 * hidden_until cutoff.  Old messages remain hidden; new messages work
 * normally.  Called when the user rediscoveres the same person via search.
 */
export async function revealChatForMe(
  me: string,
  connectionId: string,
): Promise<void> {
  const local = deletionStorage.read(me);
  const entry = local.chats.find((c) => c.id === connectionId);
  if (entry) entry.revealed = true;
  deletionStorage.write(me, local);
  if (deletionsCache?.me === me) {
    deletionsCache.revealed.add(connectionId);
  }
  if (supabase) {
    await supabase
      .from('chat_deletions')
      .update({ revealed: true })
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

/**
 * Unread counts per connection.
 *
 * After migration 0013 the `connection_unread` view returns a row for every
 * connection of the authenticated user (not only those with `connection_reads`
 * rows), so a single view query covers all connections — O(1) DB round trips
 * regardless of the number of connections.
 *
 * A bounded batch fallback is retained for environments where the migration
 * has not yet been applied: instead of one query per missing connection (the
 * old N+1 behaviour), at most two additional queries are issued (one for
 * connections without local read state, one for connections with read state).
 *
 * The optional `_client` parameter exists solely for unit testing.
 */
export async function getUnreadCounts(
  me: string,
  connectionIds: string[],
  readState: Record<string, string>,
  /** @internal Optional Supabase client override for testing. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client?: any,
): Promise<Record<string, number>> {
  const client = _client ?? supabase;
  if (!client || connectionIds.length === 0) return {};
  const map: Record<string, number> = {};

  // Preferred: the connection_unread view (RLS via security invoker).
  // Migration 0013 ensures the view covers ALL connections of the
  // authenticated user, including brand-new conversations without read state.
  const { data, error } = await client
    .from('connection_unread')
    .select('connection_id, unread')
    .eq('user_id', me);
  if (!error && data) {
    for (const row of data as UnreadCount[]) {
      map[row.connection_id] = row.unread;
    }
  }

  // Bounded fallback: only if some connections are still missing from the
  // view (e.g. the migration has not been applied). At most 2 queries
  // total — never one per connection.
  const missing = connectionIds.filter((cid) => !(cid in map));
  if (missing.length > 0) {
    await batchUnreadFallback(client, me, missing, readState, map);
  }
  return map;
}

/**
 * Bounded fallback for unread counts when the view does not cover all
 * connections. Replaces the old N+1 per-connection loop with at most two
 * batched queries.
 *
 * @internal Exported for unit testing only.
 */
export async function batchUnreadFallback(
  client: any,
  me: string,
  missing: string[],
  readState: Record<string, string>,
  map: Record<string, number>,
): Promise<void> {
  // Split into connections with and without local read state.
  const withoutState: string[] = [];
  const withState: string[] = [];
  for (const cid of missing) {
    if (readState[cid]) {
      withState.push(cid);
    } else {
      withoutState.push(cid);
    }
  }

  // Batch 1: connections without read state — count all non-deleted
  // messages from others. One query for all of them.
  if (withoutState.length > 0) {
    const { data, error } = await client
      .from('messages')
      .select('connection_id')
      .in('connection_id', withoutState)
      .neq('sender_id', me)
      .is('deleted_at', null);
    const counts: Record<string, number> = {};
    if (!error && data) {
      for (const row of data as { connection_id: string }[]) {
        counts[row.connection_id] = (counts[row.connection_id] || 0) + 1;
      }
    }
    for (const cid of withoutState) {
      map[cid] = counts[cid] || 0;
    }
  }

  // Batch 2: connections with read state — fetch all relevant messages
  // and filter client-side by each connection's `since` timestamp.
  // One query for all of them.
  if (withState.length > 0) {
    const { data, error } = await client
      .from('messages')
      .select('connection_id, created_at')
      .in('connection_id', withState)
      .neq('sender_id', me)
      .is('deleted_at', null);
    const counts: Record<string, number> = {};
    if (!error && data) {
      for (const row of data as { connection_id: string; created_at: string }[]) {
        const since = readState[row.connection_id];
        if (!since || row.created_at > since) {
          counts[row.connection_id] = (counts[row.connection_id] || 0) + 1;
        }
      }
    }
    for (const cid of withState) {
      map[cid] = counts[cid] || 0;
    }
  }
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
  // This is a developer/deployment diagnostic, not user-facing behavior.
  // Avoid noisy production console output while retaining local visibility.
  if (!import.meta.env.DEV || !supabase) return;
  const probes: Array<{ table: string; column: string }> = [
    { table: 'profiles', column: 'display_name' },
    { table: 'messages', column: 'kind' },
    { table: 'connection_reads', column: 'user_id' },
    { table: 'connection_unread', column: 'unread' },
    { table: 'chat_deletions', column: 'hidden_until' },
    { table: 'chat_deletions', column: 'revealed' },
    { table: 'user_blocks', column: 'blocked_id' },
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
        'Run all files in supabase/migrations/ in numeric order ' +
        '(see docs/MIGRATIONS.md).',
    );
  }
}

/* ------------------------------------------------------------------ */
/* My Notes (self-chat)                                                */
/* ------------------------------------------------------------------ */

interface MyNotesSetupResult {
  connectionId: string | null;
  error: string | null;
}

function isMissingMyNotesRpc(error: unknown): boolean {
  const code = supabaseErrorField(error, 'code');
  const message = supabaseErrorField(error, 'message')?.toLowerCase() ?? '';
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    (message.includes('function') &&
      (message.includes('ensure_my_notes') || message.includes('remove_my_notes')) &&
      (message.includes('not find') || message.includes('does not exist')))
  );
}

function isMyNotesSchemaError(error: unknown): boolean {
  const code = supabaseErrorField(error, 'code');
  // 23514: a legacy user_a <> user_b CHECK constraint.
  // 42501: normal connection RLS correctly disallows accepted browser inserts.
  return code === '23514' || code === '42501';
}

/**
 * Find or create the accepted self-connection used by My Notes.
 *
 * Normal connection RLS should allow browser users to create only pending
 * requests, so the preferred path is the auth-bound RPC from migration 0005.
 * The direct-table fallback keeps older, permissive installations working.
 */
export async function ensureMyNotes(me: string): Promise<MyNotesSetupResult> {
  if (!supabase) {
    return { connectionId: null, error: t('errors.network') };
  }

  const { data: rpcId, error: rpcError } = await supabase.rpc('ensure_my_notes');
  if (!rpcError && typeof rpcId === 'string' && rpcId) {
    return { connectionId: rpcId, error: null };
  }

  if (rpcError && !isMissingMyNotesRpc(rpcError)) {
    if (isMyNotesSchemaError(rpcError)) {
      return {
        connectionId: null,
        error: t('settingsScreen.myNotesUpgradeRequired'),
      };
    }
    return {
      connectionId: null,
      error: errorMessage(rpcError, 'my notes ensure RPC'),
    };
  }

  // Compatibility fallback for a backend without migration 0005 whose
  // existing policies already permit an accepted self-connection.
  const { data: existing, error: findError } = await supabase
    .from('connections')
    .select('id, status')
    .eq('user_a', me)
    .eq('user_b', me)
    .maybeSingle();
  if (findError) {
    errorMessage(findError, 'my notes legacy lookup');
    return {
      connectionId: null,
      error: t('settingsScreen.myNotesUpgradeRequired'),
    };
  }

  if (existing) {
    if (existing.status === 'accepted') {
      return { connectionId: existing.id as string, error: null };
    }
    const { data: updated, error: updateError } = await supabase
      .from('connections')
      .update({ status: 'accepted', created_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id');
    if (!updateError && updated?.length === 1) {
      return { connectionId: existing.id as string, error: null };
    }
    if (updateError) errorMessage(updateError, 'my notes legacy update');
    return {
      connectionId: null,
      error: t('settingsScreen.myNotesUpgradeRequired'),
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('connections')
    .insert({ user_a: me, user_b: me, status: 'accepted' })
    .select('id')
    .single();
  if (!insertError && inserted?.id) {
    return { connectionId: inserted.id as string, error: null };
  }

  // A second tab may have won the insert race. Recover the row before showing
  // an error rather than reporting a harmless unique conflict.
  if (insertError?.code === '23505') {
    const { data: raced } = await supabase
      .from('connections')
      .select('id')
      .eq('user_a', me)
      .eq('user_b', me)
      .maybeSingle();
    if (raced?.id) return { connectionId: raced.id as string, error: null };
  }

  if (insertError) errorMessage(insertError, 'my notes legacy insert');
  return {
    connectionId: null,
    error: t('settingsScreen.myNotesUpgradeRequired'),
  };
}

/** Delete only the signed-in user's My Notes connection. */
export async function removeMyNotes(
  me: string,
  knownConnectionId?: string,
): Promise<string | null> {
  if (!supabase) return t('errors.network');

  const { error: rpcError } = await supabase.rpc('remove_my_notes');
  if (!rpcError) return null;
  if (!isMissingMyNotesRpc(rpcError)) {
    return errorMessage(rpcError, 'my notes remove RPC');
  }

  // Compatibility fallback for installations not yet using migration 0005.
  let connectionId = knownConnectionId;
  if (!connectionId) {
    const { data, error } = await supabase
      .from('connections')
      .select('id')
      .eq('user_a', me)
      .eq('user_b', me)
      .maybeSingle();
    if (error) {
      errorMessage(error, 'my notes legacy remove lookup');
      return t('settingsScreen.myNotesUpgradeRequired');
    }
    connectionId = data?.id as string | undefined;
  }
  if (!connectionId) return null;

  const { data: deleted, error } = await supabase
    .from('connections')
    .delete()
    .eq('id', connectionId)
    .eq('user_a', me)
    .eq('user_b', me)
    .select('id');
  if (error) {
    const message = errorMessage(error, 'my notes legacy remove');
    if (isMyNotesSchemaError(error)) {
      return t('settingsScreen.myNotesUpgradeRequired');
    }
    return message;
  }
  if (!deleted || deleted.length === 0) {
    return t('settingsScreen.myNotesUpgradeRequired');
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* account deletion                                                    */
/* ------------------------------------------------------------------ */

/**
 * Permanently delete the current user's account. Runs a `security definer`
 * database function (see supabase/migrations/0004_delete_account.sql) that:
 *   - writes a "@username deleted their account" system message into every
 *     accepted conversation,
 *   - marks those conversations `ended` (blocking further messages),
 *   - deletes the profile (freeing the username) and the auth user.
 * Chat history is preserved for the other participants.
 */
export async function deleteOwnAccount(): Promise<string | null> {
  if (!supabase) return t('errors.network');
  const { error } = await supabase.rpc('delete_own_account');
  if (error) return errorMessage(error, 'account deletion');
  return null;
}
