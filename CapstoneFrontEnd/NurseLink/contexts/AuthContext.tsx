import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Alert, Platform } from 'react-native';
import {
  fetchMe,
  loginRequest,
  logoutRequest,
  signupRequest,
  updateMe,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from '../services/api';
import * as authStorage from '../services/authStorage';
import { migrateLegacyAsyncStorageToken } from '../services/secureToken';
import { USER_KEY } from '../services/config';
import { useToast } from './ToastContext';
import type { User, UserRole } from '../types/user';

export type { User, UserRole };

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: UserRole) => Promise<boolean>;
  signup: (
    userData: Omit<User, 'id'> & { password: string; registrationSessionId: string }
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Resolves with the saved user; rejects if the server refused the change. */
  updateUser: (updates: Partial<User>) => Promise<User | undefined>;
  /**
   * Re-fetches this nurse's own profile from the server and replaces the
   * cached one — for facts that can change from *someone else's* action
   * (a head nurse reassigning this nurse's department/shift) rather than
   * this nurse's own edit, which updateUser already handles. fetchMe() only
   * otherwise runs once, at app boot, so without this a reassignment sits
   * invisible on this device until the next full login.
   */
  refreshUser: () => Promise<void>;
  updateActivity: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_TIMEOUT = 30 * 60 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastActivity = useRef(Date.now());
  const toast = useToast();

  // Alert.alert() is a documented no-op on react-native-web (no polyfill),
  // so on web these session notices would otherwise fail completely
  // silently — the user is logged out with zero explanation. Native keeps
  // its real Alert.alert dialog unchanged.
  const notify = useCallback(
    (title: string, message: string) => {
      if (Platform.OS === 'web') {
        toast.warning(title, { description: message });
      } else {
        Alert.alert(title, message);
      }
    },
    [toast]
  );

  // Shared by the boot-time check below and by the global 401 handler
  // registered further down — both cases mean the same thing: the token on
  // this device no longer works, so drop it and the cached user together.
  // `notify` is only passed by the mid-session case: at boot there was no
  // session visibly in use yet for a message about losing one to make sense.
  const clearSession = useCallback(async (notifyReason?: 'expired' | 'blocked') => {
    await setToken(null);
    await authStorage.removeItem(USER_KEY);
    setUser(null);
    if (notifyReason === 'expired') {
      notify('Session Expired', 'Your session expired, please log in again.');
    } else if (notifyReason === 'blocked') {
      notify('Signed Out', 'Your account access has changed. Please log in again.');
    }
  }, [notify]);

  useEffect(() => {
    (async () => {
      try {
        // One-time move for devices upgrading from a build that kept the
        // token in plain AsyncStorage, before anything reads it below.
        await migrateLegacyAsyncStorageToken();
        const token = await getToken();
        // Dark mode has been removed. This clears the key left on devices that
        // ran an earlier build; it is inert, and the line can go once no
        // installs from before the removal remain.
        await AsyncStorage.removeItem('nurselink_darkmode');

        if (!token) {
          await authStorage.removeItem(USER_KEY);
          return;
        }

        try {
          const me = await fetchMe();
          setUser(me);
          await authStorage.setItem(USER_KEY, JSON.stringify(me));
        } catch {
          // Token is invalid/expired — clear the session instead of
          // keeping a stale user that causes protected API calls to fail.
          await clearSession();
        }
      } catch (e) {
        console.error('Error loading session:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [clearSession]);

  // Any screen's API call can discover the token has gone bad mid-session
  // (rotated by a password change elsewhere, account removed, etc.) — not
  // just the boot-time check above. Without this, the app was stuck showing
  // stale/empty screens with every request failing the same way until the
  // nurse manually logged out.
  useEffect(() => {
    setUnauthorizedHandler((reason) => {
      clearSession(reason);
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  /**
   * Sign out completely.
   *
   * Awaitable so callers can redirect only once the token is actually gone.
   * Previously the API call was fired and forgotten, leaving a window where the
   * app had navigated to the login screen while a valid token was still on
   * disk — a reload in that window would have signed the nurse straight back in.
   *
   * Clearing local state is in a finally block: a failed or unreachable logout
   * request must still log the nurse out of this device.
   */
  const logout = useCallback(async () => {
    try {
      // Revokes the token server side and clears it from storage.
      await logoutRequest();
    } catch (error) {
      console.warn('Logout request failed; clearing this device anyway.', error);
    } finally {
      setUser(null);
      await authStorage.removeItem(USER_KEY);
      lastActivity.current = Date.now();
    }
  }, []);

  const updateActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (!user) return;

    const checkTimeout = () => {
      if (Date.now() - lastActivity.current > SESSION_TIMEOUT) {
        logout();
        notify(
          'Session Expired',
          'Your session has expired due to inactivity. Please login again.'
        );
      }
    };

    const interval = setInterval(checkTimeout, 60000);

    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        checkTimeout();
        updateActivity();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [user, logout, updateActivity, notify]);

  // Rethrows on failure (same reasoning as updateUser below): a pending or
  // rejected account gets a real, specific message from LoginView — that is
  // lost if this just returns false, leaving the caller with nothing but
  // a generic "login failed" regardless of the actual reason.
  const login = async (email: string, password: string, role: UserRole): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { user: loggedIn } = await loginRequest(email, password, role);
      setUser(loggedIn);
      await authStorage.setItem(USER_KEY, JSON.stringify(loggedIn));
      lastActivity.current = Date.now();
      return true;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (
    userData: Omit<User, 'id'> & { password: string; registrationSessionId: string }
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { user: created } = await signupRequest(userData);
      setUser(created);
      await authStorage.setItem(USER_KEY, JSON.stringify(created));
      lastActivity.current = Date.now();
      return true;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Save profile changes for the signed-in nurse.
   *
   * Awaitable and it rethrows: the Settings dialog has to be able to tell the
   * nurse their change failed, and previously a rejected save was swallowed —
   * the UI showed the new name, the server kept the old one, and the next
   * reload silently undid it.
   *
   * The optimistic update is rolled back on failure for the same reason: what
   * is on screen must match what is stored.
   */
  const updateUser = useCallback(
    async (updates: Partial<User>): Promise<User | undefined> => {
      if (!user) return undefined;

      const previous = user;
      const optimistic = { ...user, ...updates };
      setUser(optimistic);
      await authStorage.setItem(USER_KEY, JSON.stringify(optimistic));

      try {
        const saved = await updateMe(updates);
        setUser(saved);
        await authStorage.setItem(USER_KEY, JSON.stringify(saved));
        return saved;
      } catch (error) {
        setUser(previous);
        await authStorage.setItem(USER_KEY, JSON.stringify(previous));
        throw error;
      }
    },
    [user]
  );

  const refreshUser = useCallback(async () => {
    if (!user) return;
    try {
      const fresh = await fetchMe();
      setUser(fresh);
      await authStorage.setItem(USER_KEY, JSON.stringify(fresh));
    } catch {
      // Best-effort — a failed background resync should not disrupt
      // whatever the nurse is doing; the next trigger (or next login)
      // will pick it up.
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        signup,
        logout,
        isAuthenticated: !!user,
        isLoading,
        updateUser,
        refreshUser,
        updateActivity,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
