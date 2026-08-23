// enough. E2EE — sealed, crash-/rollback-hardened ratchet state persistence
// (E2EE-2D, hardened by E2EE-2D.2)
// ---------------------------------------------------------------------------
// SCOPE
// This module persists an OPAQUE cryptographic session state blob (produced by
// the Signal engine) with monotonic uint64 revisions, compare-and-swap
// semantics, and a local AEAD binding between the state bytes and the header
// that describes them.
//
// It deliberately does NOT:
//   * implement any cryptography — sealing uses WebCrypto AES-GCM via
//     `sealed-state.ts`; the ratchet itself stays entirely in the engine,
//   * interpret the state bytes in any way,
//   * talk to Supabase or the network,
//   * touch the message send flow.
//
// WHY THIS EXISTS
// The Signal Double Ratchet derives a distinct message key per chain index.
// `@getmaapp/signal-wasm@0.6.6` encrypts with AES-256-CBC and authenticates
// with HMAC-SHA-256, and the (cipher key, mac key, IV) triple is derived
// deterministically from the chain key and counter. Re-encrypting from a
// ratchet state that was rolled back to an earlier revision therefore reuses
// an already-consumed (cipher key, IV) pair for a *different* plaintext.
// Verified consequences (see docs/e2ee-crash-rollback-hardening.md §1):
//   * identical plaintext under a restored state yields byte-identical
//     ciphertext,
//   * plaintexts sharing a prefix yield ciphertexts sharing a prefix at
//     AES block granularity, leaking prefix equality.
// Both violate the Double Ratchet requirement that a message key is used
// exactly once. Preventing rollback is a *correctness* requirement of the
// protocol, not a nice-to-have.
//
// THE INVARIANTS
//   A. A durably committed ratchet state is never replaced by an older one.
//   B. The revision is cryptographically inseparable from the state bytes.
//
// Invariant B is what E2EE-2D.2 adds. In E2EE-2D the revision was a plain
// number stored beside the state, so an old state could be re-labelled with a
// high revision and accepted (audit finding C-2). Now the revision — together
// with version, userId, connectionId and epoch — is AEAD additional data, so
// editing any of it invalidates the tag.
//
// WHAT IS STILL OPEN: C-1
// A restore of the ENTIRE origin (browser profile backup, OS-level snapshot)
// rolls the record, the watermark and the sealing key back together. The
// result is a genuinely sealed, internally consistent older state, and this
// module reports it as `VALID`. No purely local anchor can detect that,
// because every local anchor is inside the thing being restored.
//
// This affects BOTH directions of the version pair: a revision rollback
// within one epoch (test C8) and a rollback across an epoch boundary (test
// C9). In the cross-epoch case the `record.epoch < watermark.epoch` check
// below does not help, because a coordinated restore moves the watermark too.
// The rolled-back state is also still writable, so the ratchet keeps deriving
// keys from a chain that was already retired.
//
// A server-side epoch incremented at session establishment would NOT close
// this — that approach was evaluated and rejected. Such a counter is constant
// between two establishments, so it takes the same value before and after an
// intra-epoch rollback and cannot separate the two states. A sender-side
// sequence counter is also insufficient: it cannot observe a receiver-side
// rollback, which resurrects already-consumed message keys without the sender
// transmitting anything.
//
// Genuinely closing C-1 needs an external, append-only, bidirectional anchor
// that advances per ratchet step and binds state identity (a checkpoint/hash
// chain), plus tombstones for consumed message keys. That would make the
// server authoritative over ratchet progress and rule out offline sending, so
// it is deferred to a later E2EE architecture phase and is explicitly NOT part
// of E2EE-2D.2. See docs/e2ee-crash-rollback-hardening.md §8.0/§8.1.

