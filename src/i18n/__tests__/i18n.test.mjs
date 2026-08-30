// enough. — i18n interpolation tests (audit F9 / P1-2)
//
// Run with:
//   npm run test:i18n
//   node --test --experimental-strip-types src/i18n/__tests__/i18n.test.mjs
//
// The bug: `t()` used to substitute placeholders sequentially
// (`str.split(`{${k}}`).join(String(v))` over `Object.entries(params)`). A
// value inserted by an earlier substitution was therefore still present when
// later placeholders were processed, so a parameter containing placeholder
// text was silently rewritten — and which placeholder got corrupted depended
// on the key order of the params object.
//
// Invariant under test:
//   Only placeholders of the ORIGINAL template may be substituted. Content
//   coming from a parameter value is data, never template source.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* Minimal browser surface the i18n module touches                      */
/* ------------------------------------------------------------------ */

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
globalThis.document = { documentElement: { lang: 'en' } };

const { t, getLang, setLang } = await import('../index.ts');

/** Every test starts from the default language. */
before(() => {
  setLang('en');
});
after(() => {
  setLang('en');
});

/** Run `fn` with the UI switched to German, then restore English. */
async function inGerman(fn) {
  setLang('de');
  try {
    assert.equal(getLang(), 'de', 'language switched to German');
    await fn();
  } finally {
    setLang('en');
    assert.equal(getLang(), 'en', 'language restored to English');
  }
}

/* ------------------------------------------------------------------ */
/* F9-1 — a parameter value that contains a later placeholder           */
/* ------------------------------------------------------------------ */

test('F9-1: a value containing a later placeholder is not re-interpolated', () => {
  // EN template: "{old} changed their name to {new}."
  const out = t('chat.nameChange', { old: 'Alice {new}', new: 'Bob' });
  assert.equal(out, 'Alice {new} changed their name to Bob.');
  assert.equal(out.includes('Alice Bob'), false, 'the old value must not be rewritten');
});

test('F9-1b: a value containing several placeholder-looking sequences stays literal', () => {
  const out = t('chat.nameChange', {
    old: 'Alice {new}{old}{count}{username}{x} {',
    new: 'Bob',
  });
  assert.equal(out, 'Alice {new}{old}{count}{username}{x} { changed their name to Bob.');
});

test('F9-1c: insertion order of the parameters cannot change the result', () => {
  const forward = t('chat.nameChange', { old: 'Alice {new}', new: 'Bob' });
  const reverse = t('chat.nameChange', { new: 'Bob', old: 'Alice {new}' });
  assert.equal(forward, reverse, 'result must not depend on parameter key order');
  assert.equal(reverse, 'Alice {new} changed their name to Bob.');
});

/* ------------------------------------------------------------------ */
/* F9-2 — reverse dependency (later key holds an earlier placeholder)   */
/* ------------------------------------------------------------------ */

test('F9-2: a value containing an earlier placeholder is not re-interpolated', () => {
  // Reverse insertion order: the old implementation substituted `{new}`
  // first, so the `{old}` inside that value was rewritten afterwards.
  const out = t('chat.nameChange', { new: 'Bob {old}', old: 'Alice' });
  assert.equal(out, 'Alice changed their name to Bob {old}.');
  assert.equal(out.includes('Bob Alice'), false, 'the new value must not be rewritten');
});

test('F9-2b: the same parameters in the other order give the same result', () => {
  const a = t('chat.nameChange', { new: 'Bob {old}', old: 'Alice' });
  const b = t('chat.nameChange', { old: 'Alice', new: 'Bob {old}' });
  assert.equal(a, b);
  assert.equal(a, 'Alice changed their name to Bob {old}.');
});

/* ------------------------------------------------------------------ */
/* F9-3 — repeated placeholders                                        */
/* ------------------------------------------------------------------ */

test('F9-3: a repeated placeholder is substituted at every occurrence', () => {
  // No shipped translation repeats a placeholder, so the template is passed
  // as the key: `resolve()` returns an unknown key verbatim (documented
  // fallback), which lets this case exercise the real interpolation.
  const out = t('{name} / {name}', { name: 'Alice {name}' });
  assert.equal(out, 'Alice {name} / Alice {name}');
});

test('F9-3b: a value containing its own placeholder stays literal', () => {
  // EN template: "@{username} deleted this message."
  const out = t('chat.deletedForEveryoneOther', { username: 'ann {username} bee' });
  assert.equal(out, '@ann {username} bee deleted this message.');
});

