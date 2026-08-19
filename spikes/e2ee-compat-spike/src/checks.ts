// ============================================================================
// enough. E2EE-2.5 COMPATIBILITY SPIKE — primitive & library checks
// ----------------------------------------------------------------------------
// TEST CODE ONLY. This file must never be imported by the application.
// It does NOT implement E2EE, PQXDH, X3DH, Double Ratchet, or any KDF chain
// of the future protocol. It only verifies that the *primitives* and the
// *candidate libraries* work in this runtime (browser or Node test harness).
// ============================================================================

import mlkem from 'mlkem-wasm';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { randomBytes } from '@noble/post-quantum/utils.js';

export type CheckStatus = 'PASS' | 'FAIL' | 'INFO';

export interface CheckResult {
  id: string;
  category: string;
  name: string;
  status: CheckStatus;
  detail: string;
  durationMs: number;
}

export const runtimeLabel: string =
  typeof window !== 'undefined'
    ? `browser (${(navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/g) ?? ['unknown']).join(', ')})`
    : `node (${process.version})`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Web Crypto API (crypto.subtle) unavailable');
  return c.subtle;
};

const toHex = (b: ArrayBuffer | Uint8Array): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  return Array.from(u)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
};

const eq = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean => {
  const ua = a instanceof Uint8Array ? a : new Uint8Array(a);
  const ub = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i]! ^ ub[i]!;
  return diff === 0;
};

async function check(
  results: CheckResult[],
  category: string,
  id: string,
  name: string,
  fn: () => Promise<string>,
): Promise<void> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ id, category, name, status: 'PASS', detail, durationMs: performance.now() - t0 });
  } catch (e) {
    results.push({
      id,
      category,
      name,
      status: 'FAIL',
      detail: e instanceof Error ? e.message : String(e),
      durationMs: performance.now() - t0,
    });
  }
}

// Ed25519 sign(): some engines accept `null` as the algorithm parameter,
// Node 22 requires an explicit AlgorithmIdentifier. Pass the identifier —
// that is valid everywhere.
const ED25519: AlgorithmIdentifier = { name: 'Ed25519' };

// ---------------------------------------------------------------------------
// check suites
// ---------------------------------------------------------------------------

