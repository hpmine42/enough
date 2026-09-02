# enough. — E2EE-2.5 Implementation Feasibility Review

**Document Type:** Independent Technical Feasibility Review & Decision Record
**Phase:** E2EE-2.5 (Pre-Implementation Gate for E2EE-3)
**Date:** 2026-08-19
**Reviewed Artifact:** [`docs/e2ee-session-architecture.md`](./e2ee-session-architecture.md) (E2EE-2)
**Verification Artifact:** [`spikes/e2ee-compat-spike/`](../spikes/e2ee-compat-spike/) (isolated; no app code touched)
**Status:** Final — **NO-GO for E2EE-3** (protocol layer), primitives verified

---

> **Summary:** The architecture set in E2EE-2 (PQXDH + Double Ratchet) is
> cryptographically sound and **browser-capable in its primitives**: X25519,
> Ed25519, HKDF-SHA-256 and AES-256-GCM run natively via the Web Crypto API;
> ML-KEM-768 was successfully tested with two libraries (`mlkem-wasm`,
> `@noble/post-quantum`) — including a production-like Vite build under
> `/enough/`. **But:** there is today **no trustworthy, audited, browser-capable
> implementation of the protocol core** (PQXDH handshake + Double Ratchet
> state machine). Signal's official `libsignal` is Node-only and AGPL-licensed;
> every browser alternative is unaudited, inactive, or a different protocol.
> Under this review's decision rule that is a **NO-GO for E2EE-3**. A homemade
> protocol implementation must not be built to close the gap. The E2EE-2
> architecture text was corrected on six inaccurate claims (section 9 below).

## Table of Contents

