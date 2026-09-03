/**
 * enough. — sealed offline snapshots (Offline Read Mode, v0.3.x).
 *
 * WHAT THIS IS
 *   The smallest additional persistence required so previously loaded Home
 *   and Chat data stays READABLE while the device is offline.
 *
 * WHY IT IS NEEDED
 *   The existing local cache (`src/lib/e2ee/message-cache.ts`) stores only
 *   `messageId -> display plaintext`. It holds no connection rows, no
 *   profiles, no message metadata and no ordering, so it alone cannot render
 *   Home or Chat without Supabase. This module stores exactly the missing
 *   metadata and nothing else; message display plaintext keeps coming from
 *   the existing sealed message cache.
 *
 * SECURITY BOUNDARY — identical to the existing message cache
 *   * LOCAL ONLY. Snapshots never leave the browser and never reach Supabase.
 *   * Sealed with AES-256-GCM under the SAME per-user, non-extractable
 *     sealing key from `crypto/sealed-state.ts` (`vaultkeys` store). No new
 *     key, no new key derivation, no second database.
 *   * Stored in the EXISTING `enough-crypto` → `state` object store under
 *     composite keys `${userId}:offline:...`, so account deletion wipes them
 *     with the existing prefix scan in `deleteUserCryptoState`.
 *   * AAD binds the owning user id AND the record key, so a snapshot cannot
 *     be moved between users or between records without breaking the tag.
 *   * Fail-closed: any missing key, tampered byte or shape mismatch yields
 *     `null` — the UI then simply has no cached data.
 *   * NO private key material is ever placed in a snapshot.
 *   * Peer message bodies are stored exactly as they come from Supabase
 *     (opaque E2EE ciphertext). The only plaintext that can appear here is
 *     content the current architecture already stores in plaintext in the
 *     `ciphertext` column (My Notes / legacy rows) — and even that is sealed
 *     at rest here, i.e. protection is never weaker than before.
 *
 * NO OWN CRYPTOGRAPHY. AES-GCM comes from WebCrypto.
 */

import { ensureSealingKey, loadSealingKey } from './crypto/sealed-state.ts';
import { deleteState, getState, putState } from './crypto/storage.ts';
import { toBufferSource } from './crypto/serialization.ts';
import { OFFLINE_RECORD_PREFIX } from './crypto/types.ts';
import type { Connection, Message, Profile } from './types.ts';

/** Format version of a sealed offline snapshot. Part of the AAD. */
export const OFFLINE_SNAPSHOT_VERSION = 1;

/** Prefix of the offline-snapshot AEAD additional-data string. */
export const OFFLINE_AAD_PREFIX = 'enough.offline.v1';

/** AES-GCM nonce length in bytes. */
const IV_BYTES = 12;

/** Record key of the Home snapshot (within the `state` store). */
export const OFFLINE_HOME_RECORD = `${OFFLINE_RECORD_PREFIX}home`;

/** Record key of one conversation snapshot. */
export function offlineChatRecord(connectionId: string): string {
  return `${OFFLINE_RECORD_PREFIX}chat:${connectionId}`;
}

/** Newest messages kept per conversation. Matches Chat's first page size. */
export const OFFLINE_CHAT_MESSAGE_LIMIT = 40;

/** The Home data that can be re-rendered without any network access. */
export interface HomeSnapshot {
  connections: Connection[];
  profiles: Record<string, Profile>;
  lastMessages: Record<string, Message>;
  unread: Record<string, number>;
  /** Message ids the user deleted for themselves. */
  deletedForMe: string[];
  savedAt: number;
}

/** The Chat data that can be re-rendered without any network access. */
export interface ChatSnapshot {
  connection: Connection;
  peer: Profile | null;
  messages: Message[];
  hiddenUntil: string | null;
  deletedForMe: string[];
  savedAt: number;
}