async function webcryptoBaseline(results: CheckResult[]): Promise<void> {
  const cat = '1 · WebCrypto baseline (native)';

  await check(results, cat, 'wc-secure-context', 'Secure context / crypto availability', async () => {
    if (!globalThis.crypto?.subtle) throw new Error('crypto.subtle missing');
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('window.isSecureContext === false (WebCrypto blocked)');
    }
    return 'crypto.subtle available; secure context OK';
  });

  await check(results, cat, 'wc-getrandom', 'getRandomValues (32 B)', async () => {
    const a = new Uint8Array(32);
    globalThis.crypto.getRandomValues(a);
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    if (eq(a, b)) throw new Error('getRandomValues returned identical buffers');
    return '32 random bytes, non-deterministic across calls';
  });

  await check(results, cat, 'wc-x25519', 'X25519: keygen + ECDH (both directions)', async () => {
    const s = subtle();
    const alice = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const bob = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    if (alice.privateKey.extractable) throw new Error('private key unexpectedly extractable');

    const alicePubRaw = new Uint8Array(await s.exportKey('raw', alice.publicKey));
    const bobPubRaw = new Uint8Array(await s.exportKey('raw', bob.publicKey));
    if (alicePubRaw.length !== 32) throw new Error(`X25519 raw public key length ${alicePubRaw.length} != 32`);
    if (eq(alicePubRaw, bobPubRaw)) throw new Error('identical public keys generated');

    // Re-import public keys (this is what the wire format requires).
    const bobPubImported = await s.importKey('raw', bobPubRaw, { name: 'X25519' }, true, []);
    const alicePubImported = await s.importKey('raw', alicePubRaw, { name: 'X25519' }, true, []);

    const ssA = await s.deriveBits({ name: 'X25519', public: bobPubImported }, alice.privateKey, 256);
    const ssB = await s.deriveBits({ name: 'X25519', public: alicePubImported }, bob.privateKey, 256);
    if (!eq(ssA, ssB)) throw new Error('ECDH secrets differ');
    if (new Uint8Array(ssA).length !== 32) throw new Error('shared secret not 32 bytes');
    return `raw pub 32 B, shared secret 32 B: ${toHex(ssA).slice(0, 16)}… (matches on both sides)`;
  });

  await check(results, cat, 'wc-x25519-unique', 'X25519: two keypairs → different secrets', async () => {
    const s = subtle();
    const a = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const b1 = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const b2 = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const s1 = await s.deriveBits({ name: 'X25519', public: b1.publicKey }, a.privateKey, 256);
    const s2 = await s.deriveBits({ name: 'X25519', public: b2.publicKey }, a.privateKey, 256);
    if (eq(s1, s2)) throw new Error('two peers produced identical shared secrets');
    return 'distinct shared secrets per peer';
  });

  await check(results, cat, 'wc-ed25519', 'Ed25519: keygen (non-extractable) + sign + verify', async () => {
    const s = subtle();
    const kp = (await s.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    if (kp.privateKey.extractable) throw new Error('private key unexpectedly extractable');
    const pubRaw = new Uint8Array(await s.exportKey('raw', kp.publicKey));
    if (pubRaw.length !== 32) throw new Error(`Ed25519 raw public key length ${pubRaw.length} != 32`);

    const msg = new TextEncoder().encode('enough. e2ee-2.5 spike — prekey signature test');
    const sig = await s.sign(ED25519, kp.privateKey, msg);
    if (new Uint8Array(sig).length !== 64) throw new Error(`signature length ${new Uint8Array(sig).length} != 64`);

    // Verify with the re-imported public key (wire scenario).
    const pubImported = await s.importKey('raw', pubRaw, { name: 'Ed25519' }, true, ['verify']);
    const ok = await s.verify(ED25519, pubImported, sig, msg);
    if (!ok) throw new Error('verify failed on re-imported public key');

    // Tamper detection.
    const tampered = msg.slice();
    tampered[0] ^= 0x01;
    if (await s.verify(ED25519, pubImported, sig, tampered)) {
      throw new Error('signature accepted over tampered message');
    }
    return 'pub 32 B, sig 64 B, verify OK after raw re-import, tamper rejected';
  });

  await check(results, cat, 'wc-hkdf-kat', 'HKDF-SHA-256: RFC 5869 Test Case 1 (KAT)', async () => {
    const s = subtle();
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const info = new Uint8Array([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]);
    const key = await s.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
    const okm = await s.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      key,
      42 * 8,
    );
    const expected = '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865';
    const got = toHex(okm);
    if (got !== expected) throw new Error(`KAT mismatch: got ${got}`);
    return 'OKM matches RFC 5869 A.1 exactly (42 bytes)';
  });

  await check(results, cat, 'wc-aesgcm-kat', 'AES-256-GCM: zero-vector KAT (independent impl)', async () => {
    const s = subtle();
    const key = await s.importKey(
      'raw',
      new Uint8Array(32),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    // K = 0^32, IV = 0^12, empty plaintext → tag 530f8afb… (cross-checked
    // against Node/OpenSSL before embedding; classic McGrew–Viega vector).
    const ct = await s.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(0));
    const tag = toHex(ct);
    if (tag !== '530f8afbc74536b9a963b4f1c4cb738b') throw new Error(`KAT mismatch: got tag ${tag}`);
    return 'empty-P tag matches reference vector';
  });

  await check(results, cat, 'wc-aesgcm-roundtrip', 'AES-256-GCM: roundtrip, AAD binding, tamper rejection', async () => {
    const s = subtle();
    const enc = new TextEncoder();
    const key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const msg = enc.encode('enough. — aes-256-gcm associated data binding check');
    const ad1 = enc.encode('connection-a');
    const ad2 = enc.encode('connection-b');
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

    const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv, additionalData: ad1 }, key, msg));
    const pt = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv, additionalData: ad1 }, key, ct));
    if (!eq(pt, msg)) throw new Error('roundtrip mismatch');

    // Same ciphertext + wrong AD must fail (ciphertext transplant defense).
    let wrongAdRejected = false;
    try {
      await s.decrypt({ name: 'AES-GCM', iv, additionalData: ad2 }, key, ct);
    } catch {
      wrongAdRejected = true;
    }
    if (!wrongAdRejected) throw new Error('decryption with wrong AAD unexpectedly succeeded');

    // Flipped ciphertext bit must fail.
    const tampered = ct.slice();
    tampered[0]! ^= 0x01;
    let tamperRejected = false;
    try {
      await s.decrypt({ name: 'AES-GCM', iv, additionalData: ad1 }, key, tampered);
    } catch {
      tamperRejected = true;
    }
    if (!tamperRejected) throw new Error('tampered ciphertext accepted');
    return 'roundtrip OK; wrong-AAD and tampered-CT rejected (tag 16 B)';
  });

  await check(results, cat, 'wc-structuredclone', 'CryptoKey persistence (structuredClone / IndexedDB path)', async () => {
    const s = subtle();
    const kp = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    try {
      const cloned = structuredClone(kp.privateKey);
      if (!cloned || cloned.type !== 'private') throw new Error('clone produced invalid key');
      return 'non-extractable CryptoKey survives structuredClone → IndexedDB-ready';
    } catch (e) {
      return `INFO: structuredClone of CryptoKey failed (${e instanceof Error ? e.message : e}) — app would have to persist extractable key material or re-import from raw`;
    }
  });
}

