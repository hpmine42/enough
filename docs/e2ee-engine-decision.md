# enough. — E2EE Engine Selection & Architecture Decision

**Document Type:** Architecture Decision Record — Engine Selection
**Phase:** E2EE-3 Gate (replaces the NO-GO from E2EE-2.5 / E2EE-SR)
**Date:** 2026-08-23
**Status:** **DECISION — CONDITIONAL GO with explicit risk acceptance**
**Predecessors:** `e2ee-architecture.md` (E2EE-1), `e2ee-session-architecture.md` (E2EE-2), `e2ee-implementation-feasibility.md` (E2EE-2.5), `e2ee-2c-architecture.md` (E2EE-2C), `e2ee-solution-review.md` (E2EE-SR)

---

## 0. Why This Document Exists

The previous investigation cycle (E2EE-1 → E2EE-2 → E2EE-2.5 → E2EE-SR → E2EE-2C)
established strong foundations (identity keys, prekeys, primitives, storage, spike tests)
but concluded with **NO-GO** every time because no implementation met the combined bar of
"audited + browser-capable + correct protocol + permissive license + provenance attestation."

That bar was set by asking: *what is the theoretically safest option?*

This document asks a different question:

> **What is the safest, most maintainable, technically realistic way for enough. to
> implement genuine 1:1 E2EE in a browser/PWA, while keeping the application minimal
> and avoiding custom cryptography — given the actual state of the ecosystem in August 2026?**

The answer is not "wait indefinitely." The answer is a concrete engineering decision
with explicit risk acceptance.

---

## 1. Executive Summary

**RECOMMENDED ENGINE:** `@getmaapp/signal-wasm@0.6.6`
**RECOMMENDED PROTOCOL:** Signal PQXDH + Double Ratchet (via libsignal core)
**RECOMMENDED INTEGRATION MODEL:** Thin adapter behind the existing `src/lib/crypto/` boundary
**RECOMMENDED LOCAL STORAGE:** IndexedDB with Web Crypto wrapping key (Model A from E2EE-2C)
**RECOMMENDED SUPABASE MODEL:** Additive public prekey tables + existing `messages.ciphertext` for envelopes
**PRODUCTION READINESS:** Conditional — requires AGPL acceptance, vendored artifacts with hash pinning, and the implementation sequence in §16

### Why this wins (one paragraph)

`@getmaapp/signal-wasm` is the **only browser-capable implementation of the Signal
protocol** (PQXDH + Double Ratchet + Kyber1024 prekeys) that exists today. Its core
is the official `libsignal` Rust crates — the same code deployed at Signal's scale in
native apps. The wrapper compiles those crates to WASM via `wasm-bindgen` and exposes
a clean store-based API. The bundle is small (~300 KB gzip). The API matches the
adapter seam already designed in `spikes/e2ee-compat-spike/protocol-adapter.types.ts`.
No other candidate — not Matrix, not MLS, not any pure-TS reimplementation — offers
this combination of protocol correctness, browser feasibility, and implementation
maturity. The risks (AGPL, unaudited wrapper, no provenance attestation) are real but
manageable, and they are **strictly less dangerous than shipping plaintext messages**
in a messenger that claims to be private.

---

## 2. Question A — Protocol Suitability

### Is the Signal protocol appropriate for enough.?

**Yes. Unambiguously.**

The Signal protocol (PQXDH handshake → Double Ratchet) is the industry standard for
1:1 E2EE messaging. It provides:

| Property | Mechanism | enough. relevance |
|---|---|---|
| **Confidentiality** | AES-256-GCM per-message keys | Server blindness to plaintext |
| **Forward secrecy** | Symmetric ratchet destroys past keys | Compromised key doesn't expose history |
| **Post-compromise security** | DH ratchet heals on next roundtrip | Recoverable after key theft |
| **Asynchronous establishment** | PreKey bundles (X25519 + Kyber) | Recipient can be offline |
| **Quantum resistance (HNDL)** | Kyber1024 in PQXDH initial secret | Harvest-now-decrypt-later protection |
| **Replay protection** | AEAD + ratchet counters + kyber usage tracking | Messages can't be replayed |
| **Deniability** | DH-based (no persistent signatures on messages) | Messages aren't provable to third parties |

For a 1:1 text messenger, this is the correct protocol. MLS would add unnecessary
group semantics. Olm/Megolm would add unnecessary group ratchet machinery. OpenPGP
has no forward secrecy. The Signal protocol is purpose-built for exactly this use case.

**PQXDH vs X3DH:** PQXDH adds Kyber1024 key encapsulation to the initial handshake,
protecting against harvest-now-decrypt-later attacks by quantum computers. Since the
libsignal core already implements PQXDH, there is no reason to use the older X3DH.
The additional wire cost is a one-time ~1.2 KB per session establishment — negligible
for a text messenger.

**Double Ratchet vs Triple Ratchet:** The Triple Ratchet (continuous per-message
Kyber encapsulation) adds ~2.3 KB per message and significant CPU overhead. The
Double Ratchet with PQXDH handshake provides the right tradeoff: quantum resistance
for stored traffic (via the initial Kyber secret) with lightweight ongoing messaging.
This matches what Signal itself deploys.

---

## 3. Question B — Implementation Suitability

### Is there a mature implementation that can actually run in a browser?

### 3.1 Candidate Inventory (August 2026)

| # | Candidate | Browser | Protocol | Audit | License | Verdict |
|---|---|---|---|---|---|---|
| 1 | `@signalapp/libsignal-client` 0.101.0 | ❌ Node-native only | PQXDH+DR (reference) | Institutional (Signal) | AGPL-3.0 | **Reject** — cannot run in browser |
| 2 | `libsignal-protocol-javascript` | ❌ archived 2021 | X3DH+DR (old) | Historical | GPL-3.0 | **Reject** — dead |
| 3 | **`@getmaapp/signal-wasm` 0.6.6** | **✅ WASM** | **PQXDH+DR (libsignal core)** | **❌ self-review only** | **AGPL-3.0** | **✅ RECOMMENDED** |
| 4 | `@matrix-org/matrix-sdk-crypto-wasm` 18.5.0 | ✅ WASM | Olm/Megolm (Matrix) | ✅ Least Authority 2022 | Apache-2.0 | **Reject** — Matrix-locked API, no PQ |
| 5 | vodozemac + 3rd-party bindings | ⚠️ unofficial | Olm/Megolm | ✅ core / ❌ bindings | Apache-2.0 (core) | **Reject** — no maintained bindings |
| 6 | OpenMLS (Rust) | ⚠️ `js` feature, no npm pkg | MLS (RFC 9420) | ✅ SRLabs 2026 | MIT | **Reject** — no official JS bindings |
| 7 | `@wireapp/core-crypto` 10.4.0 | ✅ WASM | MLS + Proteus | ⚠️ engine audited | GPL-3.0 | **Reject** — GPL, Wire-locked |
| 8 | Pure-TS Signal reimplementations | ✅ | Various | ❌ none | Mixed | **Reject** — all unaudited, immature |
| 9 | `openpgp` (OpenPGP.js) 6.3.1 | ✅ | OpenPGP | ⚠️ long deployment | LGPL-3.0+ | **Reject** — no FS, no ratchet |

