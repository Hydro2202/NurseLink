/** Domain types shared by API services and screens (replaces mockData types). */

export interface Task {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  description: string;
  priority: 'urgent' | 'routine' | 'completed';
  dueTime: string;
  assignedTo: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  category: 'medication' | 'vital_signs' | 'care' | 'assessment' | 'documentation';
  createdAt: string;
  completedAt?: string;
  attendingPhysician?: string;
  patientRoom?: string;
  doctorOrder?: string;
  checklist: TaskChecklistItem[];
}

export interface TaskChecklistItem {
  text: string;
  done: boolean;
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: 'Male' | 'Female';
  room: string;
  diagnosis: string;
  admissionDate: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  status?: 'admitted' | 'observation' | 'discharged';
  statusLabel?: string;
  vitalSigns: {
    heartRate: number;
    bloodPressure: string;
    temperature: number;
    oxygenSaturation: number;
    respiratoryRate: number;
  };
  allergies: string[];
  medications: string[];
  alerts: string[];
  /** Anthropometric, not part of vitalSigns above — see api/models.py's
   * compute_bmi(). null/undefined when not recorded; bmi is server-computed
   * and read-only. */
  heightCm?: number | null;
  weightKg?: number | null;
  bmi?: number | null;
  attendingPhysician?: string;
  /** Registration/demographic detail — see api/models.py's Patient fields
   * added alongside the 103-patient seed feature. All optional since most
   * pre-existing patients predate them. */
  medicalRecordNumber?: string | null;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  contactNumber?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactNumber?: string;
  bedNumber?: string;
  departmentId?: string | number | null;
  departmentName?: string;
  assignedNurseId?: string | null;
  assignedNurseName?: string | null;
  /** The patient's actual care-team doctors (PatientDoctor), the real
   * "Assigned Doctor" relationship — distinct from the legacy free-text
   * attendingPhysician string above. */
  assignedDoctors?: { id: number; name: string; specialization?: string; departmentName?: string }[];
  /** Kardex Laboratories / Medication Intake sections — read-only here;
   * add/edit through the dedicated lab/medication/intake endpoints (see
   * api/nurselink.ts), not by re-saving the Kardex form. */
  laboratories?: LabEntry[];
  medicationOrders?: MedicationOrder[];
}

export interface Department {
  id: number;
  name: string;
}

/** One ordered lab/diagnostic test — see api/models.py's KardexLaboratory.
 * Linked to the patient (not a single Kardex snapshot) since a lab is
 * ordered and later comes back Done independently of when the Kardex form
 * was last saved. */
export interface LabEntry {
  id: number;
  testName: string;
  dateOrdered: string;
  dateDone?: string | null;
  status: 'pending' | 'done' | 'cancelled';
  result: string;
  remarks: string;
  createdByName?: string | null;
  createdByRole?: string | null;
  updatedByName?: string | null;
  updatedByRole?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Server-computed: pending for more than 2 days. */
  isOverdue: boolean;
}

/** One actual administration event against a MedicationOrder — insert-only,
 * see api/models.py's MedicationIntake. */
export interface MedicationIntakeEntry {
  id: number;
  scheduledTime: string;
  administeredAt?: string | null;
  status: 'given' | 'held' | 'refused' | 'missed';
  reason: string;
  administeredByName?: string | null;
  administeredByRole?: string | null;
  createdAt: string;
}

/** One medication order — see api/models.py's KardexMedication. Linked to
 * the patient for the same reason LabEntry is. */
export interface MedicationOrder {
  id: number;
  medicationName: string;
  dose: string;
  route: 'Oral' | 'IV' | 'IM' | 'SubQ' | 'Topical' | 'Inhalation' | 'Other';
  frequency: string;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
  remarks: string;
  createdByName?: string | null;
  createdByRole?: string | null;
  updatedByName?: string | null;
  updatedByRole?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Timestamp of the most recent intake (administeredAt, falling back to
   * scheduledTime), or null if never recorded. */
  lastGiven?: string | null;
  intakes: MedicationIntakeEntry[];
  /** Server-computed from `frequency` — best-effort, null/PRN medications
   * are never flagged. See api/serializers.py's frequency_interval_hours. */
  isOverdue: boolean;
}

export interface HandoverNote {
  id: string;
  patientId: string;
  patientName: string;
  /**
   * The shift the sender filed this referral on — server-derived from
   * their own current Duty Roster assignment at creation time (see
   * api/referral_shifts.py), never client-chosen. Read-only.
   */
  shift: 'morning' | 'afternoon' | 'night';
  shiftLabel?: string;
  /** The shift-rotation target this referral was sent to (Morning ->
   * Afternoon -> Night -> next day's Morning). Read-only. */
  toShift?: 'morning' | 'afternoon' | 'night' | '';
  toShiftLabel?: string;
  /** The target shift's date — equal to `date` except for Night ->
   * Morning, where it's the next calendar day. Read-only. */
  shiftDate?: string | null;
  departmentId?: number | null;
  departmentName?: string;
  date: string;
  nurseFrom: string;
  nurseTo: string;
  /** Account id of the receiving nurse. Write-only: sent on create, never returned. */
  nurseToId?: string;
  /** The receiving nurse's clinical role (RN, LPN, ...), read live off their
   * NurseProfile — blank for referrals predating nurse_to_user or addressed
   * to a name that didn't resolve to an account. Read-only. */
  nurseToRole?: string;
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  unfinishedTasks: string[];
  photos?: {
    id: string;
    url: string;
    description: string;
    uploadedAt: string;
    expiresAt: string;
  }[];
  /**
   * Nurse-to-nurse only — there is no head-nurse approval gate.
   * sent -> received -> accepted | declined -> completed. Only the receiving
   * nurse can move a referral past 'sent' (see acknowledge/accept/decline/
   * complete in api/nurselink.ts); status itself is read-only server-side.
   */
  status: 'sent' | 'received' | 'accepted' | 'declined' | 'completed';
  statusHistory?: { status: string; by: string | null; byName: string; at: string | null; note?: string }[];
  acceptedAt?: string | null;
  declinedAt?: string | null;
  declinedReason?: string;
  completedAt?: string | null;
  /** Task codes moved onto the accepting nurse's list. Returned by accept only. */
  adoptedTasks?: string[];
}

