import { Connection, Profile } from './types';

/** Maximum lifetime of a pending/declined connection request attempt. */
export const REQUEST_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export function otherUserId(conn: Connection, me: string): string {
  return conn.user_a === me ? conn.user_b : conn.user_a;
}

export function isSelfConnection(conn: Connection): boolean {
  return conn.user_a === conn.user_b;
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
  if (diff < MINUTE) return lang === 'de' ? '1 min' : '1 min';
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
