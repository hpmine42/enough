// Maps known error codes to short, human-readable German messages.
// Raw error details are logged for development but never shown to the user.
export function errorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null | undefined;
  if (!e) return 'Etwas ist schiefgelaufen.';

  const code = e.code;
  const msg = (e.message ?? '').toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Anmeldung fehlgeschlagen.';
  }
  if (
    code === 'user_already_exists' ||
    msg.includes('already registered') ||
    msg.includes('already been registered')
  ) {
    return 'Diese E-Mail-Adresse ist bereits registriert.';
  }
  if (code === 'weak_password' || msg.includes('password should be')) {
    return 'Das Passwort ist zu schwach.';
  }
  if (
    msg === 'failed to fetch' ||
    msg.includes('networkerror') ||
    msg.includes('fetch failed') ||
    msg.includes('network request failed')
  ) {
    return 'Keine Verbindung zum Server.';
  }
  if (code === 'PGRST116') {
    return 'Kein Profil gefunden.';
  }

  console.error('enough. error:', error);
  return 'Etwas ist schiefgelaufen.';
}
