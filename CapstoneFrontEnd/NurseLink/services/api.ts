import { API_BASE_URL } from './config';
import { getStoredToken, setStoredToken, clearStoredToken } from './secureToken';
import type { User, UserRole } from '../types/user';
import type {
  AdminAccount,
  AdminFaceVerificationAttempt,
  AdminRegistrationSession,
  AdminTaskHandover,
  AdminVitalReading,
  AnalyticsData,
  AppNotification,
  ChartingNote,
  ChartingHistoryDate,
  Department,
  Doctor,
  DutyAssignment,
  EligibleReferralRecipients,
  HandoverNote,
  KardexHistory,
  LabEntry,
  MedicationIntakeEntry,
  MedicationOrder,
  Nurse,
  Patient,
  PatientAssignmentRecord,
  PatientVisit,
  Task,
  WorkloadData,
} from '../types/domain';

/**
 * Coarse category behind an ApiError, for callers that need to branch on
 * *why* a request failed rather than just catching-and-toasting the message
 * — e.g. LiveContext treating 'network'/'timeout' as "backend unreachable,
 * keep polling" instead of a real bug.
 *
 *   network         fetch itself never got a response (offline, wrong host/
 *                    port, CORS preflight rejected) — status 0.
 *   timeout         the client gave up waiting (AbortController) — status 408.
 *   auth            401/403 — bad/expired credentials.
 *   server          5xx — the backend received the request and broke.
 *   invalid_response the server responded but the body wasn't valid JSON.
 *   http            any other non-2xx status (4xx validation errors, etc).
 */
export type ApiErrorKind = 'network' | 'timeout' | 'auth' | 'server' | 'invalid_response' | 'http';

const BLOCKED_ACCOUNT_CODES = new Set(['account_pending', 'account_rejected', 'account_deactivated']);

export class ApiError extends Error {
  status: number;
  data: unknown;
  kind: ApiErrorKind;

  constructor(message: string, status: number, data?: unknown, kind?: ApiErrorKind) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.kind =
      kind ??
      (status === 0
        ? 'network'
        : status === 408
          ? 'timeout'
          : status === 401 || status === 403
            ? 'auth'
            : status >= 500
              ? 'server'
              : 'http');
  }
}

export async function getToken(): Promise<string | null> {
  return getStoredToken();
}

export async function setToken(token: string | null): Promise<void> {
  if (token) {
    await setStoredToken(token);
  } else {
    await clearStoredToken();
  }
}

// AuthContext registers a handler here so any screen's API call — not just
// the app-boot session check — can react to a token going bad mid-session
// (e.g. rotated by a password change elsewhere, or the account was removed).
// Without this, a screen's own catch block only had enough to log/toast the
// failure; the stale token stayed on device and every subsequent request
// kept failing the same way until the nurse manually logged out.
type UnauthorizedReason = 'expired' | 'blocked';
let unauthorizedHandler: ((reason: UnauthorizedReason) => void) | null = null;
export function setUnauthorizedHandler(fn: ((reason: UnauthorizedReason) => void) | null): void {
  unauthorizedHandler = fn;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  /** For best-effort background calls (the live poll) where the backend
   * being briefly unreachable is an expected, recoverable state rather than
   * a bug — skips the console.error noise (which pops Expo's LogBox red
   * screen on every failed tick) for network/timeout/server failures.
   * Never suppresses non-401 auth handling. */
  quiet?: boolean;
};

// verify-id / verify-prc / face-verification route through the backend's n8n
// call (or local OCR/face-match), which is allowed up to N8N_TIMEOUT_SECONDS
// (60s, see CapstoneBackEnd/.env) before the backend itself gives up. A
// shorter client timeout than that fires "Is the backend running?" while the
// backend is still legitimately working, so those calls get their own budget.
const IDENTITY_VERIFICATION_TIMEOUT_MS = 65000;

function extractDetail(data: unknown, status: number): string {
  if (typeof data === 'object' && data) {
    if ('detail' in data) return String((data as { detail: unknown }).detail);
    const first = Object.values(data as Record<string, unknown>)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (typeof first === 'string') return first;
  }
  return `Request failed (${status})`;
}

