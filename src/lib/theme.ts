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

/**
 * The colour the platform chrome is painted with — the app canvas per theme.
 *
 * The browser reads these values for the installed-PWA status bar and splash
 * (the manifest pair `public/manifest.webmanifest` /
 * `public/manifest.dark.webmanifest`, whose `color_scheme_dark` mirrors the
 * dark one), for every `meta[name="theme-color"]`, and — via `--bg`, which
 * also paints `<html>` itself — for the strip iOS 26+ draws around the
 * cutout. All four channels MUST agree with the `--bg` token in
 * `src/index.css`; `src/lib/__tests__/pwa-chrome-color.test.mjs`
 * (`npm run test:pwachrome`) pins it. The service worker builds its themed
 * manifest responses from these same values (injected at build time).
 */
export const THEME_CHROME_COLORS: Record<Theme, string> = {
  light: '#F7F5F0',
  dark: '#171614',
};

/**
 * The manifest variant per effective theme. An installed app on Chrome/
 * Android paints its system bars from the manifest document — the runtime
 * metas never reach an installed window — so the page points the manifest
 * link at the theme's variant before first paint and on every change, and
 * additionally tells the service worker, which rewrites every manifest copy
 * it serves to the stored theme. Relative hrefs keep both the GitHub Pages
 * `/enough/` base and a local `/` deployment correct.
 */
export const THEME_MANIFEST_LINKS: Record<Theme, string> = {
  light: './manifest.webmanifest',
  dark: './manifest.dark.webmanifest',
};

/**
 * Tells the service worker the effective theme so its themed-manifest
 * responses (the installed-app chrome colours) follow the in-app choice.
 * No-ops silently wherever no worker exists — tab-mode browsers keep the
 * meta channels, which are enough there.
 */
function postThemeToServiceWorker(theme: Theme): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    const sw = navigator.serviceWorker;
    if (!sw || typeof sw.ready?.then !== 'function') return;
    sw.ready
      .then((registration) => {
        // No active worker (registration still installing, private mode,
        // unsupported platform): nothing to tell.
        registration?.active?.postMessage({ type: 'enough-theme', theme });
      })
      .catch(() => undefined);
  } catch {
    /* worker unavailable — the metas remain the usable channels */
  }
}

function render(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // Keep every theme-color meta in sync (light + dark media variants and the
  // installed-PWA status bar all read these tags).
  const color = THEME_CHROME_COLORS[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', color);
  });
  // Declare the *used* scheme, not just the supported ones. This is what makes
  // the platform UI — status-bar icons, form controls, the find-in-page bar —
  // follow an explicit in-app choice while the operating system still reports
  // the opposite preference (the `color-scheme` CSS property on :root only
  // reaches the document itself).
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute('content', theme);
  // Point the manifest link at the theme's variant so the value Chromium
  // reads on its next manifest re-read already matches the app theme — the
  // installed app's system bars come from the manifest document, not from
  // the metas above. The service worker rewrites every copy it serves as
  // well; the correct href is the no-service-worker fallback (fresh install).
  const manifestLink = document.querySelector('link[rel="manifest"]');
  const manifestHref = THEME_MANIFEST_LINKS[theme];
  if (manifestLink && manifestLink.getAttribute('href') !== manifestHref) {
    manifestLink.setAttribute('href', manifestHref);
  }
  // Tell the worker on every change so its themed-manifest responses follow.
  postThemeToServiceWorker(theme);
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
 * True when the user requested reduced motion from the operating system.
 *
 * JS-driven motion must check this explicitly: the global CSS
 * `prefers-reduced-motion` block only disables CSS animations, transitions
 * and CSS scroll-behavior — it cannot stop a requestAnimationFrame scroll
 * or a programmatic `scrollIntoView({ behavior: 'smooth' })`.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
