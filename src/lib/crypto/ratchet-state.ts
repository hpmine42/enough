// enough. E2EE — Crash-/rollback-hardened ratchet state persistence (E2EE-2D)
// ---------------------------------------------------------------------------
// SCOPE
// This module persists an OPAQUE cryptographic session state blob (produced by
// the Signal engine) with monotonic revisions and compare-and-swap semantics.
//
// It deliberately does NOT:
//   * implement any cryptography (no ratchet, no KDF, no AEAD, no nonces),
//   * interpret the state bytes in any way,
//   * talk to Supabase or the network,
//   * touch the message send flow.
//
// The state bytes are whatever the engine produced (e.g. libsignal's
// `export_session()`); to this module they are a length-prefixed opaque buffer.
//
// WHY THIS EXISTS
// The Signal Double Ratchet derives a distinct message key per chain index.
// Each message key yields a (cipher_key, mac_key, iv) triple, and Signal's
// message encryption is AES-CBC + HMAC — the derivation is deterministic.
// Re-encrypting from a ratchet state that was rolled back to an earlier
// revision therefore reuses an already-consumed (cipher_key, iv) pair for a
// *different* plaintext. Verified consequences (see
// docs/e2ee-crash-rollback-hardening.md §1):
//   * identical plaintext under a restored state yields byte-identical
//     ciphertext,
//   * plaintexts sharing a prefix yield ciphertexts sharing a prefix at
//     AES block granularity, leaking prefix equality.
// Both violate the Double Ratchet requirement that a message key is used
// exactly once. Preventing rollback is therefore a *correctness* requirement
// of the protocol, not a nice-to-have.
//
// THE INVARIANT
//   A ratchet state that has been durably committed must never be replaced
//   by an older one.
//
// See docs/e2ee-crash-rollback-hardening.md for the full model and its limits.

import { CryptoError } from './errors.ts';
import {
  CRYPTO_STATE_VERSION,
  CRYPTO_STORE_RATCHET,
  ratchetKeyFor,
  ratchetUserPrefix,
  watermarkKeyFor,
} from './types.ts';
import { openDatabase } from './storage.ts';

/**
 * A durably committed ratchet state snapshot.
 *
 * The revision is part of the same record as the state bytes, so a snapshot
 * can never be observed with a revision belonging to different state. This is
 * the reason revision and state are not stored in separate keys.
 */
export interface PersistedRatchetState {
  /** Format version of this record (not the protocol version). */
  version: number;
  /** Supabase user id that owns this state. */
  userId: string;
  /** 1:1 connection this session belongs to. */
  connectionId: string;
  /** Monotonically increasing revision. First commit is 1. */
  revision: number;
  /** Opaque engine state bytes. Never interpreted here. */
  state: Uint8Array;
  /** Unix millis of the commit that produced this record. */
  committedAt: number;
}

/** Result of a load attempt, including the diagnosable failure modes. */
export type RatchetStateStatus =
  | 'VALID'
  | 'MISSING'
  | 'CORRUPTED'
  | 'ROLLBACK_DETECTED'
  | 'USER_MISMATCH';

export interface RatchetStateLoad {
  status: RatchetStateStatus;
  /** Present only when status === 'VALID'. */
  record?: PersistedRatchetState;
  /**
   * Highest revision ever committed for this (user, connection), as recorded
   * by the monotonic watermark. Useful for diagnostics on rollback.
   */
  watermark: number;
}

/** The first revision a fresh session receives on its first commit. */
export const INITIAL_REVISION = 0;

function isUint8Array(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}

/**
 * Validate a record read back from storage. Anything unexpected is treated as
 * corruption rather than being silently coerced.
 */
function validateRecord(
  value: unknown,
  userId: string,
  connectionId: string,
): { ok: true; record: PersistedRatchetState } | { ok: false; status: 'CORRUPTED' | 'USER_MISMATCH' } {
  if (!value || typeof value !== 'object') return { ok: false, status: 'CORRUPTED' };
  const r = value as Partial<PersistedRatchetState>;
  if (typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 0) {
    return { ok: false, status: 'CORRUPTED' };
  }
  if (!isUint8Array(r.state)) return { ok: false, status: 'CORRUPTED' };
  if (typeof r.userId !== 'string' || typeof r.connectionId !== 'string') {
    return { ok: false, status: 'CORRUPTED' };
  }
  if (typeof r.version !== 'number') return { ok: false, status: 'CORRUPTED' };
  // A record that decodes cleanly but belongs to someone else is a distinct,
  // more alarming condition than corruption — never silently adopt it.
  if (r.userId !== userId || r.connectionId !== connectionId) {
    return { ok: false, status: 'USER_MISMATCH' };
  }
  return { ok: true, record: r as PersistedRatchetState };
}

