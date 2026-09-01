import { t } from '../../i18n';
import { MAX_DISPLAY_NAME_LENGTH } from '../../lib/input';
import { Section } from './settings-ui';

interface ProfileSettingsProps {
  nameDraft: string;
  nameBusy: boolean;
  nameError: string | null;
  nameSaved: boolean;
  setNameDraft: (value: string) => void;
  setNameSaved: (value: boolean) => void;
  saveDisplayName: () => void;
  displayNameValue: string;
  username: string;
  email: string;
  onEmailClick: () => void;
}

export default function ProfileSettings({
  nameDraft,
  nameBusy,
  nameError,
  nameSaved,
  setNameDraft,
  setNameSaved,
  saveDisplayName,
  displayNameValue,
  username,
  email,
  onEmailClick,
}: ProfileSettingsProps) {
  return (
    <Section title={t('settingsScreen.profile')}>
      <div className="settings-profile">
        <label className="settings-field-label" htmlFor="display-name">
          {t('settingsScreen.displayName')}
        </label>
        <div className="settings-edit-row">
          <input
            id="display-name"
            className="input"
            type="text"
            value={nameDraft}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            onChange={(e) => {
              setNameDraft(e.target.value);
              setNameSaved(false);
            }}
            onBlur={saveDisplayName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveDisplayName();
            }}
            aria-label={t('settingsScreen.displayName')}
          />
          {nameDraft.trim() !== displayNameValue && (
            <button
              type="button"
              className="btn-small"
              disabled={nameBusy}
              onClick={saveDisplayName}
            >
              {nameBusy ? t('loading') : t('save')}
            </button>
          )}
        </div>
        {nameSaved && <p className="field-hint ok">{t('saved')}</p>}
        {nameError && (
          <p className="error" role="alert">
            {nameError}
          </p>
        )}
        <div className="settings-static-row">
          <span className="settings-static-label">{t('settingsScreen.username')}</span>
          <span className="settings-static-value">@{username}</span>
        </div>
        <button
          type="button"
          className="settings-static-row settings-email-row"
          onClick={onEmailClick}
        >
          <span className="settings-static-label">{t('settingsScreen.email')}</span>
          <span className="settings-static-value">{email || '…'}</span>
        </button>
      </div>
    </Section>
  );
}
