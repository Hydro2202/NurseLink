import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, findNodeHandle } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Heart, AlertTriangle, CheckCircle, Clock, Users, LogOut } from 'lucide-react-native';
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
import { Card, CardContent } from '../../components/Card';
import { AssignPatientModal } from '../../components/AssignPatientModal';
import { WorkloadSection } from '../../components/dashboard/WorkloadSection';
import { AnalyticsSection } from '../../components/dashboard/AnalyticsSection';
import { FilterBar } from '../../components/dashboard/FilterBar';
import { SectionNav, type DashboardSection } from '../../components/dashboard/SectionNav';
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
import { Colors, Radius } from '../../constants/colors';

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

const ANALYTICS_SECTIONS: DashboardSection[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'workload', label: 'Workload' },
  { key: 'charts', label: 'Charts' },
];

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

type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  iconBg: string;
  iconColor: string;
};

function StatCard({ title, value, subtitle, icon: Icon, iconBg, iconColor }: StatCardProps) {
  return (
    <Card style={styles.statCard}>
      <CardContent style={styles.statContent}>
        <View style={styles.statTop}>
          <View style={[styles.statIconWrap, { backgroundColor: iconBg }]}>
            <Icon size={14} color={iconColor} />
          </View>
          <Text style={[styles.statTitle, { color: iconColor }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Text style={styles.statValue}>{value}</Text>
        {subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
      </CardContent>
    </Card>
  );
}

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
  const [activeSection, setActiveSection] = useState<string>('overview');
  const sectionRefs = useRef<Record<string, View | null>>({});
  const scrollRef = useRef<ScrollView>(null);

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

  const scrollToSection = useCallback((key: string) => {
    setActiveSection(key);
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

  return (
    <View style={styles.root}>
      <SectionNav sections={ANALYTICS_SECTIONS} activeKey={activeSection} onSelect={scrollToSection} />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBar}>
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>Operations overview, charts and nurse workload</Text>
        </View>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
          departments={departments}
          nurses={availableNurses}
        />

        <View style={styles.body}>
          <View ref={(r) => { sectionRefs.current.overview = r; }} style={styles.statsGrid}>
            <StatCard
              title="Patients"
              value={String(filteredPatients.length)}
              subtitle="Match current filters"
              icon={Heart}
              iconBg={Colors.purple100}
              iconColor={Colors.purple600}
            />
            <StatCard
              title="High Risk"
              value={String(highRiskPatients)}
              subtitle="High/critical risk patients"
              icon={AlertTriangle}
              iconBg={Colors.red100}
              iconColor={Colors.red600}
            />
            <StatCard
              title="Tasks Pending"
              value={String(pendingCount + inProgressCount)}
              subtitle="Pending + in progress"
              icon={Clock}
              iconBg={Colors.blue100}
              iconColor={Colors.blue600}
            />
            <StatCard
              title="Tasks Overdue"
              value={String(overdueTasks)}
              subtitle="Needs attention"
              icon={AlertTriangle}
              iconBg={Colors.orange100}
              iconColor={Colors.orange600}
            />
            <StatCard
              title="Tasks Completed"
              value={String(completedTasks)}
              subtitle={filterSummary}
              icon={CheckCircle}
              iconBg={Colors.green100}
              iconColor={Colors.green600}
            />
            <StatCard
              title="Nurses on Duty"
              value={String(workloadData.length)}
              subtitle="Match current filters"
              icon={Users}
              iconBg={Colors.blue100}
              iconColor={Colors.blue600}
            />
            <StatCard
              title="Discharged"
              value={String(dischargedInPeriod)}
              subtitle={filterSummary}
              icon={LogOut}
              iconBg={Colors.gray100}
              iconColor={Colors.gray600}
            />
          </View>

          <View ref={(r) => { sectionRefs.current.workload = r; }}>
            <WorkloadSection
              workloadData={workloadData}
              assignments={assignments}
              loading={analyticsLoading}
              onAssignPatientClick={handleAssignPatientClick}
              onEditAssignment={handleEditAssignment}
              onRefresh={loadWorkloadAndAnalytics}
            />
          </View>

          <View ref={(r) => { sectionRefs.current.charts = r; }} style={styles.chartsSection}>
            <Text style={styles.sectionTitle}>Charts</Text>
            <Text style={styles.sectionSub}>{filterSummary}</Text>
            <AnalyticsSection data={analyticsData} loading={analyticsLoading} filterSummary={filterSummary} />
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
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 40 },
  headerBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
  body: { padding: 16, gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { width: '47%', flexGrow: 1, minWidth: 150, overflow: 'hidden' },
  statContent: { padding: 12 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statIconWrap: { width: 28, height: 28, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  statTitle: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  statValue: { fontSize: 20, fontWeight: '700', color: Colors.foreground },
  statSubtitle: { fontSize: 10, color: Colors.mutedForeground, marginTop: 2 },
  chartsSection: { marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.gray900 },
  sectionSub: { fontSize: 12, color: Colors.gray500, marginBottom: 12, marginTop: 2 },
});
