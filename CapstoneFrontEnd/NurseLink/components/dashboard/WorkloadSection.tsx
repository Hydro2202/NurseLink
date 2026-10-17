import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users, Edit2, Trash2, Search, UserPlus } from 'lucide-react-native';
import { Card, CardContent } from '../Card';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Input } from '../Input';
import { Progress } from '../Progress';
import { Tabs } from '../Tabs';
import { ConfirmDialog } from '../ConfirmDialog';
import { NurseAssignModal, type AssignTarget } from '../NurseAssignModal';
import { PresenceDot } from '../PresenceDot';
import { presenceLabel, sortByPresence } from '../../utils/presence';
import { assignNurse, deleteAssignment, ApiError } from '../../services/api';
import type { PatientAssignment } from '../../types';
import type { WorkloadData } from '../../types/domain';
import { Colors } from '../../constants/colors';
import { useToast } from '../../contexts/ToastContext';

interface WorkloadSectionProps {
  workloadData: WorkloadData[];
  assignments: PatientAssignment[];
  loading: boolean;
  onAssignPatientClick: () => void;
  onEditAssignment: (assignment: PatientAssignment) => void;
  onRefresh: () => void | Promise<void>;
}

/**
 * Nurse Workload + Patient Assignments — the full version of what used to
 * be its own "Workload Monitor" page (see app/(app)/workload.tsx, now a
 * redirect), folded into the head nurse dashboard. Owns its own
 * nurse-reassign and delete-assignment mutations directly; creating/editing
 * an assignment opens the dashboard's shared AssignPatientModal instead
 * (the same one "Respond Now" on a Safety Alert opens), so there is only
 * ever one instance of that modal on the page.
 */
export function WorkloadSection({
  workloadData,
  assignments,
  loading,
  onAssignPatientClick,
  onEditAssignment,
  onRefresh,
}: WorkloadSectionProps) {
  const toast = useToast();
  const [tab, setTab] = useState('nurses');
  const [nurseSearch, setNurseSearch] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const filteredWorkload = useMemo(() => {
    const query = nurseSearch.trim().toLowerCase();
    const base = query ? workloadData.filter((n) => n.nurseName.toLowerCase().includes(query)) : workloadData;
    return sortByPresence(base);
  }, [workloadData, nurseSearch]);

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

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <View style={styles.flex1}>
          <Text style={styles.title}>Nurse Workload</Text>
          <Text style={styles.subtitle}>Per-nurse workload and active patient assignments</Text>
        </View>
        <Button size="sm" onPress={onAssignPatientClick}>
          <UserPlus size={16} color={Colors.white} />
          <Text style={styles.btnText}>Assign Patient</Text>
        </Button>
      </View>

      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'nurses', label: 'Nurses' },
          { value: 'assignments', label: 'Assignments', badge: assignments.length },
        ]}
      />

      {tab === 'nurses' ? (
        <View style={styles.gap12}>
          <Input
            placeholder="Search nurses by name..."
            value={nurseSearch}
            onChangeText={setNurseSearch}
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon={<Search size={16} color={Colors.mutedForeground} />}
          />
          {!loading && filteredWorkload.length === 0 ? (
            <Card>
              <CardContent style={styles.empty}>
                <Text style={styles.muted}>
                  {nurseSearch ? `No nurses match "${nurseSearch}".` : 'No nurses found.'}
                </Text>
              </CardContent>
            </Card>
          ) : null}
          {filteredWorkload.map((nurse) => (
            <Card key={nurse.nurseId}>
              <CardContent style={styles.nurseCard}>
                <View style={styles.nurseHeader}>
                  <View style={styles.flex1}>
                    <View style={styles.nameRow}>
                      <PresenceDot presence={nurse.presence} lastSeenAt={nurse.lastSeenAt} />
                      <Text style={styles.nurseName}>{nurse.nurseName}</Text>
                    </View>
                    {/* Several nurses share a display name — without the email
                        there's no way to tell which account "Assign" is about
                        to change. */}
                    <Text style={styles.nurseEmail}>{nurse.nurseEmail}</Text>
                    <Text style={styles.nurseShift}>
                      {nurse.department || 'No department'}
                      {nurse.shift ? ` · ${nurse.shift.charAt(0).toUpperCase() + nurse.shift.slice(1)} shift` : ' · No duty assigned'}
                      {' · '}
                      {presenceLabel(nurse.presence, nurse.lastSeenAt)}
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
                        presence: nurse.presence,
                        lastSeenAt: nurse.lastSeenAt,
                      });
                      setAssignOpen(true);
                    }}
                  >
                    <Edit2 size={14} color={Colors.foreground} />
                    <Text style={styles.outlineText}>Assign</Text>
                  </Button>
                </View>
                <View style={styles.metrics}>
                  <Metric label="Patients" value={String(nurse.patientCount)} />
                  <Metric label="Tasks" value={`${nurse.completedTasks}/${nurse.taskCount}`} />
                  <Metric
                    label="Done"
                    value={`${nurse.taskCount ? Math.round((nurse.completedTasks / nurse.taskCount) * 100) : 0}%`}
                    color={Colors.green600}
                  />
                  <Metric label="Overtime" value={`${nurse.overtimeHours}h`} color={Colors.warning} />
                </View>
                <Progress
                  value={nurse.taskCount ? (nurse.completedTasks / nurse.taskCount) * 100 : 0}
                  height={8}
                />
              </CardContent>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'assignments' ? (
        <View style={styles.gap12}>
          {!loading && assignments.length === 0 ? (
            <Card>
              <CardContent style={styles.empty}>
                <Users size={28} color={Colors.gray400} />
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
                  {a.diagnosis ? <Text style={styles.diagnosis}>{a.diagnosis}</Text> : null}
                  <Text style={styles.assignedTo}>Assigned to {a.assignedNurse}</Text>
                  {a.notes ? <Text style={styles.notes}>{a.notes}</Text> : null}
                  <View style={styles.assignActions}>
                    <Button size="sm" variant="outline" onPress={() => onEditAssignment(a)}>
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
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
  btnText: { color: Colors.white, fontWeight: '600', fontSize: 13 },
  outlineText: { color: Colors.foreground, fontWeight: '600', fontSize: 13 },
  gap12: { gap: 12 },
  nurseCard: { padding: 14, gap: 12 },
  nurseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  empty: { paddingVertical: 28, alignItems: 'center', gap: 8 },
  muted: { color: Colors.mutedForeground, fontSize: 13 },
});
