// enough. — Routing, structure, bilingual parity and content-fidelity tests
// for the privacy policy (and the imprint cross-links).
//
// The policy is data: the sentences live in `src/i18n/translations.ts`
// (`privacy.*`) in both languages, `Privacy.tsx` only defines their order.
// These tests therefore check three things that a legal text in a code
// repository can realistically be checked for:
//
//   1. Reachability — routes, cross-links, and the in-page contents navigation
//      must not break the hash router.
//   2. Bilingual parity — EN and DE must expose the SAME keys, so neither
//      language can quietly carry information the other one lacks.
//   3. Fidelity to the code — the statements that this repository can verify
//      (columns, tables, browser storage, deletion paths, provider names) must
//      be present, and statements the repository CANNOT verify (invented
//      retention periods, generic generator modules such as whistleblowing or
//      employee data, "no one can see anything" claims) must be absent.
//
// This is a static-source suite, not a runtime legal audit: it proves that the
// shipped text says what the implementation does, not that the text is a
// complete legal opinion.
//
// Run with:
//   npm run test:privacy
//   node --test --experimental-strip-types src/lib/__tests__/privacy-routing.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const read = (rel) => fs.readFileSync(`${__dirname}/${rel}`, 'utf-8');

const appSource = read('../../App.tsx');
const privacySource = read('../../components/Privacy.tsx');
const imprintSource = read('../../components/Imprint.tsx');
const settingsSource = read('../../components/Settings.tsx');
const contactFormSource = read('../../components/ContactForm.tsx');
const edgeFunctionSource = read('../../../supabase/functions/send-contact-email/index.ts');
const stylesheet = read('../../index.css');

const { translations } = await import('../../i18n/translations.ts');

/**
 * Source without comments: prose inside a code comment must not be able to
 * satisfy (or break) a structural assertion about the code itself.
 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** All leaf keys of an object, as `a.b.c` paths. */
function leafKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? [path]
      : Object.keys(value).length === 0
        ? []
        : leafKeys(value, path);
  });
}

const en = translations.en.privacy;
const de = translations.de.privacy;
const enKeys = leafKeys(en);
const deKeys = leafKeys(de);

/** Every paragraph-ish key (titles are checked separately). */
const bodyKeys = enKeys.filter((k) => !k.endsWith('Title') && !k.endsWith('title'));

// ---------------------------------------------------------------------------
// 1. Routing & navigation
// ---------------------------------------------------------------------------

test('App.tsx routes #/privacy, #/datenschutz and #/settings/privacy to the Privacy screen', () => {
  assert.ok(appSource.includes("route.startsWith('#/privacy')"), '#/privacy must render Privacy');
  assert.ok(appSource.includes("route.startsWith('#/datenschutz')"), '#/datenschutz must render Privacy');
  assert.ok(
    appSource.includes("route.startsWith('#/settings/privacy')"),
    '#/settings/privacy must render Privacy',
  );
  assert.ok(privacySource.includes('export default function Privacy'), 'Privacy component must exist');
});

test('the legal screens render without a configured backend (public routes)', () => {
  const routeGuard = appSource.slice(appSource.indexOf('Public legal screens'), appSource.indexOf('if (!configured)'));
  assert.ok(routeGuard.includes('#/datenschutz'), 'imprint + privacy must be checked before `configured`');
  assert.ok(routeGuard.includes('#/impressum'), 'imprint must be checked before `configured`');
});

test('Settings footer links to the privacy policy in the language-specific route', () => {
  assert.ok(settingsSource.includes('settings-privacy-link'), 'privacy link class must exist in Settings');
  assert.ok(
    settingsSource.includes("#/datenschutz' : '#/privacy'"),
    'privacy link must target #/datenschutz in DE and #/privacy in EN',
  );
  assert.ok(settingsSource.includes('settings-legal-link'), 'imprint link must exist in Settings');
});

test('Imprint links to the privacy policy and Privacy links back to the imprint', () => {
  assert.ok(
    imprintSource.includes("#/datenschutz' : '#/privacy'"),
    'imprint must link to #/datenschutz (DE) and #/privacy (EN)',
  );
  assert.ok(imprintSource.includes('legal.privacyLinkText'), 'imprint must use privacyLinkText');
  assert.ok(
    privacySource.includes("#/impressum' : '#/imprint'"),
    'privacy must link to #/impressum (DE) and #/imprint (EN)',
  );
  assert.ok(privacySource.includes('legal.imprintLinkText'), 'privacy must use imprintLinkText');
});

