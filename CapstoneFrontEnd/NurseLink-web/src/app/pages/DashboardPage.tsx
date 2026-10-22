import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router';
import type {
  Patient, Task, WorkloadData, DutyAssignment, PatientAssignmentRecord,
} from '../types/domain';
import {
  fetchPatients,
  fetchTasks,
  fetchWorkload,
  fetchDutyAssignments,
  fetchAssignments,
  createAssignment,
  notifyPatientNurse,
  notifyTaskNurse,
} from '../api/nurselink';
import { ApiError } from '../api/client';
import { useLiveRefresh } from '../contexts/LiveContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Progress } from '../components/ui/progress';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  Heart,
  Thermometer,
  AlertCircle,
  ClipboardList,
  FileText,
  BarChart3,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import { AssignPatientModal, type AssignPatientPrefill, type PatientAssignment } from '../components/AssignPatientModal';
import { SafetyAlertsSection, type SafetyAlert } from '../components/dashboard/SafetyAlertsSection';
import { SectionNav, type DashboardSection } from '../components/dashboard/SectionNav';
import {
  DASHBOARD_HEADER_CLASS,
  DASHBOARD_CONTAINER_CLASS,
  DASHBOARD_CONTENT_CLASS,
  DASHBOARD_CARD_GRID_GAP,
  DASHBOARD_CHART_GRID_GAP,
  DASHBOARD_KPI_CARD_PADDING,
} from '../utils/dashboardLayout';

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

const DASHBOARD_SECTIONS: DashboardSection[] = [
  { key: 'alerts', label: 'Alerts' },
  { key: 'overview', label: 'Overview' },
];

