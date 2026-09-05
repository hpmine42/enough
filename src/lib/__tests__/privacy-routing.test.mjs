// enough. — Routing, localization and structure tests for Privacy Policy and Imprint.
//
// Verifies:
//   - Privacy routes (#/privacy, #/datenschutz, #/settings/privacy)
//   - Structural components: all GDPR sections in EN & DE
//   - Cross-linking between Imprint and Privacy
//   - Contact form fields, labels, placeholders, honeypot and accessibility attributes
//   - Settings footer link to Privacy
//
// Run with:
//   node --test --experimental-strip-types src/lib/__tests__/privacy-routing.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const appSource = fs.readFileSync(`${__dirname}/../../App.tsx`, 'utf-8');
const privacySource = fs.readFileSync(
  `${__dirname}/../../components/Privacy.tsx`,
  'utf-8',
);
const imprintSource = fs.readFileSync(
  `${__dirname}/../../components/Imprint.tsx`,
  'utf-8',
);
const settingsSource = fs.readFileSync(
  `${__dirname}/../../components/Settings.tsx`,
  'utf-8',
);
const contactFormSource = fs.readFileSync(
  `${__dirname}/../../components/ContactForm.tsx`,
  'utf-8',
);

const { translations } = await import('../../i18n/translations.ts');

// ---------------------------------------------------------------------------
// Routing & Navigation Checks
// ---------------------------------------------------------------------------

test('App.tsx routes #/privacy, #/datenschutz, and #/settings/privacy to Privacy component', () => {
  assert.ok(
    appSource.includes("route.startsWith('#/privacy')"),
    '#/privacy must route to Privacy component',
  );
  assert.ok(
    appSource.includes("route.startsWith('#/datenschutz')"),
    '#/datenschutz must route to Privacy component',
  );
  assert.ok(
    appSource.includes("route.startsWith('#/settings/privacy')"),
    '#/settings/privacy must route to Privacy component',
  );
  assert.ok(
    appSource.includes('<Privacy />'),
    'Privacy component must be rendered',
  );
});

test('Settings footer contains direct links to Imprint, Privacy, and GitHub', () => {
  assert.ok(
    settingsSource.includes('settings-privacy-link'),
    'Privacy link class must exist in Settings footer',
  );
  assert.ok(
    settingsSource.includes("#/datenschutz' : '#/privacy'"),
    'Privacy link must target #/datenschutz in DE and #/privacy in EN',
  );
  assert.ok(
    settingsSource.includes('settings-legal-link'),
    'Imprint link must exist in Settings footer',
  );
});

test('Imprint links to Privacy Policy', () => {
  assert.ok(
    imprintSource.includes("#/datenschutz' : '#/privacy'"),
    'Imprint must contain a link to #/datenschutz in DE and #/privacy in EN',
  );
  assert.ok(
    imprintSource.includes('legal.privacyLinkText'),
    'Imprint must use the privacyLinkText translation key',
  );
});

test('Privacy links back to Imprint', () => {
  assert.ok(
    privacySource.includes("#/impressum' : '#/imprint'"),
    'Privacy must contain a link to #/impressum in DE and #/imprint in EN',
  );
  assert.ok(
    privacySource.includes('legal.imprintLinkText'),
    'Privacy must use the imprintLinkText translation key',
  );
});

// ---------------------------------------------------------------------------
// Privacy Policy Content & Structure Verification
// ---------------------------------------------------------------------------

test('Privacy translations exist for all 10 GDPR sections in EN and DE', () => {
  const sections = [
    'sectionOverviewTitle',
    'sectionOverviewText',
    'sectionControllerTitle',
    'sectionControllerIntro',
    'sectionHostingTitle',
    'sectionHostingText',
    'sectionAccountTitle',
    'sectionAccountText',
    'sectionE2eeTitle',
    'sectionE2eeText',
    'sectionE2eeMetadata',
    'sectionE2eeExceptions',
    'sectionBackendTitle',
    'sectionBackendText',
    'sectionBackendLogs',
    'sectionLocalStorageTitle',
    'sectionLocalStorageText',
    'sectionContactTitle',
    'sectionContactText',
    'sectionContactResend',
    'sectionDeletionTitle',
    'sectionDeletionText',
    'sectionRightsTitle',
    'sectionRightsText',
  ];

  // In English
  for (const s of sections) {
    const text = translations.en.privacy[s];
    assert.ok(text && text.length > 0, `privacy.${s} in EN must not be empty`);
  }

  // In German
  for (const s of sections) {
    const text = translations.de.privacy[s];
    assert.ok(text && text.length > 0, `privacy.${s} in DE must not be empty`);
  }
});

