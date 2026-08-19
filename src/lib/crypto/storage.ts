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
  CRYPTO_STORE_STATE,
  RECORD_IDENTITY,
  RECORD_SIGNED_PREKEY,
  RECORD_X25519_IDENTITY,
  prekeyCompositeKey,
  prekeyPrefix,
  stateKeyFor,
} from './types.ts';

// Re-export key helpers and constants for tests.
export {
  CRYPTO_STORE_STATE,
  CRYPTO_STORE_PREKEYS,
  stateKeyFor,
  prekeyCompositeKey,
  prekeyPrefix,
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Failed to open crypto database.', req.error));
    req.onblocked = () =>
      reject(new CryptoError('STORAGE_ERROR', 'Crypto database is blocked by another tab.'));
  });
}

function tx(
  db: DbHandle,
  stores: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(stores, mode, { durability: 'strict' });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new CryptoError('STORAGE_ERROR', undefined, req.error));
  });
}

function txComplete(transaction: IDBTransaction): Promise<void> {
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
      [CRYPTO_STORE_STATE, CRYPTO_STORE_PREKEYS],
      'readwrite',
    );
    const stateStore = transaction.objectStore(CRYPTO_STORE_STATE);
    for (const rec of [RECORD_IDENTITY, RECORD_SIGNED_PREKEY, RECORD_X25519_IDENTITY]) {
      stateStore.delete(stateKeyFor(userId, rec));
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
    await txComplete(transaction);
  } finally {
    db.close();
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

