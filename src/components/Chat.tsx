import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';
import {
  acceptConnection,
  cancelConnectionRequest,
  declineConnection,
  deleteChatForMe,
  deleteMessageForEveryone,
  deleteMessageForMe,
  getConnection,
  getMessagesPage,
  getProfiles,
  loadDeletionsForUser,
  saveReadState,
  sendConnectionRequest,
  sendMessage,
} from '../lib/api';
import {
  displayName,
  effectiveStatus,
  formatDate,
  isSelfConnection,
  otherUserId,
} from '../lib/helpers';
import { supabase } from '../lib/supabase';
import { getLang, t, useLang } from '../i18n';
import { Connection, Message, Profile } from '../lib/types';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import BottomSheet from './BottomSheet';
import Dialog from './Dialog';
import { BackIcon, TrashIcon, DownIcon, InfoIcon } from './icons';

const PAGE_SIZE = 40;
const LONG_PRESS_MS = 550;
const MINUTE_MS = 60_000;

interface SheetTarget {
  message: Message;
  mine: boolean;
  within24h: boolean;
}

export default function Chat({ connectionId }: { connectionId: string }) {
  const { user } = useAuth();
  useLang(); // re-render relative timestamps on language change

  const [conn, setConn] = useState<Connection | null>(null);
  const [peer, setPeer] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [deletedForMe, setDeletedForMe] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // message actions
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    'deleteEveryone' | 'deleteMe' | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);

  // scroll / read state
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const lastReadRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);
  const visibleMessagesRef = useRef<Message[]>([]);

  const me = user?.id ?? '';

  /* ----------------------------- data load ----------------------------- */

  useEffect(() => {
    if (!me) return;
    let active = true;
    setLoading(true);
    setValid(true);

    (async () => {
      const found = await getConnection(connectionId);
      if (!active) return;
      const isMine = found && (found.user_a === me || found.user_b === me);
      if (!found || !isMine) {
        setValid(false);
        setLoading(false);
        return;
      }
      setConn(found);
      setValid(true);

      const peerId = otherUserId(found, me);
      const profiles = await getProfiles([peerId, me]);
      if (active) {
        setPeer(isSelfConnection(found) ? profiles[me] ?? null : profiles[peerId] ?? null);
      }

      const { messages: page, hasMore: more } = await getMessagesPage(
        connectionId,
        undefined,
        undefined,
        PAGE_SIZE,
      );
      const deletions = await loadDeletionsForUser(me);
      if (active) {
        setMessages(page);
        setHasMore(more);
        setDeletedForMe(deletions.messages);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      flushReadState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, me]);

  /* ------------------------------ realtime ------------------------------ */

  useEffect(() => {
    if (!supabase || !valid) return;
    const client = supabase;
    const channel = client
      .channel(`chat-${connectionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `connection_id=eq.${connectionId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg].sort((a, b) =>
              a.created_at === b.created_at
                ? a.id.localeCompare(b.id)
                : a.created_at.localeCompare(b.created_at),
            );
          });
          // Refresh the "new messages below" count without waiting for a scroll.
          requestAnimationFrame(() => {
            if (!atBottomRef.current) computeUnreadBelow();
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `connection_id=eq.${connectionId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id)
              ? prev.map((m) => (m.id === msg.id ? msg : m))
              : prev,
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'connections',
          filter: `id=eq.${connectionId}`,
        },
        (payload) => {
          const row = payload.new as Connection | null;
          if (row) setConn(row);
          else setValid(false);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          const row = payload.new as Profile;
          if (peer && row.id === peer.id) setPeer(row);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_deletions' },
        (payload) => {
          const row = payload.new as { user_id?: string; message_id?: string };
          if (row.user_id === me && row.message_id) {
            setDeletedForMe((prev) => new Set(prev).add(row.message_id!));
          }
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, valid, peer]);

  /* --------------------------- scroll / read --------------------------- */

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!smooth) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const start = el.scrollTop;
    const target = el.scrollHeight - el.clientHeight;
    const distance = target - start;
    if (distance <= 0) return;
    const duration = Math.min(650, 200 + distance * 0.12);
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      el.scrollTop = start + distance * ease(p);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const computeUnreadBelow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const list = Array.from(el.querySelectorAll('.message, .system-line'));
    const containerBottom = el.getBoundingClientRect().bottom;
    let lastVisible = -1;
    for (let i = 0; i < list.length; i++) {
      const node = list[i] as HTMLElement;
      if (node.getBoundingClientRect().top < containerBottom) lastVisible = i;
      else break;
    }
    const below = list.length - 1 - lastVisible;
    setUnreadBelow(Math.max(0, below));
    // Progressive read state: the newest visible message counts as read.
    if (lastVisible >= 0) {
      const msg = visibleMessagesRef.current[lastVisible];
      if (msg) lastReadRef.current = msg.created_at;
    }
  }, []);

  const persistRead = useCallback(() => {
    if (!me || !conn) return;
    if (lastReadRef.current) {
      saveReadState(me, conn.id, lastReadRef.current);
    }
  }, [me, conn]);

  const flushReadState = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    persistRead();
  }, [persistRead]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance < 120;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) {
      const last = messages[messages.length - 1];
      if (last) lastReadRef.current = last.created_at;
      setUnreadBelow(0);
    } else {
      computeUnreadBelow();
    }
    // Persist read state at most every ~1.5 s.
    if (saveTimerRef.current === null) {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persistRead();
      }, 1500);
    }
    // Pagination: approaching the top loads older messages.
    if (el.scrollTop < 160 && hasMore && !loadingOlder) {
      loadOlder();
    }
  }

  async function loadOlder() {
    if (loadingOlderRef.current || !hasMore || !conn) return;
    const first = messages[0];
    if (!first) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const { messages: older, hasMore: more } = await getMessagesPage(
      conn.id,
      first.created_at,
      first.id,
      PAGE_SIZE,
    );
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    pendingDeltaRef.current = prevHeight;
    setMessages((prev) => [...older, ...prev]);
    setHasMore(more);
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingDeltaRef.current > 0) {
      el.scrollTop += el.scrollHeight - pendingDeltaRef.current;
      pendingDeltaRef.current = 0;
      setLoadingOlder(false);
      loadingOlderRef.current = false;
    }
  }, [messages]);

  // Stick to the bottom when new messages arrive while already at the bottom.
  useEffect(() => {
    if (atBottomRef.current && messages.length > 0) {
      scrollToBottom(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Initial load: open at the bottom.
  useEffect(() => {
    if (!loading && valid && messages.length > 0) {
      scrollToBottom(false);
      const last = messages[messages.length - 1];
      if (last) lastReadRef.current = last.created_at;
      persistRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    return () => {
      flushReadState();
    };
  }, [flushReadState]);

  /* ------------------------------ actions ------------------------------ */

  async function handleSend(text: string) {
    if (!conn) return;
    setError(null);
    const { message, error: err } = await sendMessage(conn.id, me, text);
    if (err) {
      setError(err);
      return;
    }
    if (message) {
      setMessages((prev) =>
        prev.some((m) => m.id === message.id)
          ? prev
          : [...prev, message].sort((a, b) =>
              a.created_at === b.created_at
                ? a.id.localeCompare(b.id)
                : a.created_at.localeCompare(b.created_at),
            ),
      );
    }
  }

  async function handleAccept() {
    if (!conn) return;
    setBusyId(conn.id);
    setError(null);
    const err = await acceptConnection(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else setConn({ ...conn, status: 'accepted' });
  }

  async function handleDecline() {
    if (!conn) return;
    setBusyId(conn.id);
    setError(null);
    const err = await declineConnection(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else setConn({ ...conn, status: 'declined' });
  }

  async function handleCancelRequest() {
    if (!conn) return;
    setBusyId(conn.id);
    setError(null);
    const err = await cancelConnectionRequest(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else navigate('#/');
  }

  async function handleRequestAgain() {
    if (!conn || !peer) return;
    setBusyId(conn.id);
    setError(null);
    const err = await sendConnectionRequest(me, peer.id);
    setBusyId(null);
    if (err) setError(err);
    else {
      const fresh = await getConnection(conn.id);
      if (fresh) setConn(fresh);
    }
  }

  async function handleDeleteEveryone() {
    if (!sheetTarget) return;
    setActionBusy(true);
    setError(null);
    const err = await deleteMessageForEveryone(sheetTarget.message.id);
    setActionBusy(false);
    setConfirmAction(null);
    if (err) {
      setError(err);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === sheetTarget.message.id
          ? { ...m, deleted_at: new Date().toISOString(), ciphertext: '' }
          : m,
      ),
    );
  }

  async function handleDeleteForMe() {
    if (!sheetTarget) return;
    setActionBusy(true);
    setError(null);
    const err = await deleteMessageForMe(me, sheetTarget.message.id);
    setActionBusy(false);
    setConfirmAction(null);
    if (err) {
      setError(err);
      return;
    }
    setDeletedForMe((prev) => new Set(prev).add(sheetTarget.message.id));
  }

  async function handleCopy() {
    if (!sheetTarget) return;
    const text = sheetTarget.message.ciphertext;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers without async clipboard.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  async function handleDeleteChat() {
    if (!conn) return;
    setActionBusy(true);
    setError(null);
    const err = await deleteChatForMe(me, conn.id);
    setActionBusy(false);
    setChatMenuOpen(false);
    if (err) {
      setError(err);
      return;
    }
    navigate('#/');
  }

  /* ------------------------------ derived ------------------------------ */

  const status = conn ? effectiveStatus(conn) : 'accepted';
  const isIncoming = status === 'pending' && conn?.user_b === me;
  const isOutgoing = status === 'pending' && conn?.user_a === me;
  const canChat = status === 'accepted';
  const self = conn ? isSelfConnection(conn) : false;
  const peerUsername = peer?.username ?? '';

  const visibleMessages = useMemo(
    () => messages.filter((m) => !deletedForMe.has(m.id)),
    [messages, deletedForMe],
  );

  // Keep the DOM-index mapping in sync with the rendered message list.
  useEffect(() => {
    visibleMessagesRef.current = visibleMessages;
  }, [visibleMessages]);

  const grouped = useMemo(() => {
    return visibleMessages.map((m, i) => {
      const prev = visibleMessages[i - 1];
      const next = visibleMessages[i + 1];
      const sameMinute = (a: Message, b: Message) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() <
        MINUTE_MS;
      const groupPrev =
        !!prev &&
        prev.sender_id === m.sender_id &&
        !prev.deleted_at &&
        !m.deleted_at &&
        m.kind !== 'name_change' &&
        sameMinute(prev, m);
      const groupNext =
        !!next &&
        next.sender_id === m.sender_id &&
        !next.deleted_at &&
        !m.deleted_at &&
        m.kind !== 'name_change' &&
        sameMinute(m, next);
      const group: 'alone' | 'first' | 'middle' | 'last' = !groupPrev && !groupNext
        ? 'alone'
        : groupPrev && groupNext
          ? 'middle'
          : groupPrev
            ? 'last'
            : 'first';
      return { message: m, group };
    });
  }, [visibleMessages]);

  const declined = status === 'declined';
  const expiresAt =
    declined && conn?.created_at
      ? formatDate(
          new Date(
            new Date(conn.created_at).getTime() + 14 * 24 * 60 * 60 * 1000,
          ),
          getLang(),
        )
      : null;

  const sheetItems = sheetTarget
    ? [
        {
          key: 'copy',
          label: t('message.copy'),
          onSelect: handleCopy,
        },
        ...(sheetTarget.mine && sheetTarget.within24h && !sheetTarget.message.deleted_at
          ? [
              {
                key: 'everyone',
                label: t('message.deleteForEveryone'),
                danger: true,
                onSelect: () => setConfirmAction('deleteEveryone'),
              },
            ]
          : []),
        ...(!sheetTarget.message.deleted_at
          ? [
              {
                key: 'me',
                label: t('message.deleteForMe'),
                danger: true,
                onSelect: () => setConfirmAction('deleteMe'),
              },
            ]
          : []),
      ]
    : [];

  /* ------------------------------- render ------------------------------- */

  return (
    <main className="chat-screen">
      <header className="chat-header">
        <button
          type="button"
          className="icon-button"
          onClick={() => navigate('#/')}
          aria-label={t('chat.backLabel')}
        >
          <BackIcon size={22} />
        </button>
        <div className="chat-peer">
          <div className="chat-peer-name">
            {self ? t('settingsScreen.myNotes') : displayName(peer)}
          </div>
          <div className="chat-peer-username">@{peerUsername || '…'}</div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setChatMenuOpen(true)}
          aria-label={t('chat.deleteChatForMe')}
        >
          <TrashIcon size={19} />
        </button>
      </header>

      {!canChat && !loading && valid && (
        <div className={`request-banner ${status}`}>
          {isIncoming && (
            <>
              <div className="request-banner-line">
                <InfoIcon
                  size={15}
                  className="request-info-icon"
                  onClick={() => setInfoOpen((v) => !v)}
                />
                <span>
                  <strong>{t('connection.requestTitle')}</strong>
                </span>
                <span className="request-actions">
                  <button
                    type="button"
                    className="btn-small"
                    disabled={busyId === conn?.id}
                    onClick={handleAccept}
                  >
                    {t('connection.accept')}
                  </button>
                  <button
                    type="button"
                    className="btn-small ghost"
                    disabled={busyId === conn?.id}
                    onClick={handleDecline}
                  >
                    {t('connection.decline')}
                  </button>
                </span>
              </div>
              {infoOpen && <p className="request-info-text">{t('connection.requestInfo')}</p>}
            </>
          )}
          {isOutgoing && (
            <div className="request-banner-line">
              <span className="muted">{t('connection.requestSent')}</span>
              <button
                type="button"
                className="btn-small ghost"
                disabled={busyId === conn?.id}
                onClick={handleCancelRequest}
              >
                {t('connection.cancelRequest')}
              </button>
            </div>
          )}
          {declined && (
            <div className="request-banner-line">
              <span className="muted">
                {t('connection.requestDeclined')}
                {expiresAt ? ` · ${t('connection.requestDeclinedNote', { date: expiresAt })}` : ''}
              </span>
              {conn?.user_a === me && (
                <button
                  type="button"
                  className="btn-small"
                  disabled={busyId === conn?.id}
                  onClick={handleRequestAgain}
                >
                  {t('connection.requestAgain')}
                </button>
              )}
            </div>
          )}
          {status === 'expired' && (
            <div className="request-banner-line">
              <span className="muted">{t('connection.requestExpired')}</span>
              {conn?.user_a === me && (
                <button
                  type="button"
                  className="btn-small"
                  disabled={busyId === conn?.id}
                  onClick={handleRequestAgain}
                >
                  {t('connection.requestAgain')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="chat-loading">{t('loading')}</div>
      ) : !valid ? (
        <div className="chat-loading">{t('chat.unavailable')}</div>
      ) : (
        <>
          <section
            className="messages"
            ref={scrollRef}
            onScroll={handleScroll}
            aria-live="polite"
          >
            {loadingOlder && (
              <div className="chat-loading-older">{t('chat.loadingOlder')}</div>
            )}
            {visibleMessages.length === 0 && (
              <div className="chat-empty">{t('chat.noMessages')}</div>
            )}
            {grouped.map(({ message, group }) => (
              <MessageBubble
                key={message.id}
                message={message}
                mine={message.sender_id === me}
                peerUsername={peerUsername}
                group={group}
                focusable={canChat && !message.deleted_at}
                onLongPress={(m) => {
                  const within24h =
                    Date.now() - new Date(m.created_at).getTime() < 24 * 60 * 60 * 1000;
                  setSheetTarget({
                    message: m,
                    mine: m.sender_id === me,
                    within24h,
                  });
                }}
              />
            ))}
          </section>

          {error && (
            <p className="error chat-error" role="alert">
              {error}
            </p>
          )}

          {!canChat && (
            <div className="composer-disabled" role="note">
              {isIncoming
                ? t('connection.requestInfo')
                : declined
                  ? t('connection.requestDeclined')
                  : status === 'expired'
                    ? t('connection.requestExpired')
                    : t('connection.requestSent')}
            </div>
          )}

          <MessageComposer onSend={handleSend} disabled={!canChat} />
        </>
      )}

      {canChat && !atBottom && (
        <button
          type="button"
          className="scroll-down"
          onClick={() => scrollToBottom(true)}
          aria-label={t('unread.down')}
        >
          <DownIcon size={18} />
          {unreadBelow > 0 && <span className="scroll-down-count">{unreadBelow}</span>}
        </button>
      )}

      {chatMenuOpen && (
        <Dialog
          title={t('chat.deleteChatConfirmTitle')}
          text={t('chat.deleteChatConfirmText')}
          confirmLabel={t('chat.deleteChatForMe')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleDeleteChat}
          onCancel={() => setChatMenuOpen(false)}
        />
      )}

      {sheetTarget && (
        <BottomSheet
          cancelLabel={t('cancel')}
          onClose={() => setSheetTarget(null)}
          items={sheetItems}
        />
      )}

      {confirmAction === 'deleteEveryone' && sheetTarget && (
        <Dialog
          title={t('message.deleteForEveryoneTitle')}
          text={t('message.deleteForEveryoneText')}
          confirmLabel={t('message.deleteForEveryone')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleDeleteEveryone}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction === 'deleteMe' && sheetTarget && (
        <Dialog
          title={t('message.deleteForMeTitle')}
          text={t('message.deleteForMeText')}
          confirmLabel={t('message.deleteForMe')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleDeleteForMe}
          onCancel={() => setConfirmAction(null)}
        />
      )}

    </main>
  );
}