import { CryptoError } from './errors.ts';
import {
  CRYPTO_STORE_RATCHET,
  ratchetKeyFor,
  ratchetUserPrefix,
  watermarkKeyFor,
} from './types.ts';
import { openDatabase, promisifyRequest, txComplete } from './storage.ts';
import {
  INITIAL_EPOCH,
  INITIAL_REVISION,
  MAX_REVISION,
  compareVersion,
  decodeRevision,
  encodeRevision,
  incrementRevision,
  isValidRevision,
  tryDecodeRevision,
} from './revision.ts';
import {
  type SealedEnvelope,
  type UnsealedState,
  isEnvelopeShaped,
  loadSealingKey,
  ensureSealingKey,
  seal,
  unseal,
} from './sealed-state.ts';

export { INITIAL_EPOCH, INITIAL_REVISION, MAX_REVISION } from './revision.ts';

/**
 * The authenticated contents of a committed ratchet state.
 *
 * Revision and epoch are BigInt in memory and `Uint8Array(8)` big-endian on
 * disk. There is no `Number` revision anywhere on this path.
 */
export interface RatchetStateRecord {
  userId: string;
  connectionId: string;
  /** Session generation. Advances only through explicit establishment. */
  epoch: bigint;
  /** Monotonic revision within the epoch. First commit of an epoch is 1. */
  revision: bigint;
  /** Opaque engine state bytes. Never interpreted here. */
  state: Uint8Array;
  /** Unix millis of the commit. Not authenticated; diagnostics only. */
  committedAt: number;
}

/**
 * Result of a load attempt.
 *
 * Every failure mode is a distinct status rather than an exception, because
 * the caller must make an explicit decision for each one. In particular
 * `MISSING` must never be quietly turned into "start a fresh session".
 */
export type RatchetStateStatus =
  /** Authenticated, not older than the watermark. Safe to use. */
  | 'VALID'
  /** Nothing was ever committed for this (user, connection) on this device. */
  | 'MISSING'
  /** A record exists but is structurally not an envelope. */
  | 'CORRUPTED'
  /** The envelope failed AEAD authentication: header or ciphertext edited. */
  | 'UNSEAL_FAILED'
  /** An older state (or a vanished record with a live watermark) was found. */
  | 'ROLLBACK_DETECTED'
  /** The record's epoch is older than the recorded epoch. */
  | 'EPOCH_STALE'
  /** The sealing key is gone, so existing envelopes cannot be read at all. */
  | 'KEY_MISSING'
  /** The record belongs to a different user or connection. */
  | 'USER_MISMATCH'
  /**
   * Storage is internally inconsistent in a way that honest operation cannot
   * produce (missing/garbled watermark next to a live record, revision at the
   * uint64 ceiling). Requires an explicit decision; never auto-repaired.
   */
  | 'WEDGED';

/** The recorded high-water mark for a (user, connection). */
export interface RatchetWatermark {
  epoch: bigint;
  revision: bigint;
}

export interface RatchetStateLoad {
  status: RatchetStateStatus;
  /** Present only when status === 'VALID'. */
  record?: RatchetStateRecord;
  /** Highest (epoch, revision) ever committed, as recorded locally. */
  watermark: RatchetWatermark;
}

const ZERO_WATERMARK: RatchetWatermark = { epoch: INITIAL_EPOCH, revision: INITIAL_REVISION };

/** Persisted watermark shape (E2EE-2D.2). */
interface StoredWatermark {
  epoch: Uint8Array;
  revision: Uint8Array;
}

type WatermarkRead =
  | { kind: 'ABSENT' }
  | { kind: 'OK'; value: RatchetWatermark }
  | { kind: 'MALFORMED' };

/**
 * Decode a watermark read from storage.
 *
 * The only accepted shape is the E2EE-2D.2 `{epoch, revision}` pair of
 * big-endian `Uint8Array(8)` values. Anything else — including a bare
 * `number` — is MALFORMED and fails closed via `WEDGED`, because treating an
 * unrecognised watermark as "no watermark" is exactly how rollback detection
 * would be switched off (audit finding C-3).
 */
