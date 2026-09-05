import { FormEvent, useEffect, useRef, useState } from 'react';
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

/** The six top-level categories shown on the overview (blocked lives inside People). */
const OVERVIEW_CATEGORIES: SettingsCategory[] = [
  'profile',
  'people',
  'language',
  'appearance',
  'chat',
  'account',
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

/**
 * Duration of the Settings subpanel slide, in milliseconds. It mirrors the
 * `transform`/`opacity` transition declared for `.settings-subpanel` in
 * index.css and is the window during which the overview must keep its
 * geometry: see `searchCollapse` below.
 */
const SUBPANEL_TRANSITION_MS = 300;

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
/* settings                                                            */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const route = useHashRoute();
  const open = route.startsWith('#/settings');
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
  const categorySegment = blockedFromPeople ? 'blocked' : firstSegment;
  const category =
    categorySegment !== null && (SETTINGS_CATEGORIES as string[]).includes(categorySegment)
      ? (categorySegment as SettingsCategory)
      : null;
  const subpageOpen = open && category !== null;
  const blockedSubpageOpen =
    subpageOpen && category === 'blocked' && blockedFromPeople;
  const subpanelBackTarget = blockedFromPeople
    ? '#/settings/people'
    : '#/settings';

  // People Search belongs to the Settings overview only. When any category
  // subpage (including People → Blocked Users) is open, the search bar is
  // hidden so the subpage shows only its own content. The removal itself is
  // deferred until the subpanel transition has finished (see
  // `searchCollapse`), otherwise the overview loses the search bar's height
  // in the very frame the submenu starts sliding in.
  const onOverview = open && category === null;

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

  // The People Search belongs to the overview only, but it must not leave the
  // layout in the same frame a subpage starts sliding in. Unmounting it
  // immediately would remove its height at once, so the remaining overview
  // content jumped upward before the subpanel was visibly moving. Keeping it
  // mounted for exactly the subpanel transition keeps the overview geometry
  // stable: the submenu then slides over an unchanged overview and the search
  // bar is removed only once the submenu covers it completely.
  // `render` is only used to defer that unmount — mounting is still driven by
  // `onOverview` itself, so returning to the overview shows the search bar in
  // the very same frame.
  const searchCollapse = useCollapse(onOverview, SUBPANEL_TRANSITION_MS);

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

  return (
    <aside
      className={`settings-overlay${open ? ' open' : ''}`}
      aria-hidden={!open}
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
        <button type="button" className="logo settings-logo" onClick={() => navigate('#/')}>
          enough.
        </button>
        <ThemeButton />
      </header>

      {/* People search is available from the Settings overview only. The
          wrapper stays mounted for the duration of the subpanel slide
          (`searchCollapse`) so the overview keeps its geometry while the
          submenu transitions on top of it. `onOverview ||` keeps the mount
          itself synchronous: the search bar must appear in the same frame the
          overview does, never one frame later. */}
      {(onOverview || searchCollapse.render) && (
        <div className="settings-search-wrap">
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
        </div>
      )}

      {/* CATEGORY OVERVIEW */}
      <div className="settings-scroll settings-overview">
        <Section title={t('settingsScreen.title')}>
          {OVERVIEW_CATEGORIES.map((cat) => (
            <CategoryRow
              key={cat}
              category={cat}
              label={t(CATEGORY_TITLE_KEYS[cat])}
              badge={cat === 'people' ? blockedIds.size : undefined}
            />
          ))}
        </Section>

        {/* FOOTER */}
        <footer className="settings-footer">
          <span>
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
      </div>

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
