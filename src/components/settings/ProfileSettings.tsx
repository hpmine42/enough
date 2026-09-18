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
  /**
   * The address the auth session carries. `undefined` is a real data state
   * (a session without an email address), not a loading state: this screen
   * only renders after the authentication check has resolved, so the value
   * is either present or genuinely absent — it is never "still fetching".
   */
  email: string | undefined;
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
          {/* The value slot carries the session's own address, verbatim — no
              fallback literal, so no placeholder can ever render. A session
              without an email address renders the label alone: the empty
              value is a legitimate state and the row (the entry point to the
              change-email flow) stays exactly where it is. */}
          {email && <span className="settings-static-value">{email}</span>}
        </button>
      </div>
    </Section>
  );
}
