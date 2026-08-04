import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Alert } from 'react-native';
import {
  fetchMe,
  loginRequest,
  logoutRequest,
  signupRequest,
  updateMe,
  getToken,
  setToken,
} from '../services/api';
import { USER_KEY } from '../services/config';
import type { User, UserRole } from '../types/user';

export type { User, UserRole };

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: UserRole) => Promise<boolean>;
  signup: (userData: Omit<User, 'id'> & { password: string }) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  updateUser: (updates: Partial<User>) => void;
  updateActivity: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_TIMEOUT = 30 * 60 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        await AsyncStorage.removeItem('nurselink_darkmode');

        if (!token) {
          await AsyncStorage.removeItem(USER_KEY);
          return;
        }

        try {
          const me = await fetchMe();
          setUser(me);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(me));
        } catch {
          // Token is invalid/expired — clear the session instead of
          // keeping a stale user that causes protected API calls to fail.
          await setToken(null);
          await AsyncStorage.removeItem(USER_KEY);
          setUser(null);
        }
      } catch (e) {
        console.error('Error loading session:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const logout = useCallback(() => {
    logoutRequest();
    setUser(null);
    AsyncStorage.removeItem(USER_KEY);
    lastActivity.current = Date.now();
  }, []);

  const updateActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (!user) return;

    const checkTimeout = () => {
      if (Date.now() - lastActivity.current > SESSION_TIMEOUT) {
        logout();
        Alert.alert(
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
  }, [user, logout, updateActivity]);

  const login = async (email: string, password: string, role: UserRole): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { user: loggedIn } = await loginRequest(email, password, role);
      setUser(loggedIn);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(loggedIn));
      lastActivity.current = Date.now();
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (userData: Omit<User, 'id'> & { password: string }): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { user: created } = await signupRequest(userData);
      setUser(created);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(created));
      lastActivity.current = Date.now();
      return true;
    } catch (error) {
      console.error('Signup failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const updateUser = (updates: Partial<User>) => {
    if (!user) return;
    const optimistic = { ...user, ...updates };
    setUser(optimistic);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(optimistic));

    updateMe(updates)
      .then(async (saved) => {
        setUser(saved);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(saved));
      })
      .catch((error) => {
        console.error('Failed to update profile:', error);
      });
  };

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
