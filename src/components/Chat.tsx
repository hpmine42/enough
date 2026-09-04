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
import {
  INITIAL_ANCHOR_MAX_WAIT_MS,
  INITIAL_ANCHOR_SETTLE_MS,
  anchorTailIds,
  isInitialAnchorSettled,
  isTailResolved,
  shouldAnchorInitial,
} from '../lib/chatScroll';
import { advanceReadPosition, compareMessagesAsc, displayName, effectiveStatus, formatDate, isSelfConnection, otherUserId } from '../lib/helpers';
import {
  applyMessageUpdate,
  captureRealtimeRow,
  createChatLifecycle,
  isRealtimeMessageRow,
  mergeIncomingMessage,
  mergeLoadedPage,
} from '../lib/chatRealtime';
import type { PendingRealtimeRow } from '../lib/chatRealtime';
import { supabase } from '../lib/supabase';
import { prefersReducedMotion } from '../lib/theme';
import { getLang, t, useLang } from '../i18n';
import { BlockState, Connection, Message, Profile } from '../lib/types';
import { useE2EE } from '../context/E2EEContext';
import { prepareSend, decryptForDisplay, isEnvelope } from '../lib/e2ee/message-flow';
import { cachePlaintext, getCachedPlaintext } from '../lib/e2ee/message-cache';
import {
  reportNetworkSuccess,
  shouldSkipNetwork,
  useConnectivity,
} from '../lib/connectivity';
import { loadChatSnapshot, saveChatSnapshot } from '../lib/offlineStore';
import { isCryptoError } from '../lib/crypto/errors';
import Avatar from './Avatar';
import MessageBubble from './MessageBubble';
import OfflineBanner from './OfflineBanner';
import MessageComposer from './MessageComposer';
import BottomSheet from './BottomSheet';
import ChatActionMenu from './ChatActionMenu';
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
  // True while the rendered conversation came from the local offline
  // snapshot rather than a fresh server read.
  const [fromCache, setFromCache] = useState(false);

  const connectivity = useConnectivity();
  // Two deliberately different connectivity tests are used in this component:
  //
  //   `shouldSkipNetwork()` — true ONLY when the browser reports no network.
  //     Used by the realtime subscriptions and by `persistRead`, i.e. the
  //     paths that should keep trying whenever an interface exists. The
  //     'unreachable' state (browser online, a request failed) deliberately
  //     does NOT suppress them, because an actual attempt is the only way
  //     that state can recover.
  //
  //   `offline` (= 'offline' OR 'unreachable') — used to disable server
  //     mutations and server-backed reads that are offered to the user:
  //     sending, pagination, the message/chat action menus. These must never
  //     be offered while they cannot safely succeed, and nothing is queued,
  //     so failing closed in both states is the correct behavior.
  const offline = connectivity !== 'online';

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
  // Which confirmation dialog of the shared chat action menu is open
  // (null = no dialog; the sheet may be open independently).
  const [chatActionConfirm, setChatActionConfirm] = useState<
    'block' | 'delete' | null
  >(null);
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
  // Initial anchoring (R1): the chat must open at the newest message even
  // though E2EE plaintext — and therefore the final bubble heights — resolves
  // asynchronously after the first render.
  const initialAnchorPendingRef = useRef(false);
  const initialAnchorStartRef = useRef(0);
  const tailResolvedAtRef = useRef<number | null>(null);
  const userScrolledRef = useRef(false);
  // Last scrollTop written by scrollToBottom, used to tell the scroll events
  // caused by our own anchoring apart from genuine user scrolling.
  const programmaticTopRef = useRef<number | null>(null);
  const visibleMessagesRef = useRef<Message[]>([]);
  // Newest message timestamp known to this chat session (loaded or realtime).
  const newestKnownRef = useRef<string | null>(null);
  // True while the chat loader is fetching a page. Realtime rows arriving in
  // that window are captured (not applied) and drained onto the page the
  // loader commits — a message landing mid-fetch must not be dropped by the
  // commit, and an update (e.g. a delete-for-everyone tombstone) must not be
  // applied and then clobbered by it either.
  const loadingRef = useRef(true);
  // Rows captured while a load was in flight (see `loadingRef`), tagged with
  // the event kind that delivered them so the drain reconciles INSERTs and
  // UPDATEs with their own steady-state semantics (audit F-02).
  const pendingRealtimeRef = useRef<PendingRealtimeRow[]>([]);
  // F-01: conversation lifecycle token. Advanced SYNCHRONOUSLY in the render
  // body when the `connectionId` prop changes, so an async continuation that
  // resolves between this render and the effect flush can never still see
  // the previous conversation's token. Every async message-state path
  // (send, pagination) captures `current()` before its first await and
  // re-checks `isCurrent()` after every await; a stale result is discarded
  // before it can enter the new conversation's state or reach the E2EE
  // decrypt path.
  const lifecycleRef = useRef(createChatLifecycle());
  const lifecycleConnectionRef = useRef(connectionId);
  if (lifecycleConnectionRef.current !== connectionId) {
    lifecycleConnectionRef.current = connectionId;
    lifecycleRef.current.advance();
  }

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
    // This load owns the realtime gate from now on (see `loadingRef`).
    loadingRef.current = true;
    setLoading(true);
    setValid(true);

    (async () => {
      setBlockState('none');
      if (shouldSkipNetwork()) {
        // Offline Read Mode: render the locally stored conversation without
        // issuing a single Supabase request. Nothing is fabricated — if there
        // is no snapshot for this conversation we say so.
        const snapshot = await loadChatSnapshot(me, connectionId);
        if (!active) return;
        if (!snapshot) {
          loadingRef.current = false;
          setValid(false);
          setLoading(false);
          return;
        }
        setConn(snapshot.connection);
        setPeer(snapshot.peer);
        setMessages(snapshot.messages);
        setHiddenUntil(snapshot.hiddenUntil);
        setDeletedForMe(new Set(snapshot.deletedForMe));
        // Older pages live on the server only: never paginate while offline.
        setHasMore(false);
        loadingRef.current = false;
        setFromCache(true);
        setValid(true);
        setLoading(false);
        return;
      }
      const found = await getConnection(connectionId);
      if (!active) return;
      const isMine = found && (found.user_a === me || found.user_b === me);
      if (!found || !isMine) {
        loadingRef.current = false;
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
          loadingRef.current = false;
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
          loadingRef.current = false;
          setLoadError(pageResult.error);
          setLoading(false);
        }
        return;
      }
      if (active) {
        setHiddenUntil(until);
        // Drain the rows captured while this page was being fetched (see
        // `loadingRef`): a realtime message that landed mid-fetch must not
        // be dropped by the commit, and an update captured mid-fetch (e.g. a
        // delete-for-everyone tombstone) must win over the pre-update row
        // this page was fetched with — never the other way round. The drain
        // reconciles each captured row with the same semantics its live
        // handler uses, so order, dedupe and scoping are identical to the
        // steady state. The gate flips synchronously with the drain, before
        // the commit: an event after the flip is applied normally (the
        // functional updater composes with the page commit); an event before
        // it was captured and is drained here.
        const drained = pendingRealtimeRef.current;
        pendingRealtimeRef.current = [];
        loadingRef.current = false;
        const committed = mergeLoadedPage(
          pageResult.messages,
          drained,
          connectionId,
          until,
        );
        setMessages(committed);
        setHasMore(pageResult.hasMore);
        setDeletedForMe(deletions.messages);
        setFromCache(false);
        setLoading(false);
        // The server answered, so this data is current: clear a previous
        // "unreachable" latch and refresh the offline snapshot of exactly
        // this conversation for exactly this account. The snapshot mirrors
        // the committed (drained) list, so the offline render matches what
        // was online.
        reportNetworkSuccess();
        const peerProfile = isSelfConnection(found)
          ? profiles[me] ?? null
          : profiles[peerId] ?? null;
        void saveChatSnapshot(me, connectionId, {
          connection: found,
          peer: peerProfile,
          messages: committed,
          hiddenUntil: until,
          deletedForMe: Array.from(deletions.messages),
        });
      }
    })();

    return () => {
      active = false;
      flushReadState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, me, reloadKey]);

  /* Reconnection: rerun the EXISTING load path (same effect, same queries,
     same realtime subscription) once connectivity returns. No separate
     synchronization system, and the fresh page replaces the cached one, so
     messages cannot be duplicated. */
  const wasOfflineRef = useRef(offline);
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = offline;
    if (wasOffline && !offline) setReloadKey((k) => k + 1);
  }, [offline]);

  /* ------------------------------ realtime ------------------------------ */

  useEffect(() => {
    if (!supabase || !valid) return;
    if (shouldSkipNetwork()) return;
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
          const row = payload.new as unknown;
          // A Realtime payload is not authorization: on top of the channel's
          // connection filter and RLS delivery, the row is re-scoped to the
          // open chat client-side (same client-side gate as the Home
          // bridge, src/lib/homeRealtime.ts).
          if (!isRealtimeMessageRow(row) || row.connection_id !== connectionId) {
            return;
          }
          // Rows behind the chat-deletion cutoff are not rendered.
          if (isHiddenByChatDeletion(row.created_at, hiddenUntil)) return;
          // A load is in flight: its page commit is about to replace the
          // list. Capture the row (deduped) and let the commit drain it —
          // no reload, no dropped message.
          if (loadingRef.current) {
            pendingRealtimeRef.current = captureRealtimeRow(
              pendingRealtimeRef.current,
              'INSERT',
              row,
            );
            return;
          }
          // Duplicate events (a replay, or our own send racing back from
          // another device) never mutate the list: fast path here, and the
          // merge below re-checks by id, so state stays correct either way.
          if (visibleMessagesRef.current.some((m) => m.id === row.id)) return;
          // Ciphertext-only incremental merge; the row is resolved for
          // display by the shared E2EE decrypt path (load and realtime use
          // one path — see the decrypt effect below).
          setMessages((prev) =>
            mergeIncomingMessage(prev, row, connectionId, hiddenUntil),
          );
          if (!atBottomRef.current) {
            setNewSinceUp((c) => c + 1);
          }
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
          const row = payload.new as unknown;
          if (!isRealtimeMessageRow(row) || row.connection_id !== connectionId) {
            return;
          }
          // E.g. a delete-for-everyone tombstone: replace in place only when
          // the row is already rendered.
          //
          // F-02: while a page load is in flight the list the page will
          // replace may not contain this row yet (or the commit is about to
          // clobber the update with the pre-update snapshot the page was
          // fetched with). Capture the update and let the loader drain it
          // onto the committed page — the tombstone then wins over the stale
          // loaded row instead of being overwritten by it.
          if (loadingRef.current) {
            pendingRealtimeRef.current = captureRealtimeRow(
              pendingRealtimeRef.current,
              'UPDATE',
              row,
            );
            return;
          }
          setMessages((prev) => applyMessageUpdate(prev, row, connectionId));
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
  }, [connectionId, valid, peer, hiddenUntil, me, offline]);

  /* Block state follows changes from the other device in real time. */
  useEffect(() => {
    if (!supabase || !valid || !conn || !me) return;
    if (shouldSkipNetwork()) return;
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
  }, [connectionId, valid, conn, me, offline]);

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

  // Reset display state when switching conversations. The lifecycle token
  // was already advanced synchronously in the render body above, so state
  // written by an async operation of the previous conversation is discarded
  // by its own `isCurrent` checks; this effect only clears the component's
  // own per-conversation state.
  useEffect(() => {
    resolvedRef.current = new Set();
    decryptedRef.current = new Set();
    // Captured rows belong to the previous conversation: dropping them is
    // safe (reopening that conversation re-loads its page from the server).
    pendingRealtimeRef.current = [];
    // A pagination request of the previous conversation is invalid now; the
    // stale resolve path resets the latch as well, and this is the fallback
    // so the new conversation never starts with a stuck "loading older" flag.
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    setPlain({});
    setUndecryptable(new Set());
    initialAnchorPendingRef.current = false;
    tailResolvedAtRef.current = null;
    userScrolledRef.current = false;
    programmaticTopRef.current = null;
  }, [connectionId]);

  /* --------------------------- scroll / read --------------------------- */

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    // The rAF animation below is JS-driven, so the CSS reduced-motion block
    // does not cover it: reduced-motion users get an instant jump instead.
    if (!smooth || prefersReducedMotion()) {
      el.scrollTop = el.scrollHeight;
      programmaticTopRef.current = el.scrollTop;
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
      programmaticTopRef.current = el.scrollTop;
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
    // Read state is server-authoritative. Offline it is neither written nor
    // queued — the position is simply re-derived after reconnection.
    if (shouldSkipNetwork()) return;
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
    // A genuine user scroll ends the initial anchoring phase. Scroll events
    // triggered by our own anchoring land on the position we just wrote and
    // must not latch (R1 risk: anchoring fighting the user).
    if (initialAnchorPendingRef.current) {
      const programmatic =
        programmaticTopRef.current !== null &&
        Math.abs(el.scrollTop - programmaticTopRef.current) < 2;
      if (!programmatic) {
        userScrolledRef.current = true;
        initialAnchorPendingRef.current = false;
      }
    }
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
    if (el.scrollTop < 160 && hasMore && !loadingOlder && !offline) {
      loadOlder();
    }
  }

  async function loadOlder() {
    if (loadingOlderRef.current || !hasMore || !conn) return;
    // Older pages exist on the server only; offline we never request them.
    if (offline) return;
    const first = messages[0];
    if (!first) return;
    // F-01: bind this request to the conversation it started in. If the user
    // switches chats while the page is in flight, the result (older messages
    // of conversation A) must never be prepended to conversation B's list.
    const token = lifecycleRef.current.current();
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const result = await getMessagesPage(
      conn.id,
      first.created_at,
      first.id,
      PAGE_SIZE,
      hiddenUntil,
    );
    if (!lifecycleRef.current.isCurrent(token)) {
      // Conversation changed: discard the stale page, release the shared
      // single-flight latch (the reset effect clears the visual flag). The
      // scroll anchors of the previous conversation are never touched.
      loadingOlderRef.current = false;
      return;
    }
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

  // Stick to the bottom when new messages arrive while already at the bottom.
  useEffect(() => {
    if (atBottomRef.current && messages.length > 0) {
      scrollToBottom(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Initial load: open at the bottom. The anchoring phase started here keeps
  // re-applying the bottom position until the rendered tail has resolved its
  // E2EE plaintext (see src/lib/chatScroll.ts).
  useEffect(() => {
    if (!loading && valid && messages.length > 0) {
      initialAnchorPendingRef.current = true;
      initialAnchorStartRef.current = Date.now();
      tailResolvedAtRef.current = null;
      userScrolledRef.current = false;
      programmaticTopRef.current = null;
      scrollToBottom(false);
      const last = messages[messages.length - 1];
      if (last) {
        lastReadRef.current = advanceReadPosition(
          lastReadRef.current,
          last.created_at,
        );
      }
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
    if (!conn || blocked || !text) return;
    // Offline sending is deliberately not implemented in this version and
    // nothing is queued: the composer is disabled, and this is the guard
    // behind it.
    if (offline) return;
    // F-01: bind this send to the conversation it started in. The send itself
    // (encrypt + server insert) is for the captured conversation and is not
    // cancelled by a switch — the row belongs there — but its result and any
    // error must never be written into a conversation the user switched to.
    const token = lifecycleRef.current.current();
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
      // A send that lost its conversation must not surface an error there.
      if (!lifecycleRef.current.isCurrent(token)) return;
      setError(
        isCryptoError(e) && e.code === 'NOT_AVAILABLE'
          ? t('chat.e2eeUnavailable')
          : t('chat.e2eeFailed'),
      );
      return; // fail-closed: no insert, no plaintext to Supabase.
    }
    if (!lifecycleRef.current.isCurrent(token)) return;
    const { message, error: err } = await sendMessage(conn.id, me, ciphertext);
    if (!lifecycleRef.current.isCurrent(token)) return;
    if (err) {
      setError(err);
      return;
    }
    if (message) {
      // The plaintext cache is keyed by message id, not by conversation, and
      // the message was genuinely sent: keep the local cache write even when
      // the conversation changed, so the sender can still display it there
      // later. Only React state of the CURRENT conversation is guarded.
      await cachePlaintext(me, message.id, text);
      if (!lifecycleRef.current.isCurrent(token)) return;
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
    setChatActionConfirm(null);
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
    if (err) {
      setBusyId(null);
      setError(err);
      return;
    }
    // Re-derive the relation from the database instead of assuming 'none':
    // with a mutual block, removing the caller's own side must still leave
    // the composer disabled while the peer's block ('blockedByThem') exists.
    setBusyId(null);
    setBlockState(await getBlockState(me, peer.id));
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
    setChatActionConfirm(null);
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

  // R1: keep the list anchored at the newest message while the initial
  // anchoring phase is active. Bubbles grow when their E2EE plaintext arrives,
  // so a single scroll at load time lands too high; re-anchoring in a layout
  // effect applies the correction before the browser paints.
  useLayoutEffect(() => {
    if (!initialAnchorPendingRef.current) return;
    // Pagination compensation owns the scroll position for this pass.
    if (pendingDeltaRef.current > 0) return;
    const tailIds = anchorTailIds(visibleMessages);
    const tailResolved = isTailResolved(
      tailIds,
      (id) => plain[id] !== undefined || undecryptable.has(id),
    );
    if (tailResolved && tailResolvedAtRef.current === null) {
      tailResolvedAtRef.current = Date.now();
    } else if (!tailResolved) {
      tailResolvedAtRef.current = null;
    }
    const now = Date.now();
    const state = {
      pending: true,
      userScrolled: userScrolledRef.current,
      hasMessages: visibleMessages.length > 0,
      tailResolved,
      elapsedMs: now - initialAnchorStartRef.current,
      sinceTailResolvedMs:
        tailResolvedAtRef.current === null ? null : now - tailResolvedAtRef.current,
    };
    if (shouldAnchorInitial(state)) scrollToBottom(false);
    if (isInitialAnchorSettled(state)) initialAnchorPendingRef.current = false;
  });

  // Safety net + settle pass: re-check anchoring on timers so the phase also
  // ends (and applies a last correction) without further renders.
  useEffect(() => {
    if (loading || !valid) return;
    const timers = [
      window.setTimeout(() => {
        if (initialAnchorPendingRef.current && !userScrolledRef.current) {
          scrollToBottom(false);
        }
      }, INITIAL_ANCHOR_SETTLE_MS),
      window.setTimeout(() => {
        if (initialAnchorPendingRef.current && !userScrolledRef.current) {
          scrollToBottom(false);
        }
        initialAnchorPendingRef.current = false;
      }, INITIAL_ANCHOR_MAX_WAIT_MS),
    ];
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, valid, connectionId]);

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
        ...(!offline && sheetTarget.mine && sheetTarget.within24h && !sheetTarget.message.deleted_at
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
        ...(!offline && !sheetTarget.message.deleted_at
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
          disabled={offline}
          title={offline ? t('offline.actionUnavailable') : undefined}
          onClick={() => {
            // Opening the menu always starts from the sheet view; a leftover
            // confirmation state (e.g. after a profile-load race) must not
            // re-appear on top of the freshly opened sheet.
            setChatActionConfirm(null);
            setChatMenuOpen(true);
          }}
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

      <OfflineBanner status={connectivity} />

      {loading ? (
        <div className="chat-loading">{t('loading')}</div>
      ) : !valid ? (
        <div className="chat-loading">
          {offline ? t('offline.noCachedChat') : t('chat.unavailable')}
        </div>
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
            aria-live="polite"
            // Distinguishes "offline + locally stored" from "online + current
            // server data". Never set while online.
            data-offline-cached={offline && fromCache ? 'true' : undefined}
          >
            {loadingOlder && (
              <div className="chat-loading-older">{t('chat.loadingOlder')}</div>
            )}
            {offline && fromCache && (
              <div className="chat-loading-older">{t('offline.olderUnavailable')}</div>
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

          {offline ? (
            <div className="composer-disabled" role="note">
              {t('offline.composerDisabled')}
            </div>
          ) : blocked ? (
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

          <MessageComposer
            onSend={handleSend}
            disabled={!canChat || blocked || offline}
          />
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

      {chatMenuOpen && self && (
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
      )}

      {/* The shared chat action menu (block/unblock + delete chat for me) —
          the same component the Home overview opens on long-press. */}
      {!self && (chatMenuOpen || chatActionConfirm !== null) && (
        <ChatActionMenu
          sheetOpen={chatMenuOpen}
          confirm={chatActionConfirm}
          title={peer ? displayName(peer) : undefined}
          peerUsername={peer?.username ?? ''}
          blockedByMe={blockState === 'blockedByMe'}
          busy={actionBusy}
          onSheetClose={() => setChatMenuOpen(false)}
          onConfirmChange={(confirm) => setChatActionConfirm(confirm)}
          onUnblock={() => handleUnblock()}
          onBlock={handleBlockUser}
          onDeleteChat={handleDeleteChat}
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
