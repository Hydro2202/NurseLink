/** Config-driven read-only record browser for the Admin "Records" panel —
 * ported from mobile's app/(app)/admin/[section].tsx. Patients already has
 * its own dedicated, richer panel on web, so it's intentionally excluded
 * here (mobile's generic version of it is a strict subset of what web's
 * Patients panel already shows).
 */
import {
  fetchTasks,
  fetchHandovers,
  fetchTaskHandovers,
  fetchChartingNotes,
  fetchDutyAssignments,
  fetchKardexRecords,
  fetchVitalReadings,
  fetchDepartments,
} from '../api/nurselink';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline';

export interface RecordRow {
  key: string;
  title: string;
  badge?: { label: string; variant: BadgeVariant };
  meta: string[];
  search: string;
  raw: any;
}

export interface DetailField {
  label: string;
  value: string;
  multiline?: boolean;
}

export interface RecordFilter {
  key: string;
  label: string;
  options: { label: string; value: string }[];
  match: (raw: any, value: string) => boolean;
}

export interface RecordSectionConfig {
  title: string;
  description: string;
  fetch: () => Promise<unknown[]>;
  toRow: (item: any) => Omit<RecordRow, 'raw'>;
  detailFields?: (item: any) => DetailField[];
  filters?: (raws: any[]) => RecordFilter[];
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function yn(value: unknown): string {
  return value ? 'Yes' : 'No';
}

function joinOrDash(list: unknown): string {
  return Array.isArray(list) && list.length ? (list as string[]).join(', ') : '—';
}

const TASK_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'secondary', in_progress: 'info', completed: 'success', overdue: 'destructive',
};
const DUTY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  scheduled: 'secondary', in_progress: 'info', completed: 'success', cancelled: 'destructive',
};
const HANDOVER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  sent: 'warning', received: 'info', accepted: 'info', verified: 'success', declined: 'destructive',
  rejected: 'destructive', acknowledged: 'info', completed: 'success', pending: 'warning',
};
const KARDEX_STATUS_VARIANT: Record<string, BadgeVariant> = {
  submitted: 'secondary', approved: 'success', returned: 'warning', rejected: 'destructive',
};

export type RecordSectionKey =
  | 'tasks' | 'handovers' | 'task-handovers' | 'charting' | 'duty' | 'kardex' | 'vitals' | 'departments';

