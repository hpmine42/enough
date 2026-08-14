import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { navigate } from '../lib/router';
import {
  acceptConnection,
  cancelConnectionRequest,
  declineConnection,
  getLastMessages,
  getMyConnections,
  getProfiles,
  getReadState,
  getUnreadCounts,
  loadDeletionsForUser,
  restoreChatForMe,
} from '../lib/api';
import {
  displayName,
  effectiveStatus,
  formatDate,
  formatRelative,
  isSelfConnection,
  otherUserId,
} from '../lib/helpers';
import { supabase } from '../lib/supabase';
import { getLang, t } from '../i18n';
import { Connection, Message, Profile } from '../lib/types';
import ThemeButton from './ThemeButton';
import { GearIcon } from './icons';
import Dialog from './Dialog';

interface RowData {
  conn: Connection;
  status: Connection['status'];
  other: Profile | null;
  last: Message | null;
  unread: number;
}

function previewOf(last: Message | undefined, lang: string, peerUsername: string): string | null {
  if (!last) return null;
  if (last.deleted_at) {
    return t('chat.deletedForEveryoneOther', { username: peerUsername });
  }
  if (last.kind === 'name_change') {
    return t('chat.nameChange', {
      old: last.meta?.old_name ?? '',
      new: last.meta?.new_name ?? '',
    });
  }
  return last.ciphertext;
}

