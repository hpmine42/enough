// enough. E2EE-2A — Primitive layer tests
// ---------------------------------------------------------------------------
//   Primitive only; not a Signal/X3DH/PQXDH/Double-Ratchet implementation.
//
// Run with:  npm run test:crypto
//
// Covers: X25519 key agreement, HKDF-SHA-256 (RFC 5869 KATs), AES-256-GCM
// (McGrew/Viega AES-256 KATs), AAD handling, and the security/protocol
// boundaries of this phase (no production integration, no logging, no
// Supabase, no `messages` changes).

import './setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  deriveSharedSecret,
  X25519_PUBLIC_KEY_BYTES,
  X25519_SHARED_SECRET_BYTES,
} from '../key-agreement.ts';

import {
  deriveMessageKey,
  deriveKeyBytes,
  importKeyMaterial,
  generateSalt,
  hkdfInfo,
  HKDF_HASH,
  HKDF_INFO_NAMESPACE,
  DEFAULT_SALT_BYTES,
  MESSAGE_KEY_BITS,
} from '../kdf.ts';

import {
  encryptBytes,
  decryptBytes,
  generateNonce,
  generateLocalAesKey,
  importAesKey,
  toSealedContainer,
  fromSealedContainer,
  AES_GCM_KEY_BITS,
  AES_GCM_NONCE_BYTES,
  AES_GCM_TAG_BYTES,
  SEALED_CONTAINER_VERSION,
} from '../symmetric.ts';

import * as primitives from '../primitives.ts';
import { generateIdentityKeyPair, importPublicKey } from '../keys.ts';
import { bytesToBase64 } from '../serialization.ts';
import { CryptoError } from '../errors.ts';

// --- helpers ---------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const unhex = (s) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

/** Fixed, public KDF parameters used to compare opaque shared secrets. */
const CMP_SALT = new Uint8Array(32).fill(0x2a);
const CMP_INFO = hkdfInfo('test/compare');

/** Fingerprint an opaque shared secret without ever exporting it. */
async function fingerprint(secret) {
  return hex(await deriveKeyBytes(secret, CMP_SALT, CMP_INFO, 32));
}

async function isCryptoErrorThrown(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof CryptoError;
  }
}

/** Read the source of a module in src/lib/crypto. */
function readCryptoSource(file) {
  return fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8');
}

/** Read a module's executable code (block and line comments removed). */
function readCryptoCode(file) {
  return readCryptoSource(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const NEW_MODULES = ['key-agreement.ts', 'kdf.ts', 'symmetric.ts', 'primitives.ts'];

// ===========================================================================
// A. X25519 key agreement
// ===========================================================================

test('X25519: Alice and Bob derive the same shared secret (both directions)', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();

  const ssA = await deriveSharedSecret(alice.privateKey, bob.publicKey);
  const ssB = await deriveSharedSecret(bob.privateKey, alice.publicKey);

  assert.equal(await fingerprint(ssA), await fingerprint(ssB));
  assert.equal(X25519_PUBLIC_KEY_BYTES, 32);
  assert.equal(X25519_SHARED_SECRET_BYTES, 32);
});

test('X25519: shared secret is a non-extractable HKDF key, never raw bytes', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const ss = await deriveSharedSecret(alice.privateKey, bob.publicKey);

  assert.equal(ss instanceof CryptoKey, true);
  assert.equal(ss.algorithm.name, 'HKDF');
  assert.equal(ss.extractable, false);
  assert.deepEqual([...ss.usages].sort(), ['deriveBits', 'deriveKey']);
  // The raw secret must be unreachable from JavaScript.
  await assert.rejects(() => crypto.subtle.exportKey('raw', ss));
});

test('X25519: a third party public key yields a different secret', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const mallory = await generateIdentityKeyPair();

  const withBob = await fingerprint(await deriveSharedSecret(alice.privateKey, bob.publicKey));
  const withMallory = await fingerprint(
    await deriveSharedSecret(alice.privateKey, mallory.publicKey),
  );
  assert.notEqual(withBob, withMallory);
});