1. [Final candidate library](#1-final-candidate-library)
2. [Browser compatibility](#2-browser-compatibility)
3. [WASM / native analysis (ML-KEM-768)](#3-wasm--native-analysis-ml-kem-768)
4. [PQXDH support](#4-pqxdh-support)
5. [ML-KEM support](#5-ml-kem-support)
6. [Double Ratchet support](#6-double-ratchet-support)
7. [Signal protocol compatibility](#7-signal-protocol-compatibility)
8. [Vite compatibility](#8-vite-compatibility)
9. [GitHub Pages compatibility](#9-github-pages-compatibility)
10. [Security concerns](#10-security-concerns)
11. [Bundle / performance impact](#11-bundle--performance-impact)
12. [Protocol Adapter design](#12-protocol-adapter-design)
13. [Known limitations](#13-known-limitations)
14. [Final GO / NO-GO](#14-final-go--no-go)

---

## 1. Final candidate library

### 1.1 The one-line answer to the gating question

> **"Which concrete implementation performs the cryptographic
> protocol operations?"**

| Layer | Concrete implementation | Status |
|---|---|---|
| X25519, Ed25519, HKDF-SHA-256, AES-256-GCM | **Native W3C Web Crypto API** (browser-vendor implemented, audited by vendors) | ✅ available & spike-tested |
| ML-KEM-768 (FIPS 203) | **`mlkem-wasm` v0.0.7** (WASM; core = `mlkem-native` by PQShield/pq-code-package) — validated alternative: `@noble/post-quantum` v0.7.0 | ✅ available & spike-tested (with caveats, §10) |
| **PQXDH handshake + Double Ratchet state machine** | **— none —** | ❌ **no trustworthy browser implementation exists** |

Because the third row is the actual protocol, the decision rule (§14) yields
**NO-GO for E2EE-3**. The rest of this document is the evidence.

### 1.2 Full candidate audit (protocol layer)

Each candidate was checked against registry metadata, repository, release
history, license, and audit trail — not README claims.

| # | Candidate | Repository | License | Maintenance | Last relevant release | Browser | Verdict |
|---|---|---|---|---|---|---|---|
| P1 | `@signalapp/libsignal-client` v0.101.0 | github.com/signalapp/libsignal | **AGPL-3.0-only** | Active (Signal's own) | 0.101.0 (rolling) | ❌ Node/Electron native only (`node-gyp-build`, `node:crypto`, 147 MB unpacked). README: *"Use outside of Signal is unsupported"*; bridges (JNI/NAPI) explicitly unstable | **Rejected** — not browser-capable; AGPL virality conflicts with the current private deployment model |
| P2 | `libsignal-protocol-javascript` | (archived) | — | **Deprecated by Signal (2021)** | — | asm.js worker era, no X25519-native, **no PQXDH** | **Rejected** — removed even from npm registry (404) |
| P3 | `@matrix-org/matrix-sdk-crypto-wasm` v18.5.0 | github.com/matrix-org/matrix-sdk-crypto-wasm | Apache-2.0 | Active (Matrix.org) | 18.5.0 | ✅ WASM works in browser | **Rejected for this protocol** — implements **Olm/Megolm**, not Signal PQXDH/DR; API is hardwired to Matrix homeserver semantics; 8.9 MB unpacked |
| P4 | `vodozemac` (Matrix crypto core) | github.com/matrix-org/vodozemac | Apache-2.0 | Active | crates.io releases | ⚠️ audited (Least Authority, 2022-05), but **no official standalone npm/WASM package** (npm 404); protocol = Olm/Megolm, **no PQXDH** | **Rejected** — see P3; only reachable via P3 |
| P5 | `@wireapp/core-crypto` v10.4.0 | github.com/wireapp/core-crypto | **GPL-3.0** | Active (Wire) | 10.4.0 | ✅ WASM works in browser | **Rejected** — implements Wire **Proteus** (own protocol, no PQXDH) + MLS; GPL-3.0 virality; 52 MB unpacked |
| P6 | `@open-e2ee/signal-protocol-sdk` v0.3.0 | github.com/open-e2ee/signal-protocol-js | **AGPL-3.0-or-later** | Single author, 38 commits, **1 star** | 0.3.0 published **2026-08-18** (one day before this review) | ✅ pure TS (noble stack) | **Rejected** — zero maturity, zero adoption, unaudited, AGPL; cannot serve as the trust anchor for E2EE |
| P7 | `webcrypto-ratchet` v0.7.2 | (single maintainer) | MIT | Single author | 0.7.2 (2026-07-27) | ✅ WebCrypto + noble | **Rejected** — implements a **continuous Triple Ratchet**, which E2EE-2 §1.2 explicitly rejected; unaudited |
| P8 | Community libsignal→WASM ports (`lukejmann/libsignal-wasm`, `positive-intentions/signal-protocol`, …) | various | AGPL (derived) | Stale/unofficial | n/a | partial | **Rejected** — unofficial builds of an API documented as unstable for external use; no audit of build pipeline; supply-chain risk |
| P9 | `2key-ratchet` (Virgil), `nostr-double-ratchet`, `@matrix-org/olm` | various | various | Inactive/deprecated | 2023 or older | partial | **Rejected** — inactive, P-256/legacy, or niche |

**Conclusion (protocol layer):** The E2EE-1 finding
([`docs/e2ee-architecture.md`](./e2ee-architecture.md): *"none of the examined
Signal protocol libraries can be run cleanly in the browser"*) **still
holds in August 2026** for audited implementations. New arrivals since then
(P6, P7) are unaudited single-author projects that do not meet the
"trustworthy" bar of this review.

### 1.3 Candidate audit (ML-KEM-768 primitive layer)

| # | Candidate | Repository | License | Maintenance | Last release | Browser | Audit/provenance | Verdict |
|---|---|---|---|---|---|---|---|---|
| M1 | **`mlkem-wasm`** v0.0.7 | github.com/dchest/mlkem-wasm | MIT | Single author (Dmitry Chestnykh, cryptography veteran: TweetNaCl.js-era ecosystem), 21 commits | 0.0.7 (2025-09-17) | ✅ single-file ESM, WASM inlined | Core = **`mlkem-native`** (pq-code-package/PQShield): C90, **formally verified with CBMC** (memory/type safety of all C code) **+ HOL-Light** (core AArch64 asm); upstream is production-grade (used via aws-lc). Wrapper itself **beta, unaudited** | ✅ **Primary recommendation** (with §10 caveats) |
| M2 | **`@noble/post-quantum`** v0.7.0 | github.com/paulmillr/noble-post-quantum | MIT | Active (paulmillr; release 10 days before this review) | 0.7.0 (2026-08-09) | ✅ pure TS, tree-shakeable | noble family has **6 independent audits** (Cure53 ×3, Trail of Bits, Kudelski, Cure53/OpenSats 2024) — but **none covers the post-quantum module**; explicitly **does not claim constant-time**; ACVP/Wycheproof-tested | ✅ **Validated alternative** / fallback |
| M3 | `mlkem` / `crystals-kyber-js` v2.7.0 | github.com/dajiaji/crystals-kyber-js | MIT | Single author, ported from reference C | 2.7.0 (2026-03-08) | ✅ pure TS | **No audit**; JS constant-time not claimed | Rejected as primary (M1/M2 dominate) |
| M4 | Native Web Crypto ML-KEM-768 | WICG `webcrypto-modern-algos` draft | — | — | — | ❌ **No browser ships it** (draft of 2026-06-29, "Latest published version: none"); only **Node ≥ 24.7** exposes `ML-KEM-768` in `subtle` | Vendor-audited when it ships | **Future migration target** — mlkem-wasm deliberately mirrors this API shape so the switch is a re-import |

Both M1 and M2 were **installed and exercised** in the compatibility spike
(§5, §8); they interoperate with each other byte-for-byte (FIPS 203
conformance evidence).

---

## 2. Browser compatibility

Verified against current engine baselines (August 2026: Chrome stable 151,
Safari 26.x, Firefox ~141+):

| Capability | Chrome/Edge | Firefox | Safari | Source of truth | Spike |
|---|---|---|---|---|---|
| `subtle` X25519 (generateKey/deriveBits/exportKey raw) | ≥ 133 | ≥ 129 | ≥ 17 | caniuse/MDN | ✅ |
| `subtle` Ed25519 (sign/verify, non-extractable) | ≥ 137 (May 2025) | ≥ 129 | ≥ 17 | caniuse/MDN | ✅ |
| HKDF-SHA-256 | ≥ 133 (with X25519 baseline) | ≥ 129 | ≥ 17 | MDN | ✅ (RFC 5869 KAT) |
| AES-256-GCM | universal | universal | universal | MDN | ✅ (reference vector) |
| WebAssembly | universal | universal | universal | — | ✅ (mlkem-wasm) |
| `structuredClone(CryptoKey)` → IndexedDB | ≥ 133 | ≥ 129 | ≥ 17 | MDN | ✅ |
| Native `subtle` ML-KEM-768 | ❌ none (151) | ❌ | ❌ | WICG draft, Node ≥ 24.7 only | n/a |

Practical floor for enough.: **Chrome/Edge ≥ 137, Firefox ≥ 129, Safari ≥ 17**
(Ed25519 is the gating primitive), which matches E2EE-2 §1.3 item 5 — that part
of the E2EE-2 audit is confirmed. Note the ecosystem caveat from the IPFS/
Igalia Ed25519 rollout report: engine support reached ~79 % of users in mid-2025
and needs the usual 2–3 year proliferation window; the app must therefore keep
a capability gate (`isE2eeSupported()` already exists in `src/lib/crypto`).

Node quirk recorded by the spike (relevant for CI, not browsers): Node 22
requires an explicit `AlgorithmIdentifier` (`{name:'Ed25519'}`) for
`sign()`/`verify()` where browsers also accept `null`.

---

## 3. WASM / native analysis (ML-KEM-768)

Classification requested by the review (A/B/C/D) for the chosen solution:

- **A) Native Web Crypto API:** ❌ **not available in any stable browser**
  (Chrome 151 stable, Aug 2026). A W3C/WICG draft ("Modern Algorithms in the
  Web Cryptography API", draft of 2026-06-29) specifies `ML-KEM-768`
  encapsulate/decapsulate operations; Node implemented it early (≥ 24.7.0).
  **This falsifies E2EE-2's "W3C Web Crypto API for ML-KEM-768" claim — corrected
  in the architecture doc.**
- **B) WASM:** ✅ **chosen.** `mlkem-wasm` embeds an Emscripten-style WASM build
  of `mlkem-native` **inside a single ~53 kB unminified ES module** (17 kB
  gzipped; 39.9 kB minified incl. wrapper, measured in spike §11). No external
  `.wasm` fetch, no worker, no `SharedArrayBuffer`, no COOP/COEP headers, no
  Node polyfills.
- **C) Pure JavaScript:** available as fallback (`@noble/post-quantum`, 7.2 kB
  gzipped tree-shaken, measured) — but JS engines "do not offer the execution
  guarantees needed for a formal constant-time claim" (project's own security
  note), and the PQ module has no dedicated audit. Used in the spike as an
  **independent cross-check implementation**, not as primary.
- **D) Native Node addon:** not browser-capable; excluded by definition.

**Constant-time / browser-suitability of the WASM core:** `mlkem-native`'s C
frontend is formally verified (CBMC) for memory/type safety; its optimized
assembly backends (AArch64, AVX2) are HOL-Light-verified for functional
correctness and are written to be constant-time. The **WASM target compiles the
C backend** — this removes whole classes of JS-side leakage (JIT/GC timing,
bigint branching) that pure-JS implementations cannot avoid, but no formal
constant-time proof exists *for the WASM target itself*. Residual side-channel
surface in a browser (cache, throttling-based attacks) applies to every
in-browser implementation, native WebCrypto included; for PQXDH the PQ secret
is hybridized with X25519, so a hypothetical ML-KEM side channel does not
break classical mutual authentication.

**How it is loaded:** standard ESM `import mlkem from 'mlkem-wasm'`; first call
asynchronously instantiates the inlined WASM; all functions are `async`
(mirroring the future native API). **Size:** see §11. **Known security
issues:** none published against `mlkem-native` or the wrapper as of
2026-08-19; the wrapper carries an explicit *"Beta version. CONTAINS
CRYPTOGRAPHY! Use at your own risk."* caution — treated as a real risk in §10.

---

## 4. PQXDH support

**Finding: no vetted library implements PQXDH for the browser** (§1.2). What
the spike *could* verify is that every **primitive operation PQXDH requires**
is available and composes correctly (X25519 DH ×4 roles, Ed25519 signatures
over prekey material, ML-KEM-768 encapsulation to a *wire-imported* public key,
HKDF with the spec's `F‖KM` framing, AES-GCM under the derived key).

Protocol-level PQXDH gaps that E2EE-3 would have to close **without a library**
(= the reason for NO-GO):

| PQXDH requirement (spec Rev 3, 2023-05-24) | Browser reality |
|---|---|
| Identity key is a **single curve25519 key** used both for DH (DH1/DH2) and **XEdDSA signatures** | WebCrypto offers X25519 and Ed25519 as *separate* keys; **XEdDSA is not available**. Workaround = split identity (Ed25519 signing + X25519 DH, cross-signed) — a **deviation** to be designed, or an XEdDSA JS library (unaudited territory) |
| **Signed last-resort PQ prekey (PQSPK)** + signed one-time PQ prekeys, *always present* in the bundle | E2EE-2 designed PQ prekeys as optional with classical fallback — **spec deviation, corrected in the architecture doc** |
| `KDF` = HKDF with `F‖KM` prefix, zero salt, `info = "app_CURVE_hash_pqkem"` | primitives available; must be specified exactly (E2EE-2 was underspecified) |
| `AD = EncodeEC(IK_A) ‖ EncodeEC(IK_B) ‖ [EncodeKEM(PQPK_B)]` (+ optional app data) | E2EE-2's AD omitted identity keys and PQPK binding — **spec deviation, corrected** |
| Replay mitigation for one-time-prekey-less initial messages; deletion of consumed one-time prekeys | requires the (missing) session engine; E2EE-2's RPC + consumption design is compatible |

---

## 5. ML-KEM support

Spike-verified facts (`spikes/e2ee-compat-spike`, all green):

- `mlkem-wasm`: keygen (`extractable:false` supported), `raw-public` export =
  **1184 B** (FIPS 203), `encapsulateBits` → ct **1088 B** + ss **32 B**,
  `decapsulateBits` recovers the secret; import of a wire public key →
  encapsulate → owner-side decapsulate works; tampered ct decapsulates **without
  error to a pseudorandom secret** (FIPS 203 *implicit rejection* — recipients
  must rely on AEAD authentication, not on KEM errors).
- `@noble/post-quantum`: `keygen(seed)` deterministic from a 64-B seed;
  ek 1184 B, **dk 2400 B**, ct 1088 B, ss 32 B; encap/decap roundtrip.
- **Cross-library conformance:** encapsulating against library A's public key
  and decapsulating with library B's private key succeeds **in both
  directions**, and identical seeds yield identical keypairs across both
  libraries — strong evidence both implement the *same* FIPS 203 parameter set
  (this is not a NIST ACVP certificate; it is behavioral conformance).
- Seeded keygen enables reproducible PQ prekey pools and future encrypted
  backups.

---

## 6. Double Ratchet support

**Finding: no vetted browser implementation of the Double Ratchet exists.**
`@signalapp/libsignal-client` contains the reference DR but is a Node native
addon (and AGPL). `matrix-sdk-crypto-wasm`/vodozemac implement Olm (a DR
*variant* with a different wire format and trust model, audited) and Megolm,
packaged for Matrix. Wire's core-crypto implements Proteus/MLS. Everything
else found is unaudited or inactive (§1.2). The Double Ratchet specification
itself was updated to **Revision 4 (2025-11-04)**, adding header-encryption,
the Sparse Post-Quantum Ratchet (SPQR), and a Triple Ratchet composition —
E2EE-2's choice (classical DR after PQXDH) remains spec-conformant and matches
what Signal itself deploys, but the *implementation* must not be authored
in-house per this review's absolute rule.

---

## 7. Signal protocol compatibility

Checklist against the actual specifications (PQXDH Rev 3; Double Ratchet Rev 4),
marking every deviation of the E2EE-2 document:

| Aspect | Spec | E2EE-2 doc says | Verdict |
|---|---|---|---|
| Handshake DH order | DH1=DH(IK_A,SPK_B), DH2=DH(EK_A,IK_B), DH3=DH(EK_A,SPK_B), DH4=DH(EK_A,OPK_B) | same | ✅ match |
| SK input order | `DH1‖DH2‖DH3[‖DH4]‖SS`, SS last | same | ✅ match |
| KDF construction | HKDF, `F‖KM` prefix, zero salt, `info="app_curve_hash_pqkem"` | "HKDF-SHA256(…)" only | ⚠️ underspecified — corrected |
| Identity key semantics | one curve25519 key, XEdDSA sigs | Ed25519 identity key used in `X25519(IK_a.priv, …)` | ❌ **impossible in WebCrypto** — corrected to split-key model (deviation) |
| PQ prekey semantics | signed last-resort PQSPK **always** in bundle; one-time PQ prekeys preferred | optional PQ prekey, classical fallback when depleted | ❌ deviation — corrected |
| Prekey signatures | `Sig(IK, EncodeEC(SPK))`, `Sig(IK, EncodeKEM(PQPK))` | `Sig(IK_b, SPK_b)`, `Sig(IK_b, PQPK_b)` | ✅ concept match (encoding must be pinned) |
| Key identifiers | `IdEC/IdKEM` per prekey | uint32 ids | ✅ match |
| Initial-message AD | `EncodeEC(IK_A)‖EncodeEC(IK_B)[‖EncodeKEM(PQPK_B)]` + optional app data | custom magic/version/devices/connection AD | ⚠️ compatible as *extension* but **must include** identity keys + PQPK — corrected |
| DR header | `(dh, pn, n)`, header inside AEAD AD | `dh, n, pn` in header, AD-bound | ✅ match |
| DR KDF constants | `KDF_CK`: mk=HMAC(CK,0x01), ck′=HMAC(CK,0x02); `KDF_RK`=HKDF(salt=RK) | `HMAC(CK,"MessageKey")/HMAC(CK,"ChainKey")` | ❌ ASCII labels deviate from spec constants — corrected |
| Skipped-message keys | store under `(dh, n)`, delete on use, `MAX_SKIP` bound | skipped_keys store + pruning | ✅ match; MAX_SKIP must be defined |
| Replay handling | initial-msg replay mitigations; AEAD failure discards state without mutation | same policy | ✅ match |
| AEAD choice | free (must be IND-CPA/INT-CTXT); Signal's own impl uses AES-CBC+HMAC | AES-256-GCM | ✅ spec-allowed; ⚠️ **not wire-compatible with Signal clients** (irrelevant — no Signal interop planned); documented |
| DR bootstrap | Bob inits DR with his SPK keypair as first ratchet key (DR spec §7.1) | session record has ratchet keypair | ✅ compatible; must be pinned in E2EE-3 |
| Safety number | 60 digits, 12×5, per-side 30 digits via 5200× iterated SHA-512 (~112-bit security per research literature) | "60-digit Safety Number" | ✅ claim **verified** (spike constructs it deterministically) |

---

## 8. Vite compatibility

Proven by building the spike with the **same toolchain version as the app
(Vite 6.4.x)** and the app's own build as baseline:

- `npm run build` in the repo (app): ✅ unchanged, 484.8 kB JS / 136.6 kB gzip.
- Spike `vite build` (entry imports **both** ML-KEM libraries + check suite):
  ✅ 15 modules transformed, **single chunk**, no separate `.wasm` asset
  (WASM is base64-inlined by the library by design), **no worker files**.
- **No Node dependency reaches the browser bundle:** scan of `dist/assets` for
  `node:` imports / `require(` → clean. `mlkem-wasm` and `@noble/post-quantum`
  are environment-agnostic ESM (`browser`+`node` support without polyfills).
- Tree-shaking works: importing only `ml_kem768` from noble yields 17.8 kB
  minified / 7.2 kB gzip.
- WASM loading strategy (inlined ESM) means no `new URL('*.wasm', import.meta.url)`
  asset-path issues — the classic Vite+WASM pitfall does not apply.

## 9. GitHub Pages compatibility

- Spike built with `base: '/enough/'` (mirroring the deploy workflow's
  `VITE_BASE=/enough/`): `dist/index.html` references
  `/enough/assets/index-*.js` ✅ — verified byte-exactly.
- Single-file, origin-relative assets: no cross-origin WASM fetches, no service
  needed for COOP/COEP (no multi-threaded WASM), works under GitHub Pages' static
  file serving and its HTTPS (which satisfies WebCrypto's secure-context
  requirement).
- No changes to the existing `deploy.yml` workflow are required for the
  primitive layer; the PWA plugin is unaffected.
- Caveat documented: subresource integrity/pinning for the crypto chunk relies
  on GitHub Pages TLS + content-hash filenames; acceptable for this phase.

## 10. Security concerns

1. **No audited protocol engine exists** (the NO-GO root cause). Until one
   does, *nothing* in `src/` may grow handshake/ratchet code — the existing
   guard test (`crypto layer exposes NO encrypt/decrypt/session APIs`) stays.
2. **`mlkem-wasm` wrapper is beta & unaudited.** The WASM core (mlkem-native)
   is formally verified upstream, but the JS/WASM *packaging* (key objects,
   wiping, base64 paths) has no third-party audit. Mitigations if/when adopted:
   pin the exact version + integrity hash in the lockfile, track upstream
   releases, cross-check KATs in CI (the spike's cross-library tests are
   reusable), and treat the author's beta warning as blocking for production
   until either an audit or wider production adoption exists.
3. **Key material in JS heap.** mlkem-wasm `CryptoKey`-alikes cannot be
   `structuredClone`d into IndexedDB (deliberate), so PQ prekey *seeds* would
   be persisted as raw bytes — a doctrinal deviation from the
   "non-extractable only" rule for long-term identity keys. Acceptable for
   short-lived prekeys; **identity keys must remain non-extractable CryptoKeys**
   (verified possible in the spike).
4. **Pure-JS fallback is not constant-time** and noble's PQ module is not
   among the audited noble modules — fine as a *cross-check* implementation,
   risky as the primary.
5. **Inherent web-E2EE limits** unchanged: XSS = game over; browser storage is
   wipeable by the user; extensions can read the DOM. The architecture already
   states this; no library choice changes it.
6. **Supply chain:** two small-npm-package dependencies must be lockfile-pinned
   and reviewed on every bump (both are MIT, zero transitive runtime deps —
   verified: `mlkem-wasm` has none; noble-post-quantum's runtime deps are noble
   family packages only).
7. **Browser quirk risk:** Node-vs-browser `AlgorithmIdentifier` differences
   (spike-documented) — CI must not be the only place crypto is tested.

## 11. Bundle / performance impact

Measured on this machine (spike, minified ES2022):

| Artifact | raw | gzip |
|---|---|---|
| `mlkem-wasm` alone (incl. inlined WASM) | 39.9 kB | 15.2 kB |
| `@noble/post-quantum` `ml_kem768` (tree-shaken) | 17.8 kB | 7.2 kB |
| Full spike chunk (both libs + all checks) | 74.0 kB | 27.2 kB |
| App baseline (unchanged, no crypto libs) | 484.8 kB | 136.6 kB |

Projected E2EE-3 bundle delta for the *primitive* layer: **≈ +15 kB gzip**
(mlkem-wasm only). This corrects E2EE-2's "0 KB added" claim (classical
operations are indeed native; ML-KEM is not).

Runtime (spike timings, sandbox V8): ML-KEM keygen ≈ 6 ms (WASM) / 17 ms (noble);
encapsulate ≈ 1 ms / 5 ms; decapsulate ≈ 1 ms / 11 ms; X25519/Ed25519/HKDF
operations ≈ 1–6 ms; safety-number derivation (2 × 5200 SHA-512) ≈ 0.94 s
one-time. All well within interactive budgets; no workers required.

## 12. Protocol Adapter design

Design-only artifact: [`spikes/e2ee-compat-spike/protocol-adapter.types.ts`](../spikes/e2ee-compat-spike/protocol-adapter.types.ts)
— **types and documentation only, zero function bodies** (rule: no
implementation before a vetted engine exists).

```
UI → MessageService → E2EESessionManager → ProtocolAdapter → Engine
                                            (typed seam)     (empty slot)
```

- `createIdentity()` → engine slot: WebCrypto (Ed25519 signing key + X25519 DH
  key, cross-signed — pending the identity-model ADR required by §7).
- `createPreKeyBundle()` → engine slot: WebCrypto keygen/signatures +
  `mlkem-wasm` PQ prekeys (`raw-public` 1184 B on the wire; ids per spec).
- `createSession()` / `acceptSession()` → engine slot: **EMPTY — this is the
  PQXDH+DR engine that does not exist yet.**
- `encrypt()` / `decrypt()` / (ratchet stepping is internal to the engine) →
  engine slot: **EMPTY** (same reason).
- `safetyNumber()` → implementable *now* against WebCrypto SHA-512 (spike
  demonstrates); not protocol security, display-only.

Swappability is explicitly designed for the two foreseeable engine sources:
native WebCrypto ML-KEM (drop-in for `mlkem-wasm` — same API shape as the WICG
draft) and any future audited protocol library (the adapter is the only module
allowed to import it).

## 13. Known limitations

1. **Protocol engine absent** — everything else is scaffolding around an empty
   slot; E2EE-3 cannot start (§14).
2. `mlkem-wasm` is single-author beta; `@noble/post-quantum` PQ module
   unaudited; neither claim constant-time for the JS boundary.
3. No NIST ACVP certification claim for either ML-KEM library; conformance was
   shown behaviorally (cross-library interop + published test vectors by the
   projects), not by certificate.
4. Native WebCrypto ML-KEM is not shipped by any browser; when it ships
   (Chrome/Firefox/Safari unknown; Node already has it), migration is cheap but
   must be re-verified (algorithm names, JWK, extractability semantics).
5. The spike's browser evidence is Node-V8 + production-build based; the
   sandbox could not download a real browser (CDNs blocked). The spike page is
   served for a one-click real-browser confirmation (`npm run preview` in the
   spike, or the live preview attached to this review).
6. Identity-key model (split Ed25519/X25519 vs spec's single-key XEdDSA) needs
   its own ADR before E2EE-3; it changes `crypto_devices` schema fields.
7. Safety numbers protect only against long-MITM if users actually compare
   them; UX must make that cheap (research literature: manual fingerprint
   verification provides ~112-bit security, weaker in practice).

## 14. Final GO / NO-GO

> ### ❌ **NO-GO for E2EE-3**
>
> The decision rule — *GO only if a concrete, trustworthy, browser-capable
> implementation of the protocol was found and spike-tested* — is **not met**:
>
> - ✅ Primitives: **GO** — WebCrypto (X25519, Ed25519, HKDF-SHA-256,
>   AES-256-GCM) + `mlkem-wasm`/noble ML-KEM-768, all green in the
>   compatibility spike, production build proven under `/enough/`.
> - ❌ Protocol core: **NO trustworthy, browser-capable implementation of
>   PQXDH + Double Ratchet exists** (audit table §1.2). Implementing it
>   in-house is explicitly forbidden by this review's rules and by
>   `src/lib/crypto/README.md`.
>
> **Consequences:**
> 1. `sendMessage()` stays plaintext; no Supabase migration; no protocol code
>    in `src/` (repo scan §7 of the task confirmed none exists — no STOP
>    condition was found).
> 2. The corrected E2EE-2 baseline (this review's patches to
>    `docs/e2ee-session-architecture.md`) is the new architectural truth.
> 3. E2EE-3 becomes GO when **any** of:
>    - an audited Signal-family (PQXDH+DR) browser library ships (watch:
>      vodozemac standalone JS bindings, Matrix/Signal ecosystem releases),
>    - native WebCrypto ML-KEM ships *and* the project explicitly re-opens the
>      "own protocol layer" question with a budget for an external audit
>      (a rule change, not a default),
>    - a current unaudited candidate (e.g. `@open-e2ee/signal-protocol-sdk`)
>      reaches maturity + independent audit.
> 4. Re-run this review's spike (`spikes/e2ee-compat-spike`) as an acceptance
>    gate when that happens; it is self-contained and CI-runnable.

---

### Appendix A — E2EE-2 claim-by-claim verification (task §9)

| E2EE-2 claim | Verdict | Action taken |
|---|---|---|
| "W3C Web Crypto API for ML-KEM-768" | ❌ **false** — no browser ships it (WICG draft 2026-06; Node ≥ 24.7 only) | Architecture doc corrected (§1.3, §18); ML-KEM via `mlkem-wasm` (WASM) documented |
| "PQXDH + classical Double Ratchet as in Signal" | ⚠️ sound *design*, but no implementation exists for browsers | Kept as target architecture; implementation gated (NO-GO); spec deviations corrected in doc |
| "~48 Bytes Double Ratchet overhead" | ❌ **misleading** — counts only 32 B ratchet-pub + 16 B tag, ignores PN/N counters and the doc's own JSON+Base64 container (≈ ×2.4 expansion) | Corrected to honest per-message overhead table (≈ 56–60 B binary; ≈ 190–260 B in the planned JSON container) |
| "60-digit Safety Number" | ✅ **correct** — matches Signal/WhatsApp format (12×5 digits, 5200× iterated SHA-512 per side) | Verified by spike; algorithm documented in adapter section |
| "AES-256-GCM" | ⚠️ spec-permitted AEAD, but **not** Signal's own wire choice (AES-CBC+HMAC) | Kept, deviation documented (no Signal-client interop planned) |
| "My Notes Loopback Self Session" | ✅ technically consistent — PQXDH-to-self and a DR session A↔A are well-defined; hides notes from the server like any session | Kept; noted that single-device loopback protects only against server, not device compromise (already the doc's intent) |
| (§1.2) "0 KB added" browser bundle for PQXDH+DR | ❌ ML-KEM cannot run on WebCrypto today | Corrected: ≈ +15 kB gzip (mlkem-wasm) |
| (§7.1) `X25519(IK_a.priv, …)` with Ed25519 identity keys | ❌ **impossible** in WebCrypto (no cross-curve use, no XEdDSA) | Corrected to split-key identity model (Ed25519 signing + X25519 DH, cross-bound); flagged as deviation needing an ADR |

### Appendix B — Evidence index

- Compatibility spike (all 22 checks green, Node 22.22/V8):
  `spikes/e2ee-compat-spike/` — `npm test`, `npm run build`, `npm run preview`.
- Production build proof: spike `dist/` (base `/enough/`), asset-path and
  `node:`-import scans included in this document.
- Specifications checked: PQXDH Rev 3 (2023-05-24, last updated 2024-01-23) and
  Double Ratchet Rev 4 (2025-11-04), signal.org/docs/specifications.
- Registry metadata (versions/licenses/dates) captured 2026-08-19 from npm.
- vodozemac audit: Least Authority, 2022-03-30 (published 2022-05-16).
- noble audit history: paulmillr.com/noble (6 audits; PQ module not among them).
- mlkem-native formal verification: CBMC + HOL-Light (pq-code-package docs).
- WICG "Modern Algorithms in the Web Cryptography API" draft, 2026-06-29.
- Browser support: caniuse/MDN X25519+Ed25519 tables; IPFS/Igalia Ed25519-in-Chrome-137 report (2025).
