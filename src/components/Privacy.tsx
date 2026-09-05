import { useEffect, type ReactNode } from 'react';
import { imprintConfig } from '../config/imprint';
import { t, useLang, type TranslationKey } from '../i18n';
import { navigate, useHashRoute } from '../lib/router';
import { BackIcon } from './icons';
import ThemeButton from './ThemeButton';

/**
 * The privacy policy is DATA, not markup: every sentence lives in
 * `src/i18n/translations.ts` under `privacy.*` in both languages, and this
 * file only defines the order and the shape of a section.
 *
 * `POLICY_SECTIONS` is the single source of structure: the contents
 * navigation and the section list are rendered from the same array, so a new
 * section cannot appear in the body without also appearing in the navigation.
 * Both language dictionaries are asserted key-for-key identical by
 * `src/lib/__tests__/privacy-routing.test.mjs`.
 */
interface PolicySection {
  /** Stable slug for the DOM id the contents navigation scrolls to. */
  id: string;
  title: TranslationKey;
  /** Paragraph keys, rendered in this exact order. */
  paragraphs: TranslationKey[];
  /** Inserts the controller address + e-mail block after the first paragraph. */
  controllerBlock?: boolean;
  /** Appends the provider reference list after the last paragraph. */
  references?: boolean;
}

const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    id: 'overview',
    title: 'privacy.sectionOverviewTitle',
    paragraphs: ['privacy.sectionOverviewText', 'privacy.sectionOverviewText2'],
  },
  {
    id: 'controller',
    title: 'privacy.sectionControllerTitle',
    paragraphs: ['privacy.sectionControllerIntro', 'privacy.sectionControllerText'],
    controllerBlock: true,
  },
  {
    id: 'categories',
    title: 'privacy.sectionCategoriesTitle',
    paragraphs: [
      'privacy.sectionCategoriesText',
      'privacy.sectionCategoriesText2',
      'privacy.sectionCategoriesText3',
    ],
  },
  {
    id: 'legal-basis',
    title: 'privacy.sectionLegalBasisTitle',
    paragraphs: [
      'privacy.sectionLegalBasisText',
      'privacy.sectionLegalBasisText2',
      'privacy.sectionLegalBasisText3',
    ],
  },
  {
    id: 'account',
    title: 'privacy.sectionAccountTitle',
    paragraphs: [
      'privacy.sectionAccountText',
      'privacy.sectionAccountText2',
      'privacy.sectionAccountText3',
    ],
  },
  {
    id: 'e2ee',
    title: 'privacy.sectionE2eeTitle',
    // Order matters: content → metadata → limits → documented exceptions.
    paragraphs: [
      'privacy.sectionE2eeText',
      'privacy.sectionE2eeMetadata',
      'privacy.sectionE2eeLimits',
      'privacy.sectionE2eeExceptions',
    ],
  },
  {
    id: 'backend',
    title: 'privacy.sectionBackendTitle',
    paragraphs: [
      'privacy.sectionBackendText',
      'privacy.sectionBackendText2',
      'privacy.sectionBackendLogs',
    ],
  },
  {
    id: 'local-storage',
    title: 'privacy.sectionLocalStorageTitle',
    paragraphs: [
      'privacy.sectionLocalStorageText',
      'privacy.sectionLocalStorageText2',
      'privacy.sectionLocalStorageText3',
      'privacy.sectionLocalStorageText4',
    ],
  },
  {
    id: 'hosting',
    title: 'privacy.sectionHostingTitle',
    paragraphs: [
      'privacy.sectionHostingText',
      'privacy.sectionHostingText2',
      'privacy.sectionHostingText3',
    ],
  },
  {
    id: 'contact',
    title: 'privacy.sectionContactTitle',
    paragraphs: [
      'privacy.sectionContactText',
      'privacy.sectionContactText2',
      'privacy.sectionContactResend',
      'privacy.sectionContactResend2',
    ],
  },
  {
    id: 'retention',
    title: 'privacy.sectionRetentionTitle',
    paragraphs: ['privacy.sectionRetentionText', 'privacy.sectionRetentionText2'],
  },
  {
    id: 'deletion',
    title: 'privacy.sectionDeletionTitle',
    paragraphs: [
      'privacy.sectionDeletionText',
      'privacy.sectionDeletionText2',
      'privacy.sectionDeletionText3',
    ],
  },
  {
    id: 'transfers',
    title: 'privacy.sectionTransfersTitle',
    paragraphs: ['privacy.sectionTransfersText', 'privacy.sectionTransfersText2'],
  },
  {
    id: 'security',
    title: 'privacy.sectionSecurityTitle',
    paragraphs: ['privacy.sectionSecurityText', 'privacy.sectionSecurityText2'],
  },
  {
    id: 'rights',
    title: 'privacy.sectionRightsTitle',
    paragraphs: [
      'privacy.sectionRightsText',
      'privacy.sectionRightsText2',
      'privacy.sectionRightsAuthority',
    ],
  },
  {
    id: 'changes',
    title: 'privacy.sectionChangesTitle',
    paragraphs: ['privacy.sectionChangesText', 'privacy.sectionChangesText2'],
    references: true,
  },
];

/**
 * Documents the provider statements quoted in the policy are published by the
 * providers themselves. URLs are language-independent, their labels are not —
 * so the labels come from the dictionaries and are checked for DE/EN parity.
 */
