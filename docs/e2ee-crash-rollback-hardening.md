# enough. — E2EE-2D: Crash and rollback hardening

**Status:** E2EE-2D.2 implemented (stages 1–6). **The complete E2EE integration still does NOT exist.**
**As of:** 2026-08-23
**Scope:** local cryptographic state. No message flow, no UI, no Supabase change.

> E2EE-2D hardens the local cryptographic state lifecycle against rollback and
> crash-consistency failures. It does not constitute the complete enough. v0.2
> E2EE implementation.

`sendMessage()` still writes plaintext to `messages.ciphertext`
(`src/lib/api.ts:604`). E2EE-2D.2 does not change that.

> **Correction note for this document.** Earlier versions described T3
> (storage restore) as covered and invariant B as fully enforced.
> **The architecture document was wrong here.** A full origin restore is
> **not** detected by the local watermark; see §2, §3 and §8.1. The affected
> statements below are corrected, not softened.

### What E2EE-2D.2 changes relative to E2EE-2D

| Finding | Status after 2D.2 |
|---|---|
| C-2 — old state accepted with a raised revision | **closed** — revision is AEAD AAD, see §5.5 |
| H-1 — engine divergence after a lost CAS | **closed** — ephemeral engine, see §4.1 |
| H-2 — `Number` revision, `1e308` wedges the session | **closed** — uint64, see §5.6 |
| H-3 — `MISSING` treated as a new session | **closed** — `NEEDS_ESTABLISH`, see §7 |
| C-1 — coordinated rollback (intra- **and** cross-epoch) | **OPEN, deliberate** — an establishment-epoch anchor does not solve this; see §8.0/§8.1 |

---

## 1. Problem

### 1.1 The reproduced bug

Before implementation we checked whether the suspected problem is real at all
(task §32). Result: **yes, but at the application layer, not in the library.**

Existing persistence (`src/lib/crypto/storage.ts`, `putState`) is an
unconditional `IDBObjectStore.put()` — pure last-write-wins with no revision
check. Reproduction against the real implementation:

```
after commit rev5 : {"state":"S5","revision":5}
after stale write : {"state":"S2","revision":2}

ROLLBACK POSSIBLE AT APPLICATION LAYER: YES — silent overwrite
```

An older state **silently** overwrites a newer one. There is no mechanism that
notices or rejects that.

### 1.2 The actual cryptographic consequence — named correctly

The task explicitly forbids an unsubstantiated claim of “AES-GCM IV reuse”.
That precision is warranted, because **the name would have been wrong**.
Inspection of the actual binary of `@getmaapp/signal-wasm@0.6.6`:

| Symbol in the WASM | present |
|---|---|
| `cipher_key`, `mac_key`, `iv` | yes |
| `cbc`, `aes`, `padding`, `hmac` | yes |
| `GCM` / `Gcm` / `AES-GCM` | **no** |

Signal uses **AES-CBC + HMAC-SHA256** for message encryption, not AES-GCM.
Message keys are derived deterministically via
`libsignal_protocol::ratchet::keys::MessageKeys::derive_keys` from the chain
key and yield the triple `(cipher_key, mac_key, iv)`.

Empirically shown (engine test against 0.6.6):

```
identical plaintext -> identical ciphertext:            true
differ at plaintext byte 40 -> shared prefix:           150 bytes
total differing bytes:                                   55 of 1824
```

Correct description of the danger:

* The ratchet derives **exactly one** message key per chain index.
* If state is rolled back to an earlier index, the **same
  `(cipher_key, iv)`** is used for a **different** plaintext.
* Because AES-CBC is deterministic, ciphertexts for the same plaintext are
  **byte-identical**, and with a shared plaintext prefix they share a
  ciphertext prefix at **AES block granularity** (16 bytes).
* An observer learns **whether and how far two messages match** — without
  any key.

This is not a keystream-XOR break as with CTR/GCM (there `C1 XOR C2 = P1 XOR P2`
would yield the full plaintext XOR). It is **deterministic ciphertext equality
and prefix leakage** plus a violation of the fundamental Double Ratchet rule
that a message key is used **exactly once**.

> **Correction relative to `docs/e2ee-2c-validation-report.md`:** That report
> called the effect “keystream/IV reuse” and thereby implied a stream cipher.
> That is imprecise. The observation (byte-identical ciphertexts, shared prefix)
> was correct; the name of the mechanism was not. For AES-CBC the correct
> statement is: deterministic reuse of the `(cipher_key, iv)` pair with
> prefix leakage at block granularity.