interface SealedSnapshot {
  v: number;
  userId: string;
  record: string;
  iv: Uint8Array;
  sealed: Uint8Array;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Build the AEAD additional data. Injective encoding: versioned prefix,
 * owning user id, record key — separated by a character neither id may hold.
 */
export function buildOfflineAad(userId: string, record: string): Uint8Array {
  if (!userId || !record) throw new Error('userId and record are required.');
  if (userId.includes('|') || record.includes('|')) {
    throw new Error('Identifiers must not contain the AAD separator.');
  }
  return utf8(`${OFFLINE_AAD_PREFIX}|${userId}|${record}`);
}

function isSealedSnapshot(value: unknown): value is SealedSnapshot {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<SealedSnapshot>;
  return (
    typeof e.v === 'number' &&
    typeof e.userId === 'string' &&
    typeof e.record === 'string' &&
    e.iv instanceof Uint8Array &&
    e.sealed instanceof Uint8Array
  );
}

/** Seal an arbitrary JSON-serializable snapshot for (userId, record). */
export async function sealSnapshot(
  key: CryptoKey,
  userId: string,
  record: string,
  data: unknown,
): Promise<SealedSnapshot> {
  const aad = buildOfflineAad(userId, record);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: toBufferSource(aad) },
    key,
    toBufferSource(utf8(JSON.stringify(data))),
  );
  return {
    v: OFFLINE_SNAPSHOT_VERSION,
    userId,
    record,
    iv,
    sealed: new Uint8Array(sealed),
  };
}

/**
 * Authenticate and decrypt a snapshot. Returns null on ANY problem
 * (fail closed) — a missing snapshot and a rejected one are indistinguishable
 * to the UI on purpose: neither may produce data.
 */
export async function unsealSnapshot<T>(
  key: CryptoKey,
  envelope: unknown,
  expectedUserId: string,
  expectedRecord: string,
): Promise<T | null> {
  if (!isSealedSnapshot(envelope)) return null;
  if (envelope.v !== OFFLINE_SNAPSHOT_VERSION) return null;
  if (envelope.userId !== expectedUserId) return null;
  if (envelope.record !== expectedRecord) return null;
  if (envelope.iv.length !== IV_BYTES) return null;
  try {
    const aad = buildOfflineAad(expectedUserId, expectedRecord);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(envelope.iv),
        additionalData: toBufferSource(aad),
      },
      key,
      toBufferSource(envelope.sealed),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

async function writeSnapshot(
  userId: string,
  record: string,
  data: unknown,
): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  try {
    const key = await ensureSealingKey(userId);
    const envelope = await sealSnapshot(key, userId, record, data);
    await putState(userId, record, envelope);
  } catch {
    // A snapshot is a convenience, never a correctness requirement: a failed
    // write must not break the online path that produced the data.
  }
}

async function readSnapshot<T>(userId: string, record: string): Promise<T | null> {
  if (!userId || typeof indexedDB === 'undefined') return null;
  try {
    const raw = await getState<unknown>(userId, record);
    if (!raw) return null;
    const key = await loadSealingKey(userId);
    if (!key) return null; // fail closed: no key, no cached data
    return await unsealSnapshot<T>(key, raw, userId, record);
  } catch {
    return null;
  }
}

/** Persist the Home overview so it can be rendered offline. */
export function saveHomeSnapshot(
  userId: string,
  snapshot: Omit<HomeSnapshot, 'savedAt'>,
): Promise<void> {
  return writeSnapshot(userId, OFFLINE_HOME_RECORD, {
    ...snapshot,
    savedAt: Date.now(),
  });
}

/** Read the Home overview snapshot of this user. Null when unavailable. */
export function loadHomeSnapshot(userId: string): Promise<HomeSnapshot | null> {
  return readSnapshot<HomeSnapshot>(userId, OFFLINE_HOME_RECORD);
}

/** Persist one conversation (newest page) so it can be read offline. */
export function saveChatSnapshot(
  userId: string,
  connectionId: string,
  snapshot: Omit<ChatSnapshot, 'savedAt'>,
): Promise<void> {
  const messages = snapshot.messages.slice(-OFFLINE_CHAT_MESSAGE_LIMIT);
  return writeSnapshot(userId, offlineChatRecord(connectionId), {
    ...snapshot,
    messages,
    savedAt: Date.now(),
  });
}

/** Read a conversation snapshot of this user. Null when unavailable. */
export function loadChatSnapshot(
  userId: string,
  connectionId: string,
): Promise<ChatSnapshot | null> {
  return readSnapshot<ChatSnapshot>(userId, offlineChatRecord(connectionId));
}

/** Remove a single conversation snapshot (e.g. chat deleted for me). */
export async function clearChatSnapshot(
  userId: string,
  connectionId: string,
): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  try {
    await deleteState(userId, offlineChatRecord(connectionId));
  } catch {
    /* best effort */
  }
}
