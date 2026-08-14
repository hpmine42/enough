import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n';
import AuthChrome from './AuthChrome';
import LegalFooter from './LegalFooter';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <main className="auth-screen">
      <AuthChrome />
      <section className="brand">
        <h1>enough.</h1>
      </section>

      <form className="form" onSubmit={onSubmit}>
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
        <input
          className="input"
          type="password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          aria-label={t('auth.password')}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy ? t('loading') : t('auth.login')}
        </button>
      </form>

      <div className="auth-links">
        <a className="link" href="#/forgot">
          {t('auth.forgotPassword')}
        </a>
      </div>

      <div className="register">
        {t('auth.noAccount')}{' '}
        <a className="link" href="#/register">
          {t('auth.register')}
        </a>
      </div>

      <LegalFooter className="auth-legal-footer" />
    </main>
  );
}
