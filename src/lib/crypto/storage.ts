// enough. E2EE — IndexedDB storage layer
// --------------------------------------------------------------
// All persistent cryptographic state is kept here.
// - NOT in React state / Context
// - NOT in localStorage
// - NOT in URL / cookies / window.name
//
// Storage is scoped per Supabase user id to isolate identities when
// multiple accounts share a single browser profile (logout + login as
// another user). Composite keys look like `${userId}:${key}`.
//
// Values are stored as structured-cloneable objects. `CryptoKey` instances
// are structured-cloneable in modern browsers, so non-extractable keys can
// be stored and retrieved directly. As a fallback for browsers where this
// fails, the identity module wraps keys with an AES-GCM wrap-key (also
// non-extractable) before storing raw wrapped bytes.

import { CryptoError } from './errors.ts';
import {
  CRYPTO_DB_NAME,
  CRYPTO_DB_VERSION,
  CRYPTO_STORE_PREKEYS,
  CRYPTO_STORE_RATCHET,
  CRYPTO_STORE_STATE,
  CRYPTO_STORE_VAULTKEYS,
  DEVICE_RECORD_PREFIX,
  OFFLINE_RECORD_PREFIX,
  RECORD_IDENTITY,
  RECORD_MESSAGE_CACHE,
  RECORD_SIGNED_PREKEY,
  RECORD_X25519_IDENTITY,
  prekeyCompositeKey,
  prekeyPrefix,
  sealingKeyFor,
  stateKeyFor,
} from './types.ts';

// Re-export key helpers and constants for tests.
export {
  CRYPTO_STORE_STATE,
  CRYPTO_STORE_PREKEYS,
  CRYPTO_STORE_RATCHET,
  CRYPTO_STORE_VAULTKEYS,
  stateKeyFor,
  prekeyCompositeKey,
  prekeyPrefix,
  sealingKeyFor,
};

/** A handle to an opened IndexedDB database. */
type DbHandle = IDBDatabase;

/**
 * Check if the browser environment supports what we need.
 * Throws NOT_AVAILABLE on failure.
 */
export function assertCryptoEnvironment(): void {
  if (typeof indexedDB === 'undefined') {
    throw new CryptoError(
      'NOT_AVAILABLE',
      'IndexedDB is not available in this browser.',
    );
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new CryptoError(
      'NOT_AVAILABLE',
      'Web Crypto API is not available in this browser context.',
    );
  }
}

/**
 * Open (and if needed create/upgrade) the crypto IndexedDB.
 * Only public for testing; other modules should use the higher-level
 * helpers below.
 */
export function openDatabase(): Promise<DbHandle> {
  assertCryptoEnvironment();
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(CRYPTO_DB_NAME, CRYPTO_DB_VERSION);
    } catch (e) {
      reject(new CryptoError('STORAGE_ERROR', 'Failed to open crypto database.', e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CRYPTO_STORE_STATE)) {
        // Keyed by string (composite userId:recordKey)
        db.createObjectStore(CRYPTO_STORE_STATE);
      }
      if (!db.objectStoreNames.contains(CRYPTO_STORE_PREKEYS)) {
        // Keyed by composite string `${userId}:${keyId}`. We do not use a
        // keyPath because the "primary key" is a composite and we want to
        // be able to prefix-scan by userId for bulk deletion.
        db.createObjectStore(CRYPTO_STORE_PREKEYS);
      }
      // E2EE-2D (DB version 2). Additive: created if absent, so upgrading
      // from version 1 preserves existing identities and prekeys.
      if (!db.objectStoreNames.contains(CRYPTO_STORE_RATCHET)) {
        db.createObjectStore(CRYPTO_STORE_RATCHET);
      }
      // E2EE-2D.2 (DB version 3). Also additive. No data is rewritten here,
      // and none needs to be: version 2 was never released, so no stored
      // ratchet record predates the sealed envelope format.
      if (!db.objectStoreNames.contains(CRYPTO_STORE_VAULTKEYS)) {
        db.createObjectStore(CRYPTO_STORE_VAULTKEYS);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app in another tab must not be blocked forever
      // by this connection. Close immediately, mark the context obsolete, and
      // let the app decide to reload. Holding the connection open would leave
      // the other tab's `onblocked` hanging; ignoring the event and carrying
      // on would mean operating against a schema version we no longer match.
      db.onversionchange = () => {
        schemaObsolete = true;
        try {
          db.close();
        } catch {
          /* already closing */
        }
        notifySchemaObsolete();
      };
      resolve(db);
    };
    req.onerror = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Failed to open crypto database.', req.error));
    req.onblocked = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Crypto database is blocked by another tab.'));
  });
}

