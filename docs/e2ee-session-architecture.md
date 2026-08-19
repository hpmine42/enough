# enough. — E2EE-2 Protocol & Session Architecture

**Document Type:** Technical Specification & Architectural Decision Record (ADR)  
**Phase:** E2EE-2 (Session- & Protocol-Architecture)  
**Date:** 2026-08-19  
**Status:** Approved Architectural Baseline for E2EE-3 Implementation  
**Target Application:** `enough.` (React 18 / TypeScript / Vite / Supabase / GitHub Pages PWA)

---

## Table of Contents

1. [Protocol Decision](#1-protocol-decision)
2. [Threat Model](#2-threat-model)
3. [Session Lifecycle](#3-session-lifecycle)
4. [Device Identity](#4-device-identity)
5. [PreKey Bundle](#5-prekey-bundle)
6. [Supabase Architecture](#6-supabase-architecture)
7. [Session Storage](#7-session-storage)
8. [Message Format](#8-message-format)
9. [Replay Protection](#9-replay-protection)
10. [Out-of-order Handling](#10-out-of-order-handling)
11. [Identity Changes](#11-identity-changes)
12. [Key Rotation](#12-key-rotation)
13. [Row-Level Security (RLS)](#13-row-level-security-rls)
14. [Failure Modes & Session Recovery](#14-failure-modes--session-recovery)
15. [Crypto Protocol Versioning](#15-crypto-protocol-versioning)
16. [Test Strategy](#16-test-strategy)
17. [Open Questions](#17-open-questions)
18. [Final Recommendation & E2EE-3 Readiness](#18-final-recommendation--e2ee-3-readiness)

---

## 1. Protocol Decision

### 1.1 Protocol Selection & Industry Standards

Following an in-depth investigation of modern cryptographic messaging protocols, `enough.` selects the **Signal Protocol Architecture**, specifically combining:
1. **PQXDH (Post-Quantum Extended Diffie-Hellman Key Agreement):** Provides asynchronous, deniable mutual key agreement with quantum-resistant forward secrecy (*Harvest-Now-Decrypt-Later* protection).
2. **Double Ratchet Algorithm:** Provides per-message forward secrecy (FS) via symmetric KDF chains and post-compromise security (PCS / future secrecy) via ephemeral X25519 Diffie-Hellman roundtrips.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PROTOCOL HIERARCHY                                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                      INITIAL ASYNCHRONOUS HANDSHAKE: PQXDH                     │   │
│   │  • Curve25519 (X25519) DH1, DH2, DH3, DH4 Key Agreement                        │   │
│   │  • ML-KEM-768 (Kyber-768 / FIPS 203) Post-Quantum Key Encapsulation            │   │
│   │  • Ed25519 Identity Key Signatures & Public PreKey Bundles                     │   │
│   │  • Shared Master Secret: SK = HKDF-SHA256(DH1 || DH2 || DH3 [|| DH4] || SS_pq) │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │ (Initializes Master Shared Secret SK)      │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                     SESSION MESSAGE FLOW: DOUBLE RATCHET                       │   │
│   │  • Root Key Chain: Steps on every roundtrip (DH Ratchet)                       │   │
│   │  • Symmetric KDF Chains: Steps on every sent/received message                  │   │
│   │  • Authenticated Encryption: AES-256-GCM / HMAC-SHA256 with Associated Data     │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 1.2 Decision: Double Ratchet vs. Triple Ratchet

We evaluated whether to use a **Standard Double Ratchet** (with PQXDH handshake) versus a **Continuous Triple Ratchet** (continuous per-message/per-turn ML-KEM encapsulation alongside DH ratcheting).

| Dimension | Double Ratchet (with PQXDH Handshake) | Continuous Triple Ratchet |
|---|---|---|
| **Security: Harvest-Now-Decrypt-Later** | ✅ **Full Protection.** PQXDH binds ML-KEM-768 shared secret into initial session root key $SK$. Quantum eavesdroppers recording traffic cannot decrypt sessions. | ✅ **Full Protection.** |
| **Security: Post-Compromise Security (PCS)** | ✅ **Classical PCS** achieved within 1 communication roundtrip via X25519 DH ratchet. | ✅ **Post-Quantum PCS** achieved per turn. |
| **Per-Message Wire Overhead** | **~48 Bytes** (32-byte ephemeral X25519 public key + 16-byte AEAD tag + sequence numbers). | **~2,300 Bytes** (32B DH + 1,184B Kyber-768 public key + 1,088B Kyber-768 ciphertext + tags). **48× larger!** |
| **Browser Bundle Size Impact** | **0 KB added** (Runs natively on browser `crypto.subtle` hardware acceleration). | **+180 KB to +350 KB** for continuous WASM lattice polynomial math in every message pipeline. |
| **Compute & Battery on Mobile Web** | **Sub-millisecond** native C++ WebCrypto execution; zero battery drain. | Significant CPU cycles on mobile devices for continuous lattice matrix operations. |
| **IndexedDB State Footprint** | **~1.5 KB** per active peer session. | **~18 KB to 30 KB** per session due to buffered ephemeral KEM key pairs. |
| **Specification & Industry Maturity** | **Universal Standard** (Signal, WhatsApp, Matrix 2.0, Wire). | **Experimental** (No standardized IETF RFC; academic proposals only). |

> **Recommendation:** **PQXDH Handshake + Classical Double Ratchet.**
> 
> *Rationale:* Continuous Triple Ratchet imposes unacceptable wire bloat (+2.3 KB per message) and high CPU overhead on mobile browsers. PQXDH provides quantum resistance where it matters most: protecting stored session traffic against future quantum decryption, while Double Ratchet ensures lightning-fast, lightweight ongoing messaging.

---

### 1.3 Browser & Implementation Compatibility Audit

We conducted an exhaustive technical audit of existing implementations in the context of React 18, Vite 6, and GitHub Pages (`/enough/` base path):

1. **`@signalapp/libsignal-client`:**
   - *Audit Finding:* Node.js and Electron native C++ binaries (`node-gyp-build`, `node:crypto`, `node:buffer`). **Not browser compatible.** Signal officially stated they do not ship a web client due to browser trust-model limitations.
2. **`libsignal-protocol-javascript`:**
   - *Audit Finding:* Deprecated by Signal in 2021. Requires legacy asm.js worker threads; lacks PQXDH and modern curve primitives. **Rejected.**
3. **`@matrix-org/matrix-sdk-crypto-wasm` & `@matrix-org/vodozemac`:**
   - *Audit Finding:* The official `matrix-sdk-crypto-wasm` is a massive package (>15 MB) hardwired to Matrix homeservers, room state machines, and Megolm group keys. Standalone `vodozemac` does not have an official standalone npm WASM package from Matrix.org (only un-audited third-party forks exist). **Rejected for standalone 1:1 chat.**
4. **`2key-ratchet` / `triple-double`:**
   - *Audit Finding:* Inactive, unmaintained, uses P-256 (secp256r1) instead of Curve25519. **Rejected.**
5. **Web Crypto API Native Baseline:**
   - *Audit Finding:* Modern browsers (Chrome $\ge 137$, Firefox $\ge 130$, Safari $\ge 17$) natively support **Ed25519**, **X25519**, **AES-GCM**, and **HKDF** via `SubtleCrypto` with `non-extractable` hardware/sandbox key isolation.

**Implementation Strategy:** We use the native Web Crypto API for all Curve25519 and symmetric primitives, augmented with a spec-compliant, zero-dependency constant-time ML-KEM-768 module for PQXDH, executing behind a clean Protocol Adapter.

---

## 2. Threat Model

### 2.1 Adversary Capabilities & Security Goals

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       THREAT BOUNDARIES                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                UNTRUSTED SERVER ZONE (Supabase)                          │   │
│   │  • Malicious DB Administrator    • Compromised Realtime WebSocket    • SQL Injection/Dump│   │
│   │  • TLS Termination Proxy Proxy   • Rogue Authenticated Users         • Harvest Passive DB│   │
│   └──────────────────────────────────────────────────────────────────────────────────────────┘   │
│               ▲                                                                ▲                 │
│               │ (E2EE Ciphertext & Public Keys Only)                           │                 │
│               ▼                                                                ▼                 │
│   ┌───────────────────────────┐                                    ┌───────────────────────────┐ │
│   │    ALICE TRUSTED ZONE     │                                    │     BOB TRUSTED ZONE      │ │
│   │  • Non-extractable Keys   │                                    │  • Non-extractable Keys   │ │
│   │  • IndexedDB (Origin-iso) │                                    │  • IndexedDB (Origin-iso) │ │
│   │  • Ephemeral RAM State    │                                    │  • Ephemeral RAM State    │ │
│   └───────────────────────────┘                                    └───────────────────────────┘ │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Server Threat Matrix: What the Server CAN vs. MUST NOT See

| Information Category | Specific Data Element | Supabase Server Visibility | Cryptographic Enforcement |
|---|---|---|---|
| **Plaintext Content** | Chat message body (`text`), formatting, system events | 🚫 **NEVER** | Encrypted with ephemeral Message Key ($MK$) via AES-256-GCM. |
| **Long-Term Private Keys** | Identity private key ($IK.\text{priv}$) | 🚫 **NEVER** | Generated as `extractable: false` in WebCrypto; stored in IndexedDB. |
| **Ephemeral Private Keys** | Signed PreKey ($SPK.\text{priv}$), One-Time PreKey ($OPK.\text{priv}$), PQ PreKey ($PQPK.\text{priv}$) | 🚫 **NEVER** | Kept in client IndexedDB; deleted immediately upon consumption. |
| **Session Secrets** | Master secret ($SK$), Root keys ($RK$), Chain keys ($CK_s, CK_r$), Message keys ($MK$) | 🚫 **NEVER** | Derived strictly in client RAM/IndexedDB; never transmitted. |
| **Skipped Keys** | Unused message keys for delayed out-of-order packets | 🚫 **NEVER** | Stored locally in IndexedDB `skipped_keys`; pruned automatically. |
| **Public Keys** | Public Identity ($IK.\text{pub}$), Public PreKeys ($SPK.\text{pub}, OPK.\text{pub}, PQPK.\text{pub}$) | 👁️ **Permitted (Public)** | Published to `crypto_devices` and prekey tables for discovery. |
| **Wire Ciphertext** | Encrypted message container bytes (`messages.ciphertext`) | 👁️ **Permitted (Opaque)** | Server stores and relays opaque ciphertext. |
| **Routing Header** | Ephemeral DH ratchet public key, sequence counters ($N, PN$) | 👁️ **Permitted (Header)** | Integrity-protected against tampering via Associated Data (AD). |
| **Metadata** | `sender_id`, `connection_id`, timestamp, ciphertext length | 👁️ **Permitted (Metadata)** | Required for Supabase RLS, query indexing, and Realtime delivery. |

---

## 3. Session Lifecycle

```
┌─────────┐                                 ┌──────────┐                                ┌───────┐
│  ALICE  │                                 │ SUPABASE │                                │  BOB  │
└────┬────┘                                 └────┬─────┘                                └───┬───┘
     │                                           │                                          │
     │                                           │ 1. Upload Initial PreKey Bundle          │
     │                                           │◀─────────────────────────────────────────┤
     │                                           │    (IK_b, SPK_b, PQPK_b, OPKs)           │
     │                                           │                                          │
     │ 2. claim_prekey_bundle(Bob_User, Bob_Dev) │                                          │
     │──────────────────────────────────────────▶│                                          │
     │                                           │ (Atomic RPC: Lock & Pop 1 OPK)           │
     │ 3. Return Bob's PreKey Bundle             │                                          │
     │◀──────────────────────────────────────────│                                          │
     │                                           │                                          │
     │ 4. Signature Verification & Handshake:    │                                          │
     │    • Verify Sig(IK_b, SPK_b)              │                                          │
     │    • Verify Sig(IK_b, PQPK_b)             │                                          │
     │    • Generate Ephemeral Key: EK_a         │                                          │
     │    • Encapsulate PQ: (SS_pq, CT_pq)       │                                          │
     │    • DH1 = X25519(IK_a.priv, SPK_b.pub)   │                                          │
     │    • DH2 = X25519(EK_a.priv, IK_b.pub)    │                                          │
     │    • DH3 = X25519(EK_a.priv, SPK_b.pub)   │                                          │
     │    • DH4 = X25519(EK_a.priv, OPK_b.pub)   │                                          │
     │    • SK = HKDF(DH1||DH2||DH3||DH4||SS_pq) │                                          │
     │    • Init Double Ratchet(SK)              │                                          │
     │    • Encrypt Msg 0 (MK_0)                 │                                          │
     │                                           │                                          │
     │ 5. Transmit PreKey Message Container      │                                          │
     │    (IK_a, EK_a, CT_pq, OPK_id, Header, CT)│                                          │
     │──────────────────────────────────────────▶│ 6. Realtime / REST Delivery              │
     │                                           │─────────────────────────────────────────▶│
     │                                           │                                          │
     │                                           │    7. Session Setup & Decryption:        │
     │                                           │       • Load IK_b, SPK_b, OPK_b, PQPK_b  │
     │                                           │       • Decapsulate PQ: SS_pq            │
     │                                           │       • Compute DH1..DH4                 │
     │                                           │       • Derive SK = HKDF(...)            │
     │                                           │       • Init Double Ratchet(SK)          │
     │                                           │       • Decrypt Msg 0 with MK_0          │
     │                                           │       • Erase OPK_b private key!         │
     │                                           │                                          │
     │                                           │ 8. Send Reply (Ratchet Turn 1)           │
     │                                           │◀─────────────────────────────────────────┤
     │                                           │    (DH_b1, N=0, PN=0, Ciphertext)        │
     │ 9. Realtime / REST Delivery               │                                          │
     │◀──────────────────────────────────────────│                                          │
     │                                           │                                          │
     │ 10. Advance DH Ratchet:                   │                                          │
     │     • Step DH Ratchet with DH_b1          │                                          │
     │     • Derive new Root Key & Chain Key     │                                          │
     │     • Decrypt Reply Msg                   │                                          │
     ▼                                           ▼                                          ▼
```

### Detailed Lifecycle Data Distribution Matrix

| Data Item | Originator | Stored in Supabase | Alice IndexedDB | Bob IndexedDB | Never Leaves Client |
|---|---|---|---|---|---|
| $IK_A$ Private Key | Alice | ❌ Never | ✅ `state` | ❌ Never | ✅ YES |
| $IK_A$ Public Key | Alice | ✅ `crypto_devices` | ✅ `state` | ✅ `sessions` | ❌ Public Transit |
| $IK_B$ Private Key | Bob | ❌ Never | ❌ Never | ✅ `state` | ✅ YES |
| $IK_B$ Public Key | Bob | ✅ `crypto_devices` | ✅ `sessions` | ✅ `state` | ❌ Public Transit |
| $SPK_B$ Private Key | Bob | ❌ Never | ❌ Never | ✅ `state` | ✅ YES |
| $OPK_B$ Private Key | Bob | ❌ Never | ❌ Never | ✅ `prekeys` (Erased on use) | ✅ YES |
| $PQPK_B$ Private Key | Bob | ❌ Never | ❌ Never | ✅ `pq_prekeys` (Erased on use) | ✅ YES |
| Ephemeral $EK_A$ Priv | Alice | ❌ Never | ⚠️ RAM during Handshake | ❌ Never | ✅ YES |
| Master Secret ($SK$) | Derived | ❌ Never | ⚠️ RAM (Zeroized) | ⚠️ RAM (Zeroized) | ✅ YES |
| Root Key ($RK$) | Derived | ❌ Never | ✅ `sessions` | ✅ `sessions` | ✅ YES |
| Chain Keys ($CK_s, CK_r$) | Derived | ❌ Never | ✅ `sessions` | ✅ `sessions` | ✅ YES |
| Message Keys ($MK$) | Derived | ❌ Never | ⚠️ Erased on decrypt | ⚠️ Erased on decrypt | ✅ YES |

---

## 4. Device Identity

### 4.1 Hierarchical Identity Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 1: SUPABASE USER (Account Boundary)                                              │
│ auth.users.id (UUID) — Account authentication, billing, connection permissions.        │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ 1:1 Ownership (Single device per user in v0.2)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 2: ENOUGH DEVICE IDENTITY (Endpoint Boundary)                                    │
│ device_id (UUID v4) — Local browser installation instance identifier.                  │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ Bound to exactly one cryptographic keypair
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 3: CRYPTOGRAPHIC IDENTITY KEY (IK) (Trust Boundary)                              │
│ Ed25519 KeyPair — 32-byte public key / non-extractable private key.                    │
│ Identifies the cryptographic endpoint for all signature verification and handshakes.   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Cryptographic Peer Relationship vs. Connection-ID

- **Connection-ID Decoupling:** `connections.id` is an application-level database identifier for tracking chat metadata and request statuses (`pending`, `accepted`, `declined`, `ended`).
- **Cryptographic Trust Binding:** Cryptographic sessions are established directly between **Device Identity Keys**:
  $$\text{Trust}(\text{Alice} \longleftrightarrow \text{Bob}) \equiv \text{Verify}(IK_{\text{Alice.pub}} \longleftrightarrow IK_{\text{Bob.pub}})$$
- Even if a connection row is deleted and subsequently re-established, the underlying cryptographic trust is preserved through the verified $IK_{\text{pub}}$, preventing server-side connection ID manipulation from impersonating peers.

---

## 5. PreKey Bundle

The public device prekey bundle follows the exact Signal PQXDH specification:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              PUBLIC DEVICE PREKEY BUNDLE                                │
├──────────────────────────┬──────────────┬──────────────┬────────────────────────────────┤
│ Parameter Name           │ Type         │ Wire Size    │ Cryptographic Function         │
├──────────────────────────┼──────────────┼──────────────┼────────────────────────────────┤
│ `protocol_version`       │ uint16       │ 2 bytes      │ Protocol version (1)           │
│ `user_id`                │ UUID         │ 16 bytes     │ Supabase account owner         │
│ `device_id`              │ UUID v4      │ 16 bytes     │ Device endpoint UUID           │
│ `identity_key` ($IK$)    │ Base64 (Raw) │ 32 bytes     │ Ed25519 Identity Public Key    │
│ `signed_prekey_id`       │ uint32       │ 4 bytes      │ SPK monotonic sequence id      │
│ `signed_prekey` ($SPK$)  │ Base64 (Raw) │ 32 bytes     │ X25519 Signed PreKey Public    │
│ `signed_prekey_signature`│ Base64 (Raw) │ 64 bytes     │ Signature: $Sig(IK, SPK)$      │
│ `pq_prekey_id` ($PQPK$)  │ uint32       │ 4 bytes      │ Post-quantum prekey id         │
│ `pq_prekey` ($PQPK$)     │ Base64 (Raw) │ 1,184 bytes  │ ML-KEM-768 Public Key          │
│ `pq_prekey_signature`    │ Base64 (Raw) │ 64 bytes     │ Signature: $Sig(IK, PQPK)$     │
│ `one_time_prekey_id`     │ uint32       │ 4 bytes      │ Monotonic OTK sequence id      │
│ `one_time_prekey` ($OPK$)│ Base64 (Raw) │ 32 bytes     │ X25519 One-Time PreKey (Single)│
└──────────────────────────┴──────────────┴──────────────┴────────────────────────────────┘
```

---

## 6. Supabase Architecture

The database architecture is strictly **additive**. No existing tables or columns are modified.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 SUPABASE ADDITIVE CRYPTO SCHEMA                                │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                │
│  ┌────────────────────────┐         1:1          ┌───────────────────────────┐                 │
│  │     crypto_devices     │─────────────────────▶│   crypto_signed_prekeys   │                 │
│  ├────────────────────────┤                      ├───────────────────────────┤                 │
│  │ id (PK, UUID)          │                      │ id (PK, UUID)             │                 │
│  │ user_id (FK -> users)  │                      │ device_id (FK -> devices) │                 │
│  │ device_id (UUID v4)    │                      │ key_id (uint32)           │                 │
│  │ identity_key (text)    │                      │ public_key (text)         │                 │
│  │ created_at (timestamptz│                      │ signature (text)          │                 │
│  │ last_active_at (tz)    │                      │ is_active (boolean)       │                 │
│  └────────────────────────┘                      └───────────────────────────┘                 │
│               │                                                │                               │
│               │ 1:N                                            │ 1:N                           │
│               ▼                                                ▼                               │
│  ┌────────────────────────┐                      ┌───────────────────────────┐                 │
│  │ crypto_one_time_prekeys│                      │     crypto_pq_prekeys     │                 │
│  ├────────────────────────┤                      ├───────────────────────────┤                 │
│  │ id (PK, UUID)          │                      │ id (PK, UUID)             │                 │
│  │ device_id (FK -> device│                      │ device_id (FK -> devices) │                 │
│  │ key_id (uint32)        │                      │ key_id (uint32)           │                 │
│  │ public_key (text)      │                      │ public_key (text)         │                 │
│  │ consumed_at (timestampt│                      │ signature (text)          │                 │
│  │ consumed_by (UUID)     │                      │ consumed_at (timestamptz) │                 │
│  └────────────────────────┘                      └───────────────────────────┘                 │
│                                                                                                │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Field Specifications & RLS Lifecycle

1. **`crypto_devices`:**
   - `id` (`UUID`, PK), `user_id` (`UUID`, FK `auth.users`), `device_id` (`UUID`, Unique), `identity_key` (`TEXT`, 32B Ed25519 Base64), `created_at` (`TIMESTAMPTZ`), `last_active_at` (`TIMESTAMPTZ`), `revoked_at` (`TIMESTAMPTZ`, Nullable).
   - *RLS:* Read by all authenticated users; Insert/Update/Delete by `auth.uid() == user_id`.
2. **`crypto_signed_prekeys`:**
   - `id` (`UUID`, PK), `user_id` (`UUID`), `device_id` (`UUID`), `key_id` (`INTEGER`), `public_key` (`TEXT`, 32B X25519 Base64), `signature` (`TEXT`, 64B Ed25519 Base64), `is_active` (`BOOLEAN`, default true), `created_at` (`TIMESTAMPTZ`), `expires_at` (`TIMESTAMPTZ`).
   - *RLS:* Read active keys by authenticated users; Write by `auth.uid() == user_id`.
3. **`crypto_one_time_prekeys`:**
   - `id` (`UUID`, PK), `user_id` (`UUID`), `device_id` (`UUID`), `key_id` (`INTEGER`), `public_key` (`TEXT`, 32B X25519 Base64), `created_at` (`TIMESTAMPTZ`), `consumed_at` (`TIMESTAMPTZ`, Nullable), `consumed_by_user_id` (`UUID`, Nullable).
   - *RLS:* Direct SELECT blocked to prevent bulk key harvesting. Consumption strictly through `claim_prekey_bundle()` RPC.
4. **`crypto_pq_prekeys`:**
   - `id` (`UUID`, PK), `user_id` (`UUID`), `device_id` (`UUID`), `key_id` (`INTEGER`), `public_key` (`TEXT`, 1184B Kyber Base64), `signature` (`TEXT`, 64B Ed25519 Base64), `created_at` (`TIMESTAMPTZ`), `consumed_at` (`TIMESTAMPTZ`, Nullable), `consumed_by_user_id` (`UUID`, Nullable).
   - *RLS:* Consumption strictly through `claim_prekey_bundle()` RPC.

---

### 6.2 Atomic PreKey Consumption RPC Design

To prevent race conditions where two peers simultaneously initiate a session with Bob and claim the same One-Time PreKey, consumption uses `SELECT ... FOR UPDATE SKIP LOCKED`:

```sql
CREATE OR REPLACE FUNCTION public.claim_prekey_bundle(
  p_target_user_id UUID,
  p_target_device_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device RECORD;
  v_spk RECORD;
  v_otk RECORD;
  v_pqpk RECORD;
  v_caller_id UUID := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_device
  FROM public.crypto_devices
  WHERE user_id = p_target_user_id
    AND (p_target_device_id IS NULL OR device_id = p_target_device_id)
    AND revoked_at IS NULL
  ORDER BY last_active_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active cryptographic device found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_spk
  FROM public.crypto_signed_prekeys
  WHERE device_id = v_device.device_id AND is_active = TRUE
  ORDER BY created_at DESC LIMIT 1;

  -- Atomically claim 1 X25519 One-Time PreKey
  SELECT * INTO v_otk
  FROM public.crypto_one_time_prekeys
  WHERE device_id = v_device.device_id AND consumed_at IS NULL
  ORDER BY created_at ASC LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.crypto_one_time_prekeys
    SET consumed_at = now(), consumed_by_user_id = v_caller_id
    WHERE id = v_otk.id;
  END IF;

  -- Atomically claim 1 Post-Quantum ML-KEM-768 PreKey
  SELECT * INTO v_pqpk
  FROM public.crypto_pq_prekeys
  WHERE device_id = v_device.device_id AND consumed_at IS NULL
  ORDER BY created_at ASC LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    UPDATE public.crypto_pq_prekeys
    SET consumed_at = now(), consumed_by_user_id = v_caller_id
    WHERE id = v_pqpk.id;
  END IF;

  RETURN jsonb_build_object(
    'protocol_version', 1,
    'user_id', v_device.user_id,
    'device_id', v_device.device_id,
    'identity_key', v_device.identity_key,
    'signed_prekey', jsonb_build_object(
      'key_id', v_spk.key_id,
      'public_key', v_spk.public_key,
      'signature', v_spk.signature
    ),
    'one_time_prekey', CASE WHEN v_otk.id IS NOT NULL THEN jsonb_build_object(
      'key_id', v_otk.key_id,
      'public_key', v_otk.public_key
    ) ELSE NULL END,
    'pq_prekey', CASE WHEN v_pqpk.id IS NOT NULL THEN jsonb_build_object(
      'key_id', v_pqpk.key_id,
      'public_key', v_pqpk.public_key,
      'signature', v_pqpk.signature
    ) ELSE NULL END
  );
END;
$$;
```

---

## 7. Session Storage

All persistent cryptographic state is stored in browser **IndexedDB** (`enough-crypto`, Version 2).

```
IndexedDB: "enough-crypto"
├── "state"         ──▶ Key: `${userId}:identity`, `${userId}:signed-prekey`
├── "prekeys"       ──▶ Key: `${userId}:${keyId}` (OPK X25519 Private Keys)
├── "pq_prekeys"    ──▶ Key: `${userId}:${keyId}` (PQPK ML-KEM-768 Private Keys)
├── "sessions"      ──▶ Key: `${userId}:${peerDeviceId}` (Ratchet Session State)
└── "skipped_keys"  ──▶ Key: `${userId}:${peerDeviceId}:${ratchetPub}:${counter}`
```

### 7.1 Local Session Record Structure

```typescript
export interface PersistedSessionRecord {
  version: number;
  localUserId: string;
  localDeviceId: string;
  remoteUserId: string;
  remoteDeviceId: string;
  remoteIdentityKey: string;
  protocolVersion: number;
  
  /** Current 32-byte Double Ratchet Root Key (CryptoKey / non-extractable). */
  rootKey: CryptoKey;
  
  /** Active sending chain state. */
  sendingChain: {
    chainKey: CryptoKey | null;
    messageCounter: number; // Ns
    ratchetKeyPair: CryptoKeyPair; // DHs
  };
  
  /** Active receiving chain state. */
  receivingChain: {
    chainKey: CryptoKey | null;
    messageCounter: number; // Nr
    ratchetPublicKey: CryptoKey | null; // DHr
  };
  
  /** Previous sending counter (PNs) for wire header. */
  previousSendingCounter: number;
  isPostQuantum: boolean;
  createdAt: number;
  lastMessageReceivedAt: number;
  securityStatus: 'TRUSTED' | 'IDENTITY_CHANGED' | 'CORRUPT';
}
```

### 7.2 Multi-Connection Isolation & My Notes

- **Multi-Peer Independence:** Each 1:1 conversation ($A \leftrightarrow B$, $A \leftrightarrow C$) maintains a strictly isolated session record in IndexedDB. Root keys, DH ratchets, and message counters are never shared.
- **My Notes (Self-Chat):** Alice's client maintains a specialized loopback session with itself ($A \leftrightarrow A$). Notes are encrypted with Double Ratchet message keys before writing to Supabase, ensuring server administrators cannot read private notes.

---

## 8. Message Format

The future content stored in `messages.ciphertext` is an authenticated JSON container:

```json
{
  "v": 1,
  "type": "whisper",
  "sid": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "dh": "3mN...4kX=",
  "n": 4,
  "pn": 2,
  "prekey": null,
  "ct": "vF8...9aQ="
}
```

### 8.1 PreKey Message Container (Initial Message)

```json
{
  "v": 1,
  "type": "prekey",
  "sid": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "dh": "3mN...4kX=",
  "n": 0,
  "pn": 0,
  "prekey": {
    "ik": "8bX...1aM=",
    "ek": "9zY...3vP=",
    "spk_id": 1,
    "opk_id": 42,
    "pq_id": 12,
    "pq_ct": "K8L...99B="
  },
  "ct": "xX9...11Q="
}
```

### 8.2 Canonical Associated Data (AD) Specification

To prevent **Ciphertext Transplantation** (moving ciphertext across chats or connections), the message metadata is cryptographically bound into the AEAD Associated Data:

$$AD = \text{MagicPrefix} \ || \ \text{Version} \ || \ \text{SenderDeviceID} \ || \ \text{RecipientDeviceID} \ || \ \text{ConnectionID} \ || \ \text{MessageKind} \ || \ \text{HeaderBytes}$$

If an adversary replays ciphertext from Chat A into Chat B, the mismatched `connection_id` causes AES-256-GCM authentication tag verification to fail immediately.

---

## 9. Replay Protection

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               REPLAY PROTECTION RESOLUTION                                     │
├──────────────────────────────────────┬─────────────────────────────────────────────────────────┤
│ Attack Scenario                      │ Protocol Defense Mechanism                              │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ Duplicate identical ciphertext sent  │ Counter $N < N_r$ and key missing in `skipped_keys`.    │
│ to Supabase Realtime / REST          │ ➔ Message key was destroyed immediately upon decrypt.   │
│                                      │ ➔ AEAD decryption fails; message discarded as replay.   │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ Replay of old Ratchet DH Key         │ Asymmetric DH Ratchet has already stepped forward.      │
│                                      │ ➔ Old root/chain keys erased from memory.               │
│                                      │ ➔ Authentication tag check fails.                       │
├──────────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ Tampered Header / Modified Counter   │ Header is bound inside Associated Data ($AD$).          │
│                                      │ ➔ AES-GCM tag verification fails before state change.  │
│                                      │ ➔ Ratchet state is NOT mutated.                         │
└──────────────────────────────────────┴─────────────────────────────────────────────────────────┘
```

---

## 10. Out-of-order Handling

Realtime WebSocket delivery can deliver messages out of order ($M_1 \to M_3 \to M_2$).

### 10.1 Skipped-Message Key Derivation

When a message arrives with counter $N > N_r$:
1. The receiving ratchet advances its Receiving Chain Key ($CK_r$) forward $N - N_r$ steps.
2. For each intermediate step $i \in [N_r, N - 1]$:
   - Derive Message Key: $MK_i = \text{HMAC-SHA256}(CK_r, \text{"MessageKey"})$
   - Advance Chain Key: $CK_r = \text{HMAC-SHA256}(CK_r, \text{"ChainKey"})$
   - Store $MK_i$ in IndexedDB `skipped_keys` under key: `${userId}:${peerDeviceId}:${DHr}:${i}`.
3. Derive $MK_N$ to decrypt message $N$, and update $N_r = N + 1$.
4. When delayed message $M_2$ (counter $i$) arrives later:
   - Retrieve $MK_i$ from `skipped_keys`.
   - Decrypt payload.
   - **Immediately delete $MK_i$ from IndexedDB and RAM.**

### 10.2 Security Limits & DoS Prevention

- **`MAX_SKIPPED_KEYS_PER_SESSION = 1000`:** If $(N - N_r) > 1000$, message is rejected (`CryptoError('RATCHET_LIMIT_EXCEEDED')`).
- **`MAX_SKIPPED_KEY_AGE_MS = 14 days`:** Skipped keys older than 14 days are automatically purged.

---

## 11. Identity Changes

### 11.1 Detection & State Transition

Whenever a PreKey bundle or message is processed:
1. The client compares the peer's incoming public key $IK_{\text{incoming}}$ against the stored $IK_{\text{stored}}$ for that device.
2. If $IK_{\text{incoming}} \ne IK_{\text{stored}}$:
   - The session enters `IDENTITY_CHANGED` state.
   - Message decryption/encryption is **suspended** for that chat.
   - The security state is surfaced to the user (`"Safety Number changed / Peer re-registered device"`).

### 11.2 Safety Number (Fingerprint) Derivation

$$\text{SafetyNumber} = \text{SHA-512}^{5200}\Big(\text{Sort}(IK_A.\text{pub}, IK_B.\text{pub}) \ \Big|\Big| \ \text{Sort}(User_A, User_B)\Big)$$
Formatted into twelve 5-digit blocks for manual or QR-code comparison:
$$\text{34821 90214 55102 91823 88120 44910 11928 39201 44819 02931 84729 10492}$$

---

## 12. Key Rotation

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    KEY ROTATION SCHEDULE                                       │
├──────────────────────────┬───────────────────┬─────────────────────────────────────────────────┤
│ Key Category             │ Rotation Window   │ Lifecycle & Retention                           │
├──────────────────────────┼───────────────────┼─────────────────────────────────────────────────┤
│ **Identity Key (IK)**    │ Permanent         │ Generated once. Replaced only on device wipe.   │
├──────────────────────────┼───────────────────┼─────────────────────────────────────────────────┤
│ **Signed PreKey (SPK)**  │ 30 Days           │ Rotated every 30 days. Old SPK retained locally │
│                          │                   │ for 14 days to decrypt in-flight handshakes.    │
├──────────────────────────┼───────────────────┼─────────────────────────────────────────────────┤
│ **One-Time PreKeys (OPK)│ Refill Threshold  │ Refilled whenever unused pool on Supabase < 20. │
├──────────────────────────┼───────────────────┼─────────────────────────────────────────────────┤
│ **Ratchet DH Keys**      │ Per Roundtrip     │ Rotated automatically on every reply turn.      │
└──────────────────────────┴───────────────────┴─────────────────────────────────────────────────┘
```

---

## 13. Row-Level Security (RLS)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     RLS ACCESS MATRIX                                          │
├──────────────────────────┬─────────────┬─────────────┬─────────────┬───────────────────────────┤
│ Table Name               │ SELECT      │ INSERT      │ UPDATE      │ DELETE                    │
├──────────────────────────┼─────────────┼─────────────┼─────────────┼───────────────────────────┤
│ `crypto_devices`         │ Authenticated│ user_id ==  │ user_id ==  │ user_id == auth.uid()     │
│                          │ Users       │ auth.uid()  │ auth.uid()  │                           │
├──────────────────────────┼─────────────┼─────────────┼─────────────┼───────────────────────────┤
│ `crypto_signed_prekeys`  │ Authenticated│ user_id ==  │ user_id ==  │ user_id == auth.uid()     │
│                          │ (Active)    │ auth.uid()  │ auth.uid()  │                           │
├──────────────────────────┼─────────────┼─────────────┼─────────────┼───────────────────────────┤
│ `crypto_one_time_prekeys`│ user_id ==  │ user_id ==  │ BLOCKED     │ user_id == auth.uid()     │
│                          │ auth.uid()  │ auth.uid()  │ (RPC Only)  │                           │
├──────────────────────────┼─────────────┼─────────────┼─────────────┼───────────────────────────┤
│ `crypto_pq_prekeys`      │ user_id ==  │ user_id ==  │ BLOCKED     │ user_id == auth.uid()     │
│                          │ auth.uid()  │ auth.uid()  │ (RPC Only)  │                           │
└──────────────────────────┴─────────────┴─────────────┴─────────────┴───────────────────────────┘
```

---

## 14. Failure Modes & Session Recovery

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   FAILURE RECOVERY MATRIX                                      │
├──────────────────────────────────┬─────────────────────────────────────────────────────────────┤
│ Scenario                         │ System Response & Recovery Action                           │
├──────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **Browser Reload / Tab Restart** │ Session reloaded from IndexedDB (`sessions`). No reset.     │
├──────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **Realtime WebSocket Drop**      │ Catches up via REST API, decrypting missed messages in order│
├──────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **Corrupted Session Record**     │ Throws `CORRUPT_STATE`. **Never silently spawns new session│
│                                  │ (prevents history loss and silent MITM attacks).            │
├──────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **Browser Data Wiped**           │ App initializes fresh device identity. Peer detects identity│
│                                  │ change and verifies safety number.                          │
├──────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **OTK Pool Depleted**            │ Fallback to $DH_1..DH_3$ (SPK-only); schedules pool refill. │
├──────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **Account Deletion**             │ Calls `deleteUserCryptoState()`, erasing all local keys.    │
└──────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 15. Crypto Protocol Versioning

- **`PROTOCOL_VERSION = 1`:** Hardcoded initial protocol version.
- **Wire Version Header:** Every message container carries `"v": 1`.
- **Unknown Version Policy:** Receiving a message with `"v" > 1` triggers `CryptoError('UNSUPPORTED_PROTOCOL_VERSION')` and displays an update prompt. An unknown protocol version is **never** silently treated as v1.

---

## 16. Test Strategy

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      E2EE-3 TEST SUITE                                         │
├─────┬───────────────────────────────┬──────────────────────────────────────────────────────────┤
│ #   │ Scenario                      │ Assertions & Success Criteria                            │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T01 │ Alice $\to$ Bob Initial Msg   │ Bob receives PreKey message, decrypts plaintext,         │
│     │ (Bob Offline)                 │ advances receiving chain. Session established.           │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T02 │ Bob $\to$ Alice Reply         │ Alice decrypts reply, advances DH ratchet. Full roundtrip│
│     │ (Ratchet Turn 1)              │ completed. New Root Key derived.                         │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T03 │ Multi-Turn Ping-Pong          │ 10 alternating messages sent back and forth. Verify DH   │
│     │                               │ ratchet steps forward on each turn.                      │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T04 │ Out-of-Order Message Arrival  │ Send $M_1, M_2, M_3$. Deliver $M_1, M_3, M_2$. Verify    │
│     │ ($M_1 \to M_3 \to M_2$)       │ $M_3$ buffers skipped key for $M_2$; $M_2$ decrypts ok.  │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T05 │ Duplicate Ciphertext Replay   │ Inject identical ciphertext twice. Verify 2nd message is │
│     │                               │ rejected without state mutation.                         │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T06 │ Associated Data Tampering     │ Alter `connection_id` or `recipient_id` in AD. Verify    │
│     │                               │ AES-GCM tag verification fails.                          │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T07 │ Concurrent PreKey Claim Race  │ Alice & Carol simultaneously claim Bob's bundle. Verify  │
│     │                               │ each receives distinct One-Time PreKeys.                 │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T08 │ Depleted OTK Pool Fallback    │ Claim bundle when OTK pool is 0. Verify handshake        │
│     │                               │ succeeds via SPK fallback and pool refill is triggered.  │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T09 │ Identity Key Change Detection │ Bob replaces Identity Key. Alice attempts message.       │
│     │                               │ Verify `IDENTITY_CHANGED` state triggered.               │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T10 │ Session Persistence & Reload  │ Persist session to IndexedDB. Clear RAM cache. Reload.   │
│     │                               │ Verify subsequent message decrypts seamlessly.           │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T11 │ Corrupted Storage Recovery    │ Inject invalid bytes into IndexedDB session record.      │
│     │                               │ Verify `CORRUPT_STATE` is thrown (no silent overwrite).  │
├─────┼───────────────────────────────┼──────────────────────────────────────────────────────────┤
│ T12 │ Multi-Connection Isolation    │ User A in active chats with B, C, and My Notes. Verify   │
│     │                               │ zero key sharing or counter leakage across sessions.     │
└─────┴───────────────────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 17. Open Questions

1. **Multi-Device Support (Post-v0.2):**
   - Single-device per account is enforced in v0.2. Multi-device sync will utilize Signal-style *Fanout Encryption* (encrypting messages to all registered devices of the peer plus secondary devices of the sender).
2. **Key Backup & Account Portability:**
   - Device wipe currently results in identity reset. Future phases will evaluate passphrase-derived encrypted key backups stored on Supabase.

---

## 18. Final Recommendation & E2EE-3 Readiness

### Definitive Conclusion

- **The Protocol:** Signal PQXDH (Post-Quantum Key Agreement) + Double Ratchet (X25519 + AES-256-GCM + HKDF).
- **The Implementation:** Native W3C Web Crypto API for Curve25519/symmetric operations + audited constant-time ML-KEM-768 for post-quantum key encapsulation.
- **The Browser Path:** Full compatibility with React 18, Vite 6, and GitHub Pages PWA without Node.js polyfills or native binary bloat.
- **The Session Lifecycle:** Complete end-to-end specification with atomic One-Time PreKey claims via PostgreSQL `FOR UPDATE SKIP LOCKED`.
- **The Supabase Model:** Additive tables (`crypto_devices`, `crypto_signed_prekeys`, `crypto_one_time_prekeys`, `crypto_pq_prekeys`) secured by strict RLS.
- **The Local State:** IndexedDB `enough-crypto` with isolated user namespaces and `non-extractable` hardware/browser key protection.
- **The Implementation Boundary:** Strict isolation via `UI` $\to$ `MessageService` $\to$ `E2EESessionManager` $\to$ `ProtocolAdapter` $\to$ `CryptoImplementation`.

**Ready for E2EE-3 Implementation.**
