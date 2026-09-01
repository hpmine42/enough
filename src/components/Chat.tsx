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
  blockUser,
  cancelConnectionRequest,
  declineConnection,
  deleteChatForMe,
  deleteMessageForEveryone,
  deleteMessageForMe,
  getBlockState,
  getConnection,
  getMessagesPage,
  getProfiles,
  isHiddenByChatDeletion,
  loadDeletionsForUser,
  removeMyNotes,
  saveReadState,
  sendConnectionRequest,
  sendMessage,
  unblockUser,
} from '../lib/api';
import { advanceReadPosition, compareMessagesAsc, displayName, effectiveStatus, formatDate, isSelfConnection, otherUserId } from '../lib/helpers';
import { initialAnchorAction } from '../lib/chatScroll';
import { supabase } from '../lib/supabase';
import { prefersReducedMotion } from '../lib/theme';
import { getLang, t, useLang } from '../i18n';
import { BlockState, Connection, Message, Profile } from '../lib/types';
import { useE2EE } from '../context/E2EEContext';
import { prepareSend, decryptForDisplay, isEnvelope } from '../lib/e2ee/message-flow';
import { cachePlaintext, getCachedPlaintext } from '../lib/e2ee/message-cache';
import { isCryptoError } from '../lib/crypto/errors';
import Avatar from './Avatar';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import BottomSheet from './BottomSheet';
import Dialog from './Dialog';
import ThemeButton from './ThemeButton';
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
  const { manager } = useE2EE();
  useLang(); // re-render relative timestamps on language change

  const [conn, setConn] = useState<Connection | null>(null);
  const [peer, setPeer] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [deletedForMe, setDeletedForMe] = useState<Set<string>>(new Set());
  const [hiddenUntil, setHiddenUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // message actions
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    'deleteEveryone' | 'deleteMe' | null
  >(null);
  // The bottom sheet closes before its selected callback runs. Keep the
  // destructive action's target separately so the confirmation dialog can
  // open immediately without losing the selected message.
  const [confirmTarget, setConfirmTarget] = useState<SheetTarget | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [deleteChatOpen, setDeleteChatOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [blockState, setBlockState] = useState<BlockState>('none');

  // E2EE display state: resolved plaintext per message, and permanently
  // undecryptable messages. Resolved plaintext comes from the local cache, a
  // legacy row, My Notes, or a real decrypt — never invented.
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [undecryptable, setUndecryptable] = useState<Set<string>>(new Set());
  // Ids for which a real engine decrypt has been attempted (the ratchet
  // advances on each attempt, so each message is decrypted at most once).
  const decryptedRef = useRef<Set<string>>(new Set());
  // Ids with a final display outcome (plaintext resolved or permanently
  // undecryptable). Prevents reprocessing on every render.
  const resolvedRef = useRef<Set<string>>(new Set());

  // scroll / read state
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [newSinceUp, setNewSinceUp] = useState(0);
  const lastReadRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingDeltaRef = useRef(0);
  const visibleMessagesRef = useRef<Message[]>([]);
  const initialAnchorRef = useRef({
    pending: true,
    userHasScrolled: false,
    readPersisted: false,
  });
  // Newest message timestamp known to this chat session (loaded or realtime).
  const newestKnownRef = useRef<string | null>(null);

  const me = user?.id ?? '';

  /* ----------------------------- data load ----------------------------- */

  useEffect(() => {
    if (!me) return;
    let active = true;
    // The monotonic read position is per chat session: reset it when the
    // component is reused for another connection (the previous session was
    // already flushed by this effect's cleanup).
    lastReadRef.current = null;
    newestKnownRef.current = null;
    initialAnchorRef.current = {
      pending: true,
      userHasScrolled: false,
      readPersisted: false,
    };
    atBottomRef.current = true;
    setAtBottom(true);
    setLoading(true);
    setValid(true);

    (async () => {
      setBlockState('none');
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
      const profilesResult = await getProfiles([peerId, me]);
      if (profilesResult.error) {
        if (active) {
          setLoadError(profilesResult.error);
          setLoading(false);
        }
        return;
      }
      const profiles = profilesResult.data;
      if (active) {
        setPeer(isSelfConnection(found) ? profiles[me] ?? null : profiles[peerId] ?? null);
      }
      if (!isSelfConnection(found)) {
        const state = await getBlockState(me, peerId);
        if (active) setBlockState(state);
      }

      const deletions = await loadDeletionsForUser(me);
      const until = deletions.chatUntil.get(connectionId) ?? null;
      const pageResult = await getMessagesPage(
        connectionId,
        undefined,
        undefined,
        PAGE_SIZE,
        until,
      );
      if (pageResult.error) {
        if (active) {
          setLoadError(pageResult.error);
          setLoading(false);
        }
        return;
      }
      if (active) {
        setHiddenUntil(until);
        setMessages(pageResult.messages);
        setHasMore(pageResult.hasMore);
        setDeletedForMe(deletions.messages);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      flushReadState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, me, reloadKey]);

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
          if (isHiddenByChatDeletion(msg.created_at, hiddenUntil)) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            if (!atBottomRef.current) {
              setNewSinceUp((c) => c + 1);
            }
            return [...prev, msg].sort(compareMessagesAsc);
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
  }, [connectionId, valid, peer, hiddenUntil, me]);

  /* Block state follows changes from the other device in real time. */
  useEffect(() => {
    if (!supabase || !valid || !conn || !me) return;
    const peerId = otherUserId(conn, me);
    if (peerId === me) return;
    const client = supabase;
    const refresh = () => {
      getBlockState(me, peerId).then(setBlockState);
    };
    // Scope the block-state channel to the exact me↔peer pair (audit P2-5).
    // Realtime filters combine comma-separated conditions with AND and do not
    // support OR, so two pair filters replace the old over-broad per-peer
    // filters that also delivered blocks between the peer and third users.
    const channel = client
      .channel(`chat-blocks-${connectionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_blocks',
          filter: `blocker_id=eq.${me},blocked_id=eq.${peerId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_blocks',
          filter: `blocker_id=eq.${peerId},blocked_id=eq.${me}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [connectionId, valid, conn, me]);

  /* Decrypt message bodies for display (load + realtime share one path).
     Plaintext is resolved from the local cache, a legacy row, My Notes, or a
     real decrypt — never invented. A real engine decrypt runs at most once per
     message (the ratchet advances on each attempt). */
  useEffect(() => {
    if (!conn) return;
    const isSelf = isSelfConnection(conn);
    let active = true;
    void (async () => {
      for (const m of messages) {
        if (!active) return;
        if (m.deleted_at || (m.kind && m.kind !== 'text')) continue;
        if (resolvedRef.current.has(m.id)) continue;
        const cached = await getCachedPlaintext(me, m.id);
        const needsDecrypt =
          !cached && !isSelf && isEnvelope(m.ciphertext) && m.sender_id !== me;
        if (needsDecrypt) {
          if (!manager) continue; // not ready yet; retried when the manager arrives
          if (decryptedRef.current.has(m.id)) continue;
          decryptedRef.current.add(m.id);
        }
        try {
          const { plaintext } = await decryptForDisplay({
            e2ee: manager,
            isSelf,
            me,
            message: m,
            connectionId: conn.id,
          });
          if (!active) return;
          resolvedRef.current.add(m.id);
          if (plaintext !== null) setPlain((p) => ({ ...p, [m.id]: plaintext }));
          else setUndecryptable((s) => new Set(s).add(m.id));
        } catch {
          if (!active) return;
          resolvedRef.current.add(m.id);
          setUndecryptable((s) => new Set(s).add(m.id));
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, manager, conn, me]);

  // Reset display state when switching conversations.
  useEffect(() => {
    resolvedRef.current = new Set();
    decryptedRef.current = new Set();
    setPlain({});
    setUndecryptable(new Set());
  }, [connectionId]);

  /* --------------------------- scroll / read --------------------------- */

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    // The rAF animation below is JS-driven, so the CSS reduced-motion block
    // does not cover it: reduced-motion users get an instant jump instead.
    if (!smooth || prefersReducedMotion()) {
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
    // The read position is monotonic (R2) — scrolling up never moves it back.
    if (lastVisible >= 0) {
      const msg = visibleMessagesRef.current[lastVisible];
      if (msg) {
        lastReadRef.current = advanceReadPosition(
          lastReadRef.current,
          msg.created_at,
        );
      }
    }
  }, []);

  const persistRead = useCallback(() => {
    if (!me || !conn) return;
    if (lastReadRef.current) {
      saveReadState(me, conn.id, lastReadRef.current);
    }
  }, [me, conn]);

  // On leaving the chat, everything that was present in this chat session
  // counts as read — including messages that arrived (and were rendered)
  // while the user was scrolled up. Only messages inserted after this flush
  // may create unread on Home (R2).
  const flushReadState = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const newest = newestKnownRef.current;
    if (newest) {
      lastReadRef.current = advanceReadPosition(lastReadRef.current, newest);
    }
    persistRead();
  }, [persistRead]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance < 120;
    const wasBottom = atBottomRef.current;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) {
      setNewSinceUp(0);
      const last = messages[messages.length - 1];
      if (last) {
        lastReadRef.current = advanceReadPosition(
          lastReadRef.current,
          last.created_at,
        );
      }
      setUnreadBelow(0);
    } else {
      if (wasBottom) {
        setNewSinceUp(0);
      }
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
    const result = await getMessagesPage(
      conn.id,
      first.created_at,
      first.id,
      PAGE_SIZE,
      hiddenUntil,
    );
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    pendingDeltaRef.current = prevHeight;
    if (result.error) {
      // Pagination failure is non-fatal: keep existing messages visible
      // and surface the error in the chat error bar.
      setError(result.error);
      setLoadingOlder(false);
      loadingOlderRef.current = false;
      return;
    }
    setMessages((prev) => [...result.messages, ...prev]);
    setHasMore(result.hasMore);
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

  // Initial anchoring runs before paint and keeps ownership while asynchronous
  // display plaintext expands the rendered bubbles. Explicit user input ends
  // that ownership so a person scrolling upward is never pulled back down.
  useLayoutEffect(() => {
    if (loading || !valid || messages.length === 0) return;
    const unresolvedMessages = messages.reduce((count, message) => {
      const isRendered =
        !deletedForMe.has(message.id) &&
        !isHiddenByChatDeletion(message.created_at, hiddenUntil);
      const needsDisplayResolution =
        isRendered &&
        !message.deleted_at &&
        (!message.kind || message.kind === 'text');
      return needsDisplayResolution && !resolvedRef.current.has(message.id)
        ? count + 1
        : count;
    }, 0);
    const action = initialAnchorAction({
      pending: initialAnchorRef.current.pending,
      userHasScrolled: initialAnchorRef.current.userHasScrolled,
      unresolvedMessages,
    });
    if (action === 'none') return;

    scrollToBottom(false);
    if (!initialAnchorRef.current.readPersisted) {
      const last = messages[messages.length - 1];
      if (last) {
        lastReadRef.current = advanceReadPosition(
          lastReadRef.current,
          last.created_at,
        );
      }
      persistRead();
      initialAnchorRef.current.readPersisted = true;
    }
    if (action === 'anchor-and-finish') {
      initialAnchorRef.current.pending = false;
    }
  }, [
    loading,
    valid,
    messages,
    deletedForMe,
    hiddenUntil,
    plain,
    undecryptable,
    persistRead,
    scrollToBottom,
  ]);

  // Preserve the established realtime behavior after initial display
  // settlement: new messages stick only while the viewport is at the bottom.
  useEffect(() => {
    if (
      !initialAnchorRef.current.pending &&
      atBottomRef.current &&
      messages.length > 0
    ) {
      scrollToBottom(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    return () => {
      flushReadState();
    };
  }, [flushReadState]);

  /* ------------------------------ actions ------------------------------ */

  async function handleSend(text: string) {
    if (!conn || blocked || !text) return;
    setError(null);
    const peerId = self ? me : otherUserId(conn, me);
    // `text` is the single sanitized plaintext value produced by
    // MessageComposer immediately before this send path. From here on it is
    // treated as DATA only: encrypt it for peers, keep it plaintext only for
    // My Notes, and never sanitize the resulting ciphertext.
    let ciphertext: string;
    try {
      ciphertext = await prepareSend({
        e2ee: manager,
        isSelf: self,
        peerUserId: peerId,
        connectionId: conn.id,
        plaintext: text,
      });
    } catch (e) {
      setError(
        isCryptoError(e) && e.code === 'NOT_AVAILABLE'
          ? t('chat.e2eeUnavailable')
          : t('chat.e2eeFailed'),
      );
      return; // fail-closed: no insert, no plaintext to Supabase.
    }
    const { message, error: err } = await sendMessage(conn.id, me, ciphertext);
    if (err) {
      setError(err);
      return;
    }
    if (message) {
      await cachePlaintext(me, message.id, text);
      setPlain((prev) => ({ ...prev, [message.id]: text }));
      setMessages((prev) =>
        prev.some((m) => m.id === message.id)
          ? prev
          : [...prev, message].sort(compareMessagesAsc),
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

  async function handleDecline(blockPeer = false) {
    if (!conn) return;
    setBusyId(conn.id);
    setError(null);
    const err = await declineConnection(conn.id, blockPeer);
    setBusyId(null);
    setDeclineOpen(false);
    if (err) setError(err);
    else {
      setConn({ ...conn, status: 'declined' });
      if (blockPeer) setBlockState('blockedByMe');
    }
  }

  async function handleBlockUser() {
    if (!conn || !peer) return;
    setActionBusy(true);
    setError(null);
    const err = await blockUser(me, peer.id);
    setActionBusy(false);
    setBlockConfirmOpen(false);
    if (err) {
      setError(err);
      return;
    }
    setBlockState('blockedByMe');
  }

  async function handleUnblock() {
    if (!conn || !peer) return;
    setBusyId(conn.id);
    setError(null);
    const err = await unblockUser(me, peer.id);
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    setBlockState('none');
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
    const prevConn = conn;
    setBusyId(conn.id);
    setError(null);
    // Immediate visual feedback: optimistically transition state to pending outgoing request.
    setConn({
      ...conn,
      user_a: me,
      user_b: peer.id,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    const err = await sendConnectionRequest(me, peer.id);
    setBusyId(null);
    if (err) {
      setConn(prevConn);
      setError(err);
    } else {
      const fresh = await getConnection(conn.id);
      if (fresh) setConn(fresh);
    }
  }

  async function handleDeleteEveryone() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setActionBusy(true);
    setError(null);
    const err = await deleteMessageForEveryone(target.message.id);
    setActionBusy(false);
    setConfirmAction(null);
    setConfirmTarget(null);
    if (err) {
      setError(err);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.message.id
          ? { ...m, deleted_at: new Date().toISOString(), ciphertext: '' }
          : m,
      ),
    );
  }

  async function handleDeleteForMe() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setActionBusy(true);
    setError(null);
    const err = await deleteMessageForMe(me, target.message.id);
    setActionBusy(false);
    setConfirmAction(null);
    setConfirmTarget(null);
    if (err) {
      setError(err);
      return;
    }
    setDeletedForMe((prev) => new Set(prev).add(target.message.id));
  }

  async function handleCopy() {
    if (!sheetTarget) return;
    const text = plain[sheetTarget.message.id] ?? '';
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
    setDeleteChatOpen(false);
    if (err) {
      setError(err);
      return;
    }
    navigate('#/');
  }

  /* My Notes trash: clear all notes and disable My Notes in one step.
     remove_my_notes() deletes the self-connection including its messages, so
     the notes chat disappears from Home immediately on return. */
  async function handleClearMyNotes() {
    if (!conn) return;
    setActionBusy(true);
    setError(null);
    const err = await removeMyNotes(me, conn.id);
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
  const ended = status === 'ended';
  const self = conn ? isSelfConnection(conn) : false;
  const blocked = !self && blockState !== 'none';
  const peerUsername = peer?.username ?? '';

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          !deletedForMe.has(m.id) &&
          !isHiddenByChatDeletion(m.created_at, hiddenUntil),
      ),
    [messages, deletedForMe, hiddenUntil],
  );

  // Keep the DOM-index mapping in sync with the rendered message list.
  useEffect(() => {
    visibleMessagesRef.current = visibleMessages;
    const newest = visibleMessages[visibleMessages.length - 1];
    if (newest) {
      newestKnownRef.current = advanceReadPosition(
        newestKnownRef.current,
        newest.created_at,
      );
    }
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
                onSelect: () => {
                  setConfirmTarget(sheetTarget);
                  setConfirmAction('deleteEveryone');
                },
              },
            ]
          : []),
        ...(!sheetTarget.message.deleted_at
          ? [
              {
                key: 'me',
                label: t('message.deleteForMe'),
                danger: true,
                onSelect: () => {
                  setConfirmTarget(sheetTarget);
                  setConfirmAction('deleteMe');
                },
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
        <Avatar
          name={self ? t('settingsScreen.myNotes') : ended ? t('chat.deletedAccount') : displayName(peer)}
          size={36}
        />
        <div className="chat-peer">
          <div className="chat-peer-name">
            {self
              ? t('settingsScreen.myNotes')
              : ended
                ? t('chat.deletedAccount')
                : displayName(peer)}
          </div>
          <div className="chat-peer-username">
            {ended ? '' : `@${peerUsername || '…'}`}
          </div>
        </div>
        <ThemeButton />
        <button
          type="button"
          className="icon-button"
          onClick={() => setChatMenuOpen(true)}
          aria-label={
            self ? t('chat.myNotesClearTitle') : t('chat.deleteChatForMe')
          }
        >
          <TrashIcon size={19} />
        </button>
      </header>

      {!canChat && !ended && !loading && valid && (
        <div className={`request-banner ${status}`}>
          {isIncoming && (
            <>
              <div className="request-banner-line">
                {/* Real button (not a clickable SVG): the info toggle must be
                    reachable by keyboard and screen readers. */}
                <button
                  type="button"
                  className="request-info-button"
                  aria-label={t('connection.requestInfoLabel')}
                  aria-expanded={infoOpen}
                  onClick={() => setInfoOpen((v) => !v)}
                >
                  <InfoIcon size={15} />
                </button>
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
                    {busyId === conn?.id ? t('loading') : t('connection.accept')}
                  </button>
                  <button
                    type="button"
                    className="btn-small ghost"
                    disabled={busyId === conn?.id}
                    onClick={() => setDeclineOpen(true)}
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
                {busyId === conn?.id ? t('loading') : t('connection.cancelRequest')}
              </button>
            </div>
          )}
          {declined && (
            <div className="request-banner-line">
              <span className="muted">
                {t('connection.requestDeclined')}
                {expiresAt ? ` · ${t('connection.requestDeclinedNote', { date: expiresAt })}` : ''}
              </span>
              {/* Either side may re-request: the original requester restores
                  their attempt, the recipient reuses the dead row (the RPC
                  keeps the one-row-per-pair model intact). */}
              {blockState === 'blockedByThem' ? (
                <span className="muted">{t('block.byThem')}</span>
              ) : blockState === 'blockedByMe' ? (
                <span className="muted">{t('block.byYou')}</span>
              ) : (
                <button
                  type="button"
                  className="btn-small"
                  disabled={busyId === conn?.id}
                  onClick={handleRequestAgain}
                >
                  {busyId === conn?.id ? t('loading') : t('connection.requestAgain')}
                </button>
              )}
            </div>
          )}
          {status === 'expired' && (
            <div className="request-banner-line">
              <span className="muted">{t('connection.requestExpired')}</span>
              {blockState === 'blockedByThem' ? (
                <span className="muted">{t('block.byThem')}</span>
              ) : blockState === 'blockedByMe' ? (
                <span className="muted">{t('block.byYou')}</span>
              ) : (
                <button
                  type="button"
                  className="btn-small"
                  disabled={busyId === conn?.id}
                  onClick={handleRequestAgain}
                >
                  {busyId === conn?.id ? t('loading') : t('connection.requestAgain')}
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
      ) : loadError ? (
        <section className="chat-load-error">
          <div className="chat-empty" role="alert">
            {loadError}
          </div>
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
          >
            {t('errors.retry')}
          </button>
        </section>
      ) : (
        <>
          <section
            className="messages"
            ref={scrollRef}
            onScroll={handleScroll}
            onWheelCapture={() => {
              initialAnchorRef.current.userHasScrolled = true;
              initialAnchorRef.current.pending = false;
            }}
            onTouchMoveCapture={() => {
              initialAnchorRef.current.userHasScrolled = true;
              initialAnchorRef.current.pending = false;
            }}
            onPointerDownCapture={(event) => {
              // A pointer press on the scrollbar itself does not emit wheel or
              // touch events, so recognize that scroll intent separately.
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.target === event.currentTarget &&
                event.clientX >= bounds.right - 20
              ) {
                initialAnchorRef.current.userHasScrolled = true;
                initialAnchorRef.current.pending = false;
              }
            }}
            onKeyDownCapture={(event) => {
              if (
                ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(
                  event.key,
                )
              ) {
                initialAnchorRef.current.userHasScrolled = true;
                initialAnchorRef.current.pending = false;
              }
            }}
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
                text={
                  plain[message.id] ??
                  (undecryptable.has(message.id) ? t('chat.undecryptable') : '')
                }
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

          {blocked ? (
            <div className="composer-disabled blocked" role="note">
              <span>
                {blockState === 'blockedByMe'
                  ? t('block.blockedByYouChat')
                  : t('block.blockedByThemChat')}
              </span>
              {blockState === 'blockedByMe' && (
                <button
                  type="button"
                  className="btn-small"
                  disabled={busyId === conn?.id}
                  onClick={handleUnblock}
                >
                  {t('block.unblock')}
                </button>
              )}
            </div>
          ) : (
            !canChat && (
              <div className="composer-disabled" role="note">
                {ended
                  ? t('chat.deletedAccountNote')
                  : isIncoming
                    ? t('connection.requestInfo')
                    : declined
                      ? t('connection.requestDeclined')
                      : status === 'expired'
                        ? t('connection.requestExpired')
                        : t('connection.requestSent')}
              </div>
            )
          )}

          <MessageComposer onSend={handleSend} disabled={!canChat || blocked} />
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
          {newSinceUp > 0 && <span className="scroll-down-count">{newSinceUp}</span>}
        </button>
      )}

      {chatMenuOpen && (self ? (
        <Dialog
          title={t('chat.myNotesClearTitle')}
          text={t('chat.myNotesClearText')}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleClearMyNotes}
          onCancel={() => setChatMenuOpen(false)}
        />
      ) : (
        <BottomSheet
          title={peer ? displayName(peer) : undefined}
          cancelLabel={t('cancel')}
          onClose={() => setChatMenuOpen(false)}
          items={[
            ...(blockState === 'blockedByMe'
              ? [
                  {
                    key: 'unblock',
                    label: t('block.unblock'),
                    onSelect: () => {
                      void handleUnblock();
                    },
                  },
                ]
              : [
                  {
                    key: 'block',
                    label: t('block.blockUser'),
                    danger: true,
                    onSelect: () => setBlockConfirmOpen(true),
                  },
                ]),
            {
              key: 'delete',
              label: t('chat.deleteChatForMe'),
              danger: true,
              onSelect: () => setDeleteChatOpen(true),
            },
          ]}
        />
      ))}

      {deleteChatOpen && (
        <Dialog
          title={t('chat.deleteChatConfirmTitle')}
          text={t('chat.deleteChatConfirmText')}
          confirmLabel={t('chat.deleteChatForMe')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleDeleteChat}
          onCancel={() => setDeleteChatOpen(false)}
        />
      )}

      {blockConfirmOpen && peer && (
        <Dialog
          title={t('block.blockTitle', { username: peer.username ?? '' })}
          text={t('block.blockText')}
          confirmLabel={t('block.blockUser')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleBlockUser}
          onCancel={() => setBlockConfirmOpen(false)}
        />
      )}

      {sheetTarget && (
        <BottomSheet
          cancelLabel={t('cancel')}
          onClose={() => setSheetTarget(null)}
          items={sheetItems}
        />
      )}

      {confirmAction === 'deleteEveryone' && confirmTarget && (
        <Dialog
          title={t('message.deleteForEveryoneTitle')}
          text={t('message.deleteForEveryoneText')}
          confirmLabel={t('message.deleteForEveryone')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleDeleteEveryone}
          onCancel={() => {
            setConfirmAction(null);
            setConfirmTarget(null);
          }}
        />
      )}

      {confirmAction === 'deleteMe' && confirmTarget && (
        <Dialog
          title={t('message.deleteForMeTitle')}
          text={t('message.deleteForMeText')}
          confirmLabel={t('message.deleteForMe')}
          cancelLabel={t('cancel')}
          danger
          busy={actionBusy}
          onConfirm={handleDeleteForMe}
          onCancel={() => {
            setConfirmAction(null);
            setConfirmTarget(null);
          }}
        />
      )}

      {declineOpen && (
        <Dialog
          title={t('connection.declinedTitle')}
          text={t('connection.declinedText')}
          confirmLabel={t('connection.decline')}
          cancelLabel={t('cancel')}
          busy={busyId === conn?.id}
          onConfirm={() => handleDecline(false)}
          extraAction={{
            label: t('block.declineAndBlock'),
            onClick: () => handleDecline(true),
          }}
          onCancel={() => setDeclineOpen(false)}
        />
      )}

    </main>
  );
}
