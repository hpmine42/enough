# Offline Read Mode (v0.3.x)

**Scope: read what enough. already knows while offline.** Offline message
sending is explicitly NOT part of this feature. There is no outbox, no queued
mutation and no background synchronization system.

## 1. Connectivity model

`src/lib/connectivity.ts` is the single source of truth. It exposes three
states:

| State | Meaning | Network attempts |
| --- | --- | --- |
| `online` | browser online, no request failure recorded | normal |
| `offline` | `navigator.onLine === false` | suppressed |
| `unreachable` | browser online, but a real request failed | still allowed (a retry is how recovery is detected) |

`navigator.onLine === true` is deliberately not treated as proof that Supabase
is reachable. The `unreachable` state is produced by `reportNetworkFailure()`,
called from the existing network-error branch in `src/lib/errors.ts` — i.e.
from requests the app already makes. No polling, no heartbeat, no extra
traffic. A successful full load calls `reportNetworkSuccess()`.

## 2. Persistence

Two local mechanisms are used, both sealed under the SAME per-user,
non-extractable AES-GCM sealing key from `src/lib/crypto/sealed-state.ts`
(`vaultkeys` store) and both living in the EXISTING `enough-crypto` database:

1. **`src/lib/e2ee/message-cache.ts` (unchanged, reused).** Message display
   plaintext, `${userId}:msgcache`. This is where offline bubbles and Home
   previews get their text.
2. **`src/lib/offlineStore.ts` (new, minimal).** The metadata the message cache
   does not contain and cannot render without: connection rows, profiles,
   last-message rows, unread counts, delete-for-me ids, hidden-until windows
   and message ordering. Stored in the existing `state` object store under
   `${userId}:offline:home` and `${userId}:offline:chat:<connectionId>`.

The offline store was added because the message cache holds only
`messageId -> plaintext`: it carries no ordering, no connection rows and no
profiles, so it alone cannot render Home or Chat. No second database, no new
key, no new key derivation and no new persistence architecture were
introduced.

### Security properties

* AAD `enough.offline.v1|<userId>|<record>` binds every snapshot to its owning
  account AND its record slot; moving a record between users or slots breaks
  the authentication tag.
* Fail-closed: a missing sealing key, a tampered byte, a version mismatch or a
  wrong owner all yield `null` — never partial or unverified data.
* No private key material is ever written to a snapshot.
* Peer message bodies are stored exactly as Supabase returns them (opaque
  E2EE ciphertext). No plaintext fallback for peer messages is introduced.
  The only plaintext that can occur in a snapshot is content the current
  architecture already stores in plaintext in `messages.ciphertext` (My Notes
  and legacy rows) — and even that is sealed at rest here, so protection is
  never weaker than before.
* `deleteUserCryptoState(userId)` wipes `${userId}:offline:` records in the
  same atomic transaction that already wipes identities, prekeys, ratchets,
  the message cache and the sealing key. Account deletion cleanup is
  unchanged in semantics and extended in coverage.

### Account isolation

Snapshots are addressed by `userId` and sealed under that user's key with the
user id in the AAD. After logout/login as another account, user B reads only
`${userB}:offline:*` and cannot unseal user A's records even if the bytes are
moved into B's slot. This is covered by test `O9`.

## 3. Behavior

**Offline Home** renders the previously loaded conversation list from the
snapshot: identity/display name/username, latest-message preview (text from
the existing message cache), unread state and ordering. Nothing is fetched,
and nothing that cannot be reconstructed safely is fabricated.

**Offline Chat** renders the previously loaded newest page of a conversation
(up to 40 messages) with existing ordering, system messages, deletion state
and delete-for-me state. Decryption behaviour is unchanged: plaintext still
comes from the existing sealed message cache or the existing
`decryptForDisplay` path. Pagination is not attempted; a conversation that was
never opened reports that it is unavailable offline rather than showing
anything invented.

**Disabled offline** (never queued, never silently retried): sending,
server-side message deletion, read-state writes, block/unblock, chat deletion,
clearing My Notes, accepting/declining/cancelling requests, profile changes and
People Search.

## 4. Reconnection

When connectivity returns, Home calls the existing `load()` and Chat bumps its
existing `reloadKey`, i.e. the unchanged online loaders run again and the
unchanged P1-5 realtime bridge re-subscribes. The Home loader carries a
monotonic load token, so a slower offline hydration or a superseded load can
never commit over fresher state during rapid online/offline transitions.

## 5. UI

One quiet status line (`OfflineBanner`, `.offline-banner`), `role="status"`,
non-blocking, no modal and no notifications. `data-offline-cached="true"` on
the Home list and the Chat message area distinguishes "offline + locally
stored" from "online + current server data".
