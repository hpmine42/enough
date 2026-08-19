# enough. — E2EE-2.5 Compatibility Spike

**Isolated test artifact.** This directory is NOT part of the application,
is never imported by `src/`, and does not modify any app behavior,
`sendMessage()`, or the database schema. It exists solely to prove (or
disprove) that the crypto libraries evaluated in
[`docs/e2ee-implementation-feasibility.md`](../../docs/e2ee-implementation-feasibility.md)
actually work in a browser-grade runtime and survive the production build
pipeline (Vite 6, GitHub Pages base path `/enough/`).

## What it tests

1. **WebCrypto baseline (native):** X25519 keygen/ECDH, Ed25519
   keygen/sign/verify (non-extractable), HKDF-SHA-256 against RFC 5869
   Test Case 1, AES-256-GCM (reference vector + roundtrip + AAD binding +
   tamper rejection), `structuredClone` of `CryptoKey` (IndexedDB
   persistence path).
2. **ML-KEM-768 via `mlkem-wasm`** (WASM; core: `mlkem-native`): keygen
   sizes per FIPS 203 (ek 1184 B, ct 1088 B, ss 32 B), encapsulation,
   decapsulation, wire-format import, implicit-rejection semantics on
   tampered ciphertexts.
3. **ML-KEM-768 via `@noble/post-quantum`** (pure TS): seeded deterministic
   keygen, encap/decap, sizes.
4. **Cross-library conformance:** encapsulate with one library, decapsulate
   with the other, in both directions; identical keypairs from identical
   seeds. This is strong evidence (not proof) of FIPS 203 conformance in
   both.
5. **Primitive-composition smoke test:** X25519 outputs ∥ ML-KEM shared
   secret → HKDF (PQXDH-style `F‖KM` framing, zero salt, app `info`) →
   AES-256-GCM roundtrip. This is **not** a PQXDH implementation — no
   handshake flow, no prekey semantics, no key scheduling.
6. **Safety number display construct:** 60-digit fingerprint per the
   Signal/WhatsApp scheme (5200× iterated SHA-512 per side) — validates the
   E2EE-2 claim about the format.

## Run

```bash
cd spikes/e2ee-compat-spike
npm install
npm test          # Node 22 runtime (same check code as the browser page)
npm run build     # Vite production build with base '/enough/'
npm run preview   # serve dist/ and open /enough/ for a real-browser run
```

## Rules

- No file in this directory may be imported from `src/`.
- No production E2EE integration lives here — tests and type declarations
  only (`protocol-adapter.types.ts` contains zero function bodies).
- Results are recorded in `docs/e2ee-implementation-feasibility.md`.
