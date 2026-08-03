import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PatientAssignment {
  patientId: string;
  nurseId: string;
  nurseName: string;
  assignedAt: string;
  attendingPhysician?: string;
}

const STORAGE_KEY = 'nurselink_patient_assignments';

export const getPatientAssignments = async (): Promise<PatientAssignment[]> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error parsing patient assignments:', e);
  }
  return [];
};

export const savePatientAssignments = async (assignments: PatientAssignment[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch (e) {
    console.error('Error saving patient assignments:', e);
  }
};

export const addPatientAssignment = async (
  assignment: Omit<PatientAssignment, 'assignedAt'>
): Promise<void> => {
  const assignments = await getPatientAssignments();
  const existingIndex = assignments.findIndex((a) => a.patientId === assignment.patientId);

  const newAssignment: PatientAssignment = {
    ...assignment,
    assignedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    assignments[existingIndex] = newAssignment;
  } else {
    assignments.push(newAssignment);
  }

  await savePatientAssignments(assignments);
};

export const removePatientAssignment = async (patientId: string): Promise<void> => {
  const assignments = await getPatientAssignments();
  const filtered = assignments.filter((a) => a.patientId !== patientId);
  await savePatientAssignments(filtered);
};

export const getAssignmentsForNurse = async (nurseName: string): Promise<PatientAssignment[]> => {
  const assignments = await getPatientAssignments();
  return assignments.filter((a) => a.nurseName === nurseName);
};

export const getAssignmentForPatient = async (
  patientId: string
): Promise<PatientAssignment | undefined> => {
  const assignments = await getPatientAssignments();
  return assignments.find((a) => a.patientId === patientId);
};

export const initializeDefaultAssignments = async (): Promise<void> => {
  const existing = await getPatientAssignments();

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

    await savePatientAssignments(defaultAssignments);
  }
};

export const clearAllAssignments = async (): Promise<void> => {
  await AsyncStorage.removeItem(STORAGE_KEY);
};
