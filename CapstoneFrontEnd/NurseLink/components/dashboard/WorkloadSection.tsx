import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, LayoutChangeEvent, ViewStyle } from 'react-native';
import {
  Users, Edit2, Trash2, Search, UserPlus, ChevronLeft, ChevronRight, ArrowDown, ArrowUp,
} from 'lucide-react-native';
import { Card, CardContent } from '../Card';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { NurseAssignModal, type AssignTarget } from '../NurseAssignModal';
import { assignNurse, deleteAssignment, ApiError } from '../../services/api';
import type { PatientAssignment } from '../../types';
import type { WorkloadData } from '../../types/domain';
import { Colors } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';
import { AN } from './AnalyticsSection';

interface WorkloadSectionProps {
  workloadData: WorkloadData[];
  assignments: PatientAssignment[];
  loading: boolean;
  onAssignPatientClick: () => void;
  onEditAssignment: (assignment: PatientAssignment) => void;
  onRefresh: () => void | Promise<void>;
  style?: ViewStyle;
}

type SortKey = 'patientCount' | 'taskCount' | 'overdueTasks' | 'completionRate';
const PAGE_SIZE = 5;
/** Below this card width the table scrolls sideways inside the card rather
 * than squeezing columns until the text is unreadable. */
const TABLE_MIN_WIDTH = 660;

function completionRate(n: WorkloadData): number {
  return n.taskCount ? Math.round((n.completedTasks / n.taskCount) * 100) : 0;
}

/** "Ana Cruz" -> "AC" — nurses have no profile photos, so initials stand in. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const COLS = {
  name: 2.55, dept: 1.35, status: 1.0, patients: 0.68, tasks: 0.95, completed: 0.9, rate: 1.3, overdue: 0.72, overtime: 0.78, action: 0.3,
};

/**
 * Nurse Workload — a compact, sortable, paginated table of every nurse's
 * patients and tasks (from /workload/), plus the active patient
 * assignments view. Owns its own nurse-reassign and delete-assignment
 * mutations; creating/editing an assignment opens the page's shared
 * AssignPatientModal instead.
 */
