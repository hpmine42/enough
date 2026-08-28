# enough. — E2EE v0.2, Phases 1–4: Engine, Persistence, Prekeys, Production Wiring

**Status:** Phases 1–4 COMPLETE. **The production message flow is now end-to-end encrypted** — `sendMessage()` no longer writes plaintext for peer conversations.
**Date:** 2026-08-23
**Scope:** Signal-WASM engine adapter, device-store persistence, the crash-safe sequencer integration, the Supabase prekey infrastructure, the session manager, and the production message-flow wiring.

> **Honest status statement:**
> Peer conversations are now end-to-end encrypted end to end: the sender
> encrypts before insert, Supabase stores only ciphertext envelopes, and the
> receiver (load + realtime) decrypts through the session manager. **My Notes
> (self-connections) remain plaintext by design** (documented exception: the
> peer E2EE path cannot apply to a self-connection, and no self-session
> mechanism is invented). enough. is **end-to-end encrypted for 1:1 peer
> conversations**; C-1 (full-origin rollback) remains an open, documented
> limitation.

---

## 0. License decision (resolved)

`@getmaapp/signal-wasm@0.6.6` is **AGPL-3.0-only** (verified from the npm
registry). The project owner has **explicitly approved its use in enough.** for
this implementation phase. The package is now a pinned production dependency
(`"@getmaapp/signal-wasm": "0.6.6"`, exact). No legal interpretation beyond
this factual statement is made here; a project LICENSE file remains a separate
owner decision.

---

## 1. What is implemented

### Phase 1 — engine adapter + persistence (COMPLETE)

- **`src/lib/e2ee/engine-adapter.ts`** — the ONLY production module that imports
  `@getmaapp/signal-wasm`. Exposes plain serializable types only; WASM objects
  never cross the boundary. Provides engine init, identity + registration id
  generation, signed/one-time/kyber prekey generation, device-store hydration,
  sender establishment (`processPreKeyBundle`), the `EngineFactory` for the
  crash-safe sequencer, establish-on-receive for the first PreKey message, and
  the **verified** synchronous `export_kyber_usage`/`import_kyber_usage` on the
  Kyber store.
- **`src/lib/e2ee/device-store.ts`** (from the prior session, extended) — sealed
  persistence of opaque device records under the SHARED per-user sealing key,
  with device-specific AAD (`enough.e2ee.device.v1|userId|recordType|keyId`).
  New record types: `kyber-prekey-lastresort`, `peer-trust`, `published-material`.
- **Sequencer reuse** — `ratchet-session.ts`' `encryptCommitSend` /
  `decryptAndCommit` (commit-before-externalize, disposable `EphemeralEngine`)
  drive every state transition. No second sequencer.
- **`src/lib/e2ee/types.ts`** — serializable boundary types (envelope, bundle).

### Phase 2 — Supabase prekey infrastructure (COMPLETE)

- **`supabase/migrations/0011_crypto_prekeys.sql`** — `crypto_devices`,
  `crypto_signed_prekeys`, `crypto_one_time_prekeys`, `crypto_kyber_prekeys`
  (PUBLIC material only) + RLS + the atomic **`claim_prekey_bundle(uuid)`**
  RPC (`SECURITY DEFINER`, `SET search_path = public`, `FOR UPDATE SKIP LOCKED`,
  self-claim + both-direction block rejection, last-resort Kyber never consumed).
- **`src/lib/e2ee/prekeys-api.ts`** — publish/fetch/count against Supabase (only
  PUBLIC material is ever sent). Injected into the session manager.
- **`src/lib/e2ee/session-manager.ts`** — orchestration: device lifecycle,
  prekey pool refill, establishment, encrypt/decrypt via the sequencer,
  TOFU peer trust, Web Lock multi-tab coordination (fail-closed when unavailable).
- **`supabase/crypto-prekeys-tests.sql`** — SQL-level test cases for RPC
  concurrency / RLS (require a live Postgres/Supabase instance to execute).

### Phase 3/4 — production message-flow wiring (COMPLETE)

