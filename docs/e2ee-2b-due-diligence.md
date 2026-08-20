# enough. — E2EE-2B Due-Diligence / Security Review

**Status:** security/licensing/architecture review only — **NO IMPLEMENTATION**  
**Date:** 2026-08-20  
**Repository branch:** `arena/01a01c68-enough`  
**Repository HEAD:** `cec79dbe7f85610660dc57a1710b86dceb6df3b8`  
**Subject:** `@getmaapp/signal-wasm` as potential future enough. E2EE session/protocol engine

> Final decision: **PROMISING — BLOCKED ON SPECIFIC ISSUES**. The wrapper remains the only currently demonstrated browser/Vite-compatible Signal/PQXDH-style engine in the enough. spike, but it is **not approved for E2EE-2C** until legal, source, artifact provenance, storage, key lifecycle, and independent security-review blockers are resolved.

---

## 1. Executive Summary

The previous isolated compatibility spike proved that `@getmaapp/signal-wasm@0.6.6` can technically run enough.-style local Alice/Bob tests: PQXDH/Kyber prekey session establishment, 1:1 encryption/decryption, bidirectional ratcheting, out-of-order delivery, replay rejection, session export/import, prekey consumption reporting, safety-number generation, and a minimal Vite browser build.

This due-diligence review asks a different question: **can enough. entrust production E2EE security to this concrete wrapper?**

Answer: **not yet**.

Main positive findings:

- The npm package metadata, source `Cargo.toml`, `Cargo.lock`, README, and WASM binary strings are mutually consistent that the wrapper uses Signal's official `libsignal` repository at `v0.101.0`, commit `b056faa6dd02961cff24064c54c089c52e1a0753`.
- The npm package is small and contains only 6 files: license, README, package metadata, JS glue, TS declarations, and WASM binary.
- The package has no npm runtime dependency other than itself in enough.'s isolated spike dependency tree.
- `npm audit --omit=dev` in the isolated spike reported zero known npm vulnerabilities for the production dependency set.
- The wrapper source has `#![deny(unsafe_code)]`, exact-pinned Rust dependencies in `Cargo.toml`, and a `Cargo.lock` with the expected libsignal commit.
- The wrapper mostly delegates protocol operations (`process_prekey_bundle`, `message_encrypt`, `message_decrypt`, fingerprinting, group operations) to upstream `libsignal_protocol` and `zkgroup`.

Main blockers:

1. **Unofficial security-critical wrapper:** repository is young, low-adoption, and not endorsed by Signal Technology Foundation.
2. **No npm provenance attestation found for `@getmaapp/signal-wasm@0.6.6`:** the npm metadata has an integrity signature but no SLSA/npm provenance attestation field, unlike official `@signalapp/libsignal-client@0.101.0` and `@matrix-org/matrix-sdk-crypto-wasm@18.5.0`.
3. **No reproducible build verified:** the npm artifact does not include source; the WASM binary was not rebuilt and byte-compared in this review. Source-to-binary equivalence remains unproven.
4. **Secret-material model conflicts with enough. E2EE-1:** production identity/prekey/session material is exportable as JS `Uint8Array` bytes, unlike enough.'s current non-extractable Web Crypto private-key invariant.
5. **Persistence correctness is security-critical:** Kyber usage/tombstones, prekey consumption, session records, skipped message keys, and ratchet state must be durably and atomically persisted. The wrapper exposes primitives for this; enough. would own the hard production storage semantics.
6. **AGPL-3.0-only:** both the wrapper and libsignal are AGPL. enough. needs real legal review before shipping a browser app with this dependency.
7. **GitHub release mismatch:** npm has versions through `0.6.6`, but GitHub releases observed through `gh release list` only showed releases up to `v0.2.0`; the npm `gitHead` commit exists, but release-process maturity is unclear.
8. **Outdated repository audit docs:** the repository's `SECURITY_AUDIT_REPORT.md` is for version `0.1.1` and describes older architecture details that do not fully match 0.6.6. It must not be treated as a current independent audit.

Decision: **PROMISING — BLOCKED ON SPECIFIC ISSUES**.

---

## 2. Package Provenance

### 2.1 npm package actually inspected

Command basis:

```bash
npm view @getmaapp/signal-wasm@0.6.6 --json
npm pack @getmaapp/signal-wasm@0.6.6
sha256sum getmaapp-signal-wasm-0.6.6.tgz package/*
```

Observed npm metadata:

| Field | Value |
|---|---|
| package | `@getmaapp/signal-wasm` |
| version | `0.6.6` |
| license | `AGPL-3.0-only` |
| repository | `git+https://github.com/getmaapp/signal-wasm.git` |
| npm maintainer | `thecannabisapp <jia@thecannabis.app>` |
| npm `gitHead` | `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd` |
| created | 2026-01-14T18:39:34.515Z |
| 0.6.6 published | 2026-08-19T12:50:10.444Z |
| tarball shasum | `62ad482454e62187664bd4f9473f8afac2061b07` |
| npm integrity | `sha512-cYpzAe+HV1xfiXJ1tfDEvAjNkIsKwQApmFgniWJw/dTonOx4By6NzJ7J5izi+pjvfrn5zuXa0TmcHJ7Y/bLZYg==` |
| npm file count | 6 |
| npm unpacked size | 925,512 bytes |
| npm provenance attestation | **not present in npm metadata inspected** |

Package file hashes:

| File | Size | SHA-256 |
|---|---:|---|
| tarball | n/a | `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082` |
| `LICENSE` | 1,174 B | `2b87ae924bd39116783dbb5d33770a9fcd4d62a5578204c6304f572bcdc5f091` |
| `README.md` | 15,440 B | `6c1b3f948eec9e7d8527dd5d5ad6fb5b2405e059a51ce292baadd7cdb0d2fe26` |
| `package.json` | 586 B | `677b54900bf2c8fc422e7771efd90d1a5c10b251402c8bcae27d5fd445cddded` |
| `signal_wasm.d.ts` | 32,350 B | `32441be517be4cf6b5bd12506e756d07dabb84859941cffb56657ff4c9dad7f2` |
| `signal_wasm.js` | 78,213 B | `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410` |
| `signal_wasm_bg.wasm` | 797,749 B | `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1` |

