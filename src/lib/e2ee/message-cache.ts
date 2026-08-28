// enough. E2EE-v0.2 — sealed local message cache (audit finding F6).
// ---------------------------------------------------------------------------
// WHAT THIS IS
//   A secure, encrypted local persistence layer for message plaintext.
//   The Signal engine cannot decrypt a message it sent (the sending chain's
//   keys are consumed), and re-decrypting an old received message fails once
//   the ratchet has advanced past it (skipped-message-key window). Every E2EE
//   messenger therefore keeps message plaintext in a LOCAL store for display
//   and stores only ciphertext on the server.
//
// WHAT F6 REMEDIATES
//   Prior to F6, the local message cache stored plain, unencrypted JSON
//   directly in `window.localStorage` under `enough-msgplain-<userId>`.
//   This exposed sensitive message plaintext to anyone with physical or
//   storage access to the device and to other accounts sharing the browser
//   profile.
//
// SECURITY BOUNDARY & ARCHITECTURE
//   * LOCAL ONLY. The contents never leave the browser or reach Supabase.
//   * NO PLAINTEXT PERSISTENCE. Message plaintexts are AES-256-GCM sealed
//     before being persisted to client storage.
//   * Same sealing KEY as the ratchet state and device store: the per-user
//     non-extractable AES-GCM-256 key from `sealed-state.ts` (stored in the
//     `vaultkeys` store of `enough-crypto`). There is NO second wrapping key
//     and NO static or predictable key derivation.
//   * Same IndexedDB DATABASE (`enough-crypto`) and same `state` object store
//     via `storage.ts`, stored under composite key `${userId}:msgcache`.
//   * AEAD authentication: every envelope's tag authenticates an injective AAD
//     bound to `userId` (`enough.e2ee.cache.v1|<userId>`). Moving an envelope
//     between users or modifying header fields breaks tag verification.
//   * Fresh 12-byte random IV drawn for every seal.
//   * Fail-closed: missing keys, corrupted envelopes, or tampered bytes fail
//     closed (return null to UI, never return plaintext).
//   * Account deletion: `deleteUserCryptoState(userId)` atomically wipes the
//     sealed cache record and the sealing key in one IndexedDB transaction.
//   * Migration & legacy hygiene: any pre-F6 plaintext stored in
//     `localStorage` under `enough-msgplain-<userId>` is migrated into the
//     sealed store on first load and permanently removed immediately.
//
// NO OWN CRYPTOGRAPHY. AES-GCM and key generation come from WebCrypto.

import { CryptoError } from '../crypto/errors.ts';
import {
  ensureSealingKey,
  loadSealingKey,
} from '../crypto/sealed-state.ts';
import {
  deleteState,
  getState,
  putState,
  registerCacheResetter,
} from '../crypto/storage.ts';
import { toBufferSource } from '../crypto/serialization.ts';
import { RECORD_MESSAGE_CACHE } from '../crypto/types.ts';

/** Format version of a sealed message-cache envelope. Part of the AAD. */
export const CACHE_ENVELOPE_VERSION = 1;

/** Prefix of the message-cache AEAD additional-data string. Part of the AAD. */
export const CACHE_AAD_PREFIX = 'enough.e2ee.cache.v1';

/** AES-GCM nonce length in bytes. */
export const CACHE_IV_BYTES = 12;

/** Minimum length of a sealed body: the AES-GCM authentication tag. */
const TAG_BYTES = 16;

/** Legacy localStorage prefix from pre-F6 unencrypted cache. Cleaned on load. */
const LEGACY_STORAGE_PREFIX = 'enough-msgplain-';

/**
 * A sealed message-cache record as it lives in IndexedDB (`enough-crypto`'s
 * `state` store under `${userId}:msgcache`).
 */
