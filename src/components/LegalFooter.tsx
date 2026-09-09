import { t, useLang } from '../i18n';

/**
 * Legal links shown on every unauthenticated screen (Login, Register, Forgot
 * password, Reset password) and on the "backend not configured" screen.
 *
 * Both the imprint AND the privacy policy are linked here: a visitor must be
 * able to read the privacy notice BEFORE handing over an e-mail address and a
 * password, i.e. without an account and without first opening the imprint
 * (audit C6 / F-05). The routes are the existing hash routes handled in
 * `App.tsx`; no parallel legal navigation is introduced.
 */
export default function LegalFooter({ className = '' }: { className?: string }) {
  const [lang] = useLang();
  const imprintHref = lang === 'de' ? '#/impressum' : '#/imprint';
  const privacyHref = lang === 'de' ? '#/datenschutz' : '#/privacy';
  return (
    <footer className={`legal-footer${className ? ` ${className}` : ''}`}>
      <a className="link" href={imprintHref}>
        {t('legal.imprint')}
      </a>
      <span className="legal-footer-sep" aria-hidden="true">
        ·
      </span>
      <a className="link" href={privacyHref}>
        {t('legal.privacy')}
      </a>
    </footer>
  );
}