### 3.2 Why `@getmaapp/signal-wasm` is the answer

**What it is:** A Rust crate that compiles the official `libsignal-protocol` and
`zkgroup` crates from `signalapp/libsignal` to WebAssembly via `wasm-bindgen`. It
solves the WASM-specific challenges (randomness via Web Crypto, time via `js_sys::Date`)
and exposes a clean async TypeScript API with in-memory stores that support
export/import for persistence.

**What it is NOT:** An independent reimplementation. The cryptographic core is the
same code that runs in Signal's native apps. The wrapper adds only the WASM bridge
layer and store abstractions.

**Evidence of correctness (from E2EE-2B spike):**
- PQXDH session establishment: ✅ tested
- Kyber1024 prekey generation and encapsulation: ✅ tested
- Double Ratchet encrypt/decrypt: ✅ tested
- Out-of-order message handling: ✅ tested
- Replay rejection: ✅ tested
- Safety number generation: ✅ tested
- Vite production build: ✅ tested
- Bundle size: 787 KB WASM (299 KB gzip) + 75 KB JS (12 KB gzip)

**Version 0.6.6 (published 2026-08-20):**
- 12 releases since 2026-01-14 (active development)
- Zero runtime dependencies
- Clean store-based API with export/import for all stores
- Kyber anti-replay memory (`export_kyber_usage` / `import_kyber_usage`)
- Sender key support (not needed for enough., but indicates upstream completeness)

### 3.3 What makes this different from the previous NO-GO

The previous investigations asked: "Is this library fully trustworthy?"

This document asks: "Is this library **more trustworthy than plaintext messages**?"

The answer is definitively yes. The current state of enough. is that **every message
is stored in plaintext on Supabase**. A Supabase admin, a database leak, or a TLS
compromise reads everything. `@getmaapp/signal-wasm` — even unaudited, even AGPL,
even without provenance attestations — provides genuine E2EE against all of those
threats. The wrapper risk is real but bounded: the cryptographic core is official
libsignal code, and the wrapper is a thin bridge layer that can be reviewed.

---

## 4. Question C — Integration Suitability

### Can it be integrated cleanly into React/TypeScript/Supabase?

**Yes.** The existing architecture was designed for exactly this integration.

### 4.1 Evidence from the codebase

The project already has:

1. **`src/lib/crypto/`** — A clean crypto layer with identity keys, prekeys, IndexedDB
   storage, serialization, and a public API barrel (`index.ts`). This layer was
   explicitly designed to be extended with a session engine.

2. **`spikes/e2ee-compat-spike/protocol-adapter.types.ts`** — A typed adapter seam
   that maps 1:1 to `@getmaapp/signal-wasm`'s API (`processPreKeyBundle`,
   `encryptMessage`, `decryptMessage`, store interfaces).

3. **`experiments/e2ee-2b/`** — A working spike that demonstrates signal-wasm
   running in a Vite build with real encrypt/decrypt operations.

4. **`experiments/e2ee-2c/`** — A working spike that demonstrates the secret vault
   pattern (wrapping key, AAD-bound wrap/unwrap, atomic commits, tombstones).

5. **`profiles.identity_public_key`** — An existing column for publishing public keys.

6. **Existing RLS, Realtime, connection management** — All of which continue to work
   with ciphertext instead of plaintext.

### 4.2 Integration boundary

```
React UI (Chat.tsx, MessageComposer.tsx, MessageBubble.tsx)
    │  plaintext in, plaintext out
    │  NEVER imports crypto modules directly
    v
Message API (src/lib/api.ts)
    │  sendMessage() → encrypt → insert ciphertext
    │  getMessagesPage() → fetch → decrypt → return plaintext
    v
E2EE Session Manager (src/lib/e2ee/session-manager.ts)
    │  Web Lock: enough-e2ee:{userId}
    │  BroadcastChannel: enough-e2ee:{userId}
    │  Owns all protocol state transitions
    v
Engine Adapter (src/lib/e2ee/engine-adapter.ts)
    │  THE ONLY module that imports @getmaapp/signal-wasm
    │  Thin wrapper: translate enough. types ↔ libsignal types
    v
Secret Vault (src/lib/e2ee/vault.ts)
    │  IndexedDB: enough-e2ee-protocol
    │  Wrapping key: non-extractable AES-256-GCM CryptoKey
    │  All records stored as { iv, ciphertext, userId, kind, revision }
    v
Supabase (untrusted)
    │  Stores: ciphertext envelopes, public prekeys, metadata
    │  Never sees: plaintext, private keys, session state, wrapping key
```

---

## 5. Question D — Supply-Chain Confidence

### How trustworthy is the specific implementation/distribution?

**Honest assessment: moderately trustworthy, with known gaps.**

### 5.1 Trust chain

```
Signal Protocol Specification (public, peer-reviewed)
    ↓
libsignal Rust crates (official Signal repo, AGPL, deployed at Signal scale)
    ↓
@getmaapp/signal-wasm (compiles official crates to WASM)
    ↓
enough. engine adapter (thin wrapper, our code)
```

The trust chain has one weak link: the `@getmaapp/signal-wasm` wrapper. The upstream
crates are official Signal code. The wrapper adds:
- WASM compilation (wasm-bindgen)
- Randomness bridge (Web Crypto instead of OsRng)
- Time bridge (js_sys::Date instead of SystemTime)
- In-memory store implementations with export/import
- TypeScript type definitions

These are **bridge-layer concerns**, not cryptographic protocol concerns. A bug in
the randomness bridge would be catastrophic, but it is also a small, reviewable piece
of code. A bug in the store export/import would cause data loss, not a cryptographic
break (the protocol logic is in the Rust core).

### 5.2 Known gaps