export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, auth = true, timeoutMs = 15000, quiet = false }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = await getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    // Logged for anything but a quiet (best-effort background) call, with
    // the real error object — "Failed to fetch" (the browser's own message
    // for "the request never got a response at all": server down, wrong
    // host/port, CORS preflight rejected, offline) is otherwise the only
    // thing anyone ever sees, with no way to tell it apart from a timeout or
    // any other network failure. A quiet caller (the live poll) already
    // treats this as an expected, recoverable state — see LiveContext — so
    // logging it every few seconds while the backend is briefly down would
    // just be console spam (and pops Expo's LogBox red screen on web).
    if (!quiet) {
      console.error(`[NurseLink] API request failed: ${method} ${API_BASE_URL}${path}`, error);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Request timed out. Is the backend running?', 408);
    }
    // A bare TypeError is fetch's own signal that the request never
    // completed (as opposed to the server responding with an error status,
    // which is handled below via response.ok) — across both browser fetch
    // and React Native's fetch polyfill, "Failed to fetch"/"Network request
    // failed" are exactly this case, not a hint on their own of what's
    // actually wrong, so replace it with something a nurse (or whoever is
    // debugging with them) can act on.
    const message =
      error instanceof TypeError
        ? `Could not reach the NurseLink server at ${API_BASE_URL}. It may be offline, or this device may not be able to reach it — check your connection and try again.`
        : error instanceof Error
          ? error.message
          : 'Network request failed';
    throw new ApiError(message, 0);
  } finally {
    clearTimeout(timeoutId);
  }

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      // The server responded, but not with JSON — most often an HTML error
      // page from a 500 that never reached DRF's exception handling, or a
      // proxy/gateway page for the wrong host entirely. Worth its own log
      // line: extractDetail below will still show *something*, but not why.
      if (!quiet) {
        console.error(
          `[NurseLink] API response was not valid JSON: ${method} ${API_BASE_URL}${path} (status ${response.status})`,
          parseError,
          text.slice(0, 500)
        );
      }
      data = text;
    }
  }

  if (!response.ok) {
    // 401 is always an expected, already-handled outcome — either a login
    // attempt with the wrong email/password (auth: false, no session to
    // lose), or an existing session that's expired/been revoked (auth:
    // true, which unauthorizedHandler below already deals with by signing
    // the nurse out cleanly). Neither is a bug to surface in the console:
    // in Expo dev mode, console.error pops the red-box overlay, which is
    // exactly wrong for "you typed the wrong password" — the caller
    // already catches the thrown ApiError and shows a normal inline
    // message (see app/login.tsx). Anything else (500s, unexpected 400s,
    // ...) still logs, since those usually do mean something is broken.
    // 429 is the login lockout (see api/login_throttle.py) — also an expected,
    // user-facing outcome the screen already shows inline, not a bug.
    // 423 is a face-verification lockout (timed or permanent) — signup.tsx
    // already shows a proper message and countdown for it, same deal.
    if (response.status !== 401 && response.status !== 429 && response.status !== 423 && !quiet) {
      console.error(
        `[NurseLink] API error response: ${method} ${API_BASE_URL}${path} → ${response.status}`,
        data
      );
    }
    if (auth && response.status === 401) {
      unauthorizedHandler?.('expired');
    }
    // A token for an account that may no longer use the app (pending,
    // rejected, deactivated) gets a coded 403 — end the session the same way
    // as an expired token, so the nurse isn't left on a dead screen.
    const blockedCode =
      typeof data === 'object' && data && 'code' in data ? String((data as { code: unknown }).code) : '';
    if (auth && response.status === 403 && BLOCKED_ACCOUNT_CODES.has(blockedCode)) {
      unauthorizedHandler?.('blocked');
    }
    throw new ApiError(extractDetail(data, response.status), response.status, data);
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
  userData: Omit<User, 'id'> & { password: string; registrationSessionId: string }
): Promise<AuthResponse> {
  // The server never grants a role at signup — the picked role is only a
  // request for an admin to review, sent under requestedRole.
  const { role, ...rest } = userData;
  const data = await apiRequest<AuthResponse>('/auth/signup/', {
    method: 'POST',
    body: { ...rest, requestedRole: role },
    auth: false,
  });
  await setToken(data.token);
  return data;
}

export type FaceVerificationResponse = {
  matched: boolean;
  confidence: number;
  registrationSessionId: string;
  attemptsUsed?: number;
  attemptsRemaining: number;
  maxAttempts?: number;
  locked: boolean;
  faceVerified?: boolean;
  otpVerified?: boolean;
  verificationMethod?: string | null;
  status?: string;
  registeredEmail?: string | null;
  reason?: string | null;
  message?: string;
  countable?: boolean;
  /** False once the lifetime face-attempt budget is spent; only Email OTP remains. */
  retryAvailable?: boolean;
  /** Set on a 423 (locked): seconds until the timed lockout ends. */
  retryAfterSeconds?: number;
};

export type FaceVerificationStatusResponse = {
  success?: boolean;
  message?: string;
  registrationSessionId?: string;
  attemptsUsed: number;
  attemptsRemaining: number;
  maxAttempts: number;
  locked: boolean;
  faceVerified: boolean;
  otpVerified: boolean;
  verificationMethod?: string | null;
  status: string;
  registeredEmail?: string | null;
  retryAvailable?: boolean;
};

/**
 * Persona steps 1 & 2 — the backend forwards the ID photo to the n8n
 * verify-id workflow and returns the fields it read.
 */
export type VerifyIdResponse = {
  success: boolean;
  verified: boolean;
  verificationStatus?: 'verified' | 'validation_error' | 'invalid_id' | 'unavailable';
  /** Present only when verificationStatus is 'validation_error' — one message per bad field. */
  errors?: Record<string, string>;
  fullName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  registrationNumber: string;
  registrationDate: string;
  validUntil: string;
  employeeId: string;
  department: string;
  position: string;
  hospitalName: string;
  email: string;
  roleMatch?: boolean | null;
  /** Per-field OCR confidence, 0-1, keyed by field name. */
  confidence?: Record<string, number> | number | null;
  overallConfidence?: number;
  /** Field names the nurse must confirm before anything is saved. */
  needsReview?: string[];
  /** Required fields OCR could not read at all. */
  missingRequired?: string[];
  duplicateScan?: boolean;
  n8nStatus?: '' | 'success' | 'failed' | 'skipped';
  n8nError?: string;
  attemptNumber?: number;
  hasPhoto?: boolean;
  message?: string;
  registrationSessionId: string;
};

export async function verifyIdRequest(
  idImage: string,
  options?: {
    registrationSessionId?: string | null;
    documentType?: 'hospital_id' | 'prc_license';
    expectedRole?: UserRole | '';
  }
): Promise<VerifyIdResponse> {
  return apiRequest<VerifyIdResponse>('/auth/verify-id/', {
    method: 'POST',
    body: {
      idImage,
      documentType: options?.documentType ?? 'hospital_id',
      ...(options?.registrationSessionId
        ? { registrationSessionId: options.registrationSessionId }
        : {}),
      ...(options?.expectedRole ? { expectedRole: options.expectedRole } : {}),
    },
    auth: false,
    timeoutMs: IDENTITY_VERIFICATION_TIMEOUT_MS,
  });
}

/**
 * Persists the registered email collected on Step 2 (ID Review) to the
 * session server-side — the only place it happens. OCR never yields an
 * email from a PRC card, so without this call the backend has no address
 * to send the Email OTP fallback to.
 */
/** The six PRC-ID fields as the nurse confirmed them on the ID Review step. */
export interface ReviewedIdFields {
  lastName: string;
  firstName: string;
  middleName: string;
  registrationNumber: string;
  /** ISO (YYYY-MM-DD). */
  registrationDate: string;
  /** ISO (YYYY-MM-DD). */
  validUntil: string;
}

