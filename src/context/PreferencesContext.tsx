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
  myNotes: 'enough-my-notes',
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
  myNotes: boolean;
  setMyNotes: (v: boolean) => void;
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
  const [myNotes, setMyNotesState] = useState(() => read(KEYS.myNotes, false));

  useEffect(() => {
    write(KEYS.enterToSend, enterToSend);
  }, [enterToSend]);
  useEffect(() => {
    write(KEYS.notifications, notifications);
  }, [notifications]);
  useEffect(() => {
    write(KEYS.myNotes, myNotes);
  }, [myNotes]);

  const setEnterToSend = useCallback((v: boolean) => setEnterToSendState(v), []);
  const setNotifications = useCallback(
    (v: boolean) => setNotificationsState(v),
    [],
  );
  const setMyNotes = useCallback((v: boolean) => setMyNotesState(v), []);

  return (
    <PreferencesContext.Provider
      value={{
        enterToSend,
        setEnterToSend,
        notifications,
        setNotifications,
        myNotes,
        setMyNotes,
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
