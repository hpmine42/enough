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

export function E2EEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [manager, setManager] = useState<E2EESessionManager | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managerRef = useRef<E2EESessionManager | null>(null);

  useEffect(() => {
    // Tear down any manager from a previous (or the same) user before (re)building.
    if (managerRef.current) {
      managerRef.current.destroy();
      managerRef.current = null;
    }
    setManager(null);
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
        managerRef.current = m;
        setManager(m);
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
    };
  }, [userId]);

  // Final teardown on unmount.
  useEffect(() => {
    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, []);

  return (
    <E2EEContext.Provider value={{ manager, ready, error }}>
      {children}
    </E2EEContext.Provider>
  );
}

export function useE2EE(): E2EEContextValue {
  return useContext(E2EEContext);
}
