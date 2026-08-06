import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  fetchMe,
  loginRequest,
  logoutRequest,
  signupRequest,
  updateMe,
} from '../api/nurselink';
import { getToken, setToken } from '../api/client';

export type UserRole = 'staff_nurse' | 'supervisor';

export interface User {
  id: string;
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  role: UserRole;
  email: string;
  department: string;
  licenseNumber?: string;
  avatar?: string;
  registrationDetails?: {
    licenseNumber: string;
    selectedRole: string;
    ocrPosition: string;
    hospitalName: string;
    department: string;
    employeeId: string;
  };
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: UserRole) => Promise<boolean>;
  signup: (
    userData: Omit<User, 'id'> & { password: string; registrationSessionId: string }
  ) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const USER_KEY = 'nurselink_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());

  useEffect(() => {
    const restoreSession = async () => {
      const token = getToken();
      const storedUser = localStorage.getItem(USER_KEY);

      if (!token) {
        localStorage.removeItem(USER_KEY);
        setIsLoading(false);
        return;
      }

      try {
        const me = await fetchMe();
        setUser(me);
        localStorage.setItem(USER_KEY, JSON.stringify(me));
      } catch {
        // Token invalid — fall back to cached user only if present, else clear
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser));
          } catch {
            setToken(null);
            localStorage.removeItem(USER_KEY);
          }
        } else {
          setToken(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []);

  useEffect(() => {
    const SESSION_TIMEOUT = 30 * 60 * 1000;

    const checkTimeout = () => {
      if (user && Date.now() - lastActivity > SESSION_TIMEOUT) {
        logout();
        alert('Your session has expired due to inactivity. Please login again.');
      }
    };

    const interval = setInterval(checkTimeout, 60000);
    const updateActivity = () => setLastActivity(Date.now());
    window.addEventListener('mousedown', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('scroll', updateActivity);
    window.addEventListener('touchstart', updateActivity);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mousedown', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('scroll', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
    };
  }, [user, lastActivity]);

  const login = async (email: string, password: string, role: UserRole): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { user: loggedIn } = await loginRequest(email, password, role);
      setUser(loggedIn);
      localStorage.setItem(USER_KEY, JSON.stringify(loggedIn));
      setLastActivity(Date.now());
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
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
      localStorage.setItem(USER_KEY, JSON.stringify(created));
      setLastActivity(Date.now());
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
    localStorage.setItem(USER_KEY, JSON.stringify(optimistic));

    updateMe(updates)
      .then((saved) => {
        setUser(saved);
        localStorage.setItem(USER_KEY, JSON.stringify(saved));
      })
      .catch((error) => {
        console.error('Failed to update profile:', error);
      });
  };

  const logout = () => {
    logoutRequest();
    setUser(null);
    localStorage.removeItem(USER_KEY);
    setLastActivity(Date.now());
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
