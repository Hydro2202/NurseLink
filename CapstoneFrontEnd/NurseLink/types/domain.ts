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
  /** Numeric Department id — kept a string here since every other id in this
   * app's frontend is a string; the API accepts/returns it as a number. */
  departmentId?: string;
  departmentName?: string;
  /** Read-only, populated by the backend from TaskDoctor. To change who's
   * assigned, submit `doctorIds` instead — see createTask/updateTask. */
  assignedDoctors?: TaskDoctorAssignment[];
  /** Write-only on create/update: the full set of doctor ids for this task. */
  doctorIds?: number[];
}

export interface TaskChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskDoctorAssignment {
  id: number;
  name: string;
  specialization: string;
  /** Only present on Patient.assignedDoctors — a task's doctors are already
   * scoped to one department, so TaskSerializer omits it there. */
  departmentName?: string;
}

export interface Department {
  id: number;
  name: string;
}

export interface Doctor {
  id: number;
  fullName: string;
  specialization: string;
  departmentId: number;
  departmentName: string;
  licenseNumber: string;
  status: 'active' | 'inactive';
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
  attendingPhysician?: string;
  status?: 'admitted' | 'observation' | 'discharged';
  statusLabel?: string;
  departmentId?: number | null;
  departmentName?: string;
  dischargedAt?: string | null;
  dischargedByName?: string | null;
  assignedNurseId?: string | null;
  assignedNurseName?: string | null;
  /** Nurse who assigned assignedNurseName to this patient (usually whoever added them via Kardex). */
  assignedBy?: string | null;
  /** This patient's Kardex-assigned doctors, across every department — see PatientDoctor. */
  assignedDoctors?: TaskDoctorAssignment[];
  /** Whoever is actually on shift right now for this patient's department, per the
   * Duty Roster — distinct from assignedNurseId/assignedNurseName (the static
   * day-to-day care assignment). Null when nobody is currently scheduled, or the
   * patient has no department set. */
  onDutyNurseId?: string | null;
  onDutyNurseName?: string | null;
  /** {editedBy, editedAt, changes} entries — see PatientSerializer.update(). */
  editHistory?: { editedBy: string; editedAt: string; changes: string[] }[];
  lastEditedAt?: string | null;
  lastEditedByName?: string | null;
}

/**
 * M.E.T.H.O.D. discharge plan — Medications, Environment, Treatment, Health
 * Teaching, Outpatient Referral, Diet. Filled in as part of discharging a
 * patient (see PatientViewSet.discharge) and attached to that visit;
 * completedByName/completedAt mirror PatientVisit.dischargedByName/
 * dischargeDate since both happen at the same moment.
 */
export interface DischargePlan {
  medications: string;
  environment: string;
  treatment: string;
  healthTeaching: string;
  outpatientReferral: string;
  diet: string;
  aiGenerated: boolean;
  completedByName: string | null;
  completedAt: string | null;
}

/** One admission-to-discharge encounter under a Patient profile — never
 * overwritten by a later visit; see PatientVisit on the backend. */
export interface PatientVisit {
  id: number;
  admissionDate: string;
  dischargeDate: string | null;
  isActive: boolean;
  diagnosis: string;
  room: string;
  attendingPhysician: string;
  assignedNurseName: string | null;
  medicalTeam: { name: string; specialization: string; departmentName: string }[];
  dischargedByName: string | null;
  vitals: {
    id: number;
    recordedAt: string;
    heartRate: number | null;
    bloodPressure: string;
    temperature: number | null;
    oxygenSaturation: number | null;
    respiratoryRate: number | null;
    painScale: number | null;
    source: string;
  }[];
  notes: { id: string; timestamp: string; type: string; content: string }[];
  hasDischargePlan: boolean;
  dischargePlan: DischargePlan | null;
}

export interface HandoverNote {
  id: string;
  patientId: string;
  patientName: string;
  shift: 'morning' | 'afternoon' | 'night';
  date: string;
  nurseFrom: string;
  nurseTo: string;
  /** Account id of the receiving nurse. Write-only: sent on create, never returned. */
  nurseToId?: string;
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
   * complete in services/api.ts); status itself is read-only server-side.
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

export interface ChartingVitalSigns {
  heartRate?: string;
  bloodPressure?: string;
  temperature?: string;
  oxygenSaturation?: string;
  respiratoryRate?: string;
}

