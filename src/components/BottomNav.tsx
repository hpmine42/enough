import { navigate } from '../lib/router';
import { t, useLang } from '../i18n';
import { ChatsIcon, ComposeIcon, GearIcon } from './icons';

interface BottomNavProps {
  /** Destination that is currently shown (drives the subtle active state). */
  active: 'chats' | 'new-chat' | 'settings';
  /**
   * True while a Settings subpanel slides over the bar. The bar keeps its box
   * (so the overview geometry stays stable during the slide) but is removed
   * from the accessibility tree and the tab order, because it is not visible.
   */
  covered?: boolean;
}

/** The search input of the dedicated people-search screen (`#/new-chat`). */
const SEARCH_INPUT = '.newchat-screen input';
/** Upper bound for waiting until the people-search screen has rendered. */
const FOCUS_WAIT_MS = 1000;
const FOCUS_RETRY_MS = 40;

/**
 * "New chat" opens the dedicated people-search screen (route `#/new-chat`)
 * and focuses its input: search by `@username` → connection request →
 * conversation. The screen hosts the one existing search implementation
 * (`PeopleSearch`) — no parallel flow is introduced, the bar only routes
 * into it.
 */
export function openNewChat(): void {
  if (!window.location.hash.startsWith('#/new-chat')) {
    navigate('#/new-chat');
  }
  // The screen is rendered on the hashchange tick that follows, so poll
  // briefly instead of assuming a fixed delay. The field can already be in
  // the DOM while the overlay is still hidden — the closing overlay keeps the
  // destination it is sliding back out mounted until it opens again — and
  // focusing a hidden element is a no-op, so polling stops only once the
  // browser has actually focused the field.
  const startedAt = Date.now();
  const focusSearch = (): void => {
    const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT);
    if (input) {
      input.focus();
      if (document.activeElement === input) return;
    }
    if (Date.now() - startedAt < FOCUS_WAIT_MS) {
      window.setTimeout(focusSearch, FOCUS_RETRY_MS);
    }
  };
  window.setTimeout(focusSearch, 0);
}

/**
 * Primary navigation: Chats | New chat | Settings.
 *
 * The bar sits at the bottom of the chat overview, the dedicated
 * people-search screen and the Settings overview and only uses the existing
 * hash routing (`#/`, `#/new-chat`, `#/settings`). A chat stays a focused
 * full-screen conversation (back button in its header), and Settings
 * subpages keep their own back button.
 *
 * LAYERING: this component is rendered once by `App.tsx` as a SIBLING of the
 * app stage and the Settings overlay — never as a child of either. Those
 * layers animate (screens slide in, the overlay slides in with a transform,
 * the stage dims) and the bar must not inherit any of that motion, so it is a
 * fixed top-level layer anchored to the viewport (see `.bottom-nav`).
 *
 * Stability contract: tapping an item must never move the bar. The active
 * state is a colour/background tint only (no font-weight change, no
 * transform/scale), and the dimmed app stage behind the Settings overlay
 * changes opacity only. The fixed placement keeps the bar on exactly the same
 * pixels across all three destinations and every screen transition.
 */
export default function BottomNav({ active, covered = false }: BottomNavProps) {
  useLang(); // re-render the labels on language change
  // A covered bar must not be reachable by keyboard while it is invisible.
  const tabIndex = covered ? -1 : undefined;

  return (
    <nav
      className={`bottom-nav${covered ? ' covered' : ''}`}
      aria-label={t('nav.label')}
      aria-hidden={covered || undefined}
    >
      <button
        type="button"
        data-nav="chats"
        className={`bottom-nav-item${active === 'chats' ? ' active' : ''}`}
        aria-current={active === 'chats' ? 'page' : undefined}
        onClick={() => navigate('#/')}
        tabIndex={tabIndex}
      >
        <ChatsIcon size={22} />
        <span className="bottom-nav-label">{t('nav.chats')}</span>
      </button>

      <button
        type="button"
        data-nav="new-chat"
        className={`bottom-nav-item${active === 'new-chat' ? ' active' : ''}`}
        aria-current={active === 'new-chat' ? 'page' : undefined}
        onClick={openNewChat}
        tabIndex={tabIndex}
      >
        <ComposeIcon size={22} />
        <span className="bottom-nav-label">{t('nav.newChat')}</span>
      </button>

      <button
        type="button"
        data-nav="settings"
        className={`bottom-nav-item${active === 'settings' ? ' active' : ''}`}
        aria-current={active === 'settings' ? 'page' : undefined}
        onClick={() => navigate('#/settings')}
        tabIndex={tabIndex}
      >
        <GearIcon size={22} />
        <span className="bottom-nav-label">{t('nav.settings')}</span>
      </button>
    </nav>
  );
}
