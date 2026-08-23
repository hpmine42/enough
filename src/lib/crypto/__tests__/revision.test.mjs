// enough. E2EE-2D.2 — uint64 revision representation (Stage 3).
//
// Run with:
//   node --test --experimental-strip-types src/lib/crypto/__tests__/revision.test.mjs
//
// Audit finding H-2: a `Number` revision admits 1e308, for which
// `Number.isInteger` is true and `x + 1 === x`, permanently wedging a session.
// These tests pin the boundaries of the replacement representation and prove
// that the pathological values are REJECTED rather than clamped.

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_REVISION,
  MAX_REVISION,
  REVISION_BYTES,
  compareVersion,
  decodeRevision,
  encodeRevision,
  incrementRevision,
  isValidRevision,
  revisionFromNumber,
  revisionToHex,
  tryDecodeRevision,
} from '../revision.ts';
import { isCryptoError } from '../errors.ts';

function assertThrowsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(isCryptoError(err), `expected CryptoError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code, `expected ${code}, got ${err.code}`);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* R1. The mandated boundary table                                     */
/* ------------------------------------------------------------------ */

test('R1: the required boundary values round-trip exactly', () => {
  const cases = [
    0n,
    1n,
    2n,
    255n,
    256n,
    2n ** 32n,
    2n ** 53n - 1n,
    2n ** 53n,
    2n ** 64n - 2n,
    2n ** 64n - 1n,
  ];
  for (const v of cases) {
    const enc = encodeRevision(v);
    assert.equal(enc.length, REVISION_BYTES, `${v} must encode to 8 bytes`);
    assert.equal(decodeRevision(enc), v, `${v} must round-trip`);
  }
});

test('R2: 2^64 is REJECTED (the domain ceiling is exclusive above 2^64-1)', () => {
  assertThrowsCode(() => encodeRevision(2n ** 64n), 'REVISION_OVERFLOW');
  assertThrowsCode(() => encodeRevision(2n ** 64n + 1n), 'REVISION_OVERFLOW');
  assertThrowsCode(() => encodeRevision(2n ** 128n), 'REVISION_OVERFLOW');
});

test('R3: negative values are impossible to encode', () => {
  assertThrowsCode(() => encodeRevision(-1n), 'CORRUPT_STATE');
  assertThrowsCode(() => encodeRevision(-(2n ** 63n)), 'CORRUPT_STATE');
  assert.equal(isValidRevision(-1n), false);
});

test('R4: known encodings are exactly big-endian', () => {
  assert.deepEqual(Array.from(encodeRevision(0n)), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(encodeRevision(1n)), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(Array.from(encodeRevision(255n)), [0, 0, 0, 0, 0, 0, 0, 255]);
  assert.deepEqual(Array.from(encodeRevision(256n)), [0, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(
    Array.from(encodeRevision(MAX_REVISION)),
    [255, 255, 255, 255, 255, 255, 255, 255],
  );
});

test('R5: big-endian byte order makes memcmp agree with numeric order', () => {
  // This is the property that lets the encoding be compared or range-scanned
  // without decoding. A little-endian encoding would break it.
  const values = [0n, 1n, 255n, 256n, 65535n, 2n ** 32n, 2n ** 53n, MAX_REVISION];
  for (let i = 0; i < values.length - 1; i++) {
    const a = encodeRevision(values[i]);
    const b = encodeRevision(values[i + 1]);
    let cmp = 0;
    for (let k = 0; k < REVISION_BYTES && cmp === 0; k++) cmp = a[k] - b[k];
    assert.ok(cmp < 0, `memcmp(${values[i]}, ${values[i + 1]}) must be negative`);
  }
});

/* ------------------------------------------------------------------ */
/* R6-R9. Malformed input                                              */
/* ------------------------------------------------------------------ */

test('R6: wrong byte length is REJECTED, not padded or truncated', () => {
  for (const len of [0, 1, 4, 7, 9, 16]) {
    assertThrowsCode(() => decodeRevision(new Uint8Array(len)), 'CORRUPT_STATE');
  }
});

test('R7: non-Uint8Array encodings are REJECTED', () => {
  for (const bad of [null, undefined, 5, '00000005', 5n, [0, 0, 0, 0, 0, 0, 0, 5], {}, new ArrayBuffer(8)]) {
    assertThrowsCode(() => decodeRevision(bad), 'CORRUPT_STATE');
    assert.equal(tryDecodeRevision(bad), null);
  }
});

test('R8: tryDecodeRevision returns null instead of throwing on the read path', () => {
  assert.equal(tryDecodeRevision(new Uint8Array(3)), null);
  assert.equal(tryDecodeRevision(encodeRevision(42n)), 42n);
});

test('R9: encodeRevision refuses a Number even when it looks like an integer', () => {
  // No implicit conversion. A Number reaching this API means a caller skipped
  // the checked boundary, which is how 1e308 got in.
  assertThrowsCode(() => encodeRevision(5), 'CORRUPT_STATE');
  assertThrowsCode(() => encodeRevision(1e308), 'CORRUPT_STATE');
});

/* ------------------------------------------------------------------ */
/* R10-R12. Increment / overflow — audit finding H-2                   */
/* ------------------------------------------------------------------ */

test('R10: increment advances by exactly one across the 2^53 boundary', () => {
  // Where Number arithmetic starts losing precision, BigInt does not.
  assert.equal(incrementRevision(0n), 1n);
  assert.equal(incrementRevision(2n ** 53n - 1n), 2n ** 53n);
  assert.equal(incrementRevision(2n ** 53n), 2n ** 53n + 1n);
  assert.notEqual(incrementRevision(2n ** 53n), 2n ** 53n); // the Number bug
  assert.equal(incrementRevision(MAX_REVISION - 1n), MAX_REVISION);
});

test('R11: incrementing at the ceiling FAILS CLOSED — no wrap, no saturation', () => {
  // Mutation guard #10 (overflow check removed): if the guard is deleted this
  // either wraps to 0 (resetting anti-rollback) or silently repeats a value
  // (reusing a message key). Both must be unreachable.
  assertThrowsCode(() => incrementRevision(MAX_REVISION), 'REVISION_OVERFLOW');
  assertThrowsCode(() => incrementRevision(MAX_REVISION + 1n), 'REVISION_OVERFLOW');
});

test('R12: the 1e308 wedge is unrepresentable end to end', () => {
  // The original H-2 payload cannot enter the domain by any sanctioned route.
  assert.equal(Number.isInteger(1e308), true); // the old validator said yes
  assert.equal(1e308 + 1, 1e308); // and increment was a no-op
  assertThrowsCode(() => revisionFromNumber(1e308), 'CORRUPT_STATE');
  assertThrowsCode(() => encodeRevision(1e308), 'CORRUPT_STATE');
  // Even converting it to BigInt first is caught by the domain check.
  assertThrowsCode(() => encodeRevision(BigInt(1e308)), 'REVISION_OVERFLOW');
});

/* ------------------------------------------------------------------ */
/* R13. Legacy Number conversion                                       */
/* ------------------------------------------------------------------ */

test('R13: revisionFromNumber accepts only non-negative safe integers', () => {
  assert.equal(revisionFromNumber(0), 0n);
  assert.equal(revisionFromNumber(1), 1n);
  assert.equal(revisionFromNumber(Number.MAX_SAFE_INTEGER), 2n ** 53n - 1n);

  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, 2 ** 53, 1e308, '3', null, undefined]) {
    assertThrowsCode(() => revisionFromNumber(bad), 'CORRUPT_STATE');
  }
});

/* ------------------------------------------------------------------ */
/* R14. (epoch, revision) ordering                                     */
/* ------------------------------------------------------------------ */

test('R14: freshness compares epoch first, then revision', () => {
  const v = (epoch, revision) => ({ epoch, revision });
  assert.equal(compareVersion(v(0n, 5n), v(0n, 5n)), 0);
  assert.equal(compareVersion(v(0n, 4n), v(0n, 5n)), -1);
  assert.equal(compareVersion(v(0n, 6n), v(0n, 5n)), 1);
  // A newly established session restarts the revision at 1 but is NEWER,
  // because its epoch is higher. Comparing revisions alone would read this as
  // a rollback and lock the user out of their own new session.
  assert.equal(compareVersion(v(1n, 1n), v(0n, 999n)), 1);
  assert.equal(compareVersion(v(0n, 999n), v(1n, 1n)), -1);
});

test('R15: hex form is fixed width and unambiguous', () => {
  assert.equal(revisionToHex(0n), '0000000000000000');
  assert.equal(revisionToHex(1n), '0000000000000001');
  assert.equal(revisionToHex(MAX_REVISION), 'ffffffffffffffff');
  // Exactly one spelling per value: this is what makes the AAD injective.
  assert.equal(revisionToHex(10n).length, revisionToHex(9n).length);
  assert.notEqual(revisionToHex(9n), revisionToHex(10n));
  // Naive decimal-string comparison is wrong; the hex form is not.
  assert.ok('9' > '10');
  assert.ok(revisionToHex(9n) < revisionToHex(10n));
});

test('R16: INITIAL_REVISION is a bigint zero', () => {
  assert.equal(INITIAL_REVISION, 0n);
  assert.equal(typeof INITIAL_REVISION, 'bigint');
});