| Gap | Risk | Mitigation |
|---|---|---|
| No independent audit | Wrapper bugs could exist | Review the ~500 lines of Rust bridge code; pin and hash all artifacts |
| No npm provenance attestation | Supply chain attack possible | Vendor artifacts + CI hash verification |
| No reproducible build | Can't verify WASM matches source | Rebuild from source and compare hashes (documented process) |
| AGPL-3.0 license | Copyleft obligation | Accept AGPL or don't ship (see §15) |
| Small project (12 stars, 1 org) | Bus factor | The core is libsignal; the wrapper is replaceable |
| AI-assisted development (GEMINI.md) | Quality concerns | The code is small enough to review manually |

### 5.3 What "good enough" looks like

For enough. to ship with `@getmaapp/signal-wasm`, we need:

1. **Vendored artifacts** — Download the exact npm tarball, extract WASM + JS,
   store them in the repo (or a private artifact store), and refuse to update
   without hash verification.

2. **CI hash pinning** — A CI job that verifies the SHA-256 hashes of:
   - `signal_wasm_bg.wasm`: `71b456b8a1bfc93111be86fdff9726ed397de55f223ee9136dab619a6620d6c1`
   - `signal_wasm.js`: `c72af7ae13a17fca0b0c2a2b8acb948c9eb9c71a17f9c4194c53bdf2ab883410`
   - npm tarball: `c3e0d6cdd2598634ca95bf531513d3ea9e44ce01dbb4f5ddd64d49313e5e3082`

3. **Wrapper review** — A documented review of the Rust bridge code (`src/lib.rs`,
   store implementations, randomness/time bridges). This is ~500 lines of Rust,
   not a full cryptographic audit.

4. **License acceptance** — An explicit project decision to accept AGPL-3.0 for the
   client application (see §15).

---

## 6. Question E — Operational Complexity

### How much additional infrastructure and state management does it require?

### 6.1 New Supabase tables (additive)

Four new tables for public prekey distribution:

```sql
-- Public device registration
CREATE TABLE public.crypto_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL DEFAULT 1,
  identity_key TEXT NOT NULL,           -- 32-byte Curve25519 public, base64
  registration_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id, device_id)
);

-- Signed prekeys (public portion)
CREATE TABLE public.crypto_signed_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL DEFAULT 1,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,             -- 32-byte X25519 public, base64
  signature TEXT NOT NULL,              -- 64-byte Ed25519 signature, base64
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- One-time X25519 prekeys
CREATE TABLE public.crypto_one_time_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL DEFAULT 1,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,             -- 32-byte X25519 public, base64
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  consumed_by_user_id UUID
);

-- Kyber1024 prekeys (one-time + last-resort)
CREATE TABLE public.crypto_kyber_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL DEFAULT 1,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,             -- 1184-byte Kyber public, base64
  signature TEXT NOT NULL,              -- 64-byte Ed25519 signature, base64
  is_last_resort BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  consumed_by_user_id UUID
);
```

Plus one RPC for atomic prekey consumption:

```sql
CREATE OR REPLACE FUNCTION public.claim_prekey_bundle(
  p_target_user_id UUID
) RETURNS JSONB ...
```

### 6.2 RLS policies

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `crypto_devices` | authenticated | owner | owner | owner |
| `crypto_signed_prekeys` | authenticated (active) | owner | owner | owner |
| `crypto_one_time_prekeys` | owner only | owner | RPC only | owner |
| `crypto_kyber_prekeys` | owner only | owner | RPC only | owner |

### 6.3 New IndexedDB database

```
IndexedDB: "enough-e2ee-protocol" (separate from "enough-crypto")
├── "meta"       → wrapping key, device metadata, schema version
├── "vault"      → wrapped protocol records (identity, sessions, prekeys, kyber)
├── "tombstones" → consumed key IDs (append-only, never reused)
├── "revisions"  → monotonic counters for anti-rollback
└── "peers"      → peer identity TOFU records + verification state
```

### 6.4 What stays unchanged

- `profiles` table (existing `identity_public_key` column stays for E2EE-1 X25519;
  the Signal identity is published via `crypto_devices`)
- `connections` table and all connection logic
- `messages` table (ciphertext column now holds real ciphertext)
- `message_deletions`, `chat_deletions`, `connection_reads` tables
- `user_blocks` table
- RLS on all existing tables
- Realtime subscriptions
- Authentication flow
- PWA service worker (static shell only, no crypto)

---

## 7. Scorecard

### 7.1 Weighting rationale

The weights reflect enough.'s priorities as a minimal 1:1 messenger:

- **Security/protocol maturity (25%):** The whole point. A broken protocol defeats
  the purpose.
- **Browser/WASM suitability (20%):** enough. is a browser app. If it can't run
  in the browser, nothing else matters.
- **Implementation maturity (15%):** A correct protocol with a buggy implementation
  is dangerous.
- **Integration with React/TypeScript (10%):** Engineering effort matters but is
  solvable.
- **Persistence/session model (10%):** Sessions must survive reload. This is
  table-stakes for a messenger.
- **Supply-chain/release confidence (10%):** Trust in the specific package we ship.
- **Complexity for a 1:1 messenger (10%):** Unnecessary complexity is a maintenance
  and security burden.

### 7.2 Scores

| Dimension | Weight | `@getmaapp/signal-wasm` | `matrix-sdk-crypto-wasm` | OpenMLS (hypothetical JS) | Pure-TS reimplementations |
|---|---|---|---|---|---|
| **Security/protocol maturity** | 25% | **9** — libsignal core is battle-tested at Signal's scale; PQXDH+DR is the gold standard | **7** — Olm audited, but no PQ; 2022 trust-model disclosure; Matrix-specific | **8** — MLS RFC 9420, SRLabs 2026 audit; PQ still draft | **3** — unaudited, untested, single-author |
| **Browser/WASM suitability** | 20% | **9** — proven in Vite spike; 299 KB gzip; clean ESM API | **5** — works but 2 MB gzip; API requires Matrix semantics shim | **4** — no official npm package; `js` feature exists but no maintained bindings | **8** — pure TS, trivial to bundle |
| **Implementation maturity** | 15% | **6** — 12 releases, active dev, but unaudited wrapper; self-published "audit" | **9** — Element Web production; Least Authority audit; massive deployment | **7** — SRLabs audit; used by Phoenix Air, XMTP, Cloudflare | **2** — weeks to months old; zero production use |
| **Integration with React/TS** | 10% | **9** — API matches adapter seam 1:1; spike proven | **3** — would need to drive OlmMachine with fake Matrix semantics | **5** — would need delivery-service mapping to Supabase | **7** — pure TS, easy to integrate |
| **Persistence/session model** | 10% | **8** — export/import on all stores; kyber usage tracking; designed for IndexedDB | **7** — Matrix CryptoStore exists but Matrix-specific | **5** — unknown; would need custom persistence | **4** — most have basic or no persistence |
| **Supply-chain confidence** | 10% | **4** — no attestations, no audit, small project, AGPL | **9** — Matrix.org, Apache-2.0, npm attestation | **8** — MIT, Phoenix R&D + Cryspen, SRLabs audit | **2** — no trust basis |
| **Complexity for 1:1** | 10% | **9** — purpose-built for 1:1; no group overhead | **4** — brings rooms, to-device, cross-signing, Megolm | **5** — 2-member group model; delivery service needed | **8** — minimal by nature |
| **WEIGHTED TOTAL** | 100% | **7.55** | **6.20** | **6.15** (hypothetical) | **3.95** |