### 2.2 Package contents

The npm artifact contains only generated/distribution files:

```text
LICENSE
README.md
package.json
signal_wasm.js
signal_wasm.d.ts
signal_wasm_bg.wasm
```

It does **not** include:

- Rust source (`src/lib.rs`)
- `Cargo.toml`
- `Cargo.lock`
- tests
- build scripts
- Git metadata
- reproducibility manifest
- provenance attestation inside package

Implication: npm artifact review alone is insufficient. For production, enough. must review the Git source at npm `gitHead` and independently reproduce or otherwise verify the WASM binary.

### 2.3 Source repository at npm `gitHead`

Cloned and checked out:

```bash
git clone --no-checkout https://github.com/getmaapp/signal-wasm.git
git checkout --detach 0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd
```

Observed:

- Commit exists.
- No Git tag points at `0a5e3cb8bf282efb3521d7cdac5476caf3fb1acd`.
- Latest local log at checked-out commit:

```text
0a5e3cb feat: re-pin to libsignal v0.101.0 (b056faa6d), add retry-protocol primitives
a253fbc feat!: re-pin libsignal to v0.100.0 (857c4dca0), bump to 0.6.6
e9a173d 0.6.5
a6b1f49 0.6.4
4d5d287 fix: 0.6.1 — group-secret zeroization restructure, error taxonomy, release flattening, prekey-pair validation
```

Repository metadata via `gh repo view`:

| Field | Value |
|---|---|
| repository | `getmaapp/signal-wasm` |
| created | 2026-01-14T12:21:55Z |
| pushed | 2026-08-19T12:52:12Z |
| archived | false |
| fork | false |
| default branch | `main` |
| stars | 12 |
| forks | 4 |
| GitHub license detection | `Other` |
| `LICENSE` content | AGPL-3.0 text plus notice |

GitHub releases observed:

```text
v0.2.0 — Granular API, Async Keygen, libsignal v0.93.1   Latest   2026-05-03
v0.1.2 - libsignal v0.92.0 Update                         2026-04-10
v0.1.1                                                     2026-01-27
v0.1.0                                                     2026-01-14
```

Important uncertainty: npm has `0.6.6`, but GitHub releases list did not show a matching `v0.6.6` release. The npm `gitHead` exists, but release process traceability is weaker than desired.

### 2.4 Upstream libsignal basis

Source `Cargo.toml` at npm `gitHead` states:

```toml
libsignal-protocol = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
zkgroup = { git = "https://github.com/signalapp/libsignal", rev = "b056faa6dd02961cff24064c54c089c52e1a0753" }
```

`Cargo.lock` confirms multiple `libsignal` crates resolved from:

```text
git+https://github.com/signalapp/libsignal?rev=b056faa6dd02961cff24064c54c089c52e1a0753#b056faa6dd02961cff24064c54c089c52e1a0753
```

Official libsignal npm metadata confirms:

| Field | Value |
|---|---|
| official package | `@signalapp/libsignal-client@0.101.0` |
| official `gitHead` | `b056faa6dd02961cff24064c54c089c52e1a0753` |
| `refs/tags/v0.101.0^{}` | `b056faa6dd02961cff24064c54c089c52e1a0753` |
| current checked `refs/heads/main` during review | `b056faa6dd02961cff24064c54c089c52e1a0753` |

The published WASM binary also contains debug/source strings pointing to the same abbreviated libsignal checkout:

```text
/Users/me/.cargo/git/checkouts/libsignal-.../b056faa/rust/protocol/src/pqxdh.rs
/Users/me/.cargo/git/checkouts/libsignal-.../b056faa/rust/protocol/src/triple_ratchet.rs
/Users/me/.cargo/git/checkouts/libsignal-.../b056faa/rust/protocol/src/double_ratchet.rs
```

This strongly corroborates, but does not fully prove, that the npm WASM was built from the reviewed source and official libsignal commit.

### 2.5 Build system and generated code

Source build system:

- Rust crate: `signal-wasm`
- crate type: `cdylib`, `rlib`
- target: `wasm32-unknown-unknown` via `wasm-pack build --target web --scope getmaapp`
- wasm-bindgen generated JS/TS glue
- release profile:
  - `lto = true`
  - `opt-level = "s"`
  - `debug = 0`
  - `panic = "abort"`

Generated npm code:

- `signal_wasm.js`: wasm-bindgen JS glue, exposes wrapper classes/functions.
- `signal_wasm.d.ts`: generated TypeScript declarations containing documentation comments from Rust source.
- `signal_wasm_bg.wasm`: compiled binary. It includes source path strings despite `debug = 0`; these reveal build paths and symbol-ish names but not secrets.

### 2.6 README vs actual code

Consistent:

- README and source both identify libsignal `v0.101.0` commit `b056faa6d`.
- README and source both expose Kyber1024/PQXDH via `generateKyberPreKey` and `processPreKeyBundle`.
- README and source both expose serialization for identity/prekey/session stores.
- README and source both warn about JS-exported secrets and incomplete zeroization for upstream `PrivateKey`.
- README and source both document panic-abort behavior.

Outdated/conflicting repository documentation:

- `SECURITY_AUDIT_REPORT.md` is for `0.1.1`, mentions older libsignal `v0.86.11`, and says `Zeroizing` is used for private keys in a way that does not match current 0.6.6 `WasmPrivateKey(PrivateKey)` architecture. Treat as historical self-review only, not current audit evidence.

---

## 3. Official libsignal Comparison

### 3.1 Official `@signalapp/libsignal-client@0.101.0`

Observed official package facts:

| Field | Value |
|---|---|
| package | `@signalapp/libsignal-client` |
| version | `0.101.0` |
| repository | `github.com/signalapp/libsignal` |
| license | `AGPL-3.0-only` |
| npm `gitHead` | `b056faa6dd02961cff24064c54c089c52e1a0753` |
| npm unpacked size | 147,502,186 bytes |
| npm file count | 222 |
| dependencies | `node-gyp-build`, `type-fest` |
| npm provenance | SLSA/npm provenance attestation present in metadata |
| native artifacts | `.node` prebuilds for darwin/linux/win32 x64/arm64 |

Why official package cannot be used directly in enough. browser:

- It imports Node built-ins such as `node:crypto` and `node:buffer`.
- It ships native `.node` binaries and uses `node-gyp-build`.
- It is designed for Node/Electron/native-client contexts, not static GitHub Pages mobile browsers.

### 3.2 Same libsignal basis?

Yes, for the inspected versions:

- `@getmaapp/signal-wasm@0.6.6` source pins `libsignal` to `b056faa6dd02961cff24064c54c089c52e1a0753`.
- `@signalapp/libsignal-client@0.101.0` npm `gitHead` is the same commit.
- Official tag `v0.101.0^{}` resolves to the same commit.

This means the protocol core version appears aligned at review time.

### 3.3 What the wrapper does itself

The wrapper is not just a packaging shim. It implements or owns security-relevant boundary logic around upstream libsignal.

Wrapper-owned logic observed in `src/lib.rs`:

1. **WASM bindings and type exposure**
   - `WasmPrivateKey`, `WasmPublicKey`, `WasmIdentityKeyPair`
   - store wrappers
   - JS-visible `Vec<u8>` serialization/deserialization APIs

2. **Randomness adaptation**
   - `rand::rng()` with `getrandom` WASM/Web Crypto features.
   - Browser randomness depends on correct `getrandom`/Web Crypto behavior.

3. **Time adaptation**
   - `now_system_time()` uses `js_sys::Date::now()`.
   - Used for prekey/session timestamps.

4. **Custom in-memory stores**
   - `RemovableSessionStore`
   - `ConsumptionTrackingPreKeyStore`
   - `KyberUsageTrackingStore`
   - `RemovableSenderKeyStore`

5. **Session deletion/export/import APIs**
   - `delete_session`, `export_session`, `import_session`, registration-id helper, ratchet-key match helper.

6. **PreKey consumption tracking**
   - Captures consumed X25519 one-time prekey IDs and exposes them via `WasmDecryptResult`.

7. **Kyber anti-replay usage tracking and export/import**
   - Maintains `base_keys_seen` for `(kyberId, signedPreKeyId) -> baseKey[]`.
   - Exports/imports a custom binary format:
     - version byte
     - u32 record count
     - repeated `kyberId u32 BE || signedPreKeyId u32 BE || 33-byte compressed base key`
   - Implements `remove_kyber_pre_key(id)` and prunes usage entries for removed one-time Kyber keys.

8. **Error mapping**
   - Maps `SignalProtocolError` variants to stable JS `Error.code` strings.
   - Release builds flatten messages to `SignalError: Operation failed`, while preserving `.code`.

9. **Input validation**
   - device-id bounds
   - batch-size bounds
   - random byte length bound
   - distribution UUID validation
   - prekey tuple consistency
   - import ID mismatch checks

10. **Safety-number wrapper**
    - Uses upstream `Fingerprint` and exposes display/scannable verification.

11. **Group/SenderKey/GV2 wrapper**
    - Not evaluated for enough. 1:1 E2EE-2B; but present and security-sensitive if ever used.

### 3.4 What remains upstream libsignal

The following important operations appear delegated to upstream `libsignal_protocol` / `zkgroup`:

- `process_prekey_bundle`
- `message_encrypt`
- `message_decrypt`
- `create_sender_key_distribution_message`
- `process_sender_key_distribution_message`
- `group_encrypt`
- `group_decrypt`
- `Fingerprint`
- `KeyPair`, `PrivateKey`, `PublicKey`
- `PreKeyRecord`, `SignedPreKeyRecord`, `KyberPreKeyRecord`, `SessionRecord`
- `kem::KeyPair::generate(kem::KeyType::Kyber1024, ...)`

### 3.5 Risk delta vs official libsignal

| Area | Official libsignal package | `@getmaapp/signal-wasm` |
|---|---|---|
| Trust | Signal-maintained official package | Unofficial wrapper around official Rust crates |
| Browser | Not directly browser-compatible | Browser/WASM-compatible in spike |
| Provenance | npm SLSA/provenance attestation present | npm integrity signature present; no provenance attestation found |
| Storage callbacks | App implements official store traits in native/Node environment | Wrapper implements in-memory stores and exposes byte import/export APIs |
| Secret handling | Native/Node handles/records; not enough. browser-compatible | JS-visible `Uint8Array` secrets for persistence |
| Kyber replay | Official trait semantics; canonical clients persist needed state | Wrapper adds custom usage export/import and tombstone API; enough. must persist correctly |
| Error behavior | Official JS bindings | Wrapper maps/normalizes errors |
| Audit maturity | Official Signal codebase | Wrapper needs separate review |

---

## 4. Secret Material Analysis

### 4.1 Summary table

| Secret | Generated by | Runtime location | JS can access? | Exportable as `Uint8Array`? | Persistence needed? | XSS/App-bundle risk |
|---|---|---|---:|---:|---:|---:|
| Identity private key | `WasmPrivateKey.generate()` → upstream `KeyPair::generate` | WASM/libsignal `PrivateKey`, copied into wrapper structs | ✅ via methods/getters | ✅ `WasmPrivateKey.serialize()`, identity pair serialization | ✅ yes | ✅ high |
| Identity key pair | `WasmIdentityKeyPair` | WASM wrapper + libsignal pair on serialization | ✅ | ✅ `serialize()` | ✅ yes | ✅ high |
| One-time X25519 PreKeys | `generatePreKeys` | upstream `PreKeyRecord` in wrapper store | ✅ via export | ✅ `export_pre_key`, returned record | ✅ until consumed | ✅ high |
| Signed PreKey private key | `generateSignedPreKey` | upstream `SignedPreKeyRecord` in wrapper store | ✅ via export | ✅ `export_signed_pre_key`, returned record | ✅ yes, rotated | ✅ high |
| Kyber private/PQXDH material | `generateKyberPreKey` | upstream `KyberPreKeyRecord` in wrapper store | ✅ via export | ✅ `export_kyber_pre_key` | ✅ yes, tombstoned/rotated | ✅ high |
| Session state | upstream `message_encrypt/decrypt` via store | `SessionRecord` in wrapper store | ✅ via export | ✅ `export_session` | ✅ yes | ✅ high |
| Ratchet state | within `SessionRecord` | WASM/libsignal session record | ✅ through session export | ✅ as part of `SessionRecord` | ✅ yes | ✅ high |
| Message keys / skipped keys | upstream ratchet | likely inside `SessionRecord` during skipped/out-of-order handling; transient in WASM during decrypt | not individually exposed | indirectly if included in serialized session | ✅ as part of session for out-of-order | ✅ high if session exported/stolen |
| Kyber usage/replay state | wrapper `KyberUsageTrackingStore` | wrapper HashMap | ✅ via export | ✅ `export_kyber_usage()` | ✅ for last-resort/live replay protection | ✅ medium/high |
| Group master/sender keys | wrapper + upstream group APIs | WASM/wrapper stores | ✅ via group APIs | ✅ sender-key export, group master key serialization | only if groups used | ✅ high |

