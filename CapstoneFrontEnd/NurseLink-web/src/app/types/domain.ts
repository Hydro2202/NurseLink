/** Domain types shared by API services and screens (replaces mockData types). */

/** Risk level — separate from Task.status, which tracks whether it's done. */
export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueTime: string;
  /** "YYYY-MM-DD" — paired with dueTime, required on create (the backend
   * rejects a task without both). Optional only for a task predating this
   * field. */
  dueDate?: string | null;
  assignedTo: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  category: 'medication' | 'vital_signs' | 'care' | 'assessment' | 'documentation';
  createdAt: string;
  completedAt?: string;
  attendingPhysician?: string;
  patientRoom?: string;
  doctorOrder?: string;
  checklist: TaskChecklistItem[];
  /** Numeric Department id — the API accepts/returns it as a number. */
  departmentId?: string | number | null;
  departmentName?: string;
  /** Read-only, populated by the backend from TaskDoctor. To change who's
   * assigned, submit `doctorIds` instead — see createTask/updateTask. */
  assignedDoctors?: TaskDoctorAssignment[];
  /** Write-only on create/update: the full set of doctor ids for this task. */
  doctorIds?: number[];
  /** Readings needed before a vital_signs task's checklist step can be
   * ticked — 1 for a task generated from the Kardex-interval schedule, 2
   * for a free-standing one (see Task.vital_readings_required). */
  vitalReadingsRequired?: number;
  /** Read-only, denormalized from the patient's active VitalSignsSchedule
   * (or the schedule that generated this task) — see
   * Task.vitals_monitoring_order. */
  vitalsMonitoringOrder?: VitalsMonitoringOrder;
}

/** The 5 values Edit Patient Information's "Vital Signs Monitoring (as
 * ordered)" dropdown can save — see Patient.vitals_monitoring_order.
 * 'not_specified' isn't a stored value on the backend, just the absence of
 * an active VitalSignsSchedule row; selecting it ends the active one. */
export type VitalsMonitoringOrder = 'every_1h' | 'every_2h' | 'every_4h' | 'prn' | 'not_specified';

