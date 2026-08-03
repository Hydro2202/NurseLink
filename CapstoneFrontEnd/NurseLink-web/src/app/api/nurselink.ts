import { apiRequest, setToken } from './client';
import type { User, UserRole } from '../contexts/AuthContext';
import type { Patient } from '../data/mockData';

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
  setToken(data.token);
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
  setToken(data.token);
  return data;
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest('/auth/logout/', { method: 'POST' });
  } catch {
    // Ignore network errors on logout
  } finally {
    setToken(null);
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
