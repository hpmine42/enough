#!/usr/bin/env node
/**
 * Native-browser complement to npm run smoke (run that first to build
 * .smoke-dist). No live backend or credentials; all Supabase calls are stubbed.
 * jsdom cannot implement native inert, Tab navigation or the browser AX tree.
 *
 * Uses an externally provided Playwright module + installed Chromium without
 * adding application dependencies:
 * PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * CHROMIUM_PATH=/path/to/chromium node scripts/smoke-settings-browser.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.PLAYWRIGHT_MODULE || !process.env.CHROMIUM_PATH) {
  throw new Error('Provide PLAYWRIGHT_MODULE and CHROMIUM_PATH; see this script header.');
}
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href);
const root = resolve('.smoke-dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = resolve(root, `.${new URL(req.url, 'http://smoke.local').pathname}`);
  if (path !== root && !path.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try {
    const file = path === root ? `${root}/index.html` : path;
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '0.0.0.0', done));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; console.log(`  ✓ ${message}`); }
const profile = { id: 'user-1', username: 'anna', display_name: 'Anna Müller' };
const user = { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'anna@example.com',
  email_confirmed_at: new Date().toISOString(), user_metadata: { username: 'anna' } };
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...user, sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.smoke`;
const session = { access_token: access, refresh_token: 'smoke-refresh', user, token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 };
try {
  console.log(`Native Settings smoke — Chromium ${browser.version()}`);
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion,
      serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('https://xyzcompany.supabase.co/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      let body = [];
      let status = 200;
      if (url.pathname.endsWith('/auth/v1/user')) body = user;
      else if (url.pathname.endsWith('/auth/v1/token')) body = session;
      else if (url.pathname.endsWith('/profiles')) {
        body = req.headers().accept?.includes('pgrst.object') ? profile : [profile];
      } else if (url.pathname.includes('/crypto_') || url.pathname.includes('/rpc/')) {
        body = { message: 'No crypto backend in the Settings-only browser fixture' };
        status = 404;
      }
      await route.fulfill({ status, contentType: 'application/json',
        headers: { 'content-range': '0-0/0' }, body: JSON.stringify(body) });
    });
    await page.addInitScript((value) => {
      localStorage.setItem('enough-lang', 'en');
      localStorage.setItem('sb-xyzcompany-auth-token', JSON.stringify(value));
    }, session);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.home-screen').waitFor();
    await page.locator('.app-stage button').first().focus();
    await page.evaluate(() => { window.__homeFocus = document.activeElement; });
    await page.locator('[data-nav="settings"]').click();
    const overview = page.locator('[data-pane="settings"]');
    const opener = overview.locator('[data-category="profile"]');
    await opener.click();
    const pane = page.locator('[data-focus-region="settings-profile"]');
    await pane.locator('input').first().waitFor();
    await page.waitForFunction(() => document.querySelector('[data-focus-region="settings-profile"]')?.contains(document.activeElement), null, { timeout: 3000 });
    check(await overview.evaluate((el) => el.inert && el.getAttribute('aria-hidden') === 'true'),
      `${reducedMotion}: covered overview is natively inert and accessibility-hidden`);
    check(await page.locator('.app-stage').evaluate((el) => el.inert), 'covered stage is natively inert');
    check(await pane.evaluate((el) => !el.inert && el.contains(document.activeElement)), 'focus enters visible Profile');

    // AX assertions check actual browser exposure, not only DOM attributes.
    const cdp = await context.newCDPSession(page);
    async function axNodes(selector) {
      const { root: documentNode } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector });
      assert.ok(nodeId, `AX target exists: ${selector}`);
      return (await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })).nodes;
    }
    check((await axNodes('[data-pane="settings"] [data-category="profile"]')).every((n) => n.ignored),
      'covered overview opener is excluded from the Chromium accessibility tree');
    check((await axNodes('.app-stage button')).every((n) => n.ignored),
      'covered stage control is excluded from the Chromium accessibility tree');
    check((await axNodes('[data-focus-region="settings-profile"] input')).some((n) => !n.ignored && n.role?.value === 'textbox'),
      'visible Profile textbox remains exposed in the accessibility tree');

    await pane.locator('button').first().focus();
    const focusBefore = await page.evaluate(() => document.activeElement.outerHTML);
    await opener.evaluate((el) => el.focus());
    check(await page.evaluate(() => document.activeElement.outerHTML) === focusBefore,
      'native inert rejects programmatic focus into the covered overview');
    for (const key of ['Tab', 'Shift+Tab']) {
      const visited = new Set();
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press(key);
        const state = await page.evaluate(() => {
          const active = document.activeElement;
          return { hidden: !!active.closest('[inert], [aria-hidden="true"]'),
            region: active.closest('[data-focus-region]')?.dataset.focusRegion ?? null,
            control: active.outerHTML };
        });
        assert.equal(state.hidden, false, `${key} must never focus an inert/hidden ancestor`);
        assert.ok(state.region === 'settings-profile' || state.region === null,
          `${key} must stay on the visible page (or browser chrome), got ${state.region}`);
        if (state.region) visited.add(state.control);
      }
      check(visited.size >= 4, `real ${key} navigates visible Profile controls, never a covered layer`);
    }
    await pane.locator('button').first().click();
    await page.waitForFunction(() => document.activeElement?.dataset.category === 'profile');
    check(await opener.evaluate((el) => el === document.activeElement && !el.closest('[inert]')),
      'closing Profile restores its exact accessible opener');

    await overview.locator('[data-category="people"]').click();
    const people = page.locator('[data-focus-region="settings-people"]');
    const blockedOpener = people.getByRole('button', { name: /Blocked users/ });
    await blockedOpener.click();
    const nested = page.locator('.settings-subpanel-nested.open');
    await nested.waitFor();
    check(await people.evaluate((el) => el.inert), 'nested page makes underlying People inert');
    check(await nested.evaluate((el) => !el.inert && el.contains(document.activeElement)), 'nested page owns focus');
    await page.keyboard.press('Tab');
    check(await nested.evaluate((el) => el.contains(document.activeElement)), 'real Tab stays on nested page');
    await page.keyboard.press('Shift+Tab');
    check(await nested.evaluate((el) => el.contains(document.activeElement)), 'real Shift+Tab stays on nested page');
    await nested.locator('button').first().click();
    await page.waitForFunction(() => document.activeElement?.textContent.includes('Blocked users'));
    check(await blockedOpener.evaluate((el) => el === document.activeElement), 'nested Back restores the blocked-list opener');
    await people.locator('button').first().click();
    await page.waitForFunction(() => document.activeElement?.dataset.category === 'people');

    // Pause CSS animations to inspect isolation in the departing frame.
    // The application's existing 400ms cleanup fallback remains in force.
    await page.addStyleTag({ content: '.settings-pane { animation-play-state: paused !important; }' });
    await page.locator('[data-nav="new-chat"]').click();
    await page.waitForFunction(() => document.querySelector('[data-pane="settings"]')?.dataset.paneState === 'leaving');
    check(await overview.evaluate((el) => el.inert && el.getAttribute('aria-hidden') === 'true'), 'outgoing Settings pane is inert during its exit');
    check((await axNodes('[data-pane="settings"] [data-category="profile"]')).every((n) => n.ignored),
      'outgoing pane is excluded from the native accessibility tree');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => !document.activeElement.closest('[inert], [aria-hidden="true"]')), 'Tab during transition never enters outgoing pane');
    await page.locator('[data-nav="settings"]').click();
    await page.waitForFunction(() => document.querySelector('[data-pane="new-chat"]')?.dataset.paneState === 'leaving');
    check(await page.locator('[data-pane="new-chat"]').evaluate((el) => el.inert), 'rapid reverse swap also isolates outgoing New chat');
    await overview.locator('button').first().click();
    await page.waitForFunction(() => !document.querySelector('.settings-overlay').classList.contains('open'));
    check(await page.locator('.settings-overlay').evaluate((el) => el.inert), 'closing overlay is inert before its animation ends');
    check(await page.evaluate(() => document.activeElement === window.__homeFocus && !document.activeElement.closest('[inert]')),
      'closing overlay restores the previous Home control');
    await cdp.detach();
    await context.close();
  }
  console.log(`Native Settings smoke passed: ${checks} checks, both motion preferences, no screenshots.`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
