import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { navigate, useHashRoute } from '../lib/router';
import {
  acceptConnection,
  cancelConnectionRequest,
  declineConnection,
  getLastMessages,
  getMyConnections,
  getProfiles,
  getReadState,
  getUnreadCounts,
  CHAT_HIDDEN_EVENT,
  isHiddenByChatDeletion,
  loadDeletionsForUser,
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
import { mergeLastMessage, unreadAfterInsert } from '../lib/homeRealtime';
import { getCachedPlaintextSync, warmMessageCache } from '../lib/e2ee/message-cache';
import { isEnvelope } from '../lib/e2ee/message-flow';
import ThemeButton from './ThemeButton';
import { GearIcon, NoteIcon } from './icons';
import Dialog from './Dialog';

interface RowData {
  conn: Connection;
  status: Connection['status'];
  other: Profile | null;
  last: Message | null;
  unread: number;
}

function previewOf(
  last: Message | undefined,
  lang: string,
  peerUsername: string,
  me: string,
): string | null {
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
  if (last.kind === 'deleted_account') {
    return t('chat.deletedAccountMessage', {
      username: last.meta?.username ?? peerUsername,
    });
  }
  // E2EE: show cached plaintext if we have it; otherwise the envelope is
  // opaque, so show a placeholder. Legacy plaintext / My Notes show as-is.
  const cached = getCachedPlaintextSync(me, last.id);
  if (cached !== null) return cached;
  if (isEnvelope(last.ciphertext)) return t('chat.encryptedPreview');
  return last.ciphertext;
}

export default function Home() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [others, setOthers] = useState<Record<string, Profile>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, Message>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Connection | null>(null);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const me = user?.id ?? '';

  // Mirrors the visible connection ids so the realtime handlers can decide
  // between an incremental update and a full reconciliation without
  // re-subscribing on every list change.
  const visibleIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    visibleIdsRef.current = new Set(connections.map((c) => c.id));
  }, [connections]);

  const load = useCallback(async () => {
    if (!me) return;
    setLoadError(null);
    await warmMessageCache(me);
    const connsResult = await getMyConnections(me);
    if (connsResult.error) {
      setLoadError(connsResult.error);
      setLoading(false);
      return;
    }
    const conns = connsResult.data;
    const deletions = await loadDeletionsForUser(me);
    const lastAllResult = await getLastMessages(conns.map((c) => c.id));
    if (lastAllResult.error) {
      setLoadError(lastAllResult.error);
      setLoading(false);
      return;
    }
    const lastAll = lastAllResult.data;
    const visible = conns.filter((c) => {
      const until = deletions.chatUntil.get(c.id);
      if (!until) return true;
      // A revealed chat reappears in the list (empty for the deleter,
      // old history stays hidden behind hidden_until).
      if (deletions.revealed.has(c.id)) return true;
      const status = effectiveStatus(c);
      if (status === 'pending' || status === 'declined' || status === 'expired') {
        return true;
      }
      const last = lastAll[c.id];
      if (last && !isHiddenByChatDeletion(last.created_at, until)) return true;
      return !isHiddenByChatDeletion(c.created_at, until);
    });
    setConnections(visible);

    const ids = visible.map((c) => otherUserId(c, me));
    const profilesResult = await getProfiles(ids);
    if (profilesResult.error) {
      setLoadError(profilesResult.error);
      setLoading(false);
      return;
    }
    setOthers(profilesResult.data);

    const last: Record<string, Message> = {};
    for (const c of visible) {
      const msg = lastAll[c.id];
      const until = deletions.chatUntil.get(c.id);
      if (msg && !isHiddenByChatDeletion(msg.created_at, until)) last[c.id] = msg;
    }
    setLastMessages(last);

    const readState = await getReadState(me);
    const counts = await getUnreadCounts(
      me,
      visible.map((c) => c.id),
      readState,
    );
    setUnread(counts);

    setLoading(false);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    load();
  }, [me, load]);

  /* Home stays mounted behind the Settings overlay. Leaving Settings may have
     changed the chat list (e.g. My Notes toggled on/off), so reload it on the
     Settings → Home transition instead of waiting for a remount or reload. */
  const route = useHashRoute();
  const inSettingsRef = useRef(route.startsWith('#/settings'));
  useEffect(() => {
    const inSettings = route.startsWith('#/settings');
    const wasInSettings = inSettingsRef.current;
    inSettingsRef.current = inSettings;
    if (wasInSettings && !inSettings && me) {
      load();
    }
  }, [route, me, load]);

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
          if (!msg) return;
          // A conversation that is not currently in the list (new, or hidden
          // behind a chat deletion) needs a full reconciliation so its
          // profile, visibility and unread state are re-derived.
          if (!visibleIdsRef.current.has(msg.connection_id)) {
            load();
            return;
          }
          // Incremental hot path: update only the affected row. The list
          // order and preview are derived from `lastMessages`, so replacing
          // the newest message is enough to re-render and re-sort the row.
          setLastMessages((prev) => mergeLastMessage(prev, msg));
          // A peer message is unread while Home is on screen; own messages
          // (sent from another device) are never counted.
          setUnread((prev) =>
            unreadAfterInsert(prev, msg.connection_id, msg.sender_id !== me),
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as Message | undefined;
          if (!msg || !visibleIdsRef.current.has(msg.connection_id)) return;
          // E.g. delete-for-everyone: the newest message's content/preview
          // changes in place. Updates to non-last messages are ignored
          // because they cannot affect the rendered row.
          setLastMessages((prev) => mergeLastMessage(prev, msg));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const row = payload.new as Profile | undefined;
          if (!row) return;
          setOthers((prev) => (row.id in prev ? { ...prev, [row.id]: row } : prev));
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
  }, [me, load]);

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

  async function handleDecline(blockPeer = false) {
    if (!declineTarget) return;
    setDeclineBusy(true);
    setError(null);
    const err = await declineConnection(declineTarget.id, blockPeer);
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

      {loadError && !loading ? (
        <section className="empty">
          <div className="empty-title" role="alert">
            {loadError}
          </div>
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            {t('errors.retry')}
          </button>
        </section>
      ) : !hasChats && !loading ? (
        <section className="empty">
          <div className="empty-title">{t('home.nothingHere')}</div>
          <div className="empty-text">{t('home.startChat')}</div>
        </section>
      ) : (
        <div className="chat-list">
          {rows.map(({ conn, status, other, last, unread: unreadCount }) => {
            const self = isSelfConnection(conn);
            const ended = status === 'ended';
            const name = self
              ? t('settingsScreen.myNotes')
              : ended
                ? t('chat.deletedAccount')
                : displayName(other);
            const sub = ended ? '' : `@${other?.username ?? '…'}`;
            const isRequest = status !== 'accepted' && status !== 'ended';
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
                className={`chat-row${isRequest ? ' request' : ''}${unreadCount > 0 ? ' unread' : ''}${self ? ' notes' : ''}`}
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
                          {!(self && !last) && (
                            <span className="chat-preview">
                              {previewOf(
                                last ?? undefined,
                                getLang(),
                                other?.username ?? '',
                                me,
                              ) ?? ''}
                            </span>
                          )}
                          {unreadCount > 0 && (
                            <span className="unread-badge" aria-label={`${unreadCount} ${t('unread.unreadCount', { count: unreadCount })}`}>
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {self ? (
                      <div className="chat-notes-tag">
                        <NoteIcon size={12} />
                        {t('chat.myNotesTag')}
                      </div>
                    ) : (
                      <div className="chat-username">{sub}</div>
                    )}
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
          busy={declineBusy}
          onConfirm={() => handleDecline(false)}
          extraAction={{
            label: t('block.declineAndBlock'),
            onClick: () => handleDecline(true),
          }}
          onCancel={() => setDeclineTarget(null)}
        />
      )}
    </main>
  );
}
