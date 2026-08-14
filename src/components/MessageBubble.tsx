import { formatTime } from '../lib/helpers';
import { Message } from '../lib/types';

export default function MessageBubble({
  message,
  mine,
}: {
  message: Message;
  mine: boolean;
}) {
  return (
    <div className={`message ${mine ? 'sent' : 'received'}`}>
      {message.ciphertext}
      <div className="time">{formatTime(message.created_at)}</div>
    </div>
  );
}
