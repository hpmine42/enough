import { useEffect, useState } from 'react';
import {
  applyMode,
  effectiveTheme,
  getStoredMode,
  ThemeMode,
  watchSystemTheme,
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
  const [mode, setMode] = useState<ThemeMode>(() => getStoredMode());
  const [dark, setDark] = useState(
    () => effectiveTheme(getStoredMode()) === 'dark',
  );

  useEffect(() => {
    // Follow system theme changes while in 'system' mode.
    return watchSystemTheme(getStoredMode());
  }, []);

  function toggle() {
    const nextMode: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(nextMode);
    setDark(nextMode === 'dark');
    applyMode(nextMode);
  }

  // Follow system theme changes while in 'system' mode.
  useState(() => {
    const unsub = watchSystemTheme(getStoredMode());
    return unsub;
  });

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