/**
 * Saves what the nurse confirmed on Step 2: the registered email, and the
 * reviewed ID fields when they are supplied.
 *
 * The fields are optional so the call still works for email alone. The server
 * re-validates anything sent and stores the corrected values on the session, so
 * the rest of registration reads the reviewed data rather than the raw scan.
 */
export async function saveRegistrationEmailRequest(
  registrationSessionId: string,
  email: string,
  idFields?: ReviewedIdFields
): Promise<{ success: boolean; registrationSessionId: string }> {
  return apiRequest('/auth/registration-email/', {
    method: 'POST',
    body: { registrationSessionId, email, ...(idFields ?? {}) },
    auth: false,
  });
}

/**
 * PRC nursing licence scan (Tesseract OCR, server-side).
 *
 * `valid: false` is a normal 200 response meaning the upload was not a PRC
 * nursing licence — every field comes back blank in that case.
 */
export type VerifyPrcResponse = {
  valid: boolean;
  message: string;
  lastName: string;
  firstName: string;
  middleName: string;
  fullName: string;
  registrationNumber: string;
  licenseNumber: string;
  validUntil: string;
  profession: string;
  registrationSessionId?: string;
  /**
   * Present only when a selfie was compared against the licence photo.
   * Null/absent when not required (Email OTP session) or not attempted
   * (no selfie sent).
   */
  faceMatch?: { matched: boolean; confidence: number; message: string | null } | null;
};

export async function verifyPrcLicenseRequest(
  image: string,
  registrationSessionId?: string | null,
  selfie?: string | null
): Promise<VerifyPrcResponse> {
  return apiRequest<VerifyPrcResponse>('/auth/verify-prc/', {
    method: 'POST',
    body: {
      image,
      ...(registrationSessionId ? { registrationSessionId } : {}),
      ...(selfie ? { selfie } : {}),
    },
    auth: false,
    timeoutMs: IDENTITY_VERIFICATION_TIMEOUT_MS,
  });
}

export async function faceVerificationRequest(
  image: string,
  idImage: string,
  registrationSessionId?: string | null,
  registeredEmail?: string
): Promise<FaceVerificationResponse> {
  return apiRequest<FaceVerificationResponse>('/auth/face-verification/', {
    method: 'POST',
    body: registrationSessionId ? { image, idImage, registrationSessionId } : { image, idImage, registeredEmail },
    auth: false,
    timeoutMs: IDENTITY_VERIFICATION_TIMEOUT_MS,
  });
}

export async function faceVerificationStatusRequest(params: {
  registrationSessionId?: string | null;
  registeredEmail?: string;
}): Promise<FaceVerificationStatusResponse> {
  return apiRequest<FaceVerificationStatusResponse>('/auth/face-verification/status/', {
    method: 'POST',
    body: params.registrationSessionId
      ? { registrationSessionId: params.registrationSessionId }
      : { registeredEmail: params.registeredEmail },
    auth: false,
  });
}

export type OtpSendResponse = {
  success: boolean;
  status?: 'otp_sent' | 'email_not_registered';
  message: string;
  expiresIn?: number;
  resendCooldown?: number;
  registrationSessionId?: string;
  retryAfter?: number;
};

// `email` is optional and, when present, is only cross-checked server-side
// against the registration's stored address — it is never used as the send
// destination. The session id alone identifies where the OTP goes.
export async function sendRegistrationOtpRequest(
  registrationSessionId: string,
  email?: string
): Promise<OtpSendResponse> {
  return apiRequest<OtpSendResponse>('/auth/send-registration-otp/', {
    method: 'POST',
    body: email ? { email, registrationSessionId } : { registrationSessionId },
    auth: false,
  });
}

export async function resendRegistrationOtpRequest(
  registrationSessionId: string,
  email?: string
): Promise<OtpSendResponse> {
  return apiRequest<OtpSendResponse>('/auth/resend-registration-otp/', {
    method: 'POST',
    body: email ? { email, registrationSessionId } : { registrationSessionId },
    auth: false,
  });
}

export type OtpVerifyResponse = {
  verified: boolean;
  success: boolean;
  status?: 'email_verified';
  method?: 'EMAIL_OTP';
  message: string;
};

export async function verifyRegistrationOtpRequest(
  otp: string,
  registrationSessionId: string
): Promise<OtpVerifyResponse> {
  return apiRequest<OtpVerifyResponse>('/auth/verify-registration-otp/', {
    method: 'POST',
    body: { otp, registrationSessionId },
    auth: false,
  });
}

// ---------------------------------------------------------------------------
// Signup V2 — the new 4-step wizard (Personal Info -> Role -> Email+Phone OTP
// -> Credentials). Kept separate from the requests above: the old flow's OTP
// endpoints only unlock after three failed face-verification attempts, which
// a signup-v2 session (no face step at all) can never reach, so this wizard
// uses its own parallel start/OTP/register endpoints instead.
// ---------------------------------------------------------------------------

export type SignupV2StartResponse = {
  registrationSessionId: string;
  email: string;
};

export async function startSignupV2Request(email: string, phone: string): Promise<SignupV2StartResponse> {
  return apiRequest<SignupV2StartResponse>('/auth/signup-v2/start/', {
    method: 'POST',
    body: { email, phone },
    auth: false,
  });
}

export async function sendSignupV2OtpRequest(registrationSessionId: string): Promise<OtpSendResponse> {
  return apiRequest<OtpSendResponse>('/auth/signup-v2/send-otp/', {
    method: 'POST',
    body: { registrationSessionId },
    auth: false,
  });
}

export async function resendSignupV2OtpRequest(registrationSessionId: string): Promise<OtpSendResponse> {
  return apiRequest<OtpSendResponse>('/auth/signup-v2/resend-otp/', {
    method: 'POST',
    body: { registrationSessionId },
    auth: false,
  });
}

