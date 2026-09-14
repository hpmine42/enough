// enough. — regression guards for the redesigned Home chat-overview UI.
//
// These are source-level guards: the overview rows are not renderable in
// the Node test runner without a full React/E2EE harness (their rendered
// counterpart — navigation, long-press menu, empty state — is exercised by
// the smoke test). They pin the structure the overview redesign introduced:
// the two-line row anatomy with one trailing time/unread axis, the quiet
// inset separators, the first-paint skeleton, the typographic unread state
// and the shared empty state.
//
// Run with:
//   npm run test:home
//   node --test --experimental-strip-types src/lib/__tests__/home-overview-ui.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const readRel = (p) => fs.readFileSync(`${__dirname}/../../${p}`, 'utf-8');
const home = readRel('components/Home.tsx');
const css = readRel('index.css');

/** The overview row button JSX (from its class name to the closing tag). */
function overviewRowJsx() {
  const start = home.indexOf('className="chat chat-overview-row"');
  assert.ok(start !== -1, 'the overview row button must exist');
  const end = home.indexOf('</button>', start);
  return home.slice(start, end);
}

function rule(selector) {
  const m = css.match(new RegExp(`\\n\\.${selector.replace(/[.+]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

test('first paint shows a decorative skeleton instead of a blank canvas', () => {
  assert.ok(
    home.includes('loading && !hasChats ?'),
    'the skeleton renders only while a first load is running and nothing is shown yet',
  );
  const at = home.indexOf('className="chat-list-skeleton"');
  assert.ok(at > 0, 'the skeleton container exists');
  const start = home.lastIndexOf('<', at);
  const end = home.indexOf('>', at);
  const tag = home.slice(start, end);
  assert.ok(
    tag.includes('aria-hidden="true"'),
    'the skeleton is purely decorative and hidden from assistive technology',
  );
  assert.ok(
    home.indexOf('className="chat-list-skeleton"') < home.indexOf("t('home.nothingHere')"),
    'the skeleton is a dedicated state, rendered before the empty state',
  );
  assert.ok(rule('skeleton-row'), '.skeleton-row is styled');
  assert.ok(rule('skeleton-avatar') && rule('skeleton-line'), 'the skeleton anatomy is styled');
});

test('rows keep one trailing axis: time above the unread count', () => {
  const row = overviewRowJsx();
  assert.ok(row.includes('className="chat-trailing"'), 'the row renders the trailing column');
  const trailing = row.indexOf('className="chat-trailing"');
  const trailingEnd = row.indexOf('</button>', trailing);
  const block = row.slice(trailing, trailingEnd);
  assert.ok(
    block.indexOf('chat-time') < block.indexOf('unread-badge'),
    'the time sits above the unread count in the trailing column',
  );
  assert.ok(
    block.includes('unreadCount > 0'),
    'the badge renders only when the conversation has unread messages',
  );
  const body = rule('chat-overview-row .chat-trailing');
  assert.ok(body && /flex-direction:\s*column/.test(body), 'the trailing column stacks vertically');
  assert.ok(body && /justify-content:\s*space-between/.test(body), 'time and badge anchor to the two text lines');
});

test('the unread state is typographic, not a loud badge', () => {
  const name = rule('chat-row.unread .chat-name');
  assert.ok(name && /font-weight:\s*650/.test(name), 'unread rows step the name weight up');
  const preview = rule('chat-row.unread .chat-preview');
  assert.ok(preview && /var\(--text-soft\)/.test(preview), 'unread previews step up to the soft text colour');
  const time = rule('chat-row.unread .chat-time');
  assert.ok(time && /var\(--accent-text\)/.test(time), 'unread timestamps carry the quiet accent tint');
});

test('the unread counter uses theme-parity ink tokens', () => {
  const light = css.match(/:root\s*\{([^}]*)\}/);
  const dark = css.match(/:root\.dark\s*\{([^}]*)\}/);
  assert.ok(light && dark, 'both theme token blocks exist');
  for (const block of [light[1], dark[1]]) {
    assert.ok(/--badge-bg:/.test(block), 'the light and dark themes declare --badge-bg');
    assert.ok(/--badge-text:/.test(block), 'the light and dark themes declare --badge-text');
  }
  const badge = rule('unread-badge');
  assert.ok(
    badge && /background:\s*var\(--badge-bg\)/.test(badge) && /color:\s*var\(--badge-text\)/.test(badge),
    'the badge consumes the theme tokens',
  );
});

test('long names, usernames and previews truncate instead of wrapping', () => {
  for (const selector of ['chat-name', 'chat-username', 'chat-preview']) {
    const body = rule(selector);
    assert.ok(body, `.${selector} is styled`);
    assert.ok(
      /white-space:\s*nowrap/.test(body) &&
        /overflow:\s*hidden/.test(body) &&
        /text-overflow:\s*ellipsis/.test(body),
      `.${selector} keeps single-line ellipsis truncation`,
    );
  }
  const identity = rule('chat-identity');
  assert.ok(identity && /overflow:\s*hidden/.test(identity), 'the identity line clips as one unit');
});

test('rows are separated by one inset hairline, not card borders', () => {
  const sep = css.match(/\.chat-row \+ \.chat-row::before\s*\{([^}]*)\}/);
  assert.ok(sep, 'the row separator exists');
  assert.ok(/left:\s*68px/.test(sep[1]), 'the hairline starts behind the avatar gutter');
  assert.ok(/height:\s*1px/.test(sep[1]), 'a hairline, not a heavy divider');
  const rowRule = rule('chat-row');
  assert.ok(rowRule && !/border(-|:)/.test(rowRule), 'rows carry no card borders');
});

test('the request state leads with a status dot on the preview line', () => {
  const body = css.match(/\.request-label::before\s*\{([^}]*)\}/);
  assert.ok(body, 'the request label has a leading marker');
  assert.ok(/border-radius:\s*50%/.test(body[1]), 'the marker is a small dot');
  assert.ok(
    home.includes('className="chat-preview request-label"'),
    'the request label replaces the preview on the same line',
  );
});

test('the empty state keeps one centered block with the existing primary action', () => {
  assert.ok(
    home.includes("t('home.nothingHere')") && home.includes("t('home.startChat')"),
    'the empty state keeps the existing copy',
  );
  assert.ok(
    home.includes('className="btn-primary empty-action"') && home.includes('onClick={openNewChat}'),
    'the empty-state action keeps opening the New chat destination',
  );
  for (const selector of ['empty', 'empty-title', 'empty-text', 'empty-action']) {
    assert.ok(rule(selector), `.${selector} is styled`);
  }
});