### 1.3 Second consequence: replay window on the receiver

The Double Ratchet duplicate/replay protection (`DuplicatedMessage`) lives
**exclusively in session state**. If receiver state is rolled back, the window
opens again and an already processed message is accepted a second time. That
too is a persistence problem, not a crypto problem.

---

## 2. Threat model

We consider **failure scenarios and local attackers**, not the network or
server attacker (that is the subject of the actual E2EE integration).

| # | Scenario | Considered |
|---|---|---|
| T1 | Browser crash / tab kill between encrypt and persist | yes |
| T2 | iOS/Android kills a background tab (normal operation, not an edge case) | yes |
| T3 | Restored profile/storage backup with old IndexedDB | **no — only partially, see below** |
| T4 | Two tabs of the same app write concurrently | yes |
| T5 | Partially damaged or deleted IndexedDB contents | yes |
| T6 | Local attacker with DevTools access to IndexedDB | **partially** — see §8 |
| T7 | Network/MITM attacker | no — E2EE integration |
| T8 | Compromised Supabase server | no — E2EE integration |

**Important for T3 — correction.** Earlier versions of this document marked T3
as “yes”. **The architecture document was wrong here.** Two cases:

* **Partial rollback** (only the record is old, watermark stays current;
  record deleted; watermark tampered): detected and rejected.
* **Coordinated full-origin rollback** (record, watermark **and** sealing key
  are jointly restored to an earlier snapshot — profile backup, filesystem
  snapshot, container rollback): **not** detected. The restored state is
  genuinely sealed and internally consistent; every local check correctly
  says `VALID`.

The reason is structural and not fixable with better local crypto: every local
anchor sits **inside** what is rolled back. Another IndexedDB value would be
rolled back with it. See §8.1.

Regression tests `C8` (intra-epoch) and `C9` (cross-epoch) in
`ratchet-state.test.mjs` pin this boundary and explicitly **do not** claim
the case is detected.

**Important for T6:** An attacker who can already run same-origin JavaScript
is **not** stopped by this layer. That is a documented limit, not a solved
threat. What 2D.2 adds: such an attacker can **no longer** make an old state
authoritative merely by raising the revision (C-2), because that would need
the non-extractable sealing key. They can still delete data (DoS) and — if
they can read the state themselves — cause arbitrary damage.

---

## 3. Security invariants

### Invariant A — monotonic state

Every persisted state carries a strictly monotonically increasing pair
`(epoch, revision)`, both as **uint64** (`Uint8Array(8)`, big-endian on disk,
`BigInt` in memory). The first commit of an epoch gets revision 1. A value is
never decreased; overflow past `2^64 - 1` is rejected and **not** wrapped.
Tests: `A1`, `A2`, `A6`, `J1`, `revision.test.mjs` R1–R16.

### Invariant B — no silent rollback (**corrected**)

Earlier versions claimed **every** rollback would be detected.
**The architecture document was wrong here.** Correct is:

* An older state is never **silently accepted**, insofar as it is locally
  **distinguishable**.
* Detected and rejected: record older than watermark, missing record with
  watermark > 0, deleted or tampered watermark, forged revision, foreign
  user/connection.
* **Not** detected: coordinated full-origin rollback (§8.1).
* There is **no** force flag and **no** automatic fallback to an older backup.

Invariant B therefore holds **relative to the local anchor**, not absolutely.
Absolutely it would require an external, bidirectional anchoring of ratchet
progress bound to state identity (§8.1) — a counter that only rises at
establishment is demonstrably not enough.
Tests: `C1`–`C7` (detection), `C8`/`C9` (documented limits).

### Invariant F — cryptographic binding (new in 2D.2)

Revision, epoch, user id, connection id and envelope version are **AEAD
additional data** over the state bytes. A header field cannot be changed
without invalidating the authentication tag. Thus `revision ↔ state bytes`
is cryptographically inseparable.
Tests: `sealed-state.test.mjs` S7–S18, `ratchet-state.test.mjs` C2.

### Invariant G — no implicit session creation (new in 2D.2)

A send or receive attempt **never** creates a session. Missing state yields
`NEEDS_ESTABLISH` and abort. Sessions exist only via
`adoptSessionFromEstablishment()`.
Tests: `F2`, `F3`, `F4`, `F5`.