function readWatermark(raw: unknown): WatermarkRead {
  if (raw === undefined || raw === null) return { kind: 'ABSENT' };

  if (typeof raw === 'object') {
    const w = raw as Partial<StoredWatermark>;
    const epoch = tryDecodeRevision(w.epoch);
    const revision = tryDecodeRevision(w.revision);
    if (epoch === null || revision === null) return { kind: 'MALFORMED' };
    return { kind: 'OK', value: { epoch, revision } };
  }

  return { kind: 'MALFORMED' };
}

function writeWatermark(value: RatchetWatermark): StoredWatermark {
  return { epoch: encodeRevision(value.epoch), revision: encodeRevision(value.revision) };
}

function requireIds(userId: string, connectionId: string): void {
  if (!userId) throw new CryptoError('NOT_INITIALIZED', 'userId is required.');
  if (!connectionId) throw new CryptoError('NOT_INITIALIZED', 'connectionId is required.');
}

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

function toRecord(u: UnsealedState): RatchetStateRecord {
  return {
    userId: u.userId,
    connectionId: u.connectionId,
    epoch: u.epoch,
    revision: u.revision,
    state: u.state,
    committedAt: u.committedAt,
  };
}

/**
 * Load and authenticate the current ratchet state.
 *
 * Never throws on a bad record: the failure mode is returned as a status so
 * callers must decide explicitly. This function will NOT fall back to an older
 * snapshot and will NOT create anything. `MISSING` and every failure status
 * are deliberately distinct — only an explicit establishment path may create a
 * session, never a load and never a send.
 */
export async function loadRatchetState(
  userId: string,
  connectionId: string,
): Promise<RatchetStateLoad> {
  requireIds(userId, connectionId);

  let raw: unknown;
  let wmRaw: unknown;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readonly');
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const rawReq = store.get(ratchetKeyFor(userId, connectionId)) as IDBRequest<unknown>;
    const wmReq = store.get(watermarkKeyFor(userId, connectionId)) as IDBRequest<unknown>;
    [raw, wmRaw] = await Promise.all([
      promisifyRequest<unknown>(rawReq),
      promisifyRequest<unknown>(wmReq),
    ]);
    await txComplete(transaction);
  } finally {
    db.close();
  }

  const wm = readWatermark(wmRaw);

  // A garbled watermark is not "no watermark". Treating it as zero is exactly
  // how an attacker would switch rollback detection off (audit finding C-3).
  if (wm.kind === 'MALFORMED') return { status: 'WEDGED', watermark: ZERO_WATERMARK };

  const watermark = wm.kind === 'OK' ? wm.value : ZERO_WATERMARK;

  if (raw === undefined || raw === null) {
    // Record gone but the watermark says something was committed: the record
    // was deleted or lost. That is a rollback, never a fresh session.
    if (wm.kind === 'OK' && (watermark.epoch > 0n || watermark.revision > 0n)) {
      return { status: 'ROLLBACK_DETECTED', watermark };
    }
    return { status: 'MISSING', watermark };
  }

  // Record present but the watermark is absent. Both are written in one
  // transaction, so honest operation cannot produce this. Fail closed.
  if (wm.kind === 'ABSENT') return { status: 'WEDGED', watermark: ZERO_WATERMARK };

  let key: CryptoKey | null;
  try {
    key = await loadSealingKey(userId);
  } catch {
    return { status: 'CORRUPTED', watermark };
  }
  if (!key) {
    // Sealed data exists but the key that authenticates it is gone. The state
    // is unreadable; it must not be replaced by a fresh session silently.
    return { status: 'KEY_MISSING', watermark };
  }

  const result = await unseal(key, raw, userId, connectionId);
  if (!result.ok) return { status: result.reason, watermark };

  const record = toRecord(result.value);

  // Authenticated, but is it CURRENT? The tag proves the header was not edited
  // after sealing; it says nothing about whether a newer state existed.
  if (record.epoch < watermark.epoch) return { status: 'EPOCH_STALE', watermark };
  if (compareVersion(record, watermark) < 0) return { status: 'ROLLBACK_DETECTED', watermark };

  // At the ceiling the session can no longer advance. Refuse before a caller
  // derives a key it will not be able to commit.
  if (record.revision >= MAX_REVISION) return { status: 'WEDGED', watermark };

  return { status: 'VALID', record, watermark };
}

