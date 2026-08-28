import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { E2EESessionManager } from '../lib/e2ee/session-manager';
import { publishDeviceMaterial, fetchPeerBundle } from '../lib/e2ee/prekeys-api';
import { resetInMemoryCaches } from '../lib/crypto';

/**
 * Per-authenticated-user E2EE session manager.
 *
 * The manager is created when a user signs in and DESTROYED on logout /
 * account switch, so no in-memory WASM state of one user is ever reused for
 * another. IndexedDB (device + session state) persists across logout by design
 * — that is the local vault, not in-memory engine state.
 *
 * `manager` is null until `initialize()` (generate/load identity, publish
 * prekeys, hydrate) completes. The UI treats null as fail-closed for peer
 * conversations: it must not send plaintext while encryption is unavailable.
 *
 * Session teardown (audit finding F7):
 *   The manager AND the signed-out user's in-memory crypto state are released
 *   whenever the session ends — logout, auth SIGNED_OUT, account switch or
 *   provider unmount. In-memory state includes the decrypted message-cache
 *   plaintext and the per-user key-handle caches, all reset through the single
 *   `resetInMemoryCaches(userId)` primitive. The sealed IndexedDB vault is
 *   intentionally preserved: it is the local device identity/session state
 *   that a re-login of the same account reloads. Only account deletion wipes
 *   the vault (`deleteUserCryptoState`).
 *
 * Account isolation:
 *   The session is stored together with the Supabase user id that owns it and
 *   is exposed to the UI only while that user is still signed in. A render
 *   that happens between logout and the effect teardown can therefore never
 *   hand another (or a signed-out) user's manager to the UI.
 */
interface E2EEContextValue {
  manager: E2EESessionManager | null;
  ready: boolean;
  error: string | null;
}

const E2EEContext = createContext<E2EEContextValue>({
  manager: null,
  ready: false,
  error: null,
});

/**
 * Test-only injection seam (jsdom smoke test): when present, this factory
 * supplies the session manager instead of the production prekeys-api wiring.
 * Production NEVER sets it, so the production path is unchanged. The factory
 * must return a real E2EESessionManager — it is used to exercise the genuine
 * encrypt/decrypt path with an in-memory transport instead of Supabase (there
 * is no backend in the jsdom environment). No mock cryptography.
 */
type ManagerFactory = (userId: string) => E2EESessionManager;
function readTestFactory(): ManagerFactory | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __enoughE2EEManagerFactory?: ManagerFactory }).__enoughE2EEManagerFactory ?? null;
}

/** An initialized session, bound to the Supabase user id that owns it. */
interface E2EESession {
  userId: string;
  manager: E2EESessionManager;
}

export function E2EEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [session, setSession] = useState<E2EESession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<E2EESession | null>(null);

  useEffect(() => {
    // Tear down any session from a previous (or the same) user before
    // (re)building. destroy() is idempotent; the in-memory crypto state of the
    // user being signed out is released in the same step.
    if (sessionRef.current) {
      sessionRef.current.manager.destroy();
      resetInMemoryCaches(sessionRef.current.userId);
      sessionRef.current = null;
    }
    setSession(null);
    setReady(false);
    setError(null);

    if (!userId) return; // logged out: nothing to build.
    let active = true;

    (async () => {
      try {
        const testFactory = readTestFactory();
        const m = testFactory
          ? testFactory(userId)
          : new E2EESessionManager({
              userId,
              publisher: (material) => publishDeviceMaterial(userId, material),
              bundleProvider: (peerUserId) => fetchPeerBundle(peerUserId),
            });
        await m.initialize();
        if (!active) {
          m.destroy();
          return;
        }
        const s: E2EESession = { userId, manager: m };
        sessionRef.current = s;
        setSession(s);
        setReady(true);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'E2EE initialization failed.');
        // ready=true so the UI can surface the failure and fail closed.
        setReady(true);
      }
    })();

    return () => {
      active = false;
      // The session ends when the user changes or the provider unmounts:
      // release the manager and the signed-out user's in-memory crypto state
      // before any other user's session is built.
      if (sessionRef.current) {
        sessionRef.current.manager.destroy();
        resetInMemoryCaches(sessionRef.current.userId);
        sessionRef.current = null;
      }
    };
  }, [userId]);

  // Final teardown on unmount.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.manager.destroy();
        resetInMemoryCaches(sessionRef.current.userId);
        sessionRef.current = null;
      }
    };
  }, []);

  // Account isolation: expose the manager only while the user who owns it is
  // still the signed-in user. Never hand another user's session to the UI.
  const manager =
    session && session.userId === userId ? session.manager : null;

  return (
    <E2EEContext.Provider value={{ manager, ready, error }}>
      {children}
    </E2EEContext.Provider>
  );
}

export function useE2EE(): E2EEContextValue {
  return useContext(E2EEContext);
}
