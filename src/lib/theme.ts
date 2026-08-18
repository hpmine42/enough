export type ThemeMode = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'enough-theme';

const DARK_MEDIA = '(prefers-color-scheme: dark)';
export const THEME_CHANGE_EVENT = 'enough-theme-change';

function systemTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia(DARK_MEDIA).matches
    ? 'dark'
    : 'light';
}

export function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    return saved;
  }
  return 'system';
}

/** Effective theme for a stored mode. */
export function effectiveTheme(mode: ThemeMode): Theme {
  return mode === 'system' ? systemTheme() : mode;
}

/** Next mode in the single-button cycle: light → dark → system → light. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
}

function render(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // Keep every theme-color meta in sync (light + dark media variants and the
  // installed-PWA status bar all read these tags).
  const color = theme === 'dark' ? '#191917' : '#F2F1EC';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', color);
  });
}
function notifyThemeChange(mode: ThemeMode): void {
  window.dispatchEvent(
    new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }),
  );
}

export function applyMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  render(effectiveTheme(mode));
  notifyThemeChange(mode);
}

/** Inline bootstrap used before React mounts to avoid a flash of the wrong theme. */
export function bootstrapTheme(): void {
  render(effectiveTheme(getStoredMode()));
}

/**
 * Follows operating-system changes for the lifetime of the app. The listener
 * remains installed even while an explicit mode is selected, so switching to
 * System later works without remounting a theme button.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const mql = window.matchMedia(DARK_MEDIA);
  const onChange = () => {
    const mode = getStoredMode();
    if (mode !== 'system') return;
    render(effectiveTheme(mode));
    notifyThemeChange(mode);
  };
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
