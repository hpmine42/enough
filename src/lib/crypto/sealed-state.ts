// enough. E2EE — sealed ratchet-state envelope (E2EE-2D.2, Stage 4)
// ---------------------------------------------------------------------------
// WHAT THIS CLOSES
//
// In E2EE-2D the revision was a plain number sitting next to the state bytes
// in an IndexedDB record. Nothing tied the two together, so anyone able to
// write to IndexedDB could take a genuine OLD state blob, stamp a HIGH
// revision onto it, and have it accepted as current (audit finding C-2).
// The same gap allowed state substitution (swap the bytes, keep the revision)
// and cross-binding (move a record between users or connections).
//
// The fix is to make the header *unforgeable relative to the ciphertext*:
// every field that describes the state is placed in the AEAD additional data,
// and the state bytes are the AEAD plaintext. One key, one tag, one atomic
// authentication decision. Editing any header field — version, userId,
// connectionId, epoch, revision — changes the AAD, so the tag no longer
// verifies and the record is rejected.
//
//   AAD    = "enough.e2ee.ratchet.v3|<userId>|<connectionId>|<epochHex>|<revHex>"
//   sealed = AES-GCM(sealingKey, stateBytes, AAD)
//
// PRECISE STATEMENT OF THE GUARANTEE — verified, not assumed
//
// Unsealing succeeds only if the (version, userId, connectionId, epoch,
// revision) tuple in the header is EXACTLY the one the writer sealed under.
// Moving a state blob to a different revision, user, connection or epoch is
// therefore rejected.
//
// It does NOT make a ciphertext unique *within* one tuple: two envelopes
// sealed for the same tuple under the same key are both genuine and their
// (iv, sealed) pairs are interchangeable. This is inherent to AEAD, not a
// defect here, and it is harmless in this design for a structural reason:
// `commitRatchetState` seals before opening its write transaction and discards
// the envelope if the compare-and-swap loses, so at most one envelope per
// (epoch, revision) slot ever reaches storage. Test `S10b` pins this exact
// boundary so it cannot quietly be restated as a stronger claim.
//
// WHAT THIS DOES *NOT* CLOSE — stated plainly so nobody reads more into it
//
// This is a local integrity binding, not a freshness anchor. An attacker or a
// backup restore that rolls the WHOLE origin back to an earlier point in time
// gets a genuinely sealed, genuinely self-consistent old envelope together
// with the matching old watermark and the same sealing key. Every check in
// this file passes. That is audit finding C-1, and it is deliberately still
// open at the end of E2EE-2D.2: detecting it requires a monotonic counter that
// does not live in the same storage as the state (a server-side epoch).
// The `epoch` field is wired through the AAD *now* so that anchoring it later
// is a value change rather than a format change. Until then the local epoch
// only distinguishes session generations on this device.
//
// NO OWN CRYPTOGRAPHY. AES-GCM and the key generation come from WebCrypto.
// This module composes them; it does not implement them.

import { CryptoError } from './errors.ts';
import {
  CRYPTO_STORE_VAULTKEYS,
  SEALED_ENVELOPE_VERSION,
  sealingKeyFor,
} from './types.ts';
import { openDatabase, promisifyRequest, txComplete } from './storage.ts';
import { encodeRevision, decodeRevision, revisionToHex } from './revision.ts';
import { toBufferSource } from './serialization.ts';

/** AES-GCM nonce length in bytes. 96 bits is the value GCM is specified for. */
export const IV_BYTES = 12;

/** Prefix of the additional-data string. Bound into every envelope. */
export const AAD_PREFIX = 'enough.e2ee.ratchet.v3';

/**
 * A sealed ratchet-state record as it lives in IndexedDB.
 *
 * The header fields are stored in the clear so they can be read for routing
 * and diagnostics without a key — but they are NOT trusted until `unseal()`
 * confirms them against the tag. Treat every field of a freshly read envelope
 * as attacker-controlled until then.
 */
export interface SealedEnvelope {
  /** Envelope format version. Part of the AAD. */
  version: number;
  /** Owning Supabase user id. Part of the AAD. */
  userId: string;
  /** Owning connection id. Part of the AAD. */
  connectionId: string;
  /** Session generation, canonical uint64 encoding. Part of the AAD. */
  epoch: Uint8Array;
  /** Monotonic revision, canonical uint64 encoding. Part of the AAD. */
  revision: Uint8Array;
  /** AES-GCM nonce, 12 random bytes, fresh for every seal. */
  iv: Uint8Array;
  /** AES-GCM ciphertext of the opaque engine state, tag appended. */
  sealed: Uint8Array;
  /** Unix millis of the commit. NOT authenticated — diagnostics only. */
  committedAt: number;
}

