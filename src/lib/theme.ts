export type ThemeMode = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'enough-theme';

const DARK_MEDIA = '(prefers-color-scheme: dark)';

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

function render(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#191917' : '#f2f1ec');
  }
}

export function applyMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  render(effectiveTheme(mode));
}

/** Inline bootstrap used before React mounts to avoid a flash of the wrong theme. */
export function bootstrapTheme(): void {
  render(effectiveTheme(getStoredMode()));
}

/** Follows system changes while the mode is 'system'. Returns an unsubscribe fn. */
export function watchSystemTheme(mode: ThemeMode): () => void {
  if (mode !== 'system' || typeof window === 'undefined') {
    return () => undefined;
  }
  const mql = window.matchMedia(DARK_MEDIA);
  const onChange = () => render(effectiveTheme('system'));
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
