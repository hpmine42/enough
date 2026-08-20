# enough. — E2EE-2B Compatibility Spike

**Status:** isolated feasibility spike, not production integration
**Date:** 2026-08-19
**Branch:** `arena/01a01c68-enough`
**Repository HEAD at spike start:** `cec79dbe7f85610660dc57a1710b86dceb6df3b8`
**Scope:** evaluate browser/WASM session engines for future enough. E2EE-2B.

> Result: **B — PROMISING BUT NEEDS FURTHER REVIEW** for `@getmaapp/signal-wasm` as the only tested candidate that currently demonstrates a browser-bundled Signal-style session engine with PQXDH/Kyber prekeys, Double Ratchet behavior, replay rejection, out-of-order delivery, safety numbers, and serializable state. This is **not** a production approval. Legal review, external crypto review, supply-chain review, and a production storage/verification design are mandatory before E2EE-2C.

---

## 1. Goal

E2EE-1 and E2EE-2A established enough.'s local foundation only:

- E2EE-1: X25519 identity key pair, non-extractable private key, IndexedDB storage, public X25519 publication via `profiles.identity_public_key`, migration `0010`, no Ed25519 fallback.
- E2EE-2A: local primitives only: X25519 agreement, HKDF-SHA-256, AES-256-GCM, AAD support and tests. It deliberately did **not** implement X3DH/PQXDH, Double Ratchet, session semantics, message transport, or production E2EE.

This spike evaluates whether an established/pre-reviewed browser/WASM session engine can provide the future session layer for Alice ↔ Bob:

- initial session establishment
- prekey bundle
- PQXDH or comparable modern async session agreement
- Double Ratchet
- forward secrecy
- post-compromise security
- out-of-order messages
- replay protection
- session persistence
- offline messages
- key verification / safety numbers
- prekey management
- session recovery

No production E2EE was implemented.

---

## 2. Repository baseline read before changes

Files/areas reviewed before building the isolated harness:

- `docs/e2ee-architecture.md`
- `src/lib/crypto/README.md`
- E2EE-1 files:
  - `src/lib/crypto/identity.ts`
  - `src/lib/crypto/keys.ts`
  - `src/lib/crypto/prekeys.ts`
  - `src/lib/crypto/storage.ts`
  - `src/lib/crypto/serialization.ts`
  - `src/lib/crypto/errors.ts`
  - `src/lib/crypto/types.ts`
  - `src/lib/crypto/index.ts`
- E2EE-2A files:
  - `src/lib/crypto/key-agreement.ts`
  - `src/lib/crypto/kdf.ts`
  - `src/lib/crypto/symmetric.ts`
  - `src/lib/crypto/primitives.ts`
  - `src/lib/crypto/__tests__/primitives.test.mjs`
- Production message/API boundary:
  - `src/lib/api.ts`
  - `src/components/Chat.tsx`
  - `src/components/MessageComposer.tsx`
  - `src/components/MessageBubble.tsx`
  - `src/context/AuthContext.tsx`
  - `supabase/migrations/`

Baseline observations:

- `src/lib/crypto/index.ts` intentionally does not export E2EE-2A primitives.
- `sendMessage()` still follows the plaintext path by design; E2EE-2A tests assert this boundary.
- `messages` schema remains the existing plaintext-compatible transport shape.
- Current `test:crypto` suite contains 87 tests.

---

## 3. Isolated prototype location

Created isolated spike only:

```text
experiments/e2ee-2b/
  package.json
  package-lock.json
  index.html
  vite.config.ts
  tsconfig.json
  src/main.ts
  src/signal-wasm-harness.ts
  test/signal-wasm.test.mjs
```

Rules enforced:

- No import from production app code into the spike.
- No import from production app code to the spike.
- No import of `@getmaapp/signal-wasm` anywhere under `src/lib`, `src/components`, `src/context`, or `supabase`.
- No Supabase connection.
- No network in the harness.
- No real user keys.
- Runtime keys are fake local Alice/Bob/Mallory test keys only.
- No SQL, no migration, no RLS change.

---

## 4. Engines examined

### 4.1 Candidate A — `@getmaapp/signal-wasm`