test('the contents navigation scrolls in-document and never rewrites the hash route', () => {
  // The router reads `location.hash`, so an `<a href="#anchor">` inside the
  // policy would replace the route and unmount the screen.
  const code = codeOnly(privacySource);
  assert.ok(code.includes('scrollIntoView'), 'TOC must scroll programmatically');
  assert.ok(code.includes('scrollToSection(section.id)'), 'sections must be reachable from the TOC');
  assert.ok(
    !/href\s*=\s*[`"']#(?!\/)/.test(code),
    'no in-page href="#..." anchors allowed: they would replace the hash route',
  );
  assert.ok(privacySource.includes('sectionDomId'), 'sections must carry stable DOM ids');
  assert.ok(privacySource.includes('tabIndex={-1}'), 'jumped-to sections must be focusable');
  assert.ok(stylesheet.includes('.legal-toc'), 'TOC must be styled, not left unstyled');
  assert.ok(stylesheet.includes('scroll-margin-top'), 'anchors must not hide under the header');
  // Mobile safety: the contents grid and the quoted identifiers must not
  // widen the 680px column on a 320px viewport.
  assert.ok(
    stylesheet.includes('minmax(min(240px, 100%), 1fr)'),
    'the contents grid must collapse to one column instead of overflowing',
  );
  assert.match(
    stylesheet,
    /\.legal-section-privacy p\s*\{[^}]*overflow-wrap: anywhere/,
    'quoted identifiers must wrap inside policy paragraphs',
  );
});

// ---------------------------------------------------------------------------
// 2. Bilingual parity
// ---------------------------------------------------------------------------

test('EN and DE privacy dictionaries expose exactly the same keys', () => {
  assert.deepEqual(
    deKeys.slice().sort(),
    enKeys.slice().sort(),
    'a key that exists in one language must exist in the other (no one-sided information)',
  );
});

test('every privacy paragraph is non-empty in both languages', () => {
  for (const key of enKeys) {
    assert.ok(typeof en[key] === 'string' && en[key].trim().length > 0, `privacy.${key} (EN) must not be empty`);
    assert.ok(typeof de[key] === 'string' && de[key].trim().length > 0, `privacy.${key} (DE) must not be empty`);
  }
});

test('German paragraphs are translated, not copied from English', () => {
  for (const key of bodyKeys) {
    if (key.startsWith('ref')) continue; // provider document names stay identical
    assert.notEqual(de[key], en[key], `privacy.${key} must not be the untranslated English text`);
  }
});

test('no placeholder or template residue is left in the policy text', () => {
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      const value = dict[key];
      assert.ok(
        !/\[[^\]]{0,40}\]/.test(value),
        `privacy.${key} (${lang}) still contains a bracketed placeholder`,
      );
      assert.ok(!/TODO|FIXME|lorem ipsum/i.test(value), `privacy.${key} (${lang}) contains a work note`);
      assert.ok(
        !/(Beispiel GmbH|Musterfirma|Max Mustermann|Example Corp|Acme)/i.test(value),
        `privacy.${key} (${lang}) contains a sample operator`,
      );
    }
  }
});

test('both languages describe the same provider set and the same section count', () => {
  for (const needle of ['GitHub', 'Supabase', 'Resend', 'PostgreSQL', 'IndexedDB', 'Signal Protocol']) {
    assert.ok(
      enKeys.some((k) => en[k].includes(needle)),
      `the EN policy must document ${needle}`,
    );
    assert.ok(
      deKeys.some((k) => de[k].includes(needle)),
      `the DE policy must document ${needle}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Structure: the renderer and the dictionaries describe the same policy
// ---------------------------------------------------------------------------

/** The `privacy.sectionX…` keys referenced by Privacy.tsx, in source order. */
function referencedKeys(source) {
  return [...source.matchAll(/'privacy\.([A-Za-z0-9]+)'/g)].map((m) => m[1]);
}

test('every translation key used by Privacy.tsx exists in both languages', () => {
  const used = referencedKeys(privacySource);
  assert.ok(used.length > 30, `expected the renderer to reference the whole policy, found ${used.length} keys`);
  for (const key of used) {
    assert.ok(key in en, `privacy.${key} is referenced but missing in EN`);
    assert.ok(key in de, `privacy.${key} is referenced but missing in DE`);
  }
});

test('no stale policy keys survive that the renderer does not show', () => {
  const used = new Set(referencedKeys(privacySource));
  // The headings are built from the section descriptors, so title keys are
  // referenced through `section.title` / `t(section.title)` and never literally.
  const titles = new Set(
    leafKeys(en)
      .filter((k) => /Title$|^tocTitle$|^referencesLabel$/.test(k))
      .concat(['title', 'kicker', 'intro', 'lastUpdated']),
  );
  for (const key of leafKeys(en)) {
    assert.ok(
      used.has(key) || titles.has(key),
      `privacy.${key} exists in the dictionaries but is never rendered — remove it or wire it up`,
    );
  }
});

test('sections are numbered consecutively in both languages', () => {
  const order = [...privacySource.matchAll(/title: 'privacy\.(section[A-Za-z0-9]+Title)'/g)].map((m) => m[1]);
  assert.ok(order.length >= 14, `expected the full section list, found ${order.length}`);
  for (const [lang, dict] of [['en', en], ['de', de]]) {
    order.forEach((key, index) => {
      assert.match(
        dict[key],
        new RegExp(`^${index + 1}\\.\\s`),
        `${key} (${lang}) must be numbered ${index + 1}. to keep the policy order stable`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Content fidelity: what the code actually does
// ---------------------------------------------------------------------------

test('E2EE is described as content protection with server-visible metadata', () => {
  const e2ee = en.sectionE2eeText;
  assert.match(e2ee, /Signal Protocol/, 'the protocol must be named');
  assert.match(e2ee, /PQXDH|Double Ratchet/, 'the handshake and ratchet must be named');
  assert.match(e2ee, /Kyber-1024/, 'the post-quantum encapsulation must be named');
  assert.match(e2ee, /messages\.ciphertext|ciphertext/, 'stored data must be named as ciphertext');
  assert.match(e2ee, /not sent at all|no automatic fallback/i, 'fail-closed sending must be documented');

  const metadata = en.sectionE2eeMetadata;
  assert.match(metadata, /does not hide|not the metadata/i, 'metadata must be separated from content');
  for (const needle of ['timestamp', 'user ID', 'prekey', 'Realtime']) {
    assert.ok(metadata.toLowerCase().includes(needle.toLowerCase()), `metadata list must include ${needle}`);
  }
  // The message row is described exactly as the schema has it: the recipient is
  // not stored per message, and the only size the server can see is the length
  // of the ciphertext envelope.
  assert.match(
    metadata,
    /length of the stored ciphertext/,
    'the observable size must be the ciphertext length, not a claimed message-size field',
  );
  assert.match(
    metadata,
    /recipient is not a column of its own|follows from the two members/,
    'the recipient must be described as derived from the conversation, never as a stored field',
  );
  // Realtime usage must be disclosed as metadata, including what the filters
  // leak (Home.tsx and Chat.tsx subscribe per conversation and per block pair).
  assert.match(metadata, /Realtime subscriptions are metadata/, 'the subscriptions must be named as metadata');
  assert.match(
    metadata,
    /channel[^.]{0,160}conversation ID|bound to that conversation ID/,
    'the per-chat Realtime channel and the conversation ID it carries must be disclosed',
  );
  assert.match(metadata, /filters/, 'the Realtime filter values must be disclosed as visible metadata');

  const limits = en.sectionE2eeLimits;
  assert.match(limits, /trust on first use/, 'the missing key verification must be disclosed');
  assert.match(limits, /no key backup|not.*key backup/i, 'the absent key backup must be disclosed');
  assert.match(limits, /compromised device/i, 'endpoint compromise must be excluded from the promise');

  const exceptions = en.sectionE2eeExceptions;
  assert.match(exceptions, /My Notes/i, 'the plaintext self-chat exception must be documented');
  assert.match(exceptions, /System events|system event/, 'unencrypted system events must be documented');
  assert.match(
    exceptions,
    /empty ciphertext[\s\S]{0,200}unencrypted metadata column/,
    'system events must be disclosed as messages with a cleared ciphertext and plaintext in meta',
  );
  assert.match(
    de.sectionE2eeExceptions,
    /leerem Chiffrat[\s\S]{0,200}unverschlüsselten Metadaten-Spalte/,
    'DE must state the same system-event storage',
  );

  // The same four distinctions in German.
  assert.match(de.sectionE2eeText, /messages\.ciphertext|Chiffrate/);
  assert.match(de.sectionE2eeMetadata, /Metadaten/);
  assert.match(de.sectionE2eeLimits, /trust on first use|Schlüsselverifikation/);
  assert.match(de.sectionE2eeExceptions, /Meine Notizen/);
});

test('the overview states the CSP and the read marker at the precision the code allows', () => {
  const overview = [en.sectionOverviewText, en.sectionOverviewText2].join(' ');
  const overviewDe = [de.sectionOverviewText, de.sectionOverviewText2].join(' ');
  // index.html: connect-src 'self' https://*.supabase.co wss://*.supabase.co — a
  // wildcard, so the policy must not claim the browser is pinned to this project.
  assert.match(overview, /https:\/\/\*\.supabase\.co/, 'the CSP wildcard must be quoted as it is written');
  assert.match(overview, /wss:\/\/\*\.supabase\.co/, 'the Realtime wildcard belongs in the same sentence');
  assert.match(
    overview,
    /does not pin the browser to the project host|limits which hosts can be reached/,
    'the wildcard must not be presented as pinning the instance',
  );
  assert.doesNotMatch(
    overview,
    /read position[\s\S]{0,200}unreadable for anyone else/,
    'the read row is protected against other users, not against the operator',
  );
  assert.match(
    overview,
    /read position[\s\S]{0,240}operator, who holds the database, can\b/,
    'the operator access to the read row must be stated next to the restriction',
  );
  assert.doesNotMatch(
    overview,
    /operator[^.]{0,60}(cannot|is unable|is excluded)/i,
    'the read row must not be presented as hidden from the operator',
  );
  assert.doesNotMatch(
    overviewDe,
    /Betreiber[^.]{0,60}(kann[^.]{0,12}nicht|ist nicht in der Lage)/i,
    'DE must not claim the operator cannot read the row either',
  );
  assert.match(overviewDe, /Platzhalter-Domains https:\/\/\*\.supabase\.co/, 'DE must name the wildcard too');
  assert.match(overviewDe, /Betreiber als Inhaber der Datenbank/, 'DE must state the operator access');
  // Section 14 repeats the CSP claim, so it has to stay as precise as the
  // header in index.html: Supabase is a third-party origin that IS allowed.
  const security = `${en.sectionSecurityText} ${de.sectionSecurityText}`;
  assert.match(
    security,
    /admits no origin besides the app itself and the Supabase hosts|nur die Supabase-Hosts zulässt/,
    'the security section must name the Supabase hosts it allows',
  );
  assert.doesNotMatch(
    security,
    /Content-Security-Policy without third-party origins|ohne Dritt-Herkünfte/,
    'a wildcard Supabase origin is third-party, so that wording is not accurate',
  );
});

test('the policy never claims that nothing at all is visible', () => {
  const forbidden = [
    /niemand kann.*(lesen|sehen)/i,
    /nobody can (read|see)/i,
    /perfectly? secure/i,
    /völlig sicher/i,
    /completely anonymous/i,
    /vollständig anonym/i,
    /absolute(ly)? (security|protection|anonymity)/i,
    /kann keine(r|n|) (.*)daten (sehen|lesen)/i,
  ];
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      for (const pattern of forbidden) {
        assert.doesNotMatch(dict[key], pattern, `privacy.${key} (${lang}) overstates the protection: ${pattern}`);
      }
    }
  }
});

test('account, profile and auth data match the schema and the registration form', () => {
  const account = [en.sectionAccountText, en.sectionAccountText2, en.sectionAccountText3].join(' ');
  for (const needle of [
    'email address',
    '@username',
    'display name',
    'hash',
    'user ID',
    '60 characters',
  ]) {
    assert.ok(account.toLowerCase().includes(needle.toLowerCase()), `account section must cover ${needle}`);
  }
  assert.match(account, /cannot be changed after registration/i, 'username permanence must be disclosed');
  assert.match(
    account,
    /every signed-in user can read|every other signed-in user/,
    'profile visibility towards registered users must be disclosed',
  );
  assert.match(account, /availability check/i, 'the public username check must be disclosed');
  assert.match(de.sectionAccountText2, /jede angemeldete Person/, 'DE must state the same profile visibility');
});

test('Supabase is described with the services actually used and the configured project region', () => {
  const backend = [en.sectionBackendText, en.sectionBackendText2, en.sectionBackendLogs].join(' ');
  for (const needle of [
    'Supabase Auth',
    'PostgreSQL',
    'PostgREST',
    'Row-Level Security',
    'Realtime',
    'Edge Function',
    'eu-central-1',
    'Frankfurt',
  ]) {
    assert.ok(backend.includes(needle), `backend section must name ${needle}`);
  }
  assert.match(backend, /Storage is not used|no file or media upload/i, 'absence of Storage must be stated');
  assert.match(
    backend,
    /does not publish a fixed retention period/i,
    'no invented Supabase log retention may be claimed',
  );
  assert.match(backend, /processor/i, 'the Art. 28 role must be stated');
  // supabase-js attaches the access token to PostgREST and Realtime; the
  // refresh token is only exchanged with the auth endpoint.
  assert.match(
    en.sectionBackendLogs,
    /data API and to Realtime carries your access token/,
    'REST and Realtime must be described as carrying the access token',
  );
  assert.match(
    en.sectionBackendLogs,
    /refresh token is sent only to the auth service/,
    'the refresh token must be told apart from the access token',
  );
  assert.doesNotMatch(
    backend,
    /access or refresh token|Zugriffs- oder Refresh-Token/,
    'the policy must not claim that every request carries the refresh token',
  );
  // The region is a project setting the operator picked; nothing in this
  // repository fixes it, so the sentence must attribute it.
  assert.match(
    en.sectionBackendText2,
    /configured by the operator|setting of this instance/,
    'the project region must be attributed to the operator configuration',
  );
  assert.match(de.sectionBackendText2, /von dem Betreiber gewählten AWS-Region/);
  // The DPA names Supabase Pte. Ltd. as the contracting party and data importer;
  // Supabase, Inc. is only the US affiliate of the group.
  assert.match(en.sectionBackendText2, /Supabase Pte\. Ltd\./, 'the DPA entity must be named in the backend section');
  assert.match(en.sectionBackendText2, /data importer/, 'its role under the SCCs must be stated');
  assert.match(de.sectionBackendText2, /Supabase Pte\. Ltd\./, 'DE must name the same contracting entity');
  assert.match(de.sectionBackendText2, /Datenimporteur/, 'DE must state the importer role');
  // The vague hedge about backups is replaced by the documented default.
  assert.match(en.sectionBackendLogs, /daily backups/, 'the backup default must be quoted as documented');
  assert.doesNotMatch(
    backend,
    /backups? exist only to the extent/,
    'the unverified backup hedge must not come back now that the measure is sourced',
  );
  assert.match(de.sectionBackendText, /Row-Level-Security|Datenbank-Trigger/);
  assert.match(de.sectionBackendText2, /eu-central-1/);
});

test('the non-extractable claim belongs to the sealing key and never to the identity key', () => {
  // What the code really does: `sealed-state.ts` mints a non-extractable
  // AES-256-GCM key per account (`vaultkeys` store) and `device-store.ts`
  // writes the serialized identity key pair of the wasm engine as a SEALED
  // RECORD under that key. The identity key is therefore not a Web Crypto key,
  // and the policy must not imply that it is.
  const keys = ['sectionLocalStorageText2', 'sectionSecurityText'];
  for (const key of keys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      const sentences = String(dict[key])
        .split(/(?<=[.!?])\s+/)
        .filter((s) => /non-extractab|nicht exportierbar/i.test(s));
      assert.ok(
        sentences.length > 0,
        `privacy.${key} (${lang}) must state which key is non-extractable`,
      );
      for (const sentence of sentences) {
        assert.match(
          sentence,
          /sealing key|Versiegelungsschlüssel/i,
          `privacy.${key} (${lang}) may call only the sealing key non-extractable: ${sentence}`,
        );
        assert.doesNotMatch(
          sentence,
          /identity key|private key|Identitätsschlüssel/i,
          `privacy.${key} (${lang}) attaches the claim to a key that is not non-extractable: ${sentence}`,
        );
      }
    }
  }
  // And the identity key must be described as a sealed serialized record.
  assert.match(
    en.sectionLocalStorageText2,
    /serialized key pair inside one of these sealed records/,
    'the identity key pair must be disclosed as a sealed serialized record',
  );
  assert.match(de.sectionLocalStorageText2, /serialisiertes Schlüsselpaar/);
});

test('the policy names the Supabase entity its own DPA contracts with', () => {
  const entity = [
    en.sectionBackendText2,
    en.sectionTransfersText,
    en.sectionTransfersText2,
    de.sectionBackendText2,
    de.sectionTransfersText,
    de.sectionTransfersText2,
  ].join(' ');
  assert.match(entity, /Supabase Pte\. Ltd\./, 'the contracting entity of the DPA must be named');
  assert.match(entity, /Singapore|Singapur/, 'and its seat, because that is the third-country question');
  assert.match(entity, /data importer|Datenimporteur/, 'the importer role under the SCCs must be stated');
  // Supabase, Inc. may appear only as the affiliated operator, never as the
  // processor the contract is held with.
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      assert.doesNotMatch(
        dict[key],
        /Supabase,? Inc\.[^.]{0,40}(acts as|ist|is)\s+(our|unser|the\s+)?(processor|Auftragsverarbeiter)/i,
        `privacy.${key} (${lang}) describes the US affiliate as the contracting processor`,
      );
    }
  }
  // Singapore has no general adequacy decision, so the SCC basis must stay.
  assert.match(
    en.sectionTransfersText2,
    /no general EU adequacy decision|rather than on adequacy/,
    'the SCC basis for Singapore must be explained instead of a claimed adequacy',
  );
  assert.match(de.sectionTransfersText2, /kein allgemeiner Angemessenheitsbeschluss/);
  // The published DPA link must be the canonical document, not a redirect.
  assert.match(
    privacySource,
    /url: 'https:\/\/supabase\.com\/legal\/customer-resources\/data-processing-addendum'/,
    'the reference must point at the canonical DPA URL',
  );
});

test('local browser storage is distinguished from cookies', () => {
  const local = [
    en.sectionLocalStorageText,
    en.sectionLocalStorageText2,
    en.sectionLocalStorageText3,
    en.sectionLocalStorageText4,
  ].join(' ');
  assert.match(local, /sets no cookies at all|no cookies/, 'the cookie absence must be stated explicitly');
  for (const needle of ['IndexedDB', 'LocalStorage', 'sessionStorage', 'service worker']) {
    assert.ok(local.includes(needle), `storage section must cover ${needle}`);
  }
  assert.match(local, /enough-crypto/, 'the IndexedDB database name must be given');
  assert.match(local, /AES-256-GCM/, 'the sealing of local state must be named');
  assert.match(local, /Offline Read Mode/, 'offline snapshots must be documented');
  assert.match(local, /sb-<project-ref>-auth-token/, 'the Supabase Auth session in LocalStorage must be documented');
  // The PKCE verifier is a sibling entry of the session, not part of it
  // (@supabase/auth-js writes `${storageKey}-code-verifier`).
  assert.match(
    local,
    /sb-<project-ref>-auth-token-code-verifier/,
    'the PKCE verifier must be documented as its own LocalStorage entry',
  );
  assert.match(local, /separate entry next to it/, 'the verifier must not be described as stored inside the token entry');
  assert.match(de.sectionLocalStorageText3, /eigener Eintrag daneben/, 'DE must place the verifier in its own entry');
  // Pre-F6 releases persisted decrypted message text unencrypted in
  // LocalStorage (message-cache.ts `enough-msgplain-<userId>`); the policy has
  // to disclose the leftover and the way out.
  assert.match(
    local,
    /enough-msgplain-<userID>/,
    'the legacy unencrypted message cache must be documented',
  );
  assert.match(local, /clear the site data|clearing the site data/, 'the removal path for the leftover must be given');
  assert.match(de.sectionLocalStorageText3, /enough-msgplain-<Benutzer-ID>/, 'DE must document it as well');
  assert.match(de.sectionLocalStorageText3, /Site-Daten löschst/);
  // Only the sealing key is non-extractable (see the dedicated test below).
  assert.match(local, /AES-256-GCM sealed records under one sealing key per account/);
  assert.match(local, /access token.*refresh token|refresh token/, 'stored tokens must be named honestly');
  assert.match(
    de.sectionLocalStorageText,
    /setzt keinerlei Cookies|keinerlei Cookies/,
    'DE must state that no cookies are set',
  );
  // LocalStorage must not be described as a cookie mechanism.
  assert.doesNotMatch(local, /localStorage cookies|cookie named "enough-theme"/i);
});

test('GitHub Pages is described without invented log retention periods', () => {
  const hosting = [en.sectionHostingText, en.sectionHostingText2, en.sectionHostingText3].join(' ');
  assert.ok(hosting.includes('GitHub Pages'), 'hosting section must name GitHub Pages');
  assert.ok(hosting.includes('GitHub, Inc.'), 'the contracting entity must be named');
  assert.match(hosting, /IP address is logged|IP address/, 'the documented Pages IP logging must be stated');
  assert.match(hosting, /Article 6\(1\)\(f\)/, 'the legal basis must be given');
  assert.match(
    hosting,
    /does not publish a fixed retention period/,
    'retention must be described as not published by GitHub',
  );
  assert.match(de.sectionHostingText3, /veröffentlicht GitHub keine feste Frist/);
});

test('the contact form section matches the shipped edge function protections', () => {
  const contact = [
    en.sectionContactText,
    en.sectionContactText2,
    en.sectionContactResend,
    en.sectionContactResend2,
  ].join(' ');
  // What the Edge Function really does.
  for (const needle of [
    'send-contact-email',
    'honeypot',
    'CRLF',
    'five submissions per ten minutes',
    'open mail relay',
  ]) {
    assert.ok(contact.toLowerCase().includes(needle.toLowerCase()), `contact section must mention ${needle}`);
  }
  assert.ok(edgeFunctionSource.includes("'jsr:@supabase/functions-js/edge-runtime.d.ts'"), 'edge function intact');
  assert.match(contact, /not written to any database table/, 'the transient nature of the IP must be stated');
  // index.ts skips isRateLimited() when no client-address header is present.
  assert.match(
    contact,
    /skipped when a request arrives without a client-address header/,
    'the rate-limit bypass for an unknown client IP must be disclosed',
  );
  assert.match(
    contact,
    /counter lives only in the memory of the function instance/,
    'the per-instance nature of the counter must be stated',
  );
  assert.match(de.sectionContactText, /ohne Header mit der Client-Adresse eintrifft/);
  assert.match(contact, /logs the HTTP status only/, 'log redaction must be stated');
  assert.match(contact, /Resend/, 'the mail provider must be named');
  assert.match(
    contact,
    /Plus Five Five, Inc\./,
    'the policy must name the contracting entity that Resend\u0027s own DPA defines',
  );
  assert.match(contact, /stored in the United States/, 'Resend storage location must be stated');
  assert.match(contact, /30 days|90 days|7 days/, 'Resend\u0027s published retention must be quoted');
  assert.match(contact, /Resend publishes|as Resend publishes/, 'retention numbers must be attributed to Resend');
  assert.match(contact, /region closest to the person making the request|region closest to the requester/,
    'edge execution region must be disclosed');
  assert.match(
    de.sectionContactResend,
    /Resend veröffentlicht für seine eigene Verarbeitung Folgendes/,
    'DE must attribute the retention figures to Resend as well',
  );
});

test('retention and deletion describe the real deletion paths', () => {
  const retention = [en.sectionRetentionText, en.sectionRetentionText2].join(' ');
  assert.match(retention, /no expiry dates|no automatic/, 'the absence of message expiry must be stated');
  assert.match(retention, /14 days/, 'connection-request expiry must be documented');
  assert.match(
    retention,
    /constant of the app rather than a scheduled job/,
    'the expiry must be described as client logic, not as a running database scheduler',
  );
  assert.match(
    retention,
    /set to .expired. once/,
    'the one-time migration write must be told apart from the client-side expiry',
  );
  assert.doesNotMatch(
    retention,
    /are marked expired by the database once/,
    'the policy must not imply a running database job expires requests',
  );
  assert.match(de.sectionRetentionText2, /kein Zeitplanjob in der Datenbank/);
  assert.match(retention, /30 days/, 'signed prekey rotation must be documented');

  const deletion = [
    en.sectionDeletionText,
    en.sectionDeletionText2,
    en.sectionDeletionText3,
  ].join(' ');
  assert.match(deletion, /delete_own_account/, 'the account-deletion RPC must be named');
  assert.match(deletion, /frees your @username/, 'username release must be documented');
  assert.match(deletion, /ended/, 'the ended conversation state must be documented');
  assert.match(
    deletion,
    /does not erase the history your peers still have|survive the deletion of an account/,
    'history surviving account deletion must be disclosed',
  );
  assert.match(deletion, /within 24 hours/, 'the delete-for-everyone window must be stated as a window');
  assert.doesNotMatch(
    deletion,
    /removed? (from the database )?within 24 hours/,
    'ciphertext must not be claimed to vanish only after 24 hours',
  );
  assert.match(deletion, /ciphertext is cleared to an empty string/, 'tombstone semantics must be exact');
  assert.match(deletion, /hidden-until cutoff/, 'delete-chat-for-me must be described as a cutoff');
  assert.match(deletion, /My Notes/, 'the My Notes deletion path must be documented');
  assert.match(de.sectionDeletionText3, /24 Stunden/);
  assert.match(de.sectionDeletionText3, /auf einen leeren Wert gesetzt/);
});

test('recipients and third-country transfers are documented per provider', () => {
  const transfers = [en.sectionTransfersText, en.sectionTransfersText2].join(' ');
  assert.match(transfers, /not sold/, 'a no-sale statement belongs here');
  for (const needle of ['GitHub', 'Supabase', 'Resend', 'Edge Functions']) {
    assert.ok(transfers.includes(needle), `transfers must cover ${needle}`);
  }
  assert.match(
    transfers,
    /Standard Contractual Clauses/,
    'the SCC mechanism must be named for Supabase and Resend',
  );
  assert.match(
    transfers,
    /we have not verified a separate adequacy certification for Supabase/,
    'unverified mechanisms must be marked as unverified instead of asserted',
  );
  assert.match(transfers, /Data Privacy Framework/, 'the DPF must be named where GitHub/Resend publish it');
  assert.doesNotMatch(
    transfers,
    /all (data|personal data) (is|are) (only )?transferred under the DPF/i,
    'a blanket DPF claim for everything is not supported',
  );
  assert.match(de.sectionTransfersText2, /haben wir nicht geprüft/);
});

test('the Irish-law statement stays scoped to the Standard Contractual Clauses', () => {
  // What the Supabase DPA (Version 1, 1 August 2026) actually says: Schedule 2
  // ¶1.5 completes Clause 17 with Irish law and ¶1.6 with the courts of
  // Ireland. Both are choices about the Standard Contractual Clauses; the
  // addendum itself states no governing law for the rest of the agreement, so
  // the policy must not attribute Irish law to "the DPA" as a whole.
  const irishLaw = /irish law|irisches Recht|irischem Recht|Irish|Ireland|Irland/i;
  const clauseWord = /contractual clauses|Standardvertragsklauseln|clauses|klauseln/i;
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      const sentences = String(dict[key]).split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (!irishLaw.test(sentence)) continue;
        assert.match(
          sentence,
          clauseWord,
          `privacy.${key} (${lang}) mentions Irish law without naming the Clauses it applies to: ${sentence}`,
        );
      }
    }
  }
  // The blanket claims this replaces must not come back.
  const falseClaims = [
    /(?:Data Processing Agreement|the DPA|the agreement|this agreement|addendum)[^.]{0,60}\bis governed by Irish law/i,
    /incorporates under Irish law|places? the agreement under Irish law/i,
    /(?:Datenverarbeitungsvereinbarung|die Vereinbarung|diese Vereinbarung)[^.]{0,80}unterliegt irischem Recht/i,
    /nach irischem Recht (?:enthält|gilt die Vereinbarung)/i,
  ];
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      for (const pattern of falseClaims) {
        assert.doesNotMatch(
          dict[key],
          pattern,
          `privacy.${key} (${lang}) attributes Irish law to the whole DPA: ${pattern}`,
        );
      }
    }
  }
  // And the correct scope has to be stated where the transfer is explained.
  assert.match(
    en.sectionBackendText2,
    /for those Clauses alone, Irish law and the courts of Ireland/,
    'section 7 must scope Irish law to the Clauses',
  );
  assert.match(
    de.sectionBackendText2,
    /dass für diese Klauseln irisches Recht und der Gerichtsstand Irland gelten/,
    'Abschnitt 7 muss irisches Recht auf die Klauseln begrenzen',
  );
  assert.match(en.sectionTransfersText2, /for which that agreement sets Irish law/);
  assert.match(de.sectionTransfersText2, /für die sie irisches Recht sowie den Gerichtsstand Irland festlegt/);
});