/** The decrypted, authenticated contents of an envelope. */
export interface UnsealedState {
  userId: string;
  connectionId: string;
  epoch: bigint;
  revision: bigint;
  state: Uint8Array;
  committedAt: number;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Build the AEAD additional data for one (user, connection, epoch, revision).
 *
 * Encoding rules, chosen so the mapping value → AAD string is injective:
 *   * fixed prefix carrying the format version,
 *   * `|` separator, which cannot occur in a UUID,
 *   * epoch and revision as fixed-width 16-char lowercase hex, so there is
 *     exactly one spelling of every number (no leading-zero ambiguity, no
 *     locale formatting, no bigint-to-string variance),
 *   * UTF-8 encoding of the result.
 *
 * `userId` and `connectionId` are rejected if they contain `|`, because that
 * would let two different (user, connection) pairs produce the same AAD.
 */
export function buildAad(
  userId: string,
  connectionId: string,
  epoch: bigint,
  revision: bigint,
): Uint8Array {
  if (!userId || !connectionId) {
    throw new CryptoError('NOT_INITIALIZED', 'userId and connectionId are required.');
  }
  if (userId.includes('|') || connectionId.includes('|')) {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Identifiers must not contain the AAD separator.',
    );
  }
  return utf8(
    `${AAD_PREFIX}|${userId}|${connectionId}|${revisionToHex(epoch)}|${revisionToHex(revision)}`,
  );
}

/* ------------------------------------------------------------------ */
/* Sealing key management                                              */
/* ------------------------------------------------------------------ */

/**
 * Create a per-user sealing key.
 *
 * `extractable: false` is a hard requirement, verified before the key is ever
 * used: a key that could be exported could be copied out by same-origin
 * script and used to forge envelopes offline. The 2C experiment established
 * that non-extractability survives an IndexedDB round trip as a live
 * `CryptoKey`, which is what makes this storable at all.
 */
export async function generateSealingKey(): Promise<CryptoKey> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new CryptoError('NOT_AVAILABLE', 'Web Crypto is not available.');
  }
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
  if (key.extractable) {
    throw new CryptoError('CRYPTO_ERROR', 'Sealing key must not be extractable.');
  }
  return key;
}

/** Read the sealing key for a user, or null when none has been created. */
export async function loadSealingKey(userId: string): Promise<CryptoKey | null> {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_VAULTKEYS, 'readonly');
    const value = await promisifyRequest<unknown>(
      transaction.objectStore(CRYPTO_STORE_VAULTKEYS).get(sealingKeyFor(userId)) as IDBRequest<unknown>,
    );
    await txComplete(transaction);
    if (value === undefined || value === null) return null;
    // A non-CryptoKey or an extractable key in this slot means something other
    // than this module wrote it. Refuse rather than "recover".
    if (!(value instanceof CryptoKey) || value.extractable) {
      throw new CryptoError('CORRUPT_STATE', 'Stored sealing key is invalid.');
    }
    return value;
  } finally {
    db.close();
  }
}

/**
 * Return the user's sealing key, creating it on first use.
 *
 * Creation uses `add()` rather than `put()` so two concurrent callers cannot
 * clobber each other: the loser gets a ConstraintError, re-reads, and adopts
 * the winner's key. Overwriting a live sealing key would render every existing
 * envelope permanently unreadable.
 */
export async function ensureSealingKey(userId: string): Promise<CryptoKey> {
  const existing = await loadSealingKey(userId);
  if (existing) return existing;

  const candidate = await generateSealingKey();
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_VAULTKEYS, 'readwrite', {
      durability: 'strict',
    });
    transaction.objectStore(CRYPTO_STORE_VAULTKEYS).add(candidate, sealingKeyFor(userId));
    await txComplete(transaction);
    return candidate;
  } catch {
    const raced = await loadSealingKey(userId);
    if (raced) return raced;
    throw new CryptoError('STORAGE_ERROR', 'Could not establish a sealing key.');
  } finally {
    db.close();
  }
}

/** Delete a user's sealing key (account deletion). */
export async function deleteSealingKey(userId: string): Promise<void> {
  if (!userId || typeof indexedDB === 'undefined') return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_VAULTKEYS, 'readwrite', {
      durability: 'strict',
    });
    transaction.objectStore(CRYPTO_STORE_VAULTKEYS).delete(sealingKeyFor(userId));
    await txComplete(transaction);
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* Seal / unseal                                                       */
/* ------------------------------------------------------------------ */