test('X25519: RFC 7748 §6.1 known-answer vector', async () => {
  // RFC 7748, section 6.1 (X25519 Diffie-Hellman test vector).
  const A_d = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
  const A_x = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';
  const B_d = '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb';
  const B_x = 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f';
  const EXPECTED_SS = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';

  const importPriv = (d, x) =>
    crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'X25519', d: b64url(unhex(d)), x: b64url(unhex(x)) },
      { name: 'X25519' },
      /* extractable */ false,
      ['deriveBits', 'deriveKey'],
    );

  const alicePriv = await importPriv(A_d, A_x);
  const bobPriv = await importPriv(B_d, B_x);
  const alicePub = await importPublicKey(bytesToBase64(unhex(A_x)));
  const bobPub = await importPublicKey(bytesToBase64(unhex(B_x)));

  // Compare against the RFC's expected shared secret without exporting the
  // opaque secret: derive the same OKM from both and compare.
  const expected = await fingerprint(await importKeyMaterial(unhex(EXPECTED_SS)));
  assert.equal(await fingerprint(await deriveSharedSecret(alicePriv, bobPub)), expected);
  assert.equal(await fingerprint(await deriveSharedSecret(bobPriv, alicePub)), expected);
});

test('X25519: invalid public key material is rejected', async () => {
  const alice = await generateIdentityKeyPair();

  // Wrong raw length never reaches key agreement (import rejects it).
  await assert.rejects(() => importPublicKey(bytesToBase64(new Uint8Array(31))));
  await assert.rejects(() => importPublicKey(bytesToBase64(new Uint8Array(33))));

  // All-zero (small-order) peer point must be refused: it yields a
  // degenerate all-zero shared secret.
  const lowOrder = await importPublicKey(bytesToBase64(new Uint8Array(32)));
  assert.equal(
    await isCryptoErrorThrown(() => deriveSharedSecret(alice.privateKey, lowOrder)),
    true,
  );
});

test('X25519: wrong algorithms and wrong key roles are rejected', async () => {
  const alice = await generateIdentityKeyPair();
  const ed = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const aes = await generateLocalAesKey();

  // Ed25519 private key as local key
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(ed.privateKey, alice.publicKey)), true);
  // Ed25519 public key as peer key
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(alice.privateKey, ed.publicKey)), true);
  // AES key in either position
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(aes, alice.publicKey)), true);
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(alice.privateKey, aes)), true);
  // Public key passed as the private key (and vice versa)
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(alice.publicKey, alice.publicKey)), true);
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(alice.privateKey, alice.privateKey)), true);
  // Nonsense inputs
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(null, alice.publicKey)), true);
  assert.equal(await isCryptoErrorThrown(() => deriveSharedSecret(alice.privateKey, undefined)), true);
});

test('X25519: an extractable private key is refused (non-extractable invariant)', async () => {
  const extractablePair = await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
    'deriveKey',
  ]);
  const peer = await generateIdentityKeyPair();
  assert.equal(extractablePair.privateKey.extractable, true);
  try {
    await deriveSharedSecret(extractablePair.privateKey, peer.publicKey);
    assert.fail('extractable private key must be rejected');
  } catch (e) {
    assert.equal(e instanceof CryptoError, true);
    assert.equal(e.code, 'CORRUPT_STATE');
  }
});

// ===========================================================================
// B. HKDF-SHA-256
// ===========================================================================

test('HKDF: identical inputs are deterministic', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(32).fill(0x11));
  const salt = generateSalt();
  const info = hkdfInfo('test/deterministic');
  const a = await deriveKeyBytes(ikm, salt, info, 32);
  const b = await deriveKeyBytes(ikm, salt, info, 32);
  assert.equal(hex(a), hex(b));
  assert.equal(a.byteLength, 32);
});

test('HKDF: a different salt yields different output', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(32).fill(0x11));
  const info = hkdfInfo('test/salt');
  const a = await deriveKeyBytes(ikm, new Uint8Array(32).fill(1), info, 32);
  const b = await deriveKeyBytes(ikm, new Uint8Array(32).fill(2), info, 32);
  assert.notEqual(hex(a), hex(b));
});