### Invariant H — no engine residue (new in 2D.2)

A message key must never come from a shared, permanently mutated engine.
Each attempt has its own disposable engine; a lost CAS discards it together
with the ciphertext.
Tests: `D2`, `H1`–`H4`, real-engine `RE1`, `RE3`, `RE4`.

### Invariant C — commit before externalization

The binding order is:

```
load → encrypt → COMMIT → send
```

State is durably valid **once the IndexedDB commit transaction has completed**
— not before. Only then may ciphertext leave the device.

### Invariant D — atomicity of (state, revision)

State and revision live **in the same record** and are written in **one**
transaction. The combination `state = S2, revision = 1` is structurally
impossible.

### Invariant E — isolation

The storage key is `${userId}:${connectionId}`. There is **no** global
`currentCryptoRevision`. Two accounts never share state, nor do two
connections.

---

## 4. State lifecycle and crash points

```
        ┌──────────┐
        │  LOADED  │  state + revision read, validated
        └────┬─────┘
             │  crash ──▶ nothing happens. Safe.
             ▼
        ┌──────────┐
        │ENCRYPTED │  engine advanced the ratchet (memory only)
        └────┬─────┘
             │  crash ──▶ new state lost, nothing sent.
             │            Retry produces the same ciphertext
             │            from the same state. SAFE.
             ▼
        ┌──────────┐
        │COMMITTED │  ◀── durability point
        └────┬─────┘
             │  crash ──▶ state advanced, message never sent.
             │            Message lost. No key reuse. ACCEPTABLE.
             ▼
        ┌──────────┐
        │   SENT   │
        └──────────┘
             │  crash ──▶ state stays advanced. Correct.
```

### Assessment of each interruption point

| Interruption | persistent | not persistent | restart safe? | resend message? | key reuse possible? |
|---|---|---|---|---|---|
| after `LOADED` | S0 | — | yes | n/a | no |
| after `ENCRYPTED` | S0 | S1 | yes | yes, identical | no |
| after `COMMITTED` | S1 | — | yes | **no** (message lost) | no |
| after `SENT` | S1 | — | yes | no | no |

**The forbidden order** (`send` before `commit`) would instead have
`persistent = S0` with ciphertext already sent in row 3 — exactly the
`(cipher_key, iv)` reuse described in §1.2 on the next encrypt.

### The deliberate trade-off

Commit-before-send trades **message loss** for **key reuse**.
Lost text is annoying and visibly recoverable for the user (type again).
A reused message key is a silent, permanent confidentiality loss. The order
therefore **always** prefers message loss.

---

## 5. Persistence model

### 5.1 What IndexedDB actually guarantees

The task forbids claiming false atomicity (§6). Concretely:

| Property | Reality |
|---|---|
| Several `put()` in **one** transaction | atomic — all or none |
| `put()` across **several** transactions | **not** atomic |
| Two transactions on the same store | serialized by the browser |
| `durability: 'strict'` | requests a flush to media; **no guarantee against OS/hardware loss** |
| Storage eviction by the OS | can remove the **entire** database |

Therefore everything that must be consistent lives in **one** transaction and
**one** record.

### 5.2 Data model

Store `ratchet` in the existing database `enough-crypto` (version 1 → 2,
purely additive):

```ts
interface PersistedRatchetState {
  version: number;        // record format, not protocol version
  userId: string;
  connectionId: string;
  revision: number;       // monotonic, first commit = 1
  state: Uint8Array;      // OPAQUE engine bytes, never interpreted
  committedAt: number;
}
```

Two keys per session:

```
${userId}:${connectionId}                 → PersistedRatchetState
${userId}:${connectionId}:__watermark     → number (high-water mark)
```

The suffix `:__watermark` contains characters that do not appear in a UUID,
so it can never collide with a real record key.

### 5.3 Why an extra watermark?

The revision **in the record** protects against concurrent writers. It does
**not** protect against the record itself being replaced or deleted by an
older copy (backup restore, partial loss) — then the revision would be small
again and everything would look consistent.

The watermark is the monotonic high-water mark of all ever-committed
`(epoch, revision)` pairs. That makes three otherwise invisible cases
detectable:

* Record version **smaller** than watermark → `ROLLBACK_DETECTED`
* Record **missing**, watermark **> 0** → `ROLLBACK_DETECTED` (and explicitly
  **not** `MISSING`, which would wrongly justify a new session)
