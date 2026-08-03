import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, TOKEN_KEY } from './config';
import type { SignupPayload, User, UserRole } from '../types/user';
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

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      'Network error. Please check your connection and try again.',
      0
    );
  }

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
    let detail = `Request failed (${response.status})`;
    if (typeof data === 'object' && data) {
      if ('detail' in data) {
        detail = String((data as { detail: unknown }).detail);
      } else {
        const firstFieldError = Object.values(data as Record<string, unknown>).find(
          (v) => Array.isArray(v) && v.length > 0
        );
        if (Array.isArray(firstFieldError) && firstFieldError[0]) {
          detail = String(firstFieldError[0]);
        }
      }
    }
    throw new ApiError(detail, response.status, data);
  }

  return data as T;
}

type AuthResponse = {
  token: string;
  user: User;
};

export type LoginApiResult =
  | { ok: true; user: User }
  | { ok: false; status: 'invalid' | 'pending' | 'rejected' | 'error'; message: string };

export async function loginRequest(
  email: string,
  password: string,
  role: UserRole
): Promise<LoginApiResult> {
  try {
    const data = await apiRequest<AuthResponse>('/auth/login/', {
      method: 'POST',
      body: { email, password, role },
      auth: false,
    });
    await setToken(data.token);
    return { ok: true, user: data.user };
  } catch (error) {
    if (error instanceof ApiError) {
      const status =
        typeof error.data === 'object' &&
        error.data &&
        'status' in error.data
          ? String((error.data as { status: unknown }).status)
          : '';
      if (status === 'pending') {
        return { ok: false, status: 'pending', message: error.message };
      }
      if (status === 'rejected') {
        return { ok: false, status: 'rejected', message: error.message };
      }
      return { ok: false, status: 'invalid', message: error.message };
    }
    return {
      ok: false,
      status: 'error',
      message: 'An unexpected error occurred. Please try again.',
    };
  }
}

type SignupResponse = {
  detail: string;
  status: 'pending';
  user: User;
};

export async function signupRequest(
  userData: SignupPayload
): Promise<SignupResponse> {
  const {
    registrationDetails,
    employeeId,
    hospitalName,
    ocrPosition,
    ...rest
  } = userData;

  const body = {
    ...rest,
    employeeId: employeeId ?? registrationDetails?.employeeId ?? '',
    hospitalName: hospitalName ?? registrationDetails?.hospitalName ?? '',
    ocrPosition: ocrPosition ?? registrationDetails?.ocrPosition ?? '',
    licenseNumber: rest.licenseNumber ?? registrationDetails?.licenseNumber ?? '',
    department: rest.department || registrationDetails?.department || '',
  };

  return apiRequest<SignupResponse>('/auth/signup/', {
    method: 'POST',
    body,
    auth: false,
  });
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
