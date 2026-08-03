import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, TOKEN_KEY } from './config';
import type { User, UserRole } from '../types/user';
import type { Patient } from '../data/mockData';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
};

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, auth = true }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = await getToken();
    if (token) {
      headers.Authorization = `Token ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof data === 'object' && data && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status, data);
  }

  return data as T;
}

type AuthResponse = {
  token: string;
  user: User;
};

export async function loginRequest(
  email: string,
  password: string,
  role: UserRole
): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/auth/login/', {
    method: 'POST',
    body: { email, password, role },
    auth: false,
  });
  await setToken(data.token);
  return data;
}

export async function signupRequest(
  userData: Omit<User, 'id'> & { password: string }
): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/auth/signup/', {
    method: 'POST',
    body: userData,
    auth: false,
  });
  await setToken(data.token);
  return data;
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest('/auth/logout/', { method: 'POST' });
  } catch {
    // ignore
  } finally {
    await setToken(null);
  }
}

export async function fetchMe(): Promise<User> {
  return apiRequest<User>('/auth/me/');
}

export async function updateMe(updates: Partial<User>): Promise<User> {
  return apiRequest<User>('/auth/me/', {
    method: 'PATCH',
    body: updates,
  });
}

export async function fetchPatients(options?: { mine?: boolean }): Promise<Patient[]> {
  const query = options?.mine ? '?mine=true' : '';
  return apiRequest<Patient[]>(`/patients/${query}`);
}