/* ------------------------------------------------------------------ */
/* Commit (compare-and-swap)                                           */
/* ------------------------------------------------------------------ */

/**
 * Compare-and-swap commit of an advanced ratchet state.
 *
 * Succeeds only when the stored (epoch, revision) equals the expected pair;
 * the new envelope is then written at `revision + 1` in the same epoch. The
 * envelope and the watermark are written in a SINGLE IndexedDB transaction, so
 * a crash can never leave a state paired with the wrong revision.
 *
 * The state is sealed BEFORE the transaction opens. Web Crypto is async, and
 * awaiting it inside a transaction would let the transaction auto-commit while
 * the await is pending. Sealing first also means the transaction window stays
 * as short as possible.
 *
 * Throws `CryptoError` when:
 *   * another writer already advanced the state → `REVISION_CONFLICT`
 *   * the result would not exceed the watermark → `ROLLBACK_DETECTED`
 *   * the stored record is corrupt, foreign, or unauthenticated
 *   * the revision would leave the uint64 domain → `REVISION_OVERFLOW`
 *
 * @returns the newly committed revision.
 */
export async function commitRatchetState(
  userId: string,
  connectionId: string,
  expected: { epoch: bigint; revision: bigint },
  state: Uint8Array,
): Promise<bigint> {
  requireIds(userId, connectionId);
  if (!isValidRevision(expected?.revision) || !isValidRevision(expected?.epoch)) {
    throw new CryptoError('CORRUPT_STATE', 'expected epoch/revision must be uint64 bigints.');
  }
  if (!(state instanceof Uint8Array)) {
    throw new CryptoError('CORRUPT_STATE', 'Ratchet state must be a Uint8Array.');
  }

  // Throws REVISION_OVERFLOW at the ceiling rather than wrapping to zero.
  const nextRevision = incrementRevision(expected.revision);

  const key = await loadSealingKey(userId);
  if (!key) {
    throw new CryptoError('KEY_MISSING', 'No sealing key; refusing to commit ratchet state.');
  }

  // --- Phase 1: everything asynchronous, OUTSIDE any transaction. ----------
  //
  // Web Crypto and IndexedDB transactions do not mix. An IndexedDB transaction
  // stays alive only while requests are pending or while control is still in
  // the microtask queue; awaiting `crypto.subtle.decrypt` yields to the event
  // loop, the transaction auto-commits, and the subsequent `put` throws
  // TransactionInactiveError. Sealing and verifying therefore happen here, and
  // the transaction below performs only synchronous checks.
  const preRead = await readRecordAndWatermark(userId, connectionId);
  if (preRead.watermark.kind === 'MALFORMED') {
    throw new CryptoError('WEDGED', 'Watermark is malformed; refusing to commit.');
  }
  const watermark = preRead.watermark.kind === 'OK' ? preRead.watermark.value : ZERO_WATERMARK;
  const existing = preRead.record;

  let current: { epoch: bigint; revision: bigint };
  if (existing === undefined || existing === null) {
    if (preRead.watermark.kind === 'OK' && (watermark.epoch > 0n || watermark.revision > 0n)) {
      throw new CryptoError('ROLLBACK_DETECTED', 'Ratchet record vanished beneath a live watermark.');
    }
    current = { epoch: INITIAL_EPOCH, revision: INITIAL_REVISION };
  } else {
    // The stored envelope must AUTHENTICATE before it may define "current".
    // Reading the cleartext header of an unverified record and trusting its
    // revision is precisely the C-2 hole.
    const verified = await unseal(key, existing, userId, connectionId);
    if (!verified.ok) {
      throw new CryptoError(
        verified.reason === 'USER_MISMATCH'
          ? 'USER_MISMATCH'
          : verified.reason === 'UNSEAL_FAILED'
            ? 'UNSEAL_FAILED'
            : 'CORRUPT_STATE',
        'Stored ratchet state failed authentication; refusing to commit over it.',
      );
    }
    current = { epoch: verified.value.epoch, revision: verified.value.revision };
  }

  if (current.epoch !== expected.epoch || current.revision !== expected.revision) {
    throw new CryptoError('REVISION_CONFLICT', 'Ratchet state was advanced concurrently.');
  }

  // Defence in depth: even a caller presenting a matching but stale pair
  // cannot land at or below the high-water mark.
  if (compareVersion({ epoch: expected.epoch, revision: nextRevision }, watermark) <= 0) {
    throw new CryptoError(
      'ROLLBACK_DETECTED',
      'Refusing to commit at or below the recorded high-water mark.',
    );
  }

  const envelope = await seal(key, userId, connectionId, expected.epoch, nextRevision, state);

  // --- Phase 2: the atomic compare-and-swap. -------------------------------
  //
  // Everything above was advisory: it ran outside the transaction, so another
  // writer may have committed in the meantime. The transaction therefore
  // re-checks — synchronously — that storage still holds EXACTLY the bytes
  // that were authenticated in phase 1. Byte identity is the right comparison
  // here: it needs no key, cannot itself be spoofed by a re-labelled header,
  // and any change at all (including a same-revision overwrite) fails it.
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', {
      durability: 'strict',
    });
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const recordKey = ratchetKeyFor(userId, connectionId);
    const wmKey = watermarkKeyFor(userId, connectionId);

    const nowRecordReq = store.get(recordKey) as IDBRequest<unknown>;
    const nowWmReq = store.get(wmKey) as IDBRequest<unknown>;
    const [nowRecord, nowWmRaw] = await Promise.all([
      promisifyRequest<unknown>(nowRecordReq),
      promisifyRequest<unknown>(nowWmReq),
    ]);
    const nowWm = readWatermark(nowWmRaw);

    if (!sameEnvelopeBytes(nowRecord, existing)) {
      transaction.abort();
      throw new CryptoError('REVISION_CONFLICT', 'Ratchet state was advanced concurrently.');
    }
    if (nowWm.kind === 'MALFORMED') {
      transaction.abort();
      throw new CryptoError('WEDGED', 'Watermark is malformed; refusing to commit.');
    }
    const nowWatermark = nowWm.kind === 'OK' ? nowWm.value : ZERO_WATERMARK;
    if (nowWatermark.epoch !== watermark.epoch || nowWatermark.revision !== watermark.revision) {
      transaction.abort();
      throw new CryptoError('REVISION_CONFLICT', 'Watermark advanced concurrently.');
    }
    if (compareVersion({ epoch: expected.epoch, revision: nextRevision }, nowWatermark) <= 0) {
      transaction.abort();
      throw new CryptoError(
        'ROLLBACK_DETECTED',
        'Refusing to commit at or below the recorded high-water mark.',
      );
    }

    store.put(envelope, recordKey);
    store.put(writeWatermark({ epoch: expected.epoch, revision: nextRevision }), wmKey);
    await txComplete(transaction);
    return nextRevision;
  } finally {
    db.close();
  }
}