export interface TaskChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskDoctorAssignment {
  id: number;
  name: string;
  specialization: string;
  departmentName?: string;
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

/** One timestamped vitals reading — see the backend's VitalSignsSerializer.
 * Insert-only: never edited after the fact. */
export interface VitalReading {
  id: number;
  patientId: string;
  /** Set when logged as a timed check-in on a 'vital_signs' category Task. */
  taskId?: string | null;
  heartRate: number | null;
  bloodPressure: string;
  temperature: number | null;
  oxygenSaturation: number | null;
  respiratoryRate: number | null;
  /** Null means not recorded, not "no". */
  oxygenUse: boolean | null;
  painScale: number | null;
  source: string;
  notes: string;
  recordedById: number | null;
  recordedByName: string | null;
  recordedAt: string;
  createdAt: string;
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
  /** Discharge audit trail — set by the head-nurse-only discharge action. */
  dischargedAt?: string | null;
  dischargedByName?: string | null;
  /** Nurse who assigned assignedNurseName to this patient. */
  assignedBy?: string | null;
  /** Whoever is actually on shift right now for this patient's department,
   * per the Duty Roster — distinct from the static assignedNurseName. */
  onDutyNurseId?: string | null;
  onDutyNurseName?: string | null;
  /** {editedBy, editedAt, changes} entries — see PatientSerializer.update(). */
  editHistory?: { editedBy: string; editedAt: string; changes: string[] }[];
  lastEditedAt?: string | null;
  lastEditedByName?: string | null;
  /** The physician's order for how often vital signs must be taken — see
   * api/vitals_schedule.py's current_monitoring_order()/set_monitoring_order().
   * Read on every Patient GET; settable via a PATCH that includes it. */
  vitalsMonitoringOrder?: VitalsMonitoringOrder;
}

/** One row of a patient's vitals-monitoring history — see
 * PatientViewSet._vitals_schedule_row(). */
export interface VitalsScheduleRow {
  id: number;
  mode: 'scheduled' | 'prn';
  frequencyHours: 1 | 2 | 4 | null;
  frequencyLabel: string;
  startAt: string;
  basis: string;
  setBy: string;
  setAt: string;
  endedAt: string | null;
  endedBy: string;
  endReason: string;
}

/** The active row also carries monitoring-status fields the history rows
 * don't — see PatientViewSet._vitals_schedule_response()/schedule_summary(). */
export interface VitalsScheduleActive extends VitalsScheduleRow {
  nextCheckAt: string | null;
  lastCheckAt: string | null;
  overdueChecks: number;
  monitoringStatus: 'on_schedule' | 'overdue' | 'prn';
}

export interface VitalsScheduleResponse {
  patientId: string;
  active: VitalsScheduleActive | null;
  history: VitalsScheduleRow[];
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
  /** Comma-separated 24h "HH:MM" list, e.g. "08:00, 16:00, 00:00" — built
   * by a time-picker-plus-chips UI, not free text. Blank is fine (e.g. PRN). */
  scheduledTimes?: string;
  startDate: string;
  endDate?: string | null;
  /** The prescribing doctor's display name — chosen from a dropdown (the
   * patient's attending physician and Kardex care team first), but still
   * just a name string; no doctor FK. Blank on create defaults server-side
   * to the patient's attending physician. */
  prescribedBy?: string;
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
  /** ISO datetime this referral needs to be acted on by. Required on
   * create (the backend rejects a missing or past value); optional/null
   * only for referrals created before this field existed. */
  dueAt?: string | null;
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

export interface ChartingHistoryDate {
  date: string;
  count: number;
  isToday: boolean;
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

export interface WorkloadData {
  nurseId: string;
  nurseName: string;
  /** Disambiguates same-named nurses — several accounts on a ward can share
   * a display name, so the name alone is not enough to tell them apart. */
  nurseEmail: string;
  shift: string;
  department: string;
  patientCount: number;
  taskCount: number;
  completedTasks: number;
  overtimeHours: number;
  burnoutRisk: 'low' | 'medium' | 'high';
  presence?: NursePresence;
  lastSeenAt?: string | null;
}

/** Logged-in-and-using-the-app right now — distinct from `shift`, which is
 * about the Duty Roster, not whether the app is open. */
export type NursePresence = 'online' | 'away' | 'offline';

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
  presence?: NursePresence;
  lastSeenAt?: string | null;
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

/** Why `recipients` came back empty (see api/referral_shifts.py). Null
 * whenever recipients is non-empty. A code, never display text — see
 * emptyReferralMessage in HandoverModal for the wording. Treat any string
 * not in this list the same as null-but-still-empty (a generic fallback),
 * so an older/newer API version can't break the UI. */
export type EmptyReferralReason =
  | 'user_off_duty'
  | 'no_next_shift_staff'
  | 'only_self_scheduled'
  | 'no_eligible_nurse_on_next_shift';

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
  emptyReason: EmptyReferralReason | null;
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
  /** ISO 'YYYY-MM-DD' (or '' when not entered) — free-text CharField on the
   * backend, same as mobile. Optional here only because records saved
   * before web sent it may still be typed loosely elsewhere. */
  birthday?: string;
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  ivf?: string;
  /** Also copied onto the linked Patient's allergies by
   * KardexRecordSerializer.create(). */
  allergies?: string[];
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

export type DutyShift = 'morning' | 'afternoon' | 'night';
export type DutyStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface DutyAssignment {
  id: number;
  nurseId: string;
  nurseName: string;
  /** Logged-in-and-using-the-app right now — distinct from this row's own
   * shift/status, which are about the roster, not whether the app is open. */
  nursePresence?: NursePresence;
  nurseLastSeenAt?: string | null;
  departmentId: number;
  departmentName: string;
  dutyDate: string;
  /** Real window in the hospital's timezone, from the server. A Night shift
   * dated Oct 2 ends on Oct 3 — use these instead of recombining
   * dutyDate + time locally. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  scheduleStatus?: 'upcoming' | 'current' | 'past';
  scheduleWindowLabel?: string;
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
  /** Real attendance — null until the nurse clocks in/out. */
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

/** A shift-to-shift task handoff (distinct from HandoverNote, the SBAR
 * referral) — see TaskHandoverSerializer. Read-only here: the Admin panel
 * only browses these for oversight, the real send/accept/verify flow lives
 * elsewhere. */
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

/** A signup wizard's identity-verification progress — the evidence behind
 * an approve/reject decision on an AdminUser. Read-only. */
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
 * history. Never carries raw images. */
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

/**
 * M.E.T.H.O.D. discharge plan — Medications, Environment, Treatment, Health
 * Teaching, Outpatient Referral, Diet. Filled in as part of discharging a
 * patient and attached to that visit; completedByName/completedAt mirror
 * PatientVisit.dischargedByName/dischargeDate.
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