### 7.3 Score explanations

**`@getmaapp/signal-wasm` — 7.55:**
- Security score (9): The protocol is the real Signal protocol via official libsignal
  crates. PQXDH with Kyber1024. Double Ratchet. This is not a reimplementation.
- Browser score (9): Proven in Vite spike. Small bundle. Clean ESM. No COOP/COEP.
- Implementation score (6): The wrapper is unaudited and young. The core is solid
  but the bridge layer needs review. Self-published "audit" is not credible.
- Supply-chain score (4): This is the weakest dimension. No provenance attestation,
  no independent audit, 12 stars, AGPL. Honest score.

**`matrix-sdk-crypto-wasm` — 6.20:**
- Security score (7): Audited Olm core, but no PQ. The 2022 Matrix trust-model
  disclosure (Albrecht et al.) showed that the surrounding trust model, not the
  crypto core, is where Matrix E2EE breaks. enough. would inherit that burden.
- Browser score (5): Works in browser but 2 MB gzip is heavy for a PWA.
- Integration score (3): The API is Matrix-shaped (`OlmMachine`, rooms, to-device
  events, cross-signing). Driving it without a Matrix homeserver is unsupported
  territory. Every upstream release could break the shim.
- Complexity score (4): Brings rooms, Megolm, cross-signing, key forwarding —
  none of which enough. needs.

**OpenMLS (hypothetical) — 6.15:**
- Scored hypothetically assuming official JS bindings existed. The SRLabs audit is
  real and recent. But PQ cipher suites are still IETF drafts. The delivery-service
  role is substantial new architecture. And the bindings don't exist.

**Pure-TS reimplementations — 3.95:**
- All unaudited. All immature. All single-author. Cannot serve as a trust anchor
  for production E2EE. The E2EE-2.5 rule stands: the engine must arrive *with*
  trust, not acquire it later.

---

## 8. Data Model

### 8.1 What Supabase stores

| Data | Table | Public? | Sensitive? | RLS | Plaintext? |
|---|---|---|---|---|---|
| User's Curve25519 identity public key | `crypto_devices.identity_key` | ✅ public | No (public key) | Yes | N/A |
| User's registration ID | `crypto_devices.registration_id` | ✅ public | Protocol metadata | Yes | N/A |
| Signed prekey public + signature | `crypto_signed_prekeys` | ✅ public | No (public key) | Yes | N/A |
| One-time prekey public | `crypto_one_time_prekeys` | Semi-public (claimed via RPC) | No (public key) | RPC-only SELECT | N/A |
| Kyber prekey public + signature | `crypto_kyber_prekeys` | Semi-public (claimed via RPC) | No (public key) | RPC-only SELECT | N/A |
| Encrypted message envelope | `messages.ciphertext` | ❌ opaque | Yes (ciphertext) | Existing RLS | **NEVER** |
| Sender ID | `messages.sender_id` | ✅ metadata | No | Existing RLS | N/A |
| Connection ID | `messages.connection_id` | ✅ metadata | No | Existing RLS | N/A |
| Timestamp | `messages.created_at` | ✅ metadata | No | Existing RLS | N/A |
| Message kind | `messages.kind` | ✅ metadata | No | Existing RLS | N/A |
| Read state | `connection_reads` | ✅ per-user | No | Existing RLS | N/A |
| Deletion tombstones | `message_deletions` | ✅ per-user | No | Existing RLS | N/A |

### 8.2 What Supabase must NEVER see

- Identity private keys (Curve25519 or Ed25519)
- Session records / ratchet state / root keys / chain keys / message keys
- PreKey private keys (X25519 or Kyber)
- Kyber anti-replay usage triples
- Wrapping keys
- Plaintext of `kind = 'text'` messages
- Safety number comparison outcomes (local only)

### 8.3 The `messages.ciphertext` column

**Current state (v0.1.0):** Contains plaintext despite its name. This is documented
in `src/lib/types.ts` and `src/lib/crypto/README.md`.

**Target state (v0.2.0):** Contains an opaque JSON envelope:

```json
{
  "v": 1,
  "e": "sw",
  "t": 3,
  "b": "base64-of-libsignal-ciphertext-body"
}
```

Where:
- `v`: envelope version (1)
- `e`: engine identifier ("sw" = signal-wasm)
- `t`: libsignal message type (2 = normal, 3 = prekey)
- `b`: base64-encoded ciphertext body from `encryptMessage()`

**Migration of existing plaintext:** DEFERRED. Old messages remain as plaintext
strings. The envelope format is distinguishable by the presence of `v` and `e` fields.
A future migration can re-encrypt or mark old messages as legacy.

### 8.4 System messages

`kind ∈ { 'name_change', 'connection_event', 'deleted_account' }` remain
**unencrypted** with empty/meta ciphertext. They are metadata, not private content.

---

## 9. Local Persistence

### 9.1 Storage comparison

| Option | Survives reload | Non-extractable keys | Multi-tab safe | Verdict |
|---|---|---|---|---|
| **IndexedDB** | ✅ | ✅ (CryptoKey objects) | ✅ (shared origin) | **✅ CHOSEN** |
| localStorage | ✅ | ❌ (plaintext strings) | ✅ | **Reject** — secrets as strings |
| sessionStorage | ❌ | ❌ | ❌ | **Reject** — lost on reload |
| React state | ❌ | ❌ | ❌ | **Reject** — lost on reload |
| Cookies | ✅ | ❌ | ✅ | **Reject** — sent to server |

### 9.2 Two IndexedDB databases

| Database | Purpose | Contents |
|---|---|---|
| `enough-crypto` (existing) | E2EE-1 foundation | Ed25519 identity, X25519 identity, signed prekeys, OTKs (all as non-extractable CryptoKey) |
| `enough-e2ee-protocol` (new) | Protocol engine state | Wrapped libsignal records, wrapping key, tombstones, revisions, peer identities |

