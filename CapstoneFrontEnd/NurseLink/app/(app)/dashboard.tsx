import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BarChart, LineChart } from 'react-native-gifted-charts';
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
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { mockTasks, mockWorkloadData, Patient } from '../../data/mockData';
import { fetchPatients } from '../../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Alert, AlertDescription, AlertTitle } from '../../components/Alert';
import { Progress } from '../../components/Progress';
import { Button } from '../../components/Button';
import { Colors, Shadows, Radius } from '../../constants/colors';

type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  trend?: boolean;
  trendLabel?: string;
  iconBg: string;
  iconColor: string;
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
}: StatCardProps) {
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
        {trend ? (
          <View style={styles.statTrend}>
            <TrendingUp size={12} color={Colors.green600} />
            <Text style={styles.statTrendText}>{trendLabel}</Text>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isStaffNurse = user?.role === 'staff_nurse';
  const [currentTime, setCurrentTime] = useState(new Date());
  const [patients, setPatients] = useState<Patient[]>([]);

  const chartWidth = Math.max(width - 64, 280);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPatients(isStaffNurse ? { mine: true } : undefined);
        if (!cancelled) setPatients(data);
      } catch (error) {
        console.error('Failed to load patients:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaffNurse]);

  const urgentTasks = mockTasks.filter((t) => t.priority === 'urgent' && t.status !== 'completed').length;
  const overdueTasks = mockTasks.filter((t) => t.status === 'overdue').length;
  const completedTasks = mockTasks.filter((t) => t.status === 'completed').length;
  const totalTasks = mockTasks.length;
  const highRiskPatients = patients.filter((p) => p.riskLevel === 'high').length;
  const completionRate = Math.round((completedTasks / totalTasks) * 100);
  const inProgressCount = mockTasks.filter((t) => t.status === 'in_progress').length;
  const pendingCount = mockTasks.filter((t) => t.status === 'pending').length;

  const staffTaskTrendData = useMemo(
    () => [
      { value: 3, label: '07:00' },
      { value: 5, label: '09:00' },
      { value: 8, label: '11:00' },
      { value: 6, label: '13:00' },
      { value: 4, label: '15:00' },
    ],
    []
  );

  const adminTaskTrendData = useMemo(
    () => [
      { value: 3, label: '07:00' },
      { value: 5, label: '09:00' },
      { value: 8, label: '11:00' },
      { value: 6, label: '13:00' },
      { value: 4, label: '15:00' },
    ],
    []
  );

  const vitalHrData = useMemo(
    () => [
      { value: 72, label: '06:00' },
      { value: 78, label: '08:00' },
      { value: 82, label: '10:00' },
      { value: 76, label: '12:00' },
      { value: 74, label: '14:00' },
    ],
    []
  );

  const vitalSpo2Data = useMemo(
    () => [
      { value: 98 },
      { value: 97 },
      { value: 96 },
      { value: 98 },
      { value: 99 },
    ],
    []
  );

  const timeString = currentTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fullTimeString = currentTime.toLocaleTimeString();

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
            <Text style={styles.shiftText}>Morning Shift (07:00-15:00)</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.timeText}>{timeString}</Text>
            <Text style={styles.shiftText}>4h 32m</Text>
          </View>
        </View>

        <View style={styles.body}>
          {overdueTasks > 0 ? (
            <Alert variant="destructive" style={styles.alert}>
              <AlertTitle>Urgent Attention Required</AlertTitle>
              <AlertDescription>
                You have {overdueTasks} overdue task{overdueTasks > 1 ? 's' : ''} that need immediate
                attention.
              </AlertDescription>
            </Alert>
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
            <View style={styles.quickGrid}>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: Colors.green600 }]}
                onPress={() => router.push('/(app)/tasks' as any)}
              >
                <ClipboardList size={20} color={Colors.white} />
                <Text style={styles.quickBtnText}>Tasks</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: Colors.purple600 }]}
                onPress={() => router.push('/(app)/handover' as any)}
              >
                <FileText size={20} color={Colors.white} />
                <Text style={styles.quickBtnText}>Handover</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: Colors.orange600 }]}
                onPress={() => router.push('/(app)/charting' as any)}
              >
                <Activity size={20} color={Colors.white} />
                <Text style={styles.quickBtnText}>Charting</Text>
              </Pressable>
              <Pressable
                style={[styles.quickBtn, { backgroundColor: Colors.teal600 }]}
                onPress={() => router.push('/(app)/kardex' as any)}
              >
                <ClipboardList size={20} color={Colors.white} />
                <Text style={styles.quickBtnText}>Kardex</Text>
              </Pressable>
            </View>
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
              <Progress value={30} height={8} fillColor={Colors.warning} />

              <View style={styles.statusRow}>
                <View style={styles.statusLabel}>
                  <View style={[styles.dot, { backgroundColor: Colors.mutedForeground }]} />
                  <Text style={styles.statusText}>Pending</Text>
                </View>
                <Text style={styles.statusCount}>{pendingCount}</Text>
              </View>
              <Progress value={20} height={8} fillColor={Colors.mutedForeground} />

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
                .filter((p) => p.riskLevel === 'high')
                .map((patient) => (
                  <View key={patient.id} style={styles.highRiskCard}>
                    <View style={styles.highRiskHeader}>
                      <View style={styles.flex1}>
                        <Text style={styles.patientName}>{patient.name}</Text>
                        <Text style={styles.patientMeta}>
                          {patient.room}  {patient.diagnosis}
                        </Text>
                      </View>
                      <Badge variant="destructive">HIGH RISK</Badge>
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
              {mockTasks.slice(0, 4).map((task) => (
                <View
                  key={task.id}
                  style={[
                    styles.upcomingCard,
                    task.priority === 'urgent'
                      ? styles.upcomingUrgent
                      : styles.upcomingRoutine,
                  ]}
                >
                  <View style={styles.upcomingRow}>
                    <View style={styles.flex1}>
                      <View style={styles.upcomingBadges}>
                        <Badge
                          variant={task.priority === 'urgent' ? 'destructive' : 'default'}
                          textStyle={styles.badgeXs}
                        >
                          {task.priority === 'urgent' ? 'URGENT' : 'ROUTINE'}
                        </Badge>
                        <View style={styles.dueRow}>
                          <Clock size={12} color={Colors.mutedForeground} />
                          <Text style={styles.dueText}>{task.dueTime}</Text>
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

  // Supervisor / Head Nurse Dashboard
  return (
    <ScrollView
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
          <Text style={styles.shiftText}>Thursday, March 26, 2026</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.statsGrid}>
          <View style={styles.statsCol}>
            <StatCard
              title="Active Nurses"
              value="12"
              subtitle="On current shift"
              icon={Users}
              trend
              trendLabel="+2 from previous"
              iconBg={Colors.blue100}
              iconColor={Colors.blue600}
            />
          </View>
          <View style={styles.statsCol}>
            <StatCard
              title="Total Patients"
              value="38"
              subtitle="Across all units"
              icon={Heart}
              iconBg={Colors.purple100}
              iconColor={Colors.purple600}
            />
          </View>
          <View style={styles.statsCol}>
            <StatCard
              title="Task Completion"
              value={`${completionRate}%`}
              subtitle={`${completedTasks} of ${totalTasks} tasks`}
              icon={CheckCircle}
              trend
              trendLabel="+12% vs yesterday"
              iconBg={Colors.green100}
              iconColor={Colors.green600}
            />
          </View>
          <View style={styles.statsCol}>
            <StatCard
              title="Critical Alerts"
              value="5"
              subtitle="Require attention"
              icon={AlertTriangle}
              iconBg={Colors.red100}
              iconColor={Colors.red600}
            />
          </View>
        </View>

        <Card>
          <CardHeader>
            <CardTitle>Task Activity</CardTitle>
            <CardDescription>Hourly task completion today</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              data={adminTaskTrendData}
              width={chartWidth}
              height={250}
              barWidth={28}
              spacing={28}
              roundedTop
              frontColor="#2D9CDB"
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
            <CardTitle>Vital Signs Trends</CardTitle>
            <CardDescription>Average patient vitals throughout the day</CardDescription>
          </CardHeader>
          <CardContent>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#E53E3E' }]} />
                <Text style={styles.legendText}>Heart Rate</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#2D9CDB' }]} />
                <Text style={styles.legendText}>SpO2</Text>
              </View>
            </View>
            <LineChart
              data={vitalHrData}
              data2={vitalSpo2Data}
              width={chartWidth}
              height={250}
              spacing={Math.max((chartWidth - 40) / 5, 40)}
              color1="#E53E3E"
              color2="#2D9CDB"
              thickness={2}
              areaChart
              startFillColor1="#E53E3E"
              startFillColor2="#2D9CDB"
              endFillColor1="#E53E3E"
              endFillColor2="#2D9CDB"
              startOpacity={0.3}
              endOpacity={0.05}
              hideDataPoints={false}
              dataPointsColor1="#E53E3E"
              dataPointsColor2="#2D9CDB"
              dataPointsRadius={4}
              yAxisThickness={0}
              xAxisThickness={1}
              xAxisColor={Colors.border}
              rulesColor={Colors.border}
              rulesType="dashed"
              noOfSections={4}
              maxValue={110}
              yAxisTextStyle={styles.chartAxis}
              xAxisLabelTextStyle={styles.chartAxis}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nurse Workload Monitor</CardTitle>
            <CardDescription>
              Current shift nurse-to-patient ratios and burnout risk
            </CardDescription>
          </CardHeader>
          <CardContent style={styles.gap12}>
            {mockWorkloadData.map((nurse) => (
              <View
                key={nurse.nurseId}
                style={[
                  styles.workloadCard,
                  nurse.burnoutRisk === 'high'
                    ? styles.riskHigh
                    : nurse.burnoutRisk === 'medium'
                      ? styles.riskMed
                      : styles.riskLow,
                ]}
              >
                <View style={styles.workloadHeader}>
                  <View>
                    <Text style={styles.patientName}>{nurse.nurseName}</Text>
                    <Text style={styles.patientMeta}>{nurse.shift}</Text>
                  </View>
                  <Badge
                    variant={
                      nurse.burnoutRisk === 'high'
                        ? 'destructive'
                        : nurse.burnoutRisk === 'medium'
                          ? 'default'
                          : 'outline'
                    }
                  >
                    {nurse.burnoutRisk === 'high'
                      ? 'HIGH RISK'
                      : nurse.burnoutRisk === 'medium'
                        ? 'MEDIUM RISK'
                        : 'LOW RISK'}
                  </Badge>
                </View>
                <View style={styles.workloadMetrics}>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Patients</Text>
                    <Text style={styles.metricValue}>{nurse.patientCount}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Tasks</Text>
                    <Text style={styles.metricValue}>
                      {nurse.completedTasks}/{nurse.taskCount}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Completion</Text>
                    <Text style={[styles.metricValue, { color: Colors.success }]}>
                      {Math.round((nurse.completedTasks / nurse.taskCount) * 100)}%
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Overtime</Text>
                    <Text style={[styles.metricValue, { color: Colors.warning }]}>
                      {nurse.overtimeHours}h
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Ratio</Text>
                    <Text style={[styles.metricValue, { color: Colors.primary }]}>
                      1:{Math.floor(nurse.patientCount)}
                    </Text>
                  </View>
                </View>
                <Progress
                  value={(nurse.completedTasks / nurse.taskCount) * 100}
                  height={8}
                />
              </View>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <View style={styles.cardTitleRow}>
              <AlertTriangle size={20} color={Colors.destructive} />
              <CardTitle>Patient Safety Alerts</CardTitle>
            </View>
            <CardDescription>High-priority alerts requiring immediate attention</CardDescription>
          </CardHeader>
          <CardContent style={styles.gap12}>
            <Alert variant="destructive">
              <AlertTitle>Critical - Maria Garcia (ICU-202)</AlertTitle>
              <AlertDescription>
                Vital signs unstable. BP 98/62, HR 118, Temp 38.9°C. Immediate assessment required.
              </AlertDescription>
              <View style={styles.alertActions}>
                <Button
                  size="sm"
                  variant="destructive"
                  onPress={() => router.push('/(app)/workload' as any)}
                >
                  Respond Now
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() =>
                    toast.success('Notification sent to assigned nurse', {
                      description:
                        "The nurse has been notified about the patient's unstable vital signs.",
                    })
                  }
                >
                  Notify Nurse
                </Button>
              </View>
            </Alert>

            <Alert variant="warning">
              <AlertTitle>Delayed Task - John Smith (ICU-201)</AlertTitle>
              <AlertDescription>
                Cardiac medication overdue by 30 minutes. Assigned nurse: Sarah Johnson.
              </AlertDescription>
              <View style={styles.alertActions}>
                <Button
                  size="sm"
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/nurse-tasks/[name]',
                      params: { name: 'Sarah Johnson' },
                    } as any)
                  }
                >
                  View Task
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() =>
                    toast.success('Notification sent to Sarah Johnson', {
                      description:
                        'The nurse has been notified about the delayed cardiac medication task.',
                    })
                  }
                >
                  Notify Nurse
                </Button>
              </View>
            </Alert>
          </CardContent>
        </Card>

        <View style={styles.deptGrid}>
          <Card style={styles.deptCard}>
            <CardHeader>
              <CardTitle>ICU Department</CardTitle>
            </CardHeader>
            <CardContent style={styles.gap12}>
              <View style={styles.deptRow}>
                <Text style={styles.deptLabel}>Occupancy</Text>
                <Text style={styles.deptValue}>15/20</Text>
              </View>
              <Progress value={75} height={8} />
              <View style={styles.deptFooter}>
                <Text style={styles.deptMeta}>
                  Critical: <Text style={styles.criticalText}>3</Text>
                </Text>
                <Text style={styles.deptMeta}>
                  Stable: <Text style={styles.stableText}>12</Text>
                </Text>
              </View>
            </CardContent>
          </Card>

          <Card style={styles.deptCard}>
            <CardHeader>
              <CardTitle>General Ward</CardTitle>
            </CardHeader>
            <CardContent style={styles.gap12}>
              <View style={styles.deptRow}>
                <Text style={styles.deptLabel}>Occupancy</Text>
                <Text style={styles.deptValue}>18/25</Text>
              </View>
              <Progress value={72} height={8} />
              <View style={styles.deptFooter}>
                <Text style={styles.deptMeta}>
                  Critical: <Text style={styles.criticalText}>1</Text>
                </Text>
                <Text style={styles.deptMeta}>
                  Stable: <Text style={styles.stableText}>17</Text>
                </Text>
              </View>
            </CardContent>
          </Card>

          <Card style={styles.deptCard}>
            <CardHeader>
              <CardTitle>Emergency</CardTitle>
            </CardHeader>
            <CardContent style={styles.gap12}>
              <View style={styles.deptRow}>
                <Text style={styles.deptLabel}>Occupancy</Text>
                <Text style={styles.deptValue}>5/10</Text>
              </View>
              <Progress value={50} height={8} />
              <View style={styles.deptFooter}>
                <Text style={styles.deptMeta}>
                  Critical: <Text style={styles.criticalText}>2</Text>
                </Text>
                <Text style={styles.deptMeta}>
                  Stable: <Text style={styles.stableText}>3</Text>
                </Text>
              </View>
            </CardContent>
          </Card>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickBtn: {
    width: '47%',
    flexGrow: 1,
    minWidth: 140,
    height: 80,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...Shadows.sm,
  },
  quickBtnText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
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
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  workloadCard: {
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  riskHigh: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  riskMed: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  riskLow: {
    borderColor: 'rgba(16, 185, 129, 0.3)',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  workloadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  workloadMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  metric: {
    minWidth: 70,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  alertActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  deptGrid: {
    gap: 16,
  },
  deptCard: {},
  deptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deptLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedForeground,
  },
  deptValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foreground,
  },
  deptFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  deptMeta: {
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  criticalText: {
    fontWeight: '700',
    color: Colors.destructive,
  },
  stableText: {
    fontWeight: '700',
    color: Colors.success,
  },
});
