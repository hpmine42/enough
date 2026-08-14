import { useLang } from '../i18n';
import ThemeButton from './ThemeButton';

/**
 * Top-right controls on authentication screens: theme toggle + language
 * switch (EN / DE, no flags). The selected language persists.
 */
export default function AuthChrome() {
  const [lang, setLang] = useLang();

  return (
    <div className="auth-chrome">
      <ThemeButton />
      <button
        type="button"
        className="lang-button"
        onClick={() => setLang(lang === 'en' ? 'de' : 'en')}
        aria-label="Language / Sprache"
      >
        {lang === 'en' ? 'EN' : 'DE'}
      </button>
    </div>
  );
}