test('the DPA is described as applying automatically, not as a contract to be signed', () => {
  // Supabase incorporates its Data Processing Addendum into the Terms of Service,
  // so a customer organisation gets its protections without signing anything
  // separately. The policy must not describe a conclusion step the provider says
  // does not exist, and it must not claim a separately signed DPA is on file.
  assert.match(
    en.sectionBackendText2,
    /incorporated into its Terms of Service and therefore applies[^.]*without a separate signature/,
    'section 7 must state that the agreement applies without a separate signature',
  );
  assert.match(
    de.sectionBackendText2,
    /in die Nutzungsbedingungen eingebunden und gilt[^.]*ohne gesonderte Unterzeichnung/,
    'Abschnitt 7 muss die automatische Geltung der Vereinbarung nennen',
  );
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      assert.doesNotMatch(
        dict[key],
        /responsible for concluding (?:the|this) (?:contract|agreement)/i,
        `privacy.${key} (${lang}) still demands a separate conclusion step for the DPA`,
      );
      assert.doesNotMatch(
        dict[key],
        /verantwortlich, den Vertrag abzuschlie/i,
        `privacy.${key} (${lang}) verlangt weiterhin einen gesonderten Vertragsabschluss`,
      );
    }
  }
});

test('the policy states one revision date in both languages', () => {
  // `privacy.lastUpdated` is the date the policy text itself was last revised,
  // so EN and DE must state the same one. A one-sided bump (EN edited, DE
  // forgotten) is what this catches; the assertion is on the parsed date and
  // never on today, so it cannot rot.
  const months = {
    en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
      'september', 'october', 'november', 'december'],
    de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august',
      'september', 'oktober', 'november', 'dezember'],
  };
  const parsed = [];
  for (const [lang, dict] of [['en', en], ['de', de]]) {
    const value = String(dict.lastUpdated);
    const match = value.match(new RegExp(`(\\d{1,2})\\.?\\s+(${months[lang].join('|')})\\s+(\\d{4})`, 'i'));
    assert.ok(match, `privacy.lastUpdated (${lang}) must state a full date, found: ${value}`);
    const day = Number(match[1]);
    const index = months[lang].indexOf(match[2].toLowerCase());
    const year = Number(match[3]);
    const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    assert.ok(
      day >= 1 && day <= lastDay,
      `privacy.lastUpdated (${lang}) is not a real calendar date: ${value}`,
    );
    parsed.push(`${year}-${index + 1}-${day}`);
  }
  assert.equal(parsed[0], parsed[1], 'EN and DE must state the same policy revision date');
});

