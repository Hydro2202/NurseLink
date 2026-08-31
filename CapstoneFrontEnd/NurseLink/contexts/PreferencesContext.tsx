import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPreferences, updatePreferences, type UserPreferences } from '../services/api';
import { useAuth } from './AuthContext';

/**
 * The Settings page's state, for the whole app.
 *
 * Settings live on the account rather than the device: a nurse who signs in on
 * the ward tablet gets the font size and notification choices they set on their
 * phone. The server is the source of truth, so this loads once per session and
 * every save is a real PATCH — nothing is remembered locally and pretended to
 * be saved.
 *
 * The local cache is a starting value, not a second source of truth. It exists
 * so the app is not stuck at defaults for the moment between sign-in and the
 * first response — a light theme flashing to dark, or charts appearing and then
 * vanishing. The server's answer always overwrites it.
 */

const CACHE_KEY = 'nurselink_preferences';

export const DEFAULT_PREFERENCES: UserPreferences = {
  fontSize: 'medium',
  compactView: false,
  taskNotifications: true,
  handoverNotifications: true,
  criticalAlerts: true,
  emailNotifications: false,
  soundAlerts: true,
  autoRefresh: true,
  showCharts: true,
  backgroundSync: true,
};

interface PreferencesContextType {
  preferences: UserPreferences;
  /** True until the account's real settings have arrived. */
  loading: boolean;
  /** Save one section. Rejects on failure so the caller can report it. */
  save: (changes: Partial<UserPreferences>) => Promise<void>;
  /** Change locally without saving, for controls edited before pressing Save. */
  setLocal: (changes: Partial<UserPreferences>) => void;
  /** Throw away unsaved local edits and go back to what the server holds. */
  revert: () => void;
  /** True while there are local edits not yet saved. */
  dirty: boolean;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  // What the server last confirmed. Reverting and saving both work from this,
  // so an unsaved toggle never becomes the thing we compare against.
  const saved = useRef<UserPreferences>(DEFAULT_PREFERENCES);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      // Signed out: back to defaults so the next nurse on a shared tablet never
      // inherits the previous one's settings.
      setPreferences(DEFAULT_PREFERENCES);
      saved.current = DEFAULT_PREFERENCES;
      setDirty(false);
      setLoading(false);
      void AsyncStorage.removeItem(CACHE_KEY);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Cached value first, purely to avoid a flash of the wrong theme.
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached && !cancelled) {
          const parsed = { ...DEFAULT_PREFERENCES, ...JSON.parse(cached) };
          setPreferences(parsed);
          saved.current = parsed;
        }
      } catch {
        // A corrupt cache is not worth surfacing; the server answer follows.
      }

      try {
        const fromServer = await fetchPreferences();
        if (cancelled || !mounted.current) return;
        setPreferences(fromServer);
        saved.current = fromServer;
        setDirty(false);
        void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fromServer));
      } catch {
        // Offline or the server is down: keep whatever we have rather than
        // resetting a nurse's settings to defaults in front of them.
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const setLocal = useCallback((changes: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...changes };
      setDirty(JSON.stringify(next) !== JSON.stringify(saved.current));
      return next;
    });
  }, []);

  const revert = useCallback(() => {
    setPreferences(saved.current);
    setDirty(false);
  }, []);

  const save = useCallback(async (changes: Partial<UserPreferences>) => {
    // The server's response is what we keep, not what we sent — so the UI can
    // never drift from what was actually stored.
    const stored = await updatePreferences(changes);
    if (!mounted.current) return;
    setPreferences(stored);
    saved.current = stored;
    setDirty(false);
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(stored));
  }, []);

  return (
    <PreferencesContext.Provider
      value={{ preferences, loading, save, setLocal, revert, dirty }}
    >
      {children}
    </PreferencesContext.Provider>
  );
};

export function usePreferences(): PreferencesContextType {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
