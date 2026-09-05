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

  const limits = en.sectionE2eeLimits;
  assert.match(limits, /trust on first use/, 'the missing key verification must be disclosed');
  assert.match(limits, /no key backup|not.*key backup/i, 'the absent key backup must be disclosed');
  assert.match(limits, /compromised device/i, 'endpoint compromise must be excluded from the promise');

  const exceptions = en.sectionE2eeExceptions;
  assert.match(exceptions, /My Notes/i, 'the plaintext self-chat exception must be documented');
  assert.match(exceptions, /System events|system event/, 'unencrypted system events must be documented');

  // The same four distinctions in German.
  assert.match(de.sectionE2eeText, /messages\.ciphertext|Chiffrate/);
  assert.match(de.sectionE2eeMetadata, /Metadaten/);
  assert.match(de.sectionE2eeLimits, /trust on first use|Schlüsselverifikation/);
  assert.match(de.sectionE2eeExceptions, /Meine Notizen/);
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

test('Supabase is described with the services actually used and the EU project region', () => {
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
  assert.match(de.sectionBackendText, /Row-Level-Security|Datenbank-Trigger/);
  assert.match(de.sectionBackendText2, /eu-central-1/);
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
  assert.match(backend, /Database backups exist only to the extent/);
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
