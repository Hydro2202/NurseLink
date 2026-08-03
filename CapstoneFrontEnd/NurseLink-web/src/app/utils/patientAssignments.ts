import { PatientAssignment } from '../pages/MyPatientsPage';

// Key for localStorage
const STORAGE_KEY = 'nurselink_patient_assignments';

/**
 * Get all patient assignments from localStorage
 */
export const getPatientAssignments = (): PatientAssignment[] => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Error parsing patient assignments:', e);
      return [];
    }
  }
  return [];
};

/**
 * Save patient assignments to localStorage
 */
export const savePatientAssignments = (assignments: PatientAssignment[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch (e) {
    console.error('Error saving patient assignments:', e);
  }
};

/**
 * Add a new patient assignment
 */
export const addPatientAssignment = (assignment: Omit<PatientAssignment, 'assignedAt'>): void => {
  const assignments = getPatientAssignments();
  
  // Check if assignment already exists
  const existingIndex = assignments.findIndex(
    a => a.patientId === assignment.patientId
  );
  
  const newAssignment: PatientAssignment = {
    ...assignment,
    assignedAt: new Date().toISOString(),
  };
  
  if (existingIndex >= 0) {
    // Update existing assignment
    assignments[existingIndex] = newAssignment;
  } else {
    // Add new assignment
    assignments.push(newAssignment);
  }
  
  savePatientAssignments(assignments);
};

/**
 * Remove a patient assignment
 */
export const removePatientAssignment = (patientId: string): void => {
  const assignments = getPatientAssignments();
  const filtered = assignments.filter(a => a.patientId !== patientId);
  savePatientAssignments(filtered);
};

/**
 * Get assignments for a specific nurse
 */
export const getAssignmentsForNurse = (nurseName: string): PatientAssignment[] => {
  const assignments = getPatientAssignments();
  return assignments.filter(a => a.nurseName === nurseName);
};

/**
 * Get assignment for a specific patient
 */
export const getAssignmentForPatient = (patientId: string): PatientAssignment | undefined => {
  const assignments = getPatientAssignments();
  return assignments.find(a => a.patientId === patientId);
};

/**
 * Initialize default patient assignments (for demo purposes)
 * This should be called once when the app loads
 */
export const initializeDefaultAssignments = (): void => {
  const existing = getPatientAssignments();
  
  // Only initialize if there are no existing assignments
  if (existing.length === 0) {
    const defaultAssignments: PatientAssignment[] = [
      {
        patientId: 'P001',
        nurseId: 'N001',
        nurseName: 'Sarah Johnson',
        assignedAt: new Date().toISOString(),
        attendingPhysician: 'Dr. Juan Dela Cruz',
      },
      {
        patientId: 'P002',
        nurseId: 'N001',
        nurseName: 'Sarah Johnson',
        assignedAt: new Date().toISOString(),
        attendingPhysician: 'Dr. Maria Santos',
      },
      {
        patientId: 'P003',
        nurseId: 'N001',
        nurseName: 'Sarah Johnson',
        assignedAt: new Date().toISOString(),
        attendingPhysician: 'Dr. Antonio Reyes',
      },
    ];
    
    savePatientAssignments(defaultAssignments);
  }
};

/**
 * Clear all patient assignments (for testing)
 */
export const clearAllAssignments = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};