/* ------------------------------------------------------------------ */
/* F9-4 — ordinary interpolation is unchanged                          */
/* ------------------------------------------------------------------ */

test('F9-4: ordinary interpolation is unchanged (EN)', () => {
  assert.equal(t('chat.nameChange', { old: 'Alice', new: 'Bob' }), 'Alice changed their name to Bob.');
  assert.equal(
    t('chat.deletedForEveryoneOther', { username: 'ann' }),
    '@ann deleted this message.',
  );
  assert.equal(
    t('chat.acceptedConnection', { username: 'ann' }),
    '@ann accepted your connection.',
  );
  assert.equal(t('connection.requestDeclinedNote', { date: '2026-01-02' }).includes('2026-01-02'), true);
});

test('F9-4b: ordinary interpolation is unchanged (DE)', async () => {
  await inGerman(async () => {
    assert.equal(t('chat.nameChange', { old: 'Alice', new: 'Bob' }), 'Alice heißt jetzt Bob.');
    assert.equal(
      t('chat.deletedForEveryoneOther', { username: 'ann' }),
      '@ann hat diese Nachricht gelöscht.',
    );
  });
});

test('F9-4c: translations without parameters are returned verbatim', () => {
  assert.equal(t('chat.deletedForEveryoneSelf'), 'You deleted this message.');
  assert.equal(t('chat.acceptedConnectionSelf'), 'You accepted the connection.');
});

/* ------------------------------------------------------------------ */
/* F9-5 — non-string values                                            */
/* ------------------------------------------------------------------ */

test('F9-5: numeric parameters keep the String() behaviour', () => {
  assert.equal(t('unread.unreadCount', { count: 5 }), '5 new');
  assert.equal(t('unread.unreadCount', { count: 0 }), '0 new');
  assert.equal(t('unread.unreadCount', { count: -3 }), '-3 new');
  assert.equal(t('unread.unreadCount', { count: 1.5 }), '1.5 new');
});

test('F9-5b: other primitives are stringified, not dropped', () => {
  // The public signature is `Record<string, string | number>`; the runtime
  // behaviour is `String(value)` for whatever is passed.
  const params = /** @type {any} */ ({ old: true, new: false });
  assert.equal(t('chat.nameChange', params), 'true changed their name to false.');
});

test('F9-5c: empty-string values are inserted as empty strings', () => {
  assert.equal(t('chat.nameChange', { old: '', new: 'Bob' }), ' changed their name to Bob.');
  assert.equal(t('chat.nameChange', { old: 'Alice', new: '' }), 'Alice changed their name to .');
});

/* ------------------------------------------------------------------ */
/* F9-6 — missing / unused parameters                                  */
/* ------------------------------------------------------------------ */

test('F9-6: a missing parameter leaves its placeholder verbatim (unchanged policy)', () => {
  assert.equal(t('chat.nameChange', { old: 'Alice' }), 'Alice changed their name to {new}.');
  assert.equal(t('chat.nameChange', { new: 'Bob' }), '{old} changed their name to Bob.');
});

test('F9-6b: unused parameters are ignored', () => {
  assert.equal(
    t('chat.nameChange', { old: 'Alice', new: 'Bob', extra: '{old}' }),
    'Alice changed their name to Bob.',
  );
});

test('F9-6c: no parameters at all returns the template verbatim', () => {
  assert.equal(t('chat.nameChange'), '{old} changed their name to {new}.');
  assert.equal(t('chat.nameChange', {}), '{old} changed their name to {new}.');
});

test('F9-6d: unknown keys fall back to EN and preserve lookup behaviour', () => {
  assert.equal(t('does.not.exist'), 'does.not.exist');
  assert.equal(getLang(), 'en');
});

test('F9-6e: placeholders are never resolved from the object prototype', () => {
  // `{toString}` / `{constructor}` are not own properties of the params
  // object, so they are left verbatim instead of stringifying a function.
  const key = '@{toString} deleted this message.';
  assert.equal(t(key, { username: 'ann' }), key);
  assert.equal(t(key, {}), key);
});

/* ------------------------------------------------------------------ */
/* F9-7 — the real system-message path (MessageBubble + SQL trigger)    */
/* ------------------------------------------------------------------ */

// Mirrors `MessageBubble.tsx` / `Home.tsx`: the display names come verbatim
// from `messages.meta` (`on_profile_display_name_change` in migration 0001).
function nameChangeMessage(meta) {
  return t('chat.nameChange', {
    old: meta?.old_name ?? '',
    new: meta?.new_name ?? '',
  });
}

