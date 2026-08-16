import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';

const KEYS = {
  enterToSend: 'enough-enter-to-send',
} as const;

// Older enough. versions stored a browser-notifications preference under this
// key. enough. no longer has any notification feature, so a leftover value is
// removed once when the app loads. No other preference key is touched.
const LEGACY_NOTIFICATIONS_KEY = 'enough-notifications';

function read(key: string, def: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

function write(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

interface PreferencesContextValue {
  enterToSend: boolean;
  setEnterToSend: (v: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [enterToSend, setEnterToSendState] = useState(() =>
    read(KEYS.enterToSend, false),
  );

  useEffect(() => {
    write(KEYS.enterToSend, enterToSend);
  }, [enterToSend]);

  // Drop a stored notification preference from older enough. versions. The
  // feature is gone completely, so the value must not influence anything.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_NOTIFICATIONS_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setEnterToSend = useCallback((v: boolean) => setEnterToSendState(v), []);

  return (
    <PreferencesContext.Provider
      value={{
        enterToSend,
        setEnterToSend,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return ctx;
}