// Same local-calendar-day helpers as MyDutyPage.tsx — never toISOString(),
// which converts to UTC and can shift the day.
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
function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${period}`;
}
function combine(dateIso: string, hhmm: string): Date {
  const [y, mo, da] = dateIso.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, da, h, m, 0, 0);
}
// Same midnight-wrap rule as MyDutyPage.tsx: an end time at or before the
// start time means the shift spills into the next calendar day.
function scheduledRange(a: DutyAssignment): { start: Date; end: Date } {
  const start = combine(a.dutyDate, a.startTime.slice(0, 5));
  let end = combine(a.dutyDate, a.endTime.slice(0, 5));
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
  return { start, end };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isStaffNurse = user?.role === 'staff_nurse';
  const [currentTime, setCurrentTime] = useState(new Date());
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workloadData, setWorkloadData] = useState<WorkloadData[]>([]);
  const [dutyAssignments, setDutyAssignments] = useState<DutyAssignment[]>([]);

  // Head-nurse-only: just enough workload data for the "Nurses on Duty"
  // stat card and the nurse picker in the shared Assign Patient modal — the
  // full Nurse Workload / Patient Assignments tables now live on their own
  // Analytics page (see AnalyticsPage.tsx), linked from "View all
  // analytics →" below instead of rendered inline here.
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignPrefill, setAssignPrefill] = useState<AssignPatientPrefill | null>(null);
  const [activeSection, setActiveSection] = useState('alerts');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDashboard = React.useCallback(async () => {
    try {
      const [patientData, taskData, duty] = await Promise.all([
        fetchPatients(isStaffNurse ? { mine: true } : undefined),
        fetchTasks(isStaffNurse ? { mine: true } : undefined),
        // Yesterday too: a night shift that started before midnight is
        // still "today's duty" until it ends.
        isStaffNurse
          ? fetchDutyAssignments({ dateFrom: addDays(todayIso(), -1), dateTo: todayIso() })
          : Promise.resolve([]),
      ]);
      setPatients(patientData);
      setTasks(taskData);
      setDutyAssignments(duty);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
  }, [isStaffNurse]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // The dashboard counts tasks and patients, both of which change from other
  // nurses' devices, so it follows the shared live revisions too. duty is
  // what makes a head nurse ending this nurse's shift show up here without
  // waiting for an unrelated task/patient change to trigger a refetch.
  useLiveRefresh('tasks', () => void loadDashboard());
  useLiveRefresh('patients', () => void loadDashboard());
  useLiveRefresh('duty', () => void loadDashboard());

  const loadWorkloadSummary = React.useCallback(async () => {
    if (isStaffNurse) return;
    try {
      const [workload, assignmentData] = await Promise.all([
        fetchWorkload(),
        fetchAssignments({ status: 'active' }),
      ]);
      setWorkloadData(workload);
      setAssignments(assignmentData.map(toLocalAssignment));
    } catch (error) {
      console.error('Failed to load workload summary:', error);
    }
  }, [isStaffNurse]);

  useEffect(() => {
    void loadWorkloadSummary();
  }, [loadWorkloadSummary]);

  // Presence (online/away/offline) moves on its own, with nothing else on
  // this screen changing to trigger a refetch.
  useEffect(() => {
    if (isStaffNurse) return;
    const timer = setInterval(() => {
      fetchWorkload().then(setWorkloadData).catch(() => {
        // Silent: this is a background refresh, not a user action.
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [isStaffNurse]);

  const scrollToSection = React.useCallback((key: string) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // An old safety-alert notification, or a link typed by hand, lands on
  // /dashboard?section=alerts — jump straight to that section once it has
  // actually rendered rather than at the top.
  useEffect(() => {
    const section = searchParams.get('section');
    if (!section) return;
    const id = setTimeout(() => scrollToSection(section), 50);
    return () => clearTimeout(id);
    // Only the very first render with a ?section= param should auto-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate stats — raw patients/tasks, no filter bar on this page
  // anymore (the full filterable view now lives on the Analytics page).
  const urgentTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'completed').length;
  const overdueTasks = tasks.filter(t => t.status === 'overdue').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const totalTasks = tasks.length || 1;
  const highRiskPatients = patients.filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical').length;
  const completionRate = Math.round((completedTasks / totalTasks) * 100);

  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;

  // Chart data from live task/patient records
  const staffTaskTrendData = React.useMemo(() => [
    { time: 'Pending', tasks: pendingCount, id: 'staff-t1' },
    { time: 'Active', tasks: inProgressCount, id: 'staff-t2' },
    { time: 'Overdue', tasks: overdueTasks, id: 'staff-t3' },
    { time: 'Done', tasks: completedTasks, id: 'staff-t4' },
    { time: 'Urgent', tasks: urgentTasks, id: 'staff-t5' },
  ], [pendingCount, inProgressCount, overdueTasks, completedTasks, urgentTasks]);

  // The nurse's actual scheduled shift, per the Duty Roster — the ground
  // truth for what they're working right now, as opposed to the stale
  // NurseProfile.shift default.
  const todayDuty = React.useMemo(() => {
    const today = todayIso();
    const yesterday = addDays(today, -1);
    const relevant = dutyAssignments.filter(
      (a) => (a.dutyDate === today || a.dutyDate === yesterday) && a.status !== 'cancelled'
    );
    const active = relevant.find((a) => {
      if (a.status === 'completed' || a.actualEndTime) return false;
      const { start, end } = scheduledRange(a);
      return currentTime.getTime() >= start.getTime() && currentTime.getTime() < end.getTime();
    });
    return active || relevant.find((a) => a.dutyDate === today) || null;
  }, [dutyAssignments, currentTime]);

  // Deliberately does NOT fall back to NurseProfile.shift when there's no
  // duty today — showing a shift the nurse isn't actually working is worse
  // than showing nothing. Same wording as My Duty's own empty state.
  const shiftLabel = React.useMemo(() => {
    if (!todayDuty) return 'No Duty Assigned Today';
    const start = formatTime(todayDuty.startTime.slice(0, 5));
    const end = formatTime(todayDuty.endTime.slice(0, 5));
    return `${todayDuty.shiftLabel} Shift (${start}-${end})`;
  }, [todayDuty]);

  const handleRespondToAlert = (alert: SafetyAlert) => {
    if (alert.variant === 'destructive' && alert.patient) {
      const p = alert.patient;
      setAssignPrefill({
        patientId: p.id,
        patientName: p.name,
        room: p.room || '',
        ward: p.departmentName || '',
        diagnosis: p.diagnosis || '',
        priority: p.riskLevel === 'critical' || p.riskLevel === 'high' ? 'urgent' : 'routine',
      });
      setAssignModalOpen(true);
      return;
    }
    // A delayed-task alert — Workload Monitor no longer exists as a
    // separate page to send this to, and the task itself lives on Tasks.
    navigate('/tasks');
  };

  const handleNotifyNurseFromAlert = async (alert: SafetyAlert) => {
    // Patient (critical vitals) alerts resolve the nurse server-side from
    // the patient record; task (delayed) alerts resolve it from the task's
    // own assigned_nurse account — both go through a real backend
    // notify-nurse endpoint now, so this only ever reports success when a
    // notification was actually created.
    try {
      if (alert.variant === 'destructive' && alert.patient) {
        const result = await notifyPatientNurse(alert.patient.id, alert.description);
        toast.success(result.detail);
      } else if (alert.task) {
        const result = await notifyTaskNurse(alert.task.id);
        toast.success(result.detail);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not notify the nurse.');
    }
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
      const saved = await createAssignment(payload);
      const local = toLocalAssignment(saved);
      setAssignments((prev) => [local, ...prev.filter((a) => a.patientId !== local.patientId)]);
      await Promise.all([loadDashboard(), loadWorkloadSummary()]);
      setAssignPrefill(null);
      setAssignModalOpen(false);
      toast.success('Patient assigned');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to save assignment');
    }
  };

  const availableNurses = useMemo(
    () => workloadData.map((n) => ({ id: n.nurseId, name: n.nurseName, patientCount: n.patientCount })),
    [workloadData]
  );

  const StatCard = ({ title, value, subtitle, icon: Icon, trend, trendLabel, iconBg, iconColor }: any) => (
    <Card className="overflow-hidden">
      <CardContent className={DASHBOARD_KPI_CARD_PADDING}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 ${iconBg || 'bg-gray-100'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-3.5 h-3.5 ${iconColor || 'text-gray-600'}`} />
              </div>
              <p className={`text-[10px] font-medium ${iconColor || 'text-blue-600'} uppercase tracking-wide`}>{title}</p>
            </div>
            <h3 className="text-xl font-bold">{value}</h3>
            {subtitle && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border">
            <TrendingUp className="w-3 h-3 text-green-600" />
            <span className="text-[10px] font-medium text-green-600">{trendLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (isStaffNurse) {
    return (
      <div className="pb-20 prevent-overflow">
        {/* Header */}
        <div className={DASHBOARD_HEADER_CLASS}>
          <div className={DASHBOARD_CONTAINER_CLASS}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-base sm:text-lg font-bold truncate">Good Morning, {user?.name}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">{shiftLabel}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-base sm:text-lg font-bold">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          </div>
        </div>

        <div className={DASHBOARD_CONTENT_CLASS}>
          {/* Critical Alert */}
          {overdueTasks > 0 && (
            <Alert variant="destructive" className="border-l-4 border-destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertTitle className="font-semibold">Urgent Attention Required</AlertTitle>
              <AlertDescription className="mt-2">
                You have <strong>{overdueTasks} overdue task{overdueTasks > 1 ? 's' : ''}</strong> that need immediate attention.
              </AlertDescription>
            </Alert>
          )}

          {/* Quick Stats */}
          <div className={`grid grid-cols-2 ${DASHBOARD_CARD_GRID_GAP}`}>
            <StatCard
              title="Urgent"
              value={urgentTasks}
              subtitle="Immediate action"
              icon={AlertTriangle}
              iconBg="bg-red-100"
              iconColor="text-red-600"
            />
            <StatCard
              title="Completed"
              value={`${completedTasks}/${totalTasks}`}
              subtitle={`${completionRate}% done`}
              icon={CheckCircle}
              trend="up"
              trendLabel="+8% vs yesterday"
              iconBg="bg-green-100"
              iconColor="text-green-600"
            />
            <StatCard
              title="Patients"
              value={patients.length}
              subtitle="On your roster"
              icon={Users}
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
            />
            <StatCard
              title="High Risk"
              value={highRiskPatients}
              subtitle="Close monitoring"
              icon={Heart}
              iconBg="bg-purple-100"
              iconColor="text-purple-600"
            />
          </div>

          {/* View All Patients Button */}
          <Card className="border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">My Assigned Patients</h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      View all {patients.length} patients on your roster
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => navigate('/my-patients')}
                  className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                  size="sm"
                >
                  View All
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">Quick Actions</h2>
              <p className="text-xs text-gray-500">Common tasks and shortcuts</p>
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-4 ${DASHBOARD_CARD_GRID_GAP}`}>
              <Button
                className="h-20 flex flex-col gap-2 bg-green-600 hover:bg-green-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/tasks')}
              >
                <ClipboardList className="w-5 h-5" />
                <span className="text-xs font-medium">Tasks</span>
              </Button>
              <Button
                className="h-20 flex flex-col gap-2 bg-purple-600 hover:bg-purple-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/handover')}
              >
                <FileText className="w-5 h-5" />
                <span className="text-xs font-medium">Endorsement</span>
              </Button>
              <Button
                className="h-20 flex flex-col gap-2 bg-orange-600 hover:bg-orange-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/charting')}
              >
                <Activity className="w-5 h-5" />
                <span className="text-xs font-medium">Charting</span>
              </Button>
              <Button
                className="h-20 flex flex-col gap-2 bg-teal-600 hover:bg-teal-700 text-white border-0 shadow-sm hover:shadow-md transition-all rounded-xl"
                onClick={() => navigate('/kardex')}
              >
                <ClipboardList className="w-5 h-5" />
                <span className="text-xs font-medium">Kardex</span>
              </Button>
            </div>
          </div>

          <div className={`grid grid-cols-1 lg:grid-cols-2 ${DASHBOARD_CHART_GRID_GAP}`}>
            {/* Task Timeline */}
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  Task Timeline
                </CardTitle>
                <CardDescription>Your hourly task distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div key="staff-task-timeline-chart">
                  <ResponsiveContainer width="100%" height={220} key="staff-timeline-container">
                    <BarChart data={staffTaskTrendData} key="staff-bar-chart">
                      <CartesianGrid key="staff-grid" strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis
                        key="staff-x-axis"
                        dataKey="time"
                        stroke="#718096"
                        style={{ fontSize: '12px' }}
                      />
                      <YAxis key="staff-y-axis" stroke="#718096" style={{ fontSize: '12px' }} />
                      <Tooltip
                        key="staff-tooltip"
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          fontSize: '14px'
                        }}
                      />
                      <Bar key="staff-tasks-bar" dataKey="tasks" fill="#2EC4B6" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Task Distribution */}
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Task Status
                </CardTitle>
                <CardDescription>Overview of all tasks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-success"></div>
                      <span className="text-sm font-medium text-foreground">Completed</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{completedTasks}</span>
                  </div>
                  <Progress value={(completedTasks / totalTasks) * 100} className="h-2" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-warning"></div>
                      <span className="text-sm font-medium text-foreground">In Progress</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{inProgressCount}</span>
                  </div>
                  <Progress value={(inProgressCount / totalTasks) * 100} className="h-2" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-muted"></div>
                      <span className="text-sm font-medium text-foreground">Pending</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{pendingCount}</span>
                  </div>
                  <Progress value={(pendingCount / totalTasks) * 100} className="h-2" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-destructive"></div>
                      <span className="text-sm font-medium text-foreground">Overdue</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">{overdueTasks}</span>
                  </div>
                  <Progress value={(overdueTasks / totalTasks) * 100} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* High-Risk Patients */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                High-Risk Patients
              </CardTitle>
              <CardDescription>Patients requiring close monitoring</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {patients.filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical').map(patient => (
                <div key={patient.id} className="p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-semibold text-foreground">{patient.name}</h4>
                      <p className="text-sm text-muted-foreground">{patient.room}  {patient.diagnosis}</p>
                    </div>
                    <Badge variant="destructive" className="font-medium">
                      {patient.riskLevel === 'critical' ? 'CRITICAL' : 'HIGH RISK'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Heart className="w-4 h-4 text-destructive" />
                      <span className="font-medium">{patient.vitalSigns.heartRate} bpm</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="w-4 h-4 text-primary" />
                      <span className="font-medium">{patient.vitalSigns.oxygenSaturation}% SpO2</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Thermometer className="w-4 h-4 text-warning" />
                      <span className="font-medium">{patient.vitalSigns.temperature}°C</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="w-4 h-4 text-success" />
                      <span className="font-medium">{patient.vitalSigns.bloodPressure}</span>
                    </div>
                  </div>
                  {patient.alerts.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-destructive/20">
                      {patient.alerts.map((alert, idx) => (
                        <p key={idx} className="text-sm text-destructive font-medium flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          {alert}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Upcoming Tasks */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Upcoming Tasks
              </CardTitle>
              <CardDescription>Next scheduled tasks in your shift</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tasks.slice(0, 4).map(task => (
                <div
                  key={task.id}
                  className={`p-4 border rounded-lg ${
                    task.priority === 'high'
                      ? 'border-destructive/30 bg-destructive/5'
                      : task.priority === 'low'
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-warning/30 bg-warning/5'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={task.priority === 'high' ? 'destructive' : 'default'} className="font-medium text-xs uppercase">
                          {task.priority}
                        </Badge>
                        <span className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {task.dueTime}
                        </span>
                      </div>
                      <h4 className="font-semibold text-foreground">{task.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{task.patientName} • {task.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-4"
                      onClick={() => navigate('/tasks', { state: { taskId: task.id } })}
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Head Nurse Dashboard — deliberately light: Safety Alerts, a handful of
  // summary stat cards, and a link out to the full Analytics page (charts
  // and nurse workload all live there now — see AnalyticsPage.tsx).
  return (
    <div className="pb-8">
      <SectionNav sections={DASHBOARD_SECTIONS} activeKey={activeSection} onSelect={scrollToSection} />

      {/* Header */}
      <div className={DASHBOARD_HEADER_CLASS}>
        <div className={DASHBOARD_CONTAINER_CLASS}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Welcome, {user?.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">Nursing Operations Dashboard</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">{currentTime.toLocaleTimeString()}</p>
              <p className="text-sm text-muted-foreground">
                {currentTime.toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className={DASHBOARD_CONTENT_CLASS}>
        <div ref={(el) => { sectionRefs.current.alerts = el; }}>
          <SafetyAlertsSection
            patients={patients}
            tasks={tasks}
            onRespond={handleRespondToAlert}
            onNotifyNurse={handleNotifyNurseFromAlert}
          />
        </div>

        <div
          ref={(el) => { sectionRefs.current.overview = el; }}
          className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${DASHBOARD_CARD_GRID_GAP}`}
        >
          <StatCard
            title="Patients"
            value={String(patients.length)}
            subtitle="All registered patients"
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
            title="Pending / Overdue"
            value={`${pendingCount + inProgressCount} / ${overdueTasks}`}
            subtitle={`${completionRate}% completed`}
            icon={CheckCircle}
            iconBg="bg-green-100"
            iconColor="text-green-600"
          />
          <StatCard
            title="Nurses on Duty"
            value={String(workloadData.length)}
            subtitle="Currently on shift"
            icon={Users}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
          />
        </div>

        <Card className="border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Full Analytics &amp; Workload</h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Charts, task trends and nurse workload in one place
                  </p>
                </div>
              </div>
              <Button
                onClick={() => navigate('/analytics')}
                className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                size="sm"
              >
                View all analytics
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AssignPatientModal
        isOpen={assignModalOpen}
        onClose={() => {
          setAssignModalOpen(false);
          setAssignPrefill(null);
        }}
        onSubmit={handleAssignSubmit}
        editingAssignment={null}
        prefill={assignPrefill}
        availableNurses={availableNurses}
        allTasks={tasks}
        allAssignments={assignments}
      />
    </div>
  );
}
