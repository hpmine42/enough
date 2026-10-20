// enough. — safety-number formatting tests.
import '../../crypto/__tests__/setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyNumber } from '../../e2ee/safetyNumber.ts';

function toB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

test('SN1: same keys in different order produce identical numbers', async () => {
  const k1 = toB64(new Uint8Array(32).fill(0x11));
  const k2 = toB64(new Uint8Array(32).fill(0x22));
  const a = await safetyNumber(k1, k2);
  const b = await safetyNumber(k2, k1);
  assert.equal(a, b, 'safety number is symmetric');
});

test('SN2: output format is six groups of five digits', async () => {
  const k1 = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const k2 = toB64(crypto.getRandomValues(new Uint8Array(32)));
  const n = await safetyNumber(k1, k2);
  assert.match(n, /^\d{5} \d{5} \d{5} \d{5} \d{5} \d{5}$/, 'six 5-digit groups');
});

test('SN3: different keys produce (with overwhelming probability) different numbers', async () => {
  const a1 = toB64(new Uint8Array(32).fill(0xaa));
  const a2 = toB64(new Uint8Array(32).fill(0xbb));
  const b1 = toB64(new Uint8Array(32).fill(0xcc));
  const b2 = toB64(new Uint8Array(32).fill(0xdd));
  const na = await safetyNumber(a1, a2);
  const nb = await safetyNumber(b1, b2);
  assert.notEqual(na, nb);
});

test('SN4: non-32-byte keys are rejected', async () => {
  const bad = toB64(new Uint8Array(16).fill(1));
  const good = toB64(new Uint8Array(32).fill(2));
  await assert.rejects(() => safetyNumber(bad, good), /32 bytes/);
});
