#!/usr/bin/env node
/**
 * UI smoke test — renders the production bundle in jsdom and exercises the
 * main flows with a stubbed Supabase API (no live backend required).
 *
 * Run:  npm run smoke   (builds with dummy public env vars, then tests dist/)
 *
 * This is NOT a substitute for testing against the real Supabase project;
 * it verifies rendering, routing, localization, theme and state handling.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/* ------------------------------------------------------------------ */
/* 0. Build with dummy (public) env vars                               */
/* ------------------------------------------------------------------ */

const root = new URL('..', import.meta.url).pathname;
const SUPABASE_URL = 'https://xyzcompany.supabase.co';
const ANON_KEY = 'dummy-anon-key';

execFileSync('npx', ['vite', 'build'], {
  cwd: root,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
    VITE_BASE: '/',
  },
  stdio: 'inherit',
});

const dist = `${root}dist`;
const html = readFileSync(`${dist}/index.html`, 'utf8');
const asset = readdirSync(`${dist}/assets`).find((f) => f.endsWith('.js'));
if (!asset) throw new Error('no JS asset found in dist');

/* ------------------------------------------------------------------ */
/* 1. jsdom environment                                                */
/* ------------------------------------------------------------------ */

const dom = new JSDOM(html, {
  url: 'https://enough.local/',
  pretendToBeVisual: true,
});

const { window } = dom;

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
const header = b64url({ alg: 'HS256', typ: 'JWT' });
const payload = b64url({
  sub: 'user-1',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'anna@example.com',
  email_confirmed_at: new Date().toISOString(),
  exp: Math.floor(Date.now() / 1000) + 3600,
  user_metadata: { username: 'anna' },
});
const ACCESS_TOKEN = `${header}.${payload}.fake-signature`;
if (process.env.SMOKE_RECOVERY) {
  // Exercise the implicit recovery callback format used by Supabase email
  // links. Never print or persist the URL token in test diagnostics.
  window.location.hash =
    `#access_token=${ACCESS_TOKEN}&refresh_token=refresh-1&expires_in=3600` +
    '&token_type=bearer&type=recovery';
}

/* A tiny in-memory "database" for the stub API. */
let ensureMyNotesRpcCalls = 0;
let removeMyNotesRpcCalls = 0;

const db = {
  profiles: [
    {
      id: 'user-1',
      username: 'anna',
      display_name: 'Anna Müller',
      created_at: '2026-01-01T10:00:00Z',
    },
    {
      id: 'user-2',
      username: 'benno',
      display_name: 'Benno Schmidt',
      created_at: '2026-01-02T10:00:00Z',
    },
  ],
  connections: [],
  messages: [],
  message_deletions: [],
  chat_deletions: [],
  connection_reads: [],
  connection_unread: [],
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/* eslint-disable no-undef */
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
});
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
// Keep Node's performance (jsdom's is circular when aliased).
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.CustomEvent = window.CustomEvent;
globalThis.MutationObserver = window.MutationObserver;
// Controllable matchMedia: the smoke environment simulates an OS in light
// mode. Tests flip it via setSystemDark() to exercise the 'system' theme mode.
const systemDark = { value: false };
const darkQueryListeners = new Set();
window.matchMedia = (query) => ({
  matches: query.includes('prefers-color-scheme: dark') ? systemDark.value : false,
  media: query,
  addEventListener(type, cb) {
    if (type === 'change') darkQueryListeners.add(cb);
  },
  removeEventListener(type, cb) {
    darkQueryListeners.delete(cb);
  },
});
function setSystemDark(value) {
  systemDark.value = value;
  darkQueryListeners.forEach((cb) =>
    cb({ matches: value, media: '(prefers-color-scheme: dark)' }),
  );
}
globalThis.matchMedia = window.matchMedia;
// Note: no Notification stub is installed on purpose. enough. must not touch
// the browser Notification API anywhere, so any remaining usage would throw
// here and fail the smoke test.
/* Realtime never connects in the smoke test. */
window.WebSocket = class {
  constructor() {}
  close() {}
  send() {}
};
globalThis.WebSocket = window.WebSocket;

window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
};

/* ------------------------------------------------------------------ */
/* 2. Stubbed Supabase API (fetch)                                     */
/* ------------------------------------------------------------------ */