/** Section-by-section Auto Charting payload persisted with the note. */
export interface ChartingStructuredData {
  patientName?: string;
  patientId?: string;
  room?: string;
  date?: string;
  time?: string;
  attendingPhysician?: string;
  nurseName?: string;
  vitalSigns?: ChartingVitalSigns;
  assessment?: string;
  diagnosis?: string;
  riskLevel?: string;
  allergies?: string;
  medications?: string;
  alerts?: string;
  interventions?: string[];
  patientResponse?: string;
  clinicalSummary?: string;
  plan?: string;
  timestamp?: string;
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
  /** Persisted Auto Charting sections — used by View Full Note. */
  structured?: ChartingStructuredData | null;
  /** FDAR sections — populated (possibly as empty strings) when noteFormat is 'fdar'; blank for legacy notes. */
  focus?: string;
  data?: string;
  action?: string;
  response?: string;
  /** 'legacy' = pre-FDAR note, rendered read-only via StructuredNursingNote with a "Legacy Note" badge. Absent/undefined is treated as 'fdar'. */
  noteFormat?: 'fdar' | 'legacy';
  aiGenerated: boolean;
  edited: boolean;
  confirmed?: boolean;
  confirmedAt?: string | null;
  attendingPhysician?: string;
  editHistory: {
    editedBy: string;
    editedAt: string;
    changes: string;
  }[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ChartingHistoryDate {
  date: string;
  count: number;
  isToday: boolean;
}

export interface WorkloadData {
  nurseId: string;
  nurseName: string;
  /** Disambiguates same-named nurses — several accounts on this ward share a
   * display name, so the name alone is not enough to tell them apart. */
  nurseEmail: string;
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

export interface AppNotification {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  /** What happened. 'handover_received' is the one the app raises as a popup. */
  event?: string;
  title: string;
  message: string;
  time: string;
  /** ISO timestamp, for showing a clock time rather than "3 mins ago". */
  createdAt?: string;
  patient?: string;
  /** Patient code, when the notification refers to a real patient. */
  patientId?: string | null;
  /** Handover code, when it refers to a real referral. */
  handoverId?: string | null;
  /** Nurse who caused it. */
  senderName?: string | null;
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

export type DutyShift = 'morning' | 'afternoon' | 'night';
export type DutyStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface DutyAssignment {
  id: number;
  nurseId: string;
  nurseName: string;
  departmentId: number;
  departmentName: string;
  dutyDate: string;
  shift: DutyShift;
  shiftLabel: string;
  startTime: string;
  endTime: string;
  regularHours: number;
  overtimeStart: string | null;
  overtimeEnd: string | null;
  overtimeHours: number;
  totalHours: number;
  status: DutyStatus;
  statusLabel: string;
  notes: string;
  /** Real attendance — null until the nurse taps Start/End Shift. */
  actualStartTime: string | null;
  actualEndTime: string | null;
  actualWorkedHours: number;
  actualOvertimeHours: number;
  /** Set only when a head nurse closes out a shift the nurse never ended themselves. */
  actualEndRecordedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KardexHistory {
  id: string;
  /** The Patient this kardex is linked to — populated even for a brand-new
   * patient, so the caller can act on them (e.g. assign doctors) right after. */
  patientCode?: string | null;
  patientName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  age: string;
  gender: string;
  birthday: string;
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  ivf: string;
  allergies: string[];
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
  /** A 'discharged' match is a readmission candidate — see readmitPatient() —
   * not necessarily a true duplicate the way an active match is. */
  status?: 'admitted' | 'observation' | 'discharged';
  statusLabel?: string;
}

/** A shift-to-shift task handoff (distinct from the SBAR HandoverNote) —
 * see TaskHandoverSerializer. Read-only here; the Admin panel only browses
 * these for oversight, the actual send/accept/verify flow lives elsewhere. */
export interface AdminTaskHandover {
  id: string;
  taskId: number | null;
  taskTitle: string;
  taskDescription: string;
  fromNurseId: number;
  fromNurseName: string;
  toNurseId: number;
  toNurseName: string;
  departmentId: number | null;
  departmentName: string;
  shift: string;
  shiftLabel: string;
  dutyDate: string;
  notes: string;
  status: 'pending' | 'accepted' | 'verified' | 'rejected';
  statusLabel: string;
  supervisorId: number | null;
  supervisorName: string;
  verifiedAt: string | null;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
}

/** One timestamped vitals reading — see VitalSignsSerializer. Insert-only. */
export interface AdminVitalReading {
  id: number;
  patientId: string;
  /** Set when this reading was logged as one of the timed check-ins on a
   * 'vital_signs' category Task — see TaskVitalSignsBars. Null for readings
   * logged outside that flow (Kardex admission vitals, ad-hoc ones). */
  taskId?: string | null;
  heartRate: number | null;
  bloodPressure: string;
  temperature: number | null;
  oxygenSaturation: number | null;
  respiratoryRate: number | null;
  /** On supplemental O2 at the time of this reading. Null means not
   * recorded, not "no". */
  oxygenUse: boolean | null;
  painScale: number | null;
  source: string;
  notes: string;
  recordedById: number | null;
  recordedByName: string | null;
  recordedAt: string;
  createdAt: string;
}

/** One nurse or head nurse account, as the Admin Accounts screen manages
 * it — backed by AdminUserViewSet. Never includes another admin account
 * (an admin User has no NurseProfile, so this list can't include one). */
export interface AdminAccount {
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

/** A signup wizard's identity-verification progress — the evidence behind
 * an approve/reject decision on an AdminAccount. Read-only. */
export interface AdminRegistrationSession {
  id: number;
  sessionId: string;
  email: string;
  faceAttempts: number;
  faceVerified: boolean;
  faceLocked: boolean;
  otpVerified: boolean;
  verificationMethod: string;
  prcVerified: boolean;
  prcLicenseNumber: string;
  prcFullName: string;
  prcProfession: string;
  idLastName: string;
  idFirstName: string;
  idMiddleName: string;
  idRegistrationNo: string;
  idVerificationStatus: string;
  isVerified: boolean;
  userId: string | null;
  userEmail: string;
  createdAt: string;
  updatedAt: string;
}

/** One face-match attempt within a registration session's verification
 * history. Never carries raw images — see the backend model docstring. */
export interface AdminFaceVerificationAttempt {
  id: number;
  sessionId: string;
  matched: boolean;
  confidence: number;
  reason: string;
  reasonLabel: string;
  countable: boolean;
  createdAt: string;
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
