import { apiRequest, setToken, ApiError } from './client';
export { ApiError };
import type { User, UserRole } from '../contexts/AuthContext';
import type {
  AdminUser,
  AnalyticsData,
  AppNotification,
  ChartingHistoryDate,
  ChartingNote,
  Department,
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
  Task,
  WorkloadData,
} from '../types/domain';

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
  setToken(data.token);
  return data;
}

/**
 * Persona steps 1 & 2 — the backend forwards the ID photo to the n8n
 * identity-verify workflow (action: 'ocr') and returns the fields it read.
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
  confidence?: number | null;
  message?: string;
  registrationSessionId: string;
};

export async function verifyIdRequest(
  idImage: string,
  options?: { registrationSessionId?: string | null; expectedRole?: 'staff_nurse' | 'head_nurse' | '' }
): Promise<VerifyIdResponse> {
  return apiRequest<VerifyIdResponse>('/auth/verify-id/', {
    method: 'POST',
    body: {
      idImage,
      documentType: 'prc_license',
      ...(options?.registrationSessionId ? { registrationSessionId: options.registrationSessionId } : {}),
      ...(options?.expectedRole ? { expectedRole: options.expectedRole } : {}),
    },
    auth: false,
  });
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
};

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

export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string
): Promise<{ detail: string; token?: string }> {
  const data = await apiRequest<{ detail: string; token?: string }>('/auth/change-password/', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  if (data.token) setToken(data.token);
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

export async function fetchDepartments(): Promise<Department[]> {
  return apiRequest<Department[]>('/departments/');
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

export async function notifyPatientNurse(patientCode: string, message?: string): Promise<{ detail: string }> {
  return apiRequest<{ detail: string }>(`/patients/${patientCode}/notify-nurse/`, {
    method: 'POST',
    body: message ? { message } : {},
  });
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

export async function acceptHandover(id: string): Promise<HandoverNote & { adoptedTasks?: string[] }> {
  return apiRequest(`/handovers/${id}/accept/`, { method: 'POST' });
}

export async function declineHandover(id: string, reason?: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/decline/`, {
    method: 'POST',
    body: reason ? { reason } : undefined,
  });
}

export async function completeHandover(id: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/complete/`, { method: 'POST' });
}

/** Who the signed-in nurse may refer to right now — shift-rotation eligible
 * recipients only (see api/referral_shifts.py). Refetch whenever the
 * referral form opens, since eligibility depends on the Duty Roster and
 * the current time, not anything cached client-side. */