/** Read the record and its watermark in one consistent transaction. */
async function readRecordAndWatermark(
  userId: string,
  connectionId: string,
): Promise<{ record: unknown; watermark: WatermarkRead }> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readonly');
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const recordReq = store.get(ratchetKeyFor(userId, connectionId)) as IDBRequest<unknown>;
    const wmReq = store.get(watermarkKeyFor(userId, connectionId)) as IDBRequest<unknown>;
    const [record, wmRaw] = await Promise.all([
      promisifyRequest<unknown>(recordReq),
      promisifyRequest<unknown>(wmReq),
    ]);
    await txComplete(transaction);
    return { record, watermark: readWatermark(wmRaw) };
  } finally {
    db.close();
  }
}

function bytesEqual(a: unknown, b: unknown): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Byte-identity of two stored records, used as the compare-and-swap witness.
 *
 * Both `undefined` (no record) counts as equal, which is the "first commit"
 * case. Anything else requires every authenticated field plus the ciphertext
 * and IV to match exactly.
 */
function sameEnvelopeBytes(a: unknown, b: unknown): boolean {
  const aEmpty = a === undefined || a === null;
  const bEmpty = b === undefined || b === null;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  if (!isEnvelopeShaped(a) || !isEnvelopeShaped(b)) return false;
  return (
    a.version === b.version &&
    a.userId === b.userId &&
    a.connectionId === b.connectionId &&
    bytesEqual(a.epoch, b.epoch) &&
    bytesEqual(a.revision, b.revision) &&
    bytesEqual(a.iv, b.iv) &&
    bytesEqual(a.sealed, b.sealed)
  );
}