function requireIds(userId: string, connectionId: string): void {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  if (!connectionId) throw new CryptoError('NOT_INITIALIZED', 'connectionId is required.');
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
  });
}

function txComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Ratchet state transaction failed.', transaction.error));
    transaction.onabort = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Ratchet state transaction aborted.', transaction.error));
  });
}

/**
 * Load the current ratchet state.
 *
 * Never throws on a bad record: the failure mode is returned as a status so
 * callers must decide explicitly. In particular this function will NOT fall
 * back to an older snapshot — see §14 of the task and the documented recovery
 * rules. `MISSING` and `CORRUPTED` are deliberately distinct: only the former
 * may lead to establishing a fresh session.
 */
export async function loadRatchetState(
  userId: string,
  connectionId: string,
): Promise<RatchetStateLoad> {
  requireIds(userId, connectionId);
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readonly');
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const raw = await promisify(store.get(ratchetKeyFor(userId, connectionId)) as IDBRequest<unknown>);
    const wmRaw = await promisify(store.get(watermarkKeyFor(userId, connectionId)) as IDBRequest<unknown>);
    await txComplete(transaction);

    const watermark = typeof wmRaw === 'number' && Number.isInteger(wmRaw) && wmRaw >= 0 ? wmRaw : 0;

    if (raw === undefined) {
      // A missing record with a non-zero watermark means a committed state
      // vanished — that is a rollback, not a fresh session.
      if (watermark > INITIAL_REVISION) return { status: 'ROLLBACK_DETECTED', watermark };
      return { status: 'MISSING', watermark };
    }

    const validated = validateRecord(raw, userId, connectionId);
    if (!validated.ok) return { status: validated.status, watermark };

    // The watermark is the monotonic high-water mark of everything ever
    // committed. A record older than it means storage was rolled back
    // underneath us (restored backup, stale replica, partial wipe).
    if (validated.record.revision < watermark) {
      return { status: 'ROLLBACK_DETECTED', watermark };
    }
    return { status: 'VALID', record: validated.record, watermark };
  } finally {
    db.close();
  }
}

/**
 * Compare-and-swap commit of a new ratchet state.
 *
 * Succeeds only when the stored revision equals `expectedRevision`; the new
 * record is then written at `expectedRevision + 1`. The state bytes, the new
 * revision and the watermark are written in a SINGLE IndexedDB transaction, so
 * a crash can never leave a state paired with the wrong revision.
 *
 * Rejects (throws `CryptoError`) when:
 *   * a different writer already advanced the revision → `REVISION_CONFLICT`
 *   * the resulting revision would not exceed the watermark → `ROLLBACK_DETECTED`
 *   * the stored record is corrupt or owned by another user
 *
 * @returns the newly committed revision.
 */