export async function fetchEligibleReferralRecipients(): Promise<EligibleReferralRecipients> {
  return apiRequest<EligibleReferralRecipients>('/handovers/eligible-recipients/');
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

/** Local calendar dates (Asia/Manila by default on the server) that have at
 * least one charting note by the signed-in nurse, newest first — backs the
 * "My Charting History" date browser. */
export async function fetchChartingHistoryDates(): Promise<ChartingHistoryDate[]> {
  return apiRequest<ChartingHistoryDate[]>('/charting/history-dates/');
}

/** Head-nurse confirmation of a charting note — sets confirmed/confirmedAt. */
export async function confirmChartingNote(id: string): Promise<ChartingNote> {
  return apiRequest<ChartingNote>(`/charting/${id}/confirm/`, { method: 'POST' });
}

/**
 * Autocharting — the backend attaches the patient's demographics and vitals,
 * then runs the n8n structure-chart workflow to build the note. Can exceed
 * the default request timeout, so this calls with a 60s client timeout; a
 * 503 (or any ApiError) means the n8n workflow is unavailable right now.
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
  return apiRequest<StructureChartResponse>('/charting/structure/', {
    method: 'POST',
    body: payload,
    timeoutMs: 60000,
  });
}

export async function fetchNurses(): Promise<Nurse[]> {
  return apiRequest<Nurse[]>('/nurses/');
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

// --- Admin interface -----------------------------------------------------
// All of these require an is_staff account — see AdminUserViewSet/IsAdmin
// on the backend. A non-admin token gets a 403 from every one of these.

export async function fetchAdminUsers(filters?: {
  role?: 'staff_nurse' | 'head_nurse';
  status?: 'pending' | 'approved' | 'rejected';
}): Promise<AdminUser[]> {
  const params = new URLSearchParams();
  if (filters?.role) params.set('role', filters.role);
  if (filters?.status) params.set('status', filters.status);
  const query = params.toString() ? `?${params}` : '';
  return apiRequest<AdminUser[]>(`/admin/users/${query}`);
}

export async function approveAdminUser(id: string): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}/approve/`, { method: 'POST' });
}

export async function rejectAdminUser(id: string, reason: string): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}/reject/`, { method: 'POST', body: { reason } });
}

export async function deactivateAdminUser(id: string): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}/deactivate/`, { method: 'POST' });
}

export async function reactivateAdminUser(id: string): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}/reactivate/`, { method: 'POST' });
}

export async function setAdminUserPassword(id: string, password: string): Promise<void> {
  await apiRequest(`/admin/users/${id}/set-password/`, { method: 'POST', body: { password } });
}

// --- Vital signs check-ins + task doctor assignment (ported from mobile) ---
// Types are referenced inline (not added to the import block above) so this
// append doesn't touch any existing lines of this file.

/** Timestamped vitals history, filterable by patient and/or task. */
export async function fetchVitalReadings(options?: {
  patientId?: string;
  taskId?: string;
}): Promise<import('../types/domain').VitalReading[]> {
  const params = new URLSearchParams();
  if (options?.patientId) params.set('patientId', options.patientId);
  if (options?.taskId) params.set('taskId', options.taskId);
  const query = params.toString() ? `?${params}` : '';
  return apiRequest<import('../types/domain').VitalReading[]>(`/vital-signs/${query}`);
}

/** Logs one timestamped vitals reading — insert-only. The server rejects it
 * (403) unless the patient is assigned to the caller or the caller is a head
 * nurse. `recordedAt` defaults to "now" server-side when omitted. */
export async function createVitalSigns(
  data: Partial<import('../types/domain').VitalReading> & { patientId: string }
): Promise<import('../types/domain').VitalReading> {
  return apiRequest<import('../types/domain').VitalReading>('/vital-signs/', {
    method: 'POST',
    body: data,
  });
}

/** A patient's Kardex-assigned doctors — the source of truth for a task's
 * department/doctor fields (never the whole hospital roster). */
export async function fetchPatientAssignedDoctors(
  patientCode: string
): Promise<import('../types/domain').Doctor[]> {
  return apiRequest<import('../types/domain').Doctor[]>(`/patients/${patientCode}/assigned-doctors/`);
}

// --- Admin: hospital doctor directory, task handovers, registration audit
// trail (ported from mobile's admin/doctors.tsx, admin/[section].tsx, and
// admin/registrations.tsx) ---

export async function fetchDoctors(options?: {
  departmentId?: number | string;
  search?: string;
}): Promise<import('../types/domain').Doctor[]> {
  const params = new URLSearchParams();
  if (options?.departmentId) params.set('department', String(options.departmentId));
  if (options?.search) params.set('search', options.search);
  const query = params.toString();
  return apiRequest<import('../types/domain').Doctor[]>(`/doctors/${query ? `?${query}` : ''}`);
}

// Create/update: admin-only (see DoctorViewSet.get_permissions).
export async function createDoctor(
  data: Partial<import('../types/domain').Doctor>
): Promise<import('../types/domain').Doctor> {
  return apiRequest<import('../types/domain').Doctor>('/doctors/', { method: 'POST', body: data });
}

export async function updateDoctor(
  id: number | string,
  data: Partial<import('../types/domain').Doctor>
): Promise<import('../types/domain').Doctor> {
  return apiRequest<import('../types/domain').Doctor>(`/doctors/${id}/`, { method: 'PATCH', body: data });
}

// Read-only oversight — the real send/accept/verify workflow lives outside
// the Admin panel.
export async function fetchTaskHandovers(): Promise<import('../types/domain').AdminTaskHandover[]> {
  return apiRequest<import('../types/domain').AdminTaskHandover[]>('/task-handovers/');
}

export async function fetchAdminRegistrationSessions(options?: {
  email?: string;
  verified?: boolean;
}): Promise<import('../types/domain').AdminRegistrationSession[]> {
  const params = new URLSearchParams();
  if (options?.email) params.set('email', options.email);
  if (options?.verified !== undefined) params.set('verified', String(options.verified));
  const query = params.toString();
  return apiRequest<import('../types/domain').AdminRegistrationSession[]>(
    `/admin/registration-sessions/${query ? `?${query}` : ''}`
  );
}

export async function fetchAdminFaceVerificationAttempts(
  sessionId?: string
): Promise<import('../types/domain').AdminFaceVerificationAttempt[]> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return apiRequest<import('../types/domain').AdminFaceVerificationAttempt[]>(
    `/admin/face-verification-attempts/${query}`
  );
}

