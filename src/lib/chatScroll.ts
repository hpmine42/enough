export type InitialAnchorAction = 'none' | 'anchor-and-wait' | 'anchor-and-finish';

/**
 * Decide whether the initial chat anchor still owns the scroll position.
 * Plaintext can resolve over several renders, so anchoring continues until
 * every initially rendered message has a final display outcome. User input
 * always releases ownership immediately.
 */
export function initialAnchorAction({
  pending,
  userHasScrolled,
  unresolvedMessages,
}: {
  pending: boolean;
  userHasScrolled: boolean;
  unresolvedMessages: number;
}): InitialAnchorAction {
  if (!pending || userHasScrolled) return 'none';
  return unresolvedMessages > 0 ? 'anchor-and-wait' : 'anchor-and-finish';
}
