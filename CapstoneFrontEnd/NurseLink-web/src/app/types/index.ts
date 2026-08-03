// User Roles and Hierarchy
export type UserRole = 'chief_nurse' | 'supervisor' | 'head_nurse' | 'oic' | 'staff_nurse';

export interface User {
  id: string;
  name: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  role: UserRole;
  department: string;
  licenseNumber?: string;
  avatar?: string;
  createdAt: string;
}

// Patient Information
export interface Patient {
  id: string;
  // Full Name
  firstName: string;
  middleName: string;
  lastName: string;
  // Demographics
  age: number;
  gender: 'Male' | 'Female';
  religion?: string;
  // Hospital Details
  room: string;
  bedNumber?: string;
  attendingPhysician: string;
  // Medical Information
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis?: string;
  finalDisposition?: string;
  admissionDate: string;
  dischargeDate?: string;
  riskLevel: 'low' | 'medium' | 'high';
  // Clinical Data
  vitalSigns: VitalSigns;
  allergies: Allergy[];
  medications: Medication[];
  ivFluids: IVFluid[];
  diet?: string;
  operations?: Operation[];
  procedures?: Procedure[];
  labResults?: LabResult[];
  imaging?: ImagingResult[];
  bloodRequests?: BloodRequest[];
  alerts: string[];
  specialEndorsements?: string[];
}

// Vital Signs
export interface VitalSigns {
  temperature: number; // Celsius
  pulseRate: number; // bpm
  respiratoryRate: number; // breaths per minute
  bloodPressure: string; // e.g., "120/80"
  oxygenSaturation: number; // percentage
  weight?: number; // kg
  height?: number; // cm
  fetalHeartTone?: number; // for pregnant patients, bpm
  recordedAt: string;
  recordedBy: string;
}

// Allergy Information
export interface Allergy {
  allergen: string;
  reaction: string;
  severity: 'Mild' | 'Moderate' | 'Severe';
}

// Medication
export interface Medication {
  id: string;
  name: string;
  dosage: string;
  route: string; // e.g., PO, IV, IM, SC
  frequency: string;
  startDate: string;
  endDate?: string;
  prescribedBy: string;
  notes?: string;
}

// IV Fluids
export interface IVFluid {
  id: string;
  solution: string; // e.g., "D5LR 1L"
  rate: string; // e.g., "80 cc/hr"
  startDate: string;
  endDate?: string;
  site?: string;
  orderedBy: string;
}

// Operations
export interface Operation {
  id: string;
  name: string;
  date: string;
  surgeon: string;
  notes?: string;
}

// Procedures
export interface Procedure {
  id: string;
  name: string;
  date: string;
  performedBy: string;
  notes?: string;
}

// Lab Results
export interface LabResult {
  id: string;
  testName: string;
  result: string;
  normalRange?: string;
  date: string;
  status: 'Pending' | 'Completed' | 'Critical';
}

// Imaging Results (X-ray, ECG, etc.)
export interface ImagingResult {
  id: string;
  type: 'X-ray' | 'ECG' | 'CT Scan' | 'MRI' | 'Ultrasound';
  bodyPart?: string;
  findings: string;
  date: string;
  interpretedBy?: string;
}

// Blood Requests/Transfusion
export interface BloodRequest {
  id: string;
  bloodType: string;
  units: number;
  purpose: string;
  requestDate: string;
  transfusionDate?: string;
  status: 'Requested' | 'Available' | 'Transfused' | 'Cancelled';
}

// Doctor's Order
export interface DoctorOrder {
  id: string;
  patientId: string;
  patientName: string;
  orderType: 'Medication' | 'Lab' | 'Imaging' | 'Procedure' | 'Diet' | 'Activity' | 'Other';
  orderDetails: string;
  specialNotes?: string;
  orderedBy: string;
  orderedDate: string;
  priority: 'Routine' | 'Urgent' | 'STAT';
  status: 'Active' | 'Completed' | 'Discontinued';
  discontinuedBy?: string;
  discontinuedDate?: string;
}

// Admission Record
export interface AdmissionRecord {
  id: string;
  patientId: string;
  admissionDate: string;
  admissionTime: string;
  admittedBy: string;
  admittedFrom: 'ER' | 'OPD' | 'Transfer' | 'Direct Admission';
  chiefComplaint: string;
  admittingDiagnosis: string;
  vitalSignsOnAdmission: VitalSigns;
  initialOrders?: string;
  notes?: string;
}

// Discharge Record
export interface DischargeRecord {
  id: string;
  patientId: string;
  dischargeDate: string;
  dischargeTime: string;
  dischargedBy: string;
  finalDiagnosis: string;
  finalDisposition: 'Home' | 'Transferred' | 'HAMA' | 'Expired' | 'Absconded';
  dischargeInstructions?: string;
  followUpDate?: string;
  medications?: string[];
  notes?: string;
}

// Kardex (Patient Summary)
export interface Kardex {
  patientId: string;
  patient: Patient;
  currentOrders: DoctorOrder[];
  recentVitalSigns: VitalSigns[];
  activeMedications: Medication[];
  activeIVFluids: IVFluid[];
  pendingLabs: LabResult[];
  pendingImaging: ImagingResult[];
  activeBloodRequests: BloodRequest[];
  lastUpdated: string;
}

// Tasks
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
}

// Handover Note (SBAR)
export interface HandoverNote {
  id: string;
  patientId: string;
  patientName: string;
  shift: 'morning' | 'afternoon' | 'night';
  date: string;
  nurseFrom: string;
  nurseTo: string;
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  status: 'draft' | 'submitted' | 'received';
  createdAt: string;
}

// Chart/Nursing Notes
export interface NursingNote {
  id: string;
  patientId: string;
  patientName: string;
  noteType: 'Progress' | 'Assessment' | 'Incident' | 'Discharge Planning';
  content: string;
  recordedBy: string;
  recordedAt: string;
  shiftTime: 'Morning' | 'Afternoon' | 'Night';
}
