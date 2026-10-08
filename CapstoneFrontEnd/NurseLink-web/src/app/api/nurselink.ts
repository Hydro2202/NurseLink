import { apiRequest, setToken, ApiError } from './client';
export { ApiError };
import type { User, UserRole } from '../contexts/AuthContext';
import type {
  AdminUser,
  AnalyticsData,
  AppNotification,
  ChartingNote,
  Department,
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

export async function declineHandover(id: string, reason: string): Promise<HandoverNote> {
  return apiRequest<HandoverNote>(`/handovers/${id}/decline/`, { method: 'POST', body: { reason } });
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
}): Promise<ChartingNote[]> {
  const query = options?.patientId
    ? `?patientId=${encodeURIComponent(options.patientId)}`
    : '';
  return apiRequest<ChartingNote[]>(`/charting/${query}`);
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