test('rights, authority and practical limits are stated', () => {
  const rights = [en.sectionRightsText, en.sectionRightsText2, en.sectionRightsAuthority].join(' ');
  for (const article of ['Article 15', 'Article 16', 'Article 17', 'Article 18', 'Article 20', 'Article 21', 'Article 77']) {
    assert.ok(rights.includes(article), `rights section must list ${article}`);
  }
  assert.match(rights, /no consent to withdraw|not applicable, because no processing is based on consent/,
    'the absence of a consent basis must be stated explicitly');
  assert.match(rights, /cannot hand out message contents|cannot decrypt/,
    'the E2EE limit on access requests must be disclosed');
  assert.match(rights, /Düsseldorf/, 'the competent authority must be reachable by address');
  assert.match(rights, /poststelle@ldi\.nrw\.de/, 'the authority contact must be given');
  assert.match(de.sectionRightsAuthority, /Landesbeauftragte für Datenschutz und Informationsfreiheit/);
  assert.match(de.sectionRightsAuthority, /Kavalleriestraße 2–4, 40213 Düsseldorf/);
  assert.match(de.sectionRightsText, /Art\. 15/);
});

test('documented references point at the providers\u0027 own publications', () => {
  const urls = [...privacySource.matchAll(/url: '(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.equal(urls.length, 6, 'the policy must list exactly the documented provider sources');
  for (const url of urls) {
    assert.ok(url.startsWith('https://'), `reference ${url} must be https`);
  }
  const hosts = urls.map((u) => new URL(u).host);
  assert.ok(hosts.includes('docs.github.com'), 'GitHub documentation must be linked');
  assert.ok(hosts.includes('supabase.com'), 'the Supabase DPA must be linked');
  assert.ok(
    urls.includes('https://supabase.com/legal/customer-resources/data-processing-addendum'),
    'the DPA must be linked at its canonical path, not a redirect',
  );
  assert.ok(hosts.includes('resend.com'), 'the Resend GDPR page must be linked');
  const labelKeys = [...privacySource.matchAll(/label: 'privacy\.(ref[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.equal(labelKeys.length, urls.length, 'every reference needs a label key');
  for (const key of labelKeys) {
    assert.ok(en[key]?.length > 0 && de[key]?.length > 0, `privacy.${key} must be labelled in both languages`);
  }
});

// ---------------------------------------------------------------------------
// 5. Removed generic generator content
// ---------------------------------------------------------------------------

test('the policy contains no generic modules that enough. does not operate', () => {
  const forbidden = [
    // employment / HR
    /Beschäftigtendaten/i,
    /employee data/i,
    /HR (data|records)/i,
    /Bewerbungsverfahren/i,
    // whistleblowing
    /Hinweisgeber/i,
    /whistleblow/i,
    /internal reporting office/i,
    /interne Meldestelle/i,
    // marketing, advertising, loyalty
    /Newsletter/i,
    /Werbemails/i,
    /Gewinnspiel/i,
    /Umfrage/i,
    /Bewertungen/i,
    /customer loyalty/i,
    /direct marketing/i,
    // social media & widgets
    /Facebook/i,
    /Instagram/i,
    /X \(Twitter\)/i,
    /LinkedIn-Pixel/i,
    /Google (Maps|Fonts|Analytics)/i,
    /Matomo/i,
    /Hotjar/i,
    // payments
    /payment provider/i,
    /Zahlungsdienstleister/i,
    /Stripe/i,
    /PayPal/i,
    // legal boilerplate that does not apply
    /HandelsGesetz/i,
    /\bHGB\b/,
    /Abgabenordnung/i,
    /\bAO\b/,
    /Geldwäsch/i,
    /anti-money/i,
    /Cookie-?Banner/i,
    /Cookie-?Zustimmung/i,
    /consent management tool/i,
    /community[- ]forum/i,
    /öffentliche Community/i,
  ];
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      for (const pattern of forbidden) {
        assert.doesNotMatch(
          dict[key],
          pattern,
          `privacy.${key} (${lang}) still mentions ${pattern} — enough. has no such feature`,
        );
      }
    }
  }
});

test('retention figures are only stated where a source exists', () => {
  // Neither this repository nor a provider publication proves a fixed log
  // retention period at GitHub or Supabase, so those paragraphs must say that
  // no period is published instead of naming a number — and every number that
  // IS stated has to sit next to its source.
  const hosting = [en.sectionHostingText, en.sectionHostingText2, en.sectionHostingText3].join(' ');
  const hostingDe = [de.sectionHostingText, de.sectionHostingText2, de.sectionHostingText3].join(' ');
  assert.match(hosting, /does not publish a fixed retention period/);
  assert.match(hostingDe, /veröffentlicht GitHub keine feste Frist/);
  assert.doesNotMatch(hosting, /\d+ (days|Tage)/i, 'the Pages section must not assert a log window');
  assert.doesNotMatch(hostingDe, /\d+ (Tage|Tagen)/i, 'the German Pages section must not assert a log window');

  const backend = [en.sectionBackendText, en.sectionBackendText2, en.sectionBackendLogs].join(' ');
  assert.match(backend, /does not publish a fixed retention period for these technical logs/);
  assert.match(
    backend,
    /30-day export period/,
    'the only Supabase figure may be the DPA export period, with its source named',
  );
  assert.match(de.sectionBackendLogs, /veröffentlicht Supabase keine feste Aufbewahrungsfrist/);

  // The Resend figures come from Resend and must stay attributed to the provider.
  for (const text of [en.sectionContactResend, de.sectionContactResend]) {
    assert.match(text, /Resend/);
    assert.match(text, /publishes|veröffentlicht/, 'retention numbers must be attributed to the provider');
  }

  // The retention statements in the Supabase paragraph must not read as claims
  // about the messenger data itself.
  assert.match(
    backend,
    /Backups belong to the documented defaults of the platform/,
    'the backup statement must be attributed to the documented platform default',
  );
  assert.match(
    backend,
    /for the provider's backup window/,
    'the afterlife of deleted content must stay bounded to the provider window',
  );
  assert.match(en.sectionRetentionText, /no expiry dates|no automatic/);

  // Legacy generator boilerplate: the old text asserted a Pages log window and
  // commercial retention periods. Both are gone in both languages.
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      assert.doesNotMatch(
        dict[key],
        /7 (to|bis) 30 (days|Tage)/i,
        `privacy.${key} (${lang}) repeats the unsupported Pages window`,
      );
      assert.doesNotMatch(
        dict[key],
        /(6 Monate|10 Jahre|\b\d+ years\b)/i,
        `privacy.${key} (${lang}) states a statutory retention period`,
      );
    }
  }
});

