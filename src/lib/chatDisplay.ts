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

/**
 * Whether a failed E2EE initialization additionally offers the explicit,
 * user-confirmed device reset (audit C2), or only a retry.
 *
 * Only LOCAL state/identity failures qualify: re-running initialization
 * (`retry()`) would drive the same broken state again, so wiping it first is
 * the only way forward. Transient failures (unavailable platform APIs,
 * unreachable backend during publication, unknown classifications) offer a
 * retry ONLY — offering a destructive reset for a failure that a retry can
 * fix would destroy a healthy identity for no reason.
 *
 * Fail-closed default: `null` and every unlisted code yield `false`.
 */
export function e2eeRecoveryOffersReset(errorCode: string | null): boolean {
  switch (errorCode) {
    case 'USER_MISMATCH':
    case 'CORRUPT_STATE':
    case 'UNSEAL_FAILED':
    case 'KEY_MISSING':
    case 'WEDGED':
      return true;
    default:
      return false;
  }
}

/**
 * What a `USER_MISMATCH` from a send attempt means (audit C2).
 *
 * The manager raises the same code for two different causes: a changed peer
 * identity key (TOFU) and a block in either direction (bundle claim refused).
 * The caller passes the FRESHLY re-read block state plus the persisted peer
 * trust state, and the helper decides which UI path applies:
 *
 *   * 'blocked'          — a block exists: show the block UI, never a reset.
 *                          Checked FIRST so a block is never mistaken for an
 *                          identity change, even with stale component state.
 *   * 'identity-changed' — no block, and the trust record is persistently
 *                          marked `identity_changed`: offer peer recovery.
 *   * 'generic'          — anything else: no reset is offered. In particular
 *                          the reset UI requires the mark — a missing or
 *                          unreadable trust record never leads to a reset.
 */
export function classifyUserMismatch(opts: {
  blockState: string;
  trustState: string | null;
}): 'blocked' | 'identity-changed' | 'generic' {
  if (opts.blockState !== 'none') return 'blocked';
  if (opts.trustState === 'identity_changed') return 'identity-changed';
  return 'generic';
}
