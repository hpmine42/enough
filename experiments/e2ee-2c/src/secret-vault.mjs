// Isolated E2EE-2C architecture model — NOT production.
//
// Demonstrates the proposed secret-handling boundary:
//   - non-extractable AES-256-GCM wrapping key in IndexedDB
//   - opaque protocol records encrypted at rest
//   - atomic multi-store transactions (session + kyber usage + tombstones)
//   - monotonic revision anti-rollback
//
// This is not a Signal engine and must never be imported by src/.

export const VAULT_DB_NAME = 'enough-e2ee-2c-vault-experiment';
export const VAULT_DB_VERSION = 1;
export const STORE_META = 'meta';
export const STORE_VAULT = 'vault';
export const STORE_TOMBSTONES = 'tombstones';
export const STORE_REVISIONS = 'revisions';

export class VaultError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'VaultError';
    this.code = code;
  }
}

function assertCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new VaultError('NOT_AVAILABLE', 'Web Crypto API is not available.');
  }
  if (typeof indexedDB === 'undefined') {
    throw new VaultError('NOT_AVAILABLE', 'IndexedDB is not available.');
  }
}

function openDb() {
  assertCrypto();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      if (!db.objectStoreNames.contains(STORE_VAULT)) db.createObjectStore(STORE_VAULT);
      if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) db.createObjectStore(STORE_TOMBSTONES);
      if (!db.objectStoreNames.contains(STORE_REVISIONS)) db.createObjectStore(STORE_REVISIONS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new VaultError('STORAGE_ERROR', 'Failed to open vault database.'));
  });
}

function txComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new VaultError('STORAGE_ERROR', 'Vault transaction failed.'));
    transaction.onabort = () => reject(new VaultError('STORAGE_ERROR', 'Vault transaction aborted.'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new VaultError('STORAGE_ERROR'));
  });
}

export function wrappingKeyId(userId) {
  return `${userId}:wrapping-key`;
}

export function vaultKey(userId, recordKind, recordId = '') {
  return recordId ? `${userId}:${recordKind}:${recordId}` : `${userId}:${recordKind}`;
}

export async function generateWrappingKey() {
  assertCrypto();
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
  if (key.extractable) {
    throw new VaultError('CORRUPT_STATE', 'Wrapping key must not be extractable.');
  }
  return key;
}

export async function persistWrappingKey(userId, key) {
  if (!userId) throw new VaultError('NOT_INITIALIZED', 'userId is required.');
  if (!(key instanceof CryptoKey) || key.extractable) {
    throw new VaultError('CORRUPT_STATE', 'Refusing to persist an extractable wrapping key.');
  }
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_META, 'readwrite', { durability: 'strict' });
    transaction.objectStore(STORE_META).put(key, wrappingKeyId(userId));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

export async function loadWrappingKey(userId) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_META, 'readonly');
    const key = await requestToPromise(transaction.objectStore(STORE_META).get(wrappingKeyId(userId)));
    await txComplete(transaction);
    if (!key) return null;
    if (!(key instanceof CryptoKey) || key.extractable) {
      throw new VaultError('CORRUPT_STATE', 'Stored wrapping key is extractable or invalid.');
    }
    return key;
  } finally {
    db.close();
  }
}

/**
 * Encrypt an opaque protocol record.
 * AAD binds the record to userId + kind + id so a blob cannot be moved
 * across accounts or record slots without failing authentication.
 */
export async function wrapRecord(wrappingKey, plaintext, aadBytes) {
  if (!(plaintext instanceof Uint8Array)) {
    throw new VaultError('CRYPTO_ERROR', 'plaintext must be Uint8Array.');
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aadBytes },
      wrappingKey,
      plaintext,
    ),
  );
  return { iv, ciphertext };
}

export async function unwrapRecord(wrappingKey, blob, aadBytes) {
  const iv = blob.iv instanceof Uint8Array ? blob.iv : new Uint8Array(blob.iv);
  const ciphertext = blob.ciphertext instanceof Uint8Array ? blob.ciphertext : new Uint8Array(blob.ciphertext);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadBytes },
      wrappingKey,
      ciphertext,
    ),
  );
  return plaintext;
}

export function encodeAad(userId, kind, recordId) {
  return new TextEncoder().encode(`enough.e2ee.vault.v1|${userId}|${kind}|${recordId}`);
}

/**
 * Atomically persist a decrypt-side mutation:
 *   - new session record (encrypted)
 *   - kyber usage bytes (encrypted)
 *   - consumed prekey tombstone (id only, not secret)
 *   - monotonic session revision
 *
 * If any write fails, the whole transaction aborts.
 */