export async function verifySignupV2OtpRequest(
  otp: string,
  registrationSessionId: string
): Promise<OtpVerifyResponse> {
  return apiRequest<OtpVerifyResponse>('/auth/signup-v2/verify-otp/', {
    method: 'POST',
    body: { otp, registrationSessionId },
    auth: false,
  });
}

export type SignupV2CheckNameResponse = {
  available: boolean;
  message?: string;
};

export async function checkSignupV2NameRequest(
  lastName: string,
  firstName: string,
  middleName: string
): Promise<SignupV2CheckNameResponse> {
  return apiRequest<SignupV2CheckNameResponse>('/auth/signup-v2/check-name/', {
    method: 'POST',
    body: { lastName, firstName, middleName },
    auth: false,
  });
}

export type SignupV2RegisterPayload = {
  lastName: string;
  firstName: string;
  middleName?: string;
  role: UserRole;
  personalEmail: string;
  phone: string;
  password: string;
  confirmPassword: string;
  registrationSessionId: string;
};

export type SignupV2RegisterResponse = {
  success: boolean;
  message: string;
};

export async function registerSignupV2Request(
  payload: SignupV2RegisterPayload
): Promise<SignupV2RegisterResponse> {
  return apiRequest<SignupV2RegisterResponse>('/auth/signup-v2/register/', {
    method: 'POST',
    body: payload,
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

/**
 * A short-lived, single-use ticket for opening the notifications WebSocket —
 * see RealtimeContext. Requested fresh for every connect/reconnect so the
 * real token never has to appear in the socket URL.
 */
export async function fetchWsTicket(): Promise<string> {
  const data = await apiRequest<{ ticket: string }>('/auth/ws-ticket/', { method: 'POST' });
  return data.ticket;
}

export async function updateMe(updates: Partial<User>): Promise<User> {
  return apiRequest<User>('/auth/me/', {
    method: 'PATCH',
    body: updates,
  });
}

export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string
): Promise<{ detail: string; token?: string }> {
  const data = await apiRequest<{ detail: string; token?: string }>('/auth/change-password/', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  if (data.token) {
    await setToken(data.token);
  }
  return data;
}

export async function fetchPatients(options?: {
  mine?: boolean;
  search?: string;
  riskLevel?: string;
}): Promise<Patient[]> {
  const params = new URLSearchParams();
  if (options?.mine) params.set('mine', 'true');
  if (options?.search) params.set('search', options.search);
  if (options?.riskLevel) params.set('riskLevel', options.riskLevel);
  const query = params.toString() ? `?${params}` : '';
  return apiRequest<Patient[]>(`/patients/${query}`);
}

export async function fetchPatient(patientCode: string): Promise<Patient> {
  return apiRequest<Patient>(`/patients/${patientCode}/`);
}

export async function createPatient(data: Partial<Patient>): Promise<Patient> {
  return apiRequest<Patient>('/patients/', { method: 'POST', body: data });
}

export async function updatePatient(patientCode: string, data: Partial<Patient>): Promise<Patient> {
  return apiRequest<Patient>(`/patients/${patientCode}/`, { method: 'PATCH', body: data });
}

export async function deletePatient(patientCode: string): Promise<void> {
  await apiRequest(`/patients/${patientCode}/`, { method: 'DELETE' });
}

/** Head-nurse-only. Notifies the patient's assigned nurse (resolved
 * server-side) via the real notification inbox — not a local-only toast. */
export async function notifyPatientNurse(patientCode: string, message?: string): Promise<{ detail: string }> {
  return apiRequest<{ detail: string }>(`/patients/${patientCode}/notify-nurse/`, {
    method: 'POST',
    body: message ? { message } : {},
  });
}

/** Head-nurse-only. Sets status to discharged and records who/when. The
 * record is kept, not deleted — see fetchPatientVisits for its history.
 * dischargePlan (M.E.T.H.O.D.) is required unless the backend has
 * DISCHARGE_PLAN_REQUIRED off — omitting it when required returns a 400. */
export async function dischargePatient(
  patientCode: string,
  dischargePlan?: {
    medications: string;
    environment: string;
    treatment: string;
    healthTeaching: string;
    outpatientReferral: string;
    diet: string;
    aiGenerated?: boolean;
  }
): Promise<Patient> {
  return apiRequest<Patient>(`/patients/${patientCode}/discharge/`, {
    method: 'POST',
    body: dischargePlan ? { dischargePlan } : undefined,
  });
}

export type DischargePlanDraft = {
  medications: string;
  environment: string;
  treatment: string;
  healthTeaching: string;
  outpatientReferral: string;
  diet: string;
  aiGenerated: boolean;
};

/** Any approved nurse. AI-drafts a Discharge Plan from this patient's medications,
 * most recent Kardex diet entry, and charted notes — a starting point to review/edit,
 * never persisted until dischargePatient() is called. */
export async function generateDischargePlan(patientCode: string): Promise<DischargePlanDraft> {
  return apiRequest<DischargePlanDraft>(`/patients/${patientCode}/discharge-plan-generate/`, {
    method: 'POST',
    timeoutMs: 60000,
  });
}

/** Head-nurse-only. Reactivates a discharged patient under their existing
 * profile (same id) for a new admission, rather than creating a duplicate. */
export async function readmitPatient(
  patientCode: string,
  data: {
    diagnosis: string;
    room: string;
    admissionDate?: string;
    attendingPhysician?: string;
    departmentId?: number | null;
    riskLevel?: Patient['riskLevel'];
  }
): Promise<Patient> {
  return apiRequest<Patient>(`/patients/${patientCode}/readmit/`, { method: 'POST', body: data });
}

/** Every admission-to-discharge visit on record for this patient, newest first. */
export async function fetchPatientVisits(patientCode: string): Promise<PatientVisit[]> {
  return apiRequest<PatientVisit[]>(`/patients/${patientCode}/visits/`);
}

export async function fetchTasks(options?: {
  mine?: boolean;
  assignedTo?: string;
  status?: string;
  patientId?: string;
  search?: string;
}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (options?.mine) params.set('mine', 'true');
  if (options?.assignedTo) params.set('assignedTo', options.assignedTo);
  if (options?.status) params.set('status', options.status);
  if (options?.patientId) params.set('patientId', options.patientId);
  if (options?.search) params.set('search', options.search);
  const query = params.toString() ? `?${params}` : '';
  return apiRequest<Task[]>(`/tasks/${query}`);
}

export async function createTask(data: Partial<Task>): Promise<Task> {
  return apiRequest<Task>('/tasks/', { method: 'POST', body: data });
}

export async function updateTask(taskId: string, data: Partial<Task>): Promise<Task> {
  return apiRequest<Task>(`/tasks/${taskId}/`, { method: 'PATCH', body: data });
}

export async function unassignTask(taskId: string): Promise<Task> {
  return apiRequest<Task>(`/tasks/${taskId}/unassign/`, { method: 'POST' });
}

/** A patient's Kardex-assigned doctors — the source of truth Add New Task's
 * doctor field reads from (never the whole hospital roster). */
export async function fetchPatientAssignedDoctors(patientCode: string): Promise<Doctor[]> {
  return apiRequest<Doctor[]>(`/patients/${patientCode}/assigned-doctors/`);
}

/** Replaces the patient's whole assigned-doctors set (Kardex screen). */
export async function setPatientAssignedDoctors(
  patientCode: string,
  doctorIds: number[]
): Promise<Doctor[]> {
  return apiRequest<Doctor[]>(`/patients/${patientCode}/assigned-doctors/`, {
    method: 'POST',
    body: { doctorIds },
  });
}

export async function fetchDepartments(): Promise<Department[]> {
  return apiRequest<Department[]>('/departments/');
}

export async function fetchDoctors(options?: {
  departmentId?: number | string;
  search?: string;
}): Promise<Doctor[]> {
  const params = new URLSearchParams();
  if (options?.departmentId) params.set('department', String(options.departmentId));
  if (options?.search) params.set('search', options.search);
  const query = params.toString();
  return apiRequest<Doctor[]>(`/doctors/${query ? `?${query}` : ''}`);
}

// Create/update: admin-only (see DoctorViewSet.get_permissions) — Doctor was
// Django-admin-only reference data until the Admin panel added this.
export async function createDoctor(data: Partial<Doctor>): Promise<Doctor> {
  return apiRequest<Doctor>('/doctors/', { method: 'POST', body: data });
}

export async function updateDoctor(id: number | string, data: Partial<Doctor>): Promise<Doctor> {
  return apiRequest<Doctor>(`/doctors/${id}/`, { method: 'PATCH', body: data });
}

export async function completeTask(taskId: string): Promise<Task> {
  return apiRequest<Task>(`/tasks/${taskId}/complete/`, { method: 'POST' });
}

export async function fetchHandovers(options?: { status?: string }): Promise<HandoverNote[]> {
  const query = options?.status ? `?status=${encodeURIComponent(options.status)}` : '';
  return apiRequest<HandoverNote[]>(`/handovers/${query}`);
}

export async function createHandover(data: Partial<HandoverNote>): Promise<HandoverNote> {
  return apiRequest<HandoverNote>('/handovers/', { method: 'POST', body: data });
}

/** Who the signed-in nurse may refer to right now — shift-rotation eligible
 * recipients only (see api/referral_shifts.py). Refetch whenever the
 * referral form opens, since eligibility depends on the Duty Roster and
 * the current time, not anything cached client-side. */
export async function fetchEligibleReferralRecipients(): Promise<EligibleReferralRecipients> {
  return apiRequest<EligibleReferralRecipients>('/handovers/eligible-recipients/');
}

export async function updateHandover(
  id: string,
  data: Partial<HandoverNote>
): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/`, { method: 'PATCH', body: data });
}

export async function deleteHandover(id: string): Promise<void> {
  await apiRequest(`/handovers/${id}/`, { method: 'DELETE' });
}

/** Lightweight "seen it" step — moves 'sent' -> 'received'. Does not move any tasks; see acceptHandover for that. */
export async function acknowledgeHandover(id: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/acknowledge/`, { method: 'POST' });
}

/** Accepts the referral — moves unfinished tasks onto the accepting nurse's list. Valid from 'sent' or 'received'. */
export async function acceptHandover(id: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/accept/`, { method: 'POST' });
}

/** Declines the referral, optionally with a reason. Valid from 'sent' or 'received'; terminal once declined. */
export async function declineHandover(id: string, reason?: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/decline/`, {
    method: 'POST',
    body: reason ? { reason } : undefined,
  });
}