const PROVIDER_REFERENCES: readonly { label: TranslationKey; url: string }[] = [
  {
    label: 'privacy.refGitHubPrivacy',
    url: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
  },
  {
    label: 'privacy.refGitHubPages',
    url: 'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection',
  },
  { label: 'privacy.refSupabaseDpa', url: 'https://supabase.com/legal/dpa' },
  {
    label: 'privacy.refSupabaseGdpr',
    url: 'https://supabase.com/docs/guides/security/gdpr-compliance',
  },
  { label: 'privacy.refResendGdpr', url: 'https://resend.com/security/gdpr' },
  { label: 'privacy.refSource', url: 'https://github.com/hpmine42/enough' },
];

/** DOM id of a section anchor (never a URL fragment — see `scrollToSection`). */
function sectionDomId(id: string): string {
  return `privacy-section-${id}`;
}

/**
 * In-page navigation without touching `location.hash`.
 *
 * enough. routes on the URL fragment (`#/privacy`), so a plain
 * `<a href="#controller">` would replace the route and unmount this screen.
 * Scrolling is therefore done programmatically, and the heading receives
 * focus so keyboard and screen-reader users continue from the section they
 * jumped to instead of staying at the top of the document.
 */
function scrollToSection(id: string): void {
  const target = document.getElementById(sectionDomId(id));
  if (!target) return;
  // `scrollIntoView` is missing in some embedded webviews; focusing the section
  // is what keyboard and screen-reader users actually depend on, so the jump
  // must not fail just because smooth scrolling is unavailable.
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  target.focus({ preventScroll: true });
}

function isPlaceholder(value: string): boolean {
  return value.includes('[') && value.includes(']');
}

/**
 * Renders the body of one policy section as flat siblings (paragraphs plus the
 * optional controller block / reference list), so the existing
 * `.legal-section > * + *` rhythm applies without extra wrapper elements.
 */
function sectionBody(
  section: PolicySection,
  address: { street: string; postalCode: string; city: string; country: string },
  email: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];

  section.paragraphs.forEach((key, index) => {
    nodes.push(<p key={key}>{t(key)}</p>);

    if (section.controllerBlock && index === 0) {
      nodes.push(
        <address className="legal-address" key="legal-address">
          <strong>{imprintConfig.providerName}</strong>
          <br />
          {address.street}
          <br />
          {address.postalCode} {address.city}
          <br />
          {address.country}
        </address>,
      );
      nodes.push(
        <dl className="legal-contact-list" key="legal-email">
          <div>
            <dt>{t('legal.email')}</dt>
            <dd>
              {isPlaceholder(email) ? (
                email
              ) : (
                <a className="link" href={`mailto:${email}`}>
                  {email}
                </a>
              )}
            </dd>
          </div>
        </dl>,
      );
    }

    if (section.references && index === section.paragraphs.length - 1) {
      nodes.push(
        <div className="legal-refs" key="legal-refs">
          <p className="legal-refs-title">{t('privacy.referencesLabel')}</p>
          <ul className="legal-refs-list">
            {PROVIDER_REFERENCES.map((ref) => (
              <li key={ref.url}>
                <a className="link" href={ref.url} target="_blank" rel="noreferrer">
                  {t(ref.label)}
                </a>
              </li>
            ))}
          </ul>
        </div>,
      );
    }
  });

  return nodes;
}

export default function Privacy() {
  const route = useHashRoute();
  const [lang, setLang] = useLang();
  const { address, contact } = imprintConfig;

  useEffect(() => {
    if (route.startsWith('#/datenschutz') && lang !== 'de') {
      setLang('de');
    } else if (route.startsWith('#/privacy') && lang !== 'en') {
      setLang('en');
    }
  }, [route, lang, setLang]);

  const handleLangToggle = () => {
    if (lang === 'en') {
      setLang('de');
      navigate('#/datenschutz');
    } else {
      setLang('en');
      navigate('#/privacy');
    }
  };

  return (
    <main className="legal-screen">
      <header className="legal-header">
        <a className="icon-button" href="#/" aria-label={t('back')}>
          <BackIcon size={22} />
        </a>

        <a className="logo legal-logo" href="#/">
          enough.
        </a>

        <div className="legal-header-actions">
          <ThemeButton />

          <button
            type="button"
            className="lang-button"
            onClick={handleLangToggle}
            aria-label="Language / Sprache"
          >
            {lang === 'en' ? 'EN' : 'DE'}
          </button>
        </div>
      </header>

      <article className="legal-content">
        <p className="legal-kicker">{t('privacy.kicker')}</p>
        <h1>{t('privacy.title')}</h1>
        <p className="legal-intro">{t('privacy.intro')}</p>
        <p className="legal-intro">
          <strong>{t('privacy.lastUpdated')}</strong>
        </p>

        <nav className="legal-toc" aria-label={t('privacy.tocTitle')}>
          <p className="legal-toc-title">{t('privacy.tocTitle')}</p>
          <ul className="legal-toc-list">
            {POLICY_SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className="legal-toc-link"
                  onClick={() => scrollToSection(section.id)}
                >
                  {t(section.title)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {POLICY_SECTIONS.map((section) => (
          <section
            key={section.id}
            id={sectionDomId(section.id)}
            className="legal-section legal-section-privacy"
            tabIndex={-1}
          >
            <h2>{t(section.title)}</h2>
            {sectionBody(section, address, contact.email)}
          </section>
        ))}

        {/* Cross-link to the imprint (kept as the closing element). */}
        <section className="legal-section">
          <h2>{t('legal.imprint')}</h2>
          <p>
            <a className="link" href={lang === 'de' ? '#/impressum' : '#/imprint'}>
              {t('legal.imprintLinkText')}
            </a>
          </p>
        </section>
      </article>
    </main>
  );
}
