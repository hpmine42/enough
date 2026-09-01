import { FormEvent } from 'react';
import { t } from '../../i18n';
import { Section } from './settings-ui';

interface AccountSettingsProps {
  emailEditing: boolean;
  emailCollapseRender: boolean;
  emailCollapseClosing: boolean;
  newEmail: string;
  setNewEmail: (value: string) => void;
  emailBusy: boolean;
  emailError: string | null;
  emailNotice: string | null;
  onEmailChange: (e: FormEvent) => void;
  onOpenEmailChange: () => void;
  pwEditing: boolean;
  setPwEditing: (value: boolean) => void;
  pwCollapseRender: boolean;
  pwCollapseClosing: boolean;
  currentPw: string;
  setCurrentPw: (value: string) => void;
  newPw: string;
  setNewPw: (value: string) => void;
  confirmPw: string;
  setConfirmPw: (value: string) => void;
  pwBusy: boolean;
  pwError: string | null;
  pwNotice: string | null;
  onPasswordChange: (e: FormEvent) => void;
  /** Opens the password-change confirmation dialog (lives in Settings). */
  onOpenPasswordChange: () => void;
  onOpenSignOut: () => void;
  onOpenDelete: () => void;
}

export default function AccountSettings({
  emailEditing,
  emailCollapseRender,
  emailCollapseClosing,
  newEmail,
  setNewEmail,
  emailBusy,
  emailError,
  emailNotice,
  onEmailChange,
  onOpenEmailChange,
  pwEditing,
  setPwEditing,
  pwCollapseRender,
  pwCollapseClosing,
  currentPw,
  setCurrentPw,
  newPw,
  setNewPw,
  confirmPw,
  setConfirmPw,
  pwBusy,
  pwError,
  pwNotice,
  onPasswordChange,
  onOpenPasswordChange,
  onOpenSignOut,
  onOpenDelete,
}: AccountSettingsProps) {
  return (
    <Section title={t('settingsScreen.account')}>
      <button
        type="button"
        className="settings-row clickable"
        onClick={onOpenEmailChange}
      >
        <div className="settings-row-main">
          <div className="settings-row-label">{t('settingsScreen.editEmail')}</div>
        </div>
      </button>
      {emailCollapseRender && (
        <form
          className={`settings-inline-form${emailCollapseClosing ? ' closing' : ''}`}
          onSubmit={onEmailChange}
        >
          <input
            className="input"
            type="email"
            placeholder={t('settingsScreen.newEmail')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            autoComplete="email"
            required
            aria-label={t('settingsScreen.newEmail')}
          />
          <button className="btn-small" type="submit" disabled={emailBusy}>
            {emailBusy ? t('loading') : t('settingsScreen.changeEmailSubmit')}
          </button>
          {emailError && (
            <p className="error" role="alert">
              {emailError}
            </p>
          )}
        </form>
      )}
      {emailNotice && <p className="field-hint ok">{emailNotice}</p>}
      <button
        type="button"
        className="settings-row clickable"
        onClick={() => {
          if (pwEditing) {
            setPwEditing(false);
          } else {
            onOpenPasswordChange();
          }
        }}
      >
        <div className="settings-row-main">
          <div className="settings-row-label">{t('settingsScreen.changePassword')}</div>
        </div>
      </button>
      {pwCollapseRender && (
        <form
          className={`settings-inline-form${pwCollapseClosing ? ' closing' : ''}`}
          onSubmit={onPasswordChange}
        >
          <input
            className="input"
            type="password"
            placeholder={t('settingsScreen.currentPassword')}
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
            required
            aria-label={t('settingsScreen.currentPassword')}
          />
          <input
            className="input"
            type="password"
            placeholder={t('settingsScreen.newPassword')}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
            aria-label={t('settingsScreen.newPassword')}
          />
          <input
            className="input"
            type="password"
            placeholder={t('auth.confirmPassword')}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            autoComplete="new-password"
            required
            aria-label={t('auth.confirmPassword')}
          />
          {pwError && (
            <p className="error" role="alert">
              {pwError}
            </p>
          )}
          <button className="btn-small" type="submit" disabled={pwBusy}>
            {pwBusy ? t('loading') : t('settingsScreen.changePasswordSubmit')}
          </button>
        </form>
      )}
      {pwNotice && <p className="field-hint ok">{pwNotice}</p>}
      <button
        type="button"
        className="settings-row clickable danger-text"
        onClick={onOpenSignOut}
      >
        <div className="settings-row-main">
          <div className="settings-row-label">{t('settingsScreen.signOut')}</div>
        </div>
      </button>
      <div className="settings-delete-separator" aria-hidden="true" />
      <button
        type="button"
        className="settings-row clickable danger-text delete-spaced"
        onClick={onOpenDelete}
      >
        <div className="settings-row-main">
          <div className="settings-row-label">{t('settingsScreen.deleteAccount')}</div>
          <div className="settings-row-sub">{t('settingsScreen.deleteAccountHint')}</div>
        </div>
      </button>
    </Section>
  );
}