### 4.2 Per-secret analysis

#### Identity Private Key

1. Generated by `WasmPrivateKey.generate()` using upstream `KeyPair::generate(&mut rng)`.
2. Stored inside `WasmPrivateKey(PrivateKey)`; source warns upstream `PrivateKey` is a `Copy` type over `[u8; 32]` and not zeroized on drop.
3. JS can call `serialize()` and receive raw private key bytes.
4. Serializable and deserializable.
5. Can be stored in IndexedDB as bytes.
6. Could land in `localStorage`, React state, logs, URLs, or Supabase if app code mishandles bytes. The wrapper does not prevent that.
7. XSS or compromised app bundle can export it.

#### Identity Key Pair

1. Constructed from public/private key.
2. `WasmIdentityKeyPair.serialize()` returns standard libsignal protobuf bytes containing the private half.
3. `private_key` getter returns a `WasmPrivateKey` wrapper, which can serialize.
4. Same JS exposure risks as identity private key.

#### One-Time PreKeys

1. Generated by `generatePreKeys(startId, count, prekeyStore)`.
2. Stored as upstream `PreKeyRecord` in wrapper `ConsumptionTrackingPreKeyStore`.
3. Exportable by `export_pre_key(id)`.
4. Decrypt path removes consumed X25519 prekeys from the in-memory store and reports `oneTimePreKeyId`.
5. Durable store must atomically delete/tombstone consumed IDs after successful decrypt.
6. Storage rollback can reuse one-time prekeys.

#### Signed PreKey Private Key

1. Generated by `generateSignedPreKey`.
2. `KeyPair::generate`, signed by identity private key.
3. Stored as `SignedPreKeyRecord` and exportable.
4. Not one-time; requires rotation policy.
5. Exposure allows attacks depending on identity/session state and protocol context; must be protected as long-lived secret material.

#### Kyber Private Key / PQXDH Material

1. Generated by `kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut rng)`.
2. Stored as `KyberPreKeyRecord` in wrapper store.
3. Exportable as 4821-byte secret-bearing record observed in spike.
4. Consumption/tombstone semantics are split:
   - `decryptMessage` reports `kyberPreKeyId`.
   - caller must decide whether it was one-time or last-resort and call `remove_kyber_pre_key` for one-time keys.
   - last-resort keys must retain usage triples.
5. Durable storage loss or rollback can re-enable decapsulation/replay hazards.

#### Session / Ratchet State / Message Keys

1. Created and advanced by upstream `message_encrypt` / `message_decrypt`.
2. Stored in `SessionRecord` in wrapper `WasmInMemSessionStore`.
3. Exportable via `export_session(address)`.
4. Contains ratchet state, chain state, possibly skipped message keys for out-of-order delivery.
5. Must be persisted atomically after every encrypt/decrypt that changes state.
6. Stale backup restore can roll back counters and replay state.

### 4.3 Comparison with enough. E2EE-1 invariant

enough. E2EE-1 invariant:

- X25519 identity private key is a non-extractable Web Crypto `CryptoKey`.
- Private identity keys are persisted as non-extractable `CryptoKey` objects in IndexedDB.
- Private identity keys are never available as raw JS bytes.

`@getmaapp/signal-wasm` model:

- Long-term identity private key is serializable to JS bytes.
- Identity pair is serializable to JS bytes.
- Prekeys/session records are serializable JS bytes.
- Durable storage must store opaque secret-bearing byte records.

Compatibility assessment:

- **Not directly compatible** with the current E2EE-1 private-key non-extractability invariant.
- The deviation is fundamental to the wrapper's current API because persistence requires exporting/importing libsignal records as bytes.
- It can be **architecturally contained** only by creating a stricter application boundary:
  - isolated `CryptoEngineAdapter`
  - no UI/React state exposure
  - no logs/URLs/localStorage
  - encrypted IndexedDB records
  - strict TypeScript types marking secret bytes
  - lint/static tests preventing secret flow into Supabase/logs
  - strong XSS/CSP/service-worker controls
- It cannot preserve the stronger statement “identity private keys are non-extractable Web Crypto keys.” enough. would need to explicitly revise its production security model if this engine is adopted.

---

## 5. WASM Security Boundary

### 5.1 What runs in WASM

- libsignal protocol core compiled from Rust crates.
- wrapper store implementations.
- wrapper error mapping.
- wrapper serialization/deserialization.
- safety-number/fingerprint functions.
- group/sender-key wrappers.

### 5.2 What runs in JavaScript

- wasm-bindgen glue.
- app-controlled calls into exported WASM functions/classes.
- storage decisions.
- persistence encryption, if any.
- all movement of exported `Uint8Array` records.
- all integration with UI/network/Supabase.

### 5.3 Secret flow across boundary

Secrets passed JS → WASM:

- serialized identity private key / identity pair via `deserialize`
- serialized prekey records via `import_pre_key`
- serialized signed prekey records via `import_signed_pre_key`
- serialized Kyber prekey records via `import_kyber_pre_key`
- serialized session records via `import_session`
- Kyber usage bytes via `import_kyber_usage`
- plaintext messages for encryption
- ciphertexts for decryption

Secrets returned WASM → JS:

- identity private key bytes via `WasmPrivateKey.serialize()`
- identity keypair bytes via `WasmIdentityKeyPair.serialize()`
- prekey/signed-prekey/Kyber records via store export APIs
- session records via `export_session`
- Kyber usage bytes via `export_kyber_usage`
- plaintext after decryption
- group secrets if group APIs are used