/* ------------------------------------------------------------------ */
/* Schema-obsolescence signalling (E2EE-2D.2)                          */
/* ------------------------------------------------------------------ */

/**
 * Set once any connection of this JS context received `versionchange`, i.e.
 * another tab is upgrading the crypto database.
 *
 * This is a one-way latch on purpose. Once another context has moved the
 * schema forward, nothing this context believes about the layout is reliable
 * any more, and "it seemed to work afterwards" is not a safety argument.
 */
let schemaObsolete = false;
const schemaObsoleteListeners = new Set<() => void>();

function notifySchemaObsolete(): void {
  for (const listener of schemaObsoleteListeners) {
    try {
      listener();
    } catch {
      /* a listener must never break storage teardown */
    }
  }
}

/** True when another tab upgraded the crypto DB and this context must reload. */
export function isSchemaObsolete(): boolean {
  return schemaObsolete;
}

/**
 * Subscribe to the obsolescence latch. The app layer uses this to surface a
 * "reload required" state. Returns an unsubscribe function; fires immediately
 * if the latch is already set.
 */
export function onSchemaObsolete(listener: () => void): () => void {
  schemaObsoleteListeners.add(listener);
  if (schemaObsolete) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
  return () => schemaObsoleteListeners.delete(listener);
}

/** Test-only: clear the latch between cases. */
export function _resetSchemaObsoleteForTests(): void {
  schemaObsolete = false;
  schemaObsoleteListeners.clear();
}

function tx(
  db: DbHandle,
  stores: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(stores, mode, { durability: 'strict' });
}

export function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
  });
}

export function txComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Crypto storage transaction failed.', transaction.error));
    transaction.onabort = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Crypto storage transaction aborted.', transaction.error));
  });
}

/** Write a singleton value scoped to `userId` and `recordKey`. */
export async function putState<T>(userId: string, recordKey: string, value: T): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_STATE, 'readwrite');
    transaction.objectStore(CRYPTO_STORE_STATE).put(value, stateKeyFor(userId, recordKey));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

/** Read a singleton value scoped to `userId`; returns undefined if missing. */
export async function getState<T>(userId: string, recordKey: string): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_STATE, 'readonly');
    const value = await promisifyRequest<T | undefined>(
      transaction.objectStore(CRYPTO_STORE_STATE).get(stateKeyFor(userId, recordKey)) as IDBRequest<T | undefined>,
    );
    await txComplete(transaction);
    return value;
  } finally {
    db.close();
  }
}

/** Delete a singleton value. */
export async function deleteState(userId: string, recordKey: string): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_STATE, 'readwrite');
    transaction.objectStore(CRYPTO_STORE_STATE).delete(stateKeyFor(userId, recordKey));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

export interface StoredPreKey {
  /** Supabase user id this prekey belongs to (prevents cross-user reuse). */
  userId: string;
  /** Numeric prekey id (scoped to the user). */
  keyId: number;
  /** Public key raw bytes (Uint8Array) — 32 bytes X25519 */
  publicKeyBytes: Uint8Array;
  /**
   * Private key. Either a non-extractable CryptoKey directly or a wrapped
   * form. NEVER a plaintext string or JS number.
   */
  privateKey: CryptoKey | { wrapped: Uint8Array };
  createdAt: number;
}

