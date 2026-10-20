// enough. — Message-sheet and E2EE-reset action handlers for the Chat screen.
//
// Extracted from Chat.tsx during #5. Isolates:
//   - Delete-for-everyone / delete-for-me (long-press sheet → confirm dialog),
//   - Copy to clipboard (long-press sheet),
//   - C2 peer reset (SINGLE call site of resetPeerSecurityState),
//   - C2 device reset (SINGLE call site of resetDeviceState).
//
// Behaviour is intentionally identical to the prior inlined versions:
// lifecycle tokens guard against stale async writes, actionBusy disables the
// confirm buttons, clipboard falls back to document.execCommand for older
// engines.

import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  deleteMessageForEveryone,
  deleteMessageForMe,
  getBlockState,
} from '../lib/api';
import type { ChatLifecycle } from '../lib/chatRealtime';
import type { E2EESessionManager } from '../lib/e2ee/session-manager';
import type { BlockState, Message } from '../lib/types';
import { t } from '../i18n';

export interface SheetTarget {
  message: Message;
  mine: boolean;
  within24h: boolean;
}

export interface UseMessageActionsArgs {
  me: string;
  manager: E2EESessionManager | null;
  lifecycleRef: MutableRefObject<ChatLifecycle>;
  setError: (e: string | null) => void;
  setActionBusy: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setDeletedForMe: Dispatch<SetStateAction<Set<string>>>;
  setConfirmAction: Dispatch<SetStateAction<'deleteEveryone' | 'deleteMe' | null>>;
  setConfirmTarget: Dispatch<SetStateAction<SheetTarget | null>>;
  setResetBusy: Dispatch<SetStateAction<boolean>>;
  setResetDialog: Dispatch<SetStateAction<{ peerId: string; connectionId: string } | null>>;
  setDeviceResetBusy: Dispatch<SetStateAction<boolean>>;
  setDeviceResetOpen: Dispatch<SetStateAction<boolean>>;
  setBlockState: Dispatch<SetStateAction<BlockState>>;
  setIdentityChangedPeer: Dispatch<SetStateAction<string | null>>;
  resetDeviceState: () => Promise<boolean>;
  plain: Record<string, string>;
  confirmTarget: SheetTarget | null;
  sheetTarget: SheetTarget | null;
  resetDialog: { peerId: string; connectionId: string } | null;
}

export function useMessageActions(args: UseMessageActionsArgs) {
  const {
    me, manager, lifecycleRef, setError, setActionBusy,
    setMessages, setDeletedForMe, setConfirmAction, setConfirmTarget,
    setResetBusy, setResetDialog, setDeviceResetBusy, setDeviceResetOpen,
    setBlockState, setIdentityChangedPeer, resetDeviceState,
    plain, confirmTarget, sheetTarget, resetDialog,
  } = args;

  const handleDeleteEveryone = useCallback(async () => {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setActionBusy(true);
    setError(null);
    const err = await deleteMessageForEveryone(target.message.id);
    setActionBusy(false);
    setConfirmAction(null);
    setConfirmTarget(null);
    if (err) { setError(err); return; }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.message.id
          ? { ...m, deleted_at: new Date().toISOString(), ciphertext: '' }
          : m,
      ),
    );
  }, [confirmTarget, setActionBusy, setError, setConfirmAction, setConfirmTarget, setMessages]);

  const handleDeleteForMe = useCallback(async () => {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setActionBusy(true);
    setError(null);
    const err = await deleteMessageForMe(me, target.message.id);
    setActionBusy(false);
    setConfirmAction(null);
    setConfirmTarget(null);
    if (err) { setError(err); return; }
    setDeletedForMe((prev) => new Set(prev).add(target.message.id));
  }, [confirmTarget, me, setActionBusy, setError, setConfirmAction, setConfirmTarget, setDeletedForMe]);

  const handleCopy = useCallback(async () => {
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
  }, [sheetTarget, plain]);

  /**
   * C2 peer recovery — SINGLE call site of resetPeerSecurityState. Runs only
   * from the confirmation dialog, after a fresh block read. Never sends —
   * the draft stays and the user re-sends explicitly (P2).
   */
  const performPeerReset = useCallback(async () => {
    const target = resetDialog;
    if (!target || !manager) return;
    const token = lifecycleRef.current.current();
    setResetBusy(true);
    const freshBlock = await getBlockState(me, target.peerId);
    if (!lifecycleRef.current.isCurrent(token)) return;
    if (freshBlock !== 'none') {
      setResetBusy(false);
      setResetDialog(null);
      setBlockState(freshBlock);
      setIdentityChangedPeer(null);
      setError(
        freshBlock === 'blockedByMe' ? t('block.blockedByYouChat') : t('block.blockedByThemChat'),
      );
      return;
    }
    try {
      await manager.resetPeerSecurityState(target.peerId, [target.connectionId]);
    } catch {
      if (!lifecycleRef.current.isCurrent(token)) return;
      setResetBusy(false);
      setResetDialog(null);
      setError(t('chat.e2eeResetFailed'));
      return;
    }
    if (!lifecycleRef.current.isCurrent(token)) return;
    setResetBusy(false);
    setResetDialog(null);
    setIdentityChangedPeer(null);
    setError(null);
  }, [resetDialog, manager, lifecycleRef, me, setResetBusy, setResetDialog, setBlockState, setIdentityChangedPeer, setError]);

  /** C2 device recovery — SINGLE call site of resetDeviceState. */
  const performDeviceReset = useCallback(async () => {
    const token = lifecycleRef.current.current();
    setDeviceResetBusy(true);
    let ok = false;
    try { ok = await resetDeviceState(); } catch { ok = false; }
    if (!lifecycleRef.current.isCurrent(token)) return;
    setDeviceResetBusy(false);
    setDeviceResetOpen(false);
    if (!ok) setError(t('chat.e2eeResetFailed'));
  }, [lifecycleRef, resetDeviceState, setDeviceResetBusy, setDeviceResetOpen, setError]);

  return {
    handleDeleteEveryone,
    handleDeleteForMe,
    handleCopy,
    performPeerReset,
    performDeviceReset,
  };
}