### 5.4 Memory protection and zeroization

Observed source/README statements:

- `#![deny(unsafe_code)]` is enabled.
- `Zeroizing` is used for wrapper-owned secret-bearing buffers such as generated record bytes and group master key bytes.
- The source explicitly warns that upstream `PrivateKey` is a `Copy` type over `[u8; 32]` and the wrapper cannot guarantee erasure of the scalar itself.
- Bytes exported to JS are copies managed by the JS engine and cannot be erased by Rust.
- WASM linear memory is in the same origin and callable by app JS; it is not a hardware or browser enclave.

Assessment:

- WASM is a packaging/runtime boundary, not a confidentiality boundary against the application.
- XSS or compromised application JS can call exported methods and exfiltrate secrets.
- JS `Uint8Array` copies can be duplicated by structured clone, logging, devtools, React state, crash reporters, or accidental serialization.
- Zeroization is best-effort and incomplete for exported JS bytes and upstream copied private-key values.

---

## 6. Persistence Analysis

### 6.1 Data enough. would need to persist

For a single-device 1:1 production integration, enough. would need durable per-user/per-device storage for at least:

- identity key pair record
- registration ID
- device address mapping
- trusted peer identity keys / trust state
- generated one-time X25519 prekey records
- signed prekey records and rotation metadata
- Kyber prekey records and one-time/last-resort classification
- Kyber usage anti-replay records
- consumed/tombstoned prekey IDs
- session records per peer/device
- pending durable write transactions for send/decrypt state updates
- safety-number verification state
- local metadata for session recovery / reset

### 6.2 IndexedDB feasibility

Yes, these are `Uint8Array`/structured-clone-compatible bytes and can technically be stored in IndexedDB.

But simple plaintext IndexedDB storage would mean:

- XSS can read all secrets.
- compromised app bundle can read all secrets.
- browser profile compromise can read all secrets.
- backup/sync tooling might persist raw records depending on browser/platform behavior.

enough. must decide whether this is acceptable for a browser E2EE app. E2EE-1 intentionally avoided raw private identity bytes by storing non-extractable Web Crypto keys; this wrapper cannot maintain that exact property.

### 6.3 IndexedDB encryption design questions

If records are encrypted at rest, enough. needs a root key. Options and issues:

| Root key option | Benefit | Problem |
|---|---|---|
| Non-extractable Web Crypto wrapping key in IndexedDB | aligns somewhat with E2EE-1 | if same origin JS can invoke unwrap/decrypt, XSS can still use it; recovery hard |
| User passphrase-derived key | better at-rest story across browser compromise when locked | UX friction, forgotten password recovery problem, offline unlock flow |
| Server-assisted wrapped key | recovery easier | server becomes part of security story; must avoid giving server plaintext key |
| Platform credentials/WebAuthn/Passkeys | stronger local unlock | browser/platform complexity, mobile compatibility, backup/recovery challenges |
| Plain IndexedDB | simplest | weakest; major downgrade from E2EE-1 invariant |

No implementation was created.

### 6.4 Atomicity and crash consistency

Critical operations require atomic durable state updates:

- after encrypt: session record changes and must be saved before/with message enqueue/send semantics;
- after decrypt: session record changes and consumed prekeys/tombstones/usage records must be saved;
- after first PreKey decrypt: session creation + one-time prekey deletion + Kyber tombstone/usage updates are one logical transaction;
- on replay rejection: must not roll back to a state that accepts the replay after reload;
- on failed durable save: wrapper has `delete_session` for rollback, but enough. would need robust transaction semantics around it.

IndexedDB supports transactions within a database, but enough. must design object stores and transaction boundaries carefully.

### 6.5 Multi-tab risks

Multiple tabs can race:

- two tabs decrypt the same PreKey message;
- one tab consumes/tombstones a prekey while another still has old in-memory store;
- two tabs encrypt simultaneously and persist divergent session states;
- one tab restores stale session/prekey state after another advances it.

Production likely needs:

- single crypto worker/leader tab;
- Web Locks API or BroadcastChannel coordination;
- monotonic session versioning/compare-and-swap;
- durable transaction IDs;
- conflict handling and forced session repair.

### 6.6 Storage loss / logout / device change

- Browser storage loss destroys identity/session state; peers see safety-number/key changes and sessions must reset.
- Logout should not necessarily delete crypto state; enough. current E2EE-1 preserves local identity across logout. This requires explicit per-user scoping for wrapper records.
- Account deletion must wipe wrapper records.
- Device change implies new identity/device address and verification flow.
- Restoring old backups is dangerous: session/prekey rollback can break replay protection and one-time semantics.

---

## 7. PQXDH / Kyber Analysis

### 7.1 Kyber prekey generation

Source:

```rust
let key_pair = kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut rng);
let signature = identity_key_pair.private_key.0.calculate_signature(&key_pair.public_key.serialize(), &mut rng)?;
let kyber_record = KyberPreKeyRecord::new(key_id.into(), timestamp, &key_pair, &signature);
```

Findings:

- Kyber key generation uses upstream libsignal KEM type `Kyber1024`.
- Kyber public key is signed by the identity private key.
- Kyber record is stored in wrapper's Kyber prekey store.
- Public key/signature are returned to JS for upload in a future production design.
- Secret record is exportable.

### 7.2 PreKey bundle

`processPreKeyBundle` creates upstream `PreKeyBundle::new(...)` with:

- remote registration ID
- remote device ID
- optional one-time X25519 prekey
- signed prekey ID/public/signature
- Kyber prekey ID/public/signature
- identity key

Then delegates to upstream `process_prekey_bundle(...)`.

### 7.3 Consumption and tombstones

Decrypt path:

- clears prior consumed markers;
- calls upstream `message_decrypt`;
- takes consumed X25519 and Kyber marker lists;
- returns IDs through `WasmDecryptResult`.

For X25519 one-time prekeys:

- wrapper `ConsumptionTrackingPreKeyStore` removes consumed records during `remove_pre_key` callback.
- enough. must durably delete/tombstone the same ID.

For Kyber:

- libsignal trait does not distinguish one-time vs last-resort in the wrapper's store.
- wrapper reports `kyberPreKeyId`.
- caller must tombstone/delete one-time Kyber key by calling `remove_kyber_pre_key(id)` and persist that deletion.
- last-resort Kyber keys must not be deleted; their anti-replay usage records must persist.

### 7.4 Replay protection state

Wrapper maintains `base_keys_seen` keyed by `(kyberId, signedPreKeyId)` and sender base key.

Durable state required:

- live Kyber prekey records;
- deleted one-time Kyber prekey tombstones;
- for live last-resort Kyber keys: persisted `export_kyber_usage()` bytes;
- signed prekey association;
- session state after decrypt.

If not persisted correctly:

- replayed PreKey messages may be accepted after browser restart;
- a consumed one-time Kyber private key may be reused after restore;
- old backups may resurrect prekeys;
- parallel tabs may process same first message twice.

### 7.5 Failure scenarios

| Scenario | Risk |
|---|---|
| Browser restart with persisted current state | OK if session/prekey/Kyber usage/tombstones are all restored correctly |
| IndexedDB loss | identity/session reset; peers need key-change warnings; offline messages may be undecryptable |
| Parallel tabs | high race risk without locking/CAS |
| Crash after decrypt before tombstone persist | one-time prekey/Kyber replay risk |
| Crash after sending before session persist | sender may resend/advance inconsistently |
| Offline messages | feasible, but skipped keys/session state must persist after each decrypt |
| Old session backup restore | dangerous rollback; should be rejected or versioned with anti-rollback strategy |

---

## 8. Double Ratchet Analysis

### 8.1 API-level behavior

The isolated spike showed:

- first-contact session establishment;
- message encryption/decryption;
- bidirectional messages;
- session state mutation;
- out-of-order decrypt;
- duplicate replay rejection;
- session export/import.

### 8.2 Implementation/API evidence

WASM binary strings and source imports reference upstream libsignal modules:

- `double_ratchet.rs`
- `triple_ratchet.rs`
- `ratchet/keys.rs`
- `state/session.rs`
- `session_management.rs`
- `MessageKeys::derive_keys`

Wrapper itself does not implement the Double Ratchet math; it delegates message encryption/decryption to upstream:

```rust
message_encrypt(...)
message_decrypt(...)
```

### 8.3 State persistence

`SessionRecord` is exported/imported as bytes. This record likely contains, based on binary strings and libsignal naming:

- current session
- previous sessions
- root key
- sender chain
- receiver chains
- sender ratchet key/private
- chain keys
- message keys/skipped keys
- pending prekey / pending Kyber prekey
- registration IDs

Production must treat the entire session record as high-value secret material.

### 8.4 Corruption behavior

The wrapper exposes `SessionRecord::deserialize` through `import_session`; malformed records should fail via upstream error handling. The spike did not deeply fuzz corrupt session states.

Production requirements:

- detect corruption;
- fail closed;
- provide user/session reset UX;
- never silently create a new trust relationship without warning;
- never upload corrupted/private state.

---

## 9. Identity Verification

### 9.1 Identity key

`WasmPrivateKey` / `WasmPublicKey` are Curve25519/libsignal identity keys, not Web Crypto `CryptoKey` objects. Public keys are serializable. Private keys are serializable.

### 9.2 Safety numbers

Wrapper exposes:

- `generateSafetyNumber(localUuid, localIdentityKey, contactUuid, contactIdentityKey)`
- `verifyScannableFingerprint(scanned, localUuid, localIdentityKey, contactUuid, contactIdentityKey)`

The spike confirmed:

- 60 display digits;
- scannable bytes;
- cross-perspective verification works.

### 9.3 Missing enough. decisions

To implement safe 1:1 verification, enough. still needs:

- trust-on-first-use policy or stricter verification-before-send policy;
- UI for safety number comparison and QR scan;
- behavior on identity key change;
- behavior on device replacement;
- per-device vs per-account verification model;
- storage of verified identity state;
- warning UX before sending after identity change;
- recovery/reset UX;
- blocked/compromised account flow.

The engine can provide fingerprints; it cannot define enough.'s user trust semantics.

---

## 10. Security History

### 10.1 `@getmaapp/signal-wasm`

Checks performed:

- `gh api repos/getmaapp/signal-wasm/security-advisories`
- `gh issue list -R getmaapp/signal-wasm --state all --search 'security OR vulnerability OR CVE OR replay OR kyber'`
- `npm audit --omit=dev` in isolated spike
- web searches for package-specific CVEs/advisories

Findings:

- No repository security advisories were returned by GitHub API during this review.
- GitHub issue search returned no matching issues.
- `npm audit --omit=dev` returned zero known npm vulnerabilities for the isolated production dependency tree.
- No package-specific CVE for `@getmaapp/signal-wasm` was found in web search during this review.

Limitations:

- Absence of advisories is not proof of security.
- Young/low-adoption packages may have few reports because they have had little scrutiny.
- Rust dependency advisories were not fully audited with `cargo audit` in this review.
- Repository's own `SECURITY_AUDIT_REPORT.md` is historical/self-review for version 0.1.1, not a current independent audit.

### 10.2 libsignal ecosystem notes

Known public security discussions around Signal/libsignal ecosystem exist, including issues outside the narrow `libsignal_protocol` use in this wrapper. Example: a reported `libsignal-service-rs` authentication bypass (`CVE-2025-24904` / `GHSA-hrrc-wpfw-5hj2`) concerns service/envelope handling rather than this wrapper's standalone `libsignal_protocol` message engine. It is relevant as a reminder that integration layers can break E2EE guarantees even when protocol primitives are strong.

### 10.3 Matrix/vodozemac notes

Matrix/vodozemac has had public cryptographic controversy/advisories, including Matrix's published response to reported vodozemac issues and a `matrix-sdk-crypto` sender-binding advisory (`CVE-2026-45056`) in older crate versions. These do not directly affect `@getmaapp/signal-wasm`, but they matter when comparing alternatives.

---

## 11. Supply Chain

### 11.1 npm integrity and lockfile

The isolated spike pins:

```json
"@getmaapp/signal-wasm": "0.6.6"
```

`package-lock.json` records the resolved tarball and integrity. Production, if ever approved, must use exact versions and `npm ci`.

