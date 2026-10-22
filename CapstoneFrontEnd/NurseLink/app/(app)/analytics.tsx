import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, findNodeHandle, LayoutChangeEvent } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Users, AlertTriangle, ClipboardList, Clock, CheckCircle, UserRound, FileText } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import type {
  AnalyticsData, Department, PatientAssignmentRecord, Patient, Task, WorkloadData,
} from '../../types/domain';
import type { PatientAssignment } from '../../types';
import {
  fetchPatients,
  fetchTasks,
  fetchWorkload,
  fetchAnalytics,
  fetchAssignments,
  fetchDepartments,
  createAssignment,
  updateAssignment,
  ApiError,
} from '../../services/api';
import { useLiveRefresh } from '../../contexts/LiveContext';
import { AssignPatientModal } from '../../components/AssignPatientModal';
import { WorkloadSection } from '../../components/dashboard/WorkloadSection';
import {
  AN,
  PatientFlowCard,
  PatientStatusCard,
  TaskPerformanceCard,
  TaskVolumeCard,
  ShiftDelayCard,
  TaskTypeCard,
} from '../../components/dashboard/AnalyticsSection';
import { FilterBar } from '../../components/dashboard/FilterBar';
import {
  DEFAULT_FILTERS,
  filterPatients,
  filterTasks,
  loadSavedFilters,
  saveFilters,
  toApiParams,
  resolveDateRange,
  type DashboardFilters,
} from '../../utils/dashboardFilters';