* Watermark **missing or unreadable** even though a record exists → `WEDGED`

The last case is new in 2D.2 and important: reading a missing watermark as
“0” would turn rollback detection off exactly when an attacker wants it off.
Record and watermark are written in **one** transaction; finding only one of
them is impossible in honest operation. Tests `C5`, `C6`.

#### The watermark is NOT a complete trust anchor

Stated explicitly because earlier versions implied the opposite:
the watermark lives in the **same** IndexedDB database, the **same**
object store and the **same** origin storage bucket as the record. It shares
that lifecycle completely — backup, restore, eviction, deletion hit both
together. It can therefore only detect **inconsistencies between** record
and watermark, not their **joint** backdating.

A second local watermark, a second IndexedDB database or a `localStorage`
mirror does not change this: they all live in the same origin and are
restored together. The attempt to solve C-1 locally is therefore abandoned
and **not** implemented.

### 5.4 Compare-and-swap

```ts
commitRatchetState(userId, connectionId, { epoch, revision }, state)
```

Commit runs in **two phases**. Reason: Web Crypto is asynchronous, and an
`await` on `crypto.subtle` **inside** an IndexedDB transaction lets it
auto-commit — the following `put()` then throws `TransactionInactiveError`.
Seal and verify must therefore happen outside the transaction.

**Phase 1 — asynchronous, outside any transaction:**

1. Overflow check: `nextRevision = revision + 1`, abort if `> 2^64 - 1`
2. Load sealing key, else → `KEY_MISSING`
3. Read record + watermark consistently
4. **Unseal and authenticate** the stored envelope — only then does it
   define “current”. Believing the plaintext header of an unverified record
   is exactly the C-2 gap.
5. `current === expected`? else → `REVISION_CONFLICT`
6. `(epoch, nextRevision) > watermark`? else → `ROLLBACK_DETECTED`
7. Seal the new envelope

**Phase 2 — the atomic transaction, purely synchronous:**

8. Re-read record and watermark
9. Is the record **byte-identical** with the one authenticated in phase 1?
   Else → `REVISION_CONFLICT`. Byte identity is the right check here: it
   needs no key, is itself not forgeable, and fires on *any* change —
   including an overwrite at the same revision.
10. Watermark unchanged? else → `REVISION_CONFLICT`
11. Write record **and** watermark, complete the transaction

Steps 6/10 are defence in depth: even a caller with a matching but stale
version cannot fall back onto or under the high-water mark.
Test `D1` shows: with 50 parallel writers, exactly **one** wins.

### 5.5 Sealed state envelope (new in 2D.2)

The record is no longer a plaintext object, but:

```
AAD    = "enough.e2ee.ratchet.v3|<userId>|<connectionId>|<epochHex>|<revHex>"
sealed = AES-GCM-256(sealingKey, stateBytes, AAD)
```

* Sealing key: per user a **non-extractable** AES-GCM-256 `CryptoKey`
  (`extractable: false`, verified in test `S1`: `exportKey` fails for
  `raw` **and** `jwk`), stored in the new store `vaultkeys`.
* Epoch and revision enter the AAD as **fixed 16-digit hex**, so the
  mapping value → AAD is unique.
* `|` is **forbidden** as a separator in user/connection ids (test `S24`),
  otherwise `("a|b","c")` and `("a","b|c")` would be indistinguishable.
* **No homemade cryptography.** AES-GCM and key generation come from WebCrypto.

**What sealing does:** A header field — version, user, connection, epoch,
revision — cannot be changed without breaking the tag. The C-2 attack
(genuine old state + `revision: 500`) fails (`S7`, `C2`).

**What it does not do — checked, not assumed:** AEAD does not make a
ciphertext unique *inside* a tuple. Two envelopes sealed for the same
`(user, connection, epoch, revision)` are interchangeable (test `S10b`).
That is inconsequential here, but for a **structural** reason, not a
cryptographic one: only one envelope is ever persisted per slot, because
the CAS loser discards its envelope. The point is pinned as a test so it
is not later recast as a stronger claim.

### 5.6 Revision as uint64 (new in 2D.2)

`Number` is unsuitable as a security counter:

```js
Number.isInteger(1e308) === true   // passes a naive check
1e308 + 1 === 1e308                // increment has no effect
```

Such a value in the revision field would have **permanently** wedged the
session, because no commit can ever reach a higher revision. Replaced by:

