// enough. E2EE — uint64 revision / epoch representation (E2EE-2D.2, Stage 3)
// ---------------------------------------------------------------------------
// WHY THIS MODULE EXISTS
//
// E2EE-2D stored the ratchet revision as a JavaScript `Number`. That is unsafe
// for a security counter:
//
//   Number.isInteger(1e308) === true      // passes a naive validator
//   1e308 + 1 === 1e308                   // increment is a no-op
//
// An attacker (or a corrupted write) that lands `1e308` in the revision field
// therefore wedges the session permanently: every future commit computes a
// `nextRevision` equal to the current one, so the compare-and-swap can never
// make progress again. Above 2^53 the arithmetic is silently lossy even
// without an attacker.
//
// THE FIX
//
//   * canonical persisted form : Uint8Array(8), big-endian, unsigned
//   * in-memory arithmetic     : BigInt
//   * hard domain              : 0 <= revision <= 2^64 - 1
//   * overflow                 : rejected, never wrapped, never saturated
//
// Big-endian fixed width is chosen deliberately:
//   * `memcmp` order equals numeric order, so comparison needs no decoding,
//   * it is a valid IndexedDB *key* (a raw BigInt is NOT — it throws
//     DataError), and a valid IndexedDB *value*,
//   * it has exactly one encoding per value, which matters because the bytes
//     are fed into AEAD additional data in `sealed-state.ts`. A representation
//     with multiple encodings of the same number (decimal strings, BigInt
//     structured clone) would let an attacker vary the AAD without varying the
//     value.
//
// This module contains NO cryptography. It is pure integer encoding.

import { CryptoError } from './errors.ts';

/** Width of the canonical persisted revision/epoch encoding, in bytes. */
export const REVISION_BYTES = 8;

/** Inclusive upper bound of the revision domain: 2^64 - 1. */
export const MAX_REVISION = 18446744073709551615n; // 2n ** 64n - 1n

/**
 * The revision a (user, connection) has before anything was ever committed.
 * The first commit of an established session lands on revision 1.
 */
export const INITIAL_REVISION = 0n;

/** The epoch a (user, connection) has before any session was established. */
export const INITIAL_EPOCH = 0n;

/**
 * Encode a revision/epoch as 8 big-endian bytes.
 *
 * Rejects anything outside [0, 2^64 - 1] with `REVISION_OVERFLOW`. There is no
 * saturation and no wraparound: a counter that cannot advance safely must stop
 * the session rather than silently repeat a value.
 */
export function encodeRevision(value: bigint): Uint8Array {
  if (typeof value !== 'bigint') {
    throw new CryptoError('CORRUPT_STATE', 'Revision must be a bigint.');
  }
  if (value < 0n) {
    throw new CryptoError('CORRUPT_STATE', 'Revision must not be negative.');
  }
  if (value > MAX_REVISION) {
    throw new CryptoError('REVISION_OVERFLOW', 'Revision exceeds the uint64 domain.');
  }
  const out = new Uint8Array(REVISION_BYTES);
  let v = value;
  for (let i = REVISION_BYTES - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Decode 8 big-endian bytes into a BigInt.
 *
 * Rejects any other length. A short or long buffer is not "close enough" —
 * it means the record was written by something other than this module, which
 * is exactly the situation where guessing is dangerous.
 */
export function decodeRevision(bytes: unknown): bigint {
  if (!(bytes instanceof Uint8Array)) {
    throw new CryptoError('CORRUPT_STATE', 'Encoded revision must be a Uint8Array.');
  }
  if (bytes.length !== REVISION_BYTES) {
    throw new CryptoError('CORRUPT_STATE', 'Encoded revision must be exactly 8 bytes.');
  }
  let v = 0n;
  for (let i = 0; i < REVISION_BYTES; i++) {
    v = (v << 8n) | BigInt(bytes[i]!);
  }
  return v;
}

/**
 * Non-throwing variant used on the read path, where a malformed value must
 * become a *status* rather than an exception. Returns null on any problem.
 */
export function tryDecodeRevision(bytes: unknown): bigint | null {
  try {
    return decodeRevision(bytes);
  } catch {
    return null;
  }
}

/**
 * Increment a revision by one, fail-closed at the uint64 ceiling.
 *
 * Reaching 2^64 - 1 is not reachable by honest use (it would require ~1.8e19
 * messages). It IS reachable by tampering, which is precisely why hitting it
 * must stop the session instead of wrapping to 0 — wrapping would reset the
 * anti-rollback counter and reuse message keys.
 */
export function incrementRevision(value: bigint): bigint {
  if (typeof value !== 'bigint') {
    throw new CryptoError('CORRUPT_STATE', 'Revision must be a bigint.');
  }
  if (value < 0n) {
    throw new CryptoError('CORRUPT_STATE', 'Revision must not be negative.');
  }
  if (value >= MAX_REVISION) {
    throw new CryptoError(
      'REVISION_OVERFLOW',
      'Revision is at the uint64 ceiling; the session cannot advance.',
    );
  }
  return value + 1n;
}

/** True when `value` is inside the representable revision domain. */
export function isValidRevision(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= 0n && value <= MAX_REVISION;
}

/**
 * Explicit, checked conversion from a JS number.
 *
 * Deliberately narrow: only non-negative safe integers convert. `1e308`,
 * `2 ** 53`, `NaN`, `Infinity` and fractions are all rejected. This is the
 * ONLY sanctioned Number → revision path, and it exists solely so the v2
 * legacy migration can read records that were written before this module.
 */
export function revisionFromNumber(value: number): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Legacy revision is not a non-negative safe integer.',
    );
  }
  return BigInt(value);
}

/**
 * Lexicographic comparison of a (epoch, revision) pair.
 *
 * Session freshness is ordered by epoch first, then revision. A new session
 * establishment bumps the epoch and restarts the revision at 1; without the
 * epoch term the watermark would see that as a downgrade. Returns -1, 0 or 1.
 */
export function compareVersion(
  a: { epoch: bigint; revision: bigint },
  b: { epoch: bigint; revision: bigint },
): -1 | 0 | 1 {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1;
  return 0;
}

/**
 * Fixed-width lowercase hex of the canonical encoding.
 * Used to build AEAD additional data, where a unique, stable, unambiguous
 * textual form is required.
 */
export function revisionToHex(value: bigint): string {
  const bytes = encodeRevision(value);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
