import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { User } from '@supabase/supabase-js';
import {
  hasImplicitRecoveryCallback,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import {
  deleteOwnAccount,
  getMyProfile,
  updateMyDisplayName,
  updateMyIdentityPublicKey,
  upsertProfile,
} from '../lib/api';
import { t } from '../i18n';
import { Profile } from '../lib/types';
import {
  initCrypto,
  isE2eeSupported,
  deleteUserCryptoState,
  getX25519IdentityPublicKeyBase64,
  ensureX25519Identity,
} from '../lib/crypto';
import { clearMessageCache } from '../lib/e2ee/message-cache';

interface SignUpResult {
  error: string | null;
  needsConfirmation: boolean;
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  recovery: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName: string,
  ) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<string | null>;
  resendConfirmation: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  updateEmail: (email: string) => Promise<string | null>;
  updateDisplayName: (name: string) => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    const p = await getMyProfile(userId);
    setProfile(p);
  }, []);

  /**
   * Initialize local E2EE identity for the signed-in user.
   * Receives the current Supabase user id so crypto state is correctly
   * isolated per account on shared devices.
   * Errors are caught — E2EE-1 never breaks login; if crypto isn't available
   * (old browser, restricted context) we log a generic warning and continue.
   * We deliberately do NOT log any key material or bundle contents.
   *
   * Flow (per PR scope — X25519 only):
   *   1. determine user id (caller)
   *   2. look for X25519 identity in IndexedDB (inside initCrypto)
   *   3. if found, load; if not, generate X25519 keypair (non-extractable)
   *   4. store locally (IndexedDB, per-user, non-extractable)
   *   5. export ONLY X25519 public key (base64, 32 bytes)
   *   6. upload ONLY X25519 public key to profiles.identity_public_key
   * No private key ever leaves the browser. No Ed25519 fallback is ever
   * written to identity_public_key — that column is strictly X25519.
   */
  const ensureCryptoReady = useCallback((userId: string) => {
    if (!isE2eeSupported() || !userId) return;
    initCrypto(userId)
      .then(async () => {
        try {
          // Strict X25519-only: identity_public_key must contain ONLY an
          // X25519 public key. If X25519 is not available, mark foundation
          // as unavailable and do NOT store an alternative (e.g. Ed25519).
          let publicKeyBase64: string | null = null;
          try {
            publicKeyBase64 = await getX25519IdentityPublicKeyBase64(userId);
            if (!publicKeyBase64) {
              publicKeyBase64 = await ensureX25519Identity(userId);
            }
          } catch {
            // X25519 not available in this browser/context — E2EE foundation
            // not available. Do not store an alternative key; keep messenger
            // in plaintext mode unchanged.
            return;
          }
          if (!publicKeyBase64 || !supabase) return;
          // Avoid redundant writes: check current DB value first.
          // This is best-effort; failures are non-fatal.
          try {
            const { data } = await supabase
              .from('profiles')
              .select('identity_public_key')
              .eq('id', userId)
              .maybeSingle();
            const current = (data as { identity_public_key?: string | null } | null)?.identity_public_key ?? null;
            if (current === publicKeyBase64) return;
          } catch {
            // ignore read failure, proceed to write
          }
          // Only the X25519 public key field is ever sent — never private material,
          // never an Ed25519 fallback.
          await updateMyIdentityPublicKey(userId, publicKeyBase64);
        } catch {
          // Swallow publish errors; do not block messenger and do not leak keys.
        }
      })
      .catch(() => {
        // Fail closed-silent: message flow continues in plaintext mode.
        // A future UI phase can surface this to the user.
        console.warn('enough.: E2EE initialization failed; continuing in plaintext mode.');
      });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    // Register the auth state listener BEFORE getSession() so that the
    // PASSWORD_RECOVERY event fired during URL detection is not missed.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (event === 'PASSWORD_RECOVERY') {
        // The user followed a password-reset link; the session is scoped for
        // updating the password only.
        setRecovery(true);
      }
      if (sessionUser) {
        loadProfile(sessionUser.id);
        ensureCryptoReady(sessionUser.id);
      } else {
        setProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        loadProfile(sessionUser.id);
        ensureCryptoReady(sessionUser.id);
        if (hasImplicitRecoveryCallback) setRecovery(true);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      if (!supabase) return t('errors.network');
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return errorMessage(error);
      return null;
    },
    [],
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      username: string,
      displayName: string,
    ): Promise<SignUpResult> => {
      if (!supabase) {
        return { error: t('errors.network'), needsConfirmation: false };
      }
      // The existing auth.users trigger creates public.profiles and reads the
      // username from raw_user_meta_data. display_name is passed along so the
      // profile trigger (see migration) can copy it when the column exists.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username, display_name: displayName },
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) {
        return {
          error: errorMessage(error, 'registration auth.signUp'),
          needsConfirmation: false,
        };
      }
      if (!data.user) {
        return {
          error: t('errors.generic'),
          needsConfirmation: false,
        };
      }

      // Email confirmation is enabled in production. In that mode signUp
      // intentionally returns no session, so a browser-side profile write
      // would be anonymous and correctly rejected by profiles RLS. The Auth
      // trigger has already created the profile inside the sign-up transaction.
      if (!data.session) {
        return { error: null, needsConfirmation: true };
      }

      // Keep the authenticated fallback idempotent for environments where
      // email auto-confirm is enabled or the trigger has already inserted it.
      const profileError = await upsertProfile(
        data.user.id,
        username,
        displayName,
      );
      if (profileError) {
        // Avoid leaving the user signed in without a valid profile.
        await supabase.auth.signOut();
        return { error: profileError, needsConfirmation: false };
      }

      return { error: null, needsConfirmation: false };
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setRecovery(false);
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<string | null> => {
    if (!supabase) return t('errors.network');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) return errorMessage(error, 'auth resetPasswordForEmail');
    return null;
  }, []);

  const resendConfirmation = useCallback(async (email: string): Promise<string | null> => {
    if (!supabase) return t('errors.network');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) return errorMessage(error, 'auth resendConfirmation');
    return null;
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<string | null> => {
    if (!supabase) return t('errors.network');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return errorMessage(error, 'auth updateUser password');
    return null;
  }, []);

  const updateEmail = useCallback(async (email: string): Promise<string | null> => {
    if (!supabase) return t('errors.network');
    // Point the confirmation link back at the app (same target as sign-up and
    // password reset) instead of Supabase's default redirect, which is what
    // makes the emailed link unusable.
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: window.location.origin + window.location.pathname },
    );
    if (error) return errorMessage(error, 'auth updateUser email');
    return null;
  }, []);

  const updateDisplayName = useCallback(
    async (name: string): Promise<string | null> => {
      if (!supabase || !user) return t('errors.network');
      const err = await updateMyDisplayName(user.id, name);
      if (err) return err;
      // Keep auth.users.raw_user_meta_data in sync too, so the display name is
      // updated everywhere in Supabase (not just public.profiles).
      await supabase.auth.updateUser({ data: { display_name: name } });
      await loadProfile(user.id);
      return null;
    },
    [user, loadProfile],
  );

  const deleteAccount = useCallback(async (): Promise<string | null> => {
    if (!supabase || !user) return t('errors.network');
    // Capture the user id before sign-out so we can clean up the local
    // crypto state for exactly this account (not every account that ever
    // signed in on this device).
    const deletedUserId = user.id;
    const err = await deleteOwnAccount();
    if (err) return err;
    // The account is gone server-side. Remove the local crypto identity
    // for this account so no orphaned half-identity remains on the device.
    // This is a best-effort local cleanup; failures are non-fatal because
    // the server-side deletion is already committed.
    if (isE2eeSupported()) {
      try { await deleteUserCryptoState(deletedUserId); } catch { /* swallow */ }
    }
    // Drop the local message plaintext cache for this account too.
    try { clearMessageCache(deletedUserId); } catch { /* swallow */ }
    // Clear the local session only, then reset the in-memory state.
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    setProfile(null);
    setRecovery(false);
    return null;
  }, [user]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    await loadProfile(user.id);
  }, [user, loadProfile]);

  const clearRecovery = useCallback(() => setRecovery(false), []);

  return (
    <AuthContext.Provider
      value={{
        configured: isSupabaseConfigured,
        loading,
        user,
        profile,
        recovery,
        signIn,
        signUp,
        signOut,
        resetPassword,
        resendConfirmation,
        updatePassword,
        updateEmail,
        updateDisplayName,
        deleteAccount,
        refreshProfile,
        clearRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
