import type { Connection, Message, Profile } from './types';

/** Maximum lifetime of a pending/declined connection request attempt. */
export const REQUEST_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export function otherUserId(conn: Connection, me: string): string {
  return conn.user_a === me ? conn.user_b : conn.user_a;
}

export function isSelfConnection(conn: Connection): boolean {
  return conn.user_a === conn.user_b;
}

/**
 * Sort comparator for messages: ascending by `created_at`, ties broken by id
 * (ascending). This matches the `(created_at, id)` ordering used by the
 * database pagination, so appended/realtime messages stay in the same order
 * as freshly loaded pages (audit P3-3 — previously duplicated in Chat.tsx).
 */
export function compareMessagesAsc(
  a: Pick<Message, 'created_at' | 'id'>,
  b: Pick<Message, 'created_at' | 'id'>,
): number {
  return a.created_at === b.created_at
    ? a.id.localeCompare(b.id)
    : a.created_at.localeCompare(b.created_at);
}

/**
 * Monotonic read position (v0.3 R2).
 *
 * The persisted read position of a chat may only ever advance. Scrolling
 * upward used to move it backwards (the newest *visible* message is an older
 * one when scrolled up), which made already-seen messages reappear as unread
 * on Home. This helper is the single place that decides whether a candidate
 * timestamp is accepted.
 *
 * Timestamps are ISO-8601 strings from the database; they are compared
 * chronologically. An unparsable candidate is ignored; an unparsable stored
 * value is replaced by a valid candidate so progress is never blocked.
 *
 * @returns the newer of `current` and `candidate`, or `current` when the
 *          candidate would move the position backwards.
 */
export function advanceReadPosition(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  const a = new Date(current).getTime();
  const b = new Date(candidate).getTime();
  if (Number.isNaN(b)) return current;
  if (Number.isNaN(a)) return candidate;
  return b > a ? candidate : current;
}

/** Human-readable name: display name when set, otherwise the username. */
export function displayName(profile?: Profile | null): string {
  const dn = profile?.display_name?.trim();
  return dn ? dn : profile?.username ?? '…';
}

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

/**
 * Request attempts expire 14 days after they were created (or last re-sent).
 * `accepted` and `ended` connections never expire.
 */
export function connectionExpiresAt(conn: Connection): Date | null {
  if (conn.status === 'accepted' || conn.status === 'ended' || !conn.created_at) {
    return null;
  }
  return new Date(new Date(conn.created_at).getTime() + REQUEST_LIFETIME_MS);
}

export function isConnectionExpired(conn: Connection, now = new Date()): boolean {
  if (conn.status === 'accepted' || conn.status === 'ended') return false;
  const expiresAt = connectionExpiresAt(conn);
  return expiresAt ? expiresAt.getTime() <= now.getTime() : false;
}

/** Effective status including client-side expiry. */
export function effectiveStatus(
  conn: Connection,
  now = new Date(),
): Connection['status'] {
  if (conn.status !== 'accepted' && conn.status !== 'ended' && isConnectionExpired(conn, now)) {
    return 'expired';
  }
  return conn.status;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function localeOf(lang: string): string {
  return lang === 'de' ? 'de-DE' : 'en-US';
}

function weekday(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(localeOf(lang), {
    weekday: 'short',
  });
}

function date(iso: string, lang: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(localeOf(lang), {
    day: 'numeric',
    month: sameYear ? 'long' : 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Compact relative timestamp used in the chat list and inside chats:
 * minutes (< 1 h), hours (< 24 h), weekday (< ~7 d), then the date.
 */
export function formatRelative(
  iso: string,
  lang: string,
  now = new Date(),
): string {
  const dateObj = new Date(iso);
  if (Number.isNaN(dateObj.getTime())) return '';
  const diff = now.getTime() - dateObj.getTime();
  // Anything younger than a minute reads as "just now" instead of "1 min",
  // so freshly sent messages do not look a minute old (audit P2-1). The
  // fallback covers clock skew where the timestamp is slightly in the future.
  if (diff < MINUTE) return lang === 'de' ? 'gerade eben' : 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return weekday(iso, lang);
  return date(iso, lang);
}

/** Full date for "expires on …" notes, e.g. "Aug 28" / "28. August". */
export function formatDate(iso: string | Date, lang: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(localeOf(lang), {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
