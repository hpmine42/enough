import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useHashRoute, navigate } from '../lib/router';
import {
  acceptConnection,
  cancelConnectionRequest,
  ensureMyNotes,
  getMyConnections,
  loadDeletionsForUser,
  removeMyNotes,
  restoreChatForMe,
  searchUsers,
  sendConnectionRequest,
} from '../lib/api';
import { displayName, normalizeUsername } from '../lib/helpers';
import { setLang, t, useLang } from '../i18n';
import { Lang } from '../i18n/translations';
import { applyMode, getStoredMode, ThemeMode } from '../lib/theme';
import { Connection, Profile } from '../lib/types';
import Dialog from './Dialog';
import Toggle from './Toggle';
import ThemeButton from './ThemeButton';
import {
  BackIcon,
  CheckIcon,
  GithubIcon,
  SearchIcon,
} from './icons';

const APP_VERSION = '0.1.0';
const GITHUB_URL = 'https://github.com/hpmine42/enough';

/* ------------------------------------------------------------------ */
/* section primitives                                                  */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  sub,
  children,
  onClick,
}: {
  label: string;
  sub?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="settings-row-main">
        <div className="settings-row-label">{label}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="settings-row clickable" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="settings-row">{content}</div>;
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const route = useHashRoute();
  const open = route.startsWith('#/settings');
  const {
    user,
    profile,
    signOut,
    updateDisplayName,
    updateEmail,
    updatePassword,
    refreshProfile,
  } = useAuth();
  const {
    enterToSend,
    setEnterToSend,
    notifications,
    setNotifications,
    myNotes,
    setMyNotes,
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
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  // password
  const [pwEditing, setPwEditing] = useState(false);
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
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // account
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  // my notes
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  // notifications
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifDenied, setNotifDenied] = useState(false);
  const [notifUnsupported, setNotifUnsupported] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // appearance (local state so the outline updates immediately)
  const [appearanceMode, setAppearanceMode] = useState<ThemeMode>(() => getStoredMode());

  function openEmailChange() {
    setEmailEditing((prev) => {
      if (prev) {
        // Toggle off: close the form
        setNewEmail('');
        setEmailError(null);
        setEmailNotice(null);
        return false;
      }
      // Toggle on: open the form
      setEmailNotice(null);
      setEmailError(null);
      setTimeout(() => {
        accountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
      return true;
    });
  }

  useEffect(() => {
    if (!me) return;
    getMyConnections(me).then(setConnections);
  }, [me]);

  useEffect(() => {
    if (!open) return;
    setNameDraft(displayName(profile));
    setNameError(null);
    setNameSaved(false);
  }, [open, profile]);

  async function saveDisplayName() {
    const name = nameDraft.trim();
    if (!name || name === displayName(profile)) return;
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
    setPwBusy(true);
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

  async function toggleMyNotes(on: boolean) {
    if (notesBusy) return;
    setNotesBusy(true);
    setNotesError(null);
    if (on) {
      const id = await ensureMyNotes(me);
      if (!id) {
        setNotesError(t('settingsScreen.myNotesError'));
      } else {
        setMyNotes(true);
      }
    } else {
      const self = connections.find((c) => c.user_a === me && c.user_b === me);
      if (self) {
        const err = await removeMyNotes(self.id);
        if (err) {
          setNotesError(t('settingsScreen.myNotesError'));
        } else {
          setMyNotes(false);
        }
      } else {
        setMyNotes(false);
      }
    }
    setNotesBusy(false);
  }

  async function toggleNotifications(on: boolean) {
    if (notifBusy) return;
    setNotifDenied(false);
    setNotifUnsupported(false);
    if (!on) {
      setNotifications(false);
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifUnsupported(true);
      setNotifications(false);
      return;
    }
    setNotifBusy(true);
    if (Notification.permission === 'granted') {
      setNotifications(true);
      setNotifBusy(false);
      return;
    }
    if (Notification.permission === 'denied') {
      setNotifDenied(true);
      setNotifications(false);
      setNotifBusy(false);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') setNotifications(true);
      else {
        setNotifDenied(true);
        setNotifications(false);
      }
    } catch {
      setNotifications(false);
    }
    setNotifBusy(false);
  }

  const searchTimer = useRef<number | null>(null);

  function handleSearchChange(value: string) {
    setQuery(value);
    const q = normalizeUsername(value);
    if (!q) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      const found = await searchUsers(q, me);
      setResults(found);
      setSearching(false);
    }, 300);
  }

  async function openConversation(other: Profile) {
    const existing = connections.find(
      (c) =>
        (c.user_a === me && c.user_b === other.id) ||
        (c.user_a === other.id && c.user_b === me),
    );
    if (existing) {
      // If this chat was deleted for me, restore it so it shows in the list.
      const deletions = await loadDeletionsForUser(me);
      if (deletions.chats.has(existing.id)) {
        await restoreChatForMe(me, existing.id);
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
    const conns = await getMyConnections(me);
    setConnections(conns);
    const fresh = conns.find(
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
      setConnections(await getMyConnections(me));
      navigate(`#/chat/${conn.id}`);
    }
  }

  async function handleCancelRequest(conn: Connection) {
    setActionBusyId(conn.id);
    const err = await cancelConnectionRequest(conn.id);
    setActionBusyId(null);
    if (!err) setConnections(await getMyConnections(me));
  }

  function statusOf(otherId: string): Connection | undefined {
    return connections.find(
      (c) =>
        (c.user_a === me && c.user_b === otherId) ||
        (c.user_a === otherId && c.user_b === me),
    );
  }

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

      <div className="settings-scroll">
        {/* PROFILE */}
        <Section title={t('settingsScreen.profile')}>
          <div className="settings-profile">
            <label className="settings-field-label" htmlFor="display-name">
              {t('settingsScreen.displayName')}
            </label>
            <div className="settings-edit-row">
              <input
                id="display-name"
                className="input"
                type="text"
                value={nameDraft}
                maxLength={60}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  setNameSaved(false);
                }}
                onBlur={saveDisplayName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveDisplayName();
                }}
                aria-label={t('settingsScreen.displayName')}
              />
              {nameDraft.trim() !== displayName(profile) && (
                <button
                  type="button"
                  className="btn-small"
                  disabled={nameBusy}
                  onClick={saveDisplayName}
                >
                  {nameBusy ? t('loading') : t('save')}
                </button>
              )}
            </div>
            {nameSaved && <p className="field-hint ok">{t('saved')}</p>}
            {nameError && (
              <p className="error" role="alert">
                {nameError}
              </p>
            )}
            <div className="settings-static-row">
              <span className="settings-static-label">{t('settingsScreen.username')}</span>
              <span className="settings-static-value">@{profile?.username ?? '…'}</span>
            </div>
            <button
              type="button"
              className="settings-static-row settings-email-row"
              onClick={openEmailChange}
            >
              <span className="settings-static-label">{t('settingsScreen.email')}</span>
              <span className="settings-static-value">{user?.email ?? '…'}</span>
            </button>
          </div>
        </Section>

        {/* SEARCH PEOPLE */}
        <Section title={t('settingsScreen.searchPeople')}>
          <div className="at-field search-field">
            <span className="at-prefix" aria-hidden="true">
              @
            </span>
            <input
              className="input at-input"
              type="text"
              placeholder={t('settingsScreen.searchPlaceholder')}
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label={t('settingsScreen.searchPeople')}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
            />
            {searchActive && !searching && (
              <SearchIcon className="at-status" size={18} />
            )}
          </div>
          {searchActive && (
            <div className="settings-search-results">
              {searching && <p className="muted">{t('loading')}</p>}
              {!searching && searchError && (
                <p className="error" role="alert">
                  {searchError}
                </p>
              )}
              {!searching && !searchError && results.length === 0 && (
                <p className="muted">{t('settingsScreen.searchNoResults')}</p>
              )}
              {!searching &&
                results.map((r) => {
                  const conn = statusOf(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="chat settings-search-row"
                      onClick={() => openConversation(r)}
                      disabled={actionBusyId === r.id}
                    >
                      <div className="chat-text">
                        <div className="chat-name">{displayName(r)}</div>
                        <div className="chat-preview">@{r.username}</div>
                      </div>
                      <div className="chat-trailing">
                        {conn?.status === 'accepted' && (
                          <span className="badge-soft">{t('connection.accepted')}</span>
                        )}
                        {conn?.status === 'pending' &&
                          (conn.user_a === me
                            ? t('connection.requestSent')
                            : t('connection.requestTitle'))}
                        {conn?.status === 'declined' && t('connection.requestDeclined')}
                        {conn?.status === 'expired' && t('connection.requestExpired')}
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </Section>

        {/* LANGUAGE */}
        <Section title={t('settingsScreen.language')}>
          <div className="option-list" role="radiogroup" aria-label={t('settingsScreen.language')}>
            {(['en', 'de'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={lang === l}
                className={`option${lang === l ? ' selected' : ''}`}
                onClick={() => setLang(l)}
              >
                {l === 'en' ? 'English' : 'Deutsch'}
                {lang === l && <CheckIcon size={16} />}
              </button>
            ))}
          </div>
        </Section>

        {/* APPEARANCE */}
        <Section title={t('settingsScreen.appearance')}>
          <div className="option-list" role="radiogroup" aria-label={t('settingsScreen.appearance')}>
            {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={appearanceMode === m}
                className={`option${appearanceMode === m ? ' selected' : ''}`}
                onClick={() => {
                  applyMode(m);
                  setAppearanceMode(m);
                }}
              >
                {t(
                  m === 'light'
                    ? 'settingsScreen.light'
                    : m === 'dark'
                      ? 'settingsScreen.dark'
                      : 'settingsScreen.system',
                )}
                {appearanceMode === m && <CheckIcon size={16} />}
              </button>
            ))}
          </div>
        </Section>

        {/* CHAT */}
        <Section title={t('settingsScreen.chat')}>
          <Row label={t('settingsScreen.enterToSend')} sub={t('settingsScreen.enterToSendHint')}>
            <Toggle
              checked={enterToSend}
              onChange={setEnterToSend}
              label={t('settingsScreen.enterToSend')}
            />
          </Row>
          <Row
            label={t('settingsScreen.notifications')}
            sub={
              notifications
                ? t('settingsScreen.notificationsHint')
                : t('settingsScreen.notificationsExplain')
            }
          >
            <Toggle
              checked={notifications}
              onChange={toggleNotifications}
              disabled={notifBusy}
              label={t('settingsScreen.notifications')}
            />
          </Row>
          <Row label={t('settingsScreen.myNotes')} sub={t('settingsScreen.myNotesHint')}>
            <Toggle
              checked={myNotes}
              onChange={toggleMyNotes}
              disabled={notesBusy}
              label={t('settingsScreen.myNotes')}
            />
          </Row>
          {notesError && (
            <p className="error" role="alert">
              {notesError}
            </p>
          )}
          {notifDenied && (
            <p className="error" role="alert">
              {t('settingsScreen.notificationsDenied')}
            </p>
          )}
          {notifUnsupported && (
            <p className="muted" role="note">
              {t('settingsScreen.notificationsUnsupported')}
            </p>
          )}
        </Section>

        {/* ACCOUNT */}
        <div ref={accountRef}>
          <Section title={t('settingsScreen.account')}>
            <button
              type="button"
              className="settings-row clickable"
              onClick={openEmailChange}
            >
              <div className="settings-row-main">
                <div className="settings-row-label">{t('settingsScreen.editEmail')}</div>
              </div>
            </button>
            {emailEditing && (
              <form className="settings-inline-form" onSubmit={handleEmailChange}>
                <input
                  className="input"
                  type="email"
                  placeholder={t('settingsScreen.newEmail')}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  autoComplete="email"
                  required
                  aria-label={t('settingsScreen.newEmail')}
                />
                <button className="btn-small" type="submit" disabled={emailBusy}>
                  {emailBusy ? t('loading') : t('settingsScreen.changeEmailSubmit')}
                </button>
                {emailError && (
                  <p className="error" role="alert">
                    {emailError}
                  </p>
                )}
                {emailNotice && <p className="field-hint ok">{emailNotice}</p>}
              </form>
            )}
            <button
              type="button"
              className="settings-row clickable"
              onClick={() => {
                setPwEditing((v) => !v);
                setPwNotice(null);
                setPwError(null);
              }}
            >
              <div className="settings-row-main">
                <div className="settings-row-label">{t('settingsScreen.changePassword')}</div>
              </div>
            </button>
          {pwEditing && (
            <form className="settings-inline-form" onSubmit={handlePasswordChange}>
              <input
                className="input"
                type="password"
                placeholder={t('settingsScreen.currentPassword')}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                required
                aria-label={t('settingsScreen.currentPassword')}
              />
              <input
                className="input"
                type="password"
                placeholder={t('settingsScreen.newPassword')}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                aria-label={t('settingsScreen.newPassword')}
              />
              <input
                className="input"
                type="password"
                placeholder={t('auth.confirmPassword')}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                required
                aria-label={t('auth.confirmPassword')}
              />
              {pwError && (
                <p className="error" role="alert">
                  {pwError}
                </p>
              )}
              {pwNotice && <p className="field-hint ok">{pwNotice}</p>}
              <button className="btn-small" type="submit" disabled={pwBusy}>
                {pwBusy ? t('loading') : t('settingsScreen.changePasswordSubmit')}
              </button>
            </form>
          )}
          <button
            type="button"
            className="settings-row clickable danger-text"
            onClick={() => setSignOutOpen(true)}
          >
            <div className="settings-row-main">
              <div className="settings-row-label">{t('settingsScreen.signOut')}</div>
            </div>
          </button>
          </Section>
        </div>

        {/* FOOTER */}
        <footer className="settings-footer">
          <span>
            {t('settingsScreen.footer')} {APP_VERSION}
          </span>
          <a className="link settings-legal-link" href="#/impressum">
            {t('legal.imprint')}
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
    </aside>
  );
}
