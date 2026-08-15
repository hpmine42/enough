import { useEffect, useState } from 'react';
import {
  applyMode,
  effectiveTheme,
  getStoredMode,
  THEME_CHANGE_EVENT,
  ThemeMode,
} from '../lib/theme';
import { t, useLang } from '../i18n';
import { MoonIcon, SunIcon } from './icons';

interface ThemeButtonProps {
  className?: string;
  label?: string;
}

/**
 * Minimalist sun/moon toggle for the header and auth screens.
 * Toggles between light and dark; when the stored mode is 'system',
 * switching applies the opposite of the current effective theme.
 */
export default function ThemeButton({ className, label }: ThemeButtonProps) {
  useLang(); // re-render on language change (aria label)
  const [dark, setDark] = useState(
    () => effectiveTheme(getStoredMode()) === 'dark',
  );

  useEffect(() => {
    const sync = (event?: Event) => {
      const mode =
        event instanceof CustomEvent &&
        (event.detail === 'light' ||
          event.detail === 'dark' ||
          event.detail === 'system')
          ? (event.detail as ThemeMode)
          : getStoredMode();
      setDark(effectiveTheme(mode) === 'dark');
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    sync();
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  function toggle() {
    // Read the shared persisted mode at click time. Settings can change it
    // while this button remains mounted behind/in the overlay.
    const currentDark = effectiveTheme(getStoredMode()) === 'dark';
    applyMode(currentDark ? 'light' : 'dark');
  }

  return (
    <button
      type="button"
      className={`icon-button theme-button${className ? ` ${className}` : ''}`}
      onClick={toggle}
      aria-label={label ?? t('home.themeLabel')}
      title={label ?? t('home.themeLabel')}
    >
      <span className={`theme-icon${dark ? ' dark' : ''}`}>
        {dark ? <MoonIcon size={19} /> : <SunIcon size={19} />}
      </span>
    </button>
  );
}
