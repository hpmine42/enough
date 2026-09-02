// enough. — Home preview attribution for deleted messages.
//
// Pure, React-free logic so the Node test runner can import it directly
// (see src/lib/__tests__/home-preview.test.mjs), following the pattern of
// src/lib/homeRealtime.ts.

// Explicit `.ts` extension (as used for Node-loadable modules, see
// src/i18n/index.ts) so this module can also be imported by the Node test
// runner, which does not resolve extensionless specifiers.
import { t } from '../i18n/index.ts';
import type { Message } from './types';

/**
 * Preview text for the Home row when the newest message of a conversation
 * was deleted for everyone, or `null` when the message is not deleted (the
 * caller then falls through to the normal preview branches).
 *
 * The wording names the actual deletion ACTOR, not merely the author:
 * "You deleted this message" when the current user performed the deletion,
 * "@peer deleted this message" when the other participant did.
 *
 * Actor resolution relies on the database security model, which this module
 * must not weaken or duplicate: only the SENDER of a message may perform a
 * delete-for-everyone (RLS policy `messages_update_sender_only` plus the
 * `guard_message_update` trigger, migration 0009). The actor of a tombstone
 * (`messages.deleted_at` set, ciphertext cleared) is therefore always the
 * sender of the deleted message.
 *
 * "Delete for me" never reaches this path: it writes per-user rows into
 * `message_deletions` and leaves `deleted_at` null, so it never produces a
 * tombstone preview — that existing semantic is unchanged here.
 */
export function deletedMessagePreview(
  last: Pick<Message, 'deleted_at' | 'sender_id'>,
  me: string,
  peerUsername: string,
): string | null {
  if (!last.deleted_at) return null;
  return last.sender_id === me
    ? t('chat.deletedForEveryoneSelf')
    : t('chat.deletedForEveryoneOther', { username: peerUsername });
}
