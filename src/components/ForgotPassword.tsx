import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import AuthChrome from './AuthChrome';

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await resetPassword(email);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  }

  return (
    <main className="auth-screen">
      <AuthChrome />
      <section className="brand">
        <h1>enough.</h1>
      </section>

      {sent ? (
        <section className="notice-card">
          <h2>{t('auth.forgotTitle')}</h2>
          <p>{t('auth.resetSent')}</p>
        </section>
      ) : (
        <form className="form" onSubmit={onSubmit}>
          <p className="form-hint">{t('auth.forgotText')}</p>
          <input
            className="input"
            type="email"
            placeholder={t('auth.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            aria-label={t('auth.email')}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button" type="submit" disabled={busy}>
            {busy ? t('loading') : t('auth.sendResetLink')}
          </button>
        </form>
      )}

      <div className="register">
        <a className="link" href="#/login">
          {t('auth.backToLogin')}
        </a>
      </div>
    </main>
  );
}
