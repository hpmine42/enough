import { useState } from 'react';
import { applyTheme, getInitialTheme, Theme } from '../lib/theme';

// Temporary development toggle. The theme system is a standalone module so this
// button can later be moved into a settings area or removed without touching
// the rest of the app.
export default function ThemeToggle({ variant }: { variant?: 'chat' }) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      className={`theme${variant === 'chat' ? ' theme-chat' : ''}`}
      onClick={toggle}
      aria-label="Darstellung wechseln"
    >
      ◐
    </button>
  );
}