export async function commitDecryptMutation(userId, wrappingKey, mutation) {
  if (!userId) throw new VaultError('NOT_INITIALIZED', 'userId is required.');
  const {
    peerId,
    sessionBytes,
    kyberUsageBytes,
    consumedOtkId = null,
    consumedKyberId = null,
    expectedRevision,
  } = mutation;

  const sessionStoreKey = vaultKey(userId, 'session', peerId);
  const usageStoreKey = vaultKey(userId, 'kyber-usage');
  const revisionKey = vaultKey(userId, 'session-rev', peerId);

  // Wrap BEFORE opening the IDB transaction. Awaiting Web Crypto inside an
  // active transaction makes it inactive (IndexedDB auto-commit).
  const sessionBlob = await wrapRecord(
    wrappingKey,
    sessionBytes,
    encodeAad(userId, 'session', peerId),
  );
  const usageBlob = await wrapRecord(
    wrappingKey,
    kyberUsageBytes,
    encodeAad(userId, 'kyber-usage', ''),
  );

  const db = await openDb();
  try {
    const transaction = db.transaction(
      [STORE_VAULT, STORE_TOMBSTONES, STORE_REVISIONS],
      'readwrite',
      { durability: 'strict' },
    );
    const vault = transaction.objectStore(STORE_VAULT);
    const tombstones = transaction.objectStore(STORE_TOMBSTONES);
    const revisions = transaction.objectStore(STORE_REVISIONS);

    const currentRev = (await requestToPromise(revisions.get(revisionKey))) ?? 0;
    if (typeof expectedRevision === 'number' && currentRev !== expectedRevision) {
      transaction.abort();
      throw new VaultError(
        'REVISION_CONFLICT',
        `Session revision conflict: stored=${currentRev} expected=${expectedRevision}`,
      );
    }
    const nextRev = currentRev + 1;
    if (typeof mutation.minAcceptedRevision === 'number' && nextRev <= mutation.minAcceptedRevision) {
      transaction.abort();
      throw new VaultError('ROLLBACK_REJECTED', 'Refusing to persist an older session revision.');
    }

    vault.put({ ...sessionBlob, userId, kind: 'session', peerId, revision: nextRev }, sessionStoreKey);
    vault.put({ ...usageBlob, userId, kind: 'kyber-usage' }, usageStoreKey);
    revisions.put(nextRev, revisionKey);

    if (consumedOtkId != null) {
      tombstones.put(
        { userId, kind: 'otk', keyId: consumedOtkId, consumedAt: Date.now() },
        vaultKey(userId, 'otk-tombstone', String(consumedOtkId)),
      );
    }
    if (consumedKyberId != null) {
      tombstones.put(
        { userId, kind: 'kyber', keyId: consumedKyberId, consumedAt: Date.now() },
        vaultKey(userId, 'kyber-tombstone', String(consumedKyberId)),
      );
    }

    await txComplete(transaction);
    return nextRev;
  } finally {
    db.close();
  }
}

export async function loadSession(userId, wrappingKey, peerId) {
  const db = await openDb();
  try {
    const transaction = db.transaction([STORE_VAULT, STORE_REVISIONS], 'readonly');
    const blob = await requestToPromise(
      transaction.objectStore(STORE_VAULT).get(vaultKey(userId, 'session', peerId)),
    );
    const revision = (await requestToPromise(
      transaction.objectStore(STORE_REVISIONS).get(vaultKey(userId, 'session-rev', peerId)),
    )) ?? 0;
    await txComplete(transaction);
    if (!blob) return null;
    if (blob.userId !== userId) {
      throw new VaultError('USER_MISMATCH', 'Stored session belongs to a different user.');
    }
    const bytes = await unwrapRecord(wrappingKey, blob, encodeAad(userId, 'session', peerId));
    return { bytes, revision, blob };
  } finally {
    db.close();
  }
}

export async function hasTombstone(userId, kind, keyId) {
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_TOMBSTONES, 'readonly');
    const row = await requestToPromise(
      transaction.objectStore(STORE_TOMBSTONES).get(vaultKey(userId, `${kind}-tombstone`, String(keyId))),
    );
    await txComplete(transaction);
    return Boolean(row);
  } finally {
    db.close();
  }
}

/**
 * Simulate restoring an older encrypted session blob.
 * Production code must refuse this when the stored revision is newer.
 */
export async function attemptRollbackRestore(userId, wrappingKey, peerId, olderBlob, olderRevision) {
  const current = await loadSession(userId, wrappingKey, peerId);
  if (current && olderRevision < current.revision) {
    throw new VaultError('ROLLBACK_REJECTED', 'Older session backup must not overwrite a newer revision.');
  }
  const db = await openDb();
  try {
    const transaction = db.transaction([STORE_VAULT, STORE_REVISIONS], 'readwrite', { durability: 'strict' });
    transaction.objectStore(STORE_VAULT).put(olderBlob, vaultKey(userId, 'session', peerId));
    transaction.objectStore(STORE_REVISIONS).put(olderRevision, vaultKey(userId, 'session-rev', peerId));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

export async function deleteVaultDatabase() {
  if (typeof indexedDB === 'undefined') return;
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(VAULT_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
