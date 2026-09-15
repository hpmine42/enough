import { SVGProps } from 'react';

/**
 * TEST: v0.6 icon set proposal — "chunky / filled".
 *
 * Same component contract as ./icons.tsx (24x24 grid, currentColor, size
 * prop) so every import can be swapped 1:1 for the visual test. Compared to
 * the outline set this is a deliberate style shift: filled silhouettes,
 * large radii, heavy strokes (>=2.4) where a shape must stay linear.
 *
 * Planned set (mockup): home, chats, new chat, people, search, send, back,
 * settings, profile, privacy, block, delete, info, theme, my notes, contact,
 * logout, password, account, appearance. Icons not yet wired into the UI are
 * exported at the bottom for the preview page.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    stroke: 'none',
    'aria-hidden': true,
    ...rest,
  };
}

/* ---------- parity with icons.tsx (used in the app today) ---------- */

export function SunIcon(props: IconProps) {
  // Built from primitive shapes (not a compound path) so every renderer
  // treats it identically: filled core + eight rounded rays.
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4.6" />
      {rays.map((deg) => (
        <rect
          key={deg}
          x="10.9"
          y="1.9"
          width="2.2"
          height="3.5"
          rx="1.1"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
}

/** theme: thick crescent moon */
export function MoonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.8 13A9.2 9.2 0 1 1 11 3.2a7.35 7.35 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

/** theme "system": filled monitor with stand */
export function SystemIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.6" y="4" width="18.8" height="12.8" rx="2.6" />
      <path d="M11 16.8h2v2.1h1.8a.95.95 0 0 1 0 1.9H9.2a.95.95 0 0 1 0-1.9H11v-2.1Z" />
    </svg>
  );
}

/** settings: filled gear, eight rounded teeth, round hole */
export function GearIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M12 3.6a8.4 8.4 0 1 0 .01 0Z M12 8.8a3.2 3.2 0 1 0 .01 0Z"
      />
      <circle cx="20" cy="12" r="1.7" />
      <circle cx="17.66" cy="17.66" r="1.7" />
      <circle cx="12" cy="20" r="1.7" />
      <circle cx="6.34" cy="17.66" r="1.7" />
      <circle cx="4" cy="12" r="1.7" />
      <circle cx="6.34" cy="6.34" r="1.7" />
      <circle cx="12" cy="4" r="1.7" />
      <circle cx="17.66" cy="6.34" r="1.7" />
    </svg>
  );
}

/** back: filled chevron with rounded caps and join */
export function BackIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15.4 4.6a1.55 1.55 0 0 1 0 2.2L10.2 12l5.2 5.2a1.55 1.55 0 0 1-2.2 2.2l-6.3-6.3a1.55 1.55 0 0 1 0-2.2l6.3-6.3a1.55 1.55 0 0 1 2.2 0Z" />
    </svg>
  );
}

/** settings rows: filled chevron right */
export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8.6 4.6a1.55 1.55 0 0 0 0 2.2l5.2 5.2-5.2 5.2a1.55 1.55 0 1 0 2.2 2.2l6.3-6.3a1.55 1.55 0 0 0 0-2.2L10.8 4.6a1.55 1.55 0 0 0-2.2 0Z" />
    </svg>
  );
}

/** send: filled paper plane, softly rounded tips */
export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M2.2 20.8 22.6 12 2.2 3.2l-.01 7L16.9 12 2.19 13.8l.01 7Z"
      />
    </svg>
  );
}

/** scroll-to-bottom: chunky filled arrow */
export function DownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.4c.86 0 1.55.7 1.55 1.55v10.3l4.2-4.2a1.55 1.55 0 1 1 2.2 2.2l-6.85 6.85a1.55 1.55 0 0 1-2.2 0L4.05 13.25a1.55 1.55 0 1 1 2.2-2.2l4.2 4.2V4.95c0-.86.7-1.55 1.55-1.55Z" />
    </svg>
  );
}

/** search: heavy filled ring + handle (visual weight matches filled set) */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M10.8 3.5a7.3 7.3 0 1 0 .01 0Z M10.8 6.2a4.6 4.6 0 1 0 .01 0Z"
      />
      <path
        d="M15.7 15.7l4.8 4.8"
        stroke="currentColor"
        strokeWidth="2.9"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** info: filled circle with cutout "i" */
export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 0 .01 0Z M12 6.6a1.5 1.5 0 1 0 .01 0Z M12 10.1c-.74 0-1.3.6-1.3 1.3v4.7a1.3 1.3 0 1 0 2.6 0v-4.7c0-.7-.56-1.3-1.3-1.3Z"
      />
    </svg>
  );
}