test('HKDF: a different info yields different output (domain separation)', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(32).fill(0x11));
  const salt = new Uint8Array(32).fill(9);
  const a = await deriveKeyBytes(ikm, salt, hkdfInfo('purpose-a'), 32);
  const b = await deriveKeyBytes(ikm, salt, hkdfInfo('purpose-b'), 32);
  assert.notEqual(hex(a), hex(b));
});

test('HKDF: RFC 5869 Test Case 1 (SHA-256, 42-byte OKM)', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(22).fill(0x0b));
  const salt = unhex('000102030405060708090a0b0c');
  const info = unhex('f0f1f2f3f4f5f6f7f8f9');
  const okm = await deriveKeyBytes(ikm, salt, info, 42);
  assert.equal(
    hex(okm),
    '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
  );
});

test('HKDF: RFC 5869 Test Case 2 (long inputs, 82-byte OKM)', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(80).map((_, i) => i));
  const salt = new Uint8Array(80).map((_, i) => 0x60 + i);
  const info = new Uint8Array(80).map((_, i) => 0xb0 + i);
  const okm = await deriveKeyBytes(ikm, salt, info, 82);
  assert.equal(
    hex(okm),
    'b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb4' +
      '1c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87',
  );
});

test('HKDF: RFC 5869 Test Case 3 (zero-length salt and info)', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(22).fill(0x0b));
  const okm = await deriveKeyBytes(ikm, new Uint8Array(0), new Uint8Array(0), 42);
  assert.equal(
    hex(okm),
    '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
  );
});

test('HKDF: deriveMessageKey returns a non-extractable AES-256-GCM key', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const ss = await deriveSharedSecret(alice.privateKey, bob.publicKey);
  const key = await deriveMessageKey(ss, generateSalt(), hkdfInfo('test/message-key'));

  assert.equal(key.algorithm.name, 'AES-GCM');
  assert.equal(key.algorithm.length, MESSAGE_KEY_BITS);
  assert.equal(key.extractable, false);
  assert.deepEqual([...key.usages].sort(), ['decrypt', 'encrypt']);
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
});

test('HKDF: both peers derive an interoperable message key from the same salt/info', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const salt = generateSalt();
  const info = hkdfInfo('test/interop');

  const keyA = await deriveMessageKey(
    await deriveSharedSecret(alice.privateKey, bob.publicKey), salt, info);
  const keyB = await deriveMessageKey(
    await deriveSharedSecret(bob.privateKey, alice.publicKey), salt, info);

  const sealed = await encryptBytes(keyA, enc.encode('primitive layer only'));
  const plain = await decryptBytes(keyB, sealed.ciphertext, sealed.nonce);
  assert.equal(dec.decode(plain), 'primitive layer only');
});

test('HKDF: invalid inputs are rejected', async () => {
  const ikm = await importKeyMaterial(new Uint8Array(32).fill(3));
  const aes = await generateLocalAesKey();

  // Non-HKDF key material
  assert.equal(await isCryptoErrorThrown(() => deriveMessageKey(aes, generateSalt(), hkdfInfo('x'))), true);
  // Empty info for a message key (domain separation is mandatory)
  assert.equal(
    await isCryptoErrorThrown(() => deriveMessageKey(ikm, generateSalt(), new Uint8Array(0))),
    true,
  );
  // Non-Uint8Array salt / info
  assert.equal(await isCryptoErrorThrown(() => deriveMessageKey(ikm, 'salt', hkdfInfo('x'))), true);
  assert.equal(await isCryptoErrorThrown(() => deriveKeyBytes(ikm, generateSalt(), 'info', 32)), true);
  // Invalid output lengths
  assert.equal(await isCryptoErrorThrown(() => deriveKeyBytes(ikm, generateSalt(), hkdfInfo('x'), 0)), true);
  assert.equal(
    await isCryptoErrorThrown(() => deriveKeyBytes(ikm, generateSalt(), hkdfInfo('x'), 255 * 32 + 1)),
    true,
  );
  // Empty info labels are refused
  assert.throws(() => hkdfInfo(''), CryptoError);
});

