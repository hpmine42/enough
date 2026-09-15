import { useEffect, useState } from 'react';
import {
  applyMode,
  getStoredMode,
  nextThemeMode,
  THEME_CHANGE_EVENT,
  ThemeMode,
} from '../lib/theme';
import { t, useLang } from '../i18n';
import { MoonIcon, SunIcon, SystemIcon } from './icons';

interface ThemeButtonProps {
  className?: string;
  label?: string;
}

const MODE_LABEL_KEYS: Record<
  ThemeMode,
  'settingsScreen.light' | 'settingsScreen.dark' | 'settingsScreen.system'
> = {
  light: 'settingsScreen.light',
  dark: 'settingsScreen.dark',
  system: 'settingsScreen.system',
};

/**
 * Minimalist three-state theme toggle for the header and auth screens.
 * Repeated taps cycle the persisted mode: light → dark → system → light.
 * 'system' follows the operating-system preference (via src/lib/theme.ts);
 * light and dark are independent of the OS.
 */
export default function ThemeButton({ className, label }: ThemeButtonProps) {
  useLang(); // re-render on language change (aria label)
  const [mode, setMode] = useState<ThemeMode>(() => getStoredMode());

  useEffect(() => {
    const sync = (event?: Event) => {
      const next =
        event instanceof CustomEvent &&
        (event.detail === 'light' ||
          event.detail === 'dark' ||
          event.detail === 'system')
          ? (event.detail as ThemeMode)
          : getStoredMode();
      setMode(next);
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    sync();
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  function toggle() {
    // Read the shared persisted mode at click time. Settings can change it
    // while this button remains mounted behind/in the overlay.
    applyMode(nextThemeMode(getStoredMode()));
  }

  const baseLabel = label ?? t('home.themeLabel');
  // Announce the current state so the three-step cycle is understandable.
  const fullLabel = `${baseLabel} — ${t(MODE_LABEL_KEYS[mode])}`;

  return (
    <button
      type="button"
      className={`icon-button theme-button${className ? ` ${className}` : ''}`}
      onClick={toggle}
      aria-label={fullLabel}
      title={fullLabel}
    >
      <span className={`theme-icon mode-${mode}`}>
        {mode === 'dark' ? (
          <MoonIcon size={19} />
        ) : mode === 'system' ? (
          <SystemIcon size={19} />
        ) : (
          <SunIcon size={19} />
        )}
      </span>
    </button>
  );
}