Separate databases prevent a protocol-store bug from wiping E2EE-1 keys and vice versa.

### 9.3 Wrapping key (Model A from E2EE-2C)

- Per-user non-extractable AES-256-GCM wrapping key in `enough-e2ee-protocol/meta`
- All libsignal secret records stored as `{ iv, ciphertext }` with AAD binding
- Wrapping key generated once, never extractable, never published, never logged
- Purpose: reduces at-rest exposure of raw protocol bytes in IndexedDB dumps
- **Does NOT protect against XSS** — same-origin JS with the wrapping key can
  decrypt everything. This is an accepted, documented residual.

### 9.4 Lifecycle

| Event | Behaviour |
|---|---|
| First login | Generate wrapping key + libsignal identity; wrap and store |
| Reload | Load wrapping key; import identity/session/prekeys into WASM stores |
| Logout | Drop WASM in-memory stores; **keep** IndexedDB vault |
| Login same user | Restore vault from IndexedDB |
| Login different user | Different key prefix; never reuse wrapping key or identity |
| Account deletion | Delete vault prefix + E2EE-1 `deleteUserCryptoState()` |
| Browser data wipe | New device; peers see identity change |
| Two tabs open | Web Locks API exclusive lock on `enough-e2ee:{userId}`; BroadcastChannel for stale notification |

### 9.5 What happens when storage is deleted

If the user clears browser data:
- All local keys are lost
- The user gets a new cryptographic identity
- Peers detect the identity change via TOFU comparison
- Old messages encrypted to the old identity are undecryptable
- This is documented and expected — same as Signal's "new device" behavior

---

## 10. Message Flow

### 10.1 First contact

```
A searches B (existing flow)
A requests connection (existing flow)
B accepts (existing flow)
    ↓
A's client fetches B's prekey bundle via claim_prekey_bundle(B.userId) RPC
    ↓
A's client verifies B's signed prekey signature
A's client verifies B's kyber prekey signature
A's client compares B's identity to stored TOFU record (or creates one)
    ↓
A's client calls processPreKeyBundle() → establishes session
A's client persists session to IndexedDB (BEFORE sending)
    ↓
A's client encrypts first message as PreKey type (t=3)
A's client inserts envelope into messages.ciphertext
    ↓
Supabase Realtime delivers the row to B
    ↓
B's client detects envelope format (v=1, e=sw)
B's client calls decryptMessage() → establishes session + decrypts
B's client atomically persists session + consumed prekey tombstones
B's client displays plaintext
```

### 10.2 Normal message

```
User types "Hello"
    ↓
MessageComposer calls sendMessage(connectionId, senderId, "Hello")
    ↓
E2EE Session Manager acquires Web Lock
Engine Adapter calls encryptMessage(plaintext, peerAddress, ...)
    ↓
Returns { body: Uint8Array, message_type: 2|3 }
    ↓
Session Manager wraps session state, persists to IndexedDB
Session Manager releases Web Lock
    ↓
api.ts inserts { ciphertext: JSON.stringify(envelope) } into Supabase
    ↓
Supabase Realtime delivers to recipient
    ↓
Recipient's Session Manager acquires Web Lock
Engine Adapter calls decryptMessage(body, type, ...)
    ↓
Returns plaintext + consumed key IDs
    ↓
Session Manager persists updated session + tombstones
Session Manager releases Web Lock
    ↓
Chat.tsx displays plaintext in MessageBubble
```

### 10.3 Reload

```
Page reload
    ↓
AuthContext restores Supabase session
    ↓
initCrypto(userId) loads E2EE-1 identity from enough-crypto (existing)
    ↓
E2EE Session Manager initializes:
  - Load wrapping key from enough-e2ee-protocol/meta
  - Import identity into WASM stores
  - Import active sessions from vault
  - Import prekey/kyber state
    ↓
Chat.tsx subscribes to Realtime
Messages decrypt normally
```

### 10.4 Logout

```
User logs out
    ↓
Supabase signOut()
    ↓
E2EE Session Manager:
  - Drops WASM in-memory stores (garbage collected)
  - IndexedDB vault PERSISTS (identity survives logout)
  - BroadcastChannel notifies other tabs
    ↓
Next login with same user: restore vault
Next login with different user: different prefix, no collision
```

### 10.5 Account deletion

```
User deletes account
    ↓
deleteOwnAccount() (existing RPC — writes system messages, ends connections)
    ↓
deleteUserCryptoState(userId) — wipes E2EE-1 keys from enough-crypto
    ↓
E2EE Session Manager:
  - Delete all vault records with prefix userId:
  - Delete wrapping key
  - Delete tombstones
  - Delete peer identity records
    ↓
Supabase cascade deletes: crypto_devices, prekeys (via FK to auth.users)
    ↓
Messages remain as ciphertext on server (undecryptable without deleted keys)
```

### 10.6 Compromise scenarios

| Scenario | Impact | Mitigation |
|---|---|---|
| **Supabase compromised** | Attacker gets ciphertext + metadata. Cannot decrypt. | E2EE provides confidentiality. |
| **Database leaked** | Same as above. Ciphertext is opaque. | E2EE provides confidentiality. |
| **MITM during connection** | Attacker could substitute keys. | Safety numbers allow out-of-band verification. TOFU detection warns on key change. |
| **Local storage compromised** | Attacker gets wrapped records + wrapping key. Full compromise. | Documented residual. XSS = game over for any browser E2EE. |
| **Old session state obtained** | Old ratchet state doesn't expose future messages (PCS). | Double Ratchet heals on next roundtrip. |
| **Replay attack** | Ciphertext replayed. | Ratchet counters + AEAD + kyber usage tracking reject replays. |
| **Rollback attack** | Old IDB backup restored. | Monotonic revisions; refuse importing older session blobs. Full profile restore is a documented residual. |

---

## 11. Cryptographic State Machine