export interface CachedMessageEnvelope {
  /** Format version. Part of the AAD. */
  v: number;
  /** Owning Supabase user id. Part of the AAD. */
  userId: string;
  /** AES-GCM nonce, 12 random bytes, fresh for every seal. */
  iv: Uint8Array;
  /** AES-GCM ciphertext of the JSON serialized plaintext map, tag appended. */
  sealed: Uint8Array;
  /** Unix millis of the commit. Diagnostics only. */
  updatedAt: number;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Build the AEAD additional data for a user's message cache.
 * Injective encoding: fixed versioned prefix + '|' separator + userId.
 */
export function buildCacheAad(userId: string): Uint8Array {
  if (!userId) {
    throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  }
  if (userId.includes('|')) {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Identifiers must not contain the AAD separator.',
    );
  }
  return utf8(`${CACHE_AAD_PREFIX}|${userId}`);
}

/** Structural check of a cache envelope read back from storage. */
export function isCacheEnvelope(value: unknown): value is CachedMessageEnvelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<CachedMessageEnvelope>;
  return (
    typeof e.v === 'number' &&
    typeof e.userId === 'string' &&
    e.iv instanceof Uint8Array &&
    e.sealed instanceof Uint8Array
  );
}

/** Require the per-user sealing key, failing closed when it is gone. */
async function requireSealingKey(userId: string): Promise<CryptoKey> {
  const key = await loadSealingKey(userId);
  if (!key) {
    throw new CryptoError(
      'KEY_MISSING',
      'The local sealing key is unavailable; cached messages cannot be read.',
    );
  }
  return key;
}

/**
 * Seal message plaintexts into an authenticated envelope using the user's
 * non-extractable AES-GCM sealing key.
 */
export async function sealCache(
  key: CryptoKey,
  userId: string,
  data: Record<string, string>,
): Promise<CachedMessageEnvelope> {
  if (!userId) {
    throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  }
  const aad = buildCacheAad(userId);
  const iv = crypto.getRandomValues(new Uint8Array(CACHE_IV_BYTES));
  const plaintextBytes = utf8(JSON.stringify(data));
  let sealed: ArrayBuffer;
  try {
    sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: toBufferSource(aad) },
      key,
      toBufferSource(plaintextBytes),
    );
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'Sealing the message cache failed.', e);
  }
  return {
    v: CACHE_ENVELOPE_VERSION,
    userId,
    iv,
    sealed: new Uint8Array(sealed),
    updatedAt: Date.now(),
  };
}

/**
 * Authenticate and decrypt a message-cache envelope.
 *
 * Throws CryptoError on failure:
 * - `CORRUPT_STATE` on malformed shape, bad version, or bad IV length.
 * - `USER_MISMATCH` if envelope header doesn't match expected user.
 * - `UNSEAL_FAILED` if AES-GCM authentication tag check fails.
 * - `DESERIALIZATION_ERROR` if decrypted bytes are not valid JSON.
 */
export async function unsealCache(
  key: CryptoKey,
  envelope: unknown,
  expectedUserId: string,
): Promise<Record<string, string>> {
  if (!expectedUserId) {
    throw new CryptoError('NOT_INITIALIZED', 'expectedUserId is required.');
  }
  if (!isCacheEnvelope(envelope)) {
    throw new CryptoError('CORRUPT_STATE', 'Stored message cache is malformed.');
  }
  if (envelope.v !== CACHE_ENVELOPE_VERSION) {
    throw new CryptoError('CORRUPT_STATE', 'Message cache has an unsupported version.');
  }
  if (envelope.iv.length !== CACHE_IV_BYTES || envelope.sealed.length < TAG_BYTES) {
    throw new CryptoError('CORRUPT_STATE', 'Stored message cache is malformed.');
  }
  if (envelope.userId !== expectedUserId) {
    throw new CryptoError(
      'USER_MISMATCH',
      'Message cache does not belong to the expected user.',
    );
  }

  const aad = buildCacheAad(envelope.userId);
  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBufferSource(envelope.iv), additionalData: toBufferSource(aad) },
      key,
      toBufferSource(envelope.sealed),
    );
  } catch {
    throw new CryptoError('UNSEAL_FAILED', 'Message cache failed authentication.');
  }

  try {
    const raw = new TextDecoder().decode(plaintextBuffer);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Decrypted cache is not an object.');
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch (e) {
    throw new CryptoError(
      'DESERIALIZATION_ERROR',
      'Failed to deserialize cached messages.',
      e,
    );
  }
}

