import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
  sanitizeMessagePlaintext,
} from '../input.ts';

const codePointLength = (value) => Array.from(value).length;

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf-8');
}

test('message sanitization keeps ordinary printable text literal across scripts', () => {
  for (const sample of [
    'Plain ASCII with braces {keep} and <angle> brackets.',
    'Grüße aus Köln',
    '你好，世界',
    'emoji stay literal 🚀🙂',
    'Cafe\u0301 stays decomposed',
  ]) {
    assert.equal(sanitizeMessagePlaintext(sample), sample);
  }
});

test('message sanitization normalizes CRLF, strips control characters, preserves tabs/newlines, and is idempotent', () => {
  const raw = 'Hello\r\nGrüße\u0000中\u0008\nTab\tkept\u000B and {braces} 🚀 Cafe\u0301\r';
  const once = sanitizeMessagePlaintext(raw);
  assert.equal(once, 'Hello\nGrüße中\nTab\tkept and {braces} 🚀 Cafe\u0301\n');
  assert.equal(sanitizeMessagePlaintext(once), once);
  assert.equal(sanitizeMessagePlaintext('\u0001\u0002'), '');
});

test('display-name sanitization keeps ordinary Unicode literal and trims or strips only the intended characters', () => {
  assert.equal(sanitizeDisplayName('Änne 🚀 你好 Cafe\u0301'), 'Änne 🚀 你好 Cafe\u0301');
  assert.equal(sanitizeDisplayName('  Alice  '), 'Alice');
  assert.equal(sanitizeDisplayName('  Alice\u0000\u0007 <b>{new}</b>\nBob  '), 'Alice  <b>{new}</b> Bob');
  assert.equal(sanitizeDisplayName('\u0000\u0007  \n'), '');
});

test('display-name sanitization preserves 60/61 Unicode code points unchanged before the DB enforces the limit', () => {
  const sixtyAscii = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH);
  const sixtyOneAscii = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1);
  assert.equal(codePointLength(sanitizeDisplayName(sixtyAscii)), MAX_DISPLAY_NAME_LENGTH);
  assert.equal(codePointLength(sanitizeDisplayName(sixtyOneAscii)), MAX_DISPLAY_NAME_LENGTH + 1);

  const sixtyEmoji = '🙂'.repeat(MAX_DISPLAY_NAME_LENGTH);
  const sixtyOneEmoji = '🙂'.repeat(MAX_DISPLAY_NAME_LENGTH + 1);
  assert.equal(codePointLength(sanitizeDisplayName(sixtyEmoji)), MAX_DISPLAY_NAME_LENGTH);
  assert.equal(codePointLength(sanitizeDisplayName(sixtyOneEmoji)), MAX_DISPLAY_NAME_LENGTH + 1);
});

test('outgoing message hardening happens once at the UI plaintext boundary, never in E2EE receive or transport code', () => {
  const composer = read('../../components/MessageComposer.tsx');
  const chat = read('../../components/Chat.tsx');
  const api = read('../api.ts');
  const messageFlow = read('../e2ee/message-flow.ts');
  const sessionManager = read('../e2ee/session-manager.ts');

  assert.match(composer, /sanitizeMessagePlaintext\(el\.value\)\.trim\(\)/);
  assert.equal(chat.includes('sanitizeMessagePlaintext'), false);
  assert.equal(api.includes('sanitizeMessagePlaintext'), false);
  assert.equal(messageFlow.includes('sanitizeMessagePlaintext'), false);
  assert.equal(sessionManager.includes('sanitizeMessagePlaintext'), false);
  assert.match(chat, /plaintext:\s*text,/);
  assert.match(api, /\.insert\(\{ connection_id: connectionId, sender_id: senderId, ciphertext \}\)/);
});

test('every repository display-name write path sanitizes before Auth or PostgREST writes', () => {
  const register = read('../../components/Register.tsx');
  const settings = read('../../components/Settings.tsx');
  const auth = read('../../context/AuthContext.tsx');
  const api = read('../api.ts');

  assert.match(register, /const cleanDisplayName = sanitizeDisplayName\(displayName\);/);
  assert.match(settings, /const name = sanitizeDisplayName\(nameDraft\);/);
  assert.match(auth, /const cleanDisplayName = sanitizeDisplayName\(displayName\);/);
  assert.match(auth, /data: \{ username, display_name: cleanDisplayName \}/);
  assert.match(auth, /const cleanName = sanitizeDisplayName\(name\);/);
  assert.match(auth, /display_name: cleanName/);
  assert.match(api, /const cleanDisplayName = displayName \? sanitizeDisplayName\(displayName\) : '';/);
  assert.match(api, /update\(\{ display_name: cleanDisplayName \}\)/);
});

test('0012 migration keeps the code-point limit authoritative and normalizes before checking it', () => {
  const sql = read('../../../supabase/migrations/0012_profile_input_hardening.sql');
  assert.match(sql, /normalize_display_name/);
  assert.match(sql, /btrim\(/);
  assert.match(sql, /char_length\(display_name\) <= 60/);
  assert.match(sql, /not valid/i);
  assert.match(sql, /Only display_name and identity_public_key may be changed\./);
  assert.match(sql, /requested := public\.normalize_display_name\(/);
  assert.match(sql, /new\.display_name := public\.normalize_display_name\(new\.display_name\);/);
  const normalizeIndex = sql.indexOf('new.display_name := public.normalize_display_name(new.display_name);');
  const limitIndex = sql.indexOf('char_length(new.display_name) > 60');
  assert.equal(normalizeIndex >= 0 && limitIndex > normalizeIndex, true);
  assert.equal(MAX_DISPLAY_NAME_LENGTH, 60);
});
