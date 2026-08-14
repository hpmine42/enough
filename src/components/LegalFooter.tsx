import { t } from '../i18n';

export default function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`legal-footer${className ? ` ${className}` : ''}`}>
      <a className="link" href="#/impressum">
        {t('legal.imprint')}
      </a>
    </footer>
  );
}
