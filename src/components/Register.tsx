import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isValidUsername, normalizeUsername } from '../lib/helpers';
import { usernameExists } from '../lib/api';
import { t } from '../i18n';
import AuthChrome from './AuthChrome';

type UsernameState = 'idle' | 'invalid' | 'checking' | 'available' | 'taken';

export default function Register() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [usernameState, setUsernameState] = useState<UsernameState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live username validation: format check while typing, availability check
  // (debounced) once the format is valid.
  useEffect(() => {
    const name = normalizeUsername(username);
    if (!name) {
      setUsernameState('idle');
      return;
    }
    if (!isValidUsername(name)) {
      setUsernameState('invalid');
      return;
    }
    setUsernameState('checking');
    const timer = setTimeout(async () => {
      const taken = await usernameExists(name);
      setUsernameState(taken ? 'taken' : 'available');
    }, 400);
    // Failsafe: never block the submit button on a failed availability probe.
    const failsafe = setTimeout(() => setUsernameState('available'), 4000);
    return () => {
      clearTimeout(timer);
      clearTimeout(failsafe);
    };
  }, [username]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    const name = normalizeUsername(username);
    if (!isValidUsername(name)) {
      setError(t('auth.usernameInvalid'));
      return;
    }
    if (usernameState === 'taken') {
      setError(t('auth.usernameTaken'));
      return;
    }
    if (!displayName.trim()) {
      setError(t('auth.displayNameRequired'));
      return;
    }
    if (password.length < 6) {
      setError(t('errors.weakPassword'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setBusy(true);
    const result = await signUp(email, password, name, displayName.trim());
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.needsConfirmation) {
      setNotice('confirm'); // triggers the confirmation screen
    }
  }

  if (notice === 'confirm') {
    return <ConfirmEmail />;
  }

  const usernameHint =
    usernameState === 'invalid'
      ? t('auth.usernameInvalid')
      : usernameState === 'taken'
        ? t('auth.usernameTaken')
        : usernameState === 'available'
          ? t('auth.usernameAvailable')
          : null;

  return (
    <main className="auth-screen">
      <AuthChrome />
      <section className="brand">
        <h1>enough.</h1>
      </section>

      <form className="form" onSubmit={onSubmit} noValidate>
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
        <div
          className={`at-field${usernameState === 'invalid' || usernameState === 'taken' ? ' invalid' : ''}${usernameState === 'available' ? ' valid' : ''}`}
        >
          <span className="at-prefix" aria-hidden="true">
            @
          </span>
          <input
            className="input at-input"
            type="text"
            placeholder={t('auth.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            aria-label={`@${t('auth.username')}`}
            spellCheck={false}
            autoCapitalize="none"
          />
          {usernameState === 'checking' && (
            <span className="at-status" role="status">
              {t('auth.checkingUsername')}
            </span>
          )}
        </div>
        {usernameHint && (
          <p className={`field-hint${usernameState === 'available' ? ' ok' : ''}`}>
            {usernameHint}
          </p>
        )}
        <input
          className="input"
          type="text"
          placeholder={t('auth.displayName')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          required
          aria-label={t('auth.displayName')}
          maxLength={60}
        />
        <input
          className="input"
          type="password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
          aria-label={t('auth.password')}
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
        <button
          className="button"
          type="submit"
          disabled={busy || usernameState === 'checking'}
        >
          {busy ? t('loading') : t('auth.register')}
        </button>
      </form>

      <div className="register">
        {t('auth.haveAccount')}{' '}
        <a className="link" href="#/login">
          {t('auth.login')}
        </a>
      </div>
    </main>
  );
}

function ConfirmEmail() {
  return (
    <main className="auth-screen">
      <AuthChrome />
      <section className="brand">
        <h1>enough.</h1>
      </section>
      <section className="notice-card">
        <h2>{t('auth.confirmTitle')}</h2>
        <p>{t('auth.confirmText')}</p>
      </section>
      <div className="register">
        <a className="link" href="#/login">
          {t('auth.backToLogin')}
        </a>
      </div>
    </main>
  );
}