### 11.2 npm provenance

Observed:

- `@getmaapp/signal-wasm@0.6.6`: npm `dist.signatures` present; no `dist.attestations` field found.
- official `@signalapp/libsignal-client@0.101.0`: npm `dist.attestations` with SLSA provenance present.
- `@matrix-org/matrix-sdk-crypto-wasm@18.5.0`: npm `dist.attestations` present.

`npm audit signatures` was attempted but failed due network/TUF connectivity (`ECONNRESET`). This remains unverified in this environment.

### 11.3 Source-vs-binary gap

Corroborating evidence:

- npm `gitHead` exists in source repository.
- README in package exactly matches source README at `gitHead`.
- `Cargo.toml`/`Cargo.lock` at source commit pin libsignal commit matching package README and WASM strings.
- WASM binary strings reference `b056faa` libsignal paths and relevant protocol source files.

Not proven:

- that `signal_wasm_bg.wasm` was built from that exact source;
- that build flags match source release profile;
- that no local modifications existed during build;
- that a rebuild would produce byte-identical artifact;
- that no malicious or accidental code exists only in the binary.

Production requirement:

- reproduce build in controlled CI/container;
- compare SHA-256 of generated `signal_wasm_bg.wasm`, `signal_wasm.js`, and `.d.ts` to npm artifact;
- require npm provenance or vendor the audited artifact;
- track tarball SHA/integrity in security documentation.

### 11.4 Rust dependency tree

`Cargo.lock` at source commit contains 240 Rust packages. Important pinned entries include:

- `libsignal-protocol` from official libsignal commit `b056faa6...`
- `zkgroup` from same commit
- `wasm-bindgen = 0.2.126`
- `getrandom = 0.2.17`, `0.3.4`, and transitive `0.4.3`
- `uuid = 1.24.0`
- `zeroize = 1.9.0`
- `rand = 0.9.5` and transitive `0.10.2`
- `subtle = 2.6.1`

Production requirement:

- run `cargo audit` / RustSec review;
- review license metadata for all Rust crates;
- pin source commit and lockfile;
- avoid automatic dependency updates without review.

---

## 12. Licensing

### 12.1 Wrapper license

`@getmaapp/signal-wasm` package and repository license: **AGPL-3.0-only**.

The package `LICENSE` says the WASM bridge is built on libsignal, also AGPL-3.0.

### 12.2 libsignal license

Official `@signalapp/libsignal-client@0.101.0` license: **AGPL-3.0-only**.

### 12.3 Browser app implications

Non-legal technical interpretation:

- Shipping AGPL code in a browser app is distribution/conveyance of client-side code to users.
- AGPL has strong source-code availability obligations, including network-use oriented obligations.
- enough. must understand whether its full corresponding source, build scripts, and any modifications/integration code must be offered under compatible terms.
- If enough. is already fully open-source under a compatible license, this may be manageable, but cannot be assumed.
- If enough. intends proprietary components, AGPL may be incompatible.
- WASM does not avoid license obligations.

This is **not legal advice**. A real legal review is REQUIRED before production use.

### 12.4 Transitive dependencies

NPM runtime dependency surface is minimal: the package bundles JS/WASM and declares no npm dependencies.

Rust transitive dependencies are many and have varied licenses. Production needs a generated license inventory from the source build, e.g. with `cargo-about` or equivalent.

---

## 13. Browser Compatibility

### 13.1 Verified in spike

- Vite production build passed.
- Browser-style WASM asset emitted.
- No native Node module surfaced in bundle.
- No SharedArrayBuffer requirement observed.
- No worker requirement observed.
- No COOP/COEP requirement observed.

### 13.2 Not verified

The following were not tested in real devices/browsers:

- Android Chrome runtime behavior
- iOS Safari runtime behavior
- desktop Safari runtime behavior
- Firefox runtime behavior
- PWA/backgrounding behavior
- tab suspension during crypto operations
- low-memory mobile WASM behavior
- IndexedDB storage eviction behavior
- service-worker update races
- CSP with production policy
- browser-specific WASM CSP requirements
- long sessions with many skipped message keys
- multi-tab concurrency

### 13.3 Browser risk notes

- WASM loading may require CSP allowances such as `wasm-unsafe-eval` or browser-specific alternatives depending on final bundler/runtime behavior.
- iOS Safari can evict storage more aggressively than desktop browsers.
- Backgrounded tabs can suspend operations mid-transaction.
- Service worker compromise/update bugs can undermine all E2EE by serving malicious JS.
- Web Crypto is used indirectly for randomness through `getrandom`; secure context is required.

---

## 14. Performance

Measured in the isolated spike only:

- WASM asset: ~797.75 KB raw, ~302.94 KB gzip.
- Spike JS bundle: ~33.13 KB raw, ~8.15 KB gzip.
- Node tests for 13 checks completed quickly; individual operations were millisecond-scale in the sandbox.

Not production-verified:

- cold WASM initialization on mobile;
- first session creation on low-end Android;
- Kyber prekey generation batch cost;
- decrypt cost for large skipped-key windows;
- IndexedDB encrypted persistence overhead;
- memory pressure after long chat sessions;
- lazy-loading impact on first message UX.

Recommendation:

- lazy-load the crypto engine only when E2EE is enabled/needed;
- run mobile performance budget tests before E2EE-2C approval;
- set thresholds for prekey generation, initial session creation, encrypt/decrypt, and restore.

---

## 15. Alternative Engines

### 15.1 Comparison table