/** Store a one-time prekey for a given user. */
export async function putPreKey(record: StoredPreKey): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_PREKEYS, 'readwrite');
    transaction.objectStore(CRYPTO_STORE_PREKEYS).put(record, prekeyCompositeKey(record.userId, record.keyId));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

/** Retrieve a single one-time prekey. */
export async function getPreKey(userId: string, keyId: number): Promise<StoredPreKey | undefined> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_PREKEYS, 'readonly');
    const value = await promisifyRequest<StoredPreKey | undefined>(
      transaction.objectStore(CRYPTO_STORE_PREKEYS).get(prekeyCompositeKey(userId, keyId)) as IDBRequest<StoredPreKey | undefined>,
    );
    await txComplete(transaction);
    return value;
  } finally {
    db.close();
  }
}

/** Retrieve all one-time prekeys for a given user (prefix scan). */
export async function listPreKeys(userId: string): Promise<StoredPreKey[]> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_PREKEYS, 'readonly');
    const store = transaction.objectStore(CRYPTO_STORE_PREKEYS);
    const range = IDBKeyRange.bound(prekeyPrefix(userId), prekeyPrefix(userId) + '\uffff', false, false);
    return new Promise<StoredPreKey[]>((resolve, reject) => {
      const results: StoredPreKey[] = [];
      const request = store.openCursor(range);
      request.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, request.error));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const v = cursor.value as StoredPreKey;
          // Defensive: only include records whose userId matches
          if (v && v.userId === userId) results.push(v);
          cursor.continue();
        } else {
          txComplete(transaction).then(() => resolve(results), reject);
        }
      };
    });
  } finally {
    db.close();
  }
}

/** Delete a single one-time prekey. */
export async function deletePreKey(userId: string, keyId: number): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_PREKEYS, 'readwrite');
    transaction.objectStore(CRYPTO_STORE_PREKEYS).delete(prekeyCompositeKey(userId, keyId));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

/** Count of one-time prekeys for a user. */
export async function countPreKeys(userId: string): Promise<number> {
  const all = await listPreKeys(userId);
  return all.length;
}

/**
 * The single definition of "erase this user's sealing key".
 *
 * It takes an existing transaction so that the two callers cannot drift apart:
 * `deleteUserCryptoState` needs the delete to be part of its atomic
 * multi-store transaction, while `deleteSealingKey` wraps it in a transaction
 * of its own. Both erase exactly the same key with the same semantics.
 *
 * The caller owns the transaction and must await its completion.
 */
function deleteSealingKeyIn(transaction: IDBTransaction, userId: string): void {
  transaction.objectStore(CRYPTO_STORE_VAULTKEYS).delete(sealingKeyFor(userId));
}

/**
 * Delete a user's sealing key on its own.
 *
 * Same semantics as the sealing-key step of `deleteUserCryptoState`, because
 * it is literally the same code.
 */
