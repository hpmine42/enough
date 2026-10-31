import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const css = readFileSync(join(root, 'src/styles/19-responsive.css'), 'utf8');

function mediaBlock(minWidth) {
  const start = css.indexOf(`@media (min-width: ${minWidth}px)`);
  assert.notEqual(start, -1, `desktop breakpoint ${minWidth}px exists`);
  const nextMedia = css.indexOf('@media ', start + 1);
  return css.slice(start, nextMedia === -1 ? undefined : nextMedia);
}

test('desktop screens expand while keeping warm, centered surfaces', () => {
  const tablet = mediaBlock(760);
  assert.match(tablet, /\.auth-screen\s*\{[^}]*max-width:\s*520px/s);
  assert.match(tablet, /\.home-screen\s*\{[^}]*max-width:\s*760px/s);
  assert.match(tablet, /\.chat-screen\s*\{[^}]*max-width:\s*960px/s);
  assert.match(tablet, /background:\s*var\(--surface\)/);
  assert.match(tablet, /box-shadow:\s*var\(--shadow-1\)/);
});

test('desktop chat content remains readable in wider windows', () => {
  const tablet = mediaBlock(760);
  const large = mediaBlock(1200);
  assert.match(tablet, /\.message\s*\{[^}]*max-width:\s*min\(78%,\s*680px\)/s);
  assert.match(tablet, /\.composer\s*\{[^}]*calc\(\(100% - 760px\) \/ 2\)/s);
  assert.match(large, /\.home-screen\s*\{[^}]*max-width:\s*880px/s);
  assert.match(large, /\.chat-screen\s*\{[^}]*max-width:\s*1120px/s);
  assert.match(large, /\.message\s*\{[^}]*max-width:\s*min\(78%,\s*740px\)/s);
  assert.match(large, /calc\(\(100% - 820px\) \/ 2/);
});