test('HKDF: salts are random, public and namespaced info labels are versioned', () => {
  assert.equal(HKDF_HASH, 'SHA-256');
  assert.equal(DEFAULT_SALT_BYTES, 32);
  const s1 = generateSalt();
  const s2 = generateSalt();
  assert.equal(s1.byteLength, 32);
  assert.notEqual(hex(s1), hex(s2));
  assert.equal(generateSalt(16).byteLength, 16);
  assert.equal(dec.decode(hkdfInfo('chat')), `${HKDF_INFO_NAMESPACE}/chat`);
  assert.match(HKDF_INFO_NAMESPACE, /primitive\.v1$/);
});

// ===========================================================================
// C. AES-256-GCM
// ===========================================================================

test('AES-GCM: encrypt → decrypt round-trips the plaintext', async () => {
  const key = await generateLocalAesKey();
  const message = enc.encode('enough. primitive layer round trip');
  const sealed = await encryptBytes(key, message);

  assert.equal(sealed.nonce.byteLength, AES_GCM_NONCE_BYTES);
  assert.equal(sealed.ciphertext.byteLength, message.byteLength + AES_GCM_TAG_BYTES);
  const plain = await decryptBytes(key, sealed.ciphertext, sealed.nonce);
  assert.equal(dec.decode(plain), 'enough. primitive layer round trip');
});

test('AES-GCM: every encryption generates a fresh 96-bit nonce', async () => {
  const key = await generateLocalAesKey();
  const message = enc.encode('same plaintext');
  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    const sealed = await encryptBytes(key, message);
    assert.equal(sealed.nonce.byteLength, 12);
    seen.add(hex(sealed.nonce));
  }
  assert.equal(seen.size, 64, 'nonces must never repeat for the same key');
  assert.equal(generateNonce().byteLength, AES_GCM_NONCE_BYTES);
  assert.notEqual(hex(generateNonce()), hex(generateNonce()));
});

test('AES-GCM: identical plaintext+key produce different ciphertexts', async () => {
  const key = await generateLocalAesKey();
  const message = enc.encode('deterministic input, randomized output');
  const a = await encryptBytes(key, message);
  const b = await encryptBytes(key, message);
  assert.notEqual(hex(a.ciphertext), hex(b.ciphertext));
  assert.notEqual(hex(a.nonce), hex(b.nonce));
  // Both still decrypt correctly.
  assert.equal(dec.decode(await decryptBytes(key, a.ciphertext, a.nonce)), 'deterministic input, randomized output');
  assert.equal(dec.decode(await decryptBytes(key, b.ciphertext, b.nonce)), 'deterministic input, randomized output');
});

test('AES-GCM: tampered ciphertext fails authentication', async () => {
  const key = await generateLocalAesKey();
  const sealed = await encryptBytes(key, enc.encode('integrity protected'));

  const flippedBody = Uint8Array.from(sealed.ciphertext);
  flippedBody[0] ^= 0x01;
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, flippedBody, sealed.nonce)), true);

  const flippedTag = Uint8Array.from(sealed.ciphertext);
  flippedTag[flippedTag.length - 1] ^= 0x80;
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, flippedTag, sealed.nonce)), true);

  const truncated = sealed.ciphertext.slice(0, sealed.ciphertext.length - 1);
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, truncated, sealed.nonce)), true);
});

test('AES-GCM: tampered nonce fails authentication', async () => {
  const key = await generateLocalAesKey();
  const sealed = await encryptBytes(key, enc.encode('nonce is public but authenticated'));

  const badNonce = Uint8Array.from(sealed.nonce);
  badNonce[5] ^= 0x04;
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, sealed.ciphertext, badNonce)), true);

  // Wrong nonce length is rejected before touching Web Crypto.
  assert.equal(
    await isCryptoErrorThrown(() => decryptBytes(key, sealed.ciphertext, new Uint8Array(8))),
    true,
  );
});