/* ------------------------------------------------------------------ */
/* Establishment                                                       */
/* ------------------------------------------------------------------ */

export interface AdoptOptions {
  /**
   * The epoch the caller observed. Required when a session already exists:
   * adopting over a live session is a compare-and-swap, not a force.
   */
  replacesEpoch?: bigint;
}

/**
 * Install the initial state of a NEWLY ESTABLISHED session.
 *
 * This replaces `restoreRatchetSnapshot()`, which was removed in E2EE-2D.2.
 * It is deliberately NOT a restore primitive, and the difference is not
 * cosmetic:
 *
 *   * the revision is not a parameter — a new session always starts at 1,
 *   * the epoch is not a parameter either — it is derived as
 *     `watermark.epoch + 1`, so adoption is strictly forward-only,
 *   * there is no force flag; adopting over an existing session requires
 *     naming that session's current epoch,
 *   * the caller supplies engine output from an actual handshake, not a blob
 *     recovered from storage.
 *
 * Because the epoch advances, an adopted session is ordered ABOVE everything
 * previously committed even though its revision restarts at 1. That is why
 * freshness is compared as the pair (epoch, revision) and not on revision
 * alone.
 *
 * What this does NOT provide: proof that the handshake itself was fresh. A
 * local caller can still establish a session from stale handshake material.
 * Detecting that needs the external epoch anchor (C-1).
 */
