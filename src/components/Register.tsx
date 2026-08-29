import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isValidUsername, normalizeUsername } from '../lib/helpers';
import { MAX_DISPLAY_NAME_LENGTH, sanitizeDisplayName } from '../lib/input';
import { usernameExists } from '../lib/api';
import { t } from '../i18n';
import AuthChrome from './AuthChrome';
import LegalFooter from './LegalFooter';

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
  const checkIdRef = useRef(0);

  // Live username validation: format check while typing, availability check
  // (debounced) once the format is valid. No failsafe that pretends
  // \"available\" — we never show available unless the server confirmed it.
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
    const currentId = ++checkIdRef.current;
    const timer = setTimeout(async () => {
      // If another check started meanwhile, ignore this result (race guard).
      if (currentId !== checkIdRef.current) return;
      try {
        const taken = await usernameExists(name);
        if (currentId !== checkIdRef.current) return;
        setUsernameState(taken ? 'taken' : 'available');
      } catch {
        if (currentId !== checkIdRef.current) return;
        // On network errors don't show \"available\" — keep checking state
        // as \"taken\"-like blocked (conservative) or reset to idle so user
        // cannot proceed with a false positive.
        setUsernameState('taken');
      }
    }, 400);
    return () => {
      clearTimeout(timer);
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
    // Always re-check right before submit to catch races and to avoid
    // relying only on the debounced UI state which could have been shown
    // as \"available\" before a concurrent registration.
    if (usernameState === 'checking') {
      setError(t('auth.checkingUsername'));
      return;
    }
    // If format is ok but we haven't confirmed free, verify now.
    if (usernameState !== 'available') {
      setUsernameState('checking');
      const taken = await usernameExists(name);
      setUsernameState(taken ? 'taken' : 'available');
      if (taken) {
        setError(t('auth.usernameTaken'));
        return;
      }
    } else {
      // Even when UI says available, double-check synchronously.
      const taken = await usernameExists(name);
      if (taken) {
        setUsernameState('taken');
        setError(t('auth.usernameTaken'));
        return;
      }
    }

    const cleanDisplayName = sanitizeDisplayName(displayName);
    if (!cleanDisplayName) {
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
    const result = await signUp(email, password, name, cleanDisplayName);
    setBusy(false);
    if (result.error) {
      // Do not infer a duplicate username from a translated backend error.
      // Check the canonical server state instead, so copy changes cannot make
      // the availability UI lie.
      try {
        if (await usernameExists(name)) setUsernameState('taken');
      } catch {
        // Preserve the original registration error if the follow-up check is
        // unavailable; the form remains safely unsubmitted.
      }
      setError(result.error);
      return;
    }
    if (result.needsConfirmation) {
      setNotice('confirm'); // triggers the confirmation screen
    }
  }

  if (notice === 'confirm') {
    return <ConfirmEmail email={email} />;
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
        {/* Permanent, subtle note: the username is fixed after sign-up, so it
            should be chosen deliberately — unlike the hints above this is not
            a validation state and always stays visible. */}
        <p className="field-hint muted">{t('auth.usernamePermanent')}</p>
        <input
          className="input"
          type="text"
          placeholder={t('auth.displayName')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          required
          aria-label={t('auth.displayName')}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
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
          disabled={
            busy ||
            usernameState === 'checking' ||
            usernameState === 'taken' ||
            usernameState === 'invalid'
          }
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

      <LegalFooter className="auth-legal-footer" />
    </main>
  );
}

function ConfirmEmail({ email }: { email: string }) {
  const { resendConfirmation } = useAuth();
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend() {
    if (resendBusy || !email) return;
    setResendBusy(true);
    setResendNotice(null);
    setResendError(null);
    const err = await resendConfirmation(email);
    setResendBusy(false);
    if (err) {
      setResendError(err);
    } else {
      setResendNotice(t('auth.confirmResent'));
    }
  }

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
      {resendNotice && (
        <p className="field-hint ok" style={{ marginTop: 12 }}>
          {resendNotice}
        </p>
      )}
      {resendError && (
        <p className="error" style={{ marginTop: 12 }} role="alert">
          {resendError}
        </p>
      )}
      <div className="auth-links" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="link"
          onClick={handleResend}
          disabled={resendBusy}
        >
          {resendBusy ? t('loading') : t('auth.confirmResend')}
        </button>
      </div>
      <div className="register">
        <a className="link" href="#/login">
          {t('auth.backToLogin')}
        </a>
      </div>

      <LegalFooter className="auth-legal-footer" />
    </main>
  );
}