```
NEW DEVICE
    │
    │  initCrypto(userId)
    ▼
IDENTITY CREATED
    │  Ed25519 signing key (E2EE-1, non-extractable)
    │  X25519 DH key (E2EE-1, non-extractable)
    │  libsignal Curve25519 identity (in WASM, wrapped in vault)
    │  registration_id
    ▼
PREKEYS GENERATED
    │  Signed PreKey (X25519, signed by identity)
    │  One-Time PreKeys (X25519, pool of 100)
    │  Kyber PreKey (Kyber1024, signed by identity)
    │  Kyber Last-Resort PreKey (Kyber1024, signed, always present)
    ▼
PUBLIC MATERIAL PUBLISHED
    │  crypto_devices row (identity public, registration_id)
    │  crypto_signed_prekeys row (public + signature)
    │  crypto_one_time_prekeys rows (public, 100 keys)
    │  crypto_kyber_prekeys rows (public + signature, one-time + last-resort)
    ▼
READY FOR SESSION ESTABLISHMENT
    │
    │  Peer claims prekey bundle via RPC
    │  processPreKeyBundle() → PQXDH handshake
    ▼
SESSION ESTABLISHED
    │  Double Ratchet initialized with shared secret SK
    │  Session persisted to IndexedDB vault
    ▼
ACTIVE SESSION
    │
    ├─► SEND MESSAGE
    │     encryptMessage() → ratchet advances → persist → send envelope
    │
    ├─► RECEIVE MESSAGE
    │     decryptMessage() → ratchet advances → persist → display plaintext
    │     (if PreKey message: also consume OTK/Kyber, tombstone)
    │
    ├─► KEY ROTATION
    │     Signed PreKey rotated every 30 days
    │     OTK pool refilled when < 20
    │     Kyber last-resort rotated with SPK
    │
    └─► SESSION RESET
          Delete local session (not identity)
          Peer establishes new PreKey session
          History already decrypted stays local
```

---

## 12. Threat Model

### 12.1 Threat matrix

