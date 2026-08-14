import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import AuthChrome from './AuthChrome';

/** Shown after the user follows a password-reset link (recovery session). */
export default function ResetPassword() {
  const { updatePassword, clearRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 6) {
      setError(t('errors.weakPassword'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    const err = await updatePassword(password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setDone(true);
    clearRecovery();
  }

  if (done) {
    return (
      <main className="auth-screen">
        <AuthChrome />
        <section className="brand">
          <h1>enough.</h1>
        </section>
        <section className="notice-card">
          <h2>{t('auth.resetTitle')}</h2>
          <p>{t('auth.resetSuccess')}</p>
        </section>
        <div className="register">
          <a className="link" href="#/login">
            {t('auth.backToLogin')}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <AuthChrome />
      <section className="brand">
        <h1>enough.</h1>
      </section>

      <form className="form" onSubmit={onSubmit}>
        <p className="form-hint">{t('auth.resetText')}</p>
        <input
          className="input"
          type="password"
          placeholder={t('settingsScreen.newPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
          aria-label={t('settingsScreen.newPassword')}
        />
        <input
          className="input"
          type="password"
          placeholder={t('auth.confirmPassword')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          aria-label={t('auth.confirmPassword')}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy ? t('loading') : t('auth.setNewPassword')}
        </button>
      </form>

      <div className="register">
        <a className="link" href="#/login">
          {t('auth.backToLogin')}
        </a>
      </div>
    </main>
  );
}
