import { useEffect } from 'react';
import { imprintConfig } from '../config/imprint';
import { t, useLang } from '../i18n';
import { navigate, useHashRoute } from '../lib/router';
import { BackIcon } from './icons';
import ThemeButton from './ThemeButton';

function isPlaceholder(value: string): boolean {
  return value.includes('[') && value.includes(']');
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

        {/* 1. Overview */}
        <section className="legal-section">
          <h2>{t('privacy.sectionOverviewTitle')}</h2>
          <p>{t('privacy.sectionOverviewText')}</p>
        </section>

        {/* 2. Controller & Contact */}
        <section className="legal-section">
          <h2>{t('privacy.sectionControllerTitle')}</h2>
          <p>{t('privacy.sectionControllerIntro')}</p>
          <address style={{ marginTop: '8px' }}>
            <strong>{imprintConfig.providerName}</strong>
            <br />
            {address.street}
            <br />
            {address.postalCode} {address.city}
            <br />
            {address.country}
          </address>
          <dl className="legal-contact-list" style={{ marginTop: '12px' }}>
            <div>
              <dt>{t('legal.email')}</dt>
              <dd>
                {isPlaceholder(contact.email) ? (
                  contact.email
                ) : (
                  <a className="link" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* 3. Frontend Hosting (GitHub Pages) */}
        <section className="legal-section">
          <h2>{t('privacy.sectionHostingTitle')}</h2>
          <p>{t('privacy.sectionHostingText')}</p>
        </section>

        {/* 4. Account & Profile Data */}
        <section className="legal-section">
          <h2>{t('privacy.sectionAccountTitle')}</h2>
          <p>{t('privacy.sectionAccountText')}</p>
        </section>

        {/* 5. End-to-End Encryption & Metadata */}
        <section className="legal-section">
          <h2>{t('privacy.sectionE2eeTitle')}</h2>
          <p>{t('privacy.sectionE2eeText')}</p>
          <p style={{ marginTop: '8px' }}>{t('privacy.sectionE2eeMetadata')}</p>
          <p style={{ marginTop: '8px' }}>{t('privacy.sectionE2eeExceptions')}</p>
        </section>

        {/* 6. Backend Infrastructure & Server Logs (Supabase) */}
        <section className="legal-section">
          <h2>{t('privacy.sectionBackendTitle')}</h2>
          <p>{t('privacy.sectionBackendText')}</p>
          <p style={{ marginTop: '8px' }}>{t('privacy.sectionBackendLogs')}</p>
        </section>

        {/* 7. Local Storage & IndexedDB */}
        <section className="legal-section">
          <h2>{t('privacy.sectionLocalStorageTitle')}</h2>
          <p>{t('privacy.sectionLocalStorageText')}</p>
        </section>

        {/* 8. Contact Form & Email Delivery (Resend) */}
        <section className="legal-section">
          <h2>{t('privacy.sectionContactTitle')}</h2>
          <p>{t('privacy.sectionContactText')}</p>
          <p style={{ marginTop: '8px' }}>{t('privacy.sectionContactResend')}</p>
        </section>

        {/* 9. Deletion */}
        <section className="legal-section">
          <h2>{t('privacy.sectionDeletionTitle')}</h2>
          <p>{t('privacy.sectionDeletionText')}</p>
        </section>

        {/* 10. GDPR Rights */}
        <section className="legal-section">
          <h2>{t('privacy.sectionRightsTitle')}</h2>
          <p>{t('privacy.sectionRightsText')}</p>
        </section>

        {/* Link to Imprint */}
        <section className="legal-section">
          <h2>{t('legal.imprint')}</h2>
          <p>
            <a
              className="link"
              href={lang === 'de' ? '#/impressum' : '#/imprint'}
            >
              {t('legal.imprintLinkText')}
            </a>
          </p>
        </section>
      </article>
    </main>
  );
}