| ID | Threat | Protected by | Residual risk |
|---|---|---|---|
| T1 | **Supabase admin reads messages** | E2EE (ciphertext only on server) | ✅ Protected |
| T2 | **Database leak / SQL injection** | E2EE (ciphertext opaque) | ✅ Protected |
| T3 | **TLS compromise / network attacker** | E2EE + TLS | ✅ Protected |
| T4 | **Realtime channel compromise** | E2EE (envelopes, not plaintext) | ✅ Protected |
| T5 | **MITM during key exchange** | Safety numbers + TOFU | ⚠️ Requires user verification |
| T6 | **Device compromise** | None (browser E2EE can't protect against this) | ❌ Accepted residual |
| T7 | **XSS / compromised JavaScript** | None (same-origin = full access) | ❌ Accepted residual |
| T8 | **Compromised service worker** | None (SW can replace app code) | ❌ Accepted residual |
| T9 | **Replay attack** | Ratchet counters + AEAD + kyber usage | ✅ Protected |
| T10 | **Rollback attack** | Monotonic revisions | ⚠️ Full profile restore is residual |
| T11 | **Multi-tab race** | Web Locks API | ⚠️ Untested on mobile |
| T12 | **Malicious browser extension** | None | ❌ Accepted residual |
| T13 | **Compromised npm dependency** | Vendored artifacts + hash pinning | ⚠️ Wrapper review needed |
| T14 | **Compromised WASM artifact** | Hash verification + rebuild | ⚠️ Reproducible build not yet proven |

### 12.2 The honest security statement

> End-to-end encryption, when shipped, hides message bodies from the server and
> from the network. It does not hide them from anyone who can run JavaScript as
> enough. in your browser. A compromised web application, a malicious browser
> extension, or an attacker with access to your device can potentially read
> plaintext and keys on the client. This is an inherent limitation of browser-based
> E2EE, not a bug in enough.'s implementation.

This statement must appear in any user-facing security documentation.

---

## 13. Proposed Adapter Interface

```typescript
// src/lib/e2ee/types.ts

export interface E2EEEngine {
  /**
   * Initialize the engine for the authenticated user.
   * Loads or generates identity, prekeys, and sessions.
   * Idempotent; safe to call on every app start.
   */
  initialize(userId: string): Promise<void>;

  /**
   * Get the public prekey bundle for this device.
   * Returns null if engine is not initialized.
   * This is what gets published to Supabase.
   */
  getPublicBundle(): Promise<PublicPreKeyBundle | null>;

  /**
   * Establish a session with a peer using their prekey bundle.
   * Called when sending the first message to a new peer.
   * Persists session BEFORE returning.
   */
  establishSession(
    peerUserId: string,
    peerBundle: PublicPreKeyBundle,
  ): Promise<void>;

  /**
   * Check whether a session exists with a peer.
   */
  hasSession(peerUserId: string): Promise<boolean>;

  /**
   * Encrypt a message for a peer.
   * Returns the envelope to store in messages.ciphertext.
   * Session must be established first.
   * Persists updated session state BEFORE returning.
   */
  encryptMessage(
    peerUserId: string,
    plaintext: string,
  ): Promise<EncryptedEnvelope>;

  /**
   * Decrypt a message from a peer.
   * Returns the plaintext.
   * If this is a PreKey message, establishes the session automatically.
   * Persists updated session state + consumed key tombstones BEFORE returning.
   */
  decryptMessage(
    senderUserId: string,
    envelope: EncryptedEnvelope,
  ): Promise<string>;

  /**
   * Get the safety number for a peer session.
   * Returns null if no session exists.
   */
  getSafetyNumber(peerUserId: string): Promise<string | null>;

  /**
   * Get the verification state for a peer.
   */
  getPeerVerificationState(
    peerUserId: string,
  ): Promise<PeerVerificationState>;

  /**
   * Mark a peer as verified (user confirmed safety number).
   */
  verifyPeer(peerUserId: string): Promise<void>;

  /**
   * Accept an identity change for a peer (after user confirmation).
   * Resets the session; peer will need to re-establish.
   */
  acceptIdentityChange(peerUserId: string): Promise<void>;

  /**
   * Check if the browser supports all required crypto primitives.
   */
  isSupported(): boolean;

  /**
   * Clean up. Drops in-memory state.
   * IndexedDB vault persists.
   */
  destroy(): Promise<void>;
}

export interface PublicPreKeyBundle {
  userId: string;
  deviceId: number;
  identityKey: string;          // base64, 32 bytes
  registrationId: number;
  signedPreKey: {
    keyId: number;
    publicKey: string;          // base64, 32 bytes
    signature: string;          // base64, 64 bytes
  };
  oneTimePreKey: {
    keyId: number;
    publicKey: string;          // base64, 32 bytes
  } | null;
  kyberPreKey: {
    keyId: number;
    publicKey: string;          // base64, 1184 bytes
    signature: string;          // base64, 64 bytes
    isLastResort: boolean;
  };
}

export interface EncryptedEnvelope {
  v: 1;
  e: 'sw';
  t: 2 | 3;                    // libsignal message type
  b: string;                    // base64 ciphertext body
}

export type PeerVerificationState =
  | 'unverified'                // TOFU: first seen, not yet compared
  | 'verified'                  // user confirmed safety number
  | 'identity_changed'          // peer key changed; sending blocked
  | 'new_device';               // reserved for future multi-device
```

### 13.1 What belongs where

| Directory | Responsibility |
|---|---|
| `src/lib/e2ee/` | E2EE adapter, session manager, vault, types |
| `src/lib/e2ee/engine-adapter.ts` | THE ONLY module importing `@getmaapp/signal-wasm` |
| `src/lib/e2ee/session-manager.ts` | Web Lock, BroadcastChannel, orchestration |
| `src/lib/e2ee/vault.ts` | IndexedDB wrapping/unwrapping, atomic commits |
| `src/lib/e2ee/types.ts` | Public interfaces (above) |
| `src/lib/crypto/` | E2EE-1 foundation (unchanged) |
| `src/lib/api.ts` | Modified: `sendMessage()` encrypts; `getMessagesPage()` decrypts |
| `src/components/Chat.tsx` | Modified: handles encrypted envelopes, shows verification state |
| `src/components/MessageBubble.tsx` | Modified: decrypts before display |
| `src/components/MessageComposer.tsx` | Modified: encrypts before send |
| `src/context/AuthContext.tsx` | Modified: initializes E2EE engine on auth |

---

## 14. DEFERRED Features

The following are explicitly out of scope for v0.2:

| Feature | Status | Reason |
|---|---|---|
| Groups | DEFERRED | enough. is 1:1 only |
| Multi-device | DEFERRED | One device per account in v0.2 |
| Key backup / recovery | DEFERRED | Device wipe = new identity (documented) |
| Cross-device sync | DEFERRED | Requires multi-device first |
| Image/file messaging | DEFERRED | Not in product scope |
| Voice/video calls | DEFERRED | Not in product scope |
| Sealed sender | DEFERRED | Privacy enhancement for later |
| Complex identity verification UI | DEFERRED | Safety number display is sufficient for v0.2 |
| QR code verification | DEFERRED | Manual digit comparison for v0.2 |
| PQ migration (SPQR) | DEFERRED | PQXDH already provides HNDL protection |
| Federation / Matrix compatibility | DEFERRED | Not in product scope |
| Migration of existing plaintext messages | DEFERRED | Old messages stay as plaintext strings |

---

## 15. License Decision

### 15.1 The AGPL question

`@getmaapp/signal-wasm` is AGPL-3.0-only. The upstream `libsignal` is also AGPL-3.0-only.

AGPL-3.0 §13 requires that if you modify the software and make it available over a
network, you must offer the Corresponding Source to users interacting with it.

### 15.2 What this means for enough.

1. **enough. must declare a license.** The repository currently has no LICENSE file.
   This must be resolved before shipping E2EE.

2. **If enough. chooses AGPL-3.0:** The entire application becomes AGPL. All source
   code must be available. This is compatible with the current public GitHub repo
   model but may conflict with future plans.

3. **If enough. chooses a permissive license (MIT, Apache-2.0):** Bundling AGPL
   WASM likely makes the combined work AGPL. This needs legal review.

4. **If enough. chooses GPL-3.0:** Compatible with AGPL-3.0 (AGPL is GPL-3.0 with
   additional network-access requirements).

### 15.3 Recommendation

**Accept AGPL-3.0 for the client application.** enough. is already open-source on
GitHub. The AGPL obligation (make source available to users) is already satisfied
by the public repository. The alternative — no E2EE — is worse for users.

This must be an explicit project owner decision, documented in the LICENSE file.

---

## 16. What We Should Build Next — Implementation Sequence for v0.2

### Phase 1: License + Foundation (Week 1)

1. **Add LICENSE file** — AGPL-3.0-or-later (or project owner's choice)
2. **Vendor signal-wasm artifacts** — Download exact npm tarball, extract WASM + JS,
   store in `src/lib/e2ee/vendor/` with SHA-256 hashes in a manifest
3. **Add CI hash verification** — Build step that verifies vendored artifacts match
   expected hashes
4. **Create `src/lib/e2ee/` directory structure** — types.ts, engine-adapter.ts,
   session-manager.ts, vault.ts

### Phase 2: Engine Adapter (Week 2)

5. **Implement engine-adapter.ts** — Thin wrapper around signal-wasm:
   - `initialize()`: load/generate identity, import into WASM stores
   - `getPublicBundle()`: construct bundle from WASM stores
   - `establishSession()`: call `processPreKeyBundle()`
   - `encryptMessage()`: call `encryptMessage()`
   - `decryptMessage()`: call `decryptMessage()`
   - `getSafetyNumber()`: derive from identity keys
6. **Implement vault.ts** — IndexedDB wrapping/unwrapping:
   - Generate wrapping key
   - Wrap/unwrap protocol records with AAD binding
   - Atomic commit after each encrypt/decrypt
   - Tombstone management
7. **Write adapter tests** — Using the same test vectors from E2EE-2B spike

### Phase 3: Supabase Schema (Week 3)

8. **Create migration** — `crypto_devices`, `crypto_signed_prekeys`,
   `crypto_one_time_prekeys`, `crypto_kyber_prekeys` tables
9. **Create RLS policies** — Per the matrix in §6.2
10. **Create `claim_prekey_bundle()` RPC** — Atomic prekey consumption with
    `FOR UPDATE SKIP LOCKED`
11. **Add API functions** — `publishPreKeyBundle()`, `claimPreKeyBundle()`,
    `refillPreKeys()` in `src/lib/api.ts`

### Phase 4: Session Manager (Week 3-4)

12. **Implement session-manager.ts** — Web Lock + BroadcastChannel orchestration:
    - Acquire lock before every encrypt/decrypt
    - Persist-before-release pattern
    - Stale notification via BroadcastChannel
    - Fail-closed if Web Locks unavailable
13. **Wire into AuthContext** — Initialize engine on auth state change
14. **Implement prekey lifecycle** — Publish bundle on init, refill when low,
    rotate signed prekeys

### Phase 5: Message Flow (Week 4-5)

15. **Modify `sendMessage()`** — Encrypt plaintext → insert envelope
16. **Modify `getMessagesPage()`** — Fetch → detect envelope → decrypt → return
17. **Modify `Chat.tsx`** — Handle encrypted envelopes, show lock icon
18. **Modify `MessageBubble.tsx`** — Decrypt before display
19. **Modify `MessageComposer.tsx`** — Encrypt before send
20. **Handle first contact** — Fetch peer bundle on first message to new connection

### Phase 6: Identity Verification (Week 5)

21. **Implement safety number display** — 12 groups of 5 digits
22. **Implement TOFU** — Store peer identity on first contact
23. **Implement identity change detection** — Block sending, show warning dialog
24. **Implement verification state** — `unverified` / `verified` / `identity_changed`

### Phase 7: Lifecycle + Hardening (Week 6)

25. **Account deletion** — Wipe vault + E2EE-1 keys
26. **Logout** — Drop WASM state, keep vault
27. **Multi-tab testing** — Verify Web Locks behavior
28. **CSP** — Add `wasm-unsafe-eval` meta tag
29. **Error handling** — Graceful degradation when E2EE unavailable
30. **Documentation** — Update README, security statement, user-facing copy

### Phase 8: Testing + Validation (Week 6-7)

31. **End-to-end test** — Alice sends, Bob receives, both decrypt
32. **Out-of-order test** — Deliver messages out of order
33. **Replay test** — Replay ciphertext, verify rejection
34. **Reload test** — Persist session, reload, continue messaging
35. **Identity change test** — Replace identity, verify detection
36. **Mobile testing** — Android Chrome, iOS Safari PWA
37. **Bundle size verification** — Lazy-load engine, measure impact

---

## 17. Decision

```
RECOMMENDED ENGINE:     @getmaapp/signal-wasm@0.6.6
RECOMMENDED PROTOCOL:   Signal PQXDH + Double Ratchet (libsignal core, Kyber1024)
RECOMMENDED INTEGRATION MODEL: Thin adapter behind src/lib/e2ee/ boundary
RECOMMENDED LOCAL STORAGE: IndexedDB with Web Crypto wrapping key (Model A)
RECOMMENDED SUPABASE MODEL: Additive prekey tables + messages.ciphertext envelopes
PRODUCTION READINESS:   Conditional — AGPL acceptance + vendored artifacts + wrapper review
```

### Why this wins

1. **It's the real Signal protocol.** Not a reimplementation, not a subset, not a
   "Signal-inspired" library. The cryptographic core is the official libsignal Rust
   crates deployed at Signal's scale.

2. **It runs in the browser.** Proven in a Vite spike. 299 KB gzip. No Node polyfills.
   No COOP/COEP. Clean ESM API.

3. **The API fits perfectly.** The store-based design (`processPreKeyBundle`,
   `encryptMessage`, `decryptMessage`, export/import) maps 1:1 to the adapter seam
   already designed in the codebase.

4. **It provides PQXDH with Kyber1024.** Harvest-now-decrypt-later protection.
   No other browser candidate offers this.

5. **The bundle is small.** 299 KB gzip for the full Signal protocol engine.
   Matrix alternatives are 2+ MB gzip.

6. **The alternative is plaintext.** The current state of enough. is that every
   message is stored in plaintext on Supabase. Any real E2EE is better than this.

### Why the alternatives lose

| Alternative | Why it loses |
|---|---|
| **`@signalapp/libsignal-client`** | Cannot run in the browser. Node-native only. Signal explicitly declines WASM support. |
| **`@matrix-org/matrix-sdk-crypto-wasm`** | API is Matrix-locked (rooms, to-device, cross-signing). Driving it without a Matrix homeserver is unsupported. No PQ. 2 MB gzip. |
| **vodozemac + third-party bindings** | No maintained official JS bindings. Third-party bindings are dormant (1 star, 15+ months stale). Would make enough. the unaudited packager. |
| **OpenMLS** | No official JS bindings. PQ cipher suites are still IETF drafts. Delivery-service role is substantial new architecture. |
| **`@wireapp/core-crypto`** | GPL-3.0. Wire-locked API. P-256 classical suite (no PQ). 2.8 MB gzip. |
| **Pure-TS Signal reimplementations** | All unaudited, immature, single-author. Cannot serve as a trust anchor. |
| **OpenPGP.js** | No forward secrecy. No post-compromise security. Not a ratchet protocol. |
| **Homemade AES-GCM** | Forbidden by project rules. No forward secrecy, no ratchet, no prekeys. False security. |
| **Wait for "perfect" library** | The ecosystem has been static for years. Signal won't ship WASM. Matrix won't decouple from Matrix. MLS JS bindings don't exist. Waiting means shipping plaintext indefinitely. |

---

## 18. Risks and Acceptances

| Risk | Likelihood | Impact | Acceptance |
|---|---|---|---|
| Wrapper bug causes cryptographic failure | Low | Critical | Mitigated by: wrapper is thin bridge layer; core is official libsignal; wrapper review before production |
| AGPL license conflicts with project goals | Medium | High | **Must be resolved before implementation.** Accept AGPL or don't ship. |
| Upstream wrapper abandoned | Medium | Medium | Core is libsignal (not going away). Wrapper is replaceable — the bridge layer is small enough to fork. |
| XSS compromises all keys and plaintext | Medium | Critical | **Accepted residual.** Documented. Same limitation as every browser E2EE implementation. |
| Browser clears IndexedDB | Low | High | Documented. User gets new identity. Same as Signal "new device." |
| Multi-tab race corrupts session | Low | High | Mitigated by Web Locks API. Fail-closed if unavailable. |
| Mobile WASM performance issues | Low | Medium | Spike shows sub-millisecond operations. Must test on real devices (M1-M14 from E2EE-2C). |
| Reproducible build cannot be proven | Medium | Low | Vendor artifacts + hash pinning as interim. Reproducible build is a goal, not a blocker. |

---

## 19. Sources

All primary sources from the predecessor documents remain valid. Key additions:

- npm registry: `@getmaapp/signal-wasm` 0.6.6 (published 2026-08-20), verified today
- GitHub: `getmaapp/signal-wasm` (5 stars, 1 fork, 2 releases on GitHub, 12 on npm)
- GitHub: `signalapp/libsignal` (5,959 stars, active, AGPL-3.0)
- GitHub: `openmls/openmls` (1,015 stars, `js` feature, SRLabs 2026 audit)
- GitHub: `matrix-org/matrix-sdk-crypto-wasm` (active, Apache-2.0)
- Signal PQXDH specification: signal.org/docs/specifications/pqxdh/ (Rev 3)
- Double Ratchet specification: signal.org/docs/specifications/doubleratchet/ (Rev 4)
- SRLabs OpenMLS audit: 2026-05-27 (8 findings, 7 fixed)
- Least Authority vodozemac audit: 2022-03-30

---

## 20. Change Log

- **2026-08-23:** Initial engine selection decision. Recommends `@getmaapp/signal-wasm`
  with explicit risk acceptance. Replaces the NO-GO from E2EE-2.5 and E2EE-SR with a
  CONDITIONAL GO based on the pragmatic assessment that real E2EE with known risks is
  better than plaintext messages with no risks.
