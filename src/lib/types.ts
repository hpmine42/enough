export interface Profile {
  id: string;
  username: string;
  display_name?: string | null;
  created_at?: string;
}

export type ConnectionStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'ended';

export interface Connection {
  id: string;
  user_a: string;
  user_b: string;
  status: ConnectionStatus;
  created_at?: string;
}

export type MessageKind = 'text' | 'name_change' | 'connection_event' | 'deleted_account';

export interface MessageMeta {
  old_name?: string | null;
  new_name?: string | null;
  type?: 'accepted' | null;
  username?: string | null;
}

export interface Message {
  id: string;
  connection_id: string;
  sender_id: string;
  // NOTE: v0.1 stores the plaintext message here. This is NOT end-to-end
  // encrypted. The field name is kept from the existing schema so that real
  // E2EE can be introduced later without renaming columns.
  ciphertext: string;
  created_at: string;
  deleted_at?: string | null;
  kind?: MessageKind | null;
  meta?: MessageMeta | null;
}

export interface ConnectionRead {
  connection_id: string;
  user_id: string;
  last_read_at: string;
}

export interface MessageDeletion {
  message_id: string;
  user_id: string;
  created_at?: string;
}

export interface ChatDeletion {
  connection_id: string;
  user_id: string;
  created_at?: string;
}

export interface UnreadCount {
  connection_id: string;
  unread: number;
}
