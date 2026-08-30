// enough. — Avatar placeholder component.
//
// Shows the first letter of a display name (uppercased) in a styled circle
// as a minimal visual identifier. Falls back to a generic user icon when
// the name is empty or represents a deleted/unknown account.
//
// Usage:
//   <Avatar name={displayName(peer)} size={40} />
//   <Avatar name={t('chat.deletedAccount')} size={32} />

import { type JSX } from 'react';

interface AvatarProps {
  /** Display name (or similar label) to derive the initial from. */
  name: string | null | undefined;
  /** Diameter in px. Default 40. */
  size?: number;
}

/**
 * A palette of muted hues for the avatar background. Seeded from the
 * name via string-hash so the same name always produces the same colour
 * without storing per-user preferences.  The set is picked for acceptable
 * contrast against both light and dark themes (the avatar circle uses
 * `--border` as its stroke, the text is `--muted`).
 */
const COLOURS = [
  '#c4b5a0',
  '#b8a9c4',
  '#a0b5c4',
  '#a3c4a0',
  '#c4a0a3',
  '#c4b890',
  '#a0c4b8',
  '#b5a0c4',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickColour(name: string): string {
  return COLOURS[hashName(name) % COLOURS.length];
}

/**
 * Fallback: a simple person icon (SVG) shown when no initial can be
 * derived (empty name, deleted account, etc.).
 */
function PersonIcon({ size }: { size: number }) {
  const s = Math.round(size * 0.55);
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4.5" />
      <path d="M4.5 21c0-4.5 3.5-8 7.5-8s7.5 3.5 7.5 8" />
    </svg>
  );
}

export default function Avatar({ name, size = 40 }: AvatarProps): JSX.Element {
  // Derive the initial from the first grapheme-like character.
  // For common scripts (Latin, Cyrillic, etc.) the first char is sufficient.
  // For the app's two supported languages (English, German) this works well.
  const initial = name
    ? [...name.trim()].find(
        (ch) => ch !== '(' && ch !== '[' && ch !== '@' && ch !== '"' && ch !== "'",
      )
    : null;
  const showInitial = initial && initial.length > 0 && initial !== '?';
  const bg = name ? pickColour(name) : COLOURS[0];

  return (
    <div
      className="avatar"
      role="presentation"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        background: bg,
        color: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
        border: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {showInitial ? (
        initial.toLocaleUpperCase()
      ) : (
        <PersonIcon size={size} />
      )}
    </div>
  );
}