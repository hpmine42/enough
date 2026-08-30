// enough. — P2-4 regression tests for data-layer error surfacing.
//
// Verifies that read-oriented API functions in src/lib/api.ts surface
// errors via an ApiResult wrapper instead of silently returning empty
// data (which would make the UI show "Nothing here yet" / "No one found"
// on network/database failures).
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/api-error-surface.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Source-level static assertions: verify the API function signatures include
// the ApiResult wrapper and never silently return empty on error.
// ---------------------------------------------------------------------------

const apiSource = fs.readFileSync(
  path.join(root, 'src', 'lib', 'api.ts'),
  'utf8',
);

test('ApiResult type is exported from api.ts', () => {
  assert.match(apiSource, /export type ApiResult<T>/);
});

test('searchUsers returns ApiResult and surfaces errors', () => {
  assert.match(
    apiSource,
    /function searchUsers[\s\S]*?Promise<ApiResult<Profile\[\]>>/,
  );
  const fn = extractFunction(apiSource, 'searchUsers');
  assert.doesNotMatch(fn, /if\s*\(\s*error\s*\)\s*return\s*\[\]/);
  assert.match(fn, /errorMessage\(error/);
});

test('getMyConnections returns ApiResult and surfaces errors', () => {
  assert.match(
    apiSource,
    /function getMyConnections[\s\S]*?Promise<ApiResult<Connection\[\]>>/,
  );
  const fn = extractFunction(apiSource, 'getMyConnections');
  assert.doesNotMatch(fn, /if\s*\(\s*error\s*\)\s*return\s*\[\]/);
  assert.match(fn, /errorMessage\(error/);
});

test('getProfiles returns ApiResult and surfaces errors', () => {
  assert.match(
    apiSource,
    /function getProfiles[\s\S]*?Promise<ApiResult<Record<string, Profile>>>/,
  );
  const fn = extractFunction(apiSource, 'getProfiles');
  assert.doesNotMatch(fn, /if\s*\(\s*error\s*\)\s*return\s*\{\}/);
  assert.match(fn, /errorMessage\(error/);
});

test('getLastMessages returns ApiResult and surfaces errors', () => {
  assert.match(
    apiSource,
    /function getLastMessages[\s\S]*?Promise<ApiResult<Record<string, Message>>>/,
  );
  const fn = extractFunction(apiSource, 'getLastMessages');
  assert.doesNotMatch(fn, /if\s*\(\s*error\s*\)\s*return\s*\{\}/);
  assert.match(fn, /errorMessage\(error/);
});

test('getMessagesPage includes error field and surfaces errors', () => {
  assert.match(
    apiSource,
    /function getMessagesPage[\s\S]*?error:\s*string\s*\|\s*null/,
  );
  const fn = extractFunction(apiSource, 'getMessagesPage');
  assert.doesNotMatch(
    fn,
    /if\s*\(\s*error\s*\)\s*return\s*\{\s*messages:\s*\[\],\s*hasMore:\s*false\s*\}/,
  );
  assert.match(fn, /errorMessage\(error/);
});

test('getBlockedUsers returns ApiResult and surfaces errors', () => {
  assert.match(
    apiSource,
    /function getBlockedUsers[\s\S]*?Promise<ApiResult<\{/,
  );
  const fn = extractFunction(apiSource, 'getBlockedUsers');
  assert.doesNotMatch(fn, /if\s*\(\s*error\s*\)\s*return\s*\[\]/);
  assert.match(fn, /errorMessage\(error/);
});

test('ApiResult on success returns error: null', () => {
  const fns = [
    'searchUsers',
    'getMyConnections',
    'getProfiles',
    'getLastMessages',
    'getBlockedUsers',
  ];
  for (const name of fns) {
    const fn = extractFunction(apiSource, name);
    assert.match(
      fn,
      /error:\s*null/,
      `${name} must return error: null on success`,
    );
  }
});

// ---------------------------------------------------------------------------
// Component-level static assertions: verify callers handle the error field.
// ---------------------------------------------------------------------------

const homeSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'Home.tsx'),
  'utf8',
);

test('Home.tsx surfaces load errors to the user', () => {
  assert.match(homeSource, /loadError/);
  assert.match(homeSource, /\.error\b/);
  assert.match(homeSource, /errors\.retry/);
});

const chatSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'Chat.tsx'),
  'utf8',
);

test('Chat.tsx surfaces load errors to the user', () => {
  assert.match(chatSource, /loadError/);
  assert.match(chatSource, /errors\.retry/);
  assert.match(chatSource, /result\.error/);
});

const settingsSource = fs.readFileSync(
  path.join(root, 'src', 'components', 'Settings.tsx'),
  'utf8',
);

test('Settings.tsx surfaces search errors', () => {
  assert.match(
    settingsSource,
    /searchUsers[\s\S]*?result\.error[\s\S]*?setSearchError/,
  );
});

// ---------------------------------------------------------------------------
// i18n assertions: required keys exist in both languages.
// ---------------------------------------------------------------------------

const translationsSource = fs.readFileSync(
  path.join(root, 'src', 'i18n', 'translations.ts'),
  'utf8',
);

test('i18n includes loadFailed, messagesLoadFailed, retry in English', () => {
  const enSection = translationsSource.slice(
    0,
    translationsSource.indexOf('de: {'),
  );
  assert.match(enSection, /loadFailed:/);
  assert.match(enSection, /messagesLoadFailed:/);
  assert.match(enSection, /retry:/);
});

test('i18n includes loadFailed, messagesLoadFailed, retry in German', () => {
  const deSection = translationsSource.slice(
    translationsSource.indexOf('de: {'),
  );
  assert.match(deSection, /loadFailed:/);
  assert.match(deSection, /messagesLoadFailed:/);
  assert.match(deSection, /retry:/);
});

// ---------------------------------------------------------------------------
// Helper: extract a function body from source by name.
// ---------------------------------------------------------------------------

function extractFunction(source, name) {
  const idx = source.indexOf(`function ${name}`);
  if (idx === -1) return '';
  // Find the opening brace of the function body (after the closing paren of
  // the parameter list). Skip over type annotations which may contain braces.
  let parenDepth = 0;
  let foundParams = false;
  let bodyStart = -1;
  for (let i = idx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth++;
      foundParams = true;
    } else if (ch === ')') {
      parenDepth--;
      if (foundParams && parenDepth === 0) {
        // Now skip past the return type annotation (if any) to find the
        // function body's opening brace. The return type may contain nested
        // braces (e.g., Promise<{...}>), so we need to track brace depth.
        let braceDepth = 0;
        let angleDepth = 0;
        for (let j = i + 1; j < source.length; j++) {
          const c = source[j];
          if (c === '<') angleDepth++;
          else if (c === '>') angleDepth--;
          else if (c === '{' && angleDepth > 0) braceDepth++;
          else if (c === '}' && angleDepth > 0) braceDepth--;
          else if (c === '{' && angleDepth === 0 && braceDepth === 0) {
            bodyStart = j;
            break;
          }
        }
        break;
      }
    }
  }
  if (bodyStart === -1) return source.slice(idx);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  return source.slice(idx);
}