/** my notes: filled rounded sheet with text lines cut out */
export function NoteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M5.5 2.8h13a2.7 2.7 0 0 1 2.7 2.7v13a2.7 2.7 0 0 1-2.7 2.7h-13a2.7 2.7 0 0 1-2.7-2.7v-13a2.7 2.7 0 0 1 2.7-2.7Z M8 7.4h8a1.1 1.1 0 0 1 0 2.2H8A1.1 1.1 0 0 1 8 7.4Z M8 11h8a1.1 1.1 0 0 1 0 2.2H8A1.1 1.1 0 0 1 8 11Z M8 14.6h5a1.1 1.1 0 0 1 0 2.2H8a1.1 1.1 0 0 1 0-2.2Z"
      />
    </svg>
  );
}

/** selected theme / language: chunky filled check */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 16.6 5.7 12.8a1.5 1.5 0 1 0-2.12 2.12l4.86 4.86a1.5 1.5 0 0 0 2.12 0L20.42 9.9A1.5 1.5 0 1 0 18.3 7.78l-8.8 8.82Z" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M7.5 2.5h8.5a3 3 0 0 1 3 3V14a3 3 0 0 1-3 3h-8.5a3 3 0 0 1-3-3V5.5a3 3 0 0 1 3-3Z M7.9 4.7h7.7a.9.9 0 0 1 .9.9V14a.9.9 0 0 1-.9.9H7.9a.9.9 0 0 1-.9-.9V5.6a.9.9 0 0 1 .9-.9Z"
      />
      <rect x="9.8" y="9.8" width="11.2" height="11.2" rx="2.5" />
    </svg>
  );
}

/** delete: filled bin with lid and handle */
export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9.2" y="2.9" width="5.6" height="1.9" rx="0.95" />
      <rect x="3.6" y="4.9" width="16.8" height="2.5" rx="1.25" />
      <path
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
        d="M5.7 8.6h12.6l-.96 10.7c-.09 1.02-.95 1.8-1.98 1.8H8.64c-1.03 0-1.89-.78-1.98-1.8L5.7 8.6Z"
      />
    </svg>
  );
}

export function GithubIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
    </svg>
  );
}

/** close: filled X with rounded caps */
export function XIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.4 5.4a1.5 1.5 0 0 1 2.12 0l4.48 4.48 4.48-4.48a1.5 1.5 0 1 1 2.12 2.12L14.12 12l4.48 4.48a1.5 1.5 0 0 1-2.12 2.12L12 14.12l-4.48 4.48a1.5 1.5 0 0 1-2.12-2.12L9.88 12 5.4 7.52a1.5 1.5 0 0 1 0-2.12Z" />
    </svg>
  );
}

/** overflow menu: three dots, sized up for the filled set */
export function DotsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="4.6" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19.4" cy="12" r="1.75" />
    </svg>
  );
}

/** chats: filled bubble with tail */
export function ChatsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="18" height="12.5" rx="6.25" />
      <path d="M5.9 13 3.9 19.9c-.18.8.78 1.32 1.36.74l4.4-4.1L5.9 13Z" />
    </svg>
  );
}

/** new chat: filled pencil (compose) */
export function ComposeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  );
}

/** end-to-end-encryption indicator: filled padlock */
export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M8.3 10.6V8a3.7 3.7 0 0 1 7.4 0v2.6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M6.6 9.9h10.8a2.9 2.9 0 0 1 2.9 2.9v5.4a2.9 2.9 0 0 1-2.9 2.9H6.6a2.9 2.9 0 0 1-2.9-2.9v-5.4a2.9 2.9 0 0 1 2.9-2.9Z" />
    </svg>
  );
}

/* ---------- planned set: not wired into the UI yet ---------- */

/** home: house silhouette with door cutout, rounded roof */
export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        d="M11 3.05c.6-.5 1.4-.5 2 0l8 6.7c.55.46.13 1.4-.66 1.4H19.3v7.55a1.6 1.6 0 0 1-1.6 1.6h-3.45v-5.7a1.15 1.15 0 0 0-1.15-1.15h-2.2a1.15 1.15 0 0 0-1.15 1.15v5.7H6.3a1.6 1.6 0 0 1-1.6-1.6v-7.55H3.66c-.79 0-1.21-.94-.66-1.4l8-6.7Z"
      />
    </svg>
  );
}

/** people: two figures (distinct from the single-figure profile) */
export function PeopleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fillOpacity="0.45">
        <circle cx="8.2" cy="8" r="3" />
        <path d="M2.6 18.2c0-3 2.5-4.8 5.6-4.8 1.7 0 3.2.5 4.3 1.4-.8 1-1.3 2.3-1.3 3.7v.5H3.5a.9.9 0 0 1-.9-.9v.1Z" />
      </g>
      <circle cx="15.6" cy="8.6" r="3.5" />
      <path d="M9.2 20c0-3.5 2.9-5.6 6.4-5.6s6.4 2.1 6.4 5.6a1 1 0 0 1-1 1H10.2a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