/** Marks an accepted referral completed. Only valid from 'accepted'. */
export async function completeHandover(id: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/complete/`, { method: 'POST' });
}

export async function fetchChartingNotes(options?: {
  patientId?: string;
  /** When true, backend returns only the logged-in nurse's notes. */
  mine?: boolean;
  /** Local calendar date YYYY-MM-DD (Asia/Manila by default on the server). */
  date?: string;
}): Promise<ChartingNote[]> {
  const params = new URLSearchParams();
  if (options?.patientId) params.set('patientId', options.patientId);
  if (options?.mine) params.set('mine', 'true');
  if (options?.date) params.set('date', options.date);
  const query = params.toString();
  return apiRequest<ChartingNote[]>(`/charting/${query ? `?${query}` : ''}`);
}

export async function fetchChartingHistoryDates(): Promise<ChartingHistoryDate[]> {
  return apiRequest<ChartingHistoryDate[]>('/charting/history-dates/');
}

/**
 * Autocharting — the backend attaches the patient's demographics and vitals,
 * then runs the n8n structure-chart workflow to build the note.
 */
export type StructureChartResponse = {
  success: boolean;
  note: string;
  structured: Record<string, unknown>;
  focus?: string;
  data?: string;
  action?: string;
  response?: string;
  aiGenerated: boolean;
  /** True when n8n returned nothing usable and the backend organised the nurse's own text instead. */
  fallback?: boolean;
  warning?: string;
  saved: boolean;
  noteId?: string;
};

export async function structureChartRequest(payload: {
  patientId: string;
  assessment: string;
  interventions?: string[];
  patientResponse?: string;
  noteType?: 'progress' | 'assessment' | 'medication' | 'vital_signs';
  shift?: 'morning' | 'afternoon' | 'night';
  vitalSigns?: Record<string, unknown>;
  save?: boolean;
}): Promise<StructureChartResponse> {
  // n8n structure-chart can exceed the default 15s client timeout.
  return apiRequest<StructureChartResponse>('/charting/structure/', {
    method: 'POST',
    body: payload,
    timeoutMs: 60000,
  });
}

export async function createChartingNote(data: Partial<ChartingNote>): Promise<ChartingNote> {
  return apiRequest<ChartingNote>('/charting/', { method: 'POST', body: data });
}

export async function updateChartingNote(
  id: string,
  data: Partial<ChartingNote>
): Promise<ChartingNote> {
  return apiRequest<ChartingNote>(`/charting/${id}/`, { method: 'PATCH', body: data });
}

export async function confirmChartingNote(id: string): Promise<ChartingNote> {
  return apiRequest<ChartingNote>(`/charting/${id}/confirm/`, { method: 'POST' });
}

export async function deleteChartingNote(id: string): Promise<void> {
  await apiRequest(`/charting/${id}/`, { method: 'DELETE' });
}

export async function fetchNurses(options?: {
  search?: string;
  /** Patient ID (patient_code) — excludes nurses who already received a handover for this patient. */
  excludeForPatient?: string;
  /** Only nurses on the Duty Roster for this shift (today, unless `date` is also given). */
  shift?: string;
  date?: string;
}): Promise<Nurse[]> {
  const params = new URLSearchParams();
  if (options?.search) params.set('search', options.search);
  if (options?.excludeForPatient) params.set('excludeForPatient', options.excludeForPatient);
  if (options?.shift) params.set('shift', options.shift);
  if (options?.date) params.set('date', options.date);
  const query = params.toString();
  return apiRequest<Nurse[]>(`/nurses/${query ? `?${query}` : ''}`);
}

/** Head-nurse-only: change a nurse's department and/or shift. */
export async function assignNurse(
  nurseId: string,
  data: { department?: string; shift?: string }
): Promise<{ id: string; name: string; department: string; shift: string }> {
  return apiRequest(`/nurses/${nurseId}/assign/`, { method: 'PATCH', body: data });
}

export async function fetchWorkload(): Promise<WorkloadData[]> {
  return apiRequest<WorkloadData[]>('/workload/');
}

export async function fetchAnalytics(): Promise<AnalyticsData> {
  return apiRequest<AnalyticsData>('/analytics/');
}

/** The Settings page, as stored on the account. */
export interface UserPreferences {
  fontSize: 'small' | 'medium' | 'large';
  compactView: boolean;
  taskNotifications: boolean;
  handoverNotifications: boolean;
  criticalAlerts: boolean;
  emailNotifications: boolean;
  soundAlerts: boolean;
  autoRefresh: boolean;
  showCharts: boolean;
  backgroundSync: boolean;
}

export async function fetchPreferences(): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/preferences/');
}

/** Partial update: the Settings page saves one section at a time. */
export async function updatePreferences(
  changes: Partial<UserPreferences>
): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/preferences/', { method: 'PATCH', body: changes });
}

/** Revision stamps used to detect changes without refetching whole lists. */
export interface LiveState {
  notifications: string;
  tasks: string;
  handovers: string;
  patients: string;
  /** A head nurse ending/editing any nurse's shift (Close Shift, or the
   * roster's edit form) moves this — see DutyAssignmentViewSet. */
  duty: string;
  /** The signed-in nurse's own department:shift — set by a head nurse via
   * assignNurse, not by this device. Independent of notification
   * preferences, since it's account data, not an alert. */
  profile: string;
  unreadCount: number;
}

export async function fetchLiveState(): Promise<LiveState> {
  // quiet: this runs on a background timer (see LiveContext) — the backend
  // being briefly unreachable (not yet started, mid-restart) is expected and
  // recoverable, not a bug to pop a console error over on every tick.
  return apiRequest<LiveState>('/live/', { quiet: true });
}

export async function fetchNotifications(): Promise<{
  results: AppNotification[];
  unreadCount: number;
}> {
  return apiRequest('/notifications/');
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/notifications/${id}/mark_read/`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiRequest('/notifications/mark_all_read/', { method: 'POST' });
}

