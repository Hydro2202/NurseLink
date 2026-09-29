import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Modal, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Search, X } from 'lucide-react-native';
import {
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
import { Colors, Shadows, Radius } from '../../../constants/colors';

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
      meta: [`${h.shift} shift · ${h.date}`, h.sbar?.situation || ''],
      search: `${h.patientName} ${h.nurseFrom} ${h.nurseTo}`,
    }),
    detailFields: (h) => [
      { label: 'Patient', value: h.patientName },
      { label: 'From nurse', value: h.nurseFrom },
      { label: 'To nurse', value: h.nurseTo },
      { label: 'Shift', value: h.shift },
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

export default function AdminGenericSectionPage() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const config = SECTIONS[section as string];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

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
    void load();
    setFilterValues({});
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
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
            {filtered.map((row) => (
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
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.dialogWrap} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={[styles.dialog, Shadows.xl]} showsVerticalScrollIndicator={false}>
              {selected ? (
                <>
                  <View style={styles.dialogHeader}>
                    <Text style={styles.dialogTitle}>{selected.title}</Text>
                    <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                      <X size={20} color={Colors.gray500} />
                    </Pressable>
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
