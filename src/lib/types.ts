export interface Profile {
  id: string;
  username: string;
  created_at?: string;
}

export type ConnectionStatus = 'pending' | 'accepted';

export interface Connection {
  id: string;
  user_a: string;
  user_b: string;
  status: ConnectionStatus;
  created_at?: string;
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
}
