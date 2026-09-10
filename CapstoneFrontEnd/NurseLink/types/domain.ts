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
  status: 'pending' | 'acknowledged' | 'completed';
  /** Task codes moved onto the acknowledging nurse's list. Returned by acknowledge only. */
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
  /** Handover code, when it refers to a real handover. */
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
  /** Set only when a supervisor closes out a shift the nurse never ended themselves. */
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
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
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
