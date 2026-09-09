import {
  createContext,
  useCallback,
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
import { isCryptoError } from '../lib/crypto/errors';

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
 * Initialization state (audit C1 / F-01)
 *   `initialize()` is asynchronous and CAN fail (IndexedDB unavailable or
 *   blocked, the WASM engine refused by the environment, a prekey publication
 *   that cannot reach the backend, corrupted local state). Before this change
 *   the UI consumed only `manager`, so a failure was indistinguishable from
 *   "still loading": peer bubbles rendered empty forever and every send failed
 *   with a generic message.
 *
 *   The provider therefore publishes an explicit three-state lifecycle:
 *
 *     'initializing' — not settled yet. Encryption is not available YET; the
 *                      UI shows a pending state and keeps the peer composer
 *                      disabled. This is transient.
 *     'ready'        — `manager` is usable.
 *     'error'        — initialization FAILED and will not settle on its own.
 *                      The UI must say so and offer `retry()`.
 *
 *   `ready` is retained as "initialization has settled" (true for both 'ready'
 *   and 'error') so existing consumers keep their meaning.
 *
 *   `errorCode` carries a NON-SENSITIVE classification only (a `CryptoError`
 *   code, or `INIT_FAILED`). Never a raw exception message: the UI must not
 *   surface cryptographic internals, and `CryptoError` already documents that
 *   only its `code` is meant to travel.
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
 *
 * Recovery:
 *   `retry()` only re-runs THIS provider's initialization. It never creates a
 *   second session architecture, never touches the ratchet or trust state, and
 *   never introduces a plaintext or weaker-crypto fallback: if initialization
 *   fails again the state simply stays 'error'.
 */
export type E2EEStatus = 'initializing' | 'ready' | 'error';

/** Safe, non-sensitive classification of an initialization failure. */
export type E2EEErrorCode = string;

interface E2EEContextValue {
  manager: E2EESessionManager | null;
  /** Explicit lifecycle state — see the provider doc comment. */
  status: E2EEStatus;
  /** True once initialization has settled (successfully or with an error). */
  ready: boolean;
  /** Non-sensitive failure classification; null unless `status === 'error'`. */
  errorCode: E2EEErrorCode | null;
  /** Re-run initialization after a failure. Idempotent and fail-closed. */
  retry: () => void;
}

const E2EEContext = createContext<E2EEContextValue>({
  manager: null,
  status: 'initializing',
  ready: false,
  errorCode: null,
  retry: () => {},
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
  const [status, setStatus] = useState<E2EEStatus>('initializing');
  const [errorCode, setErrorCode] = useState<E2EEErrorCode | null>(null);
  // Bumped by retry(): re-runs the initialization effect without remounting.
  const [attempt, setAttempt] = useState(0);
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
    setErrorCode(null);
    // A retry restarts the lifecycle visibly; a logout leaves it unsettled
    // because there is nothing to initialize.
    setStatus('initializing');

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
        setStatus('ready');
      } catch (e) {
        if (!active) return;
        // Publish a NON-SENSITIVE classification only. The raw message stays
        // out of React state: the UI renders localized text, never crypto
        // internals. It is logged for diagnostics — CryptoError documents that
        // its messages contain no secret material, and for anything else only
        // the constructor name is recorded.
        const code = isCryptoError(e) ? e.code : 'INIT_FAILED';
        console.error('enough. e2ee initialization failed:', {
          code,
          name: e instanceof Error ? e.name : typeof e,
        });
        setErrorCode(code);
        // Settled — with a failure. The UI surfaces it and stays fail-closed:
        // `manager` remains null, so no peer message can be sent as plaintext.
        setStatus('error');
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
  }, [userId, attempt]);

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

  // Recovery: re-run initialization from scratch. It performs no cryptography
  // itself and cannot weaken anything — the same code path runs again, and a
  // repeated failure leaves the state at 'error'.
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  // Account isolation: expose the manager only while the user who owns it is
  // still the signed-in user. Never hand another user's session to the UI.
  const manager =
    session && session.userId === userId ? session.manager : null;

  return (
    <E2EEContext.Provider
      value={{
        manager,
        status,
        ready: status !== 'initializing',
        errorCode,
        retry,
      }}
    >
      {children}
    </E2EEContext.Provider>
  );
}

export function useE2EE(): E2EEContextValue {
  return useContext(E2EEContext);
}
