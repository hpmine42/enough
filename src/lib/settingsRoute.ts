// enough. — Settings route helpers
// --------------------------------------------------------------
// Extracted from Settings.tsx so App.tsx can detect the current Settings
// category without statically importing the whole (lazy-loaded) overlay.
// This keeps the bottom-nav covered-state logic in the initial chunk while
// the Settings component itself code-splits.

export type SettingsCategory =
  | 'profile'
  | 'people'
  | 'blocked'
  | 'language'
  | 'appearance'
  | 'chat'
  | 'account';

/** Every valid subpage route, including the third-level blocked list. */
const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  'profile',
  'people',
  'blocked',
  'language',
  'appearance',
  'chat',
  'account',
];

/**
 * The category subpage a route points at, or `null` for the Settings
 * overview, the dedicated people-search screen and every other route.
 *
 * The bottom navigation uses this to decide when a subpage covers it: it is
 * a persistent top-level layer OUTSIDE the Settings overlay, so it must know
 * this state without becoming a child of the overlay (a child would inherit
 * the overlay's slide-in transform and move with it).
 */
export function settingsCategoryFromRoute(route: string): SettingsCategory | null {
  const parts = route.split('/');
  if (parts[0] !== '#' || parts[1] !== 'settings') return null;
  const firstSegment = parts[2];
  const secondSegment = parts[3];
  const categorySegment =
    firstSegment === 'people' && secondSegment === 'blocked' ? 'blocked' : firstSegment;
  if (!categorySegment) return null;
  return (SETTINGS_CATEGORIES as readonly string[]).includes(categorySegment)
    ? (categorySegment as SettingsCategory)
    : null;
}
