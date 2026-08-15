import { useRef } from 'react';
import { t, getLang } from '../i18n';
import { formatRelative } from '../lib/helpers';
import { Message } from '../lib/types';
import MarkdownText from '../lib/markdown';

interface MessageBubbleProps {
  message: Message;
  mine: boolean;
  peerUsername: string;
  /** Position within a visual group (same sender, same minute). */
  group: 'alone' | 'first' | 'middle' | 'last';
  onLongPress: (message: Message) => void;
  focusable: boolean;
}

/**
 * A single message. Deleted and system events render as subtle centered
 * lines; regular messages render as Signal-like grouped bubbles.
 */
export default function MessageBubble({
  message,
  mine,
  peerUsername,
  group,
  onLongPress,
  focusable,
}: MessageBubbleProps) {
  const timerRef = useRef<number | null>(null);

  function startPress() {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onLongPress(message);
    }, 550);
  }

  function cancelPress() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // Deleted-for-everyone: replaced by a deleted state, content never shown.
  if (message.deleted_at) {
    return (
      <div className={`system-line${mine ? ' own' : ''}`} role="note">
        {mine
          ? t('chat.deletedForEveryoneSelf')
          : t('chat.deletedForEveryoneOther', { username: peerUsername })}
      </div>
    );
  }

  // System events (display-name changes, connection accepted) are not
  // interactive bubbles.
  if (message.kind === 'name_change') {
    return (
      <div className="system-line" role="note">
        {t('chat.nameChange', {
          old: message.meta?.old_name ?? '',
          new: message.meta?.new_name ?? '',
        })}
      </div>
    );
  }
  if (message.kind === 'connection_event' && message.meta?.type === 'accepted') {
    return (
      <div className="system-line" role="note">
        {mine
          ? t('chat.acceptedConnectionSelf')
          : t('chat.acceptedConnection', { username: message.meta.username ?? peerUsername })}
      </div>
    );
  }
  if (message.kind === 'deleted_account') {
    return (
      <div className="system-line" role="note">
        {t('chat.deletedAccountMessage', {
          username: message.meta?.username ?? peerUsername,
        })}
      </div>
    );
  }

  const showTime = group === 'alone' || group === 'last';

  return (
    <div
      className={`message ${mine ? 'sent' : 'received'} group-${group}`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onPointerMove={(e) => {
        // Cancel the long-press when the finger moves beyond a small slop.
        if (timerRef.current !== null && e.movementX * e.movementX + e.movementY * e.movementY > 36) {
          cancelPress();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      tabIndex={focusable ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLongPress(message);
        }
      }}
      role={focusable ? 'button' : undefined}
      aria-label={message.ciphertext}
    >
      <MarkdownText text={message.ciphertext} />
      {showTime && (
        <div className="time">{formatRelative(message.created_at, getLang())}</div>
      )}
    </div>
  );
}
