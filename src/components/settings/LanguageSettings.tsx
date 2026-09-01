import { t, useLang } from '../../i18n';
import { Lang } from '../../i18n/translations';
import { CheckIcon } from '../icons';
import { Section } from './settings-ui';

export default function LanguageSettings() {
  const [lang, setLang] = useLang();
  return (
    <Section title={t('settingsScreen.language')}>
      <div className="option-list" role="radiogroup" aria-label={t('settingsScreen.language')}>
        {(['en', 'de'] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            className={`option${lang === l ? ' selected' : ''}`}
            onClick={() => setLang(l)}
          >
            {l === 'en' ? 'English' : 'Deutsch'}
            {lang === l && <CheckIcon size={16} />}
          </button>
        ))}
      </div>
    </Section>
  );
}