| Aspect | Choice |
|---|---|
| persisted | `Uint8Array(8)`, big-endian, unsigned |
| in memory | `BigInt` |
| domain | `0 … 2^64 - 1`, hard-checked |
| overflow | `REVISION_OVERFLOW`, **no** wrap, **no** saturation |
| `Number` input | only via `revisionFromNumber()`, only safe integers |

Big-endian with fixed width because `memcmp` then matches numeric order, it
is a valid IndexedDB **key** (a naked `BigInt` throws `DataError`), and there
is exactly **one** encoding per value — the last is required because the
bytes enter the AAD.

---

## 6. Conflict handling

A stale writer (second tab, woken background tab) gets
`CryptoError('REVISION_CONFLICT')`. The commit **does not** happen.

Critical: in the sequencer the commit fails **before** send, so the
ciphertext is **discarded and never transmitted**. That is correct — it
comes from state that is no longer current. Shown by test `D2`: with three
parallel send attempts, exactly **one** `send()` runs.

There is **no** automatic merge and **no** retry inside this layer. The
caller must reload state and consciously retry the operation (test `D3`).

**Not implemented:** a Web Lock. This layer makes concurrent writes *safe*;
it does not make them *rarer*. A lock remains a reasonable performance
optimization — as a security mechanism it is unsuitable, because an OS kill
drops the lock without `finally`. The CAS/watermark check is the
authoritative defence.

---

## 7. Recovery and missing-state semantics

| Status | Meaning | Allowed reaction |
|---|---|---|
| `VALID` | envelope authenticated, not older than watermark | continue normally |
| `MISSING` | no record **and** watermark = 0 | **no** auto-start; only the explicit establish path |
| `CORRUPTED` | record structurally invalid | **halt**, inform the user |
| `UNSEAL_FAILED` | AEAD tag wrong: header or ciphertext tampered | **halt** |
| `ROLLBACK_DETECTED` | record older than watermark, or missing with watermark > 0 | **halt**, no encrypt/decrypt |
| `EPOCH_STALE` | record epoch smaller than recorded epoch | **halt** |
| `KEY_MISSING` | sealing key missing, sealed data exists | **halt**, do not treat as new |
| `USER_MISMATCH` | record belongs to another user/connection | **halt** |
| `WEDGED` | storage internally inconsistent (watermark missing/broken, revision at limit) | **halt**, manual intervention |

`NEEDS_ESTABLISH` is the related **error code** the sequencer throws when
sending on missing state.

### The decisive difference

```
new account / new session      →  MISSING          →  establish allowed
existing session, state gone   →  ROLLBACK_DETECTED / KEY_MISSING / WEDGED
                                                       →  HALT
```

Binding rules:

* `loadRatchetState()` does **not** throw on broken data; it returns a
  status. The caller must decide explicitly.
* A send attempt **never** creates a session (invariant G, finding H-3).
  Previously `MISSING` was treated as “new session, revision 0” — anything
  that can delete the record could then force a fresh ratchet chain from
  counter 0. Now: `NEEDS_ESTABLISH`, abort, **no** engine is constructed at
  all (test `F2`).
* `CORRUPTED` **never automatically** becomes a new session.
* `commitRatchetState()` does **not** blindly overwrite a corrupt record
  (test `F7`).
* A record whose sealing key is missing is `KEY_MISSING` — **not** `MISSING`.
  Otherwise “key gone” would be indistinguishable from “new user” (`F5`).

### `restoreRatchetSnapshot()` — removed

The function **no longer exists**. It was unsafe: it accepted a full record
including a freely chosen revision and only checked `revision > watermark`.
An old state with `revision: 500` was thereby accepted against a live
session at revision 9 (finding C-2).

It was **not renamed, not given a force flag, and not exported as a test
API**. Replacement is a deliberately different primitive:

```ts
adoptSessionFromEstablishment(userId, connectionId, initialState, { replacesEpoch? })
```

Differences that are not cosmetic:

* Revision is **not a parameter** — a new session always starts at 1.
* Epoch is not a parameter either — it is derived as `watermark.epoch + 1`,
  so adoption is **strictly forward**.
* No force flag. Adoption over a live session requires naming its current
  epoch (`replacesEpoch`), so it is a CAS.
* Input is engine bytes from a **real handshake**, not a blob borrowed from
  storage.

Because epoch rises, an adopted session sits **above** everything previously
committed even though its revision starts at 1 again. That is why freshness
is compared as the pair `(epoch, revision)`. Tests `G1`–`G5`.

