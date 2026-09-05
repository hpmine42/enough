import { useState, useRef, type FormEvent } from 'react';
import { sendContactMessage } from '../lib/api';
import { t } from '../i18n';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const mountTime = useRef<number>(Date.now());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    const trimmedName = name.trim();

    if (!trimmedEmail) {
      setError(t('contact.errorEmailRequired'));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmedEmail.length > 255 || !emailRegex.test(trimmedEmail)) {
      setError(t('contact.errorEmailInvalid'));
      return;
    }
    if (!trimmedMessage) {
      setError(t('contact.errorMessageRequired'));
      return;
    }
    if (trimmedMessage.length < 10) {
      setError(t('contact.errorMessageTooShort'));
      return;
    }
    if (trimmedMessage.length > 5000) {
      setError(t('contact.errorMessageTooLong'));
      return;
    }
    if (trimmedName.length > 100) {
      setError(t('contact.errorNameTooLong'));
      return;
    }

    setBusy(true);

    try {
      const result = await sendContactMessage({
        name: trimmedName,
        email: trimmedEmail,
        message: trimmedMessage,
        hp,
        clientTime: mountTime.current,
      });

      if (!result.ok) {
        setError(result.error || t('contact.sendFailed'));
        return;
      }

      setSuccess(true);
      setName('');
      setEmail('');
      setMessage('');
      setHp('');
    } catch {
      setError(t('contact.sendFailed'));
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setSuccess(false);
    setError(null);
    mountTime.current = Date.now();
  }

  if (success) {
    return (
      <div className="contact-success-box">
        <p className="contact-success" role="status">
          {t('contact.success')}
        </p>
        <div>
          <button
            type="button"
            className="btn-small ghost"
            onClick={handleReset}
          >
            {t('contact.sendAnother')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate>
      <div className="contact-field">
        <label htmlFor="contact-name" className="contact-label">
          {t('contact.nameLabel')}
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          className="contact-input"
          placeholder={t('contact.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          disabled={busy}
          autoComplete="name"
        />
      </div>

      <div className="contact-field">
        <label htmlFor="contact-email" className="contact-label">
          {t('contact.emailLabel')} <span aria-hidden="true">*</span>
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          className="contact-input"
          placeholder={t('contact.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={255}
          disabled={busy}
          autoComplete="email"
        />
      </div>

      <div className="contact-field">
        <label htmlFor="contact-message" className="contact-label">
          {t('contact.messageLabel')} <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="contact-message"
          name="message"
          className="contact-textarea"
          placeholder={t('contact.messagePlaceholder')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          disabled={busy}
        />
      </div>

      {/* Honeypot field (hidden from visual and screen readers) */}
      <div
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
        aria-hidden="true"
      >
        <input
          type="text"
          name="contact_secondary_ref"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>

      {error && (
        <p className="contact-error error" role="alert">
          {error}
        </p>
      )}

      <p className="contact-privacy-note">{t('contact.privacyNote')}</p>

      <button type="submit" className="button" disabled={busy}>
        {busy ? t('contact.sending') : t('contact.submit')}
      </button>
    </form>
  );
}