/* ------------------------------------------------------------------ */
/* In-memory cache & synchronization                                   */
/* ------------------------------------------------------------------ */

// Per-user decrypted in-memory map: userId -> (messageId -> plaintext)
const inMemoryCache = new Map<string, Map<string, string>>();
// Pending/completed storage hydration promises: userId -> Promise<void>
const loadPromises = new Map<string, Promise<void>>();
// Serialization queue for persistent writes: userId -> Promise<void>
const writeQueues = new Map<string, Promise<void>>();

// Register with storage.ts so account deletion atomically clears memory too
registerCacheResetter((userId: string) => {
  inMemoryCache.delete(userId);
  loadPromises.delete(userId);
  writeQueues.delete(userId);
  cleanLegacyPlaintext(userId);
});

/** Test-only: reset all in-memory message cache state between cases. */
export function _resetMessageCacheForTests(): void {
  inMemoryCache.clear();
  loadPromises.clear();
  writeQueues.clear();
}

/** Permanently remove any legacy unencrypted plaintext from localStorage. */
function cleanLegacyPlaintext(userId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}

/** Read legacy unencrypted plaintext from pre-F6 localStorage for migration. */
function readLegacyPlaintext(userId: string): Record<string, string> | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Load and unseal the message cache from IndexedDB into memory.
 * If legacy unencrypted plaintext is found in localStorage, migrate it into
 * the sealed store and delete it from localStorage immediately.
 */
async function loadFromStorage(userId: string): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;

  try {
    const raw = await getState<unknown>(userId, RECORD_MESSAGE_CACHE);
    if (raw) {
      // Sealed envelope found in IndexedDB; clean up any legacy copy.
      cleanLegacyPlaintext(userId);
      const key = await requireSealingKey(userId);
      const map = await unsealCache(key, raw, userId);
      let userMap = inMemoryCache.get(userId);
      if (!userMap) {
        userMap = new Map();
        inMemoryCache.set(userId, userMap);
      }
      for (const [k, v] of Object.entries(map)) {
        if (!userMap.has(k)) {
          userMap.set(k, v);
        }
      }
      return;
    }
  } catch {
    // If loading or unsealing fails (tampered, corrupted, or key missing),
    // fail closed: do not populate in-memory cache with unverified data.
    cleanLegacyPlaintext(userId);
    if (!inMemoryCache.has(userId)) {
      inMemoryCache.set(userId, new Map());
    }
    return;
  }

  // No sealed envelope exists yet; check for pre-F6 legacy localStorage cache.
  const legacy = readLegacyPlaintext(userId);
  cleanLegacyPlaintext(userId); // Always wipe plaintext from localStorage immediately!
  if (legacy) {
    let userMap = inMemoryCache.get(userId);
    if (!userMap) {
      userMap = new Map();
      inMemoryCache.set(userId, userMap);
    }
    for (const [k, v] of Object.entries(legacy)) {
      if (!userMap.has(k)) {
        userMap.set(k, v);
      }
    }
    try {
      const key = await ensureSealingKey(userId);
      const envelope = await sealCache(key, userId, legacy);
      await putState(userId, RECORD_MESSAGE_CACHE, envelope);
    } catch {
      /* best-effort initial migration */
    }
  } else {
    if (!inMemoryCache.has(userId)) {
      inMemoryCache.set(userId, new Map());
    }
  }
}

/** Ensure the user's sealed cache has been hydrated from storage. */
function ensureLoaded(userId: string): Promise<void> {
  let p = loadPromises.get(userId);
  if (!p) {
    p = loadFromStorage(userId);
    loadPromises.set(userId, p);
  }
  return p;
}