**What this does not do:** it does not prove the handshake material itself
was fresh. That also needs external anchoring (C-1, §8.1) — and one that
binds ratchet progress, not only the establishment event.

---

## 8. Remaining limitations

Honest list of what is **not** solved.

### 8.0 Which property is actually met?

“Rollback protection” is not a single property. The following are independent
and in E2EE-2D.2 fulfilled **to different degrees**. In particular: the local
monotonicity/CAS check does **not** solve C-1.

| Property | Status after 2D.2 | How / why not |
|---|---|---|
| **Integrity** of stored state | **met** | AES-GCM, AAD binds `version｜userId｜connectionId｜epoch｜revision` to the state bytes (invariant F) |
| **Local CAS/monotonicity check** | **met** | Atomic CAS in one IDB transaction, watermark, `(epoch, revision)` comparison (invariants A, B, D) |
| **Replay protection against unchanged live state** | **met** | Engine rejects reuse (`DuplicatedMessage`); storage layer rejects stale writes |
| **Rollback freshness** (is the state the *newest*?) | **NOT met** | Every local anchor sits in the rollback domain and is restored with it (C-1, §8.1) |
| **Forward secrecy under rollback** | **NOT met** | Consumed message keys become usable again; no tombstones (§8.2) |
| **Post-compromise security under rollback** | **NOT met** | A rollback before a DH ratchet step undoes key renewal (§8.2) |

The first three rows are what 2D.2 delivers. They prevent *forgery* and
*accidental fallback*. They do **not** prove that an authentic, internally
consistent state is the current one — that is C-1.

### 8.1 C-1 — coordinated full-origin rollback (OPEN, deliberate)

**The most important open point.** If the entire origin is restored to an
earlier snapshot, record, watermark **and** sealing key are restored
together:

```
Revision 6
    ↓ full storage restore
Revision 2
    ↓
VALID
```

The result is a genuinely sealed, internally consistent older state. Every
local check correctly says `VALID` — the signature matches; this device
produced it for exactly this `(user, connection, epoch, revision)`.

**Why this is not solvable locally:** every local anchor sits inside what is
rolled back. IndexedDB transactions are also database-local by spec, so a
second database would lose atomicity between record and anchor without
preventing restore — eviction and backup are origin-wide.

**C-1 is broader than “revision rolled back”.** Audit C-1.1 reproduced two
further shapes:

* **Cross-epoch rollback.** A jump back across an epoch boundary
  (epoch 2 → epoch 1) is accepted as `VALID` if record and watermark are
  restored together. The `record.epoch < watermark.epoch` comparison only
  fires if the watermark is **not** restored with it.
* **The rolled-back state is writable.** Further commits on the restored
  snapshot succeed (verified: revision 3 → 4). C-1 is therefore not a pure
  read/stale problem; it really leads to reuse of already consumed
  `(cipher key, IV)` pairs.

Regression tests: `C8` (intra-epoch), `C9` (cross-epoch including
commitability).

#### Rejected approach: server-side epoch anchor at establishment

Earlier versions of this document named as a future solution:

```
sealed local state  +  server-side monotonic epoch anchor   ← REJECTED
```

i.e. a counter outside the origin that rises on every session establishment
and whose value enters the AAD.

**This approach is demonstrably insufficient, and this documentation was
wrong here.** Reason: C-1 occurs *inside* an existing epoch. A value that
only rises at establishment is constant between two establishments. It has
the same value for the state before the rollback and the state after, and
therefore cannot distinguish them — regardless of nonces, signatures or
freshness proofs. Empirically restaged: on a rollback 5 → 2 inside epoch 1
the AAD epoch still matches the server epoch, the check passes, the attack
succeeds. The same argument applies to session tokens, epoch changes and
key rotation.

**A sender-side sequence counter is also not enough.** It does not capture
receiver rollback: if consumed message keys on the receiver are reactivated
by a restore, the attacker sends nothing and the sender sequence stays
unchanged. Measured against the real engine, after a receiver rollback
**4 of 4** already consumed messages decrypted again (plaintext fully
recovered), while the same ciphertexts are rejected against live state —
for a server-side sender counter this attack is invisible (§8.2).

#### What would actually solve C-1

An anchor must advance at the granularity of what is rolled back, and bind
to state *identity*, not merely a counter value:

* external, outside the rollback domain, restore-resistant (append-only),
* **bidirectional** — send *and* receive progress,
* **per message** / per ratchet step, not per session,
* as an authenticated checkpoint/hash chain over state transitions,
* plus tombstones of consumed message keys outside the rollback domain,
  otherwise receiver-side forward secrecy stays unprotected.

That makes the server the authority over cryptographic-state progress and
practically rules out offline send. Both contradict enough.’s existing
architecture (offline capability as a design goal; the server should have
no authority over ratchet state). **Therefore C-1 stays deliberately open
in v0.2** and is deferred to a later E2EE architecture phase that also
decides the offline model.

**This documentation explicitly does not claim that C-1 is solved.**
Regression tests `C8` and `C9` pin the boundary and would go red if someone
quietly marked it solved.

### 8.2 Forward secrecy and post-compromise security under receiver rollback

A rollback is not only a replay problem. Measured against the real engine:

**Consumed message keys become usable again.** The Double Ratchet stores
keys for skipped messages in session state and **deletes them on use**.
Measurement: receiver state 637 B → 1076 B after skipping m1–m4 (~110 B per
key) → 714 B after consuming them, i.e. −362 B. The keys are then gone.

If state is rolled back to the snapshot *before* consumption, the stored
skipped keys are **back**. Against live state all replays are rejected;
against rolled-back state m1–m4 are **accepted and decrypted again**
(m5 stays rejected). That is a loss of **receiver-side forward secrecy**,
not merely a replay window: whoever has the old state and the old
ciphertexts gets back the plaintext the ratchet already treated as gone.

**Post-compromise security is also damaged.** A DH ratchet step changes
state (633 B → 775 B). A rollback to the snapshot *before* the step undoes
renewal of key material — exactly the property that should restore security
after a compromise.

**Sender side:** the sender holds only sending-chain keys, so no direct FS
loss. The risk there is key/IV reuse (§1.2).

**What 2D.2 does here and what it does not.** Sealing prevents *forging* an
old state and the sequencer prevents *accidental* fallback after a lost CAS
or crash. Against a real full-origin restore neither helps (§8.1). A
tombstone log of consumed message keys would be the matching extra measure;
it is **explicitly not** implemented in this task and remains open.

### 8.3 Further limits

1. **No protection against complete storage deletion.** If the entire
   database is removed (user clears browser data, OS eviction), watermark
   and sealing key vanish. That is indistinguishable from a new install.
   Only **partial** loss is caught.

2. **Migrated v2 records are not retroactively trustworthy.** A legacy
   record may already have been tampered with before the upgrade; that
   cannot be determined after the fact. Migration establishes the binding
   only **from that point on**.

3. **No Web Lock.** Deliberately not implemented. `navigator.locks` would be
   a liveness/performance optimization; as a security mechanism it is
   unsuitable because an OS kill drops the lock without `finally`.
   Security basis remains CAS + sealed state.

4. **Not tested in a real browser.** All tests run under Node with
   `fake-indexeddb`. Real Safari/WebKit behaviour — especially storage
   eviction and whether `durability: 'strict'` is actually **honoured** —
   is **not** verified. Test `M13` only checks that the flag is requested;
   `fake-indexeddb` cannot simulate real durability, and no test proof of
   that is invented here.

5. **No integration into the message flow.** `encryptCommitSend()` is
   called by no production code. `sendMessage()` is unchanged.

6. **Multi-device is not addressed.** The model knows exactly one local
   state per `(userId, connectionId)`.

7. **Account deletion also removes watermark and sealing key.** For
   deletion that is correct, but it means a newly created account with the
   same `connectionId` starts at epoch 1 again.

8. **No tombstone log of consumed message keys** (§8.2).

9. **No external freshness anchoring** (§8.1). No Supabase migration, no
   RPC, no RLS change, no server epoch and no server sequence numbers. The
   initially considered establishment-epoch anchor is rejected as
   insufficient (§8.1), not merely deferred.

---

## 9. Dependency audit

| Point | Result |
|---|---|
| `@getmaapp/signal-wasm` in the app `package.json` | **no** |
| Occurrence in the app lockfile | **none** |
| Only use | `experiments/e2ee-2b/` (isolated spike, `0.6.6`, exactly pinned) |
| New dependencies from E2EE-2D | **none** |
| Dependency upgrades from E2EE-2D | **none** |
| Multiple versions of the same Signal package | no |

