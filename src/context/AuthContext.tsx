import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import {
  deleteOwnAccount,
  getMyProfile,
  updateMyDisplayName,
  upsertProfile,
} from '../lib/api';
import { t } from '../i18n';
import { Profile } from '../lib/types';

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
      } else {
        setProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) loadProfile(sessionUser.id);
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
    if (!supabase) return t('errors.network');
    const err = await deleteOwnAccount();
    if (err) return err;
    // The account is gone server-side, so there is nothing left to revoke —
    // clear the local session only, then reset the in-memory state.
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    setProfile(null);
    setRecovery(false);
    return null;
  }, []);

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