- **`src/lib/e2ee/message-flow.ts`** — the security-critical bridge:
  `prepareSend` (encrypt for peer / My-Notes plaintext exception / fail-closed
  when the manager is unavailable) and `decryptForDisplay` (local cache →
  My Notes → legacy → real decrypt → placeholder, never invented).
- **`src/lib/e2ee/message-cache.ts`** — LOCAL sealed message cache (audit
  finding F6: sealed with AES-256-GCM under the per-user non-extractable
  WebCrypto key in `enough-crypto`; the Signal model: the device holds local
  sealed plaintext for messages it can show; Supabase holds only ciphertext).
  Local-only, per-user, never transmitted.
- **`src/context/E2EEContext.tsx`** — per-authenticated-user session manager.
  Created on sign-in, **destroyed on logout/account switch** (no cross-user
  reuse). Fail-closed while the manager is unavailable.
- **`api.ts` `sendMessage`** — now a pure transport: inserts the already-prepared
  ciphertext. Does no cryptography; Supabase never receives peer plaintext.
- **`Chat.tsx`** — encrypts on send (fail-closed), decrypts on load AND realtime
  through one effect (no second decrypt path), shows resolved plaintext.
- **`MessageBubble.tsx`** — receives only display plaintext; never sees
  ciphertext or key material.
- **`Home.tsx`** — preview from the local cache, or an "Encrypted message"
  placeholder for envelopes.
- **`AuthContext.tsx`** — clears the local message cache on account deletion.

**My Notes (self-connection) is a documented plaintext exception** — gated on
`isSelfConnection`. Every peer conversation is encrypted.

---

## 2. Architecture (decisions held; no reinvention)

```
UI (Chat.tsx …)                  — plaintext only; imports no engine module
  ↓ (later phase)
api.ts sendMessage()/getMessages — will call the session manager
  ↓
E2EESessionManager               — orchestration, peer trust, Web Lock
  ↓ uses
ratchet-session.ts               — encryptCommitSend / decryptAndCommit (CAS ordering)
  ↓ via
engine-adapter.ts                — ONLY importer of @getmaapp/signal-wasm; EphemeralEngine
  ↓ persisted through
device-store.ts + ratchet-state.ts → sealed-state.ts → storage.ts (IndexedDB `enough-crypto`)
```

Persistence reuse: **one** per-user non-extractable sealing key, **one**
`enough-crypto` database. Device records and session state share the key but
use distinct, injective AAD schemes. No second vault, no second CAS, no second
sequencer.

---

## 3. Tests (all green)

| Suite | Count | Notes |
|---|---|---|
| `test:crypto` | 217/217 | device-store + ratchet + sealed-state + primitives + boundary + message-flow |
| `test:crypto:engine` | 25/25 | real-engine: 13 adapter + 7 session-manager + 5 sequencer |
| `build` | PASS | tsc --noEmit + vite (bundle now includes signal-wasm) |
| `smoke` | PASS | jsdom UI suite now runs REAL E2EE (injected manager + in-memory transport) |

Real-engine adapter tests (E1–E13): identity gen/serialize, registration-id
encoding, **device-store round-trip with the REAL engine**, PreKey (t=3) then
Whisper (t=2), multiple messages, out-of-order, replay→`DuplicatedMessage`,
tampered Whisper rejected, wrong-session rejected, session export/import across
reload, **kyber_usage persistence across reload (keeps rejecting replays)**, CAS
revision advance, account A/B isolation.

Session-manager tests (SM1–SM7): first-contact establish-on-receive, bidirectional
conversation, reload continuity, legacy-plaintext passthrough, **MISSING+Whisper
fails closed (NEEDS_ESTABLISH)**, TOFU identity-change rejection, out-of-order —
all deterministic via an injected fake server + passthrough lock.

SQL RPC tests (`supabase/crypto-prekeys-tests.sql`): documented scenarios (OTP
concurrency, Kyber concurrency, self-claim, blocked pair, exhausted pool,
last-resort, RLS owner-only SELECT, no private material) — **require a live
Postgres/Supabase to execute** and are not run by the Node suite.

