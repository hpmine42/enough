import { navigate } from '../lib/router';
import { t, useLang } from '../i18n';
import { ChatsIcon, ComposeIcon, GearIcon } from './icons';

interface BottomNavProps {
  /** Destination that is currently shown (drives the subtle active state). */
  active: 'chats' | 'settings';
  /**
   * True while a Settings subpanel slides over the bar. The bar keeps its box
   * (so the overview geometry stays stable during the slide) but is removed
   * from the accessibility tree and the tab order, because it is not visible.
   */
  covered?: boolean;
}

/** The people search is the only existing way to start a new conversation. */
const SEARCH_INPUT = '.settings-search-wrap input';
/** Upper bound for waiting until the Settings overlay has rendered. */
const FOCUS_WAIT_MS = 1000;
const FOCUS_RETRY_MS = 40;

/**
 * "New chat" opens the existing people search on the Settings overview and
 * focuses it: search by `@username` → connection request → conversation. No
 * parallel flow is introduced, the bar only routes into it.
 */
export function openNewChat(): void {
  if (!window.location.hash.startsWith('#/settings')) {
    navigate('#/settings');
  }
  // The overlay is rendered on the hashchange tick that follows, so poll
  // briefly instead of assuming a fixed delay.
  const startedAt = Date.now();
  const focusSearch = (): void => {
    const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT);
    if (input) {
      input.focus();
      return;
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
 * The bar sits at the bottom of the chat overview and of the Settings
 * overview and only uses the existing hash routing (`#/`, `#/settings`).
 * A chat stays a focused full-screen conversation (back button in its
 * header), and Settings subpages keep their own back button.
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
        className="bottom-nav-item"
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