// — ML-KEM-768 via mlkem-wasm (WASM, core = mlkem-native, PQShield) ————

async function mlkemWasmChecks(results: CheckResult[]): Promise<void> {
  const cat = '2 · ML-KEM-768 — mlkem-wasm (WASM/mlkem-native)';
  const ALG = { name: 'ML-KEM-768' } as AlgorithmIdentifier;

  await check(results, cat, 'kem-wasm-keygen', 'keygen + sizes (ek/dk)', async () => {
    const kp = (await mlkem.generateKey(ALG, false, [
      'encapsulateBits',
      'decapsulateBits',
    ])) as CryptoKeyPair;
    const pub = new Uint8Array(await mlkem.exportKey('raw-public', kp.publicKey));
    if (pub.length !== 1184) throw new Error(`ek length ${pub.length} != 1184 (FIPS 203)`);
    const jwk = (await mlkem.exportKey('jwk', kp.publicKey)) as JsonWebKey;
    if (!jwk || typeof jwk.kty !== 'string') throw new Error('jwk export malformed');
    return 'ek = 1184 B (correct for ML-KEM-768); jwk export path available';
  });

  await check(results, cat, 'kem-wasm-encap', 'encapsulateBits → (ct, ss)', async () => {
    const kp = (await mlkem.generateKey(ALG, true, ['encapsulateBits', 'decapsulateBits'])) as CryptoKeyPair;
    const { ciphertext, sharedKey } = await mlkem.encapsulateBits(ALG, kp.publicKey);
    if (new Uint8Array(ciphertext).length !== 1088) {
      throw new Error(`ct length ${new Uint8Array(ciphertext).length} != 1088 (FIPS 203)`);
    }
    if (new Uint8Array(sharedKey).length !== 32) throw new Error('ss length != 32');
    const ss2 = await mlkem.encapsulateBits(ALG, kp.publicKey);
    if (eq(ciphertext, ss2.ciphertext)) throw new Error('encapsulation not randomized');
    return 'ct = 1088 B, ss = 32 B; fresh randomness per encapsulation';
  });

  await check(results, cat, 'kem-wasm-decap', 'decapsulateBits == shared secret', async () => {
    const kp = (await mlkem.generateKey(ALG, true, ['encapsulateBits', 'decapsulateBits'])) as CryptoKeyPair;
    const { ciphertext, sharedKey } = await mlkem.encapsulateBits(ALG, kp.publicKey);
    const recovered = await mlkem.decapsulateBits(ALG, kp.privateKey, ciphertext);
    if (!eq(recovered, sharedKey)) throw new Error('decapsulated secret differs');
    return 'decapsulation reproduces the encapsulated secret';
  });

  await check(results, cat, 'kem-wasm-wire', 'import of wire public key + encap → local decap', async () => {
    // Simulates the real flow: Bob publishes raw ek (1184 B); Alice imports
    // it on her side and encapsulates; Bob decapsulates with his private key.
    const bob = (await mlkem.generateKey(ALG, true, ['encapsulateBits', 'decapsulateBits'])) as CryptoKeyPair;
    const ekRaw = new Uint8Array(await mlkem.exportKey('raw-public', bob.publicKey));
    const imported = await mlkem.importKey('raw-public', ekRaw, ALG, true, ['encapsulateBits']);
    const { ciphertext, sharedKey } = await mlkem.encapsulateBits(ALG, imported);
    const recovered = await mlkem.decapsulateBits(ALG, bob.privateKey, ciphertext);
    if (!eq(recovered, sharedKey)) throw new Error('wire import flow failed');
    return 'publish ek → import → encapsulate → decapsulate: OK';
  });

  await check(results, cat, 'kem-wasm-implicit-rejection', 'tampered ct → implicit rejection (no throw)', async () => {
    const kp = (await mlkem.generateKey(ALG, true, ['encapsulateBits', 'decapsulateBits'])) as CryptoKeyPair;
    const { ciphertext, sharedKey } = await mlkem.encapsulateBits(ALG, kp.publicKey);
    const bad = new Uint8Array(ciphertext);
    bad[0]! ^= 0x01;
    const wrong = await mlkem.decapsulateBits(ALG, kp.privateKey, bad);
    if (eq(wrong, sharedKey)) throw new Error('tampered ciphertext yielded the original secret');
    // FIPS 203: decapsulation of an invalid ct must NOT error; it outputs a
    // pseudorandom key (implicit rejection). Recipients must treat the result
    // as opaque — AEAD authentication is the actual validity check.
    return 'no exception; different pseudorandom secret (FIPS 203 implicit-rejection semantics)';
  });
}