export async function commitRatchetState(
  userId: string,
  connectionId: string,
  expectedRevision: number,
  state: Uint8Array,
): Promise<number> {
  requireIds(userId, connectionId);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new CryptoError('CORRUPT_STATE', 'expectedRevision must be a non-negative integer.');
  }
  if (!isUint8Array(state)) {
    throw new CryptoError('CORRUPT_STATE', 'Ratchet state must be a Uint8Array.');
  }

  const db = await openDatabase();
  try {
    // Single readwrite transaction: read-check-write is atomic with respect to
    // other transactions on this store, which is what makes the CAS sound.
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', {
      durability: 'strict',
    });
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const recordKey = ratchetKeyFor(userId, connectionId);
    const wmKey = watermarkKeyFor(userId, connectionId);

    const existing = await promisify(store.get(recordKey) as IDBRequest<unknown>);
    const wmRaw = await promisify(store.get(wmKey) as IDBRequest<unknown>);
    const watermark = typeof wmRaw === 'number' && Number.isInteger(wmRaw) && wmRaw >= 0 ? wmRaw : 0;

    let currentRevision = INITIAL_REVISION;
    if (existing !== undefined) {
      const validated = validateRecord(existing, userId, connectionId);
      if (!validated.ok) {
        transaction.abort();
        throw new CryptoError(
          validated.status === 'USER_MISMATCH' ? 'USER_MISMATCH' : 'CORRUPT_STATE',
          validated.status === 'USER_MISMATCH'
            ? 'Stored ratchet state belongs to a different user or connection.'
            : 'Stored ratchet state is corrupt; refusing to commit over it.',
        );
      }
      currentRevision = validated.record.revision;
    }

    if (currentRevision !== expectedRevision) {
      transaction.abort();
      throw new CryptoError(
        'REVISION_CONFLICT',
        `Ratchet revision conflict (stored=${currentRevision}, expected=${expectedRevision}).`,
      );
    }

    const nextRevision = expectedRevision + 1;

    // Defence in depth: even a caller that somehow presents a matching but
    // stale revision cannot land at or below the high-water mark.
    if (nextRevision <= watermark) {
      transaction.abort();
      throw new CryptoError(
        'ROLLBACK_DETECTED',
        `Refusing to commit revision ${nextRevision} at or below watermark ${watermark}.`,
      );
    }

    const record: PersistedRatchetState = {
      version: CRYPTO_STATE_VERSION,
      userId,
      connectionId,
      revision: nextRevision,
      // Copy so a later mutation of the caller's buffer cannot alter the
      // record that structured-clone will serialize.
      state: new Uint8Array(state),
      committedAt: Date.now(),
    };

    store.put(record, recordKey);
    store.put(nextRevision, wmKey);
    await txComplete(transaction);
    return nextRevision;
  } finally {
    db.close();
  }
}

/**
 * Explicitly attempt to restore a previously exported snapshot.
 *
 * This exists so that backup/restore has one auditable entry point rather than
 * ad-hoc writes. Restoring a snapshot that is not strictly newer than
 * everything ever committed is rejected — there is intentionally no "force"
 * flag, because a silent downgrade is precisely the failure this module exists
 * to prevent.
 */
export async function restoreRatchetSnapshot(
  userId: string,
  connectionId: string,
  snapshot: PersistedRatchetState,
): Promise<number> {
  requireIds(userId, connectionId);
  const validated = validateRecord(snapshot, userId, connectionId);
  if (!validated.ok) {
    throw new CryptoError(
      validated.status === 'USER_MISMATCH' ? 'USER_MISMATCH' : 'CORRUPT_STATE',
      'Snapshot is not a valid ratchet state record for this user/connection.',
    );
  }

  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', {
      durability: 'strict',
    });
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const wmKey = watermarkKeyFor(userId, connectionId);
    const wmRaw = await promisify(store.get(wmKey) as IDBRequest<unknown>);
    const watermark = typeof wmRaw === 'number' && Number.isInteger(wmRaw) && wmRaw >= 0 ? wmRaw : 0;

    if (validated.record.revision <= watermark) {
      transaction.abort();
      throw new CryptoError(
        'ROLLBACK_DETECTED',
        `Snapshot revision ${validated.record.revision} is not newer than watermark ${watermark}.`,
      );
    }

    store.put(
      { ...validated.record, state: new Uint8Array(validated.record.state) },
      ratchetKeyFor(userId, connectionId),
    );
    store.put(validated.record.revision, wmKey);
    await txComplete(transaction);
    return validated.record.revision;
  } finally {
    db.close();
  }
}

/**
 * Read the monotonic high-water mark for diagnostics.
 * Returns 0 when nothing was ever committed.
 */
export async function getRatchetWatermark(
  userId: string,
  connectionId: string,
): Promise<number> {
  requireIds(userId, connectionId);
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readonly');
    const raw = await promisify(
      transaction.objectStore(CRYPTO_STORE_RATCHET).get(watermarkKeyFor(userId, connectionId)) as IDBRequest<unknown>,
    );
    await txComplete(transaction);
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
  } finally {
    db.close();
  }
}

/**
 * Delete all ratchet state for a user (account deletion).
 *
 * The watermark is deleted together with the records. That is correct for
 * account deletion — the identity itself is going away — but it does mean a
 * deleted-then-recreated account starts from a clean slate. See the
 * limitations section of the hardening doc.
 */
export async function deleteUserRatchetState(userId: string): Promise<void> {
  if (!userId) return;
  if (typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', {
      durability: 'strict',
    });
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const prefix = ratchetUserPrefix(userId);
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
    });
    await txComplete(transaction);
  } finally {
    db.close();
  }
}