export async function adoptSessionFromEstablishment(
  userId: string,
  connectionId: string,
  initialState: Uint8Array,
  options: AdoptOptions = {},
): Promise<{ epoch: bigint; revision: bigint }> {
  requireIds(userId, connectionId);
  if (!(initialState instanceof Uint8Array) || initialState.length === 0) {
    throw new CryptoError('CORRUPT_STATE', 'Initial session state must be non-empty bytes.');
  }
  if (options.replacesEpoch !== undefined && !isValidRevision(options.replacesEpoch)) {
    throw new CryptoError('CORRUPT_STATE', 'replacesEpoch must be a uint64 bigint.');
  }

  const key = await ensureSealingKey(userId);

  // Determine the target epoch from the current watermark, then seal, then
  // re-verify inside the write transaction. Sealing cannot happen inside the
  // transaction (async Web Crypto), so the transaction re-checks that nothing
  // moved in between and aborts if it did.
  const pre = await readWatermarkOnce(userId, connectionId);
  if (pre.kind === 'MALFORMED') {
    throw new CryptoError('WEDGED', 'Watermark is malformed; refusing to establish.');
  }
  const preWm = pre.kind === 'OK' ? pre.value : ZERO_WATERMARK;
  const targetEpoch = incrementRevision(preWm.epoch);
  const targetRevision = 1n;

  const envelope = await seal(key, userId, connectionId, targetEpoch, targetRevision, initialState);

  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readwrite', {
      durability: 'strict',
    });
    const store = transaction.objectStore(CRYPTO_STORE_RATCHET);
    const recordKey = ratchetKeyFor(userId, connectionId);
    const wmKey = watermarkKeyFor(userId, connectionId);

    // Issue both reads before awaiting either — see the note in
    // `commitRatchetState`: an await that yields to the event loop lets the
    // transaction auto-commit.
    const existingReq = store.get(recordKey) as IDBRequest<unknown>;
    const wmReq = store.get(wmKey) as IDBRequest<unknown>;
    const [existing, wmRaw] = await Promise.all([
      promisifyRequest<unknown>(existingReq),
      promisifyRequest<unknown>(wmReq),
    ]);
    const wm = readWatermark(wmRaw);
    if (wm.kind === 'MALFORMED') {
      transaction.abort();
      throw new CryptoError('WEDGED', 'Watermark is malformed; refusing to establish.');
    }
    const watermark = wm.kind === 'OK' ? wm.value : ZERO_WATERMARK;

    if (watermark.epoch !== preWm.epoch || watermark.revision !== preWm.revision) {
      transaction.abort();
      throw new CryptoError('REVISION_CONFLICT', 'State changed while establishing the session.');
    }

    if (existing !== undefined && existing !== null) {
      if (options.replacesEpoch === undefined) {
        transaction.abort();
        throw new CryptoError(
          'REVISION_CONFLICT',
          'A session already exists; establishment must name the epoch it replaces.',
        );
      }
      if (options.replacesEpoch !== watermark.epoch) {
        transaction.abort();
        throw new CryptoError('REVISION_CONFLICT', 'replacesEpoch does not match the current epoch.');
      }
    }

    if (targetEpoch <= watermark.epoch) {
      transaction.abort();
      throw new CryptoError('ROLLBACK_DETECTED', 'Establishment must advance the epoch.');
    }

    store.put(envelope, recordKey);
    store.put(writeWatermark({ epoch: targetEpoch, revision: targetRevision }), wmKey);
    await txComplete(transaction);
  } finally {
    db.close();
  }

  return { epoch: targetEpoch, revision: targetRevision };
}

/* ------------------------------------------------------------------ */
/* Diagnostics + deletion                                              */
/* ------------------------------------------------------------------ */

async function readWatermarkOnce(userId: string, connectionId: string): Promise<WatermarkRead> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(CRYPTO_STORE_RATCHET, 'readonly');
    const raw = await promisifyRequest<unknown>(
      transaction.objectStore(CRYPTO_STORE_RATCHET).get(watermarkKeyFor(userId, connectionId)) as IDBRequest<unknown>,
    );
    await txComplete(transaction);
    return readWatermark(raw);
  } finally {
    db.close();
  }
}

/**
 * Read the monotonic high-water mark for diagnostics.
 * Returns {0, 0} when nothing was ever committed. Throws `WEDGED` when the
 * stored watermark is malformed — a caller must not read that as "zero".
 */
export async function getRatchetWatermark(
  userId: string,
  connectionId: string,
): Promise<RatchetWatermark> {
  requireIds(userId, connectionId);
  const wm = await readWatermarkOnce(userId, connectionId);
  if (wm.kind === 'MALFORMED') {
    throw new CryptoError('WEDGED', 'Stored watermark is malformed.');
  }
  return wm.kind === 'OK' ? wm.value : ZERO_WATERMARK;
}

/**
 * Delete all ratchet state for a user (account deletion).
 *
 * The watermark goes with the records. That is correct for account deletion —
 * the identity itself is going away — but it does mean a deleted-then-recreated
 * account starts from a clean slate. See the limitations section of the
 * hardening doc. The sealing key is removed by `deleteUserCryptoState`.
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

export type { SealedEnvelope };
export { decodeRevision, encodeRevision };