export const RECORD_SECTIONS: Record<RecordSectionKey, RecordSectionConfig> = {
  tasks: {
    title: 'Tasks',
    description: 'Every care task across every nurse.',
    fetch: () => fetchTasks(),
    toRow: (t) => ({
      key: t.id,
      title: t.title,
      badge: { label: t.status.replace('_', ' '), variant: TASK_STATUS_VARIANT[t.status] || 'secondary' },
      meta: [
        `${t.patientName || 'No patient'} · Assigned to ${t.assignedTo || 'Unassigned'}`,
        `${t.category} · Due ${t.dueTime || '—'}`,
      ],
      search: `${t.title} ${t.patientName} ${t.assignedTo}`,
    }),
    detailFields: (t) => [
      { label: 'Title', value: t.title },
      { label: 'Description', value: t.description || '—', multiline: true },
      { label: 'Patient', value: t.patientName || '—' },
      { label: 'Patient room', value: t.patientRoom || '—' },
      { label: 'Department', value: t.departmentName || '—' },
      { label: 'Assigned to', value: t.assignedTo || 'Unassigned' },
      { label: 'Priority', value: t.priority },
      { label: 'Status', value: t.status.replace('_', ' ') },
      { label: 'Category', value: t.category },
      { label: 'Due time', value: t.dueTime || '—' },
      { label: 'Attending physician', value: t.attendingPhysician || '—' },
      { label: 'Doctor order', value: t.doctorOrder || '—', multiline: true },
      {
        label: 'Checklist',
        value: Array.isArray(t.checklist) && t.checklist.length
          ? t.checklist.map((c: any) => `${c.done ? '✓' : '○'} ${c.text}`).join('\n')
          : '—',
        multiline: true,
      },
      { label: 'Created', value: fmtDate(t.createdAt) },
      { label: 'Completed', value: t.completedAt ? fmtDate(t.completedAt) : '—' },
    ],
  },
  handovers: {
    title: 'Referral Notes',
    description: 'SBAR patient referrals between nurses.',
    fetch: () => fetchHandovers(),
    toRow: (h) => ({
      key: h.id,
      title: `${h.patientName} · ${h.nurseFrom} → ${h.nurseTo}`,
      badge: { label: h.status, variant: HANDOVER_STATUS_VARIANT[h.status] || 'secondary' },
      meta: [
        h.toShiftLabel
          ? `Assigned shift: ${h.toShiftLabel}${h.shiftDate ? ` (${h.shiftDate})` : ''}`
          : 'Assigned shift: Not assigned',
        h.sbar?.situation || '',
      ],
      search: `${h.patientName} ${h.nurseFrom} ${h.nurseTo}`,
    }),
    detailFields: (h) => [
      { label: 'Patient', value: h.patientName },
      { label: 'From nurse', value: h.nurseFrom },
      { label: 'To nurse', value: h.nurseTo },
      { label: 'To nurse role', value: h.nurseToRole || '—' },
      { label: 'Assigned shift', value: h.toShiftLabel ? `${h.toShiftLabel}${h.shiftDate ? ` (${h.shiftDate})` : ''}` : 'Not assigned' },
      { label: 'Sender shift', value: `${h.shiftLabel || h.shift} shift` },
      { label: 'Date', value: h.date },
      { label: 'Status', value: h.status },
      { label: 'Situation', value: h.sbar?.situation || '—', multiline: true },
      { label: 'Background', value: h.sbar?.background || '—', multiline: true },
      { label: 'Assessment', value: h.sbar?.assessment || '—', multiline: true },
      { label: 'Recommendation', value: h.sbar?.recommendation || '—', multiline: true },
      { label: 'Unfinished tasks', value: joinOrDash(h.unfinishedTasks), multiline: true },
      { label: 'Photos attached', value: h.photos?.length ? String(h.photos.length) : '0' },
      { label: 'Adopted tasks', value: joinOrDash(h.adoptedTasks) },
    ],
  },
  'task-handovers': {
    title: 'Task Handovers',
    description: 'Shift-to-shift task handoffs, pending head nurse verification.',
    fetch: () => fetchTaskHandovers(),
    toRow: (h) => ({
      key: h.id,
      title: `${h.taskTitle || h.taskDescription || 'Task'} · ${h.fromNurseName} → ${h.toNurseName}`,
      badge: { label: h.statusLabel || h.status, variant: HANDOVER_STATUS_VARIANT[h.status] || 'secondary' },
      meta: [`${h.shiftLabel} shift · ${h.departmentName} · ${h.dutyDate}`, h.notes || ''],
      search: `${h.taskTitle} ${h.fromNurseName} ${h.toNurseName} ${h.departmentName}`,
    }),
    detailFields: (h) => [
      { label: 'Task', value: h.taskTitle || '—' },
      { label: 'Task description', value: h.taskDescription || '—', multiline: true },
      { label: 'From nurse', value: h.fromNurseName },
      { label: 'To nurse', value: h.toNurseName },
      { label: 'Department', value: h.departmentName || '—' },
      { label: 'Shift', value: h.shiftLabel },
      { label: 'Duty date', value: h.dutyDate },
      { label: 'Notes', value: h.notes || '—', multiline: true },
      { label: 'Status', value: h.statusLabel || h.status },
      { label: 'Head nurse', value: h.supervisorName || '—' },
      { label: 'Verified at', value: h.verifiedAt ? fmtDate(h.verifiedAt) : '—' },
      { label: 'Rejection reason', value: h.rejectionReason || '—', multiline: true },
      { label: 'Created', value: fmtDate(h.createdAt) },
    ],
  },
  charting: {
    title: 'Charting Notes',
    description: 'Nursing notes and auto-charted entries.',
    fetch: () => fetchChartingNotes(),
    toRow: (c) => ({
      key: c.id,
      title: `${c.patientName} · ${c.type.replace('_', ' ')}`,
      badge: c.aiGenerated ? { label: 'auto-charted', variant: 'info' } : undefined,
      meta: [`By ${c.nurseName} · ${fmtDate(c.timestamp)}`, (c.content || '').slice(0, 100)],
      search: `${c.patientName} ${c.nurseName} ${c.content}`,
    }),
    detailFields: (c) => [
      { label: 'Patient', value: c.patientName },
      { label: 'Nurse', value: c.nurseName },
      { label: 'Type', value: c.type.replace('_', ' ') },
      { label: 'Attending physician', value: c.attendingPhysician || '—' },
      { label: 'Content', value: c.content || '—', multiline: true },
      { label: 'Auto-generated', value: yn(c.aiGenerated) },
      { label: 'Edited', value: yn(c.edited) },
      { label: 'Edit history entries', value: String(c.editHistory?.length || 0) },
      { label: 'Charted at', value: fmtDate(c.timestamp) },
    ],
  },
  duty: {
    title: 'Duty Assignments',
    description: 'The full shift roster, every department.',
    fetch: () => fetchDutyAssignments(),
    toRow: (d) => ({
      key: String(d.id),
      title: `${d.nurseName} · ${d.shiftLabel} shift`,
      badge: { label: d.statusLabel || d.status, variant: DUTY_STATUS_VARIANT[d.status] || 'secondary' },
      meta: [`${d.departmentName} · ${d.dutyDate}`, `${d.startTime}–${d.endTime} · ${d.totalHours}h`],
      search: `${d.nurseName} ${d.departmentName}`,
    }),
    detailFields: (d) => [
      { label: 'Nurse', value: d.nurseName },
      { label: 'Department', value: d.departmentName },
      { label: 'Duty date', value: d.dutyDate },
      { label: 'Shift', value: d.shiftLabel },
      { label: 'Scheduled', value: `${d.startTime}–${d.endTime}` },
      { label: 'Regular hours', value: String(d.regularHours) },
      { label: 'Overtime hours', value: String(d.overtimeHours) },
      { label: 'Total hours', value: String(d.totalHours) },
      { label: 'Status', value: d.statusLabel || d.status },
      { label: 'Notes', value: d.notes || '—', multiline: true },
      { label: 'Actual start', value: d.actualStartTime ? fmtDate(d.actualStartTime) : 'Not started' },
      { label: 'Actual end', value: d.actualEndTime ? fmtDate(d.actualEndTime) : 'Not ended' },
      { label: 'Actual worked hours', value: String(d.actualWorkedHours ?? 0) },
      { label: 'Actual overtime hours', value: String(d.actualOvertimeHours ?? 0) },
      { label: 'End recorded by (head nurse)', value: d.actualEndRecordedBy || '—' },
      { label: 'Created by', value: d.createdBy || '—' },
    ],
  },
  kardex: {
    title: 'Kardex Records',
    description: 'Admission kardex submissions and reviews.',
    fetch: () => fetchKardexRecords(),
    toRow: (k) => ({
      key: k.id,
      title: k.patientName,
      badge: { label: k.status, variant: KARDEX_STATUS_VARIANT[k.status] || 'secondary' },
      meta: [`Room ${k.room} · Dx: ${k.admittingDiagnosis || '—'}`, `Saved by ${k.savedBy} · ${fmtDate(k.savedAt)}`],
      search: `${k.patientName} ${k.savedBy} ${k.room}`,
    }),
    detailFields: (k) => [
      { label: 'Patient', value: k.patientName },
      { label: 'Age / Gender', value: `${k.age} / ${k.gender}` },
      { label: 'Room / Bed', value: `${k.room} / ${k.bedNumber}` },
      { label: 'Admission date', value: k.admissionDate || '—' },
      { label: 'Attending physician', value: k.attendingPhysician || '—' },
      { label: 'Chief complaint', value: k.chiefComplaint || '—', multiline: true },
      { label: 'Admitting diagnosis', value: k.admittingDiagnosis || '—', multiline: true },
      { label: 'Final diagnosis', value: k.finalDiagnosis || '—', multiline: true },
      { label: 'Diet', value: k.diet || '—' },
      { label: 'Temperature', value: k.temperature || '—' },
      { label: 'Pulse rate', value: k.pulseRate || '—' },
      { label: 'Respiratory rate', value: k.respiratoryRate || '—' },
      { label: 'Blood pressure', value: k.bloodPressure || '—' },
      { label: 'Oxygen saturation', value: k.oxygenSaturation || '—' },
      { label: 'Special endorsements', value: k.specialEndorsements || '—', multiline: true },
      { label: 'Saved by', value: k.savedBy },
      { label: 'Saved at', value: fmtDate(k.savedAt) },
      { label: 'Status', value: k.status },
      { label: 'Reviewed by', value: k.reviewedBy || '—' },
      { label: 'Reviewed at', value: k.reviewedAt ? fmtDate(k.reviewedAt) : '—' },
      { label: 'Review notes', value: k.reviewNotes || '—', multiline: true },
    ],
  },
  vitals: {
    title: 'Vital Signs',
    description: 'Recorded vitals history, most recent first.',
    fetch: () => fetchVitalReadings(),
    toRow: (v) => ({
      key: String(v.id),
      title: `Patient ${v.patientId} · HR ${v.heartRate ?? '—'} · BP ${v.bloodPressure || '—'}`,
      meta: [
        `Temp ${v.temperature ?? '—'}°C · SpO2 ${v.oxygenSaturation ?? '—'}% · RR ${v.respiratoryRate ?? '—'}`,
        `${v.source} · Recorded by ${v.recordedByName || 'System'} · ${fmtDate(v.recordedAt)}`,
      ],
      search: `${v.patientId} ${v.recordedByName || ''}`,
    }),
    detailFields: (v) => [
      { label: 'Patient', value: v.patientId },
      { label: 'Heart rate', value: v.heartRate != null ? String(v.heartRate) : '—' },
      { label: 'Blood pressure', value: v.bloodPressure || '—' },
      { label: 'Temperature', value: v.temperature != null ? String(v.temperature) : '—' },
      { label: 'Oxygen saturation', value: v.oxygenSaturation != null ? String(v.oxygenSaturation) : '—' },
      { label: 'Respiratory rate', value: v.respiratoryRate != null ? String(v.respiratoryRate) : '—' },
      { label: 'Pain scale', value: v.painScale != null ? String(v.painScale) : '—' },
      { label: 'Source', value: v.source },
      { label: 'Notes', value: v.notes || '—', multiline: true },
      { label: 'Recorded by', value: v.recordedByName || 'System' },
      { label: 'Recorded at', value: fmtDate(v.recordedAt) },
    ],
  },
  departments: {
    title: 'Departments',
    description: 'Reference list of hospital departments (fixed — seeded, not editable).',
    fetch: () => fetchDepartments(),
    toRow: (d) => ({ key: String(d.id), title: d.name, meta: [], search: d.name }),
  },
};

export const RECORD_SECTION_LIST: { key: RecordSectionKey; label: string }[] = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'handovers', label: 'Referral Notes' },
  { key: 'task-handovers', label: 'Task Handovers' },
  { key: 'charting', label: 'Charting Notes' },
  { key: 'duty', label: 'Duty Assignments' },
  { key: 'kardex', label: 'Kardex Records' },
  { key: 'vitals', label: 'Vital Signs' },
  { key: 'departments', label: 'Departments' },
];