/** profile: single person */
export function ProfileIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="7.4" r="3.9" />
      <path d="M4.6 20.3c0-3.9 3.3-6.3 7.4-6.3s7.4 2.4 7.4 6.3a1.2 1.2 0 0 1-1.2 1.2H5.8a1.2 1.2 0 0 1-1.2-1.2Z" />
    </svg>
  );
}

/** privacy: shield with padlock cutout */
export function PrivacyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M11.14 2.4c.54-.2 1.18-.2 1.72 0l5.86 2.5c.68.28 1.1.93 1.1 1.66v5.14c0 4.55-2.9 7.8-6.94 9.7-.55.26-1.21.26-1.76 0-4.04-1.9-6.94-5.15-6.94-9.7V6.56c0-.73.42-1.38 1.1-1.66l5.86-2.5Z M12 8.5a2.35 2.35 0 0 1 2.35 2.35v1.35h-1.5v-1.35a.85.85 0 1 0-1.7 0v1.35H9.65v-1.35A2.35 2.35 0 0 1 12 8.5Z M8.7 12.2h6.6a1 1 0 0 1 1 1v3.9a1 1 0 0 1-1 1H8.7a1 1 0 0 1-1-1v-3.9a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

/** account: shield with check cutout (distinct from privacy) */
export function AccountIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M11.14 2.4c.54-.2 1.18-.2 1.72 0l5.86 2.5c.68.28 1.1.93 1.1 1.66v5.14c0 4.55-2.9 7.8-6.94 9.7-.55.26-1.21.26-1.76 0-4.04-1.9-6.94-5.15-6.94-9.7V6.56c0-.73.42-1.38 1.1-1.66l5.86-2.5Z M15.7 9.6a1.15 1.15 0 0 1 0 1.63l-4.3 4.3a1.15 1.15 0 0 1-1.63 0l-2.1-2.1a1.15 1.15 0 1 1 1.63-1.63l1.29 1.3 3.48-3.5a1.15 1.15 0 0 1 1.63 0Z"
      />
    </svg>
  );
}

/** contact: address-card style, person cutout in rounded square */
export function ContactIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M5.9 3h12.2a2.9 2.9 0 0 1 2.9 2.9v12.2a2.9 2.9 0 0 1-2.9 2.9H5.9A2.9 2.9 0 0 1 3 18.1V5.9A2.9 2.9 0 0 1 5.9 3Z M12 7.3a2.5 2.5 0 1 0 .01 0Z M12 13.3c-2.2 0-4 1.35-4.3 3.3a.95.95 0 0 0 .94 1.1h6.72a.95.95 0 0 0 .94-1.1c-.3-1.95-2.1-3.3-4.3-3.3Z"
      />
    </svg>
  );
}

/** logout: open bracket (heavy stroke) + filled arrow */
export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M13.5 4.5H7.2c-1.2 0-2.2 1-2.2 2.2v10.6c0 1.2 1 2.2 2.2 2.2h6.3"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M14.6 8.7 18.3 12l-3.7 3.3c-.5.44-1.3.05-1.3-.63v-1.42H9.2a1.05 1.05 0 0 1 0-2.1h4.1V9.33c0-.68.8-1.07 1.3-.63Z" />
    </svg>
  );
}

/** password: filled key, head top-right */
export function KeyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g transform="rotate(45 12 12)">
        <path
          fillRule="evenodd"
          d="M7 7.6a4.4 4.4 0 1 0 .01 0Z M7 10.2a1.8 1.8 0 1 0 .01 0Z"
        />
        <rect x="10.8" y="10.75" width="8.6" height="2.5" rx="1.25" />
        <rect x="14.9" y="13.25" width="1.9" height="2.5" rx="0.95" />
        <rect x="17.9" y="13.25" width="1.9" height="3.1" rx="0.95" />
      </g>
    </svg>
  );
}

/** appearance: three sliders, filled knobs on heavy rails */
export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        d="M3.8 6.6h16.4M3.8 12h16.4M3.8 17.4h16.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="14.5" cy="6.6" r="2.55" />
      <circle cx="8.8" cy="12" r="2.55" />
      <circle cx="15.8" cy="17.4" r="2.55" />
    </svg>
  );
}

/** block: prohibition ring with slash, heavy weight */
export function BlockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fillRule="evenodd"
        d="M12 3a9 9 0 1 0 .01 0Z M12 6.1a5.9 5.9 0 1 0 .01 0Z"
      />
      <rect
        x="2.6"
        y="10.85"
        width="18.8"
        height="2.3"
        rx="1.15"
        transform="rotate(-45 12 12)"
      />
    </svg>
  );
}