const myProfile = () =>
  db.profiles.find((p) => p.id === 'user-1');

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  if (process.env.SMOKE_DEBUG) {
    console.log('FETCH:', method, url.toString().slice(0, 160));
  }

  // Auth
  if (path.includes('/auth/v1/user')) {
    return jsonResponse({
      id: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'anna@example.com',
      email_confirmed_at: new Date().toISOString(),
      user_metadata: { username: 'anna' },
    });
  }
  if (path.includes('/auth/v1/logout')) {
    return new Response(null, { status: 204 });
  }
  if (path.includes('/auth/v1/token')) {
    return jsonResponse({
      access_token: ACCESS_TOKEN,
      refresh_token: 'refresh-1',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: 'user-1',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'anna@example.com',
        email_confirmed_at: new Date().toISOString(),
        user_metadata: { username: 'anna' },
      },
    });
  }

  // PostgREST
  if (path.includes('/rest/v1/')) {
    const table = path.split('/rest/v1/')[1].split('?')[0];
    const params = url.searchParams;

    // PostgREST encodes filters as ?col=op.value, e.g. id=eq.user-1.
    const filterParam = (name, op) => {
      const v = params.get(name);
      if (v === null) return null;
      return v.startsWith(`${op}.`) ? v.slice(op.length + 1) : null;
    };
    const eq = (key) => filterParam(key, 'eq');
    // Model PostgREST's ordinary equality filters for every table. Keeping
    // deletion/read endpoints unfiltered hid incorrect client queries.
    const applyEqFilters = (rows) =>
      rows.filter((row) =>
        [...params.entries()].every(([key, value]) =>
          !value.startsWith('eq.') || String(row[key]) === value.slice(3),
        ),
      );
    const headers = init.headers ?? {};
    const accept = typeof headers.get === 'function' ? headers.get('Accept') ?? '' : headers.Accept ?? '';
    const prefer = typeof headers.get === 'function' ? headers.get('Prefer') ?? '' : headers.Prefer ?? '';
    const countExact = prefer.includes('count=exact');
    const wantsObject = accept.includes('pgrst.object');
    const objResponse = (rows) =>
      rows.length === 1
        ? jsonResponse(rows[0])
        : jsonResponse({ message: 'no rows' }, 406);

    switch (table) {
      case 'profiles': {
        if (process.env.SMOKE_DEBUG) {
          console.log('  STUB profiles:', method, 'accept=', accept.slice(0, 60), 'id=', eq('id'), 'ilike=', filterParam('username','ilike'));
        }
        if (method === 'GET') {
          let rows = [...db.profiles];
          const id = eq('id');
          if (id) rows = rows.filter((r) => r.id === id);
          const usernameEq = eq('username');
          if (usernameEq) rows = rows.filter((r) => r.username === usernameEq);
          const ilike = filterParam('username','ilike');
          if (ilike) rows = rows.filter((r) => r.username.startsWith(ilike.replace('%', '')));
          const neq = filterParam('id','neq');
          if (neq) rows = rows.filter((r) => r.id !== neq);
          if (countExact) {
            return jsonResponse(rows.slice(0, 1), 200, {
              'content-range': `0-${Math.min(rows.length, 1) - 1}/${rows.length}`,
            });
          }
          if (wantsObject) return objResponse(rows);
          return jsonResponse(rows);
        }
        if (method === 'PATCH') {
          const id = eq('id');
          const row = db.profiles.find((r) => r.id === id);
          Object.assign(row, body);
          return wantsObject ? jsonResponse(row) : jsonResponse([row]);
        }
        if (method === 'POST') {
          const row = { id: body.id ?? `user-${db.profiles.length + 1}`, username: body.username ?? '', ...body };
          db.profiles.push(row);
          return wantsObject ? jsonResponse(row) : jsonResponse([row]);
        }
        break;
      }
      case 'connections': {
        if (method === 'GET') {
          const id = eq('id');
          const a = eq('user_a');
          const b = eq('user_b');
          let rows = db.connections;
          if (id) rows = rows.filter((r) => r.id === id);
          if (a && b) rows = rows.filter((r) => r.user_a === a && r.user_b === b);
          else if (a) rows = rows.filter((r) => r.user_a === a || r.user_b === a);
          return jsonResponse(rows);
        }
        if (method === 'POST') {
          const row = {
            id: `conn-${db.connections.length + 1}`,
            created_at: new Date().toISOString(),
            ...body,
          };
          db.connections.push(row);
          return wantsObject ? jsonResponse(row) : jsonResponse([row]);
        }
        if (method === 'PATCH') {
          const id = eq('id');
          const row = db.connections.find((r) => r.id === id);
          if (row) Object.assign(row, body);
          return wantsObject ? jsonResponse(row) : jsonResponse([row]);
        }
        if (method === 'DELETE') {
          const id = eq('id');
          db.connections = db.connections.filter((r) => r.id !== id);
          return jsonResponse([]);
        }
        break;
      }
      case 'messages': {
        if (method === 'GET' || method === 'HEAD') {
          const cid = eq('connection_id');
          let rows = db.messages.filter((r) => r.connection_id === cid);
          const before = filterParam('created_at','lt');
          if (before) rows = rows.filter((r) => r.created_at < before);
          const sender = filterParam('sender_id','neq');
          if (sender) rows = rows.filter((r) => r.sender_id !== sender);
          if (countExact) {
            return jsonResponse(rows.slice(0, 1), 200, {
              'content-range': `0-${Math.min(rows.length, 1) - 1}/${rows.length}`,
            });
          }
          const order = params.get('order');
          const desc = order?.includes('desc');
          rows.sort((x, y) => (desc ? y.created_at.localeCompare(x.created_at) : x.created_at.localeCompare(y.created_at)));
          const limit = Number(params.get('limit')) || rows.length;
          return jsonResponse(rows.slice(0, limit));
        }
        if (method === 'POST') {
          const row = {
            id: `msg-${db.messages.length + 1}`,
            created_at: new Date().toISOString(),
            deleted_at: null,
            kind: 'text',
            ...body,
          };
          db.messages.push(row);
          return wantsObject ? jsonResponse(row) : jsonResponse([row]);
        }
        if (method === 'PATCH') {
          const id = eq('id');
          const row = db.messages.find((r) => r.id === id);
          if (row) Object.assign(row, body);
          return jsonResponse([row]);
        }
        break;
      }
      case 'message_deletions': {
        if (method === 'GET') return jsonResponse(applyEqFilters(db.message_deletions));
        if (method === 'POST') {
          db.message_deletions.push(body);
          return jsonResponse([body]);
        }
        break;
      }
      case 'chat_deletions': {
        if (method === 'GET') return jsonResponse(applyEqFilters(db.chat_deletions));
        if (method === 'POST') {
          db.chat_deletions.push(body);
          return jsonResponse([body]);
        }
        if (method === 'DELETE') {
          db.chat_deletions = db.chat_deletions.filter(
            (r) => r.connection_id !== eq('connection_id') || r.user_id !== eq('user_id'),
          );
          return jsonResponse([]);
        }
        break;
      }
      case 'connection_reads': {
        if (method === 'GET') return jsonResponse(applyEqFilters(db.connection_reads));
        if (method === 'POST') {
          const existing = db.connection_reads.find(
            (r) => r.connection_id === body.connection_id && r.user_id === body.user_id,
          );
          if (existing) Object.assign(existing, body);
          else db.connection_reads.push(body);
          return jsonResponse([body]);
        }
        break;
      }
      case 'connection_unread': {
        if (method === 'GET') return jsonResponse(db.connection_unread);
        break;
      }
      case 'rpc/ensure_my_notes': {
        ensureMyNotesRpcCalls++;
        let row = db.connections.find(
          (c) => c.user_a === 'user-1' && c.user_b === 'user-1',
        );
        if (row) {
          row.status = 'accepted';
        } else {
          row = {
            id: `conn-${db.connections.length + 1}`,
            user_a: 'user-1',
            user_b: 'user-1',
            status: 'accepted',
            created_at: new Date().toISOString(),
          };
          db.connections.push(row);
        }
        return jsonResponse(row.id);
      }
      case 'rpc/remove_my_notes': {
        removeMyNotesRpcCalls++;
        const ids = new Set(
          db.connections
            .filter((c) => c.user_a === 'user-1' && c.user_b === 'user-1')
            .map((c) => c.id),
        );
        db.messages = db.messages.filter((m) => !ids.has(m.connection_id));
        db.connections = db.connections.filter((c) => !ids.has(c.id));
        return jsonResponse(ids.size > 0);
      }
      case 'rpc/delete_own_account': {
        // Self-service account deletion: drop the current user's rows.
        db.profiles = db.profiles.filter((p) => p.id !== 'user-1');
        db.connections = db.connections.filter(
          (c) => c.user_a !== 'user-1' && c.user_b !== 'user-1',
        );
        return new Response(null, { status: 204 });
      }
      case 'rpc/check_username_taken': {
        const name = (body && (body.name ?? body.p_name)) || '';
        const taken = db.profiles.some((p) => p.username === name);
        return jsonResponse(taken);
      }
    }
    return jsonResponse({ error: `unhandled: ${table}` }, 404);
  }

  return jsonResponse({ error: 'not found' }, 404);
};

