// enough. — Runtime handler tests for supabase/functions/send-contact-email.
//
// Simulates the Deno Edge Function execution environment by stubbing Deno.serve
// and Deno.env, then executing real HTTP Request / Response roundtrips against
// the handler.
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/edge-function-runtime.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Read Edge Function source
const edgeFunctionSource = fs.readFileSync(
  `${__dirname}/../../../supabase/functions/send-contact-email/index.ts`,
  'utf-8',
);

// Extract the handler function by stripping TypeScript annotations and Deno.serve wrapper
function stripTsTypes(src) {
  return src
    .replace(/import\s+[^;]+;?/g, '')
    .replace(/new\s+Map<[^>]+>/g, 'new Map')
    .replace(/:\s*Record<[^>]+>/g, '')
    .replace(/:\s*Map<[^>]+>/g, '')
    .replace(/:\s*string\[\]/g, '')
    .replace(/:\s*number\[\]/g, '')
    .replace(/:\s*boolean/g, '')
    .replace(/:\s*string\s*\|\s*null/g, '')
    .replace(/:\s*string\b/g, '')
    .replace(/:\s*number\b/g, '')
    .replace(/:\s*Request\b/g, '')
    .replace(/as\s+[A-Za-z0-9_<>[\]]+/g, '')
    .replace(/Deno\.serve\((.*)\);?\s*$/s, 'return ($1);');
}

const handlerCode = stripTsTypes(edgeFunctionSource);

function createFunctionInstance(env = {}, fetchMock = null) {
  const envMap = new Map(Object.entries(env));
  const DenoStub = {
    env: {
      get: (key) => envMap.get(key),
    },
    serve: (fn) => fn,
  };

  const customFetch =
    fetchMock ||
    (async () =>
      new Response(JSON.stringify({ id: 'resend-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

  const factory = new Function('Deno', 'fetch', handlerCode);
  const handler = factory(DenoStub, customFetch);
  return handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Edge Function handles CORS preflight OPTIONS with origin allowlist', async () => {
  const handler = createFunctionInstance();

  // Allowed origin
  const reqAllowed = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'OPTIONS',
    headers: { origin: 'https://enough.im' },
  });
  const resAllowed = await handler(reqAllowed);
  assert.equal(resAllowed.status, 200);
  assert.equal(
    resAllowed.headers.get('Access-Control-Allow-Origin'),
    'https://enough.im',
  );
  assert.equal(resAllowed.headers.get('Vary'), 'Origin');

  // Disallowed origin falls back safely to primary production origin
  const reqDisallowed = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil-phishing-site.com' },
  });
  const resDisallowed = await handler(reqDisallowed);
  assert.equal(resDisallowed.status, 200);
  assert.equal(
    resDisallowed.headers.get('Access-Control-Allow-Origin'),
    'https://enough.im',
  );
});

test('Edge Function rejects non-POST HTTP methods with 405 Method Not Allowed', async () => {
  const handler = createFunctionInstance();
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const req = new Request('https://functions.supabase.co/send-contact-email', {
      method,
    });
    const res = await handler(req);
    assert.equal(res.status, 405);
    const body = await res.json();
    assert.equal(body.error, 'Method Not Allowed');
  }
});

test('Edge Function handles invalid JSON payloads safely with 400', async () => {
  const handler = createFunctionInstance();
  const req = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ invalid-json-payload',
  });
  const res = await handler(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Invalid JSON payload.');
});

test('Edge Function silently absorbs honeypot bot submissions without dispatching email', async () => {
  let dispatched = false;
  const handler = createFunctionInstance({ RESEND_API_KEY: 're_test' }, async () => {
    dispatched = true;
    return new Response('ok', { status: 200 });
  });

  const req = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'bot@spammer.com',
      message: 'Buy cheap watches now at spam.com!',
      hp: 'i-am-a-bot-filling-hidden-fields',
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(dispatched, false, 'Email must NOT be dispatched on honeypot');
});