| Item | Finding |
|---|---|
| Package | `@getmaapp/signal-wasm` |
| Tested version | `0.6.6` |
| NPM metadata | latest `0.6.6`; package created 2026-01-14; latest published 2026-08-19; 12 visible versions; unpacked size 925,512 bytes; tarball 327.4 KB |
| Repository | `https://github.com/getmaapp/signal-wasm` |
| License | `AGPL-3.0-only` |
| Maintainer | NPM maintainer listed as `thecannabisapp <jia@thecannabis.app>` |
| Upstream crypto | README and `Cargo.toml` state use of Signal's `libsignal` crates, pinned to libsignal `v0.101.0`, commit `b056faa6dd02961cff24064c54c089c52e1a0753` |
| Core dependencies | `libsignal-protocol`, `zkgroup`, `wasm-bindgen`, `getrandom` with WASM/Web Crypto features, `uuid`, `zeroize`, `rand`, `subtle` |
| WASM output | `signal_wasm_bg.wasm` 797.7 KB; JS glue 78.2 KB; `.d.ts` 32.4 KB |
| Official Signal endorsement | Explicitly not affiliated with or endorsed by Signal Technology Foundation |
| Wrapper vs own crypto | Source/package states the protocol core is upstream libsignal crates; wrapper adds WASM bindings, in-memory stores, serialization/export helpers, browser randomness plumbing, safety-number helpers, group wrappers, and prekey consumption reporting. The wrapper is not merely a transparent loader; it contains security-relevant storage/usage/tombstone behavior around libsignal. |

Important source metadata:

- Package README: claims Signal Protocol `(PQXDH + Triple Ratchet)`, Kyber1024, safety numbers, serialization, browser-first Web Crypto randomness.
- `Cargo.toml`: exact-pins `libsignal-protocol` and `zkgroup` to Signal's libsignal repository at commit `b056faa6dd02961cff24064c54c089c52e1a0753`.
- README security caveat: libsignal `PrivateKey` is a `Copy` type over `[u8; 32]` and wrapper cannot guarantee erasure of the identity scalar in WASM linear memory; exported bytes copied into JS memory cannot be erased by Rust.

#### Actual API inspected

From `signal_wasm.d.ts` and package README:

- Initialization:
  - default async WASM init
  - `initSync({ module })` for bytes/module, used by Node test harness
- Identity:
  - `WasmPrivateKey.generate()`
  - `WasmPrivateKey.serialize()` / `deserialize()`
  - `WasmPrivateKey.getPublicKey()`
  - `WasmPublicKey.serialize()` / `deserialize()`
  - `WasmIdentityKeyPair(publicKey, privateKey)`
  - `WasmIdentityKeyPair.serialize()` / `deserialize()`
- Stores:
  - `WasmInMemIdentityKeyStore`
  - `WasmInMemSessionStore`
  - `WasmInMemPreKeyStore`
  - `WasmInMemSignedPreKeyStore`
  - `WasmInMemKyberPreKeyStore`
  - `WasmInMemSenderKeyStore`
- Prekeys:
  - `generatePreKeys(startId, count, prekeyStore)`
  - `generateSignedPreKey(id, identityKeyPair, signedPreKeyStore)`
  - `generateKyberPreKey(id, identityKeyPair, kyberPreKeyStore)`
- Session establishment:
  - `processPreKeyBundle(recipient, localAddress, registrationId, identityKey, signedPreKeyId, signedPreKey, signedPreKeySignature, prekeyId, prekey, kyberPreKeyId, kyberPreKey, kyberPreKeySignature, sessionStore, identityStore)`
- 1:1 messages:
  - `encryptMessage(plaintext, recipient, localAddress, sessionStore, identityStore)`
  - `decryptMessage(ciphertext, messageType, sender, localAddress, sessionStore, identityStore, preKeyStore, signedPreKeyStore, kyberPreKeyStore)`
- Message type constants:
  - `message_type_signal()` → normal Signal message type
  - `message_type_pre_key()` → PreKey message type
  - `message_type_sender_key()`
- Session persistence:
  - `sessionStore.export_session(address)`
  - `sessionStore.import_session(address, bytes)`
  - `sessionStore.has_session(address)`
  - `sessionStore.archive_session(address)`
  - `sessionStore.delete_session(address)`
