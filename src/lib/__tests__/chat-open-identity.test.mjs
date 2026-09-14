// enough. — regression guards for identity rendering on Home -> Chat navigation.
//
// The overview already owns a resolved connection/profile pair. Opening that
// row must hand the pair to Chat before Home unmounts. Direct chat routes have
// no such handoff and must render an identity skeleton until the profile is
// available. Neither path may expose ellipsis fallback data as a real header.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isProfileReady } from '../helpers.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const readRel = (path) => fs.readFileSync(`${__dirname}/../../${path}`, 'utf8');
const app = readRel('App.tsx');
const home = readRel('components/Home.tsx');
const chat = readRel('components/Chat.tsx');
const css = readRel('index.css');

function section(source, start, end, length = 5000) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = end ? source.indexOf(end, from) : -1;
  return source.slice(from, to === -1 ? from + length : to);
}

test('the finished overview row hands its known identity to App before navigation', () => {
  const click = section(home, 'function handleRowClick', '/** Close the row menu');
  const handoff = click.indexOf('onOpenChat?.({');
  const navigation = click.indexOf('navigate(`#/chat/${conn.id}`)');

  assert.ok(handoff >= 0, 'row click hands off identity data');
  assert.ok(navigation > handoff, 'identity handoff occurs before the route changes');
  assert.match(click, /accountId:\s*me/);
  assert.match(click, /connection:\s*conn/);
  assert.match(click, /peer:\s*others\[otherUserId\(conn, me\)\] \?\? null/);
});

test('App preserves only the selected connection identity across the Home -> Chat remount', () => {
  assert.match(app, /useState<ChatOpenIdentity \| null>\(null\)/);
  assert.match(app, /chatOpenIdentity\?\.accountId === user\.id/);
  assert.match(app, /chatOpenIdentity\.connection\.id === chatConnectionId/);
  assert.match(app, /<Home onOpenChat=\{setChatOpenIdentity\} \/>/);
  assert.match(
    app,
    /<Chat connectionId=\{chatConnectionId\} initialIdentity=\{openingIdentity\} \/>/,
  );
});

test('Chat initializes and refreshes identity state from the overview handoff', () => {
  const initialization = section(chat, 'const openingIdentity', 'const [messages');
  assert.match(initialization, /initialIdentity\.accountId === user\?\.id/);
  assert.match(initialization, /initialIdentity\.connection\.id === connectionId/);
  assert.match(initialization, /openingIdentity\?\.connection \?\? null/);
  assert.match(initialization, /openingIdentity\?\.peer \?\? null/);

  const loadStart = section(chat, '/* ----------------------------- data load', '(async () => {');
  assert.match(loadStart, /setConn\(openingIdentity\?\.connection \?\? null\)/);
  assert.match(loadStart, /setPeer\(openingIdentity\?\.peer \?\? null\)/);
});

test('the chat header never renders ellipsis as a name or username', () => {
  const header = section(chat, '<header className="chat-header">', '<ThemeButton />');

  assert.ok(!header.includes("'…'"), 'header contains no ellipsis fallback literal');
  assert.ok(!header.includes("'...'"), 'header contains no three-dot fallback literal');
  assert.ok(!header.includes('displayName(peer)'), 'header does not call the fallback helper inline');
  assert.match(header, /<div className="chat-peer-name">\{headerName\}<\/div>/);
  assert.match(header, /`@\$\{peer!\.username\}`/);
});

test('the complete avatar/name header is gated by real identity data', () => {
  assert.equal(isProfileReady(null), false);
  assert.equal(isProfileReady({ id: 'peer', username: '' }), false);
  assert.equal(isProfileReady({ id: 'peer', username: '…' }), false);
  assert.equal(isProfileReady({ id: 'peer', username: '...' }), false);
  assert.equal(isProfileReady({ id: 'peer', username: 'benno' }), true);

  const derived = section(chat, 'const headerIdentityReady', '/* --------------------------- E2EE availability');
  assert.match(derived, /!!conn && \(ended \|\| isProfileReady\(peer\)\)/);

  const header = section(chat, '<header className="chat-header">', '<ThemeButton />');
  const guard = header.indexOf('headerIdentityReady ?');
  const avatar = header.indexOf('<Avatar name={headerName}', guard);
  const skeleton = header.indexOf('chat-header-identity-skeleton', guard);
  assert.ok(guard >= 0 && avatar > guard, 'Avatar is rendered only in the ready branch');
  assert.ok(skeleton > avatar, 'the unready branch follows the finished header branch');
});

test('missing identity renders a neutral header skeleton, not a default Avatar', () => {
  const header = section(chat, '<header className="chat-header">', '<ThemeButton />');
  const skeleton = section(
    header,
    '<div\n            className="chat-header-identity-skeleton"',
    null,
    900,
  );
  assert.match(skeleton, /aria-hidden="true"/);
  assert.match(skeleton, /chat-header-skeleton-avatar/);
  assert.match(skeleton, /chat-header-skeleton-line name/);
  assert.match(skeleton, /chat-header-skeleton-line username/);
  assert.ok(!skeleton.includes('<Avatar'), 'skeleton branch cannot render the default Avatar');

  const skeletonCss = section(css, '.chat-header-identity-skeleton', '/* Quiet, icon-only');
  assert.match(skeletonCss, /background:\s*var\(--surface-2\)/);
  assert.ok(!/background:\s*(green|#[0-9a-f]{3,8})/i.test(skeletonCss));
});

test('chat-open identity flow contains no artificial timeout or delay', () => {
  const click = section(home, 'function handleRowClick', '/** Close the row menu');
  const appFlow = section(app, 'const [chatOpenIdentity', 'const active:');
  const identityLoad = section(chat, 'const openingIdentity', '(async () => {');
  const headerDerived = section(
    chat,
    'const headerIdentityReady',
    '/* --------------------------- E2EE availability',
  );
  const headerRender = section(chat, '<header className="chat-header">', '<ThemeButton />');
  const flow = [click, appFlow, identityLoad, headerDerived, headerRender].join('\n');

  assert.ok(!flow.includes('setTimeout'), 'identity handoff/rendering uses no timeout');
  assert.ok(!flow.includes('await new Promise'), 'identity handoff/rendering uses no delay promise');
  assert.ok(!flow.includes('sleep('), 'identity handoff/rendering uses no sleep');
});