test('AES-GCM: a wrong key fails to decrypt', async () => {
  const key = await generateLocalAesKey();
  const otherKey = await generateLocalAesKey();
  const sealed = await encryptBytes(key, enc.encode('key binding'));
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(otherKey, sealed.ciphertext, sealed.nonce)), true);
});

test('AES-GCM: correct AAD decrypts, modified/missing AAD fails', async () => {
  const key = await generateLocalAesKey();
  const aad = enc.encode('conceptual-aad:v1');
  const message = enc.encode('associated data binding');
  const sealed = await encryptBytes(key, message, aad);

  // Correct AAD works.
  assert.equal(dec.decode(await decryptBytes(key, sealed.ciphertext, sealed.nonce, aad)), 'associated data binding');

  // Modified AAD fails.
  const modified = Uint8Array.from(aad);
  modified[modified.length - 1] ^= 0x01;
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, sealed.ciphertext, sealed.nonce, modified)), true);

  // Omitted AAD fails.
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, sealed.ciphertext, sealed.nonce)), true);

  // AAD supplied where none was used fails too.
  const withoutAad = await encryptBytes(key, message);
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, withoutAad.ciphertext, withoutAad.nonce, aad)), true);

  // Empty AAD is a valid, distinct binding value.
  const emptyAad = await encryptBytes(key, message, new Uint8Array(0));
  assert.equal(
    dec.decode(await decryptBytes(key, emptyAad.ciphertext, emptyAad.nonce, new Uint8Array(0))),
    'associated data binding',
  );
});

test('AES-GCM: empty, unicode and long messages round-trip', async () => {
  const key = await generateLocalAesKey();

  // Empty plaintext → ciphertext is exactly the 16-byte tag.
  const empty = await encryptBytes(key, new Uint8Array(0));
  assert.equal(empty.ciphertext.byteLength, AES_GCM_TAG_BYTES);
  assert.equal((await decryptBytes(key, empty.ciphertext, empty.nonce)).byteLength, 0);

  // Unicode (emoji, umlauts, CJK, combining marks, RTL).
  const unicode = 'Grüße 🌍 — こんにちは — مرحبا — e\u0301 — 🇩🇪';
  const u = await encryptBytes(key, enc.encode(unicode), enc.encode('aad-🌍'));
  assert.equal(dec.decode(await decryptBytes(key, u.ciphertext, u.nonce, enc.encode('aad-🌍'))), unicode);

  // Long message (256 KiB). Filled in 64 KiB chunks because
  // crypto.getRandomValues() has a 65536-byte quota per call.
  const long = new Uint8Array(256 * 1024);
  for (let off = 0; off < long.length; off += 65536) {
    crypto.getRandomValues(long.subarray(off, off + 65536));
  }
  const l = await encryptBytes(key, long);
  assert.equal(l.ciphertext.byteLength, long.byteLength + AES_GCM_TAG_BYTES);
  assert.equal(hex(await decryptBytes(key, l.ciphertext, l.nonce)), hex(long));
});

test('AES-GCM: McGrew/Viega AES-256 KAT — Test Case 13 (empty plaintext)', async () => {
  // K = 0^256, IV = 0^96, P = "", A = "" → T = 530f8afb…
  const key = await importAesKey(new Uint8Array(32));
  const tag = unhex('530f8afbc74536b9a963b4f1c4cb738b');
  const plain = await decryptBytes(key, tag, new Uint8Array(12));
  assert.equal(plain.byteLength, 0);
});

test('AES-GCM: McGrew/Viega AES-256 KAT — Test Case 14 (one block)', async () => {
  const key = await importAesKey(new Uint8Array(32));
  const ct = unhex('cea7403d4d606b6e074ec5d3baf39d18' + 'd0d1c8a799996bf0265b98b5d48ab919');
  const plain = await decryptBytes(key, ct, new Uint8Array(12));
  assert.equal(hex(plain), '00'.repeat(16));
});