export async function deleteNotification(id: string): Promise<void> {
  await apiRequest(`/notifications/${id}/`, { method: 'DELETE' });
}

export async function fetchAssignments(options?: {
  status?: string;
  nurseId?: string;
}): Promise<PatientAssignmentRecord[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.nurseId) params.set('nurseId', options.nurseId);
  const query = params.toString() ? `?${params}` : '';
  return apiRequest<PatientAssignmentRecord[]>(`/assignments/${query}`);
}

export async function createAssignment(data: {
  patientId: string;
  assignedNurseId?: string;
  nurseId?: string;
  nurseName?: string;
  priority?: string;
  notes?: string;
  ward?: string;
}): Promise<PatientAssignmentRecord> {
  return apiRequest<PatientAssignmentRecord>('/assignments/', { method: 'POST', body: data });
}

export async function updateAssignment(
  id: string,
  data: Partial<PatientAssignmentRecord> & { nurseId?: string; nurseName?: string }
): Promise<PatientAssignmentRecord> {
  return apiRequest<PatientAssignmentRecord>(`/assignments/${id}/`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteAssignment(id: string): Promise<void> {
  await apiRequest(`/assignments/${id}/`, { method: 'DELETE' });
}

export async function fetchDutyAssignments(options?: {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  shift?: string;
  departmentId?: string | number;
  status?: string;
  nurseId?: string;
  search?: string;
}): Promise<DutyAssignment[]> {
  const params = new URLSearchParams();
  if (options?.date) params.set('date', options.date);
  if (options?.dateFrom) params.set('dateFrom', options.dateFrom);
  if (options?.dateTo) params.set('dateTo', options.dateTo);
  if (options?.shift) params.set('shift', options.shift);
  if (options?.departmentId) params.set('departmentId', String(options.departmentId));
  if (options?.status) params.set('status', options.status);
  if (options?.nurseId) params.set('nurseId', options.nurseId);
  if (options?.search) params.set('search', options.search);
  const query = params.toString() ? `?${params}` : '';
  return apiRequest<DutyAssignment[]>(`/duty-assignments/${query}`);
}

export type DutyAssignmentInput = {
  nurseId: string;
  departmentId: number;
  dutyDate: string;
  shift: string;
  startTime: string;
  endTime: string;
  overtimeStart?: string | null;
  overtimeEnd?: string | null;
  status?: string;
  notes?: string;
};

export async function createDutyAssignment(data: DutyAssignmentInput): Promise<DutyAssignment> {
  return apiRequest<DutyAssignment>('/duty-assignments/', { method: 'POST', body: data });
}

export async function updateDutyAssignment(
  id: number,
  data: Partial<DutyAssignmentInput>
): Promise<DutyAssignment> {
  return apiRequest<DutyAssignment>(`/duty-assignments/${id}/`, { method: 'PATCH', body: data });
}

export async function deleteDutyAssignment(id: number): Promise<void> {
  await apiRequest(`/duty-assignments/${id}/`, { method: 'DELETE' });
}

/** Clock in — records the real start time server-side. No request body. */
export async function startDutyAssignment(id: number): Promise<DutyAssignment> {
  return apiRequest<DutyAssignment>(`/duty-assignments/${id}/start/`, { method: 'POST' });
}

/** Clock out — records the real end time and freezes actual hours server-side. */
export async function endDutyAssignment(id: number): Promise<DutyAssignment> {
  return apiRequest<DutyAssignment>(`/duty-assignments/${id}/end/`, { method: 'POST' });
}

export async function closeDutyAssignment(id: number): Promise<DutyAssignment> {
  return apiRequest<DutyAssignment>(`/duty-assignments/${id}/close/`, { method: 'POST' });
}

export async function fetchKardexRecords(): Promise<KardexHistory[]> {
  return apiRequest<KardexHistory[]>('/kardex/');
}

export async function createKardexRecord(
  data: Partial<KardexHistory> & { patientId?: string; confirmDuplicate?: boolean }
): Promise<KardexHistory> {
  return apiRequest<KardexHistory>('/kardex/', { method: 'POST', body: data });
}

export async function deleteKardexRecord(id: string): Promise<void> {
  await apiRequest(`/kardex/${id}/`, { method: 'DELETE' });
}

export async function reviewKardexRecord(
  id: string,
  decision: 'approved' | 'returned' | 'rejected',
  notes?: string
): Promise<KardexHistory> {
  return apiRequest<KardexHistory>(`/kardex/${id}/review/`, {
    method: 'POST',
    body: { decision, notes: notes || '' },
  });
}

// ---------------------------------------------------------------------------
// Kardex Laboratories / Medication Intake — separate endpoints from Kardex
// itself (see api/models.py's KardexLaboratory/KardexMedication/
// MedicationIntake): these hang off the patient and are added/edited any
// time, independent of whenever the Kardex form was last saved.

export async function fetchLaboratories(patientId: string): Promise<LabEntry[]> {
  return apiRequest<LabEntry[]>(`/kardex-laboratories/?patientId=${encodeURIComponent(patientId)}`);
}

export async function createLaboratory(
  data: Partial<LabEntry> & { patientId: string }
): Promise<LabEntry> {
  return apiRequest<LabEntry>('/kardex-laboratories/', { method: 'POST', body: data });
}

export async function updateLaboratory(id: number, data: Partial<LabEntry>): Promise<LabEntry> {
  return apiRequest<LabEntry>(`/kardex-laboratories/${id}/`, { method: 'PATCH', body: data });
}

export async function deleteLaboratory(id: number): Promise<void> {
  await apiRequest(`/kardex-laboratories/${id}/`, { method: 'DELETE' });
}

export async function fetchMedications(patientId: string): Promise<MedicationOrder[]> {
  return apiRequest<MedicationOrder[]>(`/kardex-medications/?patientId=${encodeURIComponent(patientId)}`);
}

export async function createMedication(
  data: Partial<MedicationOrder> & { patientId: string }
): Promise<MedicationOrder> {
  return apiRequest<MedicationOrder>('/kardex-medications/', { method: 'POST', body: data });
}

export async function updateMedication(
  id: number,
  data: Partial<MedicationOrder>
): Promise<MedicationOrder> {
  return apiRequest<MedicationOrder>(`/kardex-medications/${id}/`, { method: 'PATCH', body: data });
}

export async function deleteMedication(id: number): Promise<void> {
  await apiRequest(`/kardex-medications/${id}/`, { method: 'DELETE' });
}

export async function recordMedicationIntake(
  data: Partial<MedicationIntakeEntry> & { medicationId: number }
): Promise<MedicationIntakeEntry> {
  return apiRequest<MedicationIntakeEntry>('/medication-intakes/', { method: 'POST', body: data });
}

// ---------------------------------------------------------------------------
// Admin panel — everything here requires a real is_staff account (IsAdmin on
// the backend). See types/domain.ts AdminAccount/AdminRegistrationSession/
// AdminFaceVerificationAttempt for the shapes.

export async function fetchAdminAccounts(options?: {
  role?: 'staff_nurse' | 'head_nurse';
  status?: 'pending' | 'approved' | 'rejected';
}): Promise<AdminAccount[]> {
  const params = new URLSearchParams();
  if (options?.role) params.set('role', options.role);
  if (options?.status) params.set('status', options.status);
  const query = params.toString();
  return apiRequest<AdminAccount[]>(`/admin/users/${query ? `?${query}` : ''}`);
}

export async function approveAdminAccount(id: string): Promise<AdminAccount> {
  return apiRequest<AdminAccount>(`/admin/users/${id}/approve/`, { method: 'POST' });
}

export async function grantAdminAccountRole(
  id: string,
  role: 'staff_nurse' | 'head_nurse'
): Promise<AdminAccount> {
  return apiRequest<AdminAccount>(`/admin/users/${id}/grant-role/`, { method: 'POST', body: { role } });
}

export async function clearAdminAccountLoginLock(id: string): Promise<void> {
  await apiRequest(`/admin/users/${id}/clear-login-lock/`, { method: 'POST' });
}

export async function rejectAdminAccount(id: string, reason: string): Promise<AdminAccount> {
  return apiRequest<AdminAccount>(`/admin/users/${id}/reject/`, { method: 'POST', body: { reason } });
}

export async function deactivateAdminAccount(id: string): Promise<AdminAccount> {
  return apiRequest<AdminAccount>(`/admin/users/${id}/deactivate/`, { method: 'POST' });
}

export async function reactivateAdminAccount(id: string): Promise<AdminAccount> {
  return apiRequest<AdminAccount>(`/admin/users/${id}/reactivate/`, { method: 'POST' });
}

export async function setAdminAccountPassword(id: string, password: string): Promise<void> {
  await apiRequest(`/admin/users/${id}/set-password/`, { method: 'POST', body: { password } });
}

// Permanently removes the account -- unlike reject/deactivate (reversible,
// keep the record), this is the one genuinely destructive action, for when
// the account itself needs to be gone (e.g. to free its email/name for a
// real re-signup).
export async function deleteAdminAccount(id: string): Promise<void> {
  await apiRequest(`/admin/users/${id}/`, { method: 'DELETE' });
}

// ---- Admin: edit/delete any hospital record ---------------------------------
// One admin-only endpoint (api/admin_records.py) behind every Hospital Records
// section. Changes land in the shared tables, so every account sees them.

export type AdminRecordType =
  | 'patients' | 'tasks' | 'handovers' | 'task-handovers' | 'charting'
  | 'duty' | 'kardex' | 'vitals' | 'departments' | 'doctors';

export async function updateAdminRecord(
  type: AdminRecordType,
  id: string | number,
  body: Record<string, unknown>
): Promise<unknown> {
  return apiRequest(`/admin/records/${type}/${encodeURIComponent(String(id))}/`, { method: 'PATCH', body });
}

export async function deleteAdminRecord(type: AdminRecordType, id: string | number): Promise<void> {
  await apiRequest(`/admin/records/${type}/${encodeURIComponent(String(id))}/`, { method: 'DELETE' });
}

export interface AdminAuditEntry {
  id: number;
  actorName: string;
  action: 'update' | 'delete';
  recordType: string;
  recordId: string;
  recordLabel: string;
  changes: Record<string, unknown>;
  createdAt: string;
}

export async function fetchAdminAuditLog(limit = 20): Promise<AdminAuditEntry[]> {
  return apiRequest<AdminAuditEntry[]>(`/admin/audit-log/?limit=${limit}`);
}

export async function updateAdminAccount(
  id: string,
  body: Partial<{
    firstName: string; middleName: string; lastName: string; email: string;
    phoneNumber: string; department: string; clinicalRole: string;
    specialization: string; licenseNumber: string;
  }>
): Promise<AdminAccount> {
  return apiRequest<AdminAccount>(`/admin/users/${id}/`, { method: 'PATCH', body });
}

export async function fetchAdminRegistrationSessions(options?: {
  email?: string;
  verified?: boolean;
}): Promise<AdminRegistrationSession[]> {
  const params = new URLSearchParams();
  if (options?.email) params.set('email', options.email);
  if (options?.verified !== undefined) params.set('verified', String(options.verified));
  const query = params.toString();
  return apiRequest<AdminRegistrationSession[]>(`/admin/registration-sessions/${query ? `?${query}` : ''}`);
}

export async function fetchAdminFaceVerificationAttempts(
  sessionId?: string
): Promise<AdminFaceVerificationAttempt[]> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return apiRequest<AdminFaceVerificationAttempt[]>(`/admin/face-verification-attempts/${query}`);
}

// `id` here is the numeric row id (AdminRegistrationSession.id) — the
// router's lookup key — not the UUID sessionId field.
export async function deleteAdminRegistrationSession(id: number): Promise<void> {
  await apiRequest(`/admin/registration-sessions/${id}/`, { method: 'DELETE' });
}

export async function clearAbandonedRegistrationSessions(): Promise<{ deleted: number }> {
  return apiRequest<{ deleted: number }>('/admin/registration-sessions/clear-abandoned/', {
    method: 'POST',
  });
}

// Read-only oversight — the real send/accept/verify workflow lives outside
// the Admin panel. Admin's own read access to /task-handovers/ and
// /vital-signs/ comes from IsApprovedNurseOrAdminReadOnly on those viewsets.
export async function fetchTaskHandovers(): Promise<AdminTaskHandover[]> {
  return apiRequest<AdminTaskHandover[]>('/task-handovers/');
}

export async function fetchVitalReadings(
  options?: { patientId?: string; taskId?: string }
): Promise<AdminVitalReading[]> {
  const params = new URLSearchParams();
  if (options?.patientId) params.set('patientId', options.patientId);
  if (options?.taskId) params.set('taskId', options.taskId);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<AdminVitalReading[]>(`/vital-signs/${query}`);
}

/** Logs one timestamped vitals reading — insert-only, never edited after
 * the fact. `recordedAt` is left for the server to stamp as "now" unless
 * explicitly overridden. */
export async function createVitalSigns(
  data: Partial<AdminVitalReading> & { patientId: string }
): Promise<AdminVitalReading> {
  return apiRequest<AdminVitalReading>('/vital-signs/', { method: 'POST', body: data });
}
