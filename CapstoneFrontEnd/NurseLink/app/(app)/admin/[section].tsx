import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Modal, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Search, X, Pencil, Trash2 } from 'lucide-react-native';
import {
  updateAdminRecord,
  deleteAdminRecord,
  fetchNurses,
  type AdminRecordType,
  fetchPatients,
  fetchTasks,
  fetchHandovers,
  fetchTaskHandovers,
  fetchChartingNotes,
  fetchDutyAssignments,
  fetchKardexRecords,
  fetchVitalReadings,
  fetchDepartments,
  ApiError,
} from '../../../services/api';
import { Input } from '../../../components/Input';
import { Badge } from '../../../components/Badge';
import { Select, type SelectOption } from '../../../components/Select';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../../../constants/colors';
import { Pagination, usePagination } from '../../../components/Pagination';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline';

interface Row {
  key: string;
  title: string;
  badge?: { label: string; variant: BadgeVariant };
  meta: string[];
  search: string;
  // The full fetched record — the summary row above only ever shows a
  // trimmed preview of this, but tapping the row opens every field via
  // detailFields below. Nothing is hidden from Admin; it's just not all
  // shown in the compact list at once.
  raw: any;
}

interface DetailField {
  label: string;
  value: string;
  /** Long free text (SBAR narrative, full charting content, notes) — shown
   * as a full-width paragraph instead of a right-aligned label/value row. */
  multiline?: boolean;
}

interface SectionFilter {
  key: string;
  label: string;
  options: SelectOption[];
  match: (raw: any, value: string) => boolean;
}

/** Option lists that come from the server (departments, nurses). */
interface EditContext {
  departments: SelectOption[];
  nurseIds: SelectOption[];
  nurseNames: SelectOption[];
}

/** One field of a section's admin Edit form. `key` is the API field name;
 * a dot ("sbar.situation") nests it in the request body. */
interface EditField {
  key: string;
  label: string;
  type?: 'text' | 'multiline' | 'number' | 'select' | 'list';
  options?: SelectOption[] | ((ctx: EditContext) => SelectOption[]);
  get: (raw: any) => unknown;
}

interface SectionConfig {
  title: string;
  description: string;
  fetch: () => Promise<unknown[]>;
  toRow: (item: any) => Omit<Row, 'raw'>;
  detailFields?: (item: any) => DetailField[];
  /** Optional structured filters (dropdowns above search) — computed from
   * the loaded rows' raw data so option lists (e.g. nurse names) stay real,
   * not hardcoded. Only `patients` sets this; every other section renders
   * exactly as before (search-only). */
  filters?: (raws: any[]) => SectionFilter[];
  /** Admin edit/delete (api/admin_records.py). The id the endpoint expects. */
  recordId?: (raw: any) => string;
  editFields?: EditField[];
  /** What else a delete removes, shown in the confirm dialog. */
  deleteWarning?: string;
}

const opts = (...values: [string, string][]): SelectOption[] =>
  values.map(([value, label]) => ({ value, label }));
const SHIFT_OPTIONS = opts(['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night']);
const GENDER_OPTIONS = opts(['Male', 'Male'], ['Female', 'Female']);

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
  return Array.isArray(list) && list.length ? list.join(', ') : '—';
}

const RISK_VARIANT: Record<string, BadgeVariant> = {
  low: 'success', medium: 'warning', high: 'destructive', critical: 'destructive',
};
const TASK_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'secondary', in_progress: 'info', completed: 'success', overdue: 'destructive',
};
const DUTY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  scheduled: 'secondary', in_progress: 'info', completed: 'success', cancelled: 'destructive',
};
const HANDOVER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning', accepted: 'info', verified: 'success', rejected: 'destructive', acknowledged: 'info', completed: 'success',
};
const KARDEX_STATUS_VARIANT: Record<string, BadgeVariant> = {
  submitted: 'secondary', approved: 'success', returned: 'warning', rejected: 'destructive',
};

