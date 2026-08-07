// I change this by rai — real upload-id/verify-face calls, web-safe
// multipart handling, and the OTP + signup-type additions below
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, TOKEN_KEY } from './config';
import type { User, UserRole } from '../types/user';
import type { Patient } from '../data/mockData';

// I change this by rai
export type OcrData = {
  fullName: string;
  employeeId: string;
  hospitalName: string;
  department: string;
  position: string;
  rawText: string;
};

export type UploadIdResponse = {
  idDocumentId: number;
  fileUrl: string;
  uploadedAt: string;
  ocrData: OcrData;
};

export type FaceVerificationResponse = {
  faceVerificationId: number;
  matchScore: number;
  confidence: 'Low' | 'Medium' | 'High';
  status: 'verified' | 'retry' | 'failed';
  message: string;
};

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

function getMimeType(uri: string) {
  const match = uri.match(/\.([^.\/\\]+)$/);
  const ext = match?.[1]?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Browsers require a real Blob/File in FormData; only React Native's fetch
 * polyfill understands the {uri,name,type} object shorthand. On web, `uri`
 * is typically a data:/blob: URL from a canvas capture — fetch() resolves
 * either directly to a Blob.
 */
// I change this by rai
async function appendImagePart(formData: FormData, field: string, uri: string, fallbackName: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const name = fallbackName.includes('.') ? fallbackName : `${fallbackName}.jpg`;
    formData.append(field, blob, name);
    return;
  }
  const fileName = uri.split('/').pop() || fallbackName;
  formData.append(field, {
    uri,
    name: fileName,
    type: getMimeType(uri),
  } as any);
}

async function parseMultipartResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = text;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Keep raw text so non-JSON responses are surfaced cleanly.
    }
  }

  if (!response.ok) {
    let detail: string;
    if (typeof data === 'object' && data && 'detail' in data) {
      detail = String((data as { detail: unknown }).detail);
    } else if (typeof data === 'string' && data.trim()) {
      detail = data.trim();
    } else {
      detail = `Request failed (${response.status})`;
    }

    if (typeof data === 'string' && /<!doctype html>|<html/i.test(data)) {
      detail = `Server returned HTML ${response.status} at ${response.url}. Make sure the backend is running and API_BASE_URL is correct.`;
    }

    throw new ApiError(detail, response.status, data);
  }

  return data as T;
}

export async function uploadIdDocument(
  uri: string,
  documentType: string = 'hospital_id'
): Promise<UploadIdResponse> {
  const formData = new FormData();
  formData.append('document_type', documentType);
  await appendImagePart(formData, 'id_image', uri, 'id_document.jpg');

  const response = await fetch(`${API_BASE_URL}/auth/upload-id/`, {
    method: 'POST',
    body: formData,
  });

  return parseMultipartResponse<UploadIdResponse>(response);
}

export async function submitFaceCapture(
  idDocumentId: number,
  imageUris: string[]
): Promise<FaceVerificationResponse> {
  const formData = new FormData();
  formData.append('id_document_id', String(idDocumentId));
  for (let index = 0; index < imageUris.length; index += 1) {
    await appendImagePart(formData, 'images', imageUris[index], `selfie-${index + 1}.jpg`);
  }

  const response = await fetch(`${API_BASE_URL}/auth/verify-face/`, {
    method: 'POST',
    body: formData,
  });

  return parseMultipartResponse<FaceVerificationResponse>(response);
}

// I change this by rai
export type OtpRequestResponse = { message: string };
export type OtpVerifyResponse = { otpVerificationId: number };

export async function requestEmailOtp(email: string): Promise<OtpRequestResponse> {
  return apiRequest<OtpRequestResponse>('/auth/otp/request/', {
    method: 'POST',
    body: { email },
    auth: false,
  });
}

export async function verifyEmailOtp(email: string, code: string): Promise<OtpVerifyResponse> {
  return apiRequest<OtpVerifyResponse>('/auth/otp/verify/', {
    method: 'POST',
    body: { email, code },
    auth: false,
  });
}

type AuthResponse = {
  token: string;
  user: User;
};

// I change this by rai
export async function signupRequest(
  userData: Omit<User, 'id'> & {
    password: string;
    idDocumentId?: number;
    faceVerificationId?: number;
    otpVerificationId?: number;
  }
): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/auth/signup/', {
    method: 'POST',
    body: userData,
    auth: false,
  });
  await setToken(data.token);
  return data;
}

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
