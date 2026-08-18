import { t, useLang } from '../i18n';

export default function LegalFooter({ className = '' }: { className?: string }) {
  const [lang] = useLang();
  return (
    <footer className={`legal-footer${className ? ` ${className}` : ''}`}>
      <a className="link" href={lang === 'de' ? '#/impressum' : '#/imprint'}>
        {t('legal.imprint')}
      </a>
    </footer>
  );
}
