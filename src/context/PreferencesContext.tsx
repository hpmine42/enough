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
  notifications: 'enough-notifications',
} as const;

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
  notifications: boolean;
  setNotifications: (v: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [enterToSend, setEnterToSendState] = useState(() =>
    read(KEYS.enterToSend, false),
  );
  const [notifications, setNotificationsState] = useState(() =>
    read(KEYS.notifications, false),
  );

  useEffect(() => {
    write(KEYS.enterToSend, enterToSend);
  }, [enterToSend]);
  useEffect(() => {
    write(KEYS.notifications, notifications);
  }, [notifications]);

  const setEnterToSend = useCallback((v: boolean) => setEnterToSendState(v), []);
  const setNotifications = useCallback(
    (v: boolean) => setNotificationsState(v),
    [],
  );

  return (
    <PreferencesContext.Provider
      value={{
        enterToSend,
        setEnterToSend,
        notifications,
        setNotifications,
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