test('AES-GCM: McGrew/Viega AES-256 KAT — Test Case 16 (with AAD)', async () => {
  const key = await importAesKey(
    unhex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308'),
  );
  const iv = unhex('cafebabefacedbaddecaf888');
  const aad = unhex('feedfacedeadbeeffeedfacedeadbeefabaddad2');
  const expectedPlain =
    'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
    '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39';
  const ct = unhex(
    '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
      '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
      '76fc6ece0f4e1768cddf8853bb2d551b',
  );

  assert.equal(hex(await decryptBytes(key, ct, iv, aad)), expectedPlain);
  // The same ciphertext without the AAD must fail.
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, ct, iv)), true);
});

test('AES-GCM: key/parameter validation', async () => {
  const key = await generateLocalAesKey();
  const aes128 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const hkdfKey = await importKeyMaterial(new Uint8Array(32).fill(5));

  assert.equal(AES_GCM_KEY_BITS, 256);
  // Wrong key algorithm / size
  assert.equal(await isCryptoErrorThrown(() => encryptBytes(hkdfKey, new Uint8Array(1))), true);
  assert.equal(await isCryptoErrorThrown(() => encryptBytes(aes128, new Uint8Array(1))), true);
  // Wrong payload types
  assert.equal(await isCryptoErrorThrown(() => encryptBytes(key, 'not bytes')), true);
  assert.equal(await isCryptoErrorThrown(() => encryptBytes(key, new Uint8Array(1), 'not bytes')), true);
  // Ciphertext shorter than the tag
  assert.equal(await isCryptoErrorThrown(() => decryptBytes(key, new Uint8Array(4), generateNonce())), true);
  // Raw AES key import requires 32 bytes
  assert.equal(await isCryptoErrorThrown(() => importAesKey(new Uint8Array(16))), true);
});

test('AES-GCM: conceptual container round-trips through base64 (test format only)', async () => {
  const key = await generateLocalAesKey();
  const sealed = await encryptBytes(key, enc.encode('container demo'), enc.encode('aad'));

  const container = toSealedContainer(sealed);
  assert.equal(container.version, SEALED_CONTAINER_VERSION);
  assert.equal(typeof container.nonce, 'string');
  assert.equal(typeof container.ciphertext, 'string');

  const parsed = fromSealedContainer(JSON.parse(JSON.stringify(container)));
  assert.equal(hex(parsed.nonce), hex(sealed.nonce));
  assert.equal(hex(parsed.ciphertext), hex(sealed.ciphertext));
  assert.equal(
    dec.decode(await decryptBytes(key, parsed.ciphertext, parsed.nonce, enc.encode('aad'))),
    'container demo',
  );

  // Malformed containers are rejected.
  assert.throws(() => fromSealedContainer(null), CryptoError);
  assert.throws(() => fromSealedContainer({ version: 2, nonce: container.nonce, ciphertext: container.ciphertext }), CryptoError);
  assert.throws(() => fromSealedContainer({ version: 1, nonce: bytesToBase64(new Uint8Array(8)), ciphertext: container.ciphertext }), CryptoError);
});

// ===========================================================================
// D. End-to-end primitive chain (local only)
// ===========================================================================

test('chain: X25519 → HKDF-SHA-256 → AES-256-GCM works in both directions', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const salt = generateSalt();                       // public
  const info = hkdfInfo('demo/local-chain');         // domain separation
  const aad = enc.encode('conceptual-aad');          // format NOT final

  const aliceKey = await deriveMessageKey(
    await deriveSharedSecret(alice.privateKey, bob.publicKey), salt, info);
  const bobKey = await deriveMessageKey(
    await deriveSharedSecret(bob.privateKey, alice.publicKey), salt, info);

  const fromAlice = await encryptBytes(aliceKey, enc.encode('hallo bob'), aad);
  assert.equal(dec.decode(await decryptBytes(bobKey, fromAlice.ciphertext, fromAlice.nonce, aad)), 'hallo bob');

  const fromBob = await encryptBytes(bobKey, enc.encode('hallo alice'), aad);
  assert.equal(dec.decode(await decryptBytes(aliceKey, fromBob.ciphertext, fromBob.nonce, aad)), 'hallo alice');

  // A third party with its own agreement cannot read the traffic.
  const mallory = await generateIdentityKeyPair();
  const malloryKey = await deriveMessageKey(
    await deriveSharedSecret(mallory.privateKey, bob.publicKey), salt, info);
  assert.equal(
    await isCryptoErrorThrown(() => decryptBytes(malloryKey, fromAlice.ciphertext, fromAlice.nonce, aad)),
    true,
  );
});

