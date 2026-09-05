// enough. — Supabase Edge Function: send-contact-email
//
// Receives contact form submissions from the Imprint page, validates the input,
// enforces anti-spam and header-injection protections, and dispatches the message
// to the operator via email (Resend REST API).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// In-memory sliding-window rate limiting per IP address
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const history = (rateLimitMap.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (history.length >= MAX_REQUESTS_PER_WINDOW) {
    rateLimitMap.set(ip, history);
    return true;
  }
  history.push(now);
  rateLimitMap.set(ip, history);
  return false;
}

/** Check if the request origin matches allowed enough. domains or local development */
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === 'https://enough.im') return true;
  if (origin === 'https://hpmine42.github.io') return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true;
  if (origin.endsWith('.e2b.app')) return true;

  const envAllowed = Deno.env.get('ALLOWED_ORIGIN');
  if (envAllowed && origin === envAllowed) return true;

  return false;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const reqOrigin = req.headers.get('origin');
  const allowed = isAllowedOrigin(reqOrigin);
  const allowOriginValue = allowed && reqOrigin ? reqOrigin : 'https://enough.im';

  return {
    'Access-Control-Allow-Origin': allowOriginValue,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

/** Remove CRLF and control characters to prevent email header injection */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\u0000-\u001F\u007F-\u009F]+/g, ' ').trim();
}

/** Basic HTML entity escaping for safe HTML email rendering */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Enforce POST method only
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Rate Limiting Check
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';

    if (clientIp !== 'unknown' && isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        {
          status: 429,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    // 2. Parse JSON body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { name, email, message, hp, clientTime } = body ?? {};

    // 3. Anti-Spam Heuristic: Honeypot check (must be empty)
    if (typeof hp === 'string' && hp.trim().length > 0) {
      // Silently accept bot submission without sending email
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 4. Anti-Spam Heuristic: Sub-second form submission check
    if (
      typeof clientTime === 'number' &&
      Number.isFinite(clientTime) &&
      Date.now() - clientTime < 1500 &&
      Date.now() - clientTime >= 0
    ) {
      // Form submitted too quickly to be human; drop silently
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 5. Validate Email
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid email address.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const cleanEmail = sanitizeHeader(email);
    if (cleanEmail.length > 255 || !EMAIL_REGEX.test(cleanEmail)) {
      return new Response(JSON.stringify({ error: 'Invalid email address.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 6. Validate Message
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 10 || trimmedMessage.length > 5000) {
      return new Response(
        JSON.stringify({
          error: 'Message must be between 10 and 5000 characters.',
        }),
        {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    // 7. Validate Name
    const cleanName =
      typeof name === 'string' ? sanitizeHeader(name).slice(0, 100) : '';

    // 8. Operator Configuration & Open-Relay Protection
    // Secrets and operator email are strictly read from environment variables.
    // There is NO hardcoded fallback recipient email in source code.
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const contactToEmail =
      Deno.env.get('CONTACT_TO_EMAIL') || Deno.env.get('OPERATOR_EMAIL');
    const contactFromEmail =
      Deno.env.get('RESEND_FROM_EMAIL') || 'enough. <contact@resend.dev>';

    // If Resend API key is not configured (e.g. local dev / test), succeed in mock mode.
    if (!resendApiKey) {
      console.warn('RESEND_API_KEY is not configured on the server.');
      return new Response(
        JSON.stringify({
          ok: true,
          note: 'Mock mode: RESEND_API_KEY not configured.',
        }),
        {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    // If API key is present but no recipient is configured, fail safely with server error.
    if (!contactToEmail) {
      console.warn('CONTACT_TO_EMAIL is not configured on the server.');
      return new Response(
        JSON.stringify({
          error: 'Contact email recipient is not configured on server.',
        }),
        {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    // 9. Prepare Email Content
    const subject = `[enough. Contact] Message from ${cleanName || cleanEmail}`;
    const dateStr = new Date().toUTCString();

    const textContent = [
      'New contact message received via enough. Imprint form:',
      '',
      `From: ${cleanName ? `${cleanName} <${cleanEmail}>` : cleanEmail}`,
      `Reply-To: ${cleanEmail}`,
      `Date: ${dateStr}`,
      '',
      'Message:',
      trimmedMessage,
    ].join('\n');

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111; line-height: 1.6;">
        <h2 style="font-size: 18px; font-weight: 600; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-top: 0;">New Contact Message on enough.</h2>
        <p style="margin: 4px 0;"><strong>From:</strong> ${escapeHtml(cleanName ? `${cleanName} (${cleanEmail})` : cleanEmail)}</p>
        <p style="margin: 4px 0;"><strong>Reply-To:</strong> <a href="mailto:${escapeHtml(cleanEmail)}">${escapeHtml(cleanEmail)}</a></p>
        <p style="margin: 4px 0; color: #666; font-size: 13px;"><strong>Date:</strong> ${escapeHtml(dateStr)}</p>
        <div style="margin-top: 16px; padding: 16px; background: #f7f7f7; border-radius: 8px; border: 1px solid #eee; white-space: pre-wrap; font-size: 15px;">
${escapeHtml(trimmedMessage)}
        </div>
      </div>
    `.trim();

    // 10. Dispatch Email via Resend REST API
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: contactFromEmail,
        to: [contactToEmail],
        reply_to: cleanEmail,
        subject,
        text: textContent,
        html: htmlContent,
      }),
    });

    if (!resendRes.ok) {
      // Redact sensitive personal payload details from logs — log status code only
      console.error('Resend API dispatch error: HTTP', resendRes.status);
      return new Response(
        JSON.stringify({ error: 'Failed to send message via email provider.' }),
        {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    // Redact internal error object to prevent leaking request memory or credentials
    console.error('send-contact-email handler error');
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
});