export interface ChartingNote {
  id: string;
  patientId: string;
  patientName: string;
  nurseId: string;
  nurseName: string;
  timestamp: string;
  type: 'progress' | 'assessment' | 'medication' | 'vital_signs';
  content: string;
  aiGenerated: boolean;
  edited: boolean;
  attendingPhysician?: string;
  editHistory: {
    editedBy: string;
    editedAt: string;
    changes: string;
  }[];
}

export interface WorkloadData {
  nurseId: string;
  nurseName: string;
  shift: string;
  department: string;
  patientCount: number;
  taskCount: number;
  completedTasks: number;
  overtimeHours: number;
  burnoutRisk: 'low' | 'medium' | 'high';
}

export interface Nurse {
  id: string;
  name: string;
  role: 'RN' | 'LPN' | 'Charge Nurse' | 'Clinical Nurse Specialist' | string;
  shift: 'morning' | 'afternoon' | 'night' | string;
  specialization?: string;
  email?: string;
  department?: string;
  burnoutRisk?: string;
  overtimeHours?: number;
  patientCount?: number;
  taskCount?: number;
  completedTasks?: number;
}

/** A candidate recipient for a referral — see EligibleReferralRecipients.
 * Deliberately a smaller shape than Nurse: every entry here already
 * matches the signed-in nurse's department and the next shift, so there's
 * nothing left to filter or display beyond who they are. */
export interface EligibleReferralRecipient {
  id: string;
  name: string;
  role: string;
  specialization: string;
  email: string;
}

/** GET /handovers/eligible-recipients/ — who the signed-in nurse may refer
 * to right now, per the shift-rotation rule (see api/referral_shifts.py).
 * onDuty is false (and recipients empty) when they have no active Duty
 * Roster shift right now. */
export interface EligibleReferralRecipients {
  onDuty: boolean;
  currentShift: 'morning' | 'afternoon' | 'night' | null;
  currentShiftLabel: string | null;
  departmentId: number | null;
  departmentName: string;
  nextShift: 'morning' | 'afternoon' | 'night' | null;
  nextShiftLabel: string | null;
  nextShiftDate: string | null;
  recipients: EligibleReferralRecipient[];
}

export interface AppNotification {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  time: string;
  patient?: string;
  isRead: boolean;
  action?: {
    label: string;
    path: string;
    highlightId?: string;
  };
}

export interface PatientAssignmentRecord {
  id: string;
  patientId: string;
  patientName: string;
  room: string;
  ward: string;
  diagnosis: string;
  assignedNurse: string;
  assignedNurseId: string;
  priority: 'urgent' | 'routine';
  notes: string;
  status: 'active' | 'completed' | 'reassigned';
  assignedAt: string;
  updatedAt: string;
  attendingPhysician?: string;
}

export interface KardexHistory {
  id: string;
  /** The Patient this kardex is linked to — populated even for a brand-new
   * patient, so the caller can act on them (e.g. Laboratories/Medication
   * Intake) right after. */
  patientCode?: string | null;
  patientName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  age: string;
  gender: string;
  /** String on the wire like every other Kardex form field, even though the
   * backend stores/validates them numerically — see utils/bmi.ts. */
  heightCm?: string;
  weightKg?: string;
  bmi?: number | null;
  /** The linked patient's current labs/medication orders — not a snapshot
   * of what this particular append-only kardex saw. */
  laboratories?: LabEntry[];
  medicationOrders?: MedicationOrder[];
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  temperature: string;
  pulseRate: string;
  respiratoryRate: string;
  bloodPressure: string;
  oxygenSaturation: string;
  specialEndorsements: string;
  savedAt: string;
  savedBy: string;
  status: 'submitted' | 'approved' | 'returned' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string;
}

/** One possible-duplicate match returned when registering a patient collides with an existing one. */
export interface DuplicatePatientMatch {
  patientId: string;
  name: string;
  age: number;
  gender: string;
  room: string;
  admissionDate: string | null;
}

/** One row in the admin interface's account list — see AdminUserViewSet. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'staff_nurse' | 'head_nurse';
  department: string;
  licenseNumber: string;
  hospitalName: string;
  employeeId: string;
  clinicalRole: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason: string;
  isActiveStaff: boolean;
  verificationMethod: string;
  dateJoined: string | null;
}

export interface AnalyticsData {
  taskCompletion: { value: number; label: string; frontColor?: string }[];
  workloadTrend: { value: number; label: string }[];
  avgTasks: { value: number }[];
  delayData: { value: number; label: string }[];
  taskTypes: { value: number; color: string; text: string; label?: string }[];
  burnout: { value: number; label: string; frontColor?: string }[];
  kpis: {
    completionRate: number;
    avgResponseMinutes: number;
    overdueTasks: number;
    activeNurses: number;
    avgPatientsPerNurse: number;
    totalTasks: number;
    completedTasks: number;
  };
}