- Prekey persistence:
  - `preKeyStore.export_pre_key(id)` / `import_pre_key(id, bytes)`
  - `signedPreKeyStore.export_signed_pre_key(id)` / `import_signed_pre_key(id, bytes)`
  - `kyberPreKeyStore.export_kyber_pre_key(id)` / `import_kyber_pre_key(id, bytes)`
  - `kyberPreKeyStore.export_kyber_usage()` / `import_kyber_usage(bytes)` for Kyber anti-replay memory
  - `kyberPreKeyStore.remove_kyber_pre_key(id)` for tombstoning consumed one-time Kyber prekeys
- Replay/prekey consumption reporting:
  - `WasmDecryptResult.plaintext`
  - `WasmDecryptResult.oneTimePreKeyId`
  - `WasmDecryptResult.kyberPreKeyId`
  - `WasmDecryptResult.signedPreKeyId`
- Safety numbers:
  - `generateSafetyNumber(localUuid, localIdentityKey, contactUuid, contactIdentityKey)`
  - `verifyScannableFingerprint(scanned, localUuid, localIdentityKey, contactUuid, contactIdentityKey)`
  - deprecated `verifySafetyNumber(...)`
- Identity proof-of-possession:
  - `signWithIdentityKey(identityPrivateKey, message)`
  - `verifyIdentitySignature(identityPublicKey, message, signature)`
- Group messaging/GV2 exists but was not tested for enough. E2EE-2B 1:1 scope:
  - sender-key distribution, group encryption/decryption, group master keys.

#### Browser/Vite compatibility observed

The isolated Vite production build passed:

```text
vite v6.4.3 building for production...
✓ 5 modules transformed.
dist/index.html                             0.32 kB │ gzip:   0.25 kB
dist/assets/signal_wasm_bg-fOyaQtRb.wasm  797.75 kB │ gzip: 302.94 kB
dist/assets/index-BYuSNaln.js              33.13 kB │ gzip:   8.15 kB
✓ built in 323ms
```

Observed implications:

- Vite can bundle the package in a minimal browser app.
- It emits a separate `.wasm` asset.
- No Node native module is required by the bundled spike.
- No `Buffer`, `fs`, `node:crypto`, or native `.node` binding surfaced in the browser build.
- The package's default async init fetches the WASM asset in browser-like environments.
- Node tests required explicit `initSync({ module: wasmBytes })`; default `init()` attempted a fetch path that Node did not handle for the local file URL.
- No SharedArrayBuffer or cross-origin isolation requirement was observed in the build or tests.
- No worker requirement was observed.
- CSP for production would need to allow loading a same-origin WASM asset; exact `script-src`/`wasm-unsafe-eval` behavior must be verified against the final hosting/browser CSP before production.

#### Prototype test results

Command:

```bash
cd experiments/e2ee-2b
npm test
npm run build
```

Node test summary:

```text
13 passed, 0 failed, 0 info
```

Passing checks:

1. Alice establishes a session from Bob's PreKey/PQXDH bundle and Bob decrypts exactly `Hello Bob`.
2. Bob replies and Alice decrypts exactly `Hello Alice`.
3. Multiple bidirectional messages decrypt correctly: `message 1`, `message 2`, `message 3`, `reply 1`, `reply 2`, `message 4`; exported session records changed across encrypt/decrypt operations, showing evolving API-visible session state.
4. Out-of-order delivery works for `M1`, `M3`, `M2`, followed by `M4`.
5. Offline queued first PreKey ciphertext decrypts after identity/prekey/session store export and restore into new in-memory store instances.
6. Manipulated ciphertext is rejected.
7. Wrong recipient/session cannot decrypt.
8. PreKey bundle with mismatched identity/signature is rejected.
9. Duplicate replay of an already-decrypted message is rejected with error code `DuplicatedMessage`.
10. One-time X25519 and Kyber prekey consumption is surfaced; X25519 prekey is removed by decrypt path; Kyber prekey must be tombstoned by caller using reported `kyberPreKeyId`.
11. PQXDH/Kyber prekey surface was verified: valid Kyber public key/signature accepted; invalid Kyber signature rejected.
12. Safety number display and scannable fingerprint verify cross-perspective.
13. Private/secret-bearing records are exportable from JS API; see private-key handling section.

