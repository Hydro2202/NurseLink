import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate, useSearchParams } from 'react-router';
import type { AnalyticsData, Department, PatientAssignmentRecord, Patient, Task, WorkloadData } from '../types/domain';
import {
  fetchPatients,
  fetchTasks,
  fetchWorkload,
  fetchAnalytics,
  fetchAssignments,
  fetchDepartments,
  createAssignment,
  updateAssignment,
} from '../api/nurselink';
import { ApiError } from '../api/client';
import { useLiveRefresh } from '../contexts/LiveContext';
import { toast } from 'sonner';
import { Heart, AlertTriangle, CheckCircle, Clock, Users, LogOut } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { AssignPatientModal, type PatientAssignment } from '../components/AssignPatientModal';
import { WorkloadSection } from '../components/dashboard/WorkloadSection';
import { AnalyticsSection } from '../components/dashboard/AnalyticsSection';
import { FilterBar } from '../components/dashboard/FilterBar';
import { SectionNav, type DashboardSection } from '../components/dashboard/SectionNav';
import {
  DEFAULT_FILTERS,
  filterPatients,
  filterTasks,
  loadSavedFilters,
  saveFilters,
  toApiParams,
  resolveDateRange,
  type DashboardFilters,
} from '../utils/dashboardFilters';

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

function StatCard({ title, value, subtitle, icon: Icon, iconBg, iconColor }: {
  title: string; value: string; subtitle?: string;
  icon: React.ComponentType<{ className?: string }>; iconBg: string; iconColor: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`p-1.5 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
          </div>
          <p className={`text-[10px] font-medium ${iconColor} uppercase tracking-wide`}>{title}</p>
        </div>
        <h3 className="text-xl font-bold">{value}</h3>
        {subtitle ? <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
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
  const [searchParams] = useSearchParams();
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
  const [activeSection, setActiveSection] = useState('overview');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadPatientsAndTasks = React.useCallback(async () => {
    if (isStaffNurse) return;
    try {
      const [patientData, taskData] = await Promise.all([fetchPatients(), fetchTasks()]);
      setPatients(patientData);
      setTasks(taskData);
    } catch (error) {
      console.error('Failed to load analytics page data:', error);
    }
  }, [isStaffNurse]);

  useEffect(() => {
    void loadPatientsAndTasks();
  }, [loadPatientsAndTasks]);

  useLiveRefresh('tasks', () => void loadPatientsAndTasks());
  useLiveRefresh('patients', () => void loadPatientsAndTasks());

  useEffect(() => {
    if (isStaffNurse) return;
    setFilters(loadSavedFilters());
    setFiltersLoaded(true);
  }, [isStaffNurse]);

  useEffect(() => {
    if (isStaffNurse || !filtersLoaded) return;
    saveFilters(filters);
  }, [filters, isStaffNurse, filtersLoaded]);

  useEffect(() => {
    if (isStaffNurse) return;
    fetchDepartments().then(setDepartments).catch(() => {
      // Non-critical — the Department filter just shows no options.
    });
  }, [isStaffNurse]);

  const loadWorkloadAndAnalytics = React.useCallback(async () => {
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
      console.error('Failed to load workload/analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [isStaffNurse, filtersLoaded, filters]);

  useEffect(() => {
    void loadWorkloadAndAnalytics();
  }, [loadWorkloadAndAnalytics]);

  const scrollToSection = React.useCallback((key: string) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // An old Workload Monitor link, or a link typed by hand, lands on
  // /analytics?section=workload — jump straight to that section once it
  // has actually rendered rather than at the top.
  useEffect(() => {
    const section = searchParams.get('section');
    if (!section) return;
    const id = setTimeout(() => scrollToSection(section), 50);
    return () => clearTimeout(id);
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
  const highRiskPatients = filteredPatients.filter((p) => p.riskLevel === 'high' || p.riskLevel === 'critical').length;

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
      toast.error(error instanceof ApiError ? error.message : 'Failed to save assignment');
    }
  };

  // Staff nurses have no Analytics of their own — bounce to their dashboard.
  if (isStaffNurse) {
    return <Navigate to="/dashboard" replace />;
  }

  const filterSummary = filterSummaryLabel(filters, departments);

  return (
    <div className="pb-8">
      <SectionNav sections={ANALYTICS_SECTIONS} activeKey={activeSection} onSelect={scrollToSection} />

      <div className="bg-card border-b border-border py-6">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Operations overview, charts and nurse workload</p>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        departments={departments}
        nurses={availableNurses}
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6 mt-6">
        <div ref={(el) => { sectionRefs.current.overview = el; }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Patients"
            value={String(filteredPatients.length)}
            subtitle="Match current filters"
            icon={Heart}
            iconBg="bg-purple-100"
            iconColor="text-purple-600"
          />
          <StatCard
            title="High Risk"
            value={String(highRiskPatients)}
            subtitle="High/critical risk patients"
            icon={AlertTriangle}
            iconBg="bg-red-100"
            iconColor="text-red-600"
          />
          <StatCard
            title="Tasks Pending"
            value={String(pendingCount + inProgressCount)}
            subtitle="Pending + in progress"
            icon={Clock}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            title="Tasks Overdue"
            value={String(overdueTasks)}
            subtitle="Needs attention"
            icon={AlertTriangle}
            iconBg="bg-orange-100"
            iconColor="text-orange-600"
          />
          <StatCard
            title="Tasks Completed"
            value={String(completedTasks)}
            subtitle={filterSummary}
            icon={CheckCircle}
            iconBg="bg-green-100"
            iconColor="text-green-600"
          />
          <StatCard
            title="Nurses on Duty"
            value={String(workloadData.length)}
            subtitle="Match current filters"
            icon={Users}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            title="Discharged"
            value={String(dischargedInPeriod)}
            subtitle={filterSummary}
            icon={LogOut}
            iconBg="bg-gray-100"
            iconColor="text-gray-600"
          />
        </div>

        <div ref={(el) => { sectionRefs.current.workload = el; }}>
          <WorkloadSection
            workloadData={workloadData}
            assignments={assignments}
            loading={analyticsLoading}
            onAssignPatientClick={handleAssignPatientClick}
            onEditAssignment={handleEditAssignment}
            onRefresh={loadWorkloadAndAnalytics}
          />
        </div>

        <div ref={(el) => { sectionRefs.current.charts = el; }}>
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Charts</h2>
            <p className="text-sm text-gray-500">{filterSummary}</p>
          </div>
          <AnalyticsSection data={analyticsData} loading={analyticsLoading} filterSummary={filterSummary} />
        </div>
      </div>

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
    </div>
  );
}