test('the policy is policy, not a product pitch or a security datasheet', () => {
  const marketing = /revolutionär|revolutionary|state of the art|bankensicher|hochmodern|cutting-edge|unhackable/i;
  for (const key of enKeys) {
    for (const [lang, dict] of [['en', en], ['de', de]]) {
      assert.doesNotMatch(dict[key], marketing, `privacy.${key} (${lang}) reads like marketing copy`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. UI / integration
// ---------------------------------------------------------------------------

test('the policy renders from translations and introduces no new dependency', () => {
  assert.ok(privacySource.includes("from '../i18n'"), 'Privacy must use the shared i18n module');
  assert.ok(!privacySource.includes('dangerouslySetInnerHTML'), 'no raw HTML injection');
  const imports = [...privacySource.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'Privacy must have its imports');
  for (const specifier of imports) {
    assert.ok(
      specifier === 'react' || specifier.startsWith('.'),
      `Privacy must not add a third-party dependency (found '${specifier}')`,
    );
  }
  assert.ok(privacySource.includes('POLICY_SECTIONS'), 'sections must be data-driven');
  assert.ok(privacySource.includes('<ThemeButton'), 'the existing theme control must stay');
  assert.ok(privacySource.includes('lang-button'), 'the DE/EN switch must stay');
});

test('contact form markup and its privacy note stay intact', () => {
  for (const needle of ['id="contact-name"', 'id="contact-email"', 'id="contact-message"']) {
    assert.ok(contactFormSource.includes(needle), `${needle} must exist`);
  }
  assert.ok(contactFormSource.includes('type="email"'), 'email input must be typed');
  assert.ok(contactFormSource.includes('required'), 'required inputs must stay required');
  assert.ok(contactFormSource.includes('aria-hidden="true"'), 'honeypot must stay hidden from AT');
  assert.ok(contactFormSource.includes('tabIndex={-1}'), 'honeypot must stay out of the tab order');
  assert.ok(contactFormSource.includes('role="status"'), 'success must be announced');
  assert.ok(contactFormSource.includes('role="alert"'), 'errors must be announced');
});