export function WorkloadSection({
  workloadData,
  assignments,
  loading,
  onAssignPatientClick,
  onEditAssignment,
  onRefresh,
  style,
}: WorkloadSectionProps) {
  const toast = useToast();
  const [view, setView] = useState<'nurses' | 'assignments'>('nurses');
  const [nurseSearch, setNurseSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setCardWidth(e.nativeEvent.layout.width), []);

  const sorted = useMemo(() => {
    const q = nurseSearch.trim().toLowerCase();
    const base = q ? workloadData.filter((n) => n.nurseName.toLowerCase().includes(q)) : workloadData;
    if (!sortKey) return base;
    const value = (n: WorkloadData) => (sortKey === 'completionRate' ? completionRate(n) : n[sortKey]);
    return [...base].sort((a, b) => (sortDir === 'asc' ? value(a) - value(b) : value(b) - value(a)));
  }, [workloadData, nurseSearch, sortKey, sortDir]);

  const pageCount = Math.max(Math.ceil(sorted.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, pageCount - 1);
  const rows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleAssignSave = async (data: { department: string; shift: string }) => {
    if (!assignTarget) return;
    try {
      await assignNurse(assignTarget.id, data);
      await onRefresh();
      toast.success('Nurse assignment updated');
    } catch (error) {
      toast.error('Failed to update assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      throw error;
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteAssignment(toDelete);
      await onRefresh();
      toast.success('Assignment removed');
    } catch (error) {
      toast.error('Failed to delete assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setToDelete(null);
      setDeleteOpen(false);
    }
  };

  const tableWidth = Math.max(cardWidth - 32, TABLE_MIN_WIDTH);

  const head = (label: string, flex: number, sort?: SortKey, align: 'left' | 'right' = 'right') => {
    const active = sort && sortKey === sort;
    const content = (
      <View style={[styles.headCell, { flex, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }]}>
        <Text style={[styles.headText, active && styles.headTextActive]} numberOfLines={1}>{label}</Text>
        {active ? (sortDir === 'desc' ? <ArrowDown size={10} color={AN.blue} /> : <ArrowUp size={10} color={AN.blue} />) : null}
      </View>
    );
    return sort ? (
      <Pressable key={label} style={{ flex }} onPress={() => toggleSort(sort)}>{content}</Pressable>
    ) : (
      <React.Fragment key={label}>{content}</React.Fragment>
    );
  };

  const table = (
    <View style={{ width: tableWidth }}>
      <View style={styles.headRow}>
        {head('Nurse Name', COLS.name, undefined, 'left')}
        {head('Department', COLS.dept, undefined, 'left')}
        {head('Status', COLS.status, undefined, 'left')}
        {head('Patients', COLS.patients, 'patientCount')}
        {head('Total Tasks', COLS.tasks, 'taskCount')}
        {head('Completed', COLS.completed, undefined)}
        {head('Completion Rate', COLS.rate, 'completionRate')}
        {head('Overdue', COLS.overdue, 'overdueTasks')}
        {head('Overtime', COLS.overtime, undefined)}
        <View style={{ flex: COLS.action }} />
      </View>
      {rows.map((nurse) => {
        const rate = completionRate(nurse);
        const onDuty = Boolean(nurse.shift);
        return (
          <View key={nurse.nurseId} style={styles.row}>
            <View style={[styles.cell, styles.nameCell, { flex: COLS.name }]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(nurse.nurseName)}</Text>
              </View>
              <Text style={styles.nameText} numberOfLines={1}>{nurse.nurseName}</Text>
            </View>
            <Text style={[styles.cellText, { flex: COLS.dept }]} numberOfLines={1}>{nurse.department || '—'}</Text>
            <View style={[styles.cell, { flex: COLS.status }]}>
              <View style={[styles.statusBadge, onDuty ? styles.statusOn : styles.statusOff]}>
                <View style={[styles.statusDot, { backgroundColor: onDuty ? AN.green : Colors.gray400 }]} />
                <Text style={[styles.statusText, { color: onDuty ? AN.green : Colors.gray500 }]}>
                  {onDuty ? 'On Duty' : 'Off Duty'}
                </Text>
              </View>
            </View>
            <Text style={[styles.numText, { flex: COLS.patients }]}>{nurse.patientCount}</Text>
            <Text style={[styles.numText, { flex: COLS.tasks }]}>{nurse.taskCount}</Text>
            <Text style={[styles.numText, { flex: COLS.completed }]}>{nurse.completedTasks}</Text>
            <Text style={[styles.numText, { flex: COLS.rate, color: rate >= 80 ? AN.green : AN.text, fontWeight: '600' }]}>{rate}%</Text>
            <Text style={[styles.numText, { flex: COLS.overdue }, nurse.overdueTasks > 0 && styles.overdueText]}>{nurse.overdueTasks}</Text>
            <Text style={[styles.numText, { flex: COLS.overtime }]}>{nurse.overtimeHours}h</Text>
            <View style={[styles.cell, { flex: COLS.action, justifyContent: 'flex-end' }]}>
              <Pressable
                accessibilityLabel={`Assign ${nurse.nurseName} to a department or shift`}
                hitSlop={6}
                style={styles.rowAction}
                onPress={() => {
                  setAssignTarget({
                    id: nurse.nurseId,
                    name: nurse.nurseName,
                    email: nurse.nurseEmail,
                    department: nurse.department,
                    shift: nurse.shift,
                    presence: nurse.presence,
                    lastSeenAt: nurse.lastSeenAt,
                  });
                  setAssignOpen(true);
                }}
              >
                <Edit2 size={12} color={AN.text2} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.card, style]} onLayout={onLayout}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Users size={15} color={AN.blue} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.title}>Nurse Workload</Text>
          <Text style={styles.subtitle}>Per-nurse workload and active patient assignments</Text>
        </View>
        <Button size="sm" onPress={onAssignPatientClick}>
          <UserPlus size={14} color={Colors.white} />
          <Text style={styles.btnText}>Assign Patient</Text>
        </Button>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.segment}>
          {(['nurses', 'assignments'] as const).map((key) => (
            <Pressable key={key} onPress={() => setView(key)} style={[styles.segmentItem, view === key && styles.segmentItemActive]}>
              <Text style={[styles.segmentText, view === key && styles.segmentTextActive]}>
                {key === 'nurses' ? 'Nurses' : `Assignments (${assignments.length})`}
              </Text>
            </Pressable>
          ))}
        </View>
        {view === 'nurses' ? (
          <View style={styles.search}>
            <Search size={13} color={AN.text2} />
            <TextInput
              value={nurseSearch}
              onChangeText={(v) => {
                setNurseSearch(v);
                setPage(0);
              }}
              placeholder="Search nurses by name"
              placeholderTextColor={AN.text2}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>
        ) : null}
      </View>

      {view === 'nurses' ? (
        loading && !workloadData.length ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : sorted.length === 0 ? (
          <Text style={styles.empty}>{nurseSearch ? `No nurses match "${nurseSearch}".` : 'No nurses found for these filters.'}</Text>
        ) : (
          <>
            {tableWidth > cardWidth - 32 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator>{table}</ScrollView>
            ) : (
              table
            )}
            <View style={styles.pager}>
              <Text style={styles.pagerText}>
                Showing {safePage * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE + PAGE_SIZE, sorted.length)} of {sorted.length} nurses
              </Text>
              {pageCount > 1 ? (
                <View style={styles.pagerButtons}>
                  <Pressable disabled={safePage === 0} onPress={() => setPage((p) => Math.max(p - 1, 0))} style={[styles.pageBtn, safePage === 0 && styles.pageBtnDisabled]}>
                    <ChevronLeft size={13} color={AN.text2} />
                  </Pressable>
                  {Array.from({ length: pageCount }, (_, i) => (
                    <Pressable key={i} onPress={() => setPage(i)} style={[styles.pageBtn, i === safePage && styles.pageBtnActive]}>
                      <Text style={[styles.pageBtnText, i === safePage && styles.pageBtnTextActive]}>{i + 1}</Text>
                    </Pressable>
                  ))}
                  <Pressable disabled={safePage === pageCount - 1} onPress={() => setPage((p) => Math.min(p + 1, pageCount - 1))} style={[styles.pageBtn, safePage === pageCount - 1 && styles.pageBtnDisabled]}>
                    <ChevronRight size={13} color={AN.text2} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </>
        )
      ) : (
        <View style={styles.gap10}>
          {!loading && assignments.length === 0 ? (
            <View style={styles.emptyBox}>
              <Users size={24} color={Colors.gray400} />
              <Text style={styles.emptyInline}>No patient assignments yet</Text>
            </View>
          ) : (
            assignments.map((a) => (
              <Card key={a.id}>
                <CardContent style={styles.assignCard}>
                  <View style={styles.assignHeader}>
                    <View style={styles.flex1}>
                      <Text style={styles.assignName}>{a.patientName}</Text>
                      <Text style={styles.assignMeta}>{a.patientId} · {a.room} · {a.ward}</Text>
                    </View>
                    <Badge variant={a.priority === 'urgent' ? 'destructive' : 'outline'}>{a.priority.toUpperCase()}</Badge>
                  </View>
                  {a.diagnosis ? <Text style={styles.assignDiagnosis}>{a.diagnosis}</Text> : null}
                  <Text style={styles.assignedTo}>Assigned to {a.assignedNurse}</Text>
                  {a.notes ? <Text style={styles.assignMeta}>{a.notes}</Text> : null}
                  <View style={styles.assignActions}>
                    <Button size="sm" variant="outline" onPress={() => onEditAssignment(a)}>
                      <Edit2 size={13} color={Colors.foreground} />
                      <Text style={styles.outlineText}>Edit</Text>
                    </Button>
                    <Button size="sm" variant="destructive" onPress={() => { setToDelete(a.id); setDeleteOpen(true); }}>
                      <Trash2 size={13} color={Colors.white} />
                      <Text style={styles.btnText}>Remove</Text>
                    </Button>
                  </View>
                </CardContent>
              </Card>
            ))
          )}
        </View>
      )}

      <NurseAssignModal open={assignOpen} onOpenChange={setAssignOpen} nurse={assignTarget} onSave={handleAssignSave} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove Assignment"
        description="Are you sure you want to remove this patient assignment?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        destructive
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  gap10: { gap: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AN.border,
    padding: 16,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
    minWidth: 0,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  headerIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: AN.blueSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: AN.navy },
  subtitle: { fontSize: 11.5, color: AN.text2, marginTop: 1 },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 12.5 },
  outlineText: { color: Colors.foreground, fontWeight: '600', fontSize: 12.5 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  segment: { flexDirection: 'row', backgroundColor: '#F3F7FF', borderRadius: 8, padding: 2 },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  segmentItemActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontSize: 11.5, color: AN.text2, fontWeight: '600' },
  segmentTextActive: { color: AN.navy },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: AN.border, borderRadius: 8,
    paddingHorizontal: 8, height: 30, minWidth: 190,
  },
  searchInput: { flex: 1, fontSize: 12, color: AN.text, paddingVertical: 0, outlineStyle: 'none' as never },
  headRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: AN.border, paddingBottom: 6, gap: 6 },
  headCell: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headText: { fontSize: 10, fontWeight: '600', color: AN.text2 },
  headTextActive: { color: AN.blue },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 34, borderBottomWidth: 1, borderBottomColor: '#EEF3FB', gap: 6 },
  cell: { flexDirection: 'row', alignItems: 'center' },
  nameCell: { gap: 7, minWidth: 0 },
  avatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: AN.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 8.5, fontWeight: '700', color: AN.blue },
  nameText: { flex: 1, fontSize: 11.5, fontWeight: '600', color: AN.navy },
  cellText: { fontSize: 11.5, color: AN.text },
  numText: { fontSize: 11.5, color: AN.text, textAlign: 'right' },
  overdueText: { color: AN.red, fontWeight: '700' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  statusOn: { backgroundColor: AN.greenSoft },
  statusOff: { backgroundColor: '#F1F5F9' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '600' },
  rowAction: { padding: 4, borderRadius: 6 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8 },
  pagerText: { fontSize: 11, color: AN.text2 },
  pagerButtons: { flexDirection: 'row', gap: 6 },
  pageBtn: {
    minWidth: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: AN.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  pageBtnActive: { backgroundColor: AN.blue, borderColor: AN.blue },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 11, color: AN.text, fontWeight: '600' },
  pageBtnTextActive: { color: '#FFFFFF' },
  empty: { fontSize: 12.5, color: AN.text2, textAlign: 'center', paddingVertical: 28 },
  emptyBox: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  emptyInline: { fontSize: 12.5, color: AN.text2 },
  assignCard: { padding: 12, gap: 6 },
  assignHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  assignName: { fontSize: 13.5, fontWeight: '700', color: AN.navy },
  assignMeta: { fontSize: 11.5, color: AN.text2, marginTop: 1 },
  assignDiagnosis: { fontSize: 12.5, color: AN.text },
  assignedTo: { fontSize: 11.5, fontWeight: '600', color: Colors.blue700 },
  assignActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
