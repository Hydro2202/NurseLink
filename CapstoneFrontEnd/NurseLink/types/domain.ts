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
  /** Free text, e.g. "08:00, 16:00, 00:00". */
  scheduledTimes?: string;
  startDate: string;
  endDate?: string | null;
  /** Defaults server-side to the patient's attending physician when left blank on create. */
  prescribedBy?: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'DISCONTINUED';
  /** Derived from `status` (true only while ACTIVE) — read-only, kept for
   * backward compat with code written before `status` existed. */
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

/** One required department visit for a patient's Kardex — a place they
 * must go to (Radiology, the Laboratory, Dialysis, PT, OR, a CT scan). See
 * api/models.py's KardexDepartmentVisit. Linked to the patient for the
 * same reason LabEntry/MedicationOrder are. */
export interface DepartmentVisit {
  id: number;
  departmentId: number;
  departmentName: string;
  purpose: string;
  scheduledDatetime?: string | null;
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  preparationNotes: string;
  status: 'PENDING' | 'SCHEDULED' | 'DONE' | 'CANCELLED';
  orderedBy?: string;
  completedAt?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  updatedByName?: string | null;
  updatedByRole?: string | null;
  createdAt: string;
  updatedAt: string;
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
  /** Anthropometric, not part of vitalSigns above — see api/models.py's
   * compute_bmi(). null/undefined when not recorded; bmi is server-computed
   * and read-only. */
  heightCm?: number | null;
  weightKg?: number | null;
  bmi?: number | null;
  /** Kardex Laboratories / Medication Intake sections — read-only here;
   * add/edit through the dedicated lab/medication/intake endpoints (see
   * services/api.ts), not by re-saving the Kardex form. */
  laboratories?: LabEntry[];
  medicationOrders?: MedicationOrder[];
  /** Required Department Visits — read-only here; add/edit through the
   * dedicated department-visit endpoints (see services/api.ts). */
  departmentVisits?: DepartmentVisit[];
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

/** One Unfinished Tasks entry on an endorsement, as the backend returns it. */
export interface EndorsementTaskOutput {
  id: number;
  description: string;
  dueTime: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
}

/** Write shape for one Unfinished Tasks entry on create — see `tasks` on
 * HandoverNote below. A blank description is dropped server-side, not an error. */
export interface EndorsementTaskInput {
  description: string;
  due_time?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface HandoverNote {
  id: string;
  /** The endorsement's one patient — kept as `patientId`/`patientName` for
   * backward compat with the legacy single-patient Referral shape; an
   * Endorsement (isEndorsement: true) always has exactly one entry in
   * `patients` too. */
  patientId: string;
  patientName: string;
  /** Write-only: send exactly one patient code to create an Endorsement
   * (any shift/department) rather than a legacy single-patient referral —
   * zero or more than one is rejected. */
  patientIds?: string[];
  /** Write-only: optional note for the one patient in patientIds, keyed by its code. */
  patientNotes?: Record<string, string>;
  /** The authoritative patient (one entry) for this record. Read-only. */
  patients?: { patientId: string; patientName: string; notes: string }[];
  /** True only for a record created via patientIds (a real Endorsement) —
   * false for a legacy single-patient referral. Read-only. */
  isEndorsement?: boolean;
  /** Write-only on create: any number of unfinished-work items, created
   * with the endorsement in the same transaction — optional, zero is
   * valid. Read-only elsewhere (see EndorsementTaskOutput): the real,
   * saved list, included in detail/sent/received responses. */
  tasks?: EndorsementTaskInput[] | EndorsementTaskOutput[];
  /**
   * Endorser's shift/department at creation time — a descriptive audit
   * snapshot only, never a gate (any shift/department is allowed). Blank
   * if the endorser was off duty. Read-only.
   */
  shift: 'morning' | 'afternoon' | 'night' | '';
  shiftLabel?: string;
  /** Receiver's shift snapshot at creation time, same mechanism as `shift`. Read-only. */
  toShift?: 'morning' | 'afternoon' | 'night' | '';
  toShiftLabel?: string;
  /** Unused by new endorsements (always null) — legacy rotation-rule field. */
  shiftDate?: string | null;
  /** The endorser's department at creation time. Read-only. */
  departmentId?: number | null;
  departmentName?: string;
  /** The receiver's department at creation time. Read-only. */
  toDepartmentId?: number | null;
  toDepartmentName?: string;
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
   * sent -> received -> accepted | declined | cancelled -> completed. Only
   * the receiving nurse can move a referral past 'sent' (see
   * acknowledge/accept/decline/complete in services/api.ts); status itself
   * is read-only server-side. Kept at its raw value for backward compat —
   * see `endorsementStatus` for the Endorsement-facing translation.
   */
  status: 'sent' | 'received' | 'accepted' | 'declined' | 'cancelled' | 'completed';
  /** PENDING/ACCEPTED/REJECTED/CANCELLED — the caller-facing translation of
   * `status` for the Endorsement API. Read-only. */
  endorsementStatus?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  statusHistory?: { status: string; by: string | null; byName: string; at: string | null; note?: string }[];
  acceptedAt?: string | null;
  declinedAt?: string | null;
  declinedReason?: string;
  /** Alias of declinedReason, under the Endorsement-facing name. Read-only. */
  rejectionReason?: string;
  completedAt?: string | null;
  /** Task codes moved onto the accepting nurse's list. Returned by accept
   * only, and only for a legacy single-patient referral — a bulk
   * Endorsement transfers patients instead; see services/api.ts. */
  adoptedTasks?: string[];
}

/** A candidate receiver for an endorsement, within one shift group — see
 * EligibleReceiverGroup. Only a nurse with a real current/upcoming duty can
 * be a candidate at all — there is no "unassigned" shift here. */
export interface EligibleReceiver {
  id: string;
  fullName: string;
  department: { id: number | null; name: string };
  shift: 'morning' | 'afternoon' | 'night';
}

/** One shift bucket from GET /endorsements/eligible-receivers/ — Morning ->
 * Afternoon -> Night, always all three, even when `nurses` is empty. */
export interface EligibleReceiverGroup {
  shift: {
    id: 'morning' | 'afternoon' | 'night';
    name: string;
    startTime: string | null;
    endTime: string | null;
  };
  nurses: EligibleReceiver[];
}

/** A patient on the signed-in nurse's own list, from GET
 * /endorsements/my-patients/ — the same shape fetchPatients() returns, plus
 * pendingEndorsement. */
export interface EndorsablePatient extends Patient {
  pendingEndorsement: boolean;
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
}

export interface Nurse {
  id: string;
  name: string;
  role: 'RN' | 'LPN' | 'Charge Nurse' | 'Clinical Nurse Specialist' | string;
  /** Blank when the nurse has no duty on the roster. */
  shift: 'morning' | 'afternoon' | 'night' | string;
  hasDuty?: boolean;
  dutyDate?: string | null;
  specialization?: string;
  email?: string;
  department?: string;
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

export type DutyShift = 'morning' | 'afternoon' | 'night';
export type DutyStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface DutyAssignment {
  id: number;
  nurseId: string;
  nurseName: string;
  departmentId: number;
  departmentName: string;
  dutyDate: string;
  /** Real window in the hospital's timezone, from the server (api/models.py
   * schedule_status_at / schedule_window_label). A Night shift dated Oct 2
   * ends on Oct 3. Use these instead of recombining dutyDate + time locally. */
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
  /** String on the wire like every other Kardex form field (age, temperature,
   * etc.) even though the backend stores/validates them numerically — see
   * utils/bmi.ts for the shared parse/validate/compute logic. */
  heightCm?: string;
  weightKg?: string;
  bmi?: number | null;
  /** The linked patient's current labs/medication orders/department
   * visits — not a snapshot of what this particular append-only kardex saw. */
  laboratories?: LabEntry[];
  medicationOrders?: MedicationOrder[];
  departmentVisits?: DepartmentVisit[];
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
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  specialization?: string;
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
  /** The role picked at sign-up; approving applies it. */
  requestedRole?: string;
  roleGrantedBy?: string | null;
  roleGrantedAt?: string | null;
  dateJoined: string | null;
}

/** A sign-up as the admin Registrations screen shows it: what the applicant
 * entered (never the password) and whether their email was verified.
 * Read-only. Name/phone/role come from the created account, so they are
 * blank until the wizard's final step completes. */
export interface AdminRegistrationSession {
  id: number;
  sessionId: string;
  email: string;
  otpVerified: boolean;
  verificationMethod: string;
  isVerified: boolean;
  userId: string | null;
  userEmail: string;
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  phone: string;
  requestedRole: string;
  role: string;
  department: string;
  approvalStatus: string;
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
