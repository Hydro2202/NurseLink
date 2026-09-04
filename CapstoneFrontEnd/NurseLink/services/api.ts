import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, TOKEN_KEY } from './config';
import type { User, UserRole } from '../types/user';
import type {
  AnalyticsData,
  AppNotification,
  ChartingNote,
  HandoverNote,
  KardexHistory,
  Nurse,
  Patient,
  PatientAssignmentRecord,
  Task,
  WorkloadData,
} from '../types/domain';

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
  timeoutMs?: number;
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
  { method = 'GET', body, auth = true, timeoutMs = 15000 }: RequestOptions = {}
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Request timed out. Is the backend running?', 408);
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network request failed',
      0
    );
  } finally {
    clearTimeout(timeoutId);
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
  const data = await apiRequest<AuthResponse>('/auth/signup/', {
    method: 'POST',
    body: userData,
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
  reset?: boolean;
  countable?: boolean;
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

export async function resetFaceVerificationRequest(
  registrationSessionId: string
): Promise<FaceVerificationResponse> {
  return apiRequest<FaceVerificationResponse>('/auth/face-verification/', {
    method: 'POST',
    body: { registrationSessionId, reset: true },
    auth: false,
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

export async function updateHandover(
  id: string,
  data: Partial<HandoverNote>
): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/`, { method: 'PATCH', body: data });
}

export async function deleteHandover(id: string): Promise<void> {
  await apiRequest(`/handovers/${id}/`, { method: 'DELETE' });
}

export async function acknowledgeHandover(id: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/acknowledge/`, { method: 'POST' });
}

export async function fetchChartingNotes(options?: {
  patientId?: string;
}): Promise<ChartingNote[]> {
  const query = options?.patientId
    ? `?patientId=${encodeURIComponent(options.patientId)}`
    : '';
  return apiRequest<ChartingNote[]>(`/charting/${query}`);
}

/**
 * Autocharting — the backend attaches the patient's demographics and vitals,
 * then runs the n8n structure-chart workflow to build the note.
 */
export type StructureChartResponse = {
  success: boolean;
  note: string;
  structured: Record<string, unknown>;
  aiGenerated: boolean;
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
  return apiRequest<StructureChartResponse>('/charting/structure/', {
    method: 'POST',
    body: payload,
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

export async function deleteChartingNote(id: string): Promise<void> {
  await apiRequest(`/charting/${id}/`, { method: 'DELETE' });
}

export async function fetchNurses(): Promise<Nurse[]> {
  return apiRequest<Nurse[]>('/nurses/');
}

/** Supervisor-only: change a nurse's department and/or shift. */
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
  unreadCount: number;
}

export async function fetchLiveState(): Promise<LiveState> {
  return apiRequest<LiveState>('/live/');
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
