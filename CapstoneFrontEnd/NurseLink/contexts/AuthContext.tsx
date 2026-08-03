import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Alert } from 'react-native';
import {
  ApiError,
  fetchMe,
  loginRequest,
  logoutRequest,
  signupRequest,
  getToken,
  setToken,
  updateMe,
} from '../services/api';
import { USER_KEY } from '../services/config';
import type { SignupPayload, User, UserRole } from '../types/user';

export type { User, UserRole };
export type LoginResult = 'success' | 'invalid' | 'pending' | 'rejected' | 'error';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: UserRole) => Promise<LoginResult>;
  signup: (userData: SignupPayload) => Promise<{ ok: boolean; message?: string }>;
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
        const storedUser = await AsyncStorage.getItem(USER_KEY);
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
          if (storedUser) {
            setUser(JSON.parse(storedUser));
          } else {
            await setToken(null);
          }
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

  const login = async (email: string, password: string, role: UserRole): Promise<LoginResult> => {
    setIsLoading(true);
    try {
      const result = await loginRequest(email, password, role);
      if (!result.ok) {
        return result.status;
      }
      setUser(result.user);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(result.user));
      lastActivity.current = Date.now();
      return 'success';
    } catch (error) {
      console.error('Login failed:', error);
      return 'error';
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (
    userData: SignupPayload
  ): Promise<{ ok: boolean; message?: string }> => {
    setIsLoading(true);
    try {
      const response = await signupRequest(userData);
      return { ok: true, message: response.detail };
    } catch (error) {
      console.error('Signup failed:', error);
      if (error instanceof ApiError) {
        return { ok: false, message: error.message };
      }
      return {
        ok: false,
        message: 'An unexpected error occurred. Please try again.',
      };
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
