import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
  sanitizeMessagePlaintext,
} from '../input.ts';

test('display-name sanitization strips control characters, trims, and keeps printable text literal', () => {
  assert.equal(
    sanitizeDisplayName('  Alice\u0000\u0007 <b>{new}</b>\nBob  '),
    'Alice  <b>{new}</b> Bob',
  );
  assert.equal(sanitizeDisplayName('  Änne 🚀  '), 'Änne 🚀');
  assert.equal(sanitizeDisplayName('\u0000\u0007  \n'), '');
});

test('message sanitization preserves printable text/newlines and strips the remaining control characters', () => {
  assert.equal(
    sanitizeMessagePlaintext('Hello\r\n<b>{name}</b>\u0000\u0008\nTab\tkept'),
    'Hello\n<b>{name}</b>\nTab\tkept',
  );
  assert.equal(sanitizeMessagePlaintext('emoji 🚀 stay'), 'emoji 🚀 stay');
  assert.equal(sanitizeMessagePlaintext('\u0001\u0002'), '');
});

test('0012 migration exists and hardens display_name without changing the 0010 allow-list', () => {
  const sql = fs.readFileSync(
    new URL('../../../supabase/migrations/0012_profile_input_hardening.sql', import.meta.url),
    'utf-8',
  );
  assert.match(sql, /normalize_display_name/);
  assert.match(sql, /profiles_display_name_max_length/);
  assert.match(sql, /char_length\(display_name\) <= 60/);
  assert.match(sql, /not valid/i);
  assert.match(sql, /Only display_name and identity_public_key may be changed\./);
  assert.match(sql, /new\.display_name := public\.normalize_display_name\(new\.display_name\);/);
  assert.equal(MAX_DISPLAY_NAME_LENGTH, 60);
});
