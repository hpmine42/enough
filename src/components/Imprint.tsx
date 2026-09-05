import { useEffect } from 'react';
import { imprintConfig } from '../config/imprint';
import { t, useLang } from '../i18n';
import { navigate, useHashRoute } from '../lib/router';
import { BackIcon } from './icons';
import ThemeButton from './ThemeButton';
import ContactForm from './ContactForm';

function isPlaceholder(value: string): boolean {
  return value.includes('[') && value.includes(']');
}

export default function Imprint() {
  const route = useHashRoute();
  const [lang, setLang] = useLang();
  const { address, contact, register, editoriallyResponsible } = imprintConfig;

  useEffect(() => {
    if (route.startsWith('#/impressum') && lang !== 'de') {
      setLang('de');
    } else if (route.startsWith('#/imprint') && lang !== 'en') {
      setLang('en');
    }
  }, [route, lang, setLang]);

  const handleLangToggle = () => {
    if (lang === 'en') {
      setLang('de');
      navigate('#/impressum');
    } else {
      setLang('en');
      navigate('#/imprint');
    }
  };

  const hasRegisterEntry = Boolean(
    register.name || register.court || register.number,
  );

  const hasEditorialResponsibility = Boolean(
    editoriallyResponsible.name || editoriallyResponsible.address,
  );

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
        <p className="legal-kicker">{t('legal.legal')}</p>
        <h1>{t('legal.imprint')}</h1>
        <p className="legal-intro">{t('legal.pursuantTo')}</p>
        <p className="legal-intro">
          <strong>{t('legal.lastUpdated')}</strong>
        </p>

        <section className="legal-section">
          <h2>{t('legal.provider')}</h2>

          <address>
            <strong>{imprintConfig.providerName}</strong>
            <br />
            {address.street}
            <br />
            {address.postalCode} {address.city}
            <br />
            {address.country}
          </address>
        </section>

        {imprintConfig.representedBy && (
          <section className="legal-section">
            <h2>{t('legal.representedBy')}</h2>
            <p>{imprintConfig.representedBy}</p>
          </section>
        )}

        <section className="legal-section">
          <h2>{t('legal.contact')}</h2>

          <dl className="legal-contact-list">
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

          <ContactForm />
        </section>

        {hasRegisterEntry && (
          <section className="legal-section">
            <h2>{t('legal.registerEntry')}</h2>

            {register.name && <p>{register.name}</p>}

            {register.court && (
              <p>
                {t('legal.registerCourt')}: {register.court}
              </p>
            )}

            {register.number && (
              <p>
                {t('legal.registerNumber')}: {register.number}
              </p>
            )}
          </section>
        )}

        {imprintConfig.vatId && (
          <section className="legal-section">
            <h2>{t('legal.vatId')}</h2>
            <p>{imprintConfig.vatId}</p>
          </section>
        )}

        {hasEditorialResponsibility && (
          <section className="legal-section">
            <h2>{t('legal.editoriallyResponsible')}</h2>

            {editoriallyResponsible.name && (
              <p>{editoriallyResponsible.name}</p>
            )}

            {editoriallyResponsible.address && (
              <p>{editoriallyResponsible.address}</p>
            )}
          </section>
        )}

        <section className="legal-section">
          <h2>{t('legal.privacy')}</h2>
          <p>
            <a
              className="link"
              href={lang === 'de' ? '#/datenschutz' : '#/privacy'}
            >
              {t('legal.privacyLinkText')}
            </a>
          </p>
        </section>
      </article>
    </main>
  );
}