export default function Home() {
  const { user } = useAuth();
  const { notifications: notificationsPref } = usePreferences();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [others, setOthers] = useState<Record<string, Profile>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Connection | null>(null);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  const me = user?.id ?? '';

  const load = useCallback(async () => {
    if (!me) return;
    const conns = await getMyConnections(me);
    const deleted = (await loadDeletionsForUser(me)).chats;
    // Chat deletion is "delete for me": hidden, but restored by a new message.
    const visible = conns.filter((c) => !deleted.has(c.id));
    setConnections(visible);

    const ids = visible.map((c) => otherUserId(c, me));
    const profiles = await getProfiles(ids);
    setOthers(profiles);

    const last = await getLastMessages(visible.map((c) => c.id));
    setLastMessages(last);

    const readState = await getReadState(me);
    const counts = await getUnreadCounts(
      me,
      visible.map((c) => c.id),
      readState,
    );
    setUnread(counts);

    // A new message restored a previously deleted chat: keep it visible.
    for (const c of visible) {
      if (deleted.has(c.id) && last[c.id]) {
        restoreChatForMe(me, c.id);
      }
    }

    setLoading(false);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    load();
  }, [me, load]);

  /* Realtime: connections, messages, profiles, deletions — one channel. */
  useEffect(() => {
    if (!supabase || !me) return;
    const client = supabase;
    const channel = client
      .channel('home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connections' },
        (payload) => {
          const row = payload.new as Connection | undefined;
          if (row && (row.user_a === me || row.user_b === me)) load();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message | undefined;
          if (!msg || msg.sender_id === me) return;
          load();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as Message | undefined;
          if (row) load();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const row = payload.new as Profile | undefined;
          if (row && (row.id === me || others[row.id])) load();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_deletions' },
        (payload) => {
          const row = payload.new as { user_id?: string } | undefined;
          if (row && row.user_id === me) load();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_deletions' },
        (payload) => {
          const row = payload.new as { user_id?: string } | undefined;
          if (row && row.user_id === me) load();
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, load, notificationsPref]);

  /* OS notifications for new messages while the app is hidden. */
  useEffect(() => {
    if (
      !supabase ||
      !me ||
      !notificationsPref ||
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }
    const client = supabase;
    const channel = client
      .channel('home-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message | undefined;
          if (!msg || msg.sender_id === me || msg.deleted_at) return;
          if (msg.kind === 'name_change') return;
          if (document.visibilityState !== 'hidden') return;
          if (notifiedRef.current.has(msg.id)) return;
          notifiedRef.current.add(msg.id);
          const conn = connectionsRef.current.find(
            (c) => c.id === msg.connection_id,
          );
          if (!conn) return;
          const other = others[otherUserId(conn, me)];
          try {
            new Notification(t('notification.title'), {
              body: t('notification.body', {
                name: displayName(other),
                text: msg.ciphertext,
              }),
            });
          } catch {
            /* notifications unsupported — ignore */
          }
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, notificationsPref]);

  const connectionsRef = useRef(connections);
  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  /* Rows sorted by latest activity (message time, else connection time). */
  const rows = useMemo<RowData[]>(() => {
    return connections
      .map((conn) => {
        const status = effectiveStatus(conn);
        const other = others[otherUserId(conn, me)] ?? null;
        return {
          conn,
          status,
          other,
          last: lastMessages[conn.id] ?? null,
          unread: unread[conn.id] ?? 0,
        };
      })
      .filter((r) => r.status !== 'expired')
      .sort((a, b) => {
        const ta =
          a.last?.created_at ?? a.conn.created_at ?? '';
        const tb =
          b.last?.created_at ?? b.conn.created_at ?? '';
        return tb.localeCompare(ta);
      });
  }, [connections, others, lastMessages, unread, me]);

  const hasChats = rows.length > 0;

  async function handleAccept(conn: Connection) {
    setBusyId(conn.id);
    setError(null);
    const err = await acceptConnection(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else load();
  }

  async function handleDecline() {
    if (!declineTarget) return;
    setDeclineBusy(true);
    setError(null);
    const err = await declineConnection(declineTarget.id);
    setDeclineBusy(false);
    setDeclineTarget(null);
    if (err) setError(err);
    else load();
  }

  async function handleCancelRequest(conn: Connection) {
    setBusyId(conn.id);
    setError(null);
    const err = await cancelConnectionRequest(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else load();
  }

  return (
    <main className="home-screen">
      <header className="home-header">
        <button
          type="button"
          className="logo logo-button"
          onClick={() => navigate('#/')}
        >
          enough.
        </button>
        <div className="home-header-actions">
          <ThemeButton />
          <button
            type="button"
            className="icon-button"
            onClick={() => navigate('#/settings')}
            aria-label={t('home.settingsLabel')}
            title={t('home.settingsLabel')}
          >
            <GearIcon size={21} />
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!hasChats && !loading ? (
        <section className="empty">
          <div className="empty-title">{t('home.nothingHere')}</div>
          <div className="empty-text">{t('home.startChat')}</div>
        </section>
      ) : (
        <div className="chat-list">
          {rows.map(({ conn, status, other, last, unread: unreadCount }) => {
            const self = isSelfConnection(conn);
            const name = self
              ? t('settingsScreen.myNotes')
              : displayName(other);
            const sub = self ? `@${other?.username ?? '…'}` : `@${other?.username ?? '…'}`;
            const isRequest = status !== 'accepted';
            const isIncoming = status === 'pending' && conn.user_b === me;
            const isOutgoing = status === 'pending' && conn.user_a === me;
            const declined = status === 'declined';
            const expiresAt = declined
              ? formatDate(
                  new Date(new Date(conn.created_at ?? '').getTime() + 14 * 24 * 60 * 60 * 1000),
                  getLang(),
                )
              : null;

            return (
              <div
                key={conn.id}
                className={`chat-row${isRequest ? ' request' : ''}${unreadCount > 0 ? ' unread' : ''}`}
              >
                <button
                  type="button"
                  className="chat"
                  onClick={() => navigate(`#/chat/${conn.id}`)}
                >
                  <div className="chat-text">
                    <div className="chat-topline">
                      <span className="chat-name">{name}</span>
                      <span className="chat-time">
                        {last
                          ? formatRelative(last.created_at, getLang())
                          : conn.created_at
                            ? formatRelative(conn.created_at, getLang())
                            : ''}
                      </span>
                    </div>
                    <div className="chat-subline">
                      {isRequest ? (
                        <span className="chat-preview request-label">
                          {isIncoming
                            ? t('connection.requestTitle')
                            : isOutgoing
                              ? t('connection.requestSent')
                              : declined
                                ? `${t('connection.requestDeclined')} · ${expiresAt}`
                                : t('connection.requestExpired')}
                        </span>
                      ) : (
                        <>
                          <span className="chat-preview">
                            {previewOf(last ?? undefined, getLang(), other?.username ?? '') ??
                              (self ? '' : '')}
                          </span>
                          {unreadCount > 0 && (
                            <span className="unread-badge" aria-label={`${unreadCount} ${t('unread.unreadCount', { count: unreadCount })}`}>
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="chat-username">{sub}</div>
                  </div>
                </button>
                {isIncoming && (
                  <div className="chat-row-actions">
                    <button
                      type="button"
                      className="btn-small"
                      disabled={busyId === conn.id}
                      onClick={() => handleAccept(conn)}
                    >
                      {t('connection.accept')}
                    </button>
                    <button
                      type="button"
                      className="btn-small ghost"
                      disabled={busyId === conn.id}
                      onClick={() => setDeclineTarget(conn)}
                    >
                      {t('connection.decline')}
                    </button>
                  </div>
                )}
                {isOutgoing && (
                  <div className="chat-row-actions">
                    <button
                      type="button"
                      className="btn-small ghost"
                      disabled={busyId === conn.id}
                      onClick={() => handleCancelRequest(conn)}
                    >
                      {t('connection.cancelRequest')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {declineTarget && (
        <Dialog
          title={t('connection.declinedTitle')}
          text={t('connection.declinedText')}
          confirmLabel={t('connection.decline')}
          cancelLabel={t('cancel')}
          danger
          busy={declineBusy}
          onConfirm={handleDecline}
          onCancel={() => setDeclineTarget(null)}
        />
      )}
    </main>
  );
}
