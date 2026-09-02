import { t } from '../i18n';
import BottomSheet from './BottomSheet';
import Dialog from './Dialog';

interface ChatActionMenuProps {
  /** Render the action sheet (block/unblock + delete chat for me). */
  sheetOpen: boolean;
  /** Confirmation dialog currently open above the (closed) sheet. */
  confirm: 'block' | 'delete' | null;
  /** Peer display name used as the sheet title and accessible name. */
  title?: string;
  /** Peer username for the block confirmation dialog title. */
  peerUsername: string;
  /** The current user has blocked the peer → offer "Unblock" instead of
   *  "Block user" (mirrors getBlockState's mutual-block precedence). */
  blockedByMe: boolean;
  /** The selected action is running (drives the dialog busy state). */
  busy: boolean;
  /** Close the sheet (backdrop / cancel / Escape). */
  onSheetClose: () => void;
  /** Open or close a confirmation dialog. */
  onConfirmChange: (confirm: 'block' | 'delete' | null) => void;
  /** Unblock the peer (existing block flow, no confirmation dialog). */
  onUnblock: () => void;
  /** Block the peer (existing block flow, after the confirmation dialog). */
  onBlock: () => void;
  /** Delete the chat for me (existing deletion flow, after confirmation). */
  onDeleteChat: () => void;
}

/**
 * Shared chat action menu — the same BottomSheet the in-chat trash icon
 * opens, now also reachable from the Home overview via long-press.
 *
 * One implementation serves both entry points:
 *   - "Block user" (or "Unblock" while the current user has blocked the
 *     peer) → the existing block confirmation dialog;
 *   - "Delete chat for me" → the existing chat-deletion confirmation dialog.
 *
 * The component is fully presentational: the parent owns the sheet/confirm
 * state and performs the actual block/delete/unblock API calls, so both
 * callers keep their own state and error handling while the menu structure,
 * labels, and confirmation flow exist exactly once.
 */
export default function ChatActionMenu({
  sheetOpen,
  confirm,
  title,
  peerUsername,
  blockedByMe,
  busy,
  onSheetClose,
  onConfirmChange,
  onUnblock,
  onBlock,
  onDeleteChat,
}: ChatActionMenuProps) {
  return (
    <>
      {sheetOpen && (
        <BottomSheet
          title={title}
          cancelLabel={t('cancel')}
          onClose={onSheetClose}
          items={[
            ...(blockedByMe
              ? [
                  {
                    key: 'unblock',
                    label: t('block.unblock'),
                    onSelect: onUnblock,
                  },
                ]
              : [
                  {
                    key: 'block',
                    label: t('block.blockUser'),
                    danger: true,
                    onSelect: () => onConfirmChange('block'),
                  },
                ]),
            {
              key: 'delete',
              label: t('chat.deleteChatForMe'),
              danger: true,
              onSelect: () => onConfirmChange('delete'),
            },
          ]}
        />
      )}

      {/* The block confirmation names the peer in its title; while the peer
          profile has not loaded (empty username) it stays closed — the same
          gate the in-chat menu had before the component was extracted. */}
      {confirm === 'block' && peerUsername !== '' && (
        <Dialog
          title={t('block.blockTitle', { username: peerUsername })}
          text={t('block.blockText')}
          confirmLabel={t('block.blockUser')}
          cancelLabel={t('cancel')}
          danger
          busy={busy}
          onConfirm={onBlock}
          onCancel={() => onConfirmChange(null)}
        />
      )}

      {confirm === 'delete' && (
        <Dialog
          title={t('chat.deleteChatConfirmTitle')}
          text={t('chat.deleteChatConfirmText')}
          confirmLabel={t('chat.deleteChatForMe')}
          cancelLabel={t('cancel')}
          danger
          busy={busy}
          onConfirm={onDeleteChat}
          onCancel={() => onConfirmChange(null)}
        />
      )}
    </>
  );
}
