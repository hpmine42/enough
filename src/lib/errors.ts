import type { TranslationKey } from '../i18n';
import { t } from '../i18n';

interface ErrorFields {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
  name?: string;
}

// Keep production diagnostics limited to stable, non-content metadata. Error
// messages, details, and hints can echo user input or database values.
function logError(error: ErrorFields, context: string): void {
  console.error(`enough. ${context}:`, {
    code: error.code ?? null,
    status: error.status ?? null,
    name: error.name ?? null,
  });
}

type ErrorKey =
  | 'errors.generic'
  | 'errors.network'
  | 'errors.invalidCredentials'
  | 'errors.emailTaken'
  | 'errors.weakPassword'
  | 'errors.usernameTaken'
  | 'errors.usernameSave'
  | 'errors.profileCreate'
  | 'errors.noProfile'
  | 'errors.permissionDenied'
  | 'errors.emailNotConfirmed'
  | 'errors.emailNotFound'
  | 'errors.wrongPassword'
  | 'errors.blockedRequest';

const keyOf = (k: ErrorKey): TranslationKey => k as unknown as TranslationKey;

// Maps known Supabase error codes / messages to localized, human-readable text.
// Stage-specific diagnostics stay in the browser console (developers only).
export function errorMessage(error: unknown, context?: string): string {
  const e = error as ErrorFields | null | undefined;
  if (!e) return t(keyOf('errors.generic'));

  if (context) logError(e, context);

  const code = e.code;
  const msg = (e.message ?? '').toLowerCase();

  if (
    code === 'invalid_credentials' ||
    msg.includes('invalid login credentials')
  ) {
    return t(keyOf('errors.invalidCredentials'));
  }
  if (
    msg.includes('email not confirmed') ||
    msg.includes('email_not_confirmed')
  ) {
    return t(keyOf('errors.emailNotConfirmed'));
  }
  if (
    code === 'user_already_exists' ||
    msg.includes('already registered') ||
    msg.includes('already been registered')
  ) {
    return t(keyOf('errors.emailTaken'));
  }
  if (code === 'weak_password' || msg.includes('password should be')) {
    return t(keyOf('errors.weakPassword'));
  }
  if (
    code === '23505' &&
    (msg.includes('username') || msg.includes('profiles_username'))
  ) {
    return t(keyOf('errors.usernameTaken'));
  }
  if (
    code === '23502' &&
    msg.includes('username') &&
    msg.includes('profiles')
  ) {
    return t(keyOf('errors.usernameSave'));
  }
  if (
    code === '42501' &&
    msg.includes('row-level security') &&
    msg.includes('profiles')
  ) {
    return t(keyOf('errors.profileCreate'));
  }
  if (
    msg === 'failed to fetch' ||
    msg.includes('networkerror') ||
    msg.includes('fetch failed') ||
    msg.includes('network request failed')
  ) {
    return t(keyOf('errors.network'));
  }
  if (code === 'PGRST116') {
    return t(keyOf('errors.noProfile'));
  }
  if (code === 'P0001') {
    // Raised by DB triggers, e.g. messaging into a non-active connection.
    return t('chat.unavailable');
  }
  if (code === 'BLCKD') {
    // Raised by the block guards / RPCs when a block forbids the action.
    return t(keyOf('errors.blockedRequest'));
  }
  if (code === '42501') {
    return t(keyOf('errors.permissionDenied'));
  }

  if (!context) logError(e, 'request error');

  // Context-specific fallbacks for known operations that otherwise produce
  // an unhelpful "generic" error.
  if (context?.includes('decline')) {
    return t('errors.declineFailed');
  }
  if (context?.includes('accept')) {
    return t('errors.acceptFailed');
  }
  if (context?.includes('registration')) {
    // Registration failures often come from the auth trigger hitting a
    // unique constraint on username in the profiles table.
    if (
      code === '23505' ||
      msg.includes('duplicate key') ||
      msg.includes('unique constraint')
    ) {
      return t(keyOf('errors.usernameTaken'));
    }
  }

  return t(keyOf('errors.generic'));
}
