interface ErrorFields {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
  name?: string;
}

// Log only the diagnostic fields returned by Supabase. Avoid logging request
// bodies, credentials, sessions, tokens, or the complete error object.
function logError(error: ErrorFields, context: string): void {
  console.error(`enough. ${context}:`, {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    status: error.status ?? null,
    name: error.name ?? null,
  });
}

// Maps known error codes to short, human-readable German messages while
// retaining stage-specific Supabase diagnostics in the browser console.
export function errorMessage(error: unknown, context?: string): string {
  const e = error as ErrorFields | null | undefined;
  if (!e) return 'Etwas ist schiefgelaufen.';

  // Registration passes an explicit stage so even mapped errors retain their
  // exact diagnostics. Other existing flows keep their previous behavior and
  // only log errors that would otherwise fall back to the generic message.
  if (context) logError(e, context);

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
    code === '23505' &&
    (msg.includes('username') || msg.includes('profiles_username'))
  ) {
    return 'Dieser Benutzername ist bereits vergeben.';
  }
  if (
    code === '23502' &&
    msg.includes('username') &&
    msg.includes('profiles')
  ) {
    return 'Der Benutzername konnte nicht gespeichert werden.';
  }
  if (
    code === '42501' &&
    msg.includes('row-level security') &&
    msg.includes('profiles')
  ) {
    return 'Das Profil konnte nicht erstellt werden.';
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

  if (!context) logError(e, 'request error');
  return 'Etwas ist schiefgelaufen.';
}
