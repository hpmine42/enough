/**
 * enough. — Offline send queue (IndexedDB Outbox).
 *
 * WHAT THIS IS
 *   A durable outbox that lets the user type and "send" messages while the
 *   device is offline. Outbox entries are encrypted with the SAME sealing
 *   key that protects offline snapshots (AES-256-GCM, non-extractable, per
 *   user) so that queued plaintext never rests unencrypted on disk. Once the
 *   connection comes back the queue drains in strict FIFO order: each entry
 *   is prepared (E2EE) and sent via `sendMessage`; failures pause the drain
 *   until the next online transition.
 *
 * SECURITY BOUNDARY
 *   * Queued plaintext is SEALED under the user's non-extractable AES-GCM
 *     sealing key (same key / same store as message-cache / offline
 *     snapshots). This is the strongest-at-rest guarantee this app can offer
 *     without a second passphrase.
 *   * Queue entries are LOCAL ONLY. Nothing reaches Supabase until
 *     connectivity is restored and the entry is encrypted for the peer
 *     through the normal `prepareSend` path (which itself fails closed when
 *     the engine is not ready).
 *   * Account deletion wipes the queue with the existing `offline:` prefix
 *     scan in `deleteUserCryptoState`.
 *   * Malformed or tampered entries are dropped individually (fail-open for
 *     the queue, but no fabricated plaintext ever reaches the UI).
 *
 * WHAT IT DOES NOT DO
 *   * No delivery receipts / retry backoff beyond a single FIFO drain pass
 *     per online transition. If sending fails (blocked peer, engine error)
 *     the entry is surfaced for the user to edit or discard. That UX is
 *     left as a future enhancement — this implementation guarantees at-least
 *     durability across reloads for the common case of transient offline
 *     (tab background, tunnel, flaky mobile).
 *   * Multi-device fan-out. The queue lives on ONE device.
 */

import { ensureSealingKey, loadSealingKey } from './crypto/sealed-state.ts';
import { deleteState, getState, putState } from './crypto/storage.ts';
import { toBufferSource } from './crypto/serialization.ts';
import { OFFLINE_RECORD_PREFIX } from './crypto/types.ts';

/** Record key for the single outbox array (per user). */
export const OFFLINE_OUTBOX_RECORD = `${OFFLINE_RECORD_PREFIX}outbox`;

export interface OutboxEntry {
  /** Client-assigned id (uuid-ish). Used for de-duplication and UI keys. */
  id: string;
  connectionId: string;
  /** Sanitized plaintext. Never written to Supabase unencrypted (drain
   *  always routes through prepareSend). */
  plaintext: string;
  createdAt: number;
  /** Last error that prevented sending (shown in the UI if we give up). */
  lastError?: string;
  attempts: number;
}

interface SealedOutbox {
  v: number;
  userId: string;
  record: string;
  iv: Uint8Array;
  sealed: Uint8Array;
}

const OUTBOX_VERSION = 1;
const OUTBOX_AAD_PREFIX = 'enough.outbox.v1';
const IV_BYTES = 12;

function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }

function buildAad(userId: string, record: string): Uint8Array {
  if (userId.includes('|') || record.includes('|')) throw new Error('Separator in id');
  return utf8(`${OUTBOX_AAD_PREFIX}|${userId}|${record}`);
}

export async function enqueueMessage(
  userId: string,
  entry: Omit<OutboxEntry, 'createdAt' | 'attempts'> & { createdAt?: number; attempts?: number },
): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  const list = await loadOutbox(userId);
  list.push({
    id: entry.id,
    connectionId: entry.connectionId,
    plaintext: entry.plaintext,
    createdAt: entry.createdAt ?? Date.now(),
    attempts: entry.attempts ?? 0,
  });
  await persistOutbox(userId, list);
}

export async function loadOutbox(userId: string): Promise<OutboxEntry[]> {
  if (!userId || typeof indexedDB === 'undefined') return [];
  try {
    const key = await loadSealingKey(userId);
    if (!key) return [];
    const raw = await getState<unknown>(userId, OFFLINE_OUTBOX_RECORD);
    if (!raw) return [];
    const unsealed = await unseal(key, raw, userId);
    if (!Array.isArray(unsealed)) return [];
    return unsealed.filter(isEntry);
  } catch { return []; }
}

export async function removeFromOutbox(userId: string, id: string): Promise<void> {
  const list = await loadOutbox(userId);
  const next = list.filter((e) => e.id !== id);
  if (next.length === 0) {
    try { await deleteState(userId, OFFLINE_OUTBOX_RECORD); } catch { /* */ }
    return;
  }
  await persistOutbox(userId, next);
}

export async function updateOutboxError(userId: string, id: string, message: string): Promise<void> {
  const list = await loadOutbox(userId);
  const e = list.find((x) => x.id === id);
  if (!e) return;
  e.lastError = message;
  e.attempts += 1;
  await persistOutbox(userId, list);
}

export function outboxForConnection(list: OutboxEntry[], connectionId: string): OutboxEntry[] {
  return list.filter((e) => e.connectionId === connectionId);
}

async function persistOutbox(userId: string, list: OutboxEntry[]): Promise<void> {
  try {
    const key = await ensureSealingKey(userId);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const aad = buildAad(userId, OFFLINE_OUTBOX_RECORD);
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: toBufferSource(aad) },
      key,
      toBufferSource(utf8(JSON.stringify(list))),
    );
    const envelope: SealedOutbox = {
      v: OUTBOX_VERSION,
      userId,
      record: OFFLINE_OUTBOX_RECORD,
      iv,
      sealed: new Uint8Array(sealed),
    };
    await putState(userId, OFFLINE_OUTBOX_RECORD, envelope);
  } catch { /* best-effort */ }
}

async function unseal(key: CryptoKey, raw: unknown, userId: string): Promise<unknown> {
  if (!isSealed(raw)) return null;
  if (raw.v !== OUTBOX_VERSION) return null;
  if (raw.userId !== userId || raw.record !== OFFLINE_OUTBOX_RECORD) return null;
  if (raw.iv.length !== IV_BYTES) return null;
  try {
    const aad = buildAad(userId, OFFLINE_OUTBOX_RECORD);
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBufferSource(raw.iv), additionalData: toBufferSource(aad) },
      key,
      toBufferSource(raw.sealed),
    );
    return JSON.parse(new TextDecoder().decode(buf));
  } catch { return null; }
}

function isSealed(v: unknown): v is SealedOutbox {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<SealedOutbox>;
  return typeof e.v === 'number' && typeof e.userId === 'string' && typeof e.record === 'string' &&
    e.iv instanceof Uint8Array && e.sealed instanceof Uint8Array;
}

function isEntry(v: unknown): v is OutboxEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<OutboxEntry>;
  return typeof e.id === 'string' && typeof e.connectionId === 'string' &&
    typeof e.plaintext === 'string' && typeof e.createdAt === 'number';
}
