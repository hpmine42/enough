// enough. — Connection action handlers (Accept / Decline / Block / Unblock /
// Cancel / Re-request / Delete-Chat / Clear-My-Notes) for the Chat screen.
//
// Extracted from Chat.tsx during #5 to isolate the cluster of connection-
// lifecycle mutations from data loading, scrolling and realtime logic.
// Behaviour is intentionally byte-identical to the prior inlined versions:
// - optimistic UI updates before awaiting the network call,
// - rollback on error,
// - setBusyId / setActionBusy gating to prevent double-submits,
// - My-Notes uses the dedicated removeMyNotes() RPC.
//
// The hook owns NO state: it receives the current snapshot and React setters
// from Chat so all existing derived values and dialog flags stay in one place.

import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  acceptConnection,
  blockUser,
  cancelConnectionRequest,
  declineConnection,
  deleteChatForMe,
  getBlockState,
  getConnection,
  removeMyNotes,
  sendConnectionRequest,
  unblockUser,
} from '../lib/api';
import type { BlockState, Connection, Profile } from '../lib/types';

export interface UseConnectionActionsArgs {
  me: string;
  conn: Connection | null;
  peer: Profile | null;
  setError: (e: string | null) => void;
  setBusyId: Dispatch<SetStateAction<string | null>>;
  setActionBusy: Dispatch<SetStateAction<boolean>>;
  setConn: Dispatch<SetStateAction<Connection | null>>;
  setBlockState: Dispatch<SetStateAction<BlockState>>;
  setDeclineOpen: Dispatch<SetStateAction<boolean>>;
  setChatActionConfirm: Dispatch<SetStateAction<'block' | 'delete' | null>>;
  setChatMenuOpen: Dispatch<SetStateAction<boolean>>;
  navigate: (hash: string) => void;
}

export function useConnectionActions(args: UseConnectionActionsArgs) {
  const {
    me, conn, peer, setError, setBusyId, setActionBusy,
    setConn, setBlockState, setDeclineOpen, setChatActionConfirm,
    setChatMenuOpen, navigate,
  } = args;

  const handleAccept = useCallback(async () => {
    if (!conn) return;
    setBusyId(conn.id);
    setError(null);
    const err = await acceptConnection(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else setConn({ ...conn, status: 'accepted' });
  }, [conn, setBusyId, setError, setConn]);

  const handleDecline = useCallback(async (blockPeer = false) => {
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
  }, [conn, setBusyId, setError, setDeclineOpen, setConn, setBlockState]);

  const handleBlockUser = useCallback(async () => {
    if (!conn || !peer) return;
    setActionBusy(true);
    setError(null);
    const err = await blockUser(me, peer.id);
    setActionBusy(false);
    setChatActionConfirm(null);
    if (err) { setError(err); return; }
    setBlockState('blockedByMe');
  }, [conn, peer, me, setActionBusy, setError, setChatActionConfirm, setBlockState]);

  const handleUnblock = useCallback(async () => {
    if (!conn || !peer) return;
    setBusyId(conn.id);
    setError(null);
    const err = await unblockUser(me, peer.id);
    if (err) {
      setBusyId(null);
      setError(err);
      return;
    }
    // Re-derive from DB instead of assuming 'none': with a mutual block,
    // removing one side must still leave the composer disabled while the
    // peer's block ('blockedByThem') exists.
    setBusyId(null);
    setBlockState(await getBlockState(me, peer.id));
  }, [conn, peer, me, setBusyId, setError, setBlockState]);

  const handleCancelRequest = useCallback(async () => {
    if (!conn) return;
    setBusyId(conn.id);
    setError(null);
    const err = await cancelConnectionRequest(conn.id);
    setBusyId(null);
    if (err) setError(err);
    else navigate('#/');
  }, [conn, setBusyId, setError, navigate]);

  const handleRequestAgain = useCallback(async () => {
    if (!conn || !peer) return;
    const prevConn = conn;
    setBusyId(conn.id);
    setError(null);
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
  }, [conn, peer, me, setBusyId, setError, setConn]);

  const handleDeleteChat = useCallback(async () => {
    if (!conn) return;
    setActionBusy(true);
    setError(null);
    const err = await deleteChatForMe(me, conn.id);
    setActionBusy(false);
    setChatActionConfirm(null);
    if (err) { setError(err); return; }
    navigate('#/');
  }, [conn, me, setActionBusy, setError, setChatActionConfirm, navigate]);

  const handleClearMyNotes = useCallback(async () => {
    if (!conn) return;
    setActionBusy(true);
    setError(null);
    const err = await removeMyNotes(me, conn.id);
    setActionBusy(false);
    setChatMenuOpen(false);
    if (err) { setError(err); return; }
    navigate('#/');
  }, [conn, me, setActionBusy, setError, setChatMenuOpen, navigate]);

  return {
    handleAccept,
    handleDecline,
    handleBlockUser,
    handleUnblock,
    handleCancelRequest,
    handleRequestAgain,
    handleDeleteChat,
    handleClearMyNotes,
  };
}
