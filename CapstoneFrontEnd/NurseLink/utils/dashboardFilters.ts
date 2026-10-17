/**
 * Shared filter state for the head nurse dashboard — one filter bar controls
 * the stat cards, the Workload section and the Analytics section together
 * (see FilterBar.tsx). Persisted so a head nurse's last choice is still
 * there when they come back (AsyncStorage here; localStorage on web — same
 * shape, see the NurseLink-web twin of this file).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Patient, Task } from '../types/domain';

export type DateRangePreset = 'today' | '7d' | '30d' | 'custom';

export interface DashboardFilters {
  datePreset: DateRangePreset;
  /** Only meaningful when datePreset === 'custom'. ISO 'YYYY-MM-DD'. */
  customStart: string;
  customEnd: string;
  /** Department id, or '' for All. */
  departmentId: string;
  /** '' | 'morning' | 'afternoon' | 'night'. */
  shift: string;
  /** Nurse (user) id, or '' for All. */
  nurseId: string;
  /** '' | 'low' | 'medium' | 'high' | 'critical'. */
  risk: string;
  search: string;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  datePreset: '7d',
  customStart: '',
  customEnd: '',
  departmentId: '',
  shift: '',
  nurseId: '',
  risk: '',
  search: '',
};

const STORAGE_KEY = 'dashboard_filters_v1';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/**
 * The explicit start_date/end_date to send the backend, or null for '7d' —
 * that preset is omitted entirely rather than sent explicitly, because it is
 * exactly AnalyticsView/WorkloadView's own unfiltered default (today and the
 * 6 days before it), so leaving it out keeps "Last 7 days" byte-identical to
 * "no date filter at all" instead of a redundant explicit duplicate of it.
 */
export function resolveDateRange(filters: DashboardFilters): { startDate: string; endDate: string } | null {
  const today = toIso(new Date());
  switch (filters.datePreset) {
    case 'today':
      return { startDate: today, endDate: today };
    case '30d':
      return { startDate: addDays(today, -29), endDate: today };
    case 'custom':
      if (!filters.customStart || !filters.customEnd) return null;
      return { startDate: filters.customStart, endDate: filters.customEnd };
    case '7d':
    default:
      return null;
  }
}

/** Query params (start_date/end_date/department/shift/nurse/risk) for
 * AnalyticsView/WorkloadView, omitting anything at its "All"/default value. */
export function toApiParams(filters: DashboardFilters): Record<string, string> {
  const params: Record<string, string> = {};
  const range = resolveDateRange(filters);
  if (range) {
    params.start_date = range.startDate;
    params.end_date = range.endDate;
  }
  if (filters.departmentId) params.department = filters.departmentId;
  if (filters.shift) params.shift = filters.shift;
  if (filters.nurseId) params.nurse = filters.nurseId;
  if (filters.risk) params.risk = filters.risk;
  return params;
}

export function activeFilterCount(filters: DashboardFilters): number {
  let count = 0;
  if (filters.datePreset !== DEFAULT_FILTERS.datePreset) count += 1;
  if (filters.departmentId) count += 1;
  if (filters.shift) count += 1;
  if (filters.nurseId) count += 1;
  if (filters.risk) count += 1;
  if (filters.search.trim()) count += 1;
  return count;
}

/**
 * Patients/tasks come from fetchPatients()/fetchTasks(), which this change
 * does not add backend filters to (only AnalyticsView/WorkloadView got
 * those) — so the stat cards apply the same filters client-side, over
 * whatever the dashboard already fetched. `shift` is deliberately not
 * applied here: a patient/task has no shift of its own, only the nurse
 * caring for them does, and that real (DutyAssignment-backed) resolution
 * already lives in WorkloadView/AnalyticsView — see FilterBar's own note.
 */
export function filterPatients(patients: Patient[], filters: DashboardFilters): Patient[] {
  const search = filters.search.trim().toLowerCase();
  return patients.filter((p) => {
    if (filters.departmentId && String(p.departmentId ?? '') !== filters.departmentId) return false;
    if (filters.risk && p.riskLevel !== filters.risk) return false;
    if (filters.nurseId && p.assignedNurseId !== filters.nurseId) return false;
    if (search && !`${p.name} ${p.room}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

export function filterTasks(
  tasks: Task[],
  filters: DashboardFilters,
  context: { patientById: Map<string, Patient>; nurseName?: string }
): Task[] {
  const search = filters.search.trim().toLowerCase();
  const range = resolveDateRange(filters);
  return tasks.filter((t) => {
    if (filters.departmentId && String(t.departmentId ?? '') !== filters.departmentId) return false;
    if (filters.risk) {
      const patient = context.patientById.get(t.patientId);
      if (!patient || patient.riskLevel !== filters.risk) return false;
    }
    if (filters.nurseId) {
      if (!context.nurseName || t.assignedTo !== context.nurseName) return false;
    }
    if (range) {
      const created = t.createdAt ? t.createdAt.slice(0, 10) : '';
      if (!created || created < range.startDate || created > range.endDate) return false;
    }
    if (search && !`${t.patientName} ${t.title}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

export async function loadSavedFilters(): Promise<DashboardFilters> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export async function saveFilters(filters: DashboardFilters): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Persistence is a convenience, not a requirement — a failed write just
    // means the filters reset to default next time, nothing to surface.
  }
}