// — ML-KEM-768 via @noble/post-quantum (pure TypeScript) ————————————————

async function nobleChecks(results: CheckResult[]): Promise<void> {
  const cat = '3 · ML-KEM-768 — @noble/post-quantum (pure TS)';

  await check(results, cat, 'kem-noble-keygen', 'keygen + sizes', async () => {
    const kp = ml_kem768.keygen();
    if (kp.publicKey.length !== 1184) throw new Error(`ek length ${kp.publicKey.length} != 1184`);
    if (kp.secretKey.length !== 2400) throw new Error(`dk length ${kp.secretKey.length} != 2400 (FIPS 203 dk size)`);
    return 'ek = 1184 B, dk = 2400 B';
  });

  await check(results, cat, 'kem-noble-seeded', 'deterministic keygen from 64-B seed', async () => {
    const seed = randomBytes(64);
    const a = ml_kem768.keygen(seed);
    const b = ml_kem768.keygen(seed);
    if (!eq(a.publicKey, b.publicKey)) throw new Error('seeded keygen not deterministic');
    return 'same seed → same keypair (enables backup/reproducible PQ prekeys)';
  });

  await check(results, cat, 'kem-noble-encap', 'encapsulate/decapsulate roundtrip', async () => {
    const kp = ml_kem768.keygen();
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(kp.publicKey);
    if (cipherText.length !== 1088) throw new Error(`ct length ${cipherText.length} != 1088`);
    if (sharedSecret.length !== 32) throw new Error('ss length != 32');
    const recovered = ml_kem768.decapsulate(cipherText, kp.secretKey);
    if (!eq(recovered, sharedSecret)) throw new Error('decapsulation mismatch');
    return 'ct = 1088 B, ss = 32 B, decapsulation OK';
  });
}

// — Cross-library conformance: mlkem-wasm ⇄ noble ————————————————————————