E2EE-2D adds **no** dependency. The cipher-mode analysis (§1.2) ran against
`0.6.6` in a temporary directory outside the repository.

Deliberate consequence: `ratchet-state.ts` treats state as **opaque bytes**
and has **no** knowledge of the engine. This layer therefore remains valid
if the engine decision is later revised.

---

## 10. Changed and new files

| File | Kind | Content |
|---|---|---|
| `src/lib/crypto/revision.ts` | **new (2D.2)** | uint64 revision/epoch, encoding, overflow |
| `src/lib/crypto/sealed-state.ts` | **new (2D.2)** | AEAD envelope, AAD, sealing-key management |
| `src/lib/crypto/ratchet-state.ts` | revised | sealed CAS, uint64, `adoptSessionFromEstablishment`, lazy migration; `restoreRatchetSnapshot` **removed** |
| `src/lib/crypto/ratchet-session.ts` | revised | ephemeral-engine sequencer, fail-closed missing state |
| `src/lib/crypto/storage.ts` | changed | DB v3 + `vaultkeys`, `onversionchange`, cache invalidation, deletion including sealing key |
| `src/lib/crypto/types.ts` | changed | DB v3, envelope version, 7 new error codes, `sealingKeyFor` |
| `src/lib/crypto/errors.ts` | changed | messages for the new codes |
| `src/lib/crypto/identity.ts` | changed | cache invalidation on account deletion |
| `src/lib/crypto/keys.ts` | changed | cache invalidation on account deletion |
| `src/lib/crypto/__tests__/revision.test.mjs` | **new** | 16 tests |
| `src/lib/crypto/__tests__/sealed-state.test.mjs` | **new** | 26 tests |
| `src/lib/crypto/__tests__/migration.test.mjs` | **new** | 13 tests |
| `src/lib/crypto/__tests__/ratchet-state.test.mjs` | revised | 51 tests |
| `src/lib/crypto/__tests__/real-engine.integration.test.mjs` | **new** | 5 tests against the real WASM engine (opt-in) |
| `package.json` | changed | test files in `test:crypto`, new `test:crypto:engine` |

**Not changed:** `api.ts`, `sendMessage()`, UI components, `AuthContext`,
Supabase migrations, RLS, routing, theme, i18n. No new dependency.

---

## 11. Test coverage

```
npm run test:crypto          → 190/190 passed
npm run test:crypto:engine   →   5/5   passed (real @getmaapp/signal-wasm 0.6.6)
npm run build                → successful
npm run smoke                → passed
```

(The suite size changed relative to the original 2D.2 write-up: the four
tests of the never-published v2 migration path were dropped; `C9` was added
as a second documented C-1 boundary.)

| Group | Core |
|---|---|
| `revision` R1–R16 | uint64 bounds, `2^64` rejected, overflow, malformed, 1e308 wedge |
| `sealed-state` S1–S25 | non-extractability, C-2, state substitution, cross-user/connection, header tampering, documented AAD limit |
| `ratchet-state` A–J | revision, crash points, rollback (incl. `C8`/`C9` as documented C-1 bounds), concurrency, isolation, missing state, establishment, ephemeral engine, property |
| `migration` M5–M13 | schema baseline v3, account deletion including caches, `onversionchange`, durability flag |
| `real-engine` RE1–RE4 | H-1 against the real engine, no engine residue |

### Mutation testing

Every mutation must be caught by at least one test:

| # | Mutation | caught by |
|---|---|---|
| 1 | Remove watermark check | `C5`, `C6`, `C1` |
| 2 | Remove `durability: 'strict'` | `M13` (only flag observable, see §8.3.4) |
| 3 | Remove defensive `new Uint8Array(state)` | `H5`, `H6`, `H7`, `S6` |
| 4 | Remove revision from AAD | `S7`, `S8`, `S9`, `C2` |
| 5 | Remove userId from AAD | `S13`, `S15` |
| 6 | Remove connectionId from AAD | `S14` |
| 7 | Remove CAS check | `D1`, `D2`, `A3`, `A4`, `C7` |
| 8 | Swap commit/send | `B1`, `B3`, `B4`, `D2`, `RE4` |
| 9 | Reactivate `MISSING → fresh session` | `F2`, `F3`, `F4` |
| 10 | Remove overflow check | `A6`, `R11`, `R12` |

Additionally verified: upgrading the database from version 1/2 to 3 preserves
existing identities, prekeys and ratchet states (`M1`, `M6`, `M8`).