/* ------------------------------------------------------------------ */
/* 3. Helpers                                                          */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function assert(cond, name) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

function text(selector) {
  return dom.window.document.querySelector(selector)?.textContent?.trim() ?? null;
}

function click(selector) {
  const el = dom.window.document.querySelector(selector);
  if (!el) throw new Error(`click: no element for ${selector}`);
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function setHash(hash) {
  dom.window.location.hash = hash;
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
}

async function waitFor(fn, name, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return assert(true, name);
    await sleep(25);
  }
  assert(false, `${name} (timeout)`);
}

/* ------------------------------------------------------------------ */
/* 4. Tests                                                            */
/* ------------------------------------------------------------------ */

console.log('\nenough. UI smoke test\n');

// Simulate an older enough. installation that stored the removed browser
// notifications preference. It must be dropped on load without affecting any
// other preference.
window.localStorage.setItem('enough-notifications', '1');

await import(`${dist}/assets/${asset}`).catch((e) => {
  console.error('bundle import failed:', e);
  process.exit(1);
});

if (process.env.SMOKE_RECOVERY) {
  await waitFor(
    () => text('.button') === 'Set new password',
    'implicit recovery callback opens reset screen',
  );
  assert(
    !window.location.hash.includes('access_token'),
    'Supabase removes recovery tokens from the URL',
  );
  const recoveryInputs = dom.window.document.querySelectorAll(
    '.form input[type="password"]',
  );
  setInputValue(recoveryInputs[0], 'changed123');
  setInputValue(recoveryInputs[1], 'different123');
  dom.window.document.querySelector('.form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await waitFor(
    () => text('.error') === 'The passwords do not match.',
    'recovery rejects mismatching passwords',
  );
  setInputValue(recoveryInputs[1], 'changed123');
  dom.window.document.querySelector('.form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await waitFor(
    () => dom.window.document.querySelector('.home-screen') !== null,
    'recovery updates the password successfully',
  );
  console.log(
    failures === 0
      ? '\nRecovery smoke test passed.\n'
      : `\n${failures} recovery smoke test(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/* --- unauthenticated: login screen, English default --- */
await waitFor(() => text('.auth-screen .brand h1') === 'enough.', 'login screen renders');
assert(text('.button') === 'Log in', 'English is the default language');
assert(text('.auth-links')?.includes('Forgot password?'), 'forgot-password link present');
assert(text('.auth-legal-footer') === 'Imprint', 'public imprint link present');

/* enough. has no notification feature at all. */
assert(
  typeof window.Notification === 'undefined',
  'app never touches the browser Notification API',
);
assert(
  window.localStorage.getItem('enough-notifications') === null,
  'legacy notification preference is removed on load',
);

/* public imprint */
setHash('#/impressum');
await waitFor(() => text('.legal-content h1') === 'Imprint', 'public imprint renders');
assert(
  text('.legal-section address')?.includes('Jakob Gregory'),
  'imprint shows the configured provider',
);
assert(
  dom.window.document.querySelector('.legal-contact-list a[href="mailto:hpmine@web.de"]') !== null,
  'imprint shows the configured contact address',
);
setHash('#/login');
await waitFor(() => text('.button') === 'Log in', 'return from imprint to login');

/* language switch on auth screen */
click('.lang-button');
await waitFor(() => text('.button') === 'Anmelden', 'language switch → German');
assert(window.localStorage.getItem('enough-lang') === 'de', 'language persists');
click('.lang-button');
await waitFor(() => text('.button') === 'Log in', 'language switch → English');

/* theme toggle — three-state cycle: light → dark → system → light */
// Fresh storage defaults to 'system'; the OS is light in this environment.
assert(!dom.window.document.documentElement.classList.contains('dark'), 'light theme initially');
assert(window.localStorage.getItem('enough-theme') === null, 'theme defaults to system (no stored mode)');
await waitFor(
  () => dom.window.document.querySelector('.theme-button .theme-icon')?.classList.contains('mode-system'),
  'initial state shows the system icon',
);
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'light', 'system → light on first tap');
await waitFor(
  () => dom.window.document.querySelector('.theme-button .theme-icon')?.classList.contains('mode-light'),
  'light state shows the sun icon',
);
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'dark', 'light → dark');
await waitFor(() => dom.window.document.documentElement.classList.contains('dark'), 'dark applies');
assert(window.localStorage.getItem('enough-theme') === 'dark', 'theme persists');
await waitFor(
  () => dom.window.document.querySelector('.theme-button .theme-icon')?.classList.contains('mode-dark'),
  'dark state shows the moon icon',
);
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'system', 'dark → system');
assert(
  !dom.window.document.documentElement.classList.contains('dark'),
  'system mode follows the OS (light in this environment)',
);
await waitFor(
  () => dom.window.document.querySelector('.theme-button .theme-icon')?.classList.contains('mode-system'),
  'system state shows the system icon',
);
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'light', 'system → light');
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'dark', 'cycle repeats → dark again');
await waitFor(() => dom.window.document.documentElement.classList.contains('dark'), 'cycle applies dark again');
// Continue through system → light so the remaining flow starts from light.
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'system', 'cycle continues → system');
click('.theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'light', 'cycle continues → light');

/* forgot password */
setHash('#/forgot');
await waitFor(() => text('.button') === 'Send reset link', 'forgot screen renders');
setHash('#/login');
await waitFor(() => text('.button') === 'Log in', 'back to login');

/* registration form with @-username and confirm password */
setHash('#/register');
await waitFor(() => text('.button') === 'Register', 'register screen renders');
const atField = dom.window.document.querySelector('.at-field .at-prefix');
assert(atField?.textContent === '@', '@ prefix attached to username field');
assert(
  dom.window.document.querySelectorAll('.form input').length === 5,
  'registration has 5 fields (email, @username, display name, password, confirm)',
);
assert(
  text('.field-hint.muted') ===
    'Choose your username carefully — it cannot be changed after registration.',
  'username field carries a subtle cannot-be-changed hint',
);

/* live username validation */
const usernameInput = dom.window.document.querySelector('.at-input');
setInputValue(usernameInput, 'anna');
await waitFor(
  () => text('.field-hint') === 'This username is already taken.',
  'live username validation → taken (must not show available)',
);
setInputValue(usernameInput, 'newuser123');
await waitFor(
  () => text('.field-hint') === 'This username is available.',
  'live username validation → available',
);
setInputValue(usernameInput, 'AN');
await waitFor(
  () => text('.field-hint')?.startsWith('Usernames are 3–20'),
  'live username validation → format error',
);

/* permanent username hint also exists in German (and stays while validating) */
click('.lang-button');
await waitFor(
  () =>
    text('.field-hint.muted') ===
    'Wähle deinen Benutzernamen sorgfältig – er kann nach der Registrierung nicht mehr geändert werden.',
  'permanent username hint in German',
);
click('.lang-button');
await waitFor(
  () => text('.field-hint.muted')?.startsWith('Choose your username'),
  'permanent username hint switches back to English',
);

/* --- authenticated: real sign-in through the UI --- */
window.localStorage.setItem('enough-lang', 'en');
setHash('#/login');
await waitFor(() => text('.button') === 'Log in', 'login screen before sign-in');
const emailInput = dom.window.document.querySelector('.form input[type="email"]');
const passwordInput = dom.window.document.querySelector('.form input[type="password"]');
setInputValue(emailInput, 'anna@example.com');
setInputValue(passwordInput, 'secret123');
dom.window.document.querySelector('.form').dispatchEvent(
  new dom.window.Event('submit', { bubbles: true, cancelable: true }),
);
await waitFor(() => text('.home-screen .empty-title') === 'Nothing here yet.', 'sign-in → home empty state (English)');
assert(text('.home-header .logo') === 'enough.', 'logo on home');
assert(
  dom.window.document.querySelector('.home-header-actions .theme-button') !== null,
  'theme toggle in home header',
);
assert(
  !dom.window.document.querySelector('.home-header-actions .lang-button'),
  'no language switch on home',
);

/* settings opens as overlay */
click('[aria-label="Settings"]');
await waitFor(
  () => dom.window.document.querySelector('.settings-overlay')?.classList.contains('open'),
  'settings overlay opens',
);
assert(text('.settings-section-title') === 'Profile', 'settings shows Profile section');
await waitFor(() => text('.settings-static-value') === '@anna', 'profile username shown');
{
  const displayNameInput = dom.window.document.querySelector('#display-name');
  assert(displayNameInput?.value === 'Anna Müller', 'display name shown');
  const rows = [...dom.window.document.querySelectorAll('.settings-static-row')].map((r) => r.textContent);
  assert(rows.some((r) => r.includes('anna@example.com')), 'email shown');
}
assert(
  dom.window.document.querySelectorAll('.settings-section').length >= 6,
  'settings sections (profile/search/language/appearance/chat/account)',
);
assert(
  ![...dom.window.document.querySelectorAll('.settings-row')].some((r) =>
    /notifications|benachrichtigungen/i.test(r.textContent ?? ''),
  ),
  'no notifications setting remains in Settings',
);
assert(
  ![...dom.window.document.querySelectorAll('.toggle')].some(
    (tg) =>
      /notifications|benachrichtigungen/i.test(
        tg.getAttribute('aria-label') ?? '',
      ),
  ),
  'no notifications toggle remains',
);

/* password change starts with an in-app confirmation */
const passwordRow = [...dom.window.document.querySelectorAll('.settings-row.clickable')].find((r) =>
  r.textContent.includes('Change password'),
);
passwordRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.dialog-title') === 'Change password?',
  'password change opens confirmation dialog first',
);
assert(
  dom.window.document.querySelector('.dialog') !== null,
  'password confirmation is custom (no browser alert)',
);
click('.dialog .btn-primary');
await waitFor(
  () => dom.window.document.querySelectorAll('.settings-inline-form input[type="password"]').length === 3,
  'password form opens after confirmation',
);
const passwordInputs = dom.window.document.querySelectorAll(
  '.settings-inline-form input[type="password"]',
);
setInputValue(passwordInputs[0], 'secret123');
setInputValue(passwordInputs[1], 'changed123');
setInputValue(passwordInputs[2], 'different123');
passwordInputs[0].closest('form').dispatchEvent(
  new dom.window.Event('submit', { bubbles: true, cancelable: true }),
);
await waitFor(
  () => text('.settings-inline-form .error') === 'The passwords do not match.',
  'password change rejects mismatching passwords',
);
setInputValue(passwordInputs[2], 'changed123');
passwordInputs[0].closest('form').dispatchEvent(
  new dom.window.Event('submit', { bubbles: true, cancelable: true }),
);
await waitFor(
  () => [...dom.window.document.querySelectorAll('.field-hint.ok')].some(
    (node) => node.textContent === 'Your password has been changed.',
  ),
  'password change succeeds after backend re-authentication',
);

/* email change also starts with an in-app confirmation */
const emailRow = [...dom.window.document.querySelectorAll('.settings-row.clickable')].find((r) =>
  r.textContent.includes('Change email'),
);
emailRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.dialog-title') === 'Change email address?',
  'email change opens confirmation dialog first',
);
assert(
  text('.dialog-text')?.includes('confirmation link') === true,
  'email dialog explains the confirmation-link flow',
);
click('.dialog .btn-plain');
assert(
  dom.window.document.querySelector('.settings-inline-form input[type="email"]') === null,
  'email form stays closed after canceling the dialog',
);
emailRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.dialog-title') === 'Change email address?',
  'email confirmation dialog reopens',
);
click('.dialog .btn-primary');
await waitFor(
  () => dom.window.document.querySelector('.settings-inline-form input[type="email"]') !== null,
  'email form opens only after confirmation',
);
const emailChangeInput = dom.window.document.querySelector(
  '.settings-inline-form input[type="email"]',
);
setInputValue(emailChangeInput, 'anna-new@example.com');
emailChangeInput.closest('form').dispatchEvent(
  new dom.window.Event('submit', { bubbles: true, cancelable: true }),
);
await waitFor(
  () => [...dom.window.document.querySelectorAll('.field-hint.ok')].some(
    (node) =>
      node.textContent ===
      'A verification link was sent to the new address. It becomes active after you confirm it.',
  ),
  'email change reports a pending confirmation, not an instant change',
);

/* language control inside settings */
const languageSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Language',
);
const deutschOption = [...languageSection.querySelectorAll('.option')].find((o) => o.textContent.includes('Deutsch'));
deutschOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.settings-section-title') === 'Profil', 'settings language switch → German');
assert(window.localStorage.getItem('enough-lang') === 'de', 'settings language persists');
// The email-change confirmation must also exist in German.
const germanEmailRow = [...dom.window.document.querySelectorAll('.settings-row.clickable')].find(
  (r) => r.textContent.includes('E-Mail ändern'),
);
germanEmailRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.dialog-title') === 'E-Mail-Adresse ändern?',
  'German email confirmation dialog opens first',
);
assert(
  text('.dialog-text')?.includes('Bestätigungslink an die neue Adresse') === true,
  'German email dialog explains the confirmation-link flow',
);
click('.dialog .btn-plain');
// Back to English for the remaining assertions.
const englishOption = [...languageSection.querySelectorAll('.option')].find((o) => o.textContent.includes('English'));
englishOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.settings-section-title') === 'Profile', 'settings language switch back → English');

/* appearance control */
const appearanceSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Appearance',
);
const lightOption = [...appearanceSection.querySelectorAll('.option')].find((o) => o.textContent.includes('Light'));
const darkOption = [...appearanceSection.querySelectorAll('.option')].find((o) => o.textContent.includes('Dark'));
const systemOption = [...appearanceSection.querySelectorAll('.option')].find((o) =>
  o.textContent.includes('System'),
);
assert(
  [...appearanceSection.querySelectorAll('.option-label svg')].length === 3,
  'light/dark/system options have minimalist icons',
);
darkOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => dom.window.document.documentElement.classList.contains('dark'), 'settings appearance → dark');
assert(window.localStorage.getItem('enough-theme') === 'dark', 'appearance persists');
await waitFor(
  () => dom.window.document.querySelector('.settings-header .theme-icon')?.classList.contains('mode-dark'),
  'header theme icon follows Settings selection',
);
// The header toggle now cycles through all three modes; the radio list must follow.
click('.settings-header .theme-button');
await waitFor(
  () => window.localStorage.getItem('enough-theme') === 'system',
  'header theme control cycles → system',
);
await waitFor(
  () => systemOption.getAttribute('aria-checked') === 'true',
  'settings radios follow the header toggle',
);
await waitFor(
  () => dom.window.document.querySelector('.settings-header .theme-icon')?.classList.contains('mode-system'),
  'header icon shows the system state',
);
click('.settings-header .theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'light', 'header theme control cycles → light');
await waitFor(() => lightOption.getAttribute('aria-checked') === 'true', 'settings radios follow light');
click('.settings-header .theme-button');
await waitFor(() => window.localStorage.getItem('enough-theme') === 'dark', 'header theme control cycles → dark');
await waitFor(() => dom.window.document.documentElement.classList.contains('dark'), 'header cycle applies dark');
// Pick System from the list — the header icon must follow in reverse as well.
systemOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => systemOption.getAttribute('aria-checked') === 'true',
  'settings appearance → system',
);
assert(window.localStorage.getItem('enough-theme') === 'system', 'system appearance persists');
await waitFor(
  () => dom.window.document.querySelector('.settings-header .theme-icon')?.classList.contains('mode-system'),
  'header icon follows the Settings radio selection',
);

/* person search inside settings */
const searchSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Search people',
);
const searchInput = searchSection.querySelector('input');
setInputValue(searchInput, 'benno');
await waitFor(
  () => [...searchSection.querySelectorAll('.chat-name')].some((n) => n.textContent === 'Benno Schmidt'),
  'person search finds @benno by username',
);

/* connection request from search result */
const bennoRow = [...searchSection.querySelectorAll('.chat')].find((r) => r.textContent.includes('Benno Schmidt'));
bennoRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.request-banner')?.includes('Request sent') || text('.chat-peer-name') === 'Benno Schmidt',
  'tapping result opens conversation/request state',
);
await waitFor(() => text('.request-banner')?.includes('Request sent'), 'outgoing request banner shown');
assert(
  dom.window.document.querySelector('.composer-input')?.disabled === true,
  'composer disabled while request pending',
);
assert(
  text('.composer-disabled') === 'Request sent',
  'composer inactive note visible',
);

/* cancel request */
const cancelBtn = [...dom.window.document.querySelectorAll('.request-banner .btn-small')].find((b) =>
  b.textContent.includes('Cancel request'),
);
cancelBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.home-screen .empty-title') === 'Nothing here yet.', 'canceling request returns to empty home');

/* incoming request flow */
db.connections.push({
  id: 'conn-incoming',
  user_a: 'user-2',
  user_b: 'user-1',
  status: 'pending',
  created_at: new Date().toISOString(),
});
db.messages.push({
  id: 'msg-1',
  connection_id: 'conn-incoming',
  sender_id: 'user-2',
  ciphertext: 'Hallo Anna!',
  created_at: new Date(Date.now() - 5 * 60000).toISOString(),
  deleted_at: null,
  kind: 'text',
});
// Force a Home remount so it re-fetches the new connection.
setHash('#/chat/nowhere');
await waitFor(
  () => dom.window.document.querySelector('.chat-screen') !== null,
  'chat route opened to force reload',
);
setHash('#/');
await waitFor(() => text('.chat-row.request .chat-name') === 'Benno Schmidt', 'incoming request appears on home');
assert(
  [...dom.window.document.querySelectorAll('.chat-row-actions .btn-small')].some((b) => b.textContent === 'Accept'),
  'accept button on home request row',
);

/* accept from home */
click('.chat-row-actions .btn-small');
await waitFor(() => db.connections.find((c) => c.id === 'conn-incoming').status === 'accepted', 'accept → accepted in DB');
await waitFor(() => !dom.window.document.querySelector('.chat-row.request'), 'request row becomes normal chat row');
await waitFor(
  () => text('.unread-badge') === '1',
  'first incoming message is unread before a read-state row exists',
);
// Open the conversation.
click('.chat-row .chat');
await waitFor(() => text('.chat-peer-name') === 'Benno Schmidt', 'chat opens after accept');

/* chat with messages: bubble + time + composer active */
await waitFor(
  () => text('.message')?.startsWith('Hallo Anna!'),
  'message bubble renders',
);
assert(
  dom.window.document.querySelector('.composer-input')?.disabled === false,
  'composer active after accept',
);

/* send a message */
const composer = dom.window.document.querySelector('.composer-input');
setInputValue(composer, 'Hey Benno!');
composer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
composer.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(
  () => [...dom.window.document.querySelectorAll('.message')].some((m) => m.textContent.includes('Hey Benno!')),
  'sending a message appends the bubble',
);

/* long-press bottom sheet — on an OWN message */
const myBubble = [...dom.window.document.querySelectorAll('.message')].find((m) =>
  m.textContent.includes('Hey Benno!'),
);
myBubble.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
await sleep(700);
await waitFor(() => dom.window.document.querySelector('.sheet') !== null, 'long-press opens bottom sheet');
const sheetLabels = [...dom.window.document.querySelectorAll('.sheet-item')].map((i) => i.textContent);
assert(sheetLabels.includes('Copy'), 'sheet has Copy');
assert(sheetLabels.includes('Delete for everyone'), 'own message ≤ 24h → Delete for everyone');
assert(sheetLabels.includes('Delete for me'), 'sheet has Delete for me');
const deleteEveryoneItem = [...dom.window.document.querySelectorAll('.sheet-item')].find((item) =>
  item.textContent === 'Delete for everyone',
);
deleteEveryoneItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.dialog-title') === 'Delete for everyone?',
  'destructive message action confirms immediately',
);
assert(
  dom.window.document.querySelector('.sheet') === null,
  'message sheet closes behind confirmation',
);
click('.dialog .btn-plain');
await waitFor(() => dom.window.document.querySelector('.dialog') === null, 'message delete can be canceled');
myBubble.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
await sleep(700);
await waitFor(() => dom.window.document.querySelector('.sheet') !== null, 'message menu reopens');
const confirmDeleteItem = [...dom.window.document.querySelectorAll('.sheet-item')].find((item) =>
  item.textContent === 'Delete for everyone',
);
confirmDeleteItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.dialog-title') === 'Delete for everyone?', 'delete confirmation reopens');
click('.dialog .btn-primary');
await waitFor(
  () => [...dom.window.document.querySelectorAll('.system-line')].some(
    (line) => line.textContent === 'You deleted this message.',
  ),
  'deleted own message uses the correct replacement text',
);
const deletedMessage = db.messages.find((message) => message.ciphertext === '');
assert(
  Boolean(deletedMessage?.deleted_at),
  'delete for everyone clears content in the backend response',
);
const incomingBubble = [...dom.window.document.querySelectorAll('.message')].find((message) =>
  message.textContent.includes('Hallo Anna!'),
);
incomingBubble.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
await sleep(700);
await waitFor(() => dom.window.document.querySelector('.sheet') !== null, 'other message menu opens');
const otherLabels = [...dom.window.document.querySelectorAll('.sheet-item')].map(
  (item) => item.textContent,
);
assert(!otherLabels.includes('Delete for everyone'), 'other message cannot be deleted for everyone');
const deleteMeItem = [...dom.window.document.querySelectorAll('.sheet-item')].find((item) =>
  item.textContent === 'Delete for me',
);
deleteMeItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => text('.dialog-title') === 'Delete for me?',
  'delete for me confirms immediately',
);
click('.dialog .btn-primary');
await waitFor(
  () => ![...dom.window.document.querySelectorAll('.message')].some(
    (message) => message.textContent.includes('Hallo Anna!'),
  ),
  'delete for me hides only the selected message',
);
assert(
  db.messages.some((message) => message.ciphertext === 'Hallo Anna!') &&
    db.message_deletions.some((row) => row.message_id === 'msg-1'),
  'delete for me preserves message content and stores per-user state',
);

/* a per-user deleted chat is restored by entering it through Settings search */
click('.chat-header .icon-button:last-child');
await waitFor(() => text('.dialog-title') === 'Delete chat?', 'accepted chat delete confirms');
click('.dialog .btn-primary');
await waitFor(
  () =>
    dom.window.document.querySelector('.home-screen') !== null &&
    ![...dom.window.document.querySelectorAll('.chat-row .chat-name')].some(
      (name) => name.textContent === 'Benno Schmidt',
    ),
  'accepted chat is hidden only for the current user',
);
setHash('#/settings');
await waitFor(
  () => dom.window.document.querySelector('.settings-overlay')?.classList.contains('open'),
  'settings opens to rediscover deleted chat',
);
const restoreSearchSection = [...dom.window.document.querySelectorAll('.settings-section')].find((section) =>
  section.querySelector('.settings-section-title')?.textContent === 'Search people',
);
setInputValue(restoreSearchSection.querySelector('input'), 'benno');
await waitFor(
  () => [...restoreSearchSection.querySelectorAll('.chat-name')].some(
    (name) => name.textContent === 'Benno Schmidt',
  ),
  'deleted chat participant is rediscoverable by username',
);
restoreSearchSection.querySelector('.chat').dispatchEvent(
  new dom.window.MouseEvent('click', { bubbles: true }),
);
await waitFor(() => text('.chat-peer-name') === 'Benno Schmidt', 'search reopens deleted chat');
click('.chat-header .icon-button:first-child');
await waitFor(
  () => [...dom.window.document.querySelectorAll('.chat-row .chat-name')].some(
    (name) => name.textContent === 'Benno Schmidt',
  ),
  'reopened chat returns to Home without a page reload',
);

/* decline flow with confirmation dialog (fresh incoming request) */
db.connections.push({
  id: 'conn-decline',
  user_a: 'user-2',
  user_b: 'user-1',
  status: 'pending',
  created_at: new Date().toISOString(),
});
setHash('#/chat/nowhere');
await waitFor(() => dom.window.document.querySelector('.chat-screen') !== null, 'chat route opened to force reload');
setHash('#/');
await waitFor(
  () => [...dom.window.document.querySelectorAll('.chat-row.request .chat-name')].some((n) => n.textContent === 'Benno Schmidt'),
  'new incoming request appears on home',
);
click('.chat-row.request .chat');
await waitFor(
  () => text('.request-banner')?.includes('Connection request'),
  'incoming request opens in chat',
);
const declineBtn = [...dom.window.document.querySelectorAll('.request-banner .btn-small')].find((b) =>
  b.textContent.includes('Decline'),
);
declineBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => dom.window.document.querySelector('.dialog') !== null, 'decline opens confirmation dialog');
assert(
  text('.dialog-title') === 'Decline request?',
  'custom dialog (no browser alert) for decline',
);
const dialogConfirm = dom.window.document.querySelector('.dialog .btn-primary');
dialogConfirm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => db.connections.find((c) => c.id === 'conn-decline').status === 'declined', 'decline → declined in DB');
click('.chat-header .icon-button:first-child');
await waitFor(
  () => text('.chat-row.request .chat-preview')?.includes('Request declined'),
  'declined request stays visible on home',
);

/* my notes: enabling shows the row immediately after leaving settings */
setHash('#/settings');
await waitFor(() => dom.window.document.querySelector('.settings-overlay')?.classList.contains('open'), 'settings reopens');
const chatSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Chat',
);
const notesToggle = [...chatSection.querySelectorAll('.toggle')].find((t) => t.getAttribute('aria-label') === 'Meine Notizen' || t.getAttribute('aria-label') === 'My Notes');
notesToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => db.connections.some((c) => c.user_a === 'user-1' && c.user_b === 'user-1'), 'My Notes self-connection created');
assert(ensureMyNotesRpcCalls === 1, 'My Notes setup uses the auth-bound RPC');
assert(notesToggle.getAttribute('aria-checked') === 'true', 'My Notes switch reflects the database row');
// Leave settings directly — no reload, no detour through another chat.
setHash('#/');
await waitFor(() => text('.chat-row .chat-name') === 'My Notes', 'My Notes appears immediately after leaving settings');
assert(
  dom.window.document.querySelector('.chat-row.notes .chat-notes-tag')?.textContent?.trim() === 'Private',
  'My Notes row is visually distinct (private tag)',
);
assert(
  dom.window.document.querySelector('.chat-row.notes') !== null,
  'My Notes row carries the notes marker class',
);

/* write a note */
const notesRow = [...dom.window.document.querySelectorAll('.chat-row .chat')].find((r) => r.textContent.includes('My Notes'));
notesRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.chat-peer-name') === 'My Notes', 'My Notes chat opens');
const notesComposer = dom.window.document.querySelector('.composer-input');
setInputValue(notesComposer, 'Buy milk');
notesComposer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
notesComposer.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(
  () => [...dom.window.document.querySelectorAll('.message')].some((m) => m.textContent.includes('Buy milk')),
  'note is sent into My Notes',
);

/* trash opens the special My Notes dialog (not the chat-delete dialog) */
click('.chat-header .icon-button:last-child');
await waitFor(() => dom.window.document.querySelector('.dialog') !== null, 'trash opens a confirmation dialog');
assert(
  text('.dialog-title') === 'Clear this chat and disable My Notes?',
  'My Notes uses its own clear-and-disable dialog',
);
assert(
  text('.dialog-text') === 'You can re-enable My Notes later in Settings.',
  'My Notes dialog explains re-enabling in Settings',
);
assert(
  dom.window.document.querySelector('.dialog .btn-plain') !== null &&
    dom.window.document.querySelector('.dialog .btn-primary') !== null,
  'My Notes dialog has cancel and confirm buttons',
);
/* cancel changes nothing */
click('.dialog .btn-plain');
await waitFor(() => dom.window.document.querySelector('.dialog') === null, 'cancel closes the dialog');
assert(
  db.connections.some((c) => c.user_a === 'user-1' && c.user_b === 'user-1'),
  'cancel keeps the My Notes self-connection',
);
assert(
  db.messages.some((m) => m.ciphertext === 'Buy milk'),
  'cancel keeps the notes content',
);
/* confirm clears everything, disables My Notes and returns to Home */
click('.chat-header .icon-button:last-child');
await waitFor(() => dom.window.document.querySelector('.dialog') !== null, 'dialog reopens');
click('.dialog .btn-primary');
await waitFor(
  () =>
    dom.window.document.querySelector('.home-screen') !== null &&
    ![...dom.window.document.querySelectorAll('.chat-row .chat-name')].some((n) => n.textContent === 'My Notes'),
  'confirm returns to Home with My Notes gone immediately',
);
assert(removeMyNotesRpcCalls === 1, 'clearing uses the auth-bound remove_my_notes() RPC');
assert(
  !db.connections.some((c) => c.user_a === 'user-1' && c.user_b === 'user-1'),
  'confirm removes the self-connection',
);
assert(
  !db.messages.some((m) => m.ciphertext === 'Buy milk'),
  'confirm removes the notes content',
);

/* account deletion (type-to-confirm) */
setHash('#/settings');
await waitFor(() => dom.window.document.querySelector('.settings-overlay')?.classList.contains('open'), 'settings open for delete account');
const reopenedChatSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Chat',
);
const reopenedNotesToggle = [...reopenedChatSection.querySelectorAll('.toggle')].find(
  (toggle) => toggle.getAttribute('aria-label') === 'My Notes',
);
await waitFor(
  () => reopenedNotesToggle.getAttribute('aria-checked') === 'false',
  'My Notes switch is off immediately after clearing from the chat',
);

/* re-enabling shows the (empty) notes chat again right after leaving settings */
reopenedNotesToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => db.connections.some((c) => c.user_a === 'user-1' && c.user_b === 'user-1'),
  'My Notes re-enabled',
);
assert(ensureMyNotesRpcCalls === 2, 're-enabling calls ensure_my_notes again');
setHash('#/');
await waitFor(
  () => text('.chat-row .chat-name') === 'My Notes',
  'My Notes appears again immediately after leaving settings',
);
const notesRowAgain = [...dom.window.document.querySelectorAll('.chat-row .chat')].find((r) => r.textContent.includes('My Notes'));
if (!notesRowAgain) {
  // Keep later, independent account-flow coverage running when an earlier
  // assertion fails instead of masking it with a TypeError.
  assert(false, 're-enabled My Notes row is actionable');
} else {
  notesRowAgain.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => text('.chat-peer-name') === 'My Notes', 're-enabled My Notes chat opens');
  await waitFor(
    () => text('.chat-empty') === 'No messages yet.',
    'My Notes is empty after re-enabling',
  );
}
setHash('#/settings');
await waitFor(() => dom.window.document.querySelector('.settings-overlay')?.classList.contains('open'), 'settings open for delete account');
const deleteAccountBtn = [...dom.window.document.querySelectorAll('.settings-row')].find((r) =>
  r.textContent.includes('Delete account'),
);
deleteAccountBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.dialog-title') === 'Delete account?', 'delete account confirmation dialog');
{
  const confirmBtn = dom.window.document.querySelector('.dialog .btn-primary');
  assert(confirmBtn?.disabled === true, 'delete confirm disabled until username typed');
}
const deleteInput = dom.window.document.querySelector('#delete-account-confirm');
setInputValue(deleteInput, '@anna');
await waitFor(
  () => dom.window.document.querySelector('.dialog .btn-primary')?.disabled === false,
  'delete confirm enabled after typing username',
);
dom.window.document.querySelector('.dialog .btn-primary').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.button') === 'Log in', 'deleting account returns to login screen');

/* sign out with confirmation */
// Re-authenticate first (the previous test deleted the account).
window.localStorage.setItem('enough-lang', 'en');
setHash('#/login');
await waitFor(() => text('.button') === 'Log in', 'login screen before re-sign-in');
setInputValue(dom.window.document.querySelector('.form input[type="email"]'), 'anna@example.com');
setInputValue(dom.window.document.querySelector('.form input[type="password"]'), 'secret123');
dom.window.document.querySelector('.form').dispatchEvent(
  new dom.window.Event('submit', { bubbles: true, cancelable: true }),
);
await waitFor(() => text('.home-screen .empty-title') === 'Nothing here yet.', 're-sign-in → home empty state');
setHash('#/settings');
await waitFor(() => dom.window.document.querySelector('.settings-overlay')?.classList.contains('open'), 'settings open again');
const signOutBtn = [...dom.window.document.querySelectorAll('.settings-row')].find((r) => r.textContent.includes('Sign out'));
signOutBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.dialog-title') === 'Sign out?', 'sign out confirmation dialog');
click('.dialog .btn-primary');
await waitFor(() => text('.button') === 'Log in', 'sign out returns to login screen');

/* ------------------------------------------------------------------ */
/* theme: OS preference switching and browser restart                  */
/* ------------------------------------------------------------------ */

// The persisted mode is 'system' (set in the appearance section above).
await waitFor(() => window.localStorage.getItem('enough-theme') === 'system', 'system mode is active');

// 1) System mode must react to OS light/dark changes while it is running.
assert(
  !dom.window.document.documentElement.classList.contains('dark'),
  'system + OS light → light',
);
setSystemDark(true);
await waitFor(
  () => dom.window.document.documentElement.classList.contains('dark'),
  'system follows OS switch → dark',
);
assert(window.localStorage.getItem('enough-theme') === 'system', 'OS change does not rewrite the mode');
setSystemDark(false);
await waitFor(
  () => !dom.window.document.documentElement.classList.contains('dark'),
  'system follows OS switch → light',
);

// 2) Explicit light/dark must ignore OS changes.
click('.theme-button'); // system → light
await waitFor(() => window.localStorage.getItem('enough-theme') === 'light', 'explicit light selected');
setSystemDark(true);
await sleep(50);
assert(
  !dom.window.document.documentElement.classList.contains('dark'),
  'explicit light ignores OS dark',
);
setSystemDark(false);
click('.theme-button'); // light → dark
await waitFor(() => window.localStorage.getItem('enough-theme') === 'dark', 'explicit dark selected');
setSystemDark(false);
await sleep(50);
assert(
  dom.window.document.documentElement.classList.contains('dark'),
  'explicit dark ignores OS light',
);
setSystemDark(true);
await sleep(50);
assert(
  dom.window.document.documentElement.classList.contains('dark'),
  'explicit dark stays dark when OS is dark',
);

// 3) Browser restart: the persisted mode is applied before first paint by the
// inline script in index.html (no flash of the wrong theme), and the
// status-bar color follows. A fresh JSDOM with seeded storage simulates a new
// browser session.
function bootWithTheme(storedMode, osDark) {
  const storage = new Map();
  if (storedMode) storage.set('enough-theme', storedMode);
  const fresh = new JSDOM(html, {
    url: 'https://enough.local/restart',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window2) {
      Object.defineProperty(window2, 'localStorage', {
        value: {
          getItem: (k) => storage.get(k) ?? null,
          setItem: (k, v) => storage.set(k, String(v)),
          removeItem: (k) => storage.delete(k),
          clear: () => storage.clear(),
          key: (i) => [...storage.keys()][i] ?? null,
          get length() {
            return storage.size;
          },
        },
        configurable: true,
      });
      window2.matchMedia = (query) => ({
        matches: query.includes('prefers-color-scheme: dark') ? osDark : false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      });
    },
  });
  return fresh;
}

{
  const booted = bootWithTheme('dark', false);
  assert(
    booted.window.document.documentElement.classList.contains('dark'),
    'restart: persisted dark applies before first paint',
  );
  assert(
    booted.window.document
      .querySelector('meta[name="theme-color"]')
      ?.getAttribute('content') === '#191917',
    'restart: status-bar color follows the pre-paint theme',
  );
  booted.window.close();
}
{
  const booted = bootWithTheme('light', true);
  assert(
    !booted.window.document.documentElement.classList.contains('dark'),
    'restart: explicit light ignores OS dark before first paint',
  );
  booted.window.close();
}
{
  const booted = bootWithTheme('system', true);
  assert(
    booted.window.document.documentElement.classList.contains('dark'),
    'restart: system + OS dark → dark before first paint',
  );
  booted.window.close();
}
{
  const booted = bootWithTheme('system', false);
  assert(
    !booted.window.document.documentElement.classList.contains('dark'),
    'restart: system + OS light → light before first paint',
  );
  booted.window.close();
}

if (failures === 0) {
  // A fresh client instance is required because callback flow selection occurs
  // when Supabase is initialized.
  execFileSync(process.execPath, [new URL(import.meta.url).pathname], {
    cwd: root,
    env: { ...process.env, SMOKE_RECOVERY: '1' },
    stdio: 'inherit',
  });
}

console.log(failures === 0 ? '\nAll smoke tests passed.\n' : `\n${failures} smoke test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

/* --- helper (hoisted) --- */
function setInputValue(input, value) {
  const proto =
    input instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