Limitations of tests:

- The tests validate API behavior, not a mathematical proof of Double Ratchet internals.
- The tests do not audit the Rust wrapper.
- The tests do not inspect the upstream libsignal implementation beyond package/source metadata.
- The tests do not run in a real mobile browser; Vite browser build passes, but physical iOS/Android testing is still required.
- The tests do not implement durable IndexedDB integration; they simulate IndexedDB-compatible byte persistence with exported `Uint8Array` records only.

#### PQXDH finding

`@getmaapp/signal-wasm` exposes `generateKyberPreKey` and requires Kyber prekey material in `processPreKeyBundle`. The tested bundle used:

- Kyber public key: 1569 bytes
- Kyber signature: 64 bytes
- Kyber secret record: 4821 bytes when exported

The invalid-Kyber-signature test failed as expected; a valid Kyber prekey enabled session creation and the first PreKey message decrypted. The package README explicitly calls this PQXDH/Kyber1024 and the `Cargo.toml` pins upstream libsignal `v0.101.0`.

Decision note: this is strong feasibility evidence that the exposed session establishment path includes the Kyber/PQXDH material. It is not an independent cryptographic audit that the binding is perfectly equivalent to Signal's production PQXDH behavior.

#### Private-key handling finding

This is the largest production concern.

The API exposes secret-bearing bytes to JavaScript by design for persistence:

- `WasmPrivateKey.serialize()` returned 32 bytes in the spike.
- `WasmIdentityKeyPair.serialize()` returned 69 bytes.
- `preKeyStore.export_pre_key(id)` returned 71 bytes.
- `signedPreKeyStore.export_signed_pre_key(id)` returned 146 bytes.
- `kyberPreKeyStore.export_kyber_pre_key(id)` returned 4821 bytes.
- `sessionStore.export_session(address)` returns opaque session records containing ratchet/session state.
- `kyberPreKeyStore.export_kyber_usage()` returns anti-replay memory that must be persisted for last-resort Kyber key replay protection.

This differs materially from enough.'s E2EE-1 invariant, where private X25519 identity keys are non-extractable Web Crypto `CryptoKey` objects in IndexedDB. With `@getmaapp/signal-wasm`, identity/private/prekey/session material is exportable/serializable `Uint8Array` data in JS memory. That may be unavoidable for a WASM libsignal wrapper, but production would need:

- encrypted-at-rest IndexedDB design for these records;
- strict no-logging/no-telemetry policy;
- careful lifetime management;
- XSS/service-worker hardening;
- explicit user/account/device scoping;
- key rotation/recovery plan;
- a decision whether this weakens enough.'s current non-extractable-key posture acceptably.

The upstream README itself warns that exported JS byte copies cannot be erased by Rust and that the wrapper cannot guarantee erasure of libsignal identity scalar copies in WASM linear memory.

---

### 4.2 Candidate B — official `@signalapp/libsignal-client`

| Item | Finding |
|---|---|
| Package | `@signalapp/libsignal-client` |
| Inspected version | `0.101.0` |
| Repository | `https://github.com/signalapp/libsignal` |
| License | `AGPL-3.0-only` |
| Maintainers | Signal maintainers on npm |
| Unpacked size | 147,502,186 bytes |
| Dependencies | `node-gyp-build`, `type-fest` |
| Native artifacts | package includes six `.node` native prebuilds for darwin/linux/win32 x64/arm64 |
| Browser support | Not suitable as-is for enough.'s GitHub Pages/mobile browser app |

Inspected package evidence:

- `package.json` includes `prebuilds/*/*.node` and `node-gyp-build`.
- JavaScript files import Node built-ins, e.g. `node:crypto` and `node:buffer`.
- The package ships native `.node` modules, not a browser WASM package.
- TypeScript API exposes Signal protocol concepts (`SessionRecord`, `PreKeySignalMessage`, `PreKeyBundle`, `KyberPreKeyRecord`, etc.), but a TypeScript API is not the same as browser support.

Conclusion:

- Official libsignal is the highest-trust implementation and supports the desired protocol family in native/Node/Electron contexts.
- It is **not currently a direct browser/WASM solution** for enough.'s Vite/GitHub Pages mobile web deployment.
- This spike did not attempt to compile official libsignal to WASM; that would be a separate major build/supply-chain effort and was explicitly out of scope unless trivially available.

---

### 4.3 Candidate C — `@matrix-org/matrix-sdk-crypto-wasm`

| Item | Finding |
|---|---|
| Package | `@matrix-org/matrix-sdk-crypto-wasm` |
| Inspected version | `18.5.0` |
| Repository | `https://github.com/matrix-org/matrix-sdk-crypto-wasm` |
| License | `Apache-2.0` |
| Maintainer | `matrixdotorg <web-releases@element.io>` |
| NPM activity | package active; latest inspected publish 2026-08-10 |
| Unpacked size | 8,904,497 bytes |
| WASM asset | `pkg/matrix_sdk_crypto_wasm_bg.wasm` about 7.8 MB |
| Browser support | Designed for JS hosts including web; README states web entry point fetches WASM and recommends IndexedDB when available |

README/API evidence:

- It is the WebAssembly + JavaScript binding for Rust `matrix-sdk-crypto`.
- It is part of `matrix-rust-sdk`, a Matrix client-server implementation.
- It exposes a no-network-IO state machine named `OlmMachine` for Matrix E2EE clients.
- README example uses `initAsync`, `OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId))`.
- It has separate Node and web entry points; web downloads WASM with `fetch()`.
- It recommends IndexedDB where available.
- Type definitions expose Matrix-specific APIs such as `OlmMachine.encryptRoomEvent`, `decryptRoomEvent`, `outgoingRequests`, cross-signing, room key backup, device identities, verification flows.

Security/session model:

- Matrix uses Olm/Megolm/vodozemac ecosystem rather than Signal Protocol PQXDH/Double Ratchet directly.
- Olm is a 1:1 ratchet used by Matrix; Megolm is a group/session ratchet optimized for rooms with trade-offs different from 1:1 Signal sessions.
- Device model, room key sharing, cross-signing, backup, verification, and outgoing request handling are Matrix-protocol-shaped.
- No PQXDH support was found in the inspected package API/docs.

Conclusion:

- It is browser/WASM mature and well-maintained.
- It is objectively strong for Matrix clients.
- It appears poorly matched to enough.'s standalone Supabase transport unless enough. adopts a Matrix-like device/room/event/key-request model or implements a substantial Matrix-compatibility layer.
- It is not a drop-in Signal/PQXDH session engine for enough.'s 1:1 message transport.

---

## 5. Comparison matrix

Legend: ✅ observed/supported; ⚠️ partial/possible with caveats; ❌ not suitable/not found; ? not proven in this spike.

