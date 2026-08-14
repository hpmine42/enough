import { supabase } from './supabase';
import { errorMessage } from './errors';
import { Connection, Message, Profile } from './types';

export async function getMyProfile(id: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .eq('id', id)
    .single();
  if (error) return null;
  return data as Profile;
}

// Idempotent: works whether or not a trigger already created the profile row
// for the new auth user. Only the username needs to be written from the app.
export async function upsertProfile(
  id: string,
  username: string,
): Promise<string | null> {
  if (!supabase) return 'Keine Verbindung zum Server.';
  const { error } = await supabase
    .from('profiles')
    .upsert({ id, username }, { onConflict: 'id' });
  if (error) {
    if (error.code === '23505') {
      return 'Dieser Benutzername ist bereits vergeben.';
    }
    return errorMessage(error);
  }
  return null;
}

export async function usernameExists(username: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function searchUsers(
  query: string,
  me: string,
): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username')
    .ilike('username', `${query}%`)
    .neq('id', me)
    .limit(10);
  if (error) return [];
  return (data ?? []) as Profile[];
}

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
    .select('id, username')
    .in('id', ids);
  if (error) return {};
  const map: Record<string, Profile> = {};
  for (const p of (data ?? []) as Profile[]) {
    map[p.id] = p;
  }
  return map;
}

export async function getLastMessages(
  connectionIds: string[],
): Promise<Record<string, Message>> {
  if (!supabase || connectionIds.length === 0) return {};
  const { data, error } = await supabase
    .from('messages')
    .select('id, connection_id, sender_id, ciphertext, created_at')
    .in('connection_id', connectionIds)
    .order('created_at', { ascending: false });
  if (error) return {};
  const map: Record<string, Message> = {};
  for (const m of (data ?? []) as Message[]) {
    if (!(m.connection_id in map)) map[m.connection_id] = m;
  }
  return map;
}

export async function getMessages(connectionId: string): Promise<Message[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('id, connection_id, sender_id, ciphertext, created_at')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as Message[];
}

export async function sendMessage(
  connectionId: string,
  senderId: string,
  text: string,
): Promise<{ message: Message | null; error: string | null }> {
  if (!supabase) {
    return { message: null, error: 'Keine Verbindung zum Server.' };
  }
  const { data, error } = await supabase
    .from('messages')
    .insert({ connection_id: connectionId, sender_id: senderId, ciphertext: text })
    .select()
    .single();
  if (error) return { message: null, error: errorMessage(error) };
  return { message: data as Message, error: null };
}

export async function sendConnectionRequest(
  me: string,
  otherId: string,
): Promise<string | null> {
  if (!supabase) return 'Keine Verbindung zum Server.';
  const { error } = await supabase
    .from('connections')
    .insert({ user_a: me, user_b: otherId, status: 'pending' });
  if (error) {
    if (error.code === '23505') {
      return 'Diese Verbindung besteht bereits.';
    }
    return errorMessage(error);
  }
  return null;
}

export async function acceptConnection(
  connectionId: string,
): Promise<string | null> {
  if (!supabase) return 'Keine Verbindung zum Server.';
  const { error } = await supabase
    .from('connections')
    .update({ status: 'accepted' })
    .eq('id', connectionId);
  if (error) return errorMessage(error);
  return null;
}
