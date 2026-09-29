import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isPlausibleOtpCode, normalizeOtpCode } from '../lib/authOtp';
import { useResendCooldown } from './useResendCooldown';
import { t } from '../i18n';
import AuthChrome from './AuthChrome';
import LegalFooter from './LegalFooter';

/**
 * Password recovery, step 1 + 2: request a one-time code by email, then
 * enter it. The reply after step 1 is neutral for every address (no
 * account-existence signal); the code itself is validated SERVER-side
 * (`verifyOtp` type 'recovery'). A successful verify issues the recovery
 * session, which flips the auth context into `recovery` and swaps this
 * screen for the password form.
 */
export default function ForgotPassword() {
  const { resetPassword, verifyRecoveryCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const { remaining, markSent } = useResendCooldown(false);

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const err = await resetPassword(email);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setSent(true);
    // The email just went out — start the resend window now.
    markSent();
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const normalized = normalizeOtpCode(code);
    // Formatting guard only — expiry, single use and correctness are
    // decided by Supabase Auth, never here.
    if (!normalized || !isPlausibleOtpCode(normalized)) {
      setError(t('auth.codeRequired'));
      return;
    }
    setBusy(true);
    // On success the auth context holds a recovery session and the app
    // renders the password form; `setBusy` below targets a screen that has
    // already been replaced (harmless in React 18).
    const err = await verifyRecoveryCode(email, normalized);
    setBusy(false);
    if (err) setError(err);
  }

  async function onResend() {
    if (resendBusy || remaining > 0 || !email) return;
    setResendBusy(true);
    setResendNotice(null);
    setError(null);
    const err = await resetPassword(email);
    setResendBusy(false);
    if (err) {
      setError(err);
    } else {
      setResendNotice(t('auth.confirmResent'));
      markSent();
    }
  }

  return (
    <main className="auth-screen">
      <AuthChrome />
      <section className="brand">
        <h1>enough.</h1>
        <p className="brand-tagline">{t('tagline')}</p>
      </section>

      {!sent ? (
        <form className="form" onSubmit={onRequest}>
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
            {t('auth.sendResetLink')}
          </button>
        </form>
      ) : (
        <>
          <section className="notice-card">
            <h2>{t('auth.codeEntryTitle')}</h2>
            <p>{t('auth.codeEntryText', { email })}</p>
            {/* Neutral wording: identical whether or not an account exists. */}
            <p style={{ marginTop: 8 }}>{t('auth.resetSent')}</p>
          </section>
          <form className="form" onSubmit={onVerify}>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('auth.codeLabel')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={12}
              required
              aria-label={t('auth.codeLabel')}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button" type="submit" disabled={busy}>
              {t('auth.verifyCode')}
            </button>
          </form>
          {resendNotice && (
            <p className="field-hint ok" style={{ marginTop: 12 }}>
              {resendNotice}
            </p>
          )}
          {remaining > 0 && (
            <p
              className="field-hint muted"
              style={{ marginTop: 12 }}
              role="status"
            >
              {t('auth.resendWait', { seconds: Math.ceil(remaining / 1000) })}
            </p>
          )}
          <div className="auth-links" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="link"
              onClick={onResend}
              disabled={resendBusy || remaining > 0}
            >
              {t('auth.confirmResend')}
            </button>
          </div>
        </>
      )}

      <div className="register">
        <a className="link" href="#/login">
          {t('auth.backToLogin')}
        </a>
      </div>

      <LegalFooter className="auth-legal-footer" />
    </main>
  );
}
