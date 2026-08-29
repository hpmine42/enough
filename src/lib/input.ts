export const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Normalize a user-provided display name before it reaches Auth / PostgREST.
 *
 * We keep printable characters, braces and angle brackets literal, but strip
 * control characters and trim surrounding whitespace so stored profile data is
 * stable and single-line.
 */
export function sanitizeDisplayName(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();
}

/**
 * Normalize raw message plaintext before encryption / storage.
 *
 * Peer conversations now store opaque E2EE envelopes, so the safe place to
 * harden message content is BEFORE encryption. We preserve ordinary printable
 * text (including `<`, `>`, `{`, `}` and emoji), keep tabs/newlines, normalize
 * CRLF to LF, and strip the remaining control characters.
 */
export function sanitizeMessagePlaintext(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}
