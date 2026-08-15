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
window.matchMedia = (query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.matchMedia = window.matchMedia;
window.Notification = class {
  static permission = 'default';
  static requestPermission() {
    return Promise.resolve('denied');
  }
  constructor(title, options) {
    this.title = title;
    this.options = options;
  }
};
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
        if (method === 'GET') {
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
        if (method === 'GET') return jsonResponse(db.message_deletions);
        if (method === 'POST') {
          db.message_deletions.push(body);
          return jsonResponse([body]);
        }
        break;
      }
      case 'chat_deletions': {
        if (method === 'GET') return jsonResponse(db.chat_deletions);
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
        if (method === 'GET') return jsonResponse(db.connection_reads);
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

await import(`${dist}/assets/${asset}`).catch((e) => {
  console.error('bundle import failed:', e);
  process.exit(1);
});

/* --- unauthenticated: login screen, English default --- */
await waitFor(() => text('.auth-screen .brand h1') === 'enough.', 'login screen renders');
assert(text('.button') === 'Log in', 'English is the default language');
assert(text('.auth-links')?.includes('Forgot password?'), 'forgot-password link present');
assert(text('.auth-legal-footer') === 'Imprint', 'public imprint link present');

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

/* theme toggle */
assert(!dom.window.document.documentElement.classList.contains('dark'), 'light theme initially');
click('.theme-button');
await waitFor(() => dom.window.document.documentElement.classList.contains('dark'), 'theme toggle → dark');
assert(window.localStorage.getItem('enough-theme') === 'dark', 'theme persists');
click('.theme-button');
await waitFor(() => !dom.window.document.documentElement.classList.contains('dark'), 'theme toggle → light');

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

/* live username validation */
const usernameInput = dom.window.document.querySelector('.at-input');
setInputValue(usernameInput, 'anna');
await waitFor(
  () => text('.field-hint') === 'This username is available.',
  'live username validation → available',
);
setInputValue(usernameInput, 'AN');
await waitFor(
  () => text('.field-hint')?.startsWith('Usernames are 3–20'),
  'live username validation → format error',
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

/* language control inside settings */
const languageSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Language',
);
const deutschOption = [...languageSection.querySelectorAll('.option')].find((o) => o.textContent.includes('Deutsch'));
deutschOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.settings-section-title') === 'Profil', 'settings language switch → German');
assert(window.localStorage.getItem('enough-lang') === 'de', 'settings language persists');
// Back to English for the remaining assertions.
const englishOption = [...languageSection.querySelectorAll('.option')].find((o) => o.textContent.includes('English'));
englishOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.settings-section-title') === 'Profile', 'settings language switch back → English');

/* appearance control */
const appearanceSection = [...dom.window.document.querySelectorAll('.settings-section')].find((s) =>
  s.querySelector('.settings-section-title')?.textContent === 'Appearance',
);
const darkOption = [...appearanceSection.querySelectorAll('.option')].find((o) => o.textContent.includes('Dark'));
darkOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => dom.window.document.documentElement.classList.contains('dark'), 'settings appearance → dark');
assert(window.localStorage.getItem('enough-theme') === 'dark', 'appearance persists');

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
click('.sheet-cancel');
await waitFor(() => dom.window.document.querySelector('.sheet') === null, 'sheet closes via Cancel');

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
const declineBtn = [...dom.window.document.querySelectorAll('.chat-row-actions .btn-small')].find((b) =>
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
await waitFor(
  () => text('.chat-row.request .chat-preview')?.includes('Request declined'),
  'declined request stays visible on home',
);

/* my notes toggle */
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
setHash('#/chat/nowhere');
await waitFor(() => dom.window.document.querySelector('.chat-screen') !== null, 'chat route opened to force reload');
setHash('#/');
await waitFor(() => text('.chat-row .chat-name') === 'My Notes', 'My Notes appears in chat list');

/* chat deletion (delete for me) */
const notesRow = [...dom.window.document.querySelectorAll('.chat-row .chat')].find((r) => r.textContent.includes('My Notes'));
notesRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(() => text('.chat-peer-name') === 'My Notes', 'My Notes chat opens');
if (text('.chat-peer-name') !== 'My Notes') {
  console.log('DEBUG hash:', dom.window.location.hash, '| peer:', text('.chat-peer-name'), '| loading:', text('.chat-loading'));
}
click('.chat-header .icon-button:last-child');
await waitFor(() => dom.window.document.querySelector('.dialog') !== null, 'chat delete confirmation dialog');
click('.dialog .btn-primary');
await waitFor(() => db.chat_deletions.some((d) => d.connection_id.startsWith('conn-')), 'chat deletion persisted');
await waitFor(
  () => ![...dom.window.document.querySelectorAll('.chat-row .chat-name')].some((n) => n.textContent === 'My Notes'),
  'deleted chat hidden on home',
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
  () => reopenedNotesToggle.getAttribute('aria-checked') === 'true',
  'My Notes switch reloads its state from the database',
);
reopenedNotesToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await waitFor(
  () => !db.connections.some((c) => c.user_a === 'user-1' && c.user_b === 'user-1'),
  'disabling My Notes removes the self-connection',
);
assert(removeMyNotesRpcCalls === 1, 'My Notes removal uses the auth-bound RPC');
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
