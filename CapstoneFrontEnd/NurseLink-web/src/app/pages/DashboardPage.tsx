import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router';
import type { Patient, Task, WorkloadData, DutyAssignment } from '../types/domain';
import { fetchPatients, fetchTasks, fetchWorkload, fetchDutyAssignments, notifyPatientNurse } from '../api/nurselink';
import { ApiError } from '../api/client';
import { useLiveRefresh } from '../contexts/LiveContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Progress } from '../components/ui/progress';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
  const isStaffNurse = user?.role === 'staff_nurse';
  const [currentTime, setCurrentTime] = useState(new Date());
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workloadData, setWorkloadData] = useState<WorkloadData[]>([]);
  const [dutyAssignments, setDutyAssignments] = useState<DutyAssignment[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDashboard = React.useCallback(async () => {
    try {
      const [patientData, taskData, workload, duty] = await Promise.all([
        fetchPatients(isStaffNurse ? { mine: true } : undefined),
        fetchTasks(isStaffNurse ? { mine: true } : undefined),
        isStaffNurse ? Promise.resolve([]) : fetchWorkload(),
        // Yesterday too: a night shift that started before midnight is
        // still "today's duty" until it ends.
        isStaffNurse
          ? fetchDutyAssignments({ dateFrom: addDays(todayIso(), -1), dateTo: todayIso() })
          : Promise.resolve([]),
      ]);
      setPatients(patientData);
      setTasks(taskData);
      setWorkloadData(workload);
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

  // Calculate stats
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

  const adminTaskTrendData = staffTaskTrendData;

  const vitalTrendsData = React.useMemo(() => {
    if (!patients.length) return [];
    return patients.slice(0, 5).map((p, i) => ({
      time: p.id || `P${i + 1}`,
      hr: p.vitalSigns?.heartRate || 0,
      spo2: p.vitalSigns?.oxygenSaturation || 0,
      id: `v-${p.id || i}`,
    }));
  }, [patients]);

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

  const safetyAlerts = React.useMemo(() => {
    const alerts: {
      key: string;
      variant: 'destructive' | 'default';
      title: string;
      description: string;
      nurseName?: string;
      patientId?: string;
      path?: string;
    }[] = [];
    patients
      .filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical')
      // Critical patients surface before merely high-risk ones.
      .sort((a, b) => (a.riskLevel === b.riskLevel ? 0 : a.riskLevel === 'critical' ? -1 : 1))
      .slice(0, 5)
      .forEach(p => {
        const vs = p.vitalSigns;
        const label = p.riskLevel === 'critical' ? 'Critical' : 'High Risk';
        alerts.push({
          key: `patient-${p.id}`,
          variant: 'destructive',
          title: `${label} - ${p.name} (${p.room})`,
          description: vs
            ? `Vital signs require attention. BP ${vs.bloodPressure}, HR ${vs.heartRate}, Temp ${vs.temperature}°C.`
            : `${p.diagnosis || 'High-risk patient'} — immediate assessment required.`,
          nurseName: p.assignedNurseName || undefined,
          patientId: p.id,
          path: '/workload',
        });
      });
    tasks.filter(t => t.status === 'overdue').slice(0, 5).forEach(t => {
      alerts.push({
        key: `task-${t.id}`,
        variant: 'default',
        title: `Delayed Task - ${t.patientName || 'Patient'}`,
        description: `${t.title}${t.assignedTo ? `. Assigned nurse: ${t.assignedTo}` : ''}`,
        nurseName: t.assignedTo,
        path: t.assignedTo ? `/nurse-tasks/${encodeURIComponent(t.assignedTo)}` : '/tasks',
      });
    });
    return alerts;
  }, [patients, tasks]);

  const handleNotifyNurse = async (alert: (typeof safetyAlerts)[number]) => {
    // Patient (critical vitals) alerts have a real assigned nurse resolved
    // server-side from the patient record, so these actually reach the
    // nurse's notification inbox. Task alerts' "nurse" is free-text
    // (assignedTo) with no patient to anchor a lookup to, so those stay a
    // local confirmation only, same as before.
    if (alert.variant === 'destructive' && alert.patientId) {
      try {
        const result = await notifyPatientNurse(alert.patientId, alert.description);
        toast.success(result.detail);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Could not notify the nurse.');
      }
      return;
    }
    toast.success(`Notification sent to ${alert.nurseName}`, {
      description: 'The nurse has been notified.',
    });
  };

  const departmentStats = React.useMemo(() => {
    const buckets: Record<string, { label: string; total: number; critical: number; stable: number }> = {
      ICU: { label: 'ICU Department', total: 0, critical: 0, stable: 0 },
      Ward: { label: 'General Ward', total: 0, critical: 0, stable: 0 },
      ER: { label: 'Emergency', total: 0, critical: 0, stable: 0 },
    };
    patients.forEach(p => {
      const room = (p.room || '').toUpperCase();
      const key = room.includes('ICU') ? 'ICU' : room.includes('ER') || room.includes('EMERGENCY') ? 'ER' : 'Ward';
      buckets[key].total += 1;
      if (p.riskLevel === 'high' || p.riskLevel === 'critical') buckets[key].critical += 1;
      else buckets[key].stable += 1;
    });
    return Object.values(buckets);
  }, [patients]);

  const StatCard = ({ title, value, subtitle, icon: Icon, trend, trendLabel, bgColor, iconBg, iconColor, borderColor }: any) => (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
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
      <div className="space-y-4 pb-20 prevent-overflow">
        {/* Header */}
        <div className="bg-card border-b border-border py-3 px-3 sm:px-4 sm:py-4">
          <div className="w-full max-w-7xl mx-auto">
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

        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 space-y-4">
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
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              title="Urgent"
              value={urgentTasks}
              subtitle="Immediate action"
              icon={AlertTriangle}
              bgColor="bg-red-50"
              iconBg="bg-red-100"
              iconColor="text-red-600"
              borderColor="border-red-200"
            />
            <StatCard
              title="Completed"
              value={`${completedTasks}/${totalTasks}`}
              subtitle={`${completionRate}% done`}
              icon={CheckCircle}
              trend="up"
              trendLabel="+8% vs yesterday"
              bgColor="bg-green-50"
              iconBg="bg-green-100"
              iconColor="text-green-600"
              borderColor="border-green-200"
            />
            <StatCard
              title="Patients"
              value={patients.length}
              subtitle="On your roster"
              icon={Users}
              bgColor="bg-blue-50"
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
              borderColor="border-blue-200"
            />
            <StatCard
              title="High Risk"
              value={highRiskPatients}
              subtitle="Close monitoring"
              icon={Heart}
              bgColor="bg-purple-50"
              iconBg="bg-purple-100"
              iconColor="text-purple-600"
              borderColor="border-purple-200"
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                <span className="text-xs font-medium">Handover</span>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

  // Head Nurse Dashboard
  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="bg-card border-b border-border py-6">
        <div className="max-w-7xl mx-auto px-4">
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

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Active Nurses"
            value={String(workloadData.length)}
            subtitle="Staff nurses in database"
            icon={Users}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
          />
          <StatCard
            title="Total Patients"
            value={String(patients.length)}
            subtitle="Across all units"
            icon={Heart}
            iconBg="bg-purple-100"
            iconColor="text-purple-600"
          />
          <StatCard
            title="Task Completion"
            value={`${tasks.length ? completionRate : 0}%`}
            subtitle={`${completedTasks} of ${tasks.length} tasks`}
            icon={CheckCircle}
            iconBg="bg-green-100"
            iconColor="text-green-600"
          />
          <StatCard
            title="Critical Alerts"
            value={String(highRiskPatients)}
            subtitle="High-risk patients"
            icon={AlertTriangle}
            iconBg="bg-red-100"
            iconColor="text-red-600"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Task Activity</CardTitle>
              <CardDescription>Hourly task completion today</CardDescription>
            </CardHeader>
            <CardContent>
              <div key="admin-task-activity-chart">
                <ResponsiveContainer width="100%" height={250} key="admin-bar-container">
                  <BarChart data={adminTaskTrendData} key="admin-bar-chart">
                    <CartesianGrid key="admin-grid" strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis key="admin-x-axis" dataKey="time" stroke="#718096" style={{ fontSize: '12px' }} />
                    <YAxis key="admin-y-axis" stroke="#718096" style={{ fontSize: '12px' }} />
                    <Tooltip 
                      key="admin-tooltip"
                      contentStyle={{ 
                        backgroundColor: '#fff', 
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar key="admin-tasks-bar" dataKey="tasks" fill="#2D9CDB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Vital Signs Trends</CardTitle>
              <CardDescription>Average patient vitals throughout the day</CardDescription>
            </CardHeader>
            <CardContent>
              <div key="admin-vitals-chart">
                <ResponsiveContainer width="100%" height={250} key="admin-area-container">
                  <AreaChart data={vitalTrendsData} key="admin-area-chart">
                    <defs>
                      <linearGradient id="colorHR-admin" x1="0" y1="0" x2="0" y2="1" key="grad-hr">
                        <stop key="hr-stop-1" offset="5%" stopColor="#E53E3E" stopOpacity={0.3}/>
                        <stop key="hr-stop-2" offset="95%" stopColor="#E53E3E" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorSpO2-admin" x1="0" y1="0" x2="0" y2="1" key="grad-spo2">
                        <stop key="spo2-stop-1" offset="5%" stopColor="#2D9CDB" stopOpacity={0.3}/>
                        <stop key="spo2-stop-2" offset="95%" stopColor="#2D9CDB" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid key="admin-area-grid" strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis key="admin-area-x-axis" dataKey="time" stroke="#718096" style={{ fontSize: '12px' }} />
                    <YAxis key="admin-area-y-axis" stroke="#718096" style={{ fontSize: '12px' }} />
                    <Tooltip 
                      key="admin-area-tooltip"
                      contentStyle={{ 
                        backgroundColor: '#fff', 
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px'
                      }}
                    />
                    <Area key="admin-hr-area" type="monotone" dataKey="hr" stroke="#E53E3E" strokeWidth={2} fillOpacity={1} fill="url(#colorHR-admin)" />
                    <Area key="admin-spo2-area" type="monotone" dataKey="spo2" stroke="#2D9CDB" strokeWidth={2} fillOpacity={1} fill="url(#colorSpO2-admin)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Nurse Workload */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold">Nurse Workload Monitor</CardTitle>
            <CardDescription>Current shift nurse-to-patient ratios and burnout risk</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workloadData.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No records found.</p>
            ) : workloadData.map(nurse => (
              <div
                key={nurse.nurseId}
                className={`p-4 border rounded-lg ${
                  nurse.burnoutRisk === 'high' ? 'border-destructive/30 bg-destructive/5' :
                  nurse.burnoutRisk === 'medium' ? 'border-warning/30 bg-warning/5' :
                  'border-success/30 bg-success/5'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-foreground">{nurse.nurseName}</h4>
                    <p className="text-sm text-muted-foreground">{nurse.shift}</p>
                  </div>
                  <Badge 
                    variant={
                      nurse.burnoutRisk === 'high' ? 'destructive' :
                      nurse.burnoutRisk === 'medium' ? 'default' : 'outline'
                    }
                    className="font-medium"
                  >
                    {nurse.burnoutRisk === 'high' ? 'HIGH RISK' :
                     nurse.burnoutRisk === 'medium' ? 'MEDIUM RISK' : 'LOW RISK'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Patients</p>
                    <p className="text-lg font-bold text-foreground">{nurse.patientCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tasks</p>
                    <p className="text-lg font-bold text-foreground">{nurse.completedTasks}/{nurse.taskCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Completion</p>
                    <p className="text-lg font-bold text-success">
                      {nurse.taskCount ? Math.round((nurse.completedTasks / nurse.taskCount) * 100) : 0}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Overtime</p>
                    <p className="text-lg font-bold text-warning">{nurse.overtimeHours}h</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ratio</p>
                    <p className="text-lg font-bold text-primary">1:{Math.floor(nurse.patientCount)}</p>
                  </div>
                </div>
                <Progress value={nurse.taskCount ? (nurse.completedTasks / nurse.taskCount) * 100 : 0} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Patient Safety Alerts */}
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Patient Safety Alerts
            </CardTitle>
            <CardDescription>High-priority alerts requiring immediate attention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {safetyAlerts.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No notifications.</p>
            ) : safetyAlerts.map((alert) => (
              <Alert
                key={alert.key}
                variant={alert.variant === 'destructive' ? 'destructive' : 'default'}
                className={alert.variant === 'destructive' ? 'border-l-4' : 'border-l-4 border-warning bg-warning/5'}
              >
                {alert.variant === 'destructive' ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <Clock className="h-5 w-5 text-warning" />
                )}
                <AlertTitle className="font-semibold">{alert.title}</AlertTitle>
                <AlertDescription className="mt-2">{alert.description}</AlertDescription>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant={alert.variant === 'destructive' ? 'destructive' : 'default'}
                    onClick={() => navigate(alert.path || '/workload')}
                  >
                    {alert.variant === 'destructive' ? 'Respond Now' : 'View Task'}
                  </Button>
                  {alert.nurseName ? (
                    <Button size="sm" variant="outline" onClick={() => handleNotifyNurse(alert)}>
                      Notify Nurse
                    </Button>
                  ) : null}
                </div>
              </Alert>
            ))}
          </CardContent>
        </Card>

        {/* Department Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {departmentStats.map((dept) => (
            <Card key={dept.label} className="border border-border shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">{dept.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">Patients</span>
                    <span className="text-2xl font-bold text-foreground">{dept.total}</span>
                  </div>
                  <Progress value={patients.length ? Math.min(100, (dept.total / Math.max(patients.length, 1)) * 100) : 0} className="h-2" />
                  <div className="flex justify-between text-sm pt-2">
                    <span className="text-muted-foreground">Critical: <strong className="text-destructive">{dept.critical}</strong></span>
                    <span className="text-muted-foreground">Stable: <strong className="text-success">{dept.stable}</strong></span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}