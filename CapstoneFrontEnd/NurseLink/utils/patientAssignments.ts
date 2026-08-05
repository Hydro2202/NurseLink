import {
  fetchAssignments,
  createAssignment,
  deleteAssignment,
} from '../services/api';
import type { PatientAssignmentRecord } from '../types/domain';

export type PatientAssignment = {
  patientId: string;
  nurseId: string;
  nurseName: string;
  assignedAt: string;
  attendingPhysician?: string;
};

export async function getPatientAssignments(): Promise<PatientAssignment[]> {
  const records = await fetchAssignments({ status: 'active' });
  return records.map((r) => ({
    patientId: r.patientId,
    nurseId: r.assignedNurseId,
    nurseName: r.assignedNurse,
    assignedAt: r.assignedAt,
    attendingPhysician: r.attendingPhysician,
  }));
}

export async function addPatientAssignment(
  assignment: Omit<PatientAssignment, 'assignedAt'>
): Promise<PatientAssignmentRecord> {
  return createAssignment({
    patientId: assignment.patientId,
    nurseId: assignment.nurseId,
    nurseName: assignment.nurseName,
  });
}

export async function removePatientAssignment(patientId: string): Promise<void> {
  const records = await fetchAssignments({ status: 'active' });
  const match = records.find((r) => r.patientId === patientId);
  if (match) {
    await deleteAssignment(match.id);
  }
}

export async function getAssignmentsForNurse(nurseName: string): Promise<PatientAssignment[]> {
  const all = await getPatientAssignments();
  return all.filter((a) => a.nurseName === nurseName);
}

export async function getAssignmentForPatient(
  patientId: string
): Promise<PatientAssignment | undefined> {
  const all = await getPatientAssignments();
  return all.find((a) => a.patientId === patientId);
}
