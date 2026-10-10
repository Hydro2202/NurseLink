/**
 * Shared patient-card display helpers for AllPatientsPage and MyPatientsPage.
 * Ported verbatim (logic and thresholds) from the mobile app's
 * app/(app)/all-patients.tsx so both platforms flag the same readings.
 */
import type { Patient } from '../types/domain';

/** Groups a patient's Kardex-assigned doctors by department, so a card with
 * "Cardiology: Dr. A, Dr. B" reads as one line per department rather than
 * one line per doctor. */
export function groupDoctorsByDepartment(
  patient: Pick<Patient, 'assignedDoctors'>
): { department: string; doctors: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const doctor of patient.assignedDoctors || []) {
    const dept = doctor.departmentName || 'Unassigned Department';
    const names = groups.get(dept) || [];
    names.push(doctor.name);
    groups.set(dept, names);
  }
  return Array.from(groups.entries()).map(([department, doctors]) => ({ department, doctors }));
}

// Rough adult reference ranges — good enough to flag "worth a second look"
// on a roster card, not a clinical decision aid. 0/blank means "not
// recorded" (this codebase's convention for an unset vital), never flagged.
export type VitalSeverity = 'critical' | 'warning' | 'normal';

export function heartRateSeverity(hr: number | null | undefined): VitalSeverity {
  if (!hr) return 'normal';
  if (hr < 40 || hr > 150) return 'critical';
  if (hr < 60 || hr > 100) return 'warning';
  return 'normal';
}

export function temperatureSeverity(temp: number | null | undefined): VitalSeverity {
  if (!temp) return 'normal';
  if (temp >= 39.5 || temp < 35) return 'critical';
  if (temp >= 37.8 || temp < 36) return 'warning';
  return 'normal';
}

export function spo2Severity(spo2: number | null | undefined): VitalSeverity {
  if (!spo2) return 'normal';
  if (spo2 < 90) return 'critical';
  if (spo2 < 95) return 'warning';
  return 'normal';
}

export function bloodPressureSeverity(bp: string | null | undefined): VitalSeverity {
  const match = (bp || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return 'normal';
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  if (systolic >= 180 || systolic < 90 || diastolic >= 120 || diastolic < 60) return 'critical';
  if (systolic >= 140 || diastolic >= 90) return 'warning';
  return 'normal';
}

/** Tailwind classes per severity: container (bg + border) and text color. */
export const VITAL_SEVERITY_CLASSES: Record<VitalSeverity, { box: string; text: string }> = {
  critical: { box: 'bg-red-50 border-red-300', text: 'text-red-700' },
  warning: { box: 'bg-orange-50 border-orange-300', text: 'text-orange-700' },
  normal: { box: 'bg-blue-50 border-blue-100', text: 'text-gray-900' },
};

/** Today as YYYY-MM-DD in the browser's local timezone (not UTC — a
 * toISOString() slice would report yesterday's date before 8 AM in UTC+8). */
export function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