test('F9-7: a display name containing "{new}" survives the system message (EN)', () => {
  const out = nameChangeMessage({ old_name: 'Alice {new}', new_name: 'Bob' });
  assert.equal(out, 'Alice {new} changed their name to Bob.');
});

test('F9-7b: the same system message in German', async () => {
  await inGerman(async () => {
    const out = nameChangeMessage({ old_name: 'Alice {new}', new_name: 'Bob' });
    assert.equal(out, 'Alice {new} heißt jetzt Bob.');
  });
});

test('F9-7c: a display name containing "{old}" survives the system message', () => {
  const out = nameChangeMessage({ old_name: 'Alice', new_name: 'Bob {old}' });
  assert.equal(out, 'Alice changed their name to Bob {old}.');
});

test('F9-7d: missing meta renders the empty-name fallback without corrupting the template', () => {
  assert.equal(nameChangeMessage(undefined), ' changed their name to .');
  assert.equal(nameChangeMessage({ old_name: 'Alice' }), 'Alice changed their name to .');
});

/* ------------------------------------------------------------------ */
/* F9-8 — output stays data: no escaping, no evaluation                */
/* ------------------------------------------------------------------ */

test('F9-8: values are inserted literally (escaping stays React\'s job)', () => {
  const raw = '<img src=x onerror=alert(1)>';
  const out = t('chat.nameChange', { old: raw, new: 'Bob' });
  assert.equal(out, `${raw} changed their name to Bob.`, 't() neither escapes nor alters values');
  assert.equal(out.includes('&lt;'), false, 'no HTML escaping is introduced by t()');
});

test('F9-8b: replacement-pattern characters in values are inserted literally', () => {
  const raw = "$& $1 $` $' $$";
  const out = t('chat.nameChange', { old: raw, new: 'Bob' });
  assert.equal(out, `${raw} changed their name to Bob.`);
});

/* ------------------------------------------------------------------ */
/* F9-9 — determinism / language selection                             */
/* ------------------------------------------------------------------ */

test('F9-9: repeated calls are deterministic (no interpolation state)', () => {
  const params = { old: 'Alice {new}', new: 'Bob' };
  const first = t('chat.nameChange', params);
  const second = t('chat.nameChange', params);
  const third = t('chat.nameChange', { ...params });
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(first, 'Alice {new} changed their name to Bob.');
  assert.equal(params.old, 'Alice {new}', 'parameter values are not mutated');
});

test('F9-9b: EN/DE selection is unchanged', async () => {
  assert.equal(getLang(), 'en');
  assert.equal(t('settings'), 'Settings');
  await inGerman(async () => {
    assert.equal(t('settings'), 'Einstellungen');
    // Unknown keys fall back to English in every language.
    assert.equal(t('does.not.exist'), 'does.not.exist');
  });
  assert.equal(getLang(), 'en');
});

/* ------------------------------------------------------------------ */
/* F10 — Supabase's `same_password` reuse error vs. `weak_password`    */
/*                                                                    */
/* Both come back from `updateUser({ password })` and both are worded */
/* by GoTrue as "Password should be …", so the user-facing texts must */
/* stay distinguishable; errors.ts maps them to these two keys.       */
/* ------------------------------------------------------------------ */

const REUSE_EN = 'The new password must be different from your current password.';
const REUSE_DE = 'Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.';
const WEAK_EN = 'The password is too weak.';
const WEAK_DE = 'Das Passwort ist zu schwach.';

test('F10-1: errors.samePassword is translated in both languages', async () => {
  assert.equal(t('errors.samePassword'), REUSE_EN);
  assert.equal(t('errors.weakPassword'), WEAK_EN);
  // A missing DE key would silently fall back to the EN value, so the DE
  // strings have to be asserted in German, not just compared with EN.
  await inGerman(async () => {
    assert.equal(t('errors.samePassword'), REUSE_DE);
    assert.equal(t('errors.weakPassword'), WEAK_DE);
  });
});

test('F10-1b: reuse and strength are reported as different problems', async () => {
  assert.notEqual(t('errors.samePassword'), t('errors.weakPassword'));
  await inGerman(async () => {
    assert.notEqual(t('errors.samePassword'), t('errors.weakPassword'));
  });
});

test('F10-1c: the reuse text tells the user to pick a different password', async () => {
  assert.match(t('errors.samePassword'), /different/i);
  await inGerman(async () => {
    assert.match(t('errors.samePassword'), /unterscheiden/i);
    // It must not read like a strength complaint.
    assert.doesNotMatch(t('errors.samePassword'), /schwach/i);
  });
});
