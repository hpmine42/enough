import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useHashRoute, navigate } from '../lib/router';
import {
  acceptConnection,
  blockUser,
  cancelConnectionRequest,
  ensureMyNotes,
  getBlockRelations,
  getBlockedUsers,
  getMyConnections,
  getProfiles,
  loadDeletionsForUser,
  removeMyNotes,
  revealChatForMe,
  searchUsers,
  sendConnectionRequest,
  unblockUser,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import {
  displayName,
  isSelfConnection,
  normalizeUsername,
  otherUserId,
} from '../lib/helpers';
import { sanitizeDisplayName } from '../lib/input';
import { t, useLang } from '../i18n';
import type { TranslationKey } from '../i18n/translations';
import {
  getStoredMode,
  prefersReducedMotion,
  THEME_CHANGE_EVENT,
  ThemeMode,
} from '../lib/theme';
import { Connection, Profile } from '../lib/types';
import BottomSheet from './BottomSheet';
import Dialog from './Dialog';
import ThemeButton from './ThemeButton';
import {
  BackIcon,
  ChevronIcon,
  GithubIcon,
} from './icons';
import { shouldSkipNetwork } from '../lib/connectivity';
import { Section } from './settings/settings-ui';
import ProfileSettings from './settings/ProfileSettings';
import PeopleSettings from './settings/PeopleSettings';
import PeopleSearch from './settings/PeopleSearch';
import BlockedUsersPage from './settings/BlockedUsersPage';
import LanguageSettings from './settings/LanguageSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import ChatSettings from './settings/ChatSettings';
import AccountSettings from './settings/AccountSettings';

const GITHUB_URL = 'https://github.com/hpmine42/enough';

export type SettingsCategory =
  | 'profile'
  | 'people'
  | 'blocked'
  | 'language'
  | 'appearance'
  | 'chat'
  | 'account';

/** Every valid subpage route, including the third-level blocked list. */
const SETTINGS_CATEGORIES: SettingsCategory[] = [
  'profile',
  'people',
  'blocked',
  'language',
  'appearance',
  'chat',
  'account',
];

/**
 * The category subpage a route points at, or `null` for the Settings
 * overview, the dedicated people-search screen and every other route.
 *
 * Exported because the bottom navigation is a persistent top-level layer
 * OUTSIDE this overlay (`App.tsx`): it must know whether a subpage currently
 * covers it without becoming a child of the overlay — a child would inherit
 * the overlay's slide-in transform and move with it.
 */
export function settingsCategoryFromRoute(route: string): SettingsCategory | null {
  const parts = route.split('/');
  if (parts[0] !== '#' || parts[1] !== 'settings') return null;
  const firstSegment = parts[2];
  const secondSegment = parts[3];
  const categorySegment =
    firstSegment === 'people' && secondSegment === 'blocked' ? 'blocked' : firstSegment;
  return (SETTINGS_CATEGORIES as string[]).includes(categorySegment)
    ? (categorySegment as SettingsCategory)
    : null;
}

/**
 * The two equal top-level destinations the overlay hosts: the dedicated
 * people-search screen ("New chat", `#/new-chat`) and the Settings overview
 * (`#/settings`). Both are full app areas of the same rank, which is why
 * switching between them is a horizontal swap between two peers — not a
 * level change like opening a Settings subpage.
 */
type OverlayDestination = 'new-chat' | 'settings';

/**
 * The top-level destination a route points at, or `null` for every route
 * that is not one of them: `#/settings/<category>` is one level deeper (the
 * subpanel keeps its own slide), and `#/` and `#/chat/…` are outside the
 * overlay entirely.
 */
function topLevelDestination(route: string): OverlayDestination | null {
  if (route === '#/new-chat') return 'new-chat';
  if (route === '#/settings') return 'settings';
  return null;
}

/** Where an overlay destination is in the swap. */
type PaneState = 'active' | 'entering' | 'leaving';

/**
 * Duration of one swap, in milliseconds. Must stay in sync with the
 * `pane-in-*` / `pane-out-*` animation duration in `index.css`
 * (`npm run test:transition` asserts both sides).
 */
const SWAP_DURATION_MS = 300;

/**
 * Upper bound for keeping the leaving destination mounted. Its exit is
 * normally ended by the pane's own `animationend`; this timer is the fallback
 * for environments that do not run CSS animations at all (the jsdom smoke
 * test), so it is longer than the animation and can never cut an exit short.
 */
const SWAP_CLEANUP_MS = SWAP_DURATION_MS + 100;

/**
 * Visual groupings of the six top-level categories on the overview (v0.5.0
 * redesign; `blocked` lives inside People). The grouping is presentational
 * only: every category keeps its own subpage, title and content. The rendered
 * row order is the flattened order of the groups below:
 * profile, people, language, appearance, chat, account.
 */
const OVERVIEW_GROUPS: { title: TranslationKey; categories: SettingsCategory[] }[] =
  [
    { title: 'settingsScreen.groupAccount', categories: ['profile', 'people'] },
    {
      title: 'settingsScreen.groupPreferences',
      categories: ['language', 'appearance', 'chat'],
    },
    { title: 'settingsScreen.groupSecurity', categories: ['account'] },
  ];

/** Category subpage title key (blocked is its own third-level subpage). */
const CATEGORY_TITLE_KEYS: Record<SettingsCategory, TranslationKey> = {
  profile: 'settingsScreen.profile',
  people: 'settingsScreen.people',
  blocked: 'block.title',
  language: 'settingsScreen.language',
  appearance: 'settingsScreen.appearance',
  chat: 'settingsScreen.chat',
  account: 'settingsScreen.account',
};



/* ------------------------------------------------------------------ */
/* overview row                                                        */
/* ------------------------------------------------------------------ */

/** One tappable row of the category overview. */
function CategoryRow({
  category,
  label,
  sub,
  badge,
}: {
  category: SettingsCategory;
  label: string;
  sub?: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className="settings-row clickable settings-category-row"
      data-category={category}
      onClick={() => navigate(`#/settings/${category}`)}
    >
      <div className="settings-row-main">
        <div className="settings-row-label">{label}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      <div className="settings-row-control settings-category-control">
        {badge !== undefined && badge > 0 && <span className="badge-soft">{badge}</span>}
        <ChevronIcon size={16} />
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* overlay destination pane                                            */
/* ------------------------------------------------------------------ */

/**
 * One top-level destination of the overlay as a full-size surface — the same
 * shape as `.settings-subpanel`: its own header and its own scroll body. That
 * is what lets the two destinations of the overlay move against each other
 * instead of a single screen swapping its content.
 *
 * `state` drives the swap (see `.settings-pane` in `index.css`):
 *   `active`   — the destination the route points at, at rest;
 *   `entering` — that destination while a swap is running: it is already
 *                rendered with its content and plays the entry animation;
 *   `leaving`  — the destination a swap is animating away from: it keeps its
 *                own content (and its scroll position — the pane element is
 *                not remounted) for exactly the exit animation and then ends
 *                the swap through `onExitEnd`.
 *
 * The header is part of the pane on purpose: the destination's title belongs
 * to the area that moves, so no screen ever changes its heading mid-slide.
 */
function OverlayPane({
  destination,
  state,
  title,
  bodyClassName,
  onExitEnd,
  children,
}: {
  destination: OverlayDestination;
  state: PaneState;
  title: string;
  bodyClassName: string;
  onExitEnd: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`settings-pane settings-pane-${destination} ${state}`}
      data-pane={destination}
      data-pane-state={state}
      aria-hidden={state === 'leaving' || undefined}
      onAnimationEnd={state === 'leaving' ? onExitEnd : undefined}
    >
      <header className="settings-header">
        <button
          type="button"
          className="icon-button"
          onClick={() => navigate('#/')}
          aria-label={t('back')}
        >
          <BackIcon size={22} />
        </button>
        {/* Same centered title as the subpages: each top-level destination
            (the Settings overview, the dedicated people-search screen) reads
            as the top of one navigation stack, and the back button is the
            single way back to the chats. */}
        <div className="settings-page-title">{title}</div>
        <ThemeButton />
      </header>
      <div className={`settings-scroll ${bodyClassName}`}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const route = useHashRoute();
  // The overlay hosts two top-level destinations: the Settings overview
  // (with its category subpages) and the dedicated people-search screen
  // ("New chat"). Both are one navigation level above a chat; the search
  // screen is NOT a Settings subpage — it has its own route, header title
  // and content, and the Settings overview no longer contains the search.
  const open = route.startsWith('#/settings') || route.startsWith('#/new-chat');
  // The overlay is a navigation stack: while it slides back out it keeps the
  // destination it was showing, so the exit is exactly the entrance played
  // backwards — the "New chat" screen slides away, not the destination the
  // bar is heading to. The rendered destination changes in the same React
  // commit as the `.open` class, which is what makes this an exact mirror:
  // when the overlay closes, the departing screen is still the current one
  // (its slide-out and fade-out are the entrance in reverse), and when it
  // opens again the next destination is already rendered in the commit that
  // adds `.open` (so the entrance never starts on a stale screen). While the
  // overlay is closed the frozen destination stays mounted but is
  // `visibility: hidden`, `aria-hidden` and not reachable by pointer or
  // keyboard, so nothing about the closed state is visible or interactive.
  const [renderedRoute, setRenderedRoute] = useState(route);
  if (open && renderedRoute !== route) setRenderedRoute(route);
  const isNewChatRoute = renderedRoute.startsWith('#/new-chat');
  // The overlay's two destinations are equal peers, so a route change between
  // them while the overlay stays open gets its own transition: one horizontal
  // swap in which the destination that leaves keeps its content for exactly
  // its exit animation and the destination that arrives is already rendered
  // with its content. Like the frozen destination above, the leaving
  // destination is a rendered state: the route of the previous commit is
  // compared here — before it is updated — and the two state updates of this
  // render phase are applied before React commits, so the first swapped frame
  // already carries the arriving pane and the panes' own CSS transitions
  // start from there. Everything else keeps its own transition and must not
  // run a second one on top of it: the overlay opening or closing (`#/`,
  // `#/chat/…`) is the overlay's slide-in/out alone, and a Settings subpage
  // (`#/settings/<category>`) is the subpanel's own slide.
  const [seenRoute, setSeenRoute] = useState(route);
  const [leavingDestination, setLeavingDestination] = useState<OverlayDestination | null>(
    null,
  );
  const previousRoute = seenRoute;
  if (previousRoute !== route) {
    const previousDestination = topLevelDestination(previousRoute);
    const destination = topLevelDestination(route);
    setSeenRoute(route);
    setLeavingDestination(
      previousDestination !== null && destination !== null ? previousDestination : null,
    );
  }
  // The leaving pane is the destination the swap is animating away from. It
  // is always the other top-level destination and stays mounted — with its own
  // content, never the arriving one — until its exit has finished.
  const activeDestination: OverlayDestination = isNewChatRoute ? 'new-chat' : 'settings';
  const swapRunning = leavingDestination !== null;
  const leavingPane =
    leavingDestination === null || leavingDestination === activeDestination
      ? null
      : leavingDestination;
  const paneState = (destination: OverlayDestination): PaneState | null => {
    if (destination === activeDestination) return swapRunning ? 'entering' : 'active';
    return destination === leavingPane ? 'leaving' : null;
  };
  // End the swap as soon as the exit animation is over. In a browser the
  // leaving pane's `animationend` fires first; the timer only exists for
  // environments that do not run CSS animations (the jsdom smoke test) and so
  // cannot leave a departed pane behind.
  useEffect(() => {
    if (leavingDestination === null) return;
    const timer = window.setTimeout(() => setLeavingDestination(null), SWAP_CLEANUP_MS);
    return () => window.clearTimeout(timer);
  }, [leavingDestination]);
  const endSwap = () => setLeavingDestination(null);
  // The category is the first segment after "#/settings/". A deeper path is
  // preserved so "#/settings/people/blocked" is the nested Blocked Users
  // subpage while the legacy "#/settings/blocked" still opens the same screen
  // at the top level.
  const parts = route.split('/');
  const isSettingsRoute =
    parts[0] === '#' && parts[1] === 'settings';
  const firstSegment = isSettingsRoute ? parts[2] : null;
  const secondSegment = isSettingsRoute ? parts[3] : null;
  const blockedFromPeople =
    firstSegment === 'people' && secondSegment === 'blocked';
  const category = settingsCategoryFromRoute(route);
  const subpageOpen = open && category !== null;
  const blockedSubpageOpen =
    subpageOpen && category === 'blocked' && blockedFromPeople;
  const subpanelBackTarget = blockedFromPeople
    ? '#/settings/people'
    : '#/settings';

  const {
    user,
    profile,
    signIn,
    signOut,
    updateDisplayName,
    updateEmail,
    updatePassword,
    deleteAccount,
    refreshProfile,
  } = useAuth();
  const {
    enterToSend,
    setEnterToSend,
  } = usePreferences();
  const [lang] = useLang();

  const me = user?.id ?? '';

  // profile
  const [nameDraft, setNameDraft] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // email
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  // password
  const [pwEditing, setPwEditing] = useState(false);
  const [pwConfirmOpen, setPwConfirmOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);

  // search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // blocking
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [blockedByIds, setBlockedByIds] = useState<Set<string>>(new Set());
  const [blockedUsers, setBlockedUsers] = useState<Profile[]>([]);
  const [blockBusyId, setBlockBusyId] = useState<string | null>(null);

  // active-connection actions (long-press sheet + block confirmation)
  const [blockSheetTarget, setBlockSheetTarget] = useState<Profile | null>(null);
  const [blockConfirmTarget, setBlockConfirmTarget] = useState<Profile | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);

  // account
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // My Notes is server-backed. Unlike UI-only preferences, its switch must
  // reflect whether the self-connection actually exists for this account.
  const [myNotes, setMyNotes] = useState(false);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const accountRef = useRef<HTMLDivElement>(null);

  // appearance (local state so the outline updates immediately)
  const [appearanceMode, setAppearanceMode] = useState<ThemeMode>(() => getStoredMode());

  // Keep the radio list in sync when the header ThemeButton cycles through
  // light/dark/system while this overlay is mounted.
  useEffect(() => {
    const sync = (event?: Event) => {
      const next =
        event instanceof CustomEvent &&
        (event.detail === 'light' ||
          event.detail === 'dark' ||
          event.detail === 'system')
          ? (event.detail as ThemeMode)
          : getStoredMode();
      setAppearanceMode(next);
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    sync();
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  // Form collapse animation state (smooth open + close).
  const emailCollapse = useCollapse(emailEditing);
  const pwCollapse = useCollapse(pwEditing);

  function openEmailChange() {
    if (emailEditing) {
      // Toggle off: animate the form closed.
      setEmailEditing(false);
      setEmailError(null);
      setEmailNotice(null);
      return;
    }
    // Toggle on: like the password change, explain the flow first (the new
    // address only becomes active after confirming the emailed link). The
    // actual form opens from the confirmation dialog.
    setEmailNotice(null);
    setEmailError(null);
    setEmailConfirmOpen(true);
  }

  useEffect(() => {
    let active = true;
    if (!me) {
      setConnections([]);
      setProfiles({});
      setMyNotes(false);
      setNotesLoading(false);
      setConnectionsLoading(false);
      return () => {
        active = false;
      };
    }

    setNotesLoading(true);
    setConnectionsLoading(true);
    getMyConnections(me).then(async (result) => {
      if (!active) return;
      const loaded = result.data;
      setConnections(loaded);
      setMyNotes(
        loaded.some(
          (connection) =>
            connection.user_a === me &&
            connection.user_b === me &&
            connection.status === 'accepted',
        ),
      );
      const acceptedOtherIds = loaded
        .filter(
          (connection) =>
            connection.status === 'accepted' && !isSelfConnection(connection),
        )
        .map((connection) => otherUserId(connection, me));
      if (acceptedOtherIds.length > 0) {
        const profilesResult = await getProfiles(acceptedOtherIds);
        if (!active) return;
        setProfiles(profilesResult.data);
      } else {
        setProfiles({});
      }
      setNotesLoading(false);
      setConnectionsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [me, open]);

  // Block relations (both directions) + the blocked-users list.
  useEffect(() => {
    let active = true;
    if (!me) {
      setBlockedIds(new Set());
      setBlockedByIds(new Set());
      setBlockedUsers([]);
      return;
    }
    getBlockRelations(me).then((rel) => {
      if (!active) return;
      setBlockedIds(rel.blockedIds);
      setBlockedByIds(rel.blockedByIds);
    });
    getBlockedUsers(me).then(async (result) => {
      if (result.error) return;
      const list = result.data;
      const profilesResult = await getProfiles(list.map((b) => b.blockedId));
      if (!active) return;
      const profiles = profilesResult.data;
      setBlockedUsers(
        list
          .map((b) => profiles[b.blockedId])
          .filter((p): p is Profile => Boolean(p)),
      );
    });
    return () => {
      active = false;
    };
  }, [me, open]);

  // Realtime: blocks made elsewhere (another device) update Settings and
  // the blocked-users page immediately.
  useEffect(() => {
    if (!supabase || !me || !open) return;
    const client = supabase;
    const reload = () => {
      getBlockRelations(me).then((rel) => {
        setBlockedIds(rel.blockedIds);
        setBlockedByIds(rel.blockedByIds);
      });
      getBlockedUsers(me).then(async (result) => {
        if (result.error) return;
        const list = result.data;
        const profilesResult = await getProfiles(list.map((b) => b.blockedId));
        const profiles = profilesResult.data;
        setBlockedUsers(
          list
            .map((b) => profiles[b.blockedId])
            .filter((p): p is Profile => Boolean(p)),
        );
      });
    };
    const channel = client
      .channel('settings-user-blocks')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_blocks',
          filter: `blocker_id=eq.${me}`,
        },
        reload,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_blocks',
          filter: `blocked_id=eq.${me}`,
        },
        reload,
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [me, open]);

  useEffect(() => {
    if (!open) return;
    setNameDraft(displayName(profile));
    setNameError(null);
    setNameSaved(false);
  }, [open, profile]);

  async function saveDisplayName() {
    const name = sanitizeDisplayName(nameDraft);
    if (!name || name === sanitizeDisplayName(displayName(profile))) return;
    setNameBusy(true);
    setNameError(null);
    setNameSaved(false);
    const err = await updateDisplayName(name);
    setNameBusy(false);
    if (err) {
      setNameError(err);
      return;
    }
    setNameSaved(true);
  }

  async function handleEmailChange(e: FormEvent) {
    e.preventDefault();
    if (emailBusy || !newEmail.trim()) return;
    setEmailBusy(true);
    setEmailError(null);
    setEmailNotice(null);
    const err = await updateEmail(newEmail.trim());
    setEmailBusy(false);
    if (err) {
      setEmailError(err);
      return;
    }
    setEmailNotice(t('settingsScreen.emailChangeSent'));
    setNewEmail('');
    setEmailEditing(false);
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    setPwError(null);
    setPwNotice(null);
    if (newPw.length < 6) {
      setPwError(t('errors.weakPassword'));
      return;
    }
    if (newPw !== confirmPw) {
      setPwError(t('auth.passwordMismatch'));
      return;
    }
    if (!user?.email) {
      setPwError(t('errors.passwordChangeFailed'));
      return;
    }
    setPwBusy(true);
    // Re-authenticate with Supabase before changing the password. The current
    // password field is therefore real backend validation, not a UI-only gate.
    const authError = await signIn(user.email, currentPw);
    if (authError) {
      setPwBusy(false);
      setPwError(authError);
      return;
    }
    const err = await updatePassword(newPw);
    setPwBusy(false);
    if (err) {
      setPwError(err);
      return;
    }
    setPwNotice(t('settingsScreen.passwordChanged'));
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setPwEditing(false);
  }

  async function handleSignOut() {
    setSignOutBusy(true);
    await signOut();
    navigate('#/');
  }

  async function handleDeleteAccount() {
    setDeleteBusy(true);
    setDeleteError(null);
    const err = await deleteAccount();
    setDeleteBusy(false);
    if (err) {
      setDeleteError(err);
      return;
    }
    navigate('#/');
  }

  async function toggleMyNotes(on: boolean) {
    if (notesBusy || notesLoading || !me) return;
    setNotesBusy(true);
    setNotesError(null);

    try {
      if (on) {
        const result = await ensureMyNotes(me);
        if (result.error || !result.connectionId) {
          setNotesError(result.error ?? t('settingsScreen.myNotesError'));
          return;
        }
        const connectionId = result.connectionId;
        setConnections((current) => {
          const existingIndex = current.findIndex(
            (connection) =>
              connection.user_a === me && connection.user_b === me,
          );
          const notesConnection: Connection = {
            id: connectionId,
            user_a: me,
            user_b: me,
            status: 'accepted',
            created_at: new Date().toISOString(),
          };
          if (existingIndex < 0) return [notesConnection, ...current];
          return current.map((connection, index) =>
            index === existingIndex
              ? { ...connection, status: 'accepted' as const }
              : connection,
          );
        });
        setMyNotes(true);
      } else {
        const self = connections.find(
          (connection) => connection.user_a === me && connection.user_b === me,
        );
        const error = await removeMyNotes(me, self?.id);
        if (error) {
          setNotesError(error);
          return;
        }
        setConnections((current) =>
          current.filter(
            (connection) =>
              connection.user_a !== me || connection.user_b !== me,
          ),
        );
        setMyNotes(false);
      }
    } finally {
      setNotesBusy(false);
    }
  }

  const searchTimer = useRef<number | null>(null);

  // Long-press/block action UI belongs to a routed Settings view. Close it when
  // the user navigates away so it cannot dangle over a different subpage.
  useEffect(() => {
    setBlockSheetTarget(null);
    setBlockConfirmTarget(null);
    setPeopleError(null);
  }, [open, category]);

  function handleSearchChange(value: string) {
    setQuery(value);
    const q = normalizeUsername(value);
    if (!q) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    if (shouldSkipNetwork()) {
      // People Search is a server query. Offline it reports unavailability
      // instead of issuing a request that can only fail.
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
      setResults([]);
      setSearching(false);
      setSearchError(t('offline.actionUnavailable'));
      return;
    }
    setSearching(true);
    setSearchError(null);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      const result = await searchUsers(q, me);
      if (result.error) {
        setSearchError(result.error);
        setResults([]);
      } else {
        setResults(result.data);
        setSearchError(null);
      }
      setSearching(false);
    }, 300);
  }

  async function openConversation(other: Profile) {
    // Connections may have been changed from Chat or Home while Settings was
    // mounted. Re-read before navigating: a stale, deleted connection ID
    // would otherwise send the user to a conversation that no longer exists.
    const freshConnectionsResult = await getMyConnections(me);
    setConnections(freshConnectionsResult.data);
    const existing = freshConnectionsResult.data.find(
      (c) =>
        (c.user_a === me && c.user_b === other.id) ||
        (c.user_a === other.id && c.user_b === me),
    );
    if (existing) {
      const deletions = await loadDeletionsForUser(me);
      if (deletions.chats.has(existing.id)) {
        // Keep the cutoff — do NOT change accepted → pending (RLS blocks
        // it).  Instead, mark the chat as revealed so it reappears in the
        // Home list while hidden_until keeps old messages hidden.
        if (existing.status === 'accepted' || existing.status === 'ended') {
          await revealChatForMe(me, existing.id);
        }
      }
      navigate(`#/chat/${existing.id}`);
      return;
    }
    setActionBusyId(other.id);
    const err = await sendConnectionRequest(me, other.id);
    setActionBusyId(null);
    if (err) {
      setSearchError(err);
      return;
    }
    // Re-fetch connections, then open the conversation.
    const connsResult = await getMyConnections(me);
    setConnections(connsResult.data);
    const fresh = connsResult.data.find(
      (c) =>
        (c.user_a === me && c.user_b === other.id) ||
        (c.user_a === other.id && c.user_b === me),
    );
    if (fresh) navigate(`#/chat/${fresh.id}`);
  }

  async function handleAccept(conn: Connection) {
    setActionBusyId(conn.id);
    const err = await acceptConnection(conn.id);
    setActionBusyId(null);
    if (!err) {
      const result = await getMyConnections(me);
      setConnections(result.data);
      navigate(`#/chat/${conn.id}`);
    }
  }

  async function handleCancelRequest(conn: Connection) {
    setActionBusyId(conn.id);
    const err = await cancelConnectionRequest(conn.id);
    setActionBusyId(null);
    if (!err) {
      const result = await getMyConnections(me);
      setConnections(result.data);
    }
  }

  async function handleUnblock(target: Profile) {
    if (!me || blockBusyId === target.id) return;
    setBlockBusyId(target.id);
    const err = await unblockUser(me, target.id);
    setBlockBusyId(null);
    if (err) {
      setSearchError(err);
      return;
    }
    // The server removed the block — update both lists immediately.
    setBlockedIds((prev) => {
      const next = new Set(prev);
      next.delete(target.id);
      return next;
    });
    setBlockedUsers((prev) => prev.filter((u) => u.id !== target.id));
  }

  function statusOf(otherId: string): Connection | undefined {
    return connections.find(
      (c) =>
        (c.user_a === me && c.user_b === otherId) ||
        (c.user_a === otherId && c.user_b === me),
    );
  }

  function openConnectionActions(target: Profile) {
    setBlockSheetTarget(target);
  }

  async function handleBlockConnection() {
    const target = blockConfirmTarget;
    if (!target || !me || blockBusyId === target.id) return;
    setBlockBusyId(target.id);
    setPeopleError(null);
    const err = await blockUser(me, target.id);
    setBlockBusyId(null);
    setBlockConfirmTarget(null);
    if (err) {
      setPeopleError(err);
      return;
    }
    // Keep both block state and the blocked profile list in sync immediately.
    setBlockedIds((prev) => {
      const next = new Set(prev);
      next.add(target.id);
      return next;
    });
    setBlockedUsers((prev) => [target, ...prev.filter((u) => u.id !== target.id)]);
  }

  // Active connections: accepted conversations with another profile, excluding
  // the self-chat and anyone blocked from either direction. The server/RLS
  // remains the authorization authority; this is only the UI view.
  const activeConnections = connections
    .filter((conn) => conn.status === 'accepted' && !isSelfConnection(conn))
    .map((conn) => ({
      conn,
      profile: profiles[otherUserId(conn, me)],
    }))
    .filter(
      (
        item,
      ): item is { conn: Connection; profile: Profile } =>
        Boolean(item.profile) &&
        !blockedIds.has(item.profile!.id) &&
        !blockedByIds.has(item.profile!.id),
    );

  const searchActive = query.trim() !== '';

  /* DEDICATED PEOPLE-SEARCH SCREEN ("New chat", route #/new-chat).
     This is the only place the search is mounted: a first-class destination
     of the bottom navigation, not a Settings subpanel. The category overview
     is not rendered on this route. All search state (query, results,
     connections, block relations) lives in this component, so the real
     existing search behavior — debounced server lookup, connection-request
     handling, block-aware result rows — is reused without any parallel
     implementation. A swap renders this body in the leaving pane as well, so
     the search screen slides away as the screen it was. */
  const newChatBody = (
    <PeopleSearch
      query={query}
      onSearchChange={handleSearchChange}
      searchActive={searchActive}
      searching={searching}
      searchError={searchError}
      results={results}
      statusOf={statusOf}
      blockedIds={blockedIds}
      blockedByIds={blockedByIds}
      blockBusyId={blockBusyId}
      onUnblock={handleUnblock}
      onOpenConversation={openConversation}
      actionBusyId={actionBusyId}
      me={me}
    />
  );

  /* CATEGORY OVERVIEW — no people search here anymore; the dedicated New chat
     screen is the single search entry point. */
  const settingsBody = (
    <>
      {OVERVIEW_GROUPS.map((group) => (
        <Section key={group.title} title={t(group.title)}>
          {group.categories.map((cat) => (
            <CategoryRow
              key={cat}
              category={cat}
              label={t(CATEGORY_TITLE_KEYS[cat])}
              badge={cat === 'people' ? blockedIds.size : undefined}
            />
          ))}
        </Section>
      ))}

      {/* FOOTER — the About group: version, legal surfaces, source. */}
      <Section title={t('settingsScreen.groupAbout')}>
        <footer className="settings-footer">
          <span className="settings-footer-version">
            {t('settingsScreen.footer')} {__APP_VERSION__}
          </span>
          <a
            className="link settings-legal-link"
            href={lang === 'de' ? '#/impressum' : '#/imprint'}
          >
            {t('legal.imprint')}
          </a>
          <a
            className="link settings-privacy-link"
            href={lang === 'de' ? '#/datenschutz' : '#/privacy'}
          >
            {t('legal.privacy')}
          </a>
          <a
            className="link settings-github"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            <GithubIcon size={15} />
            {t('settingsScreen.github')}
          </a>
        </footer>
      </Section>
    </>
  );

  return (
    <aside
      className={`settings-overlay${open ? ' open' : ''}`}
      aria-hidden={!open}
    >
      {/* TOP-LEVEL DESTINATIONS — the two equal areas of this overlay, each
          one a full-size surface with its own header and content. The
          destination the route points at is rendered as the active (or,
          during a swap, arriving) pane; the destination a swap is animating
          away from stays mounted as the leaving pane until its exit is over.
          New chat is the left area and Settings the right one, so both
          directions of the swap are the same movement and its reverse. */}
      {paneState('new-chat') !== null && (
        <OverlayPane
          destination="new-chat"
          state={paneState('new-chat')!}
          title={t('nav.newChat')}
          bodyClassName="newchat-screen"
          onExitEnd={endSwap}
        >
          {newChatBody}
        </OverlayPane>
      )}
      {paneState('settings') !== null && (
        <OverlayPane
          destination="settings"
          state={paneState('settings')!}
          title={t('settingsScreen.title')}
          bodyClassName="settings-overview"
          onExitEnd={endSwap}
        >
          {settingsBody}
        </OverlayPane>
      )}

      {/* The primary navigation is NOT rendered here: as a child of this
          overlay it would inherit the slide-in transform. It is a fixed
          top-level layer in App.tsx and marks this destination as active. */}

      {/* CATEGORY SUBPAGE — slides in like the settings overlay */}
      <div
        className={`settings-subpanel${subpageOpen ? ' open' : ''}`}
        aria-hidden={!subpageOpen || blockedSubpageOpen}
      >
        <header className="settings-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => navigate(subpanelBackTarget)}
            aria-label={t('back')}
          >
            <BackIcon size={22} />
          </button>
          <div className="settings-subpanel-title">
            {category ? t(CATEGORY_TITLE_KEYS[category]) : ''}
          </div>
          <ThemeButton />
        </header>
        <div className="settings-scroll">
          {category === 'profile' && (
            <ProfileSettings
              nameDraft={nameDraft}
              nameBusy={nameBusy}
              nameError={nameError}
              nameSaved={nameSaved}
              setNameDraft={setNameDraft}
              setNameSaved={setNameSaved}
              saveDisplayName={saveDisplayName}
              displayNameValue={displayName(profile)}
              username={profile?.username ?? ''}
              email={user?.email ?? ''}
              onEmailClick={openEmailChange}
            />
          )}
          {(category === 'people' || (category === 'blocked' && blockedFromPeople)) && (
            <PeopleSettings
              connections={activeConnections}
              loading={connectionsLoading}
              error={peopleError}
              onOpenConversation={openConversation}
              onLongPress={openConnectionActions}
              busyId={actionBusyId}
              blockedCount={blockedIds.size}
            />
          )}
          {category === 'blocked' && !blockedFromPeople && (
            <BlockedUsersPage
              blockedUsers={blockedUsers}
              blockBusyId={blockBusyId}
              onUnblock={handleUnblock}
            />
          )}
          {category === 'language' && (
            <LanguageSettings />
          )}
          {category === 'appearance' && (
            <AppearanceSettings
              appearanceMode={appearanceMode}
              setAppearanceMode={setAppearanceMode}
            />
          )}
          {category === 'chat' && (
            <ChatSettings
              enterToSend={enterToSend}
              setEnterToSend={setEnterToSend}
              myNotes={myNotes}
              onToggleMyNotes={toggleMyNotes}
              notesBusy={notesBusy}
              notesLoading={notesLoading}
              notesError={notesError}
            />
          )}
          {category === 'account' && (
            <div ref={accountRef}>
              <AccountSettings
                emailEditing={emailEditing}
                emailCollapseRender={emailCollapse.render}
                emailCollapseClosing={emailCollapse.closing}
                newEmail={newEmail}
                setNewEmail={setNewEmail}
                emailBusy={emailBusy}
                emailError={emailError}
                emailNotice={emailNotice}
                onEmailChange={handleEmailChange}
                onOpenEmailChange={openEmailChange}
                pwEditing={pwEditing}
                setPwEditing={setPwEditing}
                pwCollapseRender={pwCollapse.render}
                pwCollapseClosing={pwCollapse.closing}
                currentPw={currentPw}
                setCurrentPw={setCurrentPw}
                newPw={newPw}
                setNewPw={setNewPw}
                confirmPw={confirmPw}
                setConfirmPw={setConfirmPw}
                pwBusy={pwBusy}
                pwError={pwError}
                pwNotice={pwNotice}
                onPasswordChange={handlePasswordChange}
                onOpenPasswordChange={() => {
                  setPwNotice(null);
                  setPwError(null);
                  setPwConfirmOpen(true);
                }}
                onOpenSignOut={() => setSignOutOpen(true)}
                onOpenDelete={() => {
                  setDeleteError(null);
                  setDeleteConfirm('');
                  setDeleteOpen(true);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* NESTED BLOCKED USERS SUBPAGE — same slide-in transition as the
          Settings subpanels, but it sits on top of People. */}
      <div
        className={`settings-subpanel settings-subpanel-nested${blockedSubpageOpen ? ' open' : ''}`}
        aria-hidden={!blockedSubpageOpen}
      >
        <header className="settings-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => navigate('#/settings/people')}
            aria-label={t('back')}
          >
            <BackIcon size={22} />
          </button>
          <div className="settings-subpanel-title">
            {t(CATEGORY_TITLE_KEYS.blocked)}
          </div>
          <ThemeButton />
        </header>
        <div className="settings-scroll">
          {blockedSubpageOpen && (
            <BlockedUsersPage
              blockedUsers={blockedUsers}
              blockBusyId={blockBusyId}
              onUnblock={handleUnblock}
            />
          )}
        </div>
      </div>

      {emailConfirmOpen && (
        <Dialog
          title={t('settingsScreen.emailChangeConfirmTitle')}
          text={t('settingsScreen.emailChangeConfirmText')}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            setEmailConfirmOpen(false);
            setEmailEditing(true);
            // The email form lives on the Account subpage, so open it there
            // (the Profile email entry is on a different subpage).
            navigate('#/settings/account');
            setTimeout(() => {
              // JS smooth scrolling is not covered by the CSS reduced-motion
              // block — use an instant jump for reduced-motion users.
              accountRef.current?.scrollIntoView({
                behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                block: 'start',
              });
            }, 50);
          }}
          onCancel={() => setEmailConfirmOpen(false)}
        />
      )}

      {pwConfirmOpen && (
        <Dialog
          title={t('settingsScreen.changePasswordConfirmTitle')}
          text={t('settingsScreen.changePasswordConfirmText')}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            setPwConfirmOpen(false);
            setPwEditing(true);
          }}
          onCancel={() => setPwConfirmOpen(false)}
        />
      )}

      {signOutOpen && (
        <Dialog
          title={t('settingsScreen.signOutTitle')}
          text={t('settingsScreen.signOutText')}
          confirmLabel={t('settingsScreen.signOut')}
          cancelLabel={t('cancel')}
          danger
          busy={signOutBusy}
          onConfirm={handleSignOut}
          onCancel={() => setSignOutOpen(false)}
        />
      )}

      {deleteOpen && (
        <Dialog
          title={t('settingsScreen.deleteAccountTitle')}
          confirmLabel={t('settingsScreen.deleteAccountConfirm')}
          cancelLabel={t('cancel')}
          danger
          busy={deleteBusy}
          confirmDisabled={normalizeUsername(deleteConfirm) !== (profile?.username ?? '')}
          onConfirm={handleDeleteAccount}
          onCancel={() => setDeleteOpen(false)}
        >
          <p className="dialog-text">{t('settingsScreen.deleteAccountText')}</p>
          <label className="settings-field-label" htmlFor="delete-account-confirm">
            {t('settingsScreen.deleteAccountTypeHint', {
              username: `@${profile?.username ?? ''}`,
            })}
          </label>
          <input
            id="delete-account-confirm"
            className="input delete-confirm-input"
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={`@${profile?.username ?? ''}`}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            autoFocus
            aria-label={t('settingsScreen.deleteAccountTypeHint', {
              username: `@${profile?.username ?? ''}`,
            })}
          />
          {deleteError && (
            <p className="error" role="alert">
              {deleteError}
            </p>
          )}
        </Dialog>
      )}

      {blockSheetTarget && (
        <BottomSheet
          title={displayName(blockSheetTarget)}
          cancelLabel={t('cancel')}
          onClose={() => setBlockSheetTarget(null)}
          items={[
            {
              key: 'block',
              label: t('block.blockUser'),
              danger: true,
              onSelect: () => setBlockConfirmTarget(blockSheetTarget),
            },
          ]}
        />
      )}

      {blockConfirmTarget && (
        <Dialog
          title={t('block.blockTitle', {
            username: blockConfirmTarget.username ?? '',
          })}
          text={t('block.blockText')}
          confirmLabel={t('block.blockUser')}
          cancelLabel={t('cancel')}
          danger
          busy={blockBusyId === blockConfirmTarget.id}
          onConfirm={handleBlockConnection}
          onCancel={() => setBlockConfirmTarget(null)}
        />
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* collapse helper: keep a toggled form mounted just long enough to    */
/* animate out, instead of disappearing instantly (which felt janky).  */
/* ------------------------------------------------------------------ */

function useCollapse(open: boolean, duration = 200) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
    } else if (render) {
      setClosing(true);
      const t = window.setTimeout(() => {
        setRender(false);
        setClosing(false);
      }, duration);
      return () => window.clearTimeout(t);
    }
  }, [open, render, duration]);
  return { render, closing };
}
