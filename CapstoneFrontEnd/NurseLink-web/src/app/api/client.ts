// Backend runs on 8010, not Django's default 8000 — on this machine Windows
// reserves 8000 dynamically for Hyper-V/WSL2, which makes `runserver` fail
// with WinError 10048 even though no visible process owns the port (see
// CapstoneFrontEnd/NurseLink/services/config.ts, which documents the same
// move on the mobile side). Override with VITE_API_URL for a staging server.
const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://127.0.0.1:8010/api';

const TOKEN_KEY = 'nurselink_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

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

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Aborts the request after this many ms — for slow AI/workflow backends
   * that can exceed a normal request's expected duration. Omit for no
   * client-side timeout (the default). */
  timeoutMs?: number;
};

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, auth = true, timeoutMs }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new ApiError('The request timed out. Please try again.', 0);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
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
    const detail =
      typeof data === 'object' && data && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status, data);
  }

  return data as T;
}

export { API_BASE_URL };