| Criterion | `@getmaapp/signal-wasm` 0.6.6 | official `@signalapp/libsignal-client` 0.101.0 | `@matrix-org/matrix-sdk-crypto-wasm` 18.5.0 |
|---|---:|---:|---:|
| Browser package | ✅ Vite build passed | ❌ Node/native package | ✅ designed for web JS hosts |
| WASM | ✅ 797.7 KB WASM asset | ❌ npm package ships native `.node`, no browser WASM | ✅ 7.8 MB WASM asset |
| X25519 / Curve25519 | ✅ via libsignal API | ✅ official libsignal | ✅ Matrix/vodozemac ecosystem |
| X3DH | ✅ Signal prekey API surface | ✅ official libsignal | ❌ Matrix Olm, not X3DH API |
| PQXDH | ✅ Kyber prekey API tested | ✅ official libsignal supports PQXDH family, but not browser package | ❌ not found |
| Double Ratchet | ✅ behavior tested through 1:1 messages | ✅ official libsignal | ⚠️ Olm ratchet, not Signal Double Ratchet API |
| Forward secrecy | ✅ expected from Signal session; API behavior consistent | ✅ | ⚠️ Matrix Olm/Megolm have protocol-specific guarantees |
| Post-compromise security | ✅ expected from Signal ratchet; not independently proven | ✅ | ⚠️ Olm yes for 1:1; Megolm group sessions have different self-healing trade-offs |
| PreKeys | ✅ generated/tested | ✅ | ✅ Matrix device/session key model, not Signal PreKey bundle |
| One-Time PreKeys | ✅ generated/consumed/tested | ✅ | ✅ Matrix one-time keys exist in protocol model |
| Signed PreKeys | ✅ generated/tested | ✅ | ⚠️ Matrix-specific signed device/OTK model, not Signal SPK API |
| Kyber/PQ PreKeys | ✅ generated/tested | ✅ official core | ❌ not found |
| Session persistence | ✅ export/import tested | ✅ serializable session records | ✅ Matrix stores/IndexedDB recommended |
| Offline messages | ✅ first queued PreKey ciphertext restored/decrypted | ✅ | ✅ Matrix designed for async sync |
| Out-of-order messages | ✅ M1/M3/M2 tested | ✅ | ✅ Matrix handles event ordering in protocol context |
| Replay protection | ✅ duplicate rejected as `DuplicatedMessage`; Kyber anti-replay usage export exists | ✅ | ✅ Matrix protocol has replay/duplicate protections, details Matrix-specific |
| Identity verification | ✅ safety number + scannable fingerprint tested | ✅ | ✅ cross-signing/SAS/device verification |
| Safety numbers | ✅ 60 digits + scannable | ✅ | ⚠️ Matrix SAS/cross-signing, not Signal safety number |
| TypeScript API | ✅ `.d.ts` | ✅ `.d.ts` | ✅ `.d.ts` |
| Vite | ✅ production build passed | ❌ not browser-buildable as-is | ? likely, not prototyped here |
| Mobile browser | ⚠️ likely but not device-tested | ❌ | ⚠️ likely but not device-tested |
| Bundle size | ✅ modest: ~798 KB WASM + 33 KB JS in spike | ❌ 147.5 MB package native artifacts | ⚠️ ~7.8 MB WASM; larger impact |
| Maintenance | ⚠️ active but young/small maintainer surface | ✅ official Signal | ✅ Matrix.org/Element ecosystem |
| License | ⚠️ AGPL-3.0-only | ⚠️ AGPL-3.0-only | ✅ Apache-2.0 |
| Maturity | ⚠️ new wrapper; not audited by enough. | ✅ most mature/trusted core | ✅ mature for Matrix, less suitable for non-Matrix |
| Audit/trust | ⚠️ upstream libsignal pinned, wrapper not independently reviewed here | ✅ highest trust, official | ✅ strong Matrix ecosystem, protocol mismatch |
| Complexity | ⚠️ manageable API but persistence/tombstone details are subtle | ❌ browser build complexity high | ❌ high if used outside Matrix stack |
| Vendor/protocol lock-in | ⚠️ Signal/libsignal wrapper | ⚠️ official Signal/libsignal | ❌ Matrix room/device/event model lock-in |
| Integration effort | ⚠️ medium/high | ❌ not feasible directly | ❌ high unless adopting Matrix concepts |
| Compatibility with enough. | ⚠️ best current technical fit, needs review | ❌ no browser path | ⚠️ browser-capable but protocol-model mismatch |

---

## 6. Threat model assessment

Assumed attacker capabilities:

- Supabase can read database rows and stored messages.
- Network traffic can be observed.
- Ciphertexts can be manipulated.
- Messages can be replayed.
- Messages can be reordered.
- Account public keys can be swapped by a malicious server/client path if no verification exists.
- Browser storage can be read if the browser/device is compromised.

With a correctly integrated Signal-style engine, expected protections:

- Server/database compromise should not reveal plaintext message contents after production messages are ciphertext-only.
- Passive network observation should see encrypted protocol envelopes only.
- Ciphertext manipulation should fail authentication/decryption.
- Duplicate message replay is rejected by tested `DuplicatedMessage` behavior.
- Out-of-order delivery is handled by skipped-message key behavior in the tested API.
- Prekey bundles enable asynchronous/offline first contact.
- Ratcheting gives forward secrecy and post-compromise recovery properties subject to correct protocol use and uncompromised current endpoints.

Not protected:

