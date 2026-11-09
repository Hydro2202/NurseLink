import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  findNodeHandle,
  Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
// Wrapper that honours the Show Charts & Graphs setting; same API.
import { BarChart } from '../../components/Charts';
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
  BookOpen,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import type { Patient, Task, WorkloadData, DutyAssignment, PatientAssignmentRecord, Nurse } from '../../types/domain';
import type { PatientAssignment } from '../../types';
import {
  fetchPatients,
  fetchTasks,
  fetchWorkload,
  fetchDutyAssignments,
  fetchAssignments,
  fetchNurses,
  createAssignment,
  notifyPatientNurse,
  sendEmergencyAlert,
  notifyTaskNurse,
  ApiError,
} from '../../services/api';
import { useLiveRefresh } from '../../contexts/LiveContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { RiskBadge } from '../../components/RiskBadge';
import { Progress } from '../../components/Progress';
import { Button } from '../../components/Button';
import { AssignPatientModal, type AssignPatientPrefill } from '../../components/AssignPatientModal';
import { SafetyAlertsSection, type SafetyAlert } from '../../components/dashboard/SafetyAlertsSection';
import { NurseOverviewSection } from '../../components/dashboard/NurseOverviewSection';
import { DutyRosterSummary, RecentActivitySection } from '../../components/dashboard/DutyAndActivitySections';
import { PatientOverviewSection, TaskLoadChart } from '../../components/dashboard/PatientAndChartSections';
import { OverdueBanner } from '../../components/dashboard/OverdueBanner';
import { QuickActions } from '../../components/dashboard/QuickActions';
import { Colors, Radius } from '../../constants/colors';
import { formatTime12 } from '../../utils/time';

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

// Same local-calendar-day helpers as my-duty.tsx — never toISOString(),
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
  return formatTime12(hhmm);
}
function combine(dateIso: string, hhmm: string): Date {
  const [y, mo, da] = dateIso.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, da, h, m, 0, 0);
}
// Same midnight-wrap rule as my-duty.tsx: an end time at or before the
// start time means the shift spills into the next calendar day.
function scheduledRange(a: DutyAssignment): { start: Date; end: Date } {
  const start = combine(a.dutyDate, a.startTime.slice(0, 5));
  let end = combine(a.dutyDate, a.endTime.slice(0, 5));
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
  return { start, end };
}

