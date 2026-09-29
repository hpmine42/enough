// enough. — pure helpers for the email one-time-code (OTP) auth flows.
//
// These functions are deliberately free of I/O and of any Supabase access so
// they can be unit-tested directly. Security notes:
//
//   * Validity of a code is ALWAYS decided by Supabase Auth (server-side).
//     `normalizeOtpCode` / `isPlausibleOtpCode` are a formatting guard for
//     input handling only — a "plausible" code can still be rejected by the
//     server, and the client never treats a code as verified on its own.
//   * The code is never logged anywhere in the app; helpers here must keep
//     that property (no console output).

/**
 * Cooldown between two code requests for the same flow.
 *
 * Mirrors the documented Supabase Auth per-user window for `/signup`,
 * `/recover` and `/otp` (60 s between requests for the same address). This
 * is a UX guard so honest users do not walk into the server's rate limit —
 * it is NOT a security control; the server limit applies regardless of
 * what the client does.
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Input guard for a typed/pasted code: strip everything a mail client or a
 * user may add around the digits (whitespace, line breaks, dashes used by
 * some mailers) and keep the digits only.
 *
 * Returns `null` when nothing digit-like remains, so callers can show a
 * validation hint without submitting an empty token.
 */
export function normalizeOtpCode(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Plausibility check before submitting — pure UX. Supabase Auth's email OTP
 * is a numeric code whose length is configurable on the server
 * (`GOTRUE_MAILER_OTP_LENGTH`, documented range 6–10 digits); the range
 * here is intentionally a little wider than the server setting so a server
 * side length change can never lock users out of an otherwise valid code.
 * The server remains the only authority on validity.
 */
export function isPlausibleOtpCode(code: string): boolean {
  return /^[0-9]{6,12}$/.test(code);
}

/**
 * Milliseconds left in the resend cooldown for a request that happened at
 * `sentAt` (0 once the window has passed). `now` is injectable for tests.
 */
export function resendCooldownRemaining(
  sentAt: number | null,
  now: number = Date.now(),
): number {
  if (sentAt === null) return 0;
  const remaining = sentAt + RESEND_COOLDOWN_MS - now;
  return remaining > 0 ? remaining : 0;
}
