import { t } from '../../i18n';
import { applyMode, ThemeMode } from '../../lib/theme';
import { CheckIcon, MoonIcon, SunIcon, SystemIcon } from '../icons';
import { Section } from './settings-ui';

interface AppearanceSettingsProps {
  appearanceMode: ThemeMode;
  setAppearanceMode: (mode: ThemeMode) => void;
}

export default function AppearanceSettings({
  appearanceMode,
  setAppearanceMode,
}: AppearanceSettingsProps) {
  return (
    <Section title={t('settingsScreen.appearance')}>
      <div className="option-list" role="radiogroup" aria-label={t('settingsScreen.appearance')}>
        {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={appearanceMode === m}
            className={`option${appearanceMode === m ? ' selected' : ''}`}
            onClick={() => {
              applyMode(m);
              setAppearanceMode(m);
            }}
          >
            <span className="option-label">
              {m === 'light' ? (
                <SunIcon size={17} />
              ) : m === 'dark' ? (
                <MoonIcon size={17} />
              ) : (
                <SystemIcon size={17} />
              )}
              {t(
                m === 'light'
                  ? 'settingsScreen.light'
                  : m === 'dark'
                    ? 'settingsScreen.dark'
                    : 'settingsScreen.system',
              )}
            </span>
            {appearanceMode === m && <CheckIcon size={16} />}
          </button>
        ))}
      </div>
    </Section>
  );
}