- XSS: malicious JS can call the crypto engine and read/export JS-accessible secret records.
- Malicious service worker: can potentially serve altered app code or interfere with fetches unless deployment/update integrity is controlled.
- Compromised browser/device: can read IndexedDB/session material and plaintext at use time.
- Malicious browser extension: same general client compromise problem.
- MITM by replacing identity/prekey bundles unless users verify safety numbers or enough. builds a robust trust/verification model.
- Metadata hiding: Supabase still sees users/connections/timing/message sizes unless redesigned.
- Account takeover/stolen identity: engine cannot know a Supabase account/device was maliciously rekeyed without verification UX and recovery semantics.

---

## 7. enough. architecture sketch for future E2EE-2C

Concept only — not implemented:

```text
enough. App
    |
    v
E2EE Session API
    |
    v
Crypto Engine Adapter
    |
    +-------------------------+--------------------------+
    |                         |                          |
libsignal-compatible      alternative browser       Matrix-like engine
WASM engine               session engine            only if enough. adopts
                                                     its protocol model
```

Longer-term production boundary concept:

```text
UI
 |
 v
Message API
 |
 v
Session Manager
 |
 v
Crypto Engine Adapter
 |    +-- Identity
 |    +-- PreKeys
 |    +-- Session
 |    +-- Ratchet
 |    +-- Encrypt
 |    +-- Decrypt
 |
 v
Transport Envelope
 |
 v
Supabase transport only
```

Supabase must never receive private crypto keys. It may eventually transport only:

- ciphertext/protocol envelope
- public prekey/session material required for session setup
- sender/recipient device metadata
- protocol version/message type
- delivery metadata

---

## 8. Hypothetical message envelope shape

Concept only — not production format, not SQL, not a migration:

```ts
interface E2EEEnvelopeStudyOnly {
  version: number;
  session_id: string;
  sender_device_id: string;
  recipient_device_id: string;
  message_type: 'prekey' | 'signal' | 'sender_key';
  engine: 'signal-wasm' | 'other';
  ratchet_header?: Uint8Array;
  ciphertext: Uint8Array;
  prekey_consumption?: {
    signed_prekey_id?: number;
    one_time_prekey_id?: number;
    kyber_prekey_id?: number;
  };
}
```

For `@getmaapp/signal-wasm`, the concrete minimum from the API is:

- `message_type` numeric Signal message type (`2` Signal, `3` PreKey in observed tests)
- `body` bytes from `WasmCiphertext`
- addressing outside the body via `WasmProtocolAddress(name, deviceId)`
- durable sender/recipient session state keyed by peer address
- durable prekey stores and Kyber usage/tombstone state

---

## 9. Production risks

### 9.1 `@getmaapp/signal-wasm`

Main risks:

1. **Unofficial wrapper:** it is not Signal Technology Foundation endorsed.
2. **Young project:** active releases, but limited long-term track record.
3. **AGPL-3.0-only:** legal compatibility with enough.'s distribution model must be reviewed before production.
4. **Secret exportability:** private identity/prekey/session records are `Uint8Array` in JS/WASM memory, unlike enough.'s current non-extractable Web Crypto identity key posture.
5. **Persistence subtleties:** Kyber one-time prekey tombstoning and `export_kyber_usage()` are security-sensitive. Incorrect durable persistence can re-enable replay or key reuse across reloads.
6. **WASM panic behavior:** README warns release panics brick the instance; production needs recovery/reload design and error telemetry without secrets.
7. **Supply chain:** package is small but sensitive; pinned versions, provenance review, source reproducibility and vendoring policy need review.
8. **Mobile browser:** not tested on iOS Safari/Android Chrome in this spike.

### 9.2 Official libsignal

- Best cryptographic trust, but no direct browser package.
- Compiling/maintaining custom WASM from official libsignal would be a major project and create a fork-like maintenance burden.

### 9.3 Matrix crypto WASM

- Strong browser/WASM maturity, but protocol and state machine are Matrix-specific.
- Using it outside Matrix may mean reimplementing enough. as a mini Matrix client/key server, which is a large product/protocol shift.
- No PQXDH found.

---

## 10. Security review of this spike

Checked:

