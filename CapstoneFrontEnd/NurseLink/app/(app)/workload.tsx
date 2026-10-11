import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
// Wrapper that honours the Show Charts & Graphs setting; same API.
import { BarChart, LineChart } from '../../components/Charts';
import {
  AlertTriangle,
  UserPlus,
  Users,
  Clock,
  Activity,
  Trash2,
  Edit2,
  Search,
} from 'lucide-react-native';
import {
  fetchWorkload,
  fetchAssignments,
  fetchTasks,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  assignNurse,
  ApiError,
} from '../../services/api';
import type { PatientAssignmentRecord, Task, WorkloadData } from '../../types/domain';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Progress } from '../../components/Progress';
import { Alert, AlertDescription, AlertTitle } from '../../components/Alert';
import { Tabs } from '../../components/Tabs';
import { AssignPatientModal } from '../../components/AssignPatientModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { NurseAssignModal, type AssignTarget } from '../../components/NurseAssignModal';
import type { PatientAssignment } from '../../types';
import { Colors } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';

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

export default function WorkloadPage() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 64, 280);
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [workloadData, setWorkloadData] = useState<WorkloadData[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PatientAssignment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [nurseSearch, setNurseSearch] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [workload, assignmentData, tasks] = await Promise.all([
        fetchWorkload(),
        fetchAssignments({ status: 'active' }),
        fetchTasks(),
      ]);
      setWorkloadData(workload);
      setAssignments(assignmentData.map(toLocalAssignment));
      setAllTasks(tasks);
    } catch (error) {
      toast.error('Failed to load workload', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      await loadData();
    })();
  }, [loadData]);

  const highRisk = workloadData.filter((n) => n.burnoutRisk === 'high');
  const availableNurses = workloadData.map((nurse) => ({
    id: nurse.nurseId,
    name: nurse.nurseName,
    patientCount: nurse.patientCount,
  }));

  const filteredWorkload = useMemo(() => {
    const query = nurseSearch.trim().toLowerCase();
    if (!query) return workloadData;
    return workloadData.filter((n) => n.nurseName.toLowerCase().includes(query));
  }, [workloadData, nurseSearch]);

  const overtimeData = useMemo(() => {
    const byShift: Record<string, number[]> = { morning: [], afternoon: [], night: [] };
    workloadData.forEach((n) => {
      // Unassigned nurses (no shift yet) don't belong in any bucket —
      // lumping them into Morning skewed that shift's average.
      if (!n.shift) return;
      const key = n.shift as keyof typeof byShift;
      if (byShift[key]) byShift[key].push(n.overtimeHours);
    });
    return (['morning', 'afternoon', 'night'] as const).map((shift) => {
      const vals = byShift[shift];
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return {
        value: Math.round(avg * 10) / 10,
        label: shift.charAt(0).toUpperCase() + shift.slice(1),
      };
    });
  }, [workloadData]);

  const ratioData = useMemo(
    () =>
      workloadData.slice(0, 7).map((n) => ({
        value: n.patientCount,
        label: n.nurseName.split(' ')[0],
      })),
    [workloadData]
  );

  const handleSubmit = async (
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
      const saved = editing
        ? await updateAssignment(editing.id, payload)
        : await createAssignment(payload);
      const local = toLocalAssignment(saved);
      if (editing) {
        setAssignments((prev) => prev.map((a) => (a.id === editing.id ? local : a)));
      } else {
        setAssignments((prev) => [local, ...prev.filter((a) => a.patientId !== local.patientId)]);
      }
      await loadData();
      setEditing(null);
      setModalOpen(false);
      toast.success(editing ? 'Assignment updated' : 'Patient assigned');
    } catch (error) {
      toast.error('Failed to save assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteAssignment(toDelete);
      setAssignments((prev) => prev.filter((a) => a.id !== toDelete));
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

  const byDepartment = useMemo(() => {
    const groups: Record<string, WorkloadData[]> = {};
    workloadData.forEach((nurse) => {
      const key = nurse.department || 'Unassigned';
      if (!groups[key]) groups[key] = [];
      groups[key].push(nurse);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [workloadData]);

  const handleAssignSave = async (data: { department: string; shift: string }) => {
    if (!assignTarget) return;
    try {
      await assignNurse(assignTarget.id, data);
      await loadData();
      toast.success('Nurse assignment updated');
    } catch (error) {
      toast.error('Failed to update assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
      throw error;
    }
  };

  const riskStyles = (risk: string) => {
    if (risk === 'high') return styles.riskHigh;
    if (risk === 'medium') return styles.riskMed;
    return styles.riskLow;
  };

  if (loading) {
    return (
      <View style={[styles.scroll, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.blue600} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.flex1}>
            <Text style={styles.title}>Workload Monitor</Text>
            <Text style={styles.subtitle}>
              Real-time nurse workload and burnout risk assessment
            </Text>
          </View>
          <Button
            size="sm"
            onPress={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <UserPlus size={16} color={Colors.white} />
            <Text style={styles.btnText}>Assign</Text>
          </Button>
        </View>

        {highRisk.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>High Burnout Risk Detected</AlertTitle>
            <AlertDescription>
              {highRisk.length} nurse{highRisk.length > 1 ? 's' : ''} currently at high burnout
              risk. Review assignments and redistribute patients if needed.
            </AlertDescription>
          </Alert>
        ) : null}

        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Users size={16} color={Colors.blue600} />
              <Text style={styles.statValue}>{workloadData.length}</Text>
              <Text style={styles.statLabel}>Active Nurses</Text>
            </CardContent>
          </Card>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <AlertTriangle size={16} color={Colors.red600} />
              <Text style={[styles.statValue, { color: Colors.red600 }]}>{highRisk.length}</Text>
              <Text style={styles.statLabel}>High Risk</Text>
            </CardContent>
          </Card>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Activity size={16} color={Colors.purple600} />
              <Text style={styles.statValue}>
                {workloadData.length
                  ? (
                      workloadData.reduce((s, n) => s + n.patientCount, 0) /
                      workloadData.length
                    ).toFixed(1)
                  : '0'}
              </Text>
              <Text style={styles.statLabel}>Avg Patients</Text>
            </CardContent>
          </Card>
          <Card style={styles.statCard}>
            <CardContent style={styles.statContent}>
              <Clock size={16} color={Colors.orange600} />
              <Text style={styles.statValue}>
                {workloadData.length
                  ? (
                      workloadData.reduce((s, n) => s + n.overtimeHours, 0) /
                      workloadData.length
                    ).toFixed(1)
                  : '0'}
                h
              </Text>
              <Text style={styles.statLabel}>Avg Overtime</Text>
            </CardContent>
          </Card>
        </View>

        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'team', label: 'Team' },
            { value: 'assignments', label: 'Assignments', badge: assignments.length },
            { value: 'trends', label: 'Trends' },
          ]}
        />

        {tab === 'overview' ? (
          <View style={styles.gap12}>
            <Input
              placeholder="Search nurses by name..."
              value={nurseSearch}
              onChangeText={setNurseSearch}
              autoCapitalize="none"
              autoCorrect={false}
              leftIcon={<Search size={16} color={Colors.mutedForeground} />}
            />
            {filteredWorkload.length === 0 ? (
              <Card>
                <CardContent style={styles.emptySearch}>
                  <Text style={styles.emptySearchText}>
                    No nurses match &quot;{nurseSearch}&quot;.
                  </Text>
                </CardContent>
              </Card>
            ) : null}
            {filteredWorkload.map((nurse) => (
              <Card key={nurse.nurseId} style={riskStyles(nurse.burnoutRisk)}>
                <CardContent style={styles.nurseCard}>
                  <View style={styles.nurseHeader}>
                    <View style={styles.flex1}>
                      <Text style={styles.nurseName}>{nurse.nurseName}</Text>
                      <Text style={styles.nurseShift}>{nurse.shift}</Text>
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
                      {`${nurse.burnoutRisk.toUpperCase()} RISK`}
                    </Badge>
                  </View>
                  <View style={styles.metrics}>
                    <Metric label="Patients" value={String(nurse.patientCount)} />
                    <Metric
                      label="Tasks"
                      value={`${nurse.completedTasks}/${nurse.taskCount}`}
                    />
                    <Metric
                      label="Done"
                      value={`${nurse.taskCount ? Math.round((nurse.completedTasks / nurse.taskCount) * 100) : 0}%`}
                      color={Colors.green600}
                    />
                    <Metric
                      label="Overtime"
                      value={`${nurse.overtimeHours}h`}
                      color={Colors.warning}
                    />
                  </View>
                  <Progress
                    value={(nurse.completedTasks / nurse.taskCount) * 100}
                    height={8}
                  />
                </CardContent>
              </Card>
            ))}
          </View>
        ) : null}

        {tab === 'team' ? (
          <View style={styles.gap12}>
            {byDepartment.length === 0 ? (
              <Card>
                <CardContent style={styles.empty}>
                  <Text style={styles.muted}>No nurses found</Text>
                </CardContent>
              </Card>
            ) : (
              byDepartment.map(([department, nurses]) => (
                <Card key={department}>
                  <CardHeader>
                    <CardTitle>{department}</CardTitle>
                    <CardDescription>
                      {nurses.length} nurse{nurses.length === 1 ? '' : 's'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent style={styles.gap12}>
                    {nurses.map((nurse) => (
                      <View key={nurse.nurseId} style={styles.teamRow}>
                        <View style={styles.flex1}>
                          <Text style={styles.nurseName}>{nurse.nurseName}</Text>
                          {/* Several nurses on this ward share a display name —
                              without the email, there is no way to tell which
                              account "Assign" below is about to change. */}
                          <Text style={styles.nurseEmail}>{nurse.nurseEmail}</Text>
                          <Text style={styles.nurseShift}>
                            {nurse.shift.charAt(0).toUpperCase() + nurse.shift.slice(1)} shift
                          </Text>
                        </View>
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={() => {
                            setAssignTarget({
                              id: nurse.nurseId,
                              name: nurse.nurseName,
                              email: nurse.nurseEmail,
                              department: nurse.department,
                              shift: nurse.shift,
                            });
                            setAssignOpen(true);
                          }}
                        >
                          <Edit2 size={14} color={Colors.foreground} />
                          <Text style={styles.outlineText}>Assign</Text>
                        </Button>
                      </View>
                    ))}
                  </CardContent>
                </Card>
              ))
            )}
          </View>
        ) : null}

        {tab === 'assignments' ? (
          <View style={styles.gap12}>
            {assignments.length === 0 ? (
              <Card>
                <CardContent style={styles.empty}>
                  <Text style={styles.muted}>No patient assignments yet</Text>
                </CardContent>
              </Card>
            ) : (
              assignments.map((a) => (
                <Card key={a.id}>
                  <CardContent style={styles.assignCard}>
                    <View style={styles.nurseHeader}>
                      <View style={styles.flex1}>
                        <Text style={styles.nurseName}>{a.patientName}</Text>
                        <Text style={styles.nurseShift}>
                          {a.patientId} · {a.room} · {a.ward}
                        </Text>
                      </View>
                      <Badge variant={a.priority === 'urgent' ? 'destructive' : 'outline'}>
                        {a.priority.toUpperCase()}
                      </Badge>
                    </View>
                    <Text style={styles.diagnosis}>{a.diagnosis}</Text>
                    <Text style={styles.assignedTo}>Assigned to {a.assignedNurse}</Text>
                    {a.notes ? <Text style={styles.notes}>{a.notes}</Text> : null}
                    <View style={styles.assignActions}>
                      <Button
                        size="sm"
                        variant="outline"
                        onPress={() => {
                          setEditing(a);
                          setModalOpen(true);
                        }}
                      >
                        <Edit2 size={14} color={Colors.foreground} />
                        <Text style={styles.outlineText}>Edit</Text>
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onPress={() => {
                          setToDelete(a.id);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 size={14} color={Colors.white} />
                        <Text style={styles.btnText}>Remove</Text>
                      </Button>
                    </View>
                  </CardContent>
                </Card>
              ))
            )}
          </View>
        ) : null}

        {tab === 'trends' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Average Overtime by Shift</CardTitle>
                <CardDescription>Hours of overtime across shifts</CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={overtimeData}
                  width={chartWidth}
                  height={220}
                  barWidth={36}
                  spacing={40}
                  frontColor={Colors.orange600}
                  roundedTop
                  yAxisThickness={0}
                  xAxisThickness={1}
                  xAxisColor={Colors.border}
                  rulesColor={Colors.border}
                  rulesType="dashed"
                  noOfSections={4}
                  maxValue={5}
                  yAxisTextStyle={styles.axis}
                  xAxisLabelTextStyle={styles.axis}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Nurse-to-Patient Ratio</CardTitle>
                <CardDescription>Average patients per nurse this week</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  data={ratioData}
                  width={chartWidth}
                  height={240}
                  spacing={Math.max((chartWidth - 40) / 7, 36)}
                  color={Colors.blue600}
                  thickness={2}
                  areaChart
                  startFillColor={Colors.blue600}
                  endFillColor={Colors.blue600}
                  startOpacity={0.25}
                  endOpacity={0.05}
                  dataPointsColor={Colors.blue600}
                  yAxisThickness={0}
                  xAxisThickness={1}
                  xAxisColor={Colors.border}
                  rulesColor={Colors.border}
                  rulesType="dashed"
                  noOfSections={4}
                  maxValue={5}
                  yAxisTextStyle={styles.axis}
                  xAxisLabelTextStyle={styles.axis}
                />
              </CardContent>
            </Card>
          </>
        ) : null}
      </ScrollView>

      <AssignPatientModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
        editingAssignment={editing}
        availableNurses={availableNurses}
        allTasks={allTasks}
        allAssignments={assignments}
      />

      <NurseAssignModal
        open={assignOpen}
        onOpenChange={setAssignOpen}
        nurse={assignTarget}
        onSave={handleAssignSave}
      />

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
    </>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2 },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 13 },
  outlineText: { color: Colors.foreground, fontWeight: '600', fontSize: 13 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', flexGrow: 1, minWidth: 140 },
  statContent: { padding: 12, gap: 4 },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  statLabel: { fontSize: 11, color: Colors.mutedForeground },
  gap12: { gap: 12 },
  emptySearch: { alignItems: 'center', paddingVertical: 24 },
  emptySearchText: { fontSize: 13, color: Colors.mutedForeground },
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
  nurseCard: { padding: 14, gap: 12 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nurseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nurseName: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  nurseEmail: { fontSize: 11.5, color: Colors.gray500, marginTop: 1 },
  nurseShift: { fontSize: 12, color: Colors.mutedForeground, marginTop: 2 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { minWidth: 70 },
  metricLabel: { fontSize: 11, color: Colors.mutedForeground },
  metricValue: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  assignCard: { padding: 14, gap: 8 },
  diagnosis: { fontSize: 13, color: Colors.foreground },
  assignedTo: { fontSize: 12, fontWeight: '600', color: Colors.blue700 },
  notes: { fontSize: 12, color: Colors.mutedForeground, lineHeight: 17 },
  assignActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  empty: { paddingVertical: 32, alignItems: 'center' },
  muted: { color: Colors.mutedForeground },
  axis: { fontSize: 11, color: Colors.mutedForeground },
});