type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  trend?: boolean;
  trendLabel?: string;
  iconBg: string;
  iconColor: string;
  /** When set, the whole card becomes a button (head-nurse dashboard). */
  onPress?: () => void;
};

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
  iconBg,
  iconColor,
  onPress,
}: StatCardProps) {
  const inner = (
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
        {trend ? (
          <View style={styles.statTrend}>
            <TrendingUp size={12} color={Colors.green600} />
            <Text style={styles.statTrendText}>{trendLabel}</Text>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.statPressed : undefined)}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
    >
      {inner}
    </Pressable>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ section?: string }>();
  const isStaffNurse = user?.role === 'staff_nurse';
  const [currentTime, setCurrentTime] = useState(new Date());
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workloadData, setWorkloadData] = useState<WorkloadData[]>([]);
  const [dutyAssignments, setDutyAssignments] = useState<DutyAssignment[]>([]);

  // Head-nurse-only: just enough workload data for the "Nurses on Duty"
  // stat card and the nurse picker in the shared Assign Patient modal — the
  // full Nurse Workload / Patient Assignments tables now live on their own
  // Analytics page (see analytics.tsx), linked from "View all analytics →"
  // below instead of rendered inline here.
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  // Head-nurse-only: the full nurse roster (for the Nurse Overview and the
  // total/off-duty stats) and today's duty rows (Duty Roster summary +
  // Recent Activity clock-in/out). Staff nurses never load these.
  const [allNurses, setAllNurses] = useState<Nurse[]>([]);
  const [hnDuty, setHnDuty] = useState<DutyAssignment[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignPrefill, setAssignPrefill] = useState<AssignPatientPrefill | null>(null);
  const sectionRefs = useRef<Record<string, View | null>>({});
  const scrollRef = useRef<ScrollView>(null);

  const chartWidth = Math.max(width - 64, 280);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const [patientData, taskData, duty] = await Promise.all([
        fetchPatients(isStaffNurse ? { mine: true } : undefined),
        fetchTasks(isStaffNurse ? { mine: true } : undefined),
        // Yesterday too: a night shift that started before midnight is
        // still "today's duty" until it ends. No nurseId param needed —
        // the backend already scopes this to the signed-in nurse.
        isStaffNurse
          ? fetchDutyAssignments({ dateFrom: addDays(todayIso(), -1), dateTo: todayIso() })
          : Promise.resolve([]),
      ]);
      setPatients(patientData);
      setTasks(taskData);
      setDutyAssignments(duty);
    } catch (error) {
      console.warn('Failed to load dashboard data:', error);
    }
  }, [isStaffNurse]);

  useEffect(() => {
    (async () => {
      await loadDashboard();
    })();
  }, [loadDashboard]);

  const loadWorkloadSummary = useCallback(async () => {
    if (isStaffNurse) return;
    try {
      const [workload, assignmentData, nurseList, duty] = await Promise.all([
        fetchWorkload(),
        fetchAssignments({ status: 'active' }),
        fetchNurses(),
        fetchDutyAssignments({ dateFrom: todayIso(), dateTo: todayIso() }),
      ]);
      setWorkloadData(workload);
      setAssignments(assignmentData.map(toLocalAssignment));
      setAllNurses(nurseList);
      setHnDuty(duty);
    } catch (error) {
      console.warn('Failed to load workload summary:', error);
    }
  }, [isStaffNurse]);

  useEffect(() => {
    (async () => {
      await loadWorkloadSummary();
    })();
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

  // Deep links (?section=...) from notifications still jump to a section;
  // the on-page tab bar was removed.
  const scrollToSection = useCallback((key: string) => {
    const node = sectionRefs.current[key];
    const scrollNode = findNodeHandle(scrollRef.current);
    if (!node || scrollNode === null) return;
    // measureLayout, not onLayout's own (parent-relative) y: the sections
    // sit several Views deep inside the ScrollView's content, so only a
    // measurement taken relative to the ScrollView itself gives a y that
    // scrollTo can actually use.
    node.measureLayout(
      scrollNode,
      (_x: number, y: number) => {
        scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
      },
      () => {
        // Not measurable yet (e.g. mid-layout) — the deep-link effect below
        // retries, and a manual tap can simply be pressed again.
      }
    );
  }, []);

  // An old safety-alert notification, or a link typed by hand, lands on
  // /(app)/dashboard?section=alerts — jump straight to that section once
  // it has actually rendered rather than at the top. Retries briefly since
  // the very first render may not have laid out that section yet.
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
    // Only the very first render with a ?section= param should auto-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dashboard counts tasks and patients, both of which change from other
  // nurses' devices, so it follows the shared live revisions too. duty is
  // what makes a head nurse ending this nurse's shift show up here without
  // waiting for an unrelated task/patient change to trigger a refetch.
  useLiveRefresh('tasks', () => {
    void loadDashboard();
  });
  useLiveRefresh('patients', () => {
    void loadDashboard();
  });
  useLiveRefresh('duty', () => {
    void loadDashboard();
  });

  const urgentTasks = tasks.filter((t) => t.priority === 'high' && t.status !== 'completed').length;
  const overdueTasks = tasks.filter((t) => t.status === 'overdue').length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const totalTasks = tasks.length || 1;
  const highRiskPatients = patients.filter(
    (p) => p.riskLevel === 'high' || p.riskLevel === 'critical'
  ).length;
  const completionRate = Math.round((completedTasks / totalTasks) * 100);
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;

  // Head-nurse stat values (real data only).
  const onDutyCount = workloadData.length;
  const totalNurses = allNurses.length;
  const offDutyCount = Math.max(0, totalNurses - onDutyCount);
  const unassignedPatients = patients.filter(
    (p) => p.status !== 'discharged' && !p.assignedNurseName?.trim()
  ).length;
  // Same rule SafetyAlertsSection uses to build its list, so the stat and
  // the section always agree: high/critical non-discharged patients plus
  // overdue tasks.
  const activeAlertsCount =
    patients.filter((p) => (p.riskLevel === 'high' || p.riskLevel === 'critical') && p.status !== 'discharged').length +
    tasks.filter((t) => t.status === 'overdue').length;

  const staffTaskTrendData = useMemo(() => {
    const buckets = [
      { value: pendingCount, label: 'Pending' },
      { value: inProgressCount, label: 'Active' },
      { value: overdueTasks, label: 'Overdue' },
      { value: completedTasks, label: 'Done' },
      { value: urgentTasks, label: 'Urgent' },
    ];
    return buckets;
  }, [pendingCount, inProgressCount, overdueTasks, completedTasks, urgentTasks]);

  // The nurse's actual scheduled shift, per the Duty Roster — the ground
  // truth for what they're working right now, as opposed to
  // NurseProfile.shift (a general default a head nurse rarely revisits once
  // the roster is doing the real day-to-day scheduling).
  const todayDuty = useMemo(() => {
    const today = todayIso();
    const yesterday = addDays(today, -1);
    const relevant = dutyAssignments.filter(
      (a) => (a.dutyDate === today || a.dutyDate === yesterday) && a.status !== 'cancelled'
    );
    const active = relevant.find((a) => {
      // Ended is ended, even if the scheduled window hasn't closed yet — a
      // head nurse can end a shift early (Close Shift, or marking it
      // Completed from the roster's edit form), and that must win over the
      // scheduled start/end times here, not just get overwritten by them on
      // the next tick.
      if (a.status === 'completed' || a.actualEndTime) return false;
      const { start, end } = scheduledRange(a);
      return currentTime.getTime() >= start.getTime() && currentTime.getTime() < end.getTime();
    });
    return active || relevant.find((a) => a.dutyDate === today) || null;
  }, [dutyAssignments, currentTime]);

  // Deliberately does NOT fall back to NurseProfile.shift when there's no
  // duty today — that field is a rarely-touched general default (set once
  // via Workload's Assign action) and is frequently stale on accounts the
  // roster has since taken over scheduling for. Showing it as if it were
  // today's real assignment is exactly the bug this replaced: better to
  // say nothing than to show a shift the nurse isn't actually working.
  // Same wording as My Duty's own empty state, for consistency.
  const shiftLabel = useMemo(() => {
    if (!todayDuty) return 'No Duty Assigned Today';
    const start = formatTime(todayDuty.startTime.slice(0, 5));
    const end = formatTime(todayDuty.endTime.slice(0, 5));
    return `${todayDuty.shiftLabel} Shift (${start}-${end})`;
  }, [todayDuty]);

  const handleRespondToAlert = (alert: SafetyAlert) => {
    if (alert.variant === 'destructive' && alert.patient) {
      const p = alert.patient;
      // Alert the responders right away (popup + sound on their devices),
      // then open the assign form as before.
      sendEmergencyAlert(p.id, alert.description)
        .then((result) => toast.success('Emergency alert sent', { description: result.detail }))
        .catch((error) =>
          toast.error('Could not send the emergency alert', {
            description: error instanceof ApiError ? error.message : 'Please try again.',
          })
        );
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
    router.push('/(app)/tasks' as any);
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
      toast.error('Failed to save assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    }
  };

  const availableNurses = useMemo(
    () => workloadData.map((n) => ({ id: n.nurseId, name: n.nurseName, patientCount: n.patientCount })),
    [workloadData]
  );

  const timeString = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fullTimeString = currentTime.toLocaleTimeString('en-US', { hour12: true });

  if (isStaffNurse) {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBar}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting} numberOfLines={1}>
              Good Morning, {user?.name}
            </Text>
            <Text style={styles.shiftText}>{shiftLabel}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.timeText}>{timeString}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {overdueTasks > 0 ? (
            <OverdueBanner
              count={overdueTasks}
              message={`You have ${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''} that need immediate attention.`}
              onView={() => router.push({ pathname: '/(app)/tasks', params: { filter: 'overdue' } } as any)}
            />
          ) : null}

          <View style={styles.statsGrid}>
            <View style={styles.statsCol}>
              <StatCard
                title="Urgent"
                value={urgentTasks}
                subtitle="Immediate action"
                icon={AlertTriangle}
                iconBg={Colors.red100}
                iconColor={Colors.red600}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Completed"
                value={`${completedTasks}/${totalTasks}`}
                subtitle={`${completionRate}% done`}
                icon={CheckCircle}
                trend
                trendLabel="+8% vs yesterday"
                iconBg={Colors.green100}
                iconColor={Colors.green600}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Patients"
                value={patients.length}
                subtitle="On your roster"
                icon={Users}
                iconBg={Colors.blue100}
                iconColor={Colors.blue600}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="High Risk"
                value={highRiskPatients}
                subtitle="Close monitoring"
                icon={Heart}
                iconBg={Colors.purple100}
                iconColor={Colors.purple600}
              />
            </View>
          </View>

          <Card style={styles.patientsCta}>
            <LinearGradient
              colors={[Colors.blue50, '#EEF2FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.patientsCtaGradient}
            >
              <View style={styles.patientsCtaRow}>
                <View style={styles.patientsCtaLeft}>
                  <View style={styles.patientsCtaIcon}>
                    <Users size={20} color={Colors.blue600} />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.patientsCtaTitle}>My Assigned Patients</Text>
                    <Text style={styles.patientsCtaSub}>
                      View all {patients.length} patients on your roster
                    </Text>
                  </View>
                </View>
                <Button
                  size="sm"
                  onPress={() => router.push('/(app)/my-patients' as any)}
                  style={styles.viewAllBtn}
                >
                  <Text style={styles.viewAllBtnText}>View All</Text>
                  <ArrowRight size={14} color={Colors.white} />
                </Button>
              </View>
            </LinearGradient>
          </Card>

          <View>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <Text style={styles.sectionSub}>Common tasks and shortcuts</Text>
            <QuickActions
              actions={[
                {
                  key: 'tasks', label: 'Tasks', description: 'Your assigned care tasks',
                  icon: ClipboardList, tint: Colors.blue50, accent: Colors.blue600,
                  onPress: () => router.push('/(app)/tasks' as any),
                },
                {
                  key: 'referral', label: 'Endorsement', description: 'Send or review SBAR endorsements',
                  icon: FileText, tint: Colors.gray100, accent: Colors.gray600,
                  onPress: () => router.push('/(app)/handover' as any),
                },
                {
                  key: 'charting', label: 'Charting', description: 'Write a nursing note',
                  icon: Activity, tint: Colors.green50, accent: Colors.green600,
                  onPress: () => router.push('/(app)/charting' as any),
                },
                {
                  key: 'kardex', label: 'Kardex', description: 'Admit or update a patient',
                  icon: BookOpen, tint: Colors.yellow50, accent: Colors.yellow700,
                  onPress: () => router.push('/(app)/kardex' as any),
                },
              ]}
            />
          </View>

          <Card>
            <CardHeader>
              <View style={styles.cardTitleRow}>
                <Clock size={20} color={Colors.primary} />
                <CardTitle>Task Timeline</CardTitle>
              </View>
              <CardDescription>Your hourly task distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={staffTaskTrendData}
                width={chartWidth}
                height={220}
                barWidth={28}
                spacing={28}
                roundedTop
                frontColor={Colors.chartTeal}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor={Colors.border}
                rulesColor={Colors.border}
                rulesType="dashed"
                noOfSections={4}
                maxValue={10}
                yAxisTextStyle={styles.chartAxis}
                xAxisLabelTextStyle={styles.chartAxis}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <View style={styles.cardTitleRow}>
                <BarChart3 size={20} color={Colors.primary} />
                <CardTitle>Task Status</CardTitle>
              </View>
              <CardDescription>Overview of all tasks</CardDescription>
            </CardHeader>
            <CardContent style={styles.statusList}>
              <View style={styles.statusRow}>
                <View style={styles.statusLabel}>
                  <View style={[styles.dot, { backgroundColor: Colors.success }]} />
                  <Text style={styles.statusText}>Completed</Text>
                </View>
                <Text style={styles.statusCount}>{completedTasks}</Text>
              </View>
              <Progress value={(completedTasks / totalTasks) * 100} height={8} fillColor={Colors.success} />

              <View style={styles.statusRow}>
                <View style={styles.statusLabel}>
                  <View style={[styles.dot, { backgroundColor: Colors.warning }]} />
                  <Text style={styles.statusText}>In Progress</Text>
                </View>
                <Text style={styles.statusCount}>{inProgressCount}</Text>
              </View>
              <Progress
                value={(inProgressCount / totalTasks) * 100}
                height={8}
                fillColor={Colors.warning}
              />

              <View style={styles.statusRow}>
                <View style={styles.statusLabel}>
                  <View style={[styles.dot, { backgroundColor: Colors.mutedForeground }]} />
                  <Text style={styles.statusText}>Pending</Text>
                </View>
                <Text style={styles.statusCount}>{pendingCount}</Text>
              </View>
              <Progress
                value={(pendingCount / totalTasks) * 100}
                height={8}
                fillColor={Colors.mutedForeground}
              />

              <View style={styles.statusRow}>
                <View style={styles.statusLabel}>
                  <View style={[styles.dot, { backgroundColor: Colors.destructive }]} />
                  <Text style={styles.statusText}>Overdue</Text>
                </View>
                <Text style={styles.statusCount}>{overdueTasks}</Text>
              </View>
              <Progress
                value={(overdueTasks / totalTasks) * 100}
                height={8}
                fillColor={Colors.destructive}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <View style={styles.cardTitleRow}>
                <AlertTriangle size={20} color={Colors.destructive} />
                <CardTitle>High-Risk Patients</CardTitle>
              </View>
              <CardDescription>Patients requiring close monitoring</CardDescription>
            </CardHeader>
            <CardContent style={styles.gap12}>
              {patients
                .filter((p) => p.riskLevel === 'high' || p.riskLevel === 'critical')
                .sort((a, b) => (a.riskLevel === b.riskLevel ? 0 : a.riskLevel === 'critical' ? -1 : 1))
                .map((patient) => (
                  <View key={patient.id} style={styles.highRiskCard}>
                    <View style={styles.highRiskHeader}>
                      <View style={styles.flex1}>
                        <Text style={styles.patientName}>{patient.name}</Text>
                        <Text style={styles.patientMeta}>
                          {patient.room}  {patient.diagnosis}
                        </Text>
                      </View>
                      <RiskBadge level={patient.riskLevel} size="sm" />
                    </View>
                    <View style={styles.vitalsGrid}>
                      <View style={styles.vitalItem}>
                        <Heart size={14} color={Colors.destructive} />
                        <Text style={styles.vitalText}>{patient.vitalSigns.heartRate} bpm</Text>
                      </View>
                      <View style={styles.vitalItem}>
                        <Activity size={14} color={Colors.primary} />
                        <Text style={styles.vitalText}>
                          {patient.vitalSigns.oxygenSaturation}% SpO2
                        </Text>
                      </View>
                      <View style={styles.vitalItem}>
                        <Thermometer size={14} color={Colors.warning} />
                        <Text style={styles.vitalText}>{patient.vitalSigns.temperature}°C</Text>
                      </View>
                      <View style={styles.vitalItem}>
                        <Activity size={14} color={Colors.success} />
                        <Text style={styles.vitalText}>{patient.vitalSigns.bloodPressure}</Text>
                      </View>
                    </View>
                    {patient.alerts.length > 0 ? (
                      <View style={styles.alertsBlock}>
                        {patient.alerts.map((alert, idx) => (
                          <View key={idx} style={styles.alertRow}>
                            <AlertCircle size={14} color={Colors.destructive} />
                            <Text style={styles.alertText}>{alert}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <View style={styles.cardTitleRow}>
                <Clock size={20} color={Colors.primary} />
                <CardTitle>Upcoming Tasks</CardTitle>
              </View>
              <CardDescription>Next scheduled tasks in your shift</CardDescription>
            </CardHeader>
            <CardContent style={styles.gap12}>
              {tasks.filter((t) => t.status !== 'completed').slice(0, 4).map((task) => (
                <View
                  key={task.id}
                  style={[
                    styles.upcomingCard,
                    task.priority === 'high'
                      ? styles.upcomingUrgent
                      : task.priority === 'low'
                        ? styles.upcomingLow
                        : styles.upcomingRoutine,
                  ]}
                >
                  <View style={styles.upcomingRow}>
                    <View style={styles.flex1}>
                      <View style={styles.upcomingBadges}>
                        <Badge
                          variant={task.priority === 'high' ? 'destructive' : 'default'}
                          textStyle={styles.badgeXs}
                        >
                          {task.priority.toUpperCase()}
                        </Badge>
                        <View style={styles.dueRow}>
                          <Clock size={12} color={Colors.mutedForeground} />
                          <Text style={styles.dueText}>{formatTime12(task.dueTime)}</Text>
                        </View>
                      </View>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      <Text style={styles.taskDesc}>
                        {task.patientName} • {task.description}
                      </Text>
                    </View>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onPress={() =>
                        router.push({
                          pathname: '/(app)/tasks',
                          params: { taskId: task.id },
                        } as any)
                      }
                    >
                      <ArrowRight size={16} color={Colors.foreground} />
                    </Button>
                  </View>
                </View>
              ))}
            </CardContent>
          </Card>
        </View>
      </ScrollView>
    );
  }

  // Head Nurse Dashboard — deliberately light: Safety Alerts, a handful of
  // summary stat cards, and a link out to the full Analytics page (charts
  // and nurse workload all live there now — see analytics.tsx).
  return (
    <View style={styles.hnRoot}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContentAdmin}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerBarAdmin}>
          <View style={styles.headerLeft}>
            <Text style={styles.greetingAdmin}>Welcome, {user?.name}</Text>
            <Text style={styles.shiftText}>Nursing Operations Dashboard</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.timeTextAdmin}>{fullTimeString}</Text>
            <Text style={styles.shiftText}>
              {currentTime.toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          <View ref={(r) => { sectionRefs.current.overview = r; }} style={styles.statsGrid}>
            <View style={styles.statsCol}>
              <StatCard
                title="Total Nurses"
                value={String(totalNurses)}
                subtitle="Tap to view roster"
                icon={Users}
                iconBg={Colors.blue100}
                iconColor={Colors.blue600}
                onPress={() => scrollToSection('nurses')}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Nurses on Duty"
                value={String(onDutyCount)}
                subtitle="Currently on shift"
                icon={CheckCircle}
                iconBg={Colors.green100}
                iconColor={Colors.green600}
                onPress={() => scrollToSection('nurses')}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Nurses Off Duty"
                value={String(offDutyCount)}
                subtitle="Not on shift now"
                icon={Users}
                iconBg={Colors.gray100}
                iconColor={Colors.gray600}
                onPress={() => scrollToSection('nurses')}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Total Patients"
                value={String(patients.filter((p) => p.status !== 'discharged').length)}
                subtitle="Active patients"
                icon={Heart}
                iconBg={Colors.purple100}
                iconColor={Colors.purple600}
                onPress={() => router.push('/(app)/all-patients' as any)}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Unassigned"
                value={String(unassignedPatients)}
                subtitle="Need a nurse"
                icon={AlertCircle}
                iconBg={Colors.orange100}
                iconColor={Colors.orange600}
                onPress={() => router.push('/(app)/all-patients' as any)}
              />
            </View>
            <View style={styles.statsCol}>
              <StatCard
                title="Active Alerts"
                value={String(activeAlertsCount)}
                subtitle="Patient safety"
                icon={AlertTriangle}
                iconBg={Colors.red100}
                iconColor={Colors.red600}
                onPress={() => scrollToSection('alerts')}
              />
            </View>
          </View>

          <View ref={(r) => { sectionRefs.current.alerts = r; }}>
            <SafetyAlertsSection
              patients={patients}
              tasks={tasks}
              onRespond={handleRespondToAlert}
              onNotifyNurse={handleNotifyNurseFromAlert}
            />
          </View>

          <View ref={(r) => { sectionRefs.current.nurses = r; }}>
            <NurseOverviewSection
              nurses={allNurses}
              workload={workloadData}
              patients={patients}
              onOpenPatient={() => router.push('/(app)/all-patients' as any)}
            />
          </View>

          <PatientOverviewSection
            patients={patients}
            onOpenPatients={() => router.push('/(app)/all-patients' as any)}
          />

          <TaskLoadChart tasks={tasks} now={currentTime} width={width} />

          <DutyRosterSummary duty={hnDuty} onOpenRoster={() => router.push('/(app)/duty-roster' as any)} />

          <RecentActivitySection assignments={assignments} duty={hnDuty} now={currentTime} />

          <Card style={styles.patientsCta}>
            <LinearGradient
              colors={[Colors.blue50, '#EEF2FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.patientsCtaGradient}
            >
              <View style={styles.patientsCtaRow}>
                <View style={styles.patientsCtaLeft}>
                  <View style={styles.patientsCtaIcon}>
                    <BarChart3 size={20} color={Colors.blue600} />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.patientsCtaTitle}>Full Analytics & Workload</Text>
                    <Text style={styles.patientsCtaSub}>
                      Charts, task trends and nurse workload in one place
                    </Text>
                  </View>
                </View>
                <Button
                  size="sm"
                  onPress={() => router.push('/(app)/analytics' as any)}
                  style={styles.viewAllBtn}
                >
                  <Text style={styles.viewAllBtnText}>View all analytics</Text>
                  <ArrowRight size={14} color={Colors.white} />
                </Button>
              </View>
            </LinearGradient>
          </Card>
        </View>
      </ScrollView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  hnRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  scrollContentAdmin: {
    paddingBottom: 40,
  },
  headerBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerBarAdmin: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  greeting: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
  },
  greetingAdmin: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foreground,
  },
  shiftText: {
    fontSize: 12,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  timeText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
  },
  timeTextAdmin: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foreground,
  },
  body: {
    padding: 16,
    gap: 16,
  },
  alert: {
    marginBottom: 0,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statsCol: {
    width: '47%',
    flexGrow: 1,
    minWidth: 140,
  },
  statCard: {
    overflow: 'hidden',
  },
  statPressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
  statContent: {
    padding: 12,
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTitle: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.foreground,
  },
  statSubtitle: {
    fontSize: 10,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  statTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  statTrendText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.green600,
  },
  patientsCta: {
    borderColor: Colors.blue200,
    overflow: 'hidden',
    padding: 0,
  },
  patientsCtaGradient: {
    padding: 16,
  },
  patientsCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  patientsCtaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  patientsCtaIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patientsCtaTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.gray900,
  },
  patientsCtaSub: {
    fontSize: 12,
    color: Colors.gray600,
    marginTop: 2,
  },
  viewAllBtn: {
    backgroundColor: Colors.blue600,
    flexShrink: 0,
  },
  viewAllBtnText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.gray900,
  },
  sectionSub: {
    fontSize: 12,
    color: Colors.gray500,
    marginBottom: 12,
    marginTop: 2,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chartAxis: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  statusList: {
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  statusCount: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foreground,
  },
  gap12: {
    gap: 12,
  },
  highRiskCard: {
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  highRiskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  patientName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  patientMeta: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  vitalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '47%',
  },
  vitalText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.foreground,
  },
  alertsBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(239, 68, 68, 0.2)',
    gap: 6,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.destructive,
    flex: 1,
  },
  upcomingCard: {
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  upcomingUrgent: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  upcomingRoutine: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  upcomingLow: {
    borderColor: 'rgba(22, 163, 74, 0.3)',
    backgroundColor: 'rgba(22, 163, 74, 0.05)',
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  upcomingBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  badgeXs: {
    fontSize: 11,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dueText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedForeground,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  taskDesc: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
});