// `id` here is the numeric row id (AdminRegistrationSession.id), not the
// UUID sessionId field.
export async function deleteAdminRegistrationSession(id: number): Promise<void> {
  await apiRequest(`/admin/registration-sessions/${id}/`, { method: 'DELETE' });
}

export async function clearAbandonedRegistrationSessions(): Promise<{ deleted: number }> {
  return apiRequest<{ deleted: number }>('/admin/registration-sessions/clear-abandoned/', {
    method: 'POST',
  });
}

// --- Patient discharge / readmit / visit history (ported from mobile's
// services/api.ts for the All Patients page) ---

export type DischargePlanDraft = {
  medications: string;
  environment: string;
  treatment: string;
  healthTeaching: string;
  outpatientReferral: string;
  diet: string;
  aiGenerated: boolean;
};

/** Head-nurse-only. Sets status to discharged and records who/when. The
 * record is kept, not deleted — see fetchPatientVisits for its history.
 * dischargePlan (M.E.T.H.O.D.) is required unless the backend has
 * DISCHARGE_PLAN_REQUIRED off — omitting it when required returns a 400. */
export async function dischargePatient(
  patientCode: string,
  dischargePlan?: Omit<DischargePlanDraft, 'aiGenerated'> & { aiGenerated?: boolean }
): Promise<Patient> {
  return apiRequest<Patient>(`/patients/${patientCode}/discharge/`, {
    method: 'POST',
    body: dischargePlan ? { dischargePlan } : undefined,
  });
}

/** Any approved nurse. AI-drafts a Discharge Plan from this patient's
 * medications, most recent Kardex diet entry, and charted notes — a starting
 * point to review/edit, never persisted until dischargePatient() is called. */
export async function generateDischargePlan(patientCode: string): Promise<DischargePlanDraft> {
  return apiRequest<DischargePlanDraft>(`/patients/${patientCode}/discharge-plan-generate/`, {
    method: 'POST',
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
export async function fetchPatientVisits(
  patientCode: string
): Promise<import('../types/domain').PatientVisit[]> {
  return apiRequest<import('../types/domain').PatientVisit[]>(`/patients/${patientCode}/visits/`);
}

// --- Live refresh + realtime (ported from mobile's LiveContext/RealtimeContext) ---

/** Revision stamps used to detect changes without refetching whole lists. */
export interface LiveState {
  notifications: string;
  tasks: string;
  handovers: string;
  patients: string;
  /** A head nurse ending/editing any nurse's shift moves this. */
  duty: string;
  /** The signed-in nurse's own department:shift — set by a head nurse via
   * assignNurse, not by this device. */
  profile: string;
  unreadCount: number;
}

export async function fetchLiveState(): Promise<LiveState> {
  return apiRequest<LiveState>('/live/');
}

/** A short-lived, single-use ticket for opening the notifications WebSocket —
 * see RealtimeContext. Requested fresh for every connect/reconnect so the
 * real auth token never has to appear in the socket URL. */
export async function fetchWsTicket(): Promise<string> {
  const data = await apiRequest<{ ticket: string }>('/auth/ws-ticket/', { method: 'POST' });
  return data.ticket;
}