export async function deleteSealingKey(userId: string): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  try {
    const transaction = tx(db, CRYPTO_STORE_VAULTKEYS, 'readwrite');
    deleteSealingKeyIn(transaction, userId);
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

/**
 * Delete ALL crypto state for a specific user (identity, signed prekey,
 * one-time prekeys). Called on account deletion to ensure no orphaned
 * identity remains on the device.
 *
 * Note: this is distinct from logout — logout intentionally keeps the
 * identity so the user can sign back in to the same device identity.
 */
export async function deleteUserCryptoState(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  try {
    const transaction = tx(
      db,
      [CRYPTO_STORE_STATE, CRYPTO_STORE_PREKEYS, CRYPTO_STORE_RATCHET, CRYPTO_STORE_VAULTKEYS],
      'readwrite',
    );
    const stateStore = transaction.objectStore(CRYPTO_STORE_STATE);
    for (const rec of [RECORD_IDENTITY, RECORD_SIGNED_PREKEY, RECORD_X25519_IDENTITY, RECORD_MESSAGE_CACHE]) {
      stateStore.delete(stateKeyFor(userId, rec));
    }
    // E2EE-v0.2: wipe Signal device-store records (identity, signed prekey,
    // one-time/kyber prekeys, kyber usage) stored under `${userId}:signal:`.
    // They live in this same store, so they go in the same atomic transaction.
    // The sealing key is deleted further below, so any record that somehow
    // survived would already be unreadable — wiping the rows is defence in
    // depth and keeps the prefix clean for a recreated account.
    // Offline Read Mode snapshots (`${userId}:offline:...`) are wiped by the
    // same mechanism: they are sealed under the sealing key deleted below,
    // but the rows go too so a recreated account starts clean.
    for (const prefix of [DEVICE_RECORD_PREFIX, OFFLINE_RECORD_PREFIX]) {
      const prefixRange = IDBKeyRange.bound(
        `${userId}:${prefix}`,
        `${userId}:${prefix}\uffff`,
        false,
        false,
      );
      await new Promise<void>((resolve, reject) => {
        const req = stateStore.openCursor(prefixRange);
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
    }
    // Prefix-delete all prekeys for this user.
    const prekeyStore = transaction.objectStore(CRYPTO_STORE_PREKEYS);
    const range = IDBKeyRange.bound(prekeyPrefix(userId), prekeyPrefix(userId) + '\uffff', false, false);
    await new Promise<void>((resolve, reject) => {
      const req = prekeyStore.openCursor(range);
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
    // E2EE-2D: ratchet state and its watermarks must go too. Leaving them
    // behind would let a recreated account inherit a stale session state.
    // Both live under the `${userId}:` prefix, so one cursor covers them.
    const ratchetStore = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const ratchetRange = IDBKeyRange.bound(
      prekeyPrefix(userId),
      prekeyPrefix(userId) + '\uffff',
      false,
      false,
    );
    await new Promise<void>((resolve, reject) => {
      const req = ratchetStore.openCursor(ratchetRange);
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
    // E2EE-2D.2: the per-user sealing key must go with the data it sealed.
    // Leaving it behind would keep a key alive for envelopes that no longer
    // exist, and a recreated account would inherit it. This runs inside the
    // same transaction as the state/prekey/ratchet deletes, so the key can
    // never outlive the data by a partial commit.
    deleteSealingKeyIn(transaction, userId);
    await txComplete(transaction);
  } finally {
    db.close();
  }
  // Persistent state is gone; now drop every in-memory copy. Without this a
  // still-running tab keeps serving the deleted identity out of its caches,
  // and `hasIdentity()` keeps returning true after account deletion.
  resetInMemoryCaches(userId);
}

/* ------------------------------------------------------------------ */
/* In-memory cache invalidation (E2EE-2D.2)                            */
/* ------------------------------------------------------------------ */

type CacheResetter = (userId: string) => void;
const cacheResetters = new Set<CacheResetter>();

/**
 * Register an in-memory cache so account deletion can clear it.
 *
 * Inversion of control is used here to avoid an import cycle: `identity.ts`
 * and `keys.ts` already import this module, so this module cannot import
 * them. They register their caches at load time instead.
 */
export function registerCacheResetter(fn: CacheResetter): void {
  cacheResetters.add(fn);
}

/** Clear every registered in-memory cache for one user. */
export function resetInMemoryCaches(userId: string): void {
  for (const reset of cacheResetters) {
    try {
      reset(userId);
    } catch {
      /* a cache that fails to clear must not abort the others */
    }
  }
}

/**
 * Delete the entire crypto database. Intended for tests and for a future
 * full reset; prefer deleteUserCryptoState for normal account deletion.
 */
export async function deleteCryptoDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(CRYPTO_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