- No private keys in committed/static files. Runtime keys are generated during tests only.
- No private keys logged. Test output reports only byte lengths and error codes.
- No private keys in URLs.
- No use of `localStorage` in spike source.
- No Supabase import/use in spike source.
- No real Supabase data.
- No network communication in the Node harness.
- No production app import of the spike.
- No spike import from production message APIs.
- No changes to `src/lib/api.ts`.
- No changes to `sendMessage()`.
- No changes to `Chat.tsx`, `MessageComposer`, `MessageBubble`, or `AuthContext`.
- No changes to `src/lib/crypto/index.ts`.
- No changes to E2EE-1 files.
- No changes to E2EE-2A files.
- No changes to `supabase/migrations/`.
- No SQL.

Commands run after implementation:

```bash
cd experiments/e2ee-2b && npm test && npm run build
npm run test:crypto
npm run build
```

Results:

- Isolated signal-wasm spike tests: **13 passed, 0 failed**.
- Isolated Vite spike build: **passed**.
- Existing enough. crypto tests: **87 passed, 0 failed**.
- Existing enough. production build: **passed**.

---

## 11. Recommendation

**Decision: B — PROMISING BUT NEEDS FURTHER REVIEW**

Reasoning:

- `@getmaapp/signal-wasm` is the only examined candidate that currently satisfies the core technical feasibility requirements in an isolated browser/Vite-compatible spike:
  - Alice → Bob first contact via PreKey/PQXDH bundle
  - Bob → Alice reply
  - bidirectional ratcheted session behavior
  - out-of-order messages
  - replay rejection
  - session export/import
  - prekey consumption reporting
  - Kyber prekey API and invalid-signature rejection
  - safety numbers/scannable fingerprint verification
  - Vite production build with WASM asset
- Official `@signalapp/libsignal-client` remains the trust benchmark but is not a browser/WASM package as published on npm.
- Matrix crypto WASM is strong and browser-capable but does not match enough.'s desired standalone Signal/PQXDH 1:1 session model without large Matrix-specific architecture adoption.

Why not `A — RECOMMENDED FOR ENOUGH.` yet:

- Unofficial security-critical wrapper.
- AGPL production implications unresolved.
- No external audit or reproducible source review performed by enough.
- Secret-bearing material is exportable to JS memory, which changes enough.'s current private-key security posture.
- Durable IndexedDB design for sessions/prekeys/Kyber usage is not implemented or reviewed.
- Mobile browser runtime testing not completed.
- No key-verification UX/trust model exists yet.

---

## 12. E2EE-2C prerequisites

Before production E2EE-2C, enough. needs at minimum:

1. Legal review of AGPL-3.0-only dependency implications.
2. Security review of `@getmaapp/signal-wasm` source, not only package metadata.
3. Verification that published npm artifact reproducibly matches reviewed source.
4. Pin exact package version and lockfile strategy.
5. Decide whether JS-exportable identity/prekey/session records are acceptable.
6. Design encrypted IndexedDB persistence for:
   - identity private key record
   - signed prekey private record
   - one-time X25519 prekey records
   - one-time/last-resort Kyber prekey records
   - Kyber anti-replay usage records
   - session records
7. Define durable tombstone semantics for consumed X25519 and Kyber one-time prekeys.
8. Define account/device ID mapping to `WasmProtocolAddress` without leaking private data.
9. Design safety-number/key-verification UX before trusting server-delivered identity keys.
10. Define production envelope format and authenticated associated metadata.
11. Define failure/retry behavior for corrupted state, stale prekeys, replay, duplicated messages, and restored sessions.
12. Test on real mobile browsers: iOS Safari, Android Chrome, Firefox Android.
13. Define CSP and service-worker update/integrity controls for WASM loading.
14. Run performance tests for cold WASM init, key generation, first message, decrypt, and session restore on low-end mobile devices.
15. Keep existing plaintext behavior until all production boundaries are reviewed.

---

## 13. Final boundary statement

This spike did **not** implement production E2EE-2B.

It only established that, as of 2026-08-19, `@getmaapp/signal-wasm` is technically installable, testable, and Vite-buildable as an isolated browser/WASM candidate for enough.'s future session engine, while official libsignal is not directly browser-ready and Matrix crypto WASM is protocol-mismatched for a simple standalone Signal/PQXDH 1:1 integration.

STOP here and wait for an explicit product/security decision before any E2EE-2C production work.
