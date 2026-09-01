/**
 * Initial scroll anchoring for the chat view (v0.3 R1).
 *
 * Opening a chat must land on the newest message. The list cannot be anchored
 * once and forgotten: E2EE plaintext resolves asynchronously after the first
 * render, so bubbles grow *after* the initial scroll and the container's
 * `scrollHeight` at that moment is too small. The chat therefore used to
 * settle above the newest message.
 *
 * The fix is a short-lived anchoring phase: after the initial page render the
 * list is re-anchored to the bottom on every layout-relevant update until the
 * rendered tail has a final display outcome (plaintext resolved or permanently
 * undecryptable) — or until a safety timeout expires. The phase ends
 * immediately when the user scrolls, so anchoring never fights manual input.
 *
 * The decisions are kept here as pure functions so they are unit-testable
 * without a DOM.
 */

/** Safety net: never keep anchoring longer than this after the first render. */
export const INITIAL_ANCHOR_MAX_WAIT_MS = 4000;

/**
 * Grace period after the rendered tail resolved. Covers the render + layout
 * pass that the last plaintext update still triggers.
 */
export const INITIAL_ANCHOR_SETTLE_MS = 250;

export type InitialAnchorState = {
  /** The initial anchoring phase has not finished yet. */
  pending: boolean;
  /** The user performed a genuine (non-programmatic) scroll. */
  userScrolled: boolean;
  /** There is at least one rendered message. */
  hasMessages: boolean;
  /** Every initially rendered tail message has a final display outcome. */
  tailResolved: boolean;
  /** Milliseconds since the anchoring phase started. */
  elapsedMs: number;
  /** Milliseconds since the tail resolved, or `null` while unresolved. */
  sinceTailResolvedMs?: number | null;
};

/**
 * Should the list be (re-)anchored to the bottom in this layout pass?
 *
 * True while the initial phase is pending, messages exist and the user has not
 * taken over the scroll position.
 */
export function shouldAnchorInitial(state: InitialAnchorState): boolean {
  return state.pending && state.hasMessages && !state.userScrolled;
}

/**
 * Is the initial anchoring phase finished?
 *
 * It ends when the user scrolls, when the rendered tail has resolved and the
 * settle grace period has passed, or when the safety timeout expires.
 */
export function isInitialAnchorSettled(
  state: InitialAnchorState,
  maxWaitMs: number = INITIAL_ANCHOR_MAX_WAIT_MS,
  settleMs: number = INITIAL_ANCHOR_SETTLE_MS,
): boolean {
  if (!state.pending) return true;
  if (state.userScrolled) return true;
  if (state.elapsedMs >= maxWaitMs) return true;
  if (state.tailResolved) {
    const since = state.sinceTailResolvedMs;
    return typeof since === 'number' && since >= settleMs;
  }
  return false;
}

/**
 * Ids of the rendered tail that anchoring waits for.
 *
 * Only the tail is relevant: it is what fills the viewport at open time.
 * Waiting for the whole page would block on the sequential decrypt queue of
 * old history.
 */
export function anchorTailIds<T extends { id: string }>(
  messages: readonly T[],
  tailSize = 20,
): string[] {
  if (tailSize <= 0) return [];
  return messages.slice(Math.max(0, messages.length - tailSize)).map((m) => m.id);
}

/**
 * Has the rendered tail a final display outcome?
 *
 * `isResolved` reports whether a message id has resolved plaintext or is known
 * to be permanently undecryptable. An empty tail counts as resolved.
 */
export function isTailResolved(
  tailIds: readonly string[],
  isResolved: (id: string) => boolean,
): boolean {
  return tailIds.every(isResolved);
}
