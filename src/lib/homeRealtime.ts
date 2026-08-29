import type { Message } from './types';

/**
 * Pure helpers for the Home screen's realtime reconciliation.
 *
 * Home subscribes to `postgres_changes` for messages/profiles. Instead of
 * re-fetching every connection, profile, last message, read state and unread
 * count on each event (audit P1-5), the hot path applies the event to the
 * already-rendered list and keeps the full `load()` only as a reconciliation
 * fallback for conversations that are not currently visible.
 *
 * Kept free of Vite/React imports so the Node test runner can import it
 * directly (see src/lib/__tests__/home-realtime.test.mjs).
 */

/**
 * Message A is "newer" than message B when its timestamp is later, or — for
 * identical timestamps — when its id sorts later (matching the
 * `(created_at, id)` ordering used everywhere else).
 */
export function isMessageNewer(a: Message, b: Message): boolean {
  if (a.created_at === b.created_at) return a.id > b.id;
  return a.created_at > b.created_at;
}

/**
 * Merge a realtime message event into the Home `lastMessages` map.
 *
 * Home only displays the newest message per connection, so:
 *   - an INSERT for a connection without a last message adds it;
 *   - an INSERT of a message newer than the current last replaces it;
 *   - an INSERT of an older message (out-of-order delivery) is ignored;
 *   - an UPDATE replaces the entry only when it targets the currently
 *     displayed (newest) message — e.g. delete-for-everyone, which clears
 *     the ciphertext and sets `deleted_at`.
 *
 * Returns the same object reference when the event does not change the map,
 * so React can skip a re-render.
 */
export function mergeLastMessage(
  prev: Record<string, Message>,
  msg: Message,
): Record<string, Message> {
  const cur = prev[msg.connection_id];
  if (!cur) return { ...prev, [msg.connection_id]: msg };
  if (cur.id === msg.id) return { ...prev, [msg.connection_id]: msg };
  if (isMessageNewer(msg, cur)) return { ...prev, [msg.connection_id]: msg };
  return prev;
}

/**
 * Increment the unread counter for one connection after an incoming message
 * from the peer. Own messages (sent from another device) never count as
 * unread, so a non-peer sender leaves the map untouched.
 */
export function unreadAfterInsert(
  prev: Record<string, number>,
  connectionId: string,
  fromPeer: boolean,
): Record<string, number> {
  if (!fromPeer) return prev;
  return { ...prev, [connectionId]: (prev[connectionId] ?? 0) + 1 };
}