| Kriterium | official `@signalapp/libsignal-client` | `@getmaapp/signal-wasm` | `@matrix-org/matrix-sdk-crypto-wasm` |
|---|---|---|---|
| Browser | ❌ not as published | ✅ spike Vite build passed | ✅ designed for web JS hosts |
| WASM | ❌ npm ships native `.node` | ✅ bundled WASM | ✅ bundled WASM |
| X25519 | ✅ | ✅ via libsignal | ✅ Matrix/vodozemac ecosystem |
| PQXDH | ✅ in official core | ✅ Kyber/PQXDH API tested | ❌ not found |
| Double Ratchet | ✅ | ✅ delegated to libsignal; behavior tested | ⚠️ Olm ratchet, not Signal DR API |
| PreKeys | ✅ | ✅ tested | ✅ Matrix-specific key model |
| Replay Protection | ✅ | ✅ replay + Kyber usage mechanisms | ✅ Matrix-specific, advisory history exists |
| Out-of-order | ✅ | ✅ tested | ✅ protocol-specific |
| Identity Verification | ✅ | ✅ safety numbers tested | ✅ SAS/cross-signing |
| Secret Handling | native/Node; not browser enough.-compatible | JS-exportable byte records | Matrix stores; secret handling tied to Matrix SDK model |
| Persistence | official store traits | wrapper export/import; enough. owns IndexedDB design | IndexedDB recommended; Matrix state machine owns much semantics |
| Maintenance | ✅ Signal official | ⚠️ young, small maintainer surface | ✅ Matrix/Element ecosystem |
| Provenance | ✅ npm SLSA attestation | ⚠️ integrity only; no attestation found | ✅ npm SLSA attestation |
| License | AGPL-3.0-only | AGPL-3.0-only | Apache-2.0 |
| Mobile | not browser | not real-device verified | likely, not enough.-verified |
| Integration Complexity | impossible directly for GitHub Pages browser | medium/high | high; Matrix model mismatch |

### 15.2 Other credible browser/WASM solutions

No additional credible, maintained, browser-ready, Signal/PQXDH/Double-Ratchet engine was identified that clearly improves on the above candidates. Older `libsignal-protocol-javascript`/community ports are generally not PQXDH-modern, not official, or not clearly maintained for enough.'s needs.

Do **not** implement custom X3DH/PQXDH/Double Ratchet to fill the gap.

---

## 16. Risk Register

| Risk | Severity | Status | Required mitigation |
|---|---:|---|---|
| AGPL license incompatibility | High | Open | Legal review before any production dependency |
| Unofficial wrapper trust | High | Open | Independent source/security review |
| npm artifact provenance missing | High | Open | Reproducible build or trusted provenance/vendor policy |
| JS-exportable identity/private/session records | High | Open | Revise security model; encrypted persistence; strict secret boundary |
| XSS exfiltration of all secrets | High | Open | CSP, Trusted Types if applicable, dependency hygiene, no unsafe HTML, service-worker controls; acknowledge browser E2EE limit |
| Kyber tombstone persistence error | High | Open | Atomic IndexedDB transaction design and tests |
| Session rollback/replay after backup restore | High | Open | anti-rollback/session-version strategy |
| Multi-tab session races | High | Open | Web Locks/leader worker/CAS design |
| Mobile storage eviction | Medium/High | Open | recovery UX and key-change warnings |
| WASM panic bricks instance | Medium | Open | reload/recovery UX; panic monitoring without secrets |
| Release process mismatch npm vs GitHub releases | Medium | Open | require signed tags/releases/provenance |
| Rust transitive vulnerabilities/licenses | Medium | Open | cargo audit + license inventory |
| Performance on mobile | Medium | Open | real-device benchmark gate |
| Safety-number UX absent | High | Open | design before trusting server-provided identity keys |

---

## 17. E2EE-2C Prerequisites

| Item | Priority | Status |
|---|---|---|
| Legal Review | REQUIRED | Open |
| Source Review | REQUIRED | Open |
| Artifact Provenance | REQUIRED | Open |
| Dependency Pinning | REQUIRED | Partially shown in spike; production open |
| Security Review | REQUIRED | Open |
| Secret Persistence Design | REQUIRED | Open |
| IndexedDB Encryption Design | REQUIRED | Open |
| PreKey Lifecycle | REQUIRED | Open |
| Kyber Tombstones | REQUIRED | Open |
| Replay Persistence | REQUIRED | Open |
| Session Recovery | REQUIRED | Open |
| Device Model | REQUIRED | Open |
| Safety Number UX | REQUIRED | Open |
| Message Envelope | REQUIRED | Open |
| Mobile Testing | REQUIRED | Open |
| CSP/WASM Strategy | REQUIRED | Open |
| Performance Testing | REQUIRED | Open |
| Final Architecture Review | REQUIRED | Open |
| Reproducible CI build of WASM | REQUIRED | Open |
| RustSec/cargo audit | REQUIRED | Open |
| License inventory for Rust deps | REQUIRED | Open |
| Multi-tab concurrency model | REQUIRED | Open |
| Service-worker threat review | REQUIRED | Open |
| Independent cryptographer review | RECOMMENDED | Open |
| Fuzz/corruption tests around import APIs | RECOMMENDED | Open |
| Formal recovery/key-rotation runbook | RECOMMENDED | Open |
| Optional group messaging review | OPTIONAL | Not needed for 1:1 E2EE-2C |

---

## 18. Final Recommendation

Category: **PROMISING — BLOCKED ON SPECIFIC ISSUES**

Rationale:

- Technically, `@getmaapp/signal-wasm@0.6.6` remains the most compatible candidate found for enough.'s browser-only Signal/PQXDH-style session layer.
- The inspected source strongly indicates it wraps official libsignal `v0.101.0` at the same commit as official `@signalapp/libsignal-client@0.101.0`.
- The wrapper does important security-adjacent work outside upstream libsignal: stores, serialization, Kyber usage/tombstones, error mapping, and WASM boundary management. That code must be trusted and reviewed separately.
- The secret-material model is a real architectural downgrade from enough.'s E2EE-1 non-extractable identity-key invariant. It may be acceptable only if enough. explicitly changes the security model and designs strong containment/persistence controls.
- Legal and supply-chain blockers are unresolved.

Not approved:

- No production integration.
- No E2EE-2C start.
- No root production dependency.
- No message encryption path.

---

## 19. Git / Repository Status

This due-diligence review intentionally modified documentation only:

New documentation file:

```text
docs/e2ee-2b-due-diligence.md
```

Existing spike files from prior compatibility work remain uncommitted:

```text
docs/e2ee-2b-spike.md
experiments/e2ee-2b/
```

No files under `src/` changed.  
No files under `supabase/` changed.  
No SQL executed.  
No migration created.  
No production dependency added to root package.  
No commit/push/PR/merge performed.

Final required repository checks should be run after this file is written:

```bash
git status --short
git diff --check
```
