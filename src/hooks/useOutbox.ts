// enough. — Offline send-queue integration hook.
// ---------------------------------------------------------------------------
// Enqueues messages when the network is offline (and encrypts+sends them
// online) and surfaces queued messages for the open chat so they render as
// pending bubbles. Draining is FIFO, per online transition, and runs under
// the same lifecycle token as the rest of chat so stale conversations never
// flush into the current one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { enqueueMessage, loadOutbox, outboxForConnection, removeFromOutbox, updateOutboxError, type OutboxEntry } from '../lib/outbox';
import { sendMessage } from '../lib/api';
import { prepareSend } from '../lib/e2ee/message-flow';
import { cachePlaintext } from '../lib/e2ee/message-cache';
import { compareMessagesAsc } from '../lib/helpers';
import type { Connection, Message } from '../lib/types';
import type { E2EESessionManager } from '../lib/e2ee/session-manager';
import type { ChatLifecycle } from '../lib/chatRealtime';
import { t } from '../i18n';
import { shouldSkipNetwork, useConnectivity, reportNetworkSuccess } from '../lib/connectivity';
import { isCryptoError } from '../lib/crypto/errors';

export interface UseOutboxResult {
  queuedForChat: OutboxEntry[];
  /** True while the drain pass is flushing queued messages. */
  draining: boolean;
  /** Queue a message locally (encrypted later when online). Returns true
   *  when the composer should clear its draft. */
  enqueue: (plaintext: string) => Promise<boolean>;
}

export function useOutbox(opts: {
  me: string;
  conn: Connection | null;
  isSelf: boolean;
  manager: E2EESessionManager | null;
  e2eeStatus: 'initializing' | 'ready' | 'error';
  lifecycleRef: React.MutableRefObject<ChatLifecycle>;
  setError: (e: string | null) => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setPlain: (updater: (p: Record<string, string>) => Record<string, string>) => void;
  otherUserId: (c: Connection, me: string) => string;
}): UseOutboxResult {
  const { me, conn, isSelf, manager, e2eeStatus, lifecycleRef, setError, setMessages, setPlain, otherUserId } = opts;
  const connectivity = useConnectivity();
  const [queued, setQueued] = useState<OutboxEntry[]>([]);
  const [draining, setDraining] = useState(false);
  const loadedRef = useRef(false);

  // Load once per user so the UI shows pending messages on open.
  useEffect(() => {
    if (!me) return;
    loadedRef.current = false;
    let active = true;
    loadOutbox(me).then((list) => { if (active) setQueued(list); loadedRef.current = true; });
    return () => { active = false; };
  }, [me]);

  const refresh = useCallback(async () => {
    if (!me) return;
    setQueued(await loadOutbox(me));
  }, [me]);

  const enqueue = useCallback(async (plaintext: string): Promise<boolean> => {
    if (!conn || !me) return false;
    const id = `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await enqueueMessage(me, { id, connectionId: conn.id, plaintext });
    // Reflect locally as a pending placeholder bubble (no real message id yet).
    const pending: Message = {
      id,
      connection_id: conn.id,
      sender_id: me,
      recipient_id: otherUserId(conn, me),
      ciphertext: plaintext,
      created_at: new Date().toISOString(),
      kind: 'text',
    } as Message;
    setMessages((prev) => [...prev, pending].sort(compareMessagesAsc));
    setPlain((p) => ({ ...p, [id]: plaintext }));
    await refresh();
    return true;
  }, [conn, me, otherUserId, setMessages, setPlain, refresh]);

  // Drain queue on every online transition (and on mount when already online).
  useEffect(() => {
    if (!conn || !me) return;
    if (shouldSkipNetwork()) return;
    if (e2eeStatus === 'initializing') return;
    let cancelled = false;
    (async () => {
      const list = await loadOutbox(me);
      const chatQueue = outboxForConnection(list, conn.id);
      if (chatQueue.length === 0) return;
      setDraining(true);
      for (const entry of [...chatQueue]) {
        if (cancelled) break;
        if (!lifecycleRef.current.isCurrent(lifecycleRef.current.current())) break;
        try {
          const peerId = isSelf ? me : otherUserId(conn, me);
          const ciphertext = await prepareSend({
            e2ee: isSelf ? null : manager,
            isSelf,
            peerUserId: peerId,
            connectionId: conn.id,
            plaintext: entry.plaintext,
          });
          const { message, error } = await sendMessage(conn.id, me, ciphertext);
          if (cancelled) break;
          if (error) {
            await updateOutboxError(me, entry.id, error);
            setError(error);
            break;
          }
          if (message) {
            await cachePlaintext(me, message.id, entry.plaintext);
            await removeFromOutbox(me, entry.id);
            // Swap the placeholder bubble for the real message.
            setMessages((prev) => prev
              .filter((m) => m.id !== entry.id)
              .concat(message)
              .sort(compareMessagesAsc));
            setPlain((p) => { const n = { ...p }; n[message.id] = entry.plaintext; delete n[entry.id]; return n; });
          }
        } catch (e) {
          if (cancelled) break;
          const msg = isCryptoError(e)
            ? (e.code === 'NOT_AVAILABLE' ? t('chat.e2eeUnavailable') : t('chat.e2eeFailed'))
            : (e instanceof Error ? e.message : t('errors.generic'));
          await updateOutboxError(me, entry.id, msg);
          setError(msg);
          break;
        }
      }
      setDraining(false);
      reportNetworkSuccess();
      await refresh();
    })();
    return () => { cancelled = true; };
  }, [connectivity, conn, me, isSelf, manager, e2eeStatus, lifecycleRef, otherUserId, setError, setMessages, setPlain, refresh]);

  const queuedForChat = conn ? outboxForConnection(queued, conn.id) : [];
  return { queuedForChat, draining, enqueue };
}