// ===========================================================================
// E. Security review — invariants enforced by source inspection
// ===========================================================================

test('security: new crypto modules never log', () => {
  for (const file of NEW_MODULES) {
    const src = readCryptoSource(file);
    for (const forbidden of ['console.log', 'console.warn', 'console.error', 'console.debug', 'console.info']) {
      assert.equal(src.includes(forbidden), false, `${file} must not contain ${forbidden}`);
    }
  }
});

test('security: new crypto modules never persist or transmit key material', () => {
  for (const file of NEW_MODULES) {
    // Comments are stripped: only executable code must be free of these.
    const src = readCryptoCode(file);
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'supabase',
      'fetch(',
      'XMLHttpRequest',
      'indexedDB',
      'postMessage',
      'window.location',
      'pkcs8',
    ]) {
      assert.equal(src.includes(forbidden), false, `${file} must not reference ${forbidden}`);
    }
  }
});

test('security: private and derived keys are only ever created non-extractable', () => {
  for (const file of ['key-agreement.ts', 'kdf.ts', 'symmetric.ts']) {
    const src = readCryptoCode(file);
    // Every importKey/deriveKey/generateKey call in these modules passes the
    // documented `/* extractable */ false` flag.
    assert.equal(src.includes('/* extractable */ true'), false, `${file} must not create extractable keys`);
    assert.equal(src.includes('extractable: true'), false);
    // No export of secret key material.
    assert.equal(/exportKey\s*\(/.test(src), false, `${file} must not export key material`);
  }
});

test('security: shared secrets and derived keys stay opaque CryptoKeys', async () => {
  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const ss = await deriveSharedSecret(alice.privateKey, bob.publicKey);
  const key = await deriveMessageKey(ss, generateSalt(), hkdfInfo('opaque'));

  for (const k of [ss, key, alice.privateKey, bob.privateKey]) {
    assert.equal(k.extractable, false);
    await assert.rejects(() => crypto.subtle.exportKey('raw', k));
    await assert.rejects(() => crypto.subtle.exportKey('jwk', k));
  }
  // Serializing the handles reveals nothing secret.
  const dump = JSON.stringify({ ss, key });
  assert.doesNotMatch(dump, /[0-9a-f]{32}/i);
});

test('security: CryptoError from the primitive layer leaks no material', async () => {
  const key = await generateLocalAesKey();
  const sealed = await encryptBytes(key, enc.encode('secret payload'));
  const tampered = Uint8Array.from(sealed.ciphertext);
  tampered[0] ^= 0xff;
  try {
    await decryptBytes(key, tampered, sealed.nonce);
    assert.fail('tampered ciphertext must not decrypt');
  } catch (e) {
    assert.equal(e instanceof CryptoError, true);
    assert.match(e.message, /authentication failed/i);
    const s = JSON.stringify({ name: e.name, message: e.message, stack: e.stack });
    assert.doesNotMatch(s, /secret payload/);
    assert.doesNotMatch(s, new RegExp(hex(sealed.nonce)));
  }
});

// ===========================================================================
// F. Production-integration boundary (nothing is wired up in this phase)
// ===========================================================================

test('boundary: the app-facing crypto barrel does not expose the primitives', async () => {
  const index = await import('../index.ts');
  for (const forbidden of [
    'deriveSharedSecret',
    'deriveMessageKey',
    'deriveKeyBytes',
    'encryptBytes',
    'decryptBytes',
    'encryptMessage',
    'decryptMessage',
    'createSession',
    'establishSession',
    'doubleRatchet',
    'x3dh',
    'pqxdh',
  ]) {
    assert.equal(forbidden in index, false, `index.ts must not export '${forbidden}' in E2EE-2A`);
  }
  // …while the primitive barrel does expose exactly the primitive surface.
  for (const expected of ['deriveSharedSecret', 'deriveMessageKey', 'encryptBytes', 'decryptBytes']) {
    assert.equal(typeof primitives[expected], 'function');
  }
});

test('boundary: the primitive layer implements no session protocol', () => {
  const combined = NEW_MODULES.map(readCryptoCode).join('\n').toLowerCase();
  for (const forbidden of [
    'function x3dh',
    'function pqxdh',
    'class doubleratchet',
    'ratchetstep',
    'chainkey =',
    'rootkey =',
    'skipped_keys',
    'ml-kem',
  ]) {
    assert.equal(combined.includes(forbidden), false, `primitive layer must not contain ${forbidden}`);
  }
  // Every new module states the protocol boundary explicitly.
  for (const file of NEW_MODULES) {
    assert.match(
      readCryptoSource(file),
      /Primitive only; not a Signal\/X3DH\/PQXDH\/Double-Ratchet implementation\./,
    );
  }
});

test('boundary: src/lib/api.ts uses no message crypto', () => {
  const api = fs.readFileSync(new URL('../../api.ts', import.meta.url), 'utf-8');
  for (const forbidden of [
    'encryptMessage',
    'decryptMessage',
    'encryptBytes',
    'decryptBytes',
    'deriveSharedSecret',
    'deriveMessageKey',
    'primitives',
    'key-agreement',
    'symmetric',
  ]) {
    assert.equal(api.includes(forbidden), false, `api.ts must not reference ${forbidden}`);
  }
});

test('boundary: sendMessage() inserts prepared ciphertext and does no cryptography', () => {
  const api = fs.readFileSync(new URL('../../api.ts', import.meta.url), 'utf-8');
  const fn = api.match(/export async function sendMessage\([\s\S]*?\n}\n/);
  assert.ok(fn, 'sendMessage() must exist');
  const body = fn[0];
  assert.match(body, /\.from\('messages'\)/);
  // sendMessage is a pure transport: it inserts the already-prepared
  // `ciphertext` value (an E2EE envelope, or plaintext for My Notes). It must
  // not take a raw `text` param or perform any encryption itself.
  assert.match(body, /sender_id: senderId, ciphertext\b/);
  assert.equal(/ciphertext:\s*text\b/.test(body), false, 'sendMessage must not insert a raw text param');
  for (const forbidden of ['encrypt', 'nonce', 'aad', 'sealed', 'derive', 'ratchet', 'sanitize', 'trim', 'normalize']) {
    assert.equal(body.toLowerCase().includes(forbidden), false, `sendMessage must not mention ${forbidden}`);
  }
});

test('boundary: prekey migration is additive and touches no messages / hand-rolled crypto', () => {
  const dir = new URL('../../../../supabase/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).sort();
  // Phase 2 adds exactly the prekey infrastructure migration; it must exist.
  assert.equal(files.includes('0010_identity_public_key.sql'), true);
  assert.equal(files.includes('0011_crypto_prekeys.sql'), true, 'Phase 2 prekey migration present');
  const m0011 = fs.readFileSync(new URL('0011_crypto_prekeys.sql', dir), 'utf-8');
  // The prekey migration must not alter the messages table or its schema.
  assert.equal(/alter\s+table\s+public\.messages/i.test(m0011), false, '0011 must not alter messages');
  assert.equal(/create\s+table.*messages/i.test(m0011), false, '0011 must not create a messages table');
  // No hand-rolled cryptography in any migration (Signal owns the protocol).
  const combined = files.map((f) => fs.readFileSync(new URL(f, dir), 'utf-8')).join('\n');
  for (const forbidden of ['aes-gcm', 'hkdf', 'shared_secret', 'nonce']) {
    assert.equal(combined.toLowerCase().includes(forbidden), false, `migrations must not mention ${forbidden}`);
  }
});