function toLocalAssignment(record: PatientAssignmentRecord): PatientAssignment {
  return {
    id: record.id,
    patientName: record.patientName,
    patientId: record.patientId,
    room: record.room,
    ward: record.ward,
    diagnosis: record.diagnosis,
    assignedNurse: record.assignedNurse,
    assignedNurseId: record.assignedNurseId,
    priority: record.priority,
    notes: record.notes,
    status: record.status,
    assignedAt: new Date(record.assignedAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function toIsoLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso() {
  return toIsoLocal(new Date());
}
function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
}

function filterSummaryLabel(filters: DashboardFilters, departments: Department[]): string {
  const range = resolveDateRange(filters);
  const parts: string[] = [];
  if (!range) parts.push('Last 7 days');
  else if (range.startDate === range.endDate) parts.push(range.startDate === todayIso() ? 'Today' : range.startDate);
  else parts.push(`${range.startDate} – ${range.endDate}`);
  if (filters.departmentId) {
    const dept = departments.find((d) => String(d.id) === filters.departmentId);
    if (dept) parts.push(dept.name);
  }
  if (filters.shift) parts.push(`${filters.shift.charAt(0).toUpperCase()}${filters.shift.slice(1)} shift`);
  if (filters.nurseId) parts.push('1 nurse');
  if (filters.risk) parts.push(`${filters.risk} risk`);
  return parts.join(' · ');
}

/** "12% of total patients" — only when the denominator is the same filtered
 * set the numerator came from; never a percentage of an empty set. */
function shareOf(part: number, total: number, noun: string): string {
  return total > 0 ? `${Math.round((part / total) * 100)}% of total ${noun}` : `No ${noun} in this view`;
}

type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  tint: string;
  color: string;
  /** Colors the label too, for the cards the reference calls out (high
   * risk, overdue, completed, on duty). */
  accentLabel?: boolean;
  width: number;
};

function StatCard({ title, value, subtitle, icon: Icon, tint, color, accentLabel, width }: StatCardProps) {
  return (
    <View style={[styles.statCard, { width }]}>
      <View style={[styles.statIconWrap, { backgroundColor: tint }]}>
        <Icon size={18} color={color} />
      </View>
      <View style={styles.statBody}>
        <Text style={[styles.statTitle, accentLabel && { color }]} numberOfLines={1}>{title}</Text>
        <Text style={styles.statValue}>{value}</Text>
        {subtitle ? <Text style={styles.statSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const GAP = 12;
const BODY_PAD = 16;

/**
 * The single Analytics destination for a head nurse — stat cards, all 5
 * Analytics charts and the Nurse Workload / Patient Assignments tables, all
 * in one place with one shared filter bar (see utils/dashboardFilters.ts).
 * Replaces what used to be two separate pages (Analytics, Workload Monitor)
 * and, before that, a section folded into the dashboard itself — the
 * dashboard now only links here via "View all analytics →".
 */
export default function AnalyticsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const params = useLocalSearchParams<{ section?: string }>();
  const isStaffNurse = user?.role === 'staff_nurse';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workloadData, setWorkloadData] = useState<WorkloadData[]>([]);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<PatientAssignment | null>(null);
  const sectionRefs = useRef<Record<string, View | null>>({});
  const scrollRef = useRef<ScrollView>(null);
  // Breakpoints follow the content area's own width (the sidebar already
  // takes ~250px of the window on desktop), not the window's.
  const [bodyWidth, setBodyWidth] = useState(0);
  const onBodyLayout = useCallback((e: LayoutChangeEvent) => {
    // layout.width includes the body's own horizontal padding.
    const next = e.nativeEvent.layout.width - BODY_PAD * 2;
    setBodyWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  const loadPatientsAndTasks = useCallback(async () => {
    if (isStaffNurse) return;
    try {
      const [patientData, taskData] = await Promise.all([fetchPatients(), fetchTasks()]);
      setPatients(patientData);
      setTasks(taskData);
    } catch (error) {
      console.warn('Failed to load analytics page data:', error);
    }
  }, [isStaffNurse]);

  useEffect(() => {
    (async () => {
      await loadPatientsAndTasks();
    })();
  }, [loadPatientsAndTasks]);

  useEffect(() => {
    if (isStaffNurse) return;
    (async () => {
      const saved = await loadSavedFilters();
      setFilters(saved);
      setFiltersLoaded(true);
    })();
  }, [isStaffNurse]);

  useEffect(() => {
    if (isStaffNurse || !filtersLoaded) return;
    void saveFilters(filters);
  }, [filters, isStaffNurse, filtersLoaded]);

  useEffect(() => {
    if (isStaffNurse) return;
    fetchDepartments().then(setDepartments).catch(() => {
      // Non-critical — the Department filter just shows no options.
    });
  }, [isStaffNurse]);

  const loadWorkloadAndAnalytics = useCallback(async () => {
    if (isStaffNurse || !filtersLoaded) return;
    const apiParams = toApiParams(filters);
    setAnalyticsLoading(true);
    try {
      const [workload, assignmentData, analytics] = await Promise.all([
        fetchWorkload(apiParams),
        fetchAssignments({ status: 'active' }),
        fetchAnalytics(apiParams),
      ]);
      setWorkloadData(workload);
      setAssignments(assignmentData.map(toLocalAssignment));
      setAnalyticsData(analytics);
    } catch (error) {
      console.warn('Failed to load workload/analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [isStaffNurse, filtersLoaded, filters]);

  useEffect(() => {
    (async () => {
      await loadWorkloadAndAnalytics();
    })();
  }, [loadWorkloadAndAnalytics]);

  useLiveRefresh('tasks', () => {
    void loadPatientsAndTasks();
  });
  useLiveRefresh('patients', () => {
    void loadPatientsAndTasks();
  });

  // Deep links (?section=...) from notifications still jump to a section;
  // the on-page tab bar was removed.
  const scrollToSection = useCallback((key: string) => {
    const node = sectionRefs.current[key];
    const scrollNode = findNodeHandle(scrollRef.current);
    if (!node || scrollNode === null) return;
    node.measureLayout(
      scrollNode,
      (_x: number, y: number) => {
        scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
      },
      () => {
        // Not measurable yet — a manual tap can simply be pressed again.
      }
    );
  }, []);

  // An old Workload Monitor link, or a link typed by hand, lands on
  // /(app)/analytics?section=workload — jump straight to that section once
  // it has actually rendered rather than at the top.
  useEffect(() => {
    if (!params.section) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (sectionRefs.current[params.section as string]) {
        scrollToSection(params.section as string);
        clearInterval(id);
      } else if (attempts > 10) {
        clearInterval(id);
      }
    }, 150);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patientById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const selectedNurseName = useMemo(
    () => workloadData.find((n) => n.nurseId === filters.nurseId)?.nurseName,
    [workloadData, filters.nurseId]
  );
  const filteredPatients = useMemo(() => filterPatients(patients, filters), [patients, filters]);
  const filteredTasks = useMemo(
    () => filterTasks(tasks, filters, { patientById, nurseName: selectedNurseName }),
    [tasks, filters, patientById, selectedNurseName]
  );

  const overdueTasks = filteredTasks.filter((t) => t.status === 'overdue').length;
  const completedTasks = filteredTasks.filter((t) => t.status === 'completed').length;
  const pendingCount = filteredTasks.filter((t) => t.status === 'pending').length;
  const inProgressCount = filteredTasks.filter((t) => t.status === 'in_progress').length;
  const highRiskPatients = filteredPatients.filter(
    (p) => p.riskLevel === 'high' || p.riskLevel === 'critical'
  ).length;

  const dischargedInPeriod = useMemo(() => {
    const range = resolveDateRange(filters);
    const start = range ? range.startDate : addDays(todayIso(), -6);
    const end = range ? range.endDate : todayIso();
    return filterPatients(patients, filters).filter((p) => {
      if (p.status !== 'discharged' || !p.dischargedAt) return false;
      const d = p.dischargedAt.slice(0, 10);
      return d >= start && d <= end;
    }).length;
  }, [patients, filters]);

  // workloadData lists every nurse matching the filters; a nurse is on duty
  // only while /workload/ reports a current or upcoming duty shift for them.
  const nursesOnDuty = workloadData.filter((n) => Boolean(n.shift)).length;

  const availableNurses = useMemo(
    () => workloadData.map((n) => ({ id: n.nurseId, name: n.nurseName, patientCount: n.patientCount })),
    [workloadData]
  );

  const handleAssignPatientClick = () => {
    setEditingAssignment(null);
    setAssignModalOpen(true);
  };

  const handleEditAssignment = (assignment: PatientAssignment) => {
    setEditingAssignment(assignment);
    setAssignModalOpen(true);
  };

  const handleAssignSubmit = async (
    data: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>
  ) => {
    try {
      const payload = {
        patientId: data.patientId,
        nurseId: data.assignedNurseId,
        nurseName: data.assignedNurse,
        priority: data.priority,
        notes: data.notes,
        ward: data.ward,
      };
      const saved = editingAssignment
        ? await updateAssignment(editingAssignment.id, payload)
        : await createAssignment(payload);
      const local = toLocalAssignment(saved);
      setAssignments((prev) =>
        editingAssignment
          ? prev.map((a) => (a.id === editingAssignment.id ? local : a))
          : [local, ...prev.filter((a) => a.patientId !== local.patientId)]
      );
      await Promise.all([loadPatientsAndTasks(), loadWorkloadAndAnalytics()]);
      setEditingAssignment(null);
      setAssignModalOpen(false);
      toast.success(editingAssignment ? 'Assignment updated' : 'Patient assigned');
    } catch (error) {
      toast.error('Failed to save assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    }
  };

  // Staff nurses have no Analytics of their own — bounce to their dashboard.
  if (isStaffNurse) {
    return <Redirect href={'/(app)/dashboard' as any} />;
  }

  const filterSummary = filterSummaryLabel(filters, departments);
  const range = resolveDateRange(filters);
  const periodLabel = range ? (range.startDate === range.endDate ? range.startDate : `${range.startDate} – ${range.endDate}`) : 'Last 7 days';
  const totalTasks = filteredTasks.length;
  const pendingTotal = pendingCount + inProgressCount;

  // Content-width breakpoints: 4+3 KPI columns, two-column chart rows, and
  // the 60/40 workload split only when there's genuinely room for them.
  const wide = bodyWidth >= 900;
  const kpiCols = wide ? 4 : bodyWidth >= 520 ? 2 : 1;
  const kpiRow2Cols = wide ? 3 : kpiCols;
  const kpiWidth = (cols: number) => Math.max((bodyWidth - GAP * (cols - 1)) / cols, 0);
  const splitBottom = bodyWidth >= 1000;
  const chartData = { data: analyticsData, loading: analyticsLoading, filterSummary };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.body} onLayout={onBodyLayout}>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            departments={departments}
            nurses={availableNurses}
          />

          <View ref={(r) => { sectionRefs.current.overview = r; }} style={styles.section}>
            <Text style={styles.sectionTitle}>Key Performance Indicators</Text>
            {bodyWidth > 0 ? (
              <View style={styles.kpiGrid}>
                <StatCard width={kpiWidth(kpiCols)} title="Total Patients" value={filteredPatients.length}
                  subtitle="Matches current filters" icon={Users} tint={AN.blueSoft} color={AN.blue} />
                <StatCard width={kpiWidth(kpiCols)} title="High-Risk Patients" value={highRiskPatients}
                  subtitle={shareOf(highRiskPatients, filteredPatients.length, 'patients')}
                  icon={AlertTriangle} tint={AN.redSoft} color={AN.red} accentLabel />
                <StatCard width={kpiWidth(kpiCols)} title="Tasks Pending" value={pendingTotal}
                  subtitle={shareOf(pendingTotal, totalTasks, 'tasks')} icon={ClipboardList} tint={AN.blueSoft} color={AN.blue} />
                <StatCard width={kpiWidth(kpiCols)} title="Tasks Overdue" value={overdueTasks}
                  subtitle={shareOf(overdueTasks, totalTasks, 'tasks')} icon={Clock} tint={AN.orangeSoft} color={AN.orange} accentLabel />
                <StatCard width={kpiWidth(kpiRow2Cols)} title="Tasks Completed" value={completedTasks}
                  subtitle={shareOf(completedTasks, totalTasks, 'tasks')} icon={CheckCircle} tint={AN.greenSoft} color={AN.green} accentLabel />
                <StatCard width={kpiWidth(kpiRow2Cols)} title="Nurses on Duty" value={nursesOnDuty}
                  subtitle="On a current or upcoming duty" icon={UserRound} tint={AN.purpleSoft} color={AN.purple} accentLabel />
                <StatCard width={kpiWidth(kpiRow2Cols)} title="Patients Discharged" value={dischargedInPeriod}
                  subtitle={periodLabel} icon={FileText} tint="#EEF2F7" color="#475569" />
              </View>
            ) : null}
          </View>

          <View ref={(r) => { sectionRefs.current.charts = r; }} style={wide ? styles.row : styles.stack}>
            <PatientFlowCard {...chartData} style={wide ? styles.colWide : undefined} />
            <PatientStatusCard {...chartData} style={wide ? styles.colNarrow : undefined} />
          </View>

          <View style={wide ? styles.row : styles.stack}>
            <TaskPerformanceCard {...chartData} style={wide ? styles.colWide : undefined} />
            <TaskVolumeCard {...chartData} style={wide ? styles.colNarrow : undefined} />
          </View>

          <View style={splitBottom ? styles.row : styles.stack}>
            <View ref={(r) => { sectionRefs.current.workload = r; }} style={splitBottom ? styles.colWorkload : undefined}>
              <WorkloadSection
                workloadData={workloadData}
                assignments={assignments}
                loading={analyticsLoading}
                onAssignPatientClick={handleAssignPatientClick}
                onEditAssignment={handleEditAssignment}
                onRefresh={loadWorkloadAndAnalytics}
              />
            </View>
            <View style={[styles.stack, splitBottom && styles.colSide]}>
              <ShiftDelayCard {...chartData} />
              <TaskTypeCard {...chartData} />
            </View>
          </View>
        </View>
      </ScrollView>

      <AssignPatientModal
        isOpen={assignModalOpen}
        onClose={() => {
          setAssignModalOpen(false);
          setEditingAssignment(null);
        }}
        onSubmit={handleAssignSubmit}
        editingAssignment={editingAssignment}
        prefill={null}
        availableNurses={availableNurses}
        allTasks={tasks}
        allAssignments={assignments}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AN.pageBg },
  scroll: { flex: 1, backgroundColor: AN.pageBg },
  scrollContent: { paddingBottom: 32 },
  body: { padding: BODY_PAD, gap: 16 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: AN.navy },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 86,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AN.border,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  statIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statBody: { flex: 1, minWidth: 0 },
  statTitle: { fontSize: 12, fontWeight: '600', color: AN.text2 },
  statValue: { fontSize: 24, fontWeight: '800', color: AN.navy, marginTop: 1 },
  statSubtitle: { fontSize: 10.5, color: AN.text2, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: GAP },
  stack: { gap: GAP },
  colWide: { flex: 1.25, minWidth: 0 },
  colNarrow: { flex: 1, minWidth: 0 },
  colWorkload: { flex: 3, minWidth: 0 },
  colSide: { flex: 2, minWidth: 0 },
});