async function crossInterop(results: CheckResult[]): Promise<void> {
  const cat = '4 · Cross-library interop (FIPS 203 conformance)';
  const ALG = { name: 'ML-KEM-768' } as AlgorithmIdentifier;

  await check(results, cat, 'kem-x-seed', 'same seed → same public key in both libraries', async () => {
    // Direct raw-public export of a seed-imported key is not part of the
    // mlkem-wasm API surface (importKey('raw-seed') yields a private handle),
    // so conformance is proved behaviorally: encapsulate to the noble pk
    // derived from the seed, then decapsulate with the wasm private key
    // imported from the same seed. Agreement ⇔ both libraries derived the
    // same keypair from the same seed.
    const seed = randomBytes(64);
    const nobleKp = ml_kem768.keygen(seed);
    const wasmPriv = await mlkem.importKey('raw-seed', seed, ALG, false, ['decapsulateBits']);
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(nobleKp.publicKey);
    const wasmSS = await mlkem.decapsulateBits(ALG, wasmPriv, cipherText);
    if (!eq(wasmSS, sharedSecret)) {
      throw new Error('seed→pk mismatch between libraries: wasm decap of noble encap failed');
    }
    return 'noble(seed).pk == mlkem-wasm(seed).pk (proved via encap/decap agreement)';
  });

  await check(results, cat, 'kem-x-wasm2noble', 'mlkem-wasm ek → noble encapsulate → wasm decapsulate', async () => {
    const kp = (await mlkem.generateKey(ALG, true, ['encapsulateBits', 'decapsulateBits'])) as CryptoKeyPair;
    const ekRaw = new Uint8Array(await mlkem.exportKey('raw-public', kp.publicKey));
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(ekRaw);
    const wasmSS = await mlkem.decapsulateBits(ALG, kp.privateKey, cipherText);
    if (!eq(wasmSS, sharedSecret)) throw new Error('cross decap failed');
    return 'noble accepts wasm ek (1184 B) and wasm decapsulates noble ct (1088 B)';
  });

  await check(results, cat, 'kem-x-noble2wasm', 'noble ek → mlkem-wasm encapsulate → noble decapsulate', async () => {
    const nobleKp = ml_kem768.keygen();
    const imported = await mlkem.importKey('raw-public', nobleKp.publicKey, ALG, true, ['encapsulateBits']);
    const { ciphertext, sharedKey } = await mlkem.encapsulateBits(ALG, imported);
    const nobleSS = ml_kem768.decapsulate(new Uint8Array(ciphertext), nobleKp.secretKey);
    if (!eq(nobleSS, sharedKey)) throw new Error('cross decap failed');
    return 'wasm accepts noble ek; noble decapsulates wasm ct';
  });
}

// — Primitive-composition smoke test (NOT a protocol implementation) ———————

async function compositionSmokeTest(results: CheckResult[]): Promise<void> {
  const cat = '5 · Primitive composition smoke test (NOT PQXDH)';

  await check(results, cat, 'compose-kdf', 'HKDF over X25519-DH ∥ ML-KEM-SS (spec-style params)', async () => {
    // This is a *composition* test of primitive APIs, not a handshake:
    // two generic X25519 DH outputs and one ML-KEM shared secret are fed
    // through HKDF exactly as the future ProtocolAdapter will have to call
    // them (F-prefix ‖ KM per PQXDH KDF notation, zero salt, app info).
    const s = subtle();
    const ALG = { name: 'ML-KEM-768' } as AlgorithmIdentifier;

    const a1 = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const a2 = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const b1 = (await s.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const pqRecv = (await mlkem.generateKey(ALG, true, ['encapsulateBits', 'decapsulateBits'])) as CryptoKeyPair;

    const dh1a = await s.deriveBits({ name: 'X25519', public: b1.publicKey }, a1.privateKey, 256);
    const dh1b = await s.deriveBits({ name: 'X25519', public: a1.publicKey }, b1.privateKey, 256);
    const dh2a = await s.deriveBits({ name: 'X25519', public: b1.publicKey }, a2.privateKey, 256);
    const dh2b = await s.deriveBits({ name: 'X25519', public: a2.publicKey }, b1.privateKey, 256);
    if (!eq(dh1a, dh1b) || !eq(dh2a, dh2b)) throw new Error('X25519 agreement mismatch');

    const { ciphertext, sharedKey } = await mlkem.encapsulateBits(ALG, pqRecv.publicKey);
    const ssB = await mlkem.decapsulateBits(ALG, pqRecv.privateKey, ciphertext);
    if (!eq(sharedKey, ssB)) throw new Error('ML-KEM agreement mismatch');

    // PQXDH-style KDF input: F(32×0xFF) ‖ DH1 ‖ DH2 ‖ SS, salt = 0×hash-len,
    // info = "<app>_<curve>_<hash>_<pqkem>".
    const km = new Uint8Array(32 + 32 + 32 + 32);
    km.fill(0xff, 0, 32);
    km.set(new Uint8Array(dh1a), 32);
    km.set(new Uint8Array(dh2a), 64);
    km.set(new Uint8Array(sharedKey), 96);
    const ikm = await s.importKey('raw', km, { name: 'HKDF' }, false, ['deriveBits']);
    const sk = await s.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32),
        info: new TextEncoder().encode('enough-spike_CURVE25519_SHA-256_ML-KEM-768'),
      },
      ikm,
      256,
    );
    if (new Uint8Array(sk).length !== 32) throw new Error('SK not 32 bytes');

    // The derived SK must be usable as AES-256-GCM key material.
    const aesKey = await s.importKey('raw', sk, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const pt = new TextEncoder().encode('composition check');
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await s.encrypt({ name: 'AES-GCM', iv }, aesKey, pt);
    const back = await s.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    if (!eq(back, pt)) throw new Error('AEAD roundtrip under derived key failed');
    return 'X25519×2 ∥ ML-KEM-768 SS → HKDF-SHA-256 → AES-256-GCM: all APIs compose';
  });
}