test('Privacy Policy accurately reflects technical architecture and legal bases', () => {
  const e2ee = translations.en.privacy.sectionE2eeText;
  assert.ok(
    e2ee.includes('Signal Protocol') || e2ee.includes('PQXDH'),
    'E2EE section must mention Signal / PQXDH protocol',
  );
  assert.ok(
    e2ee.includes('Double Ratchet'),
    'E2EE section must mention Double Ratchet',
  );
  assert.ok(
    e2ee.includes('Kyber-1024'),
    'E2EE section must mention post-quantum Kyber-1024',
  );
  assert.ok(
    e2ee.includes('ciphertext'),
    'E2EE section must mention server stores only ciphertext envelopes',
  );

  const e2eeMetadata = translations.en.privacy.sectionE2eeMetadata;
  assert.ok(
    e2eeMetadata.includes('metadata') || e2eeMetadata.includes('Metadata'),
    'E2EE section must transparently detail metadata processing',
  );

  const backend = translations.en.privacy.sectionBackendText;
  assert.ok(
    backend.includes('Supabase') && backend.includes('eu-central-1') && backend.includes('Frankfurt'),
    'Backend section must mention Supabase Frankfurt eu-central-1 region',
  );

  const hosting = translations.en.privacy.sectionHostingText;
  assert.ok(
    hosting.includes('GitHub Pages') && hosting.includes('GitHub, Inc.'),
    'Hosting section must mention GitHub Pages',
  );

  const contactResend = translations.en.privacy.sectionContactResend;
  assert.ok(
    contactResend.includes('Resend') && contactResend.includes('Resend, Inc.'),
    'Contact section must explicitly name Resend as email delivery provider',
  );

  const storage = translations.en.privacy.sectionLocalStorageText;
  assert.ok(
    storage.includes('enough-crypto') && storage.includes('AES-256-GCM'),
    'Storage section must mention enough-crypto and AES-256-GCM',
  );
  assert.ok(
    storage.includes('Offline Read Mode'),
    'Storage section must mention Offline Read Mode',
  );

  const deletion = translations.en.privacy.sectionDeletionText;
  assert.ok(
    deletion.includes('Delete Account') || deletion.includes('delete your account'),
    'Deletion section must explain account deletion',
  );
});

// ---------------------------------------------------------------------------
// Contact Form Component Verification
// ---------------------------------------------------------------------------

test('Contact form contains all required fields, honeypot and accessibility attributes', () => {
  assert.ok(
    contactFormSource.includes('id="contact-name"'),
    'Name field must have id="contact-name"',
  );
  assert.ok(
    contactFormSource.includes('id="contact-email"'),
    'Email field must have id="contact-email"',
  );
  assert.ok(
    contactFormSource.includes('id="contact-message"'),
    'Message field must have id="contact-message"',
  );
  assert.ok(
    contactFormSource.includes('type="email"'),
    'Email input must have type="email"',
  );
  assert.ok(
    contactFormSource.includes('required'),
    'Required inputs must have required attribute',
  );
  assert.ok(
    contactFormSource.includes('aria-hidden="true"'),
    'Honeypot container must have aria-hidden="true"',
  );
  assert.ok(
    contactFormSource.includes('tabIndex={-1}'),
    'Honeypot input must have tabIndex={-1}',
  );
  assert.ok(
    contactFormSource.includes('role="status"'),
    'Success feedback must have role="status"',
  );
  assert.ok(
    contactFormSource.includes('role="alert"'),
    'Error feedback must have role="alert"',
  );
});
