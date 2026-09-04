// enough. E2EE-v0.2 — production message-flow wiring logic.
// ---------------------------------------------------------------------------
// The bridge between the UI message flow and the E2EE session manager. This is
// the security-critical glue: it guarantees that a peer conversation NEVER
// hands plaintext to the transport, and that display plaintext comes only from
// the local cache, a legacy row, or a real decrypt — never invented.
//
// Layering: UI -> message-flow -> session-manager -> engine-adapter -> signal-wasm.
// This module imports no engine module directly except the session-manager type
// and the envelope parser; it performs no cryptography itself.
//
// My Notes (self-connection, user_a === user_b) is a DOCUMENTED EXCEPTION: it
// stays plaintext. The peer E2EE path cannot apply (Signal rejects self-claims,
// and inventing a self-session mechanism is out of scope), and My Notes is a
// personal notepad with no second party. Every PEER conversation is encrypted.

import type { E2EESessionManager } from './session-manager.ts';
import { parseEnvelope } from './session-manager.ts';
import type { Message } from '../types.ts';
import { CryptoError } from '../crypto/errors.ts';
import {
  getCachedPlaintext,
  cachePlaintext,
} from './message-cache.ts';

/**
 * Cache display plaintext, treating a persistence failure as non-fatal
 * (audit F-07).
 *
 * `cachePlaintext` first updates the in-memory map and then persists a sealed
 * snapshot to IndexedDB. If that IndexedDB write fails (the sealing key is
 * momentarily unavailable, the store is full, a transient I/O error), the
 * decrypt has ALREADY succeeded for the current or an earlier path — the
 * failure is a cache concern, never a cryptographic one. It must not make a
 * successfully decrypted message appear permanently undecryptable, and it
 * must not weaken E2EE (no plaintext is sent anywhere; the in-memory value
 * set by `cachePlaintext` still serves the current session).
 *
 * The error is deliberately swallowed here.
 */
async function cachePlaintextBestEffort(
  userId: string,
  messageId: string,
  plaintext: string,
): Promise<void> {
  try {
    await cachePlaintext(userId, messageId, plaintext);
  } catch {
    // Best-effort cache persistence: never turn a successful decrypt into a
    // display failure.
  }
}

export interface PrepareSendOptions {
  /** The session manager (null when E2EE is unavailable / not yet ready). */
  e2ee: E2EESessionManager | null;
  /** True for a self-connection (My Notes). */
  isSelf: boolean;
  peerUserId: string;
  connectionId: string;
  plaintext: string;
}

/**
 * Prepare a message's `ciphertext` for Supabase.
 *
 * - Peer conversation: encrypts via the session manager. FAILS CLOSED on any
 *   error (returns nothing; the caller must not insert). If E2EE is unavailable
 *   it throws `NOT_AVAILABLE` rather than emitting plaintext.
 * - My Notes (self): returns the plaintext unchanged (documented exception).
 *
 * The returned string is what `messages.ciphertext` must store. The caller is
 * responsible for caching the original `plaintext` locally for display.
 */
export async function prepareSend(opts: PrepareSendOptions): Promise<string> {
  const { e2ee, isSelf, peerUserId, connectionId, plaintext } = opts;
  if (isSelf) return plaintext;
  if (!e2ee) {
    throw new CryptoError(
      'NOT_AVAILABLE',
      'End-to-end encryption is not ready; refusing to send a peer message as plaintext.',
    );
  }
  // encryptForPeer establishes on first contact and throws on failure.
  return e2ee.encryptForPeer(peerUserId, connectionId, plaintext);
}

/** True if a stored ciphertext value is an E2EE envelope (vs legacy plaintext). */
export function isEnvelope(value: string): boolean {
  return parseEnvelope(value) !== null;
}

export interface DisplayResult {
  /** The plaintext to show, or null if it cannot be displayed. */
  plaintext: string | null;
}

/**
 * Resolve the display plaintext for one message.
 *
 * Resolution order:
 *   1. local cache (sent or previously decrypted) — never re-decrypts;
 *   2. My Notes (self) — plaintext lives in the row;
 *   3. legacy plaintext (pre-E2EE rows) — shown as-is;
 *   4. an envelope the SENDER authored but has no cached plaintext for —
 *      returns null (the sender cannot decrypt their own outgoing message);
 *   5. an incoming envelope — decrypt via the session manager and cache it.
 *
 * Returns `{ plaintext: null }` for undecryptable rows; the UI shows a
 * placeholder. Never returns invented or partially decoded text.
 */
export async function decryptForDisplay(opts: {
  e2ee: E2EESessionManager | null;
  isSelf: boolean;
  me: string;
  message: Message;
  connectionId: string;
}): Promise<DisplayResult> {
  const { e2ee, isSelf, me, message, connectionId } = opts;
  // System / deleted rows are not text content; the bubble renders them itself.
  if (message.deleted_at) return { plaintext: null };
  if (message.kind && message.kind !== 'text') return { plaintext: null };

  // 1. Local cache first (idempotent — never re-decrypts an advanced ratchet).
  const cached = await getCachedPlaintext(me, message.id);
  if (cached !== null) return { plaintext: cached };

  // 2. My Notes: plaintext is stored in the row.
  if (isSelf) {
    await cachePlaintextBestEffort(me, message.id, message.ciphertext);
    return { plaintext: message.ciphertext };
  }

  // 3. Legacy plaintext row (pre-E2EE): show as-is and cache.
  if (!isEnvelope(message.ciphertext)) {
    await cachePlaintextBestEffort(me, message.id, message.ciphertext);
    return { plaintext: message.ciphertext };
  }

  // 4. An envelope I sent but have no cached plaintext for: cannot display.
  if (message.sender_id === me) return { plaintext: null };

  // 5. Incoming envelope: decrypt (establishing on the first PreKey message).
  if (!e2ee) return { plaintext: null };
  const outcome = await e2ee.decryptFromPeer(message.sender_id, connectionId, message.ciphertext);
  await cachePlaintextBestEffort(me, message.id, outcome.plaintext);
  return { plaintext: outcome.plaintext };
}
