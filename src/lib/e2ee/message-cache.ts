// enough. E2EE-v0.2 — local message plaintext cache.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//   The Signal engine cannot decrypt a message it sent (the sending chain's
//   keys are consumed), and re-decrypting an old received message fails once
//   the ratchet has advanced past it (skipped-message-key window). Every E2EE
//   messenger therefore keeps message plaintext in a LOCAL store for display
//   and stores only ciphertext on the server. This module is that local store.
//
// SECURITY BOUNDARY
//   * LOCAL ONLY. The contents never go to Supabase or any network call.
//   * Per-user scoped (`enough-msgplain-<userId>`), so logout/login as another
//     user never crosses caches.
//   * It holds the user's OWN sent plaintext and the plaintext of messages
//     they have decrypted — i.e. content the device is already authorized to
//     show. It is the on-device equivalent of Signal's local message database.
//   * It is NOT a second path to Supabase and NOT an unencrypted optimistic
//     store that leaks to the server.
//
// This module performs no cryptography.

const STORAGE_PREFIX = 'enough-msgplain-';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readAll(userId: string): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(userId: string, map: Record<string, string>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    // Quota exceeded or disabled storage: display-only best effort. The
    // ciphertext remains safe on Supabase; only the local preview degrades.
  }
}

/** Get the cached display plaintext for a message, or null if not cached. */
export function getCachedPlaintext(userId: string, messageId: string): string | null {
  return readAll(userId)[messageId] ?? null;
}

/** Cache the plaintext for a message (sent or decrypted). Local only. */
export function cachePlaintext(userId: string, messageId: string, plaintext: string): void {
  if (!userId || !messageId) return;
  const map = readAll(userId);
  map[messageId] = plaintext;
  writeAll(userId, map);
}

/** Cache many plaintexts at once (batch decrypt). Local only. */
export function cacheManyPlaintext(
  userId: string,
  entries: Array<{ messageId: string; plaintext: string }>,
): void {
  if (!userId || entries.length === 0) return;
  const map = readAll(userId);
  for (const { messageId, plaintext } of entries) {
    if (messageId) map[messageId] = plaintext;
  }
  writeAll(userId, map);
}

/**
 * Remove the whole cache for a user (account deletion). The server-side
 * ciphertext stays; only the local display plaintext is dropped.
 */
export function clearMessageCache(userId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}
