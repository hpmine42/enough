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
import { getMyProfile, upsertProfile } from '../lib/api';
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
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (
    email: string,
    password: string,
    username: string,
  ) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadProfile = async (userId: string) => {
      const p = await getMyProfile(userId);
      if (active) setProfile(p);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) loadProfile(sessionUser.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        loadProfile(sessionUser.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      if (!supabase) return 'Keine Verbindung zum Server.';
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
    ): Promise<SignUpResult> => {
      if (!supabase) {
        return { error: 'Keine Verbindung zum Server.', needsConfirmation: false };
      }
      // The existing auth.users trigger creates public.profiles and reads the
      // username from raw_user_meta_data. Omitting it makes the trigger insert
      // NULL into profiles.username and aborts the Auth transaction.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) {
        return {
          error: errorMessage(error, 'registration auth.signUp'),
          needsConfirmation: false,
        };
      }
      if (!data.user) {
        return { error: 'Registrierung fehlgeschlagen.', needsConfirmation: false };
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
      const profileError = await upsertProfile(data.user.id, username);
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
  }, []);

  return (
    <AuthContext.Provider
      value={{
        configured: isSupabaseConfigured,
        loading,
        user,
        profile,
        signIn,
        signUp,
        signOut,
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