const SECTIONS: Record<string, SectionConfig> = {
  patients: {
    title: 'Patients',
    description: 'Every admitted, observed, and discharged patient.',
    fetch: () => fetchPatients(),
    toRow: (p) => ({
      key: p.id,
      title: `${p.name} · ${p.room || 'No room'}`,
      badge: { label: p.statusLabel || p.status || 'admitted', variant: RISK_VARIANT[p.riskLevel] || 'secondary' },
      meta: [
        p.diagnosis || 'No diagnosis on file',
        `${p.departmentName || 'No department'} · Nurse: ${p.assignedNurseName || 'Unassigned'}`,
        `Admitted ${fmtDate(p.admissionDate)}`,
      ],
      search: `${p.name} ${p.room} ${p.diagnosis} ${p.assignedNurseName || ''}`,
    }),
    detailFields: (p) => [
      { label: 'Name', value: p.name },
      { label: 'Age / Gender', value: `${p.age} / ${p.gender}` },
      { label: 'Room', value: p.room || '—' },
      { label: 'Department', value: p.departmentName || '—' },
      { label: 'Status', value: p.statusLabel || p.status || '—' },
      { label: 'Risk level', value: p.riskLevel || '—' },
      { label: 'Diagnosis', value: p.diagnosis || '—', multiline: true },
      { label: 'Attending physician', value: p.attendingPhysician || '—' },
      { label: 'Assigned nurse', value: p.assignedNurseName || 'Unassigned' },
      { label: 'Assigned by', value: p.assignedBy || '—' },
      { label: 'On-duty nurse now', value: p.onDutyNurseName || '—' },
      { label: 'Heart rate', value: p.vitalSigns?.heartRate ? String(p.vitalSigns.heartRate) : '—' },
      { label: 'Blood pressure', value: p.vitalSigns?.bloodPressure || '—' },
      { label: 'Temperature', value: p.vitalSigns?.temperature ? String(p.vitalSigns.temperature) : '—' },
      { label: 'Oxygen saturation', value: p.vitalSigns?.oxygenSaturation ? String(p.vitalSigns.oxygenSaturation) : '—' },
      { label: 'Allergies', value: joinOrDash(p.allergies) },
      { label: 'Medications', value: joinOrDash(p.medications) },
      { label: 'Alerts', value: joinOrDash(p.alerts) },
      { label: 'Admitted', value: fmtDate(p.admissionDate) },
      { label: 'Discharged', value: p.dischargedAt ? fmtDate(p.dischargedAt) : '—' },
      { label: 'Discharged by', value: p.dischargedByName || '—' },
      { label: 'Last edited by', value: p.lastEditedByName || '—' },
      { label: 'Last edited at', value: p.lastEditedAt ? fmtDate(p.lastEditedAt) : '—' },
    ],
    recordId: (p) => p.id,
    deleteWarning:
      "Deleting this patient also deletes their tasks, Kardex, charting notes, vital signs and referrals for every account. This cannot be undone.",
    editFields: [
      { key: 'name', label: 'Full name', get: (p) => p.name },
      { key: 'age', label: 'Age', type: 'number', get: (p) => p.age },
      { key: 'gender', label: 'Gender', type: 'select', options: GENDER_OPTIONS, get: (p) => p.gender },
      { key: 'room', label: 'Room', get: (p) => p.room },
      { key: 'bedNumber', label: 'Bed number', get: (p) => p.bedNumber },
      { key: 'departmentId', label: 'Department', type: 'select', options: (c) => c.departments, get: (p) => p.departmentId },
      {
        key: 'status', label: 'Status', type: 'select',
        options: opts(['admitted', 'Admitted'], ['observation', 'Under Observation'], ['discharged', 'Discharged']),
        get: (p) => p.status,
      },
      {
        key: 'riskLevel', label: 'Risk level', type: 'select',
        options: opts(['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']),
        get: (p) => p.riskLevel,
      },
      { key: 'diagnosis', label: 'Diagnosis', type: 'multiline', get: (p) => p.diagnosis },
      { key: 'attendingPhysician', label: 'Attending physician', get: (p) => p.attendingPhysician },
      { key: 'contactNumber', label: 'Contact number', get: (p) => p.contactNumber },
      { key: 'address', label: 'Address', get: (p) => p.address },
      { key: 'allergies', label: 'Allergies (comma separated)', type: 'list', get: (p) => p.allergies },
      { key: 'medications', label: 'Medications (comma separated)', type: 'list', get: (p) => p.medications },
      { key: 'alerts', label: 'Alerts (comma separated)', type: 'list', get: (p) => p.alerts },
    ],
    filters: (raws) => {
      const nurseNames = Array.from(
        new Set(raws.map((p) => p.assignedNurseName).filter(Boolean))
      ).sort() as string[];
      const deptNames = Array.from(
        new Set(raws.map((p) => p.departmentName).filter(Boolean))
      ).sort() as string[];
      return [
        {
          key: 'nurse',
          label: 'Assigned Nurse',
          options: [
            { label: 'All Nurses', value: 'all' },
            ...nurseNames.map((n) => ({ label: n, value: n })),
          ],
          match: (p, v) => v === 'all' || p.assignedNurseName === v,
        },
        {
          key: 'department',
          label: 'Department',
          options: [
            { label: 'All Departments', value: 'all' },
            ...deptNames.map((n) => ({ label: n, value: n })),
          ],
          match: (p, v) => v === 'all' || p.departmentName === v,
        },
        {
          key: 'risk',
          label: 'Risk Level',
          options: [
            { label: 'All Risk Levels', value: 'all' },
            { label: 'Low', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High', value: 'high' },
            { label: 'Critical', value: 'critical' },
          ],
          match: (p, v) => v === 'all' || p.riskLevel === v,
        },
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'All Statuses', value: 'all' },
            { label: 'Admitted', value: 'admitted' },
            { label: 'Observation', value: 'observation' },
            { label: 'Discharged', value: 'discharged' },
          ],
          match: (p, v) => v === 'all' || p.status === v,
        },
      ];
    },
  },
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
        `${t.category} · Due ${t.dueDate || ''}${t.dueDate && t.dueTime ? ' ' : ''}${t.dueTime || (t.dueDate ? '' : '—')}`,
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
      { label: 'Risk level', value: t.priority },
      { label: 'Status', value: t.status.replace('_', ' ') },
      { label: 'Category', value: t.category },
      { label: 'Due date', value: t.dueDate || '—' },
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
    recordId: (t) => t.id,
    deleteWarning: 'Deletes this task for every nurse and head nurse. This cannot be undone.',
    editFields: [
      { key: 'title', label: 'Title', get: (t) => t.title },
      { key: 'description', label: 'Description', type: 'multiline', get: (t) => t.description },
      { key: 'assignedTo', label: 'Assigned to', type: 'select', options: (c) => c.nurseNames, get: (t) => t.assignedTo },
      {
        key: 'priority', label: 'Risk level', type: 'select',
        options: opts(['high', 'High'], ['medium', 'Medium'], ['low', 'Low']),
        get: (t) => t.priority,
      },
      {
        key: 'status', label: 'Status', type: 'select',
        options: opts(['pending', 'Pending'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['overdue', 'Overdue']),
        get: (t) => t.status,
      },
      {
        key: 'category', label: 'Category', type: 'select',
        options: opts(['medication', 'Medication'], ['vital_signs', 'Vital Signs'], ['care', 'Care'], ['assessment', 'Assessment'], ['documentation', 'Documentation']),
        get: (t) => t.category,
      },
      { key: 'dueDate', label: 'Due date (YYYY-MM-DD)', get: (t) => t.dueDate || '' },
      { key: 'dueTime', label: 'Due time', get: (t) => t.dueTime },
      { key: 'doctorOrder', label: "Doctor's order", type: 'multiline', get: (t) => t.doctorOrder },
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
      { label: 'Shift', value: h.shift },
      { label: 'Date', value: h.date },
      { label: 'Due at', value: h.dueAt ? fmtDate(h.dueAt) : '—' },
      { label: 'Status', value: h.status },
      { label: 'Situation', value: h.sbar?.situation || '—', multiline: true },
      { label: 'Background', value: h.sbar?.background || '—', multiline: true },
      { label: 'Assessment', value: h.sbar?.assessment || '—', multiline: true },
      { label: 'Recommendation', value: h.sbar?.recommendation || '—', multiline: true },
      { label: 'Unfinished tasks', value: joinOrDash(h.unfinishedTasks), multiline: true },
      { label: 'Photos attached', value: h.photos?.length ? String(h.photos.length) : '0' },
      { label: 'Adopted tasks', value: joinOrDash(h.adoptedTasks) },
    ],
    recordId: (h) => h.id,
    deleteWarning: 'Deletes this referral for the sender, the receiving nurse and head nurses. This cannot be undone.',
    editFields: [
      { key: 'sbar.situation', label: 'Situation', type: 'multiline', get: (h) => h.sbar?.situation },
      { key: 'sbar.background', label: 'Background', type: 'multiline', get: (h) => h.sbar?.background },
      { key: 'sbar.assessment', label: 'Assessment', type: 'multiline', get: (h) => h.sbar?.assessment },
      { key: 'sbar.recommendation', label: 'Recommendation', type: 'multiline', get: (h) => h.sbar?.recommendation },
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
    recordId: (h) => h.id,
    deleteWarning: 'Deletes this task handover for both nurses and head nurses. This cannot be undone.',
    editFields: [
      { key: 'taskDescription', label: 'Task description', type: 'multiline', get: (h) => h.taskDescription },
      { key: 'shift', label: 'Shift', type: 'select', options: SHIFT_OPTIONS, get: (h) => h.shift },
      { key: 'notes', label: 'Notes', type: 'multiline', get: (h) => h.notes },
      {
        key: 'status', label: 'Status', type: 'select',
        options: opts(['pending', 'Pending Verification'], ['verified', 'Verified'], ['rejected', 'Rejected']),
        get: (h) => h.status,
      },
      { key: 'rejectionReason', label: 'Rejection reason', type: 'multiline', get: (h) => h.rejectionReason },
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
      meta: [`By ${c.nurseName} · ${fmtDate(c.timestamp)}`, c.content?.slice(0, 100) || ''],
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
      { label: 'Confirmed', value: yn(c.confirmed) },
      { label: 'Confirmed at', value: c.confirmedAt ? fmtDate(c.confirmedAt) : '—' },
      {
        label: 'Assessment (structured)',
        value: c.structured?.assessment || '—',
        multiline: true,
      },
      {
        label: 'Plan (structured)',
        value: c.structured?.plan || '—',
        multiline: true,
      },
      { label: 'Edit history entries', value: String(c.editHistory?.length || 0) },
      { label: 'Charted at', value: fmtDate(c.timestamp) },
    ],
    recordId: (c) => c.id,
    deleteWarning: 'Deletes this charting note from the patient record for every account. This cannot be undone.',
    editFields: [
      { key: 'content', label: 'Content', type: 'multiline', get: (c) => c.content },
      { key: 'focus', label: 'Focus', type: 'multiline', get: (c) => c.focus },
      { key: 'data', label: 'Data', type: 'multiline', get: (c) => c.data },
      { key: 'action', label: 'Action', type: 'multiline', get: (c) => c.action },
      { key: 'response', label: 'Response', type: 'multiline', get: (c) => c.response },
      { key: 'attendingPhysician', label: 'Attending physician', get: (c) => c.attendingPhysician },
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
    recordId: (d) => String(d.id),
    deleteWarning: "Removes this shift from the roster; the nurse's shift and department update everywhere. This cannot be undone.",
    editFields: [
      { key: 'nurseId', label: 'Nurse', type: 'select', options: (c) => c.nurseIds, get: (d) => d.nurseId },
      { key: 'departmentId', label: 'Department', type: 'select', options: (c) => c.departments, get: (d) => d.departmentId },
      { key: 'dutyDate', label: 'Duty date (YYYY-MM-DD)', get: (d) => d.dutyDate },
      { key: 'shift', label: 'Shift', type: 'select', options: SHIFT_OPTIONS, get: (d) => d.shift },
      { key: 'startTime', label: 'Start time (HH:MM)', get: (d) => d.startTime },
      { key: 'endTime', label: 'End time (HH:MM)', get: (d) => d.endTime },
      {
        key: 'status', label: 'Status', type: 'select',
        options: opts(['scheduled', 'Scheduled'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']),
        get: (d) => d.status,
      },
      { key: 'notes', label: 'Notes', type: 'multiline', get: (d) => d.notes },
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
      { label: 'Birthday', value: k.birthday || '—' },
      { label: 'Room / Bed', value: `${k.room} / ${k.bedNumber}` },
      { label: 'Admission date', value: k.admissionDate || '—' },
      { label: 'Attending physician', value: k.attendingPhysician || '—' },
      { label: 'Chief complaint', value: k.chiefComplaint || '—', multiline: true },
      { label: 'Admitting diagnosis', value: k.admittingDiagnosis || '—', multiline: true },
      { label: 'Final diagnosis', value: k.finalDiagnosis || '—', multiline: true },
      { label: 'Diet', value: k.diet || '—' },
      { label: 'IVF', value: k.ivf || '—' },
      { label: 'Allergies', value: joinOrDash(k.allergies) },
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
    recordId: (k) => String(k.id),
    deleteWarning: 'Deletes this Kardex record for every account. The patient itself is kept. This cannot be undone.',
    editFields: [
      { key: 'firstName', label: 'First name', get: (k) => k.firstName },
      { key: 'middleName', label: 'Middle name', get: (k) => k.middleName },
      { key: 'lastName', label: 'Last name', get: (k) => k.lastName },
      { key: 'age', label: 'Age', type: 'number', get: (k) => k.age },
      { key: 'gender', label: 'Gender', type: 'select', options: GENDER_OPTIONS, get: (k) => k.gender },
      { key: 'room', label: 'Room', get: (k) => k.room },
      { key: 'bedNumber', label: 'Bed number', get: (k) => k.bedNumber },
      { key: 'attendingPhysician', label: 'Attending physician', get: (k) => k.attendingPhysician },
      { key: 'chiefComplaint', label: 'Chief complaint', type: 'multiline', get: (k) => k.chiefComplaint },
      { key: 'admittingDiagnosis', label: 'Admitting diagnosis', type: 'multiline', get: (k) => k.admittingDiagnosis },
      { key: 'finalDiagnosis', label: 'Final diagnosis', type: 'multiline', get: (k) => k.finalDiagnosis },
      { key: 'diet', label: 'Diet', get: (k) => k.diet },
      { key: 'ivf', label: 'IVF', get: (k) => k.ivf },
      { key: 'allergies', label: 'Allergies (comma separated)', type: 'list', get: (k) => k.allergies },
      { key: 'temperature', label: 'Temperature', get: (k) => k.temperature },
      { key: 'pulseRate', label: 'Pulse rate', get: (k) => k.pulseRate },
      { key: 'respiratoryRate', label: 'Respiratory rate', get: (k) => k.respiratoryRate },
      { key: 'bloodPressure', label: 'Blood pressure', get: (k) => k.bloodPressure },
      { key: 'oxygenSaturation', label: 'Oxygen saturation', get: (k) => k.oxygenSaturation },
      { key: 'specialEndorsements', label: 'Special endorsements', type: 'multiline', get: (k) => k.specialEndorsements },
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
    recordId: (v) => String(v.id),
    deleteWarning: 'Deletes this vital signs reading from the patient record for every account. This cannot be undone.',
    editFields: [
      { key: 'heartRate', label: 'Heart rate', type: 'number', get: (v) => v.heartRate },
      { key: 'bloodPressure', label: 'Blood pressure', get: (v) => v.bloodPressure },
      { key: 'temperature', label: 'Temperature (°C)', type: 'number', get: (v) => v.temperature },
      { key: 'oxygenSaturation', label: 'Oxygen saturation (%)', type: 'number', get: (v) => v.oxygenSaturation },
      { key: 'respiratoryRate', label: 'Respiratory rate', type: 'number', get: (v) => v.respiratoryRate },
      { key: 'painScale', label: 'Pain scale (0-10)', type: 'number', get: (v) => v.painScale },
      { key: 'notes', label: 'Notes', type: 'multiline', get: (v) => v.notes },
    ],
  },
  departments: {
    title: 'Departments',
    description: 'Reference list of hospital departments.',
    fetch: () => fetchDepartments(),
    toRow: (d) => ({ key: String(d.id), title: d.name, meta: [], search: d.name }),
    detailFields: (d) => [{ label: 'Name', value: d.name }],
    recordId: (d) => String(d.id),
    deleteWarning:
      'Deletes this department. A department still used by doctors or duty assignments cannot be deleted until those are moved.',
    editFields: [{ key: 'name', label: 'Name', get: (d) => d.name }],
  },
};

function toFormValue(field: EditField, raw: any): string {
  const value = field.get(raw);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Only the fields the admin actually changed, typed for the API. */
function buildPayload(fields: EditField[], raw: any, form: Record<string, string>) {
  const body: Record<string, any> = {};
  for (const field of fields) {
    const next = (form[field.key] ?? '').trim();
    if (next === toFormValue(field, raw).trim()) continue;
    let value: unknown = next;
    if (field.type === 'number') value = next === '' ? null : Number(next);
    if (field.type === 'list') value = next ? next.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const [head, child] = field.key.split('.');
    if (child) {
      body[head] = { ...(body[head] || {}), [child]: value };
    } else {
      body[head] = value;
    }
  }
  return body;
}

function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Please try again.';
  return err.message;
}

export default function AdminGenericSectionPage() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const config = SECTIONS[section as string];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const toast = useToast();
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [ctx, setCtx] = useState<EditContext>({ departments: [], nurseIds: [], nurseNames: [] });
  const canEdit = !!(config?.recordId && config.editFields);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError('');
    try {
      const data = await config.fetch();
      setRows(data.map((item) => ({ ...config.toRow(item), raw: item })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this section.');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    (() => {
      setFilterValues({});
    })();
    (async () => {
      await load();
    })();
  }, [load]);

  const activeFilters = useMemo(
    () => (config?.filters ? config.filters(rows.map((r) => r.raw)) : []),
    [config, rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;
    for (const f of activeFilters) {
      const value = filterValues[f.key] ?? 'all';
      if (value !== 'all') {
        result = result.filter((r) => f.match(r.raw, value));
      }
    }
    if (!q) return result;
    return result.filter((r) => r.search.toLowerCase().includes(q));
  }, [rows, search, activeFilters, filterValues]);

  // 10 per page; Next/Prev jumps back to the top of the list.
  const scrollRef = useRef<ScrollView>(null);
  const paged = usePagination(filtered, { scrollRef, resetKey: `${section}|${search}|${JSON.stringify(filterValues)}` });

  const loadOptions = async () => {
    if (ctx.departments.length || ctx.nurseIds.length) return;
    try {
      const [departments, nurses] = await Promise.all([fetchDepartments(), fetchNurses()]);
      setCtx({
        departments: departments.map((d: any) => ({ value: String(d.id), label: d.name })),
        nurseIds: nurses.map((n) => ({ value: n.id, label: `${n.name}${n.email ? ` (${n.email})` : ''}` })),
        nurseNames: nurses.map((n) => ({ value: n.name, label: n.name })),
      });
    } catch {
      // Selects just show fewer choices; the rest of the form still works.
    }
  };

  const openEdit = (row: Row) => {
    if (!config?.editFields) return;
    const values: Record<string, string> = {};
    for (const field of config.editFields) values[field.key] = toFormValue(field, row.raw);
    setForm(values);
    setFormError('');
    setSelected(null);
    setEditing(row);
    void loadOptions();
  };

  const saveEdit = async () => {
    if (!config?.editFields || !config.recordId || !editing) return;
    const body = buildPayload(config.editFields, editing.raw, form);
    if (!Object.keys(body).length) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await updateAdminRecord(section as AdminRecordType, config.recordId(editing.raw), body);
      setEditing(null);
      toast.success('Saved', { description: 'The change is now visible to every account.' });
      await load();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!config?.recordId || !toDelete) return;
    setDeleting(true);
    try {
      await deleteAdminRecord(section as AdminRecordType, config.recordId(toDelete.raw));
      setRows((prev) => prev.filter((r) => r.key !== toDelete.key));
      setToDelete(null);
      setSelected(null);
      toast.success('Deleted', { description: 'Removed for every account.' });
    } catch (err) {
      toast.error('Could not delete', { description: errorText(err) });
    } finally {
      setDeleting(false);
    }
  };

  if (!config) {
    return (
      <View style={styles.root}>
        <Text style={styles.empty}>Unknown section.</Text>
      </View>
    );
  }

  const detailFields = selected && config.detailFields ? config.detailFields(selected.raw) : null;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{config.title}</Text>
        <Text style={styles.subtitle}>{config.description}</Text>

        <Input
          placeholder="Search"
          value={search}
          onChangeText={setSearch}
          leftIcon={<Search size={16} color={Colors.gray400} />}
        />

        {activeFilters.map((f) => (
          <Select
            key={f.key}
            label={f.label}
            value={filterValues[f.key] ?? 'all'}
            onValueChange={(v) => setFilterValues((prev) => ({ ...prev, [f.key]: v }))}
            options={f.options}
          />
        ))}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={Colors.blue600} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : filtered.length === 0 ? (
          <Text style={styles.empty}>Nothing here yet.</Text>
        ) : (
          <View style={styles.list}>
            {paged.pageItems.map((row) => (
              <Pressable
                key={row.key}
                onPress={() => config.detailFields && setSelected(row)}
                disabled={!config.detailFields}
              >
                <View style={[styles.row, Shadows.sm]}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowTitle}>{row.title}</Text>
                    {row.badge ? <Badge variant={row.badge.variant}>{row.badge.label}</Badge> : null}
                  </View>
                  {row.meta.filter(Boolean).map((line, i) => (
                    <Text key={i} style={styles.rowMeta} numberOfLines={2}>{line}</Text>
                  ))}
                  {canEdit ? (
                    <View style={styles.rowActions}>
                      <Pressable
                        onPress={() => openEdit(row)}
                        hitSlop={6}
                        style={styles.actionBtn}
                        accessibilityLabel={`Edit ${row.title}`}
                      >
                        <Pencil size={14} color={Colors.blue700} />
                        <Text style={styles.actionEdit}>Edit</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setToDelete(row)}
                        hitSlop={6}
                        style={styles.actionBtn}
                        accessibilityLabel={`Delete ${row.title}`}
                      >
                        <Trash2 size={14} color={Colors.red600} />
                        <Text style={styles.actionDelete}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
          total={paged.total}
        />
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.dialogWrap} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={[styles.dialog, Shadows.xl]} showsVerticalScrollIndicator={false}>
              {selected ? (
                <>
                  <View style={styles.dialogHeader}>
                    <Text style={styles.dialogTitle}>{selected.title}</Text>
                    <View style={styles.dialogHeaderActions}>
                      {canEdit ? (
                        <>
                          <Pressable onPress={() => openEdit(selected)} hitSlop={8} accessibilityLabel="Edit">
                            <Pencil size={18} color={Colors.blue700} />
                          </Pressable>
                          <Pressable onPress={() => setToDelete(selected)} hitSlop={8} accessibilityLabel="Delete">
                            <Trash2 size={18} color={Colors.red600} />
                          </Pressable>
                        </>
                      ) : null}
                      <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                        <X size={20} color={Colors.gray500} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.detailGrid}>
                    {detailFields?.map((field) =>
                      field.multiline ? (
                        <View key={field.label} style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>{field.label}</Text>
                          <Text style={styles.detailBlockValue}>{field.value}</Text>
                        </View>
                      ) : (
                        <View key={field.label} style={styles.detailItem}>
                          <Text style={styles.detailLabel}>{field.label}</Text>
                          <Text style={styles.detailValue}>{field.value}</Text>
                        </View>
                      )
                    )}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => !saving && setEditing(null)}>
          <Pressable style={styles.dialogWrap} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              style={[styles.dialog, Shadows.xl]}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.dialogHeader}>
                <Text style={styles.dialogTitle}>Edit {editing?.title}</Text>
                <Pressable onPress={() => !saving && setEditing(null)} hitSlop={8}>
                  <X size={20} color={Colors.gray500} />
                </Pressable>
              </View>
              {config.editFields?.map((field) => {
                const value = form[field.key] ?? '';
                const onChange = (v: string) => setForm((prev) => ({ ...prev, [field.key]: v }));
                if (field.type === 'select') {
                  const base = typeof field.options === 'function' ? field.options(ctx) : field.options || [];
                  // Keep the current value selectable even if it isn't in the list.
                  const options = value && !base.some((o) => o.value === value)
                    ? [{ value, label: value }, ...base]
                    : base;
                  return (
                    <Select
                      key={field.key}
                      label={field.label}
                      value={value}
                      onValueChange={onChange}
                      options={options}
                      searchable={options.length > 8}
                    />
                  );
                }
                return (
                  <Input
                    key={field.key}
                    label={field.label}
                    value={value}
                    onChangeText={onChange}
                    multiline={field.type === 'multiline'}
                    numberOfLines={field.type === 'multiline' ? 3 : undefined}
                    keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                    style={field.type === 'multiline' ? styles.multiline : undefined}
                  />
                );
              })}
              {formError ? <Text style={styles.formError}>{formError}</Text> : null}
              <View style={styles.formButtons}>
                <Button variant="outline" onPress={() => setEditing(null)} disabled={saving} style={styles.flex1}>
                  Cancel
                </Button>
                <Button onPress={() => setConfirmSave(true)} loading={saving} style={styles.flex1}>
                  Save changes
                </Button>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title="Save these changes?"
        description={`Save the edited details for ${editing?.title ?? 'this record'}? Every account will see the change.`}
        confirmLabel="Save"
        loading={saving}
        onConfirm={() => {
          setConfirmSave(false);
          void saveEdit();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete ${toDelete?.title ?? 'this record'}?`}
        description={config.deleteWarning || 'This removes the record for every account. This cannot be undone.'}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, gap: 12 },
  title: { fontSize: 20, fontWeight: '900', color: Colors.gray900 },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: -6 },
  errorText: { textAlign: 'center', color: Colors.red700, marginTop: 24, fontSize: 13 },
  empty: { textAlign: 'center', color: Colors.mutedForeground, marginTop: 32, fontSize: 13 },
  list: { gap: 10 },
  row: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 3,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: Colors.gray900, flex: 1 },
  rowMeta: { fontSize: 12, color: Colors.mutedForeground },
  rowActions: { flexDirection: 'row', gap: 18, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionEdit: { fontSize: 12.5, fontWeight: '700', color: Colors.blue700 },
  actionDelete: { fontSize: 12.5, fontWeight: '700', color: Colors.red600 },
  dialogHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  formContent: { gap: 12 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  formError: { color: Colors.red700, fontSize: 12.5 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 8 },
  flex1: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialogWrap: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
  },
  dialogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: Colors.gray900, flex: 1 },
  detailGrid: { marginTop: 14, gap: 12 },
  detailItem: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 12.5, color: Colors.mutedForeground, flexShrink: 0 },
  detailValue: { fontSize: 12.5, color: Colors.foreground, fontWeight: '600', flex: 1, textAlign: 'right' },
  detailBlock: { gap: 4 },
  detailBlockValue: {
    fontSize: 13,
    color: Colors.foreground,
    fontWeight: '500',
    lineHeight: 18,
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    padding: 10,
  },
});