/**
 * Persist the current in-memory map as an AES-GCM sealed envelope in
 * `enough-crypto`'s `state` store.
 */
async function persistSnapshot(userId: string): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  cleanLegacyPlaintext(userId);
  const currentMap = inMemoryCache.get(userId);
  if (!currentMap) return;

  const snapshot: Record<string, string> = {};
  for (const [k, v] of currentMap.entries()) {
    snapshot[k] = v;
  }

  const key = await ensureSealingKey(userId);
  const envelope = await sealCache(key, userId, snapshot);
  await putState(userId, RECORD_MESSAGE_CACHE, envelope);
}

/**
 * Queue a persistent write operation so rapid concurrent calls serialize
 * cleanly and seal the latest snapshot.
 */
function queuePersist(userId: string): Promise<void> {
  const prev = writeQueues.get(userId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => persistSnapshot(userId));
  writeQueues.set(userId, next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Pre-warm the in-memory cache for a user by loading and unsealing the
 * persistent envelope from IndexedDB. Called by Home on load.
 */
export async function warmMessageCache(userId: string): Promise<void> {
  if (!userId) return;
  await ensureLoaded(userId);
}

/**
 * Get the cached display plaintext for a message (asynchronous).
 * Unseals from IndexedDB if not yet present in memory. Returns null if
 * absent, unsealing fails, or key is missing (fail-closed).
 */
export async function getCachedPlaintext(
  userId: string,
  messageId: string,
): Promise<string | null> {
  if (!userId || !messageId) return null;
  const userMap = inMemoryCache.get(userId);
  if (userMap && userMap.has(messageId)) {
    return userMap.get(messageId) ?? null;
  }
  await ensureLoaded(userId);
  return inMemoryCache.get(userId)?.get(messageId) ?? null;
}

/**
 * Synchronous read from the in-memory cache. Used by synchronous UI render
 * paths (such as Home message preview) when the cache has already been
 * hydrated or written to in the current session. Returns null if not in memory.
 */
export function getCachedPlaintextSync(
  userId: string,
  messageId: string,
): string | null {
  if (!userId || !messageId) return null;
  return inMemoryCache.get(userId)?.get(messageId) ?? null;
}

/**
 * Cache the plaintext for a message (sent or decrypted).
 * Immediately updates the in-memory cache for synchronous reads, and
 * serializes a sealed write to IndexedDB under the user's sealing key.
 */
export async function cachePlaintext(
  userId: string,
  messageId: string,
  plaintext: string,
): Promise<void> {
  if (!userId || !messageId) return;
  let userMap = inMemoryCache.get(userId);
  if (!userMap) {
    userMap = new Map();
    inMemoryCache.set(userId, userMap);
  }
  userMap.set(messageId, plaintext);
  await queuePersist(userId);
}

/**
 * Cache many plaintexts at once (batch decrypt).
 * Immediately updates in-memory cache and persists the sealed envelope.
 */
export async function cacheManyPlaintext(
  userId: string,
  entries: Array<{ messageId: string; plaintext: string }>,
): Promise<void> {
  if (!userId || entries.length === 0) return;
  let userMap = inMemoryCache.get(userId);
  if (!userMap) {
    userMap = new Map();
    inMemoryCache.set(userId, userMap);
  }
  for (const { messageId, plaintext } of entries) {
    if (messageId) userMap.set(messageId, plaintext);
  }
  await queuePersist(userId);
}

/**
 * Remove the whole message cache for a user (account deletion or targeted wipe).
 * Removes the sealed record from IndexedDB, drops in-memory state, and cleans
 * any legacy plaintext.
 */
export async function clearMessageCache(userId: string): Promise<void> {
  if (!userId) return;
  inMemoryCache.delete(userId);
  loadPromises.delete(userId);
  writeQueues.delete(userId);
  cleanLegacyPlaintext(userId);
  if (typeof indexedDB !== 'undefined') {
    try {
      await deleteState(userId, RECORD_MESSAGE_CACHE);
    } catch {
      /* ignore */
    }
  }
}