/**
 * Seal opaque engine state into an authenticated envelope.
 *
 * The caller's buffer is copied before encryption so a later mutation of that
 * buffer cannot change what was sealed, and the IV is drawn fresh for every
 * call — never derived from the revision, never reused across revisions.
 */
export async function seal(
  key: CryptoKey,
  userId: string,
  connectionId: string,
  epoch: bigint,
  revision: bigint,
  state: Uint8Array,
  committedAt: number = Date.now(),
): Promise<SealedEnvelope> {
  if (!(state instanceof Uint8Array)) {
    throw new CryptoError('CORRUPT_STATE', 'State must be a Uint8Array.');
  }
  const aad = buildAad(userId, connectionId, epoch, revision);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new Uint8Array(state); // defensive copy
  let sealed: ArrayBuffer;
  try {
    sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: toBufferSource(aad) },
      key,
      toBufferSource(plaintext),
    );
  } catch (e) {
    throw new CryptoError('CRYPTO_ERROR', 'Sealing the ratchet state failed.', e);
  }
  return {
    version: SEALED_ENVELOPE_VERSION,
    userId,
    connectionId,
    epoch: encodeRevision(epoch),
    revision: encodeRevision(revision),
    iv,
    sealed: new Uint8Array(sealed),
    committedAt,
  };
}

/** Structural check of an envelope read back from storage. */
export function isEnvelopeShaped(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<SealedEnvelope>;
  return (
    typeof e.version === 'number' &&
    typeof e.userId === 'string' &&
    typeof e.connectionId === 'string' &&
    e.epoch instanceof Uint8Array &&
    e.revision instanceof Uint8Array &&
    e.iv instanceof Uint8Array &&
    e.sealed instanceof Uint8Array
  );
}

/** Failure modes of `unseal`, mapped to load statuses by the caller. */
export type UnsealFailure = 'CORRUPTED' | 'UNSEAL_FAILED' | 'USER_MISMATCH';

export type UnsealResult =
  | { ok: true; value: UnsealedState }
  | { ok: false; reason: UnsealFailure };

/**
 * Authenticate and decrypt an envelope.
 *
 * Never throws on bad input — the caller must be able to turn every failure
 * into an explicit status rather than an unhandled rejection.
 *
 * Order of checks matters. The cleartext header is compared against the
 * *expected* identifiers first, so a record belonging to somebody else is
 * reported as `USER_MISMATCH` (an alarming condition worth surfacing) rather
 * than as a generic tag failure. Then the AAD is rebuilt from the header and
 * the tag is verified: from that point on, a success means every header field
 * is exactly what the writer committed.
 */
export async function unseal(
  key: CryptoKey,
  envelope: unknown,
  expectedUserId: string,
  expectedConnectionId: string,
): Promise<UnsealResult> {
  if (!isEnvelopeShaped(envelope)) return { ok: false, reason: 'CORRUPTED' };
  const e = envelope;

  if (e.version !== SEALED_ENVELOPE_VERSION) return { ok: false, reason: 'CORRUPTED' };
  if (e.iv.length !== IV_BYTES) return { ok: false, reason: 'CORRUPTED' };
  // AES-GCM output is at least the 16-byte tag.
  if (e.sealed.length < 16) return { ok: false, reason: 'CORRUPTED' };

  if (e.userId !== expectedUserId || e.connectionId !== expectedConnectionId) {
    return { ok: false, reason: 'USER_MISMATCH' };
  }

  let epoch: bigint;
  let revision: bigint;
  try {
    epoch = decodeRevision(e.epoch);
    revision = decodeRevision(e.revision);
  } catch {
    return { ok: false, reason: 'CORRUPTED' };
  }

  let aad: Uint8Array;
  try {
    aad = buildAad(e.userId, e.connectionId, epoch, revision);
  } catch {
    return { ok: false, reason: 'CORRUPTED' };
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBufferSource(e.iv), additionalData: toBufferSource(aad) },
      key,
      toBufferSource(e.sealed),
    );
  } catch {
    // Tag mismatch. Either the ciphertext was edited, a header field was
    // edited, or this envelope was sealed under a different key. All three
    // are the same decision: do not use this state.
    return { ok: false, reason: 'UNSEAL_FAILED' };
  }

  return {
    ok: true,
    value: {
      userId: e.userId,
      connectionId: e.connectionId,
      epoch,
      revision,
      state: new Uint8Array(plaintext),
      committedAt: typeof e.committedAt === 'number' ? e.committedAt : 0,
    },
  };
}