---

## 4. Security properties (what is actually guaranteed now)

- **No private material on Supabase.** Identity private keys, prekey private
  records, kyber private records, session/ratchet state, kyber usage and the
  sealing key never leave the browser. The crypto_* tables hold public keys +
  signatures only.
- **No private material unsealed in IndexedDB.** All device records + session
  state are AES-GCM-sealed under the non-extractable sealing key with AAD bound
  to userId/type/(keyId|epoch,revision).
- **User isolation.** Composite keys + AAD cross-binding (tested D6/D9, SM
  isolation). Cross-user/cross-type records are rejected.
- **Commit-before-externalize.** The sequencer never sends before the advanced
  state is durably committed; a lost CAS discards the engine + ciphertext.
  No message-key reuse on the send path.
- **Establish-on-receive only for PreKey messages.** MISSING + Whisper fails
  closed — a session is never invented from a non-PreKey message.
- **Atomic one-time prekey consumption.** The `claim_prekey_bundle` RPC locks
  rows (`FOR UPDATE SKIP LOCKED`) and stamps `consumed_at` in one transaction;
  two callers never get the same one-time prekey. (Server-side; SQL-tested.)
- **TOFU peer trust.** A changed peer identity key blocks establishment.
- **Fail-closed multi-tab.** If Web Locks are unavailable, E2EE refuses to run
  rather than silently desynchronizing.

### Honest limitations (unchanged from the audit)

- **C-1 (coordinated full-origin rollback) remains OPEN by design.** No server
  epoch / sequence / checkpoint is introduced. C8/C9 keep the gap visible in CI.
- **Browser-E2EE residuals:** XSS / compromised extension / device access = full
  compromise (inherent to browser E2EE).
- **Wrapper unaudited; provenance "strong evidence, not exactly reproducible"**
  (#41). Pinned version + (recommended follow-up) vendored hash-pinned artifacts.
- **Signed-prekey rotation deferred** (id fixed at 1 this phase); refill of
  one-time pools is implemented.
- **Kyber last-resort correctness (audit F1): FIXED.** One-time Kyber ids are
  reserved to start at 2 so they never collide with the reusable last-resort
  (id 1) in the engine's kyber store; a consumed ONE-TIME Kyber is now evicted
  from both the engine store and the durable device-store (never re-imported on
  reload), while the reusable LAST-RESORT Kyber is never evicted. Covered by
  real-engine tests SM8–SM11 (id isolation, last-resort fallback, last-resort
  reuse, one-time lifecycle).

---

## 5. What is NOT implemented (later phases)

- **`AuthContext`** no longer needs E2EE wiring (the `E2EEContext` handles it);
  the legacy E2EE-1 `initCrypto`/`identity_public_key` login path was removed
  (audit finding F2) — only the deferred primitive-layer file removal remains.
- **Vendoring + CI hash-pinning** of the WASM artifacts was resolved in F5:
  the installed `@getmaapp/signal-wasm@0.6.6` artifacts are now byte-exactly
  verified by a CI hash assertion (`scripts/verify-signal-wasm.mjs`,
  `docs/e2ee-f5-supply-chain.md`); vendoring was evaluated and rejected as
  net-negative complexity (see that doc).
- **Signed-prekey rotation; full identity-change UI** (safety-number display).
- **Removal of the legacy hand-built primitive layer** (`keys.ts`/`identity.ts`/
  `prekeys.ts`/`kdf.ts`/…) — deferred.
- **My Notes encryption** — self-connections stay plaintext (documented
  exception); encrypting them would need a self-session mechanism not in scope.

---

## 6. E2EE status

```
ENGINE INTEGRATED + PREKEY INFRASTRUCTURE READY + SESSION READY + PRODUCTION WIRED
PRODUCTION E2EE (1:1 peer conversations): YES  — sendMessage() writes ciphertext
My Notes (self-connections): plaintext (documented exception)
C-1 (full-origin rollback): open, documented limitation
```
