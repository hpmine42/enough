// enough. — chat display-text resolution (pure helper).
// ---------------------------------------------------------------------------
// WHAT THIS IS
//   Decides what a message bubble shows while its display plaintext is being
//   resolved, so that an unresolved message can NEVER render as an empty
//   bubble (audit C1 / F-01).
//
// WHY IT EXISTS
//   Peer message bodies are E2EE envelopes. The plaintext arrives
//   asynchronously — from the local cache, from a legacy row, or from a real
//   decrypt — and the decrypt needs the E2EE session manager. Two distinct
//   "no text yet" situations therefore exist and must not look the same:
//
//     * PENDING       the engine is fine and the plaintext is on its way.
//                     Transient (one render tick for cached/legacy rows, a
//                     little longer for a real decrypt).
//     * UNDECRYPTABLE it will not arrive: the decrypt failed, or the engine
//                     failed to initialize at all and there is nothing that
//                     could ever resolve the row.
//
//   Before this helper both collapsed into `''`, which rendered an empty
//   bubble. Worse, when `initialize()` failed the manager stayed null forever,
//   so EVERY peer bubble was permanently empty with no explanation.
//
// SECURITY BOUNDARY
//   This module never sees ciphertext, keys or session state. It only routes
//   between three display outcomes. It performs no cryptography, introduces no
//   fallback and never invents text: the only string it can return as content
//   is a plaintext the caller already resolved through
//   `lib/e2ee/message-flow.ts`.
//
// Kept free of React, i18n and Supabase so the Node test runner can import it
// directly (see src/lib/__tests__/chat-display.test.mjs).

/** What a bubble must render. Exactly one of these, never "nothing". */
export type BubbleText =
  /** A plaintext the display path already resolved. */
  | { kind: 'plaintext'; text: string }
  /** Resolution is in flight and the engine is available. */
  | { kind: 'pending' }
  /** Resolution failed, or can no longer succeed. Show the localized notice. */
  | { kind: 'undecryptable' };

export interface ResolveBubbleTextOptions {
  /**
   * The resolved display plaintext for this row, or `undefined` while it is
   * unresolved. Comes from `decryptForDisplay` via Chat's display effect.
   */
  plaintext: string | undefined;
  /** The display path already failed for this specific row. */
  undecryptable: boolean;
  /**
   * The E2EE session manager could not be initialized (`status === 'error'`).
   * In that state an unresolved envelope row will never resolve, so it must be
   * reported instead of being left pending forever.
   */
  e2eeFailed: boolean;
}

/**
 * Resolve the display state of one bubble.
 *
 * Order matters:
 *   1. a resolved plaintext always wins (including for My Notes and legacy
 *      rows, which resolve without the engine);
 *   2. an explicit decrypt failure is reported;
 *   3. with the engine unavailable, an unresolved row is reported rather than
 *      left pending — it cannot resolve;
 *   4. otherwise it is genuinely pending.
 *
 * Invariant: this function never yields an empty display for an unresolved
 * row. `plaintext` is returned verbatim and is never trimmed, normalized or
 * otherwise modified.
 */
export function resolveBubbleText(opts: ResolveBubbleTextOptions): BubbleText {
  if (opts.plaintext !== undefined) {
    return { kind: 'plaintext', text: opts.plaintext };
  }
  if (opts.undecryptable) return { kind: 'undecryptable' };
  if (opts.e2eeFailed) return { kind: 'undecryptable' };
  return { kind: 'pending' };
}

/**
 * Whether sending a PEER message is currently possible.
 *
 * Fail-closed by construction: only an explicitly `ready` engine allows a peer
 * send. `initializing` and `error` both refuse — the composer stays disabled
 * and `prepareSend` would throw `NOT_AVAILABLE` anyway. This predicate only
 * makes the UI agree with that guarantee instead of letting the user type a
 * message that can only fail.
 *
 * My Notes (self-chat) is the documented plaintext exception and is NOT gated
 * by this helper; callers pass `isSelf` to keep that path working while the
 * engine is unavailable.
 */
export function canSendEncrypted(opts: {
  e2eeStatus: 'initializing' | 'ready' | 'error';
  isSelf: boolean;
}): boolean {
  if (opts.isSelf) return true;
  return opts.e2eeStatus === 'ready';
}