test('Edge Function silently absorbs sub-second bot submissions without dispatching email', async () => {
  let dispatched = false;
  const handler = createFunctionInstance({ RESEND_API_KEY: 're_test' }, async () => {
    dispatched = true;
    return new Response('ok', { status: 200 });
  });

  const req = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'fastbot@spammer.com',
      message: 'Automated script submitting form instantly',
      clientTime: Date.now() - 200, // 200ms ago
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(dispatched, false, 'Email must NOT be dispatched on sub-second submission');
});

test('Edge Function validates email presence and format', async () => {
  const handler = createFunctionInstance();

  // Missing email
  const reqNoEmail = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Valid message text here' }),
  });
  const resNoEmail = await handler(reqNoEmail);
  assert.equal(resNoEmail.status, 400);

  // Invalid email format
  const reqBadEmail = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', message: 'Valid message text here' }),
  });
  const resBadEmail = await handler(reqBadEmail);
  assert.equal(resBadEmail.status, 400);

  // Injected newline in email is rejected as invalid email
  const reqInjectedEmail = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com\r\nBcc: evil@phish.com', message: 'Valid message text here' }),
  });
  const resInjectedEmail = await handler(reqInjectedEmail);
  assert.equal(resInjectedEmail.status, 400);
});

test('Edge Function validates message length (min 10, max 5000)', async () => {
  const handler = createFunctionInstance();

  // Too short (< 10)
  const reqShort = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', message: 'Too short' }),
  });
  const resShort = await handler(reqShort);
  assert.equal(resShort.status, 400);

  // Too long (> 5000)
  const reqLong = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', message: 'x'.repeat(5001) }),
  });
  const resLong = await handler(reqLong);
  assert.equal(resLong.status, 400);
});

test('Edge Function succeeds in mock mode when RESEND_API_KEY is unset', async () => {
  const handler = createFunctionInstance({}); // empty env
  const req = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user@example.com',
      message: 'Hello, I have a genuine inquiry about enough.',
      clientTime: Date.now() - 5000,
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.note && body.note.includes('Mock mode'));
});

test('Edge Function fails safely with 500 if RESEND_API_KEY is set but CONTACT_TO_EMAIL is missing', async () => {
  const handler = createFunctionInstance({ RESEND_API_KEY: 're_test_key' });
  const req = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'user@example.com',
      message: 'Hello, this should fail because recipient is not configured.',
      clientTime: Date.now() - 5000,
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'Contact email recipient is not configured on server.');
});

test('Edge Function correctly dispatches email to Resend API with fixed to address and sanitized headers', async () => {
  let capturedPayload = null;
  let capturedHeaders = null;

  const fetchMock = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    capturedHeaders = options.headers;
    capturedPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'msg_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = createFunctionInstance(
    {
      RESEND_API_KEY: 're_secret_key_123',
      CONTACT_TO_EMAIL: 'operator@enough.im',
    },
    fetchMock,
  );

  const req = new Request('https://functions.supabase.co/send-contact-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'origin': 'https://enough.im',
      'x-forwarded-for': '198.51.100.42',
    },
    body: JSON.stringify({
      name: 'Alice\r\nBcc: evil@phish.com',
      email: 'alice@example.com',
      message: '<script>alert("test")</script> Genuine contact message about enough.',
      clientTime: Date.now() - 4000,
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  // Assert auth header
  assert.equal(capturedHeaders['Authorization'], 'Bearer re_secret_key_123');

  // Assert open relay protection: `to` MUST be the operator email, NEVER hijacked
  assert.deepEqual(capturedPayload.to, ['operator@enough.im']);

  // Assert header injection protection on subject: CRLF in name stripped
  assert.ok(!capturedPayload.subject.includes('\r'));
  assert.ok(!capturedPayload.subject.includes('\n'));
  assert.equal(capturedPayload.subject, '[enough. Contact] Message from Alice Bcc: evil@phish.com');

  assert.equal(capturedPayload.reply_to, 'alice@example.com');

  // Assert HTML injection protection
  assert.ok(capturedPayload.html.includes('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;'));
  assert.ok(!capturedPayload.html.includes('<script>'));
});