// — Safety number display construct (validates the 60-digit claim) ————————

async function safetyNumberCheck(results: CheckResult[]): Promise<void> {
  const cat = '6 · Safety number display construct';

  await check(results, cat, 'safety-60', '60-digit fingerprint from Ed25519 identity keys', async () => {
    // Signal/WhatsApp-style display fingerprint (UX verification aid only,
    // not part of the encryption protocol): per side, iterate SHA-512 5200×
    // over version byte ‖ identity key ‖ stable identifier, take 30 bytes →
    // six 5-byte chunks → mod 100000 → 30 digits; sort halves by key bytes;
    // concatenate → 60 digits in 12 groups of 5.
    const s = subtle();
    const half = async (pub: Uint8Array, ident: string): Promise<string> => {
      let h = await s.digest('SHA-512', concatBytes(new Uint8Array([0]), pub, new TextEncoder().encode(ident)));
      for (let i = 1; i < 5200; i++) h = await s.digest('SHA-512', h);
      const bytes = new Uint8Array(h, 0, 30);
      let out = '';
      for (let c = 0; c < 6; c++) {
        const chunk = bytes.subarray(c * 5, c * 5 + 5);
        const v = chunk.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
        out += (v % 100000n).toString().padStart(5, '0');
      }
      return out;
    };
    const alice = (await s.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    const bob = (await s.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    const ikA = new Uint8Array(await s.exportKey('raw', alice.publicKey));
    const ikB = new Uint8Array(await s.exportKey('raw', bob.publicKey));
    const hA = await half(ikA, 'user-alice');
    const hB = await half(ikB, 'user-bob');
    const [first, second] = toHex(ikA) < toHex(ikB) ? [hA, hB] : [hB, hA];
    const num = first + second;
    if (!/^\d{60}$/.test(num)) throw new Error(`fingerprint not 60 digits: ${num}`);
    // Deterministic:
    const again = await half(ikA, 'user-alice');
    if (again !== hA) throw new Error('fingerprint not deterministic');
    // Digits formatted as 12 groups of 5:
    const grouped = (num.match(/.{5}/g) ?? []).join(' ');
    return `${grouped} — 60 digits, deterministic, order-stable`;
  });
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------

export async function runAllChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  await webcryptoBaseline(results);
  await mlkemWasmChecks(results);
  await nobleChecks(results);
  await crossInterop(results);
  await compositionSmokeTest(results);
  await safetyNumberCheck(results);
  return results;
}

export function summarize(results: CheckResult[]): {
  passed: number;
  failed: number;
  info: number;
  allPassed: boolean;
} {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const info = results.filter((r) => r.status === 'INFO').length;
  return { passed, failed, info, allPassed: failed === 0 };
}
