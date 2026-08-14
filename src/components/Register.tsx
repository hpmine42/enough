import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isValidUsername, normalizeUsername } from '../lib/helpers';
import { usernameExists } from '../lib/api';

export default function Register() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    const name = normalizeUsername(username);
    if (!isValidUsername(name)) {
      setError(
        'Der Benutzername muss 3–20 Zeichen lang sein (Buchstaben, Zahlen, Unterstrich).',
      );
      return;
    }

    setBusy(true);
    const taken = await usernameExists(name);
    if (taken) {
      setBusy(false);
      setError('Dieser Benutzername ist bereits vergeben.');
      return;
    }

    const result = await signUp(email, password, name);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.needsConfirmation) {
      setNotice('Registrierung erfolgreich. Bitte bestätige deine E-Mail-Adresse.');
    }
  }

  return (
    <main className="auth-screen">
      <section className="brand">
        <h1>enough.</h1>
      </section>

      <form className="form" onSubmit={onSubmit}>
        <input
          className="input"
          type="email"
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          aria-label="E-Mail"
        />
        <input
          className="input"
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
          aria-label="Passwort"
        />
        <input
          className="input"
          type="text"
          placeholder="Benutzername"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          aria-label="Benutzername"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="notice">{notice}</p>}
        <button className="button" type="submit" disabled={busy}>
          {busy ? '…' : 'Registrieren'}
        </button>
      </form>

      <div className="register">
        Schon ein Konto?{' '}
        <a className="link" href="#/">
          Anmelden
        </a>
      </div>
    </main>
  );
}
