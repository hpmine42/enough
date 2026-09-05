// enough. — Behavioral & security tests for contact email dispatch and Edge Function.
//
// Tests client-side validation, server-side Edge Function handler logic,
// abuse protection (honeypot, sub-second bot check, rate limiting),
// mail header injection prevention, and anti-open-relay guarantees.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/privacy-contact.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const edgeFunctionSource = fs.readFileSync(
  `${__dirname}/../../../supabase/functions/send-contact-email/index.ts`,
  'utf-8',
);

// ---------------------------------------------------------------------------
// Static security & architectural checks on the Edge Function
// ---------------------------------------------------------------------------

test('Edge function strictly enforces POST and OPTIONS methods only', () => {
  assert.ok(
    edgeFunctionSource.includes("req.method === 'OPTIONS'"),
    'OPTIONS method must be handled for CORS preflight',
  );
  assert.ok(
    edgeFunctionSource.includes("req.method !== 'POST'"),
    'Non-POST methods must be rejected',
  );
  assert.ok(
    edgeFunctionSource.includes('405'),
    'Method rejection must return HTTP 405',
  );
});

test('Edge function protects against Open Mail Relay by binding the recipient to server config', () => {
  // Recipient MUST NOT be extracted from req.body
  const bodyDestructuringMatch = edgeFunctionSource.match(
    /const\s*\{\s*([^}]+)\s*\}\s*=\s*body/,
  );
  assert.ok(bodyDestructuringMatch, 'body is destructured');
  const extractedFields = bodyDestructuringMatch[1]
    .split(',')
    .map((s) => s.trim());

  assert.ok(
    !extractedFields.includes('to'),
    'Caller MUST NOT be able to provide a "to" address',
  );
  assert.ok(
    !extractedFields.includes('recipient'),
    'Caller MUST NOT be able to provide a "recipient" address',
  );

  // Recipient must come from environment
  assert.ok(
    edgeFunctionSource.includes("Deno.env.get('CONTACT_TO_EMAIL')") ||
      edgeFunctionSource.includes("Deno.env.get('OPERATOR_EMAIL')"),
    'Recipient email must be fetched from server environment variables',
  );
});

test('Edge function sanitizes headers against CRLF injection', () => {
  assert.ok(
    edgeFunctionSource.includes('sanitizeHeader'),
    'sanitizeHeader function must exist',
  );
  assert.ok(
    edgeFunctionSource.includes(
      'value.replace(/[\\r\\n\\u0000-\\u001F\\u007F-\\u009F]+/g',
    ),
    'CRLF and control characters must be stripped',
  );
});

test('Edge function implements Honeypot spam defense', () => {
  assert.ok(
    edgeFunctionSource.includes('typeof hp === \'string\' && hp.trim().length > 0'),
    'Honeypot field presence must be detected',
  );
  assert.ok(
    edgeFunctionSource.includes('JSON.stringify({ ok: true })'),
    'Honeypot triggers silent fake success to frustrate bots without emailing',
  );
});

test('Edge function implements rapid submission / bot defense', () => {
  assert.ok(
    edgeFunctionSource.includes('Date.now() - clientTime < 1500'),
    'Sub-second submissions must be caught',
  );
});

test('Edge function implements per-IP rate limiting', () => {
  assert.ok(
    edgeFunctionSource.includes('isRateLimited'),
    'Rate limiting function must exist',
  );
  assert.ok(
    edgeFunctionSource.includes('429'),
    'Exceeded rate limits must return HTTP 429',
  );
});

test('Edge function validates email length and regex format', () => {
  assert.ok(
    edgeFunctionSource.includes('cleanEmail.length > 255'),
    'Email length must be capped at 255 chars',
  );
  assert.ok(
    edgeFunctionSource.includes('EMAIL_REGEX'),
    'Email format regex validation must be enforced',
  );
});

test('Edge function validates message length limits (min 10, max 5000)', () => {
  assert.ok(
    edgeFunctionSource.includes('trimmedMessage.length < 10'),
    'Minimum message length (10) must be enforced',
  );
  assert.ok(
    edgeFunctionSource.includes('trimmedMessage.length > 5000'),
    'Maximum message length (5000) must be enforced',
  );
});

// ---------------------------------------------------------------------------
// Simulated Execution of Edge Function Logic
// ---------------------------------------------------------------------------

function simulateSanitizeHeader(value) {
  return value.replace(/[\r\n\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();
}

function simulateEscapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

test('simulateSanitizeHeader neutralizes CRLF injection attempts', () => {
  const maliciousName = 'Attacker\r\nBcc: victim@example.com\r\nSubject: Injected';
  const sanitized = simulateSanitizeHeader(maliciousName);

  assert.ok(!sanitized.includes('\r'), 'No carriage return in sanitized string');
  assert.ok(!sanitized.includes('\n'), 'No newline in sanitized string');
  assert.equal(
    sanitized,
    'Attacker Bcc: victim@example.com Subject: Injected',
  );
});

test('simulateEscapeHtml neutralizes HTML tag and entity injection', () => {
  const maliciousMessage = '<script>alert("xss")</script><img src=x onerror=steal()>';
  const escaped = simulateEscapeHtml(maliciousMessage);

  assert.ok(!escaped.includes('<script>'), 'Script tag escaped');
  assert.ok(!escaped.includes('<img'), 'Img tag escaped');
  assert.ok(escaped.includes('&lt;script&gt;'));
});
