import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Plus, Square, CheckSquare, AlertCircle, Users } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';
import { Select } from './Select';
import { ConfirmDialog } from './ConfirmDialog';
import { fetchDepartments, fetchDoctors, ApiError } from '../services/api';
import type { Department, Doctor } from '../types/domain';

interface CareTeamGroup {
  departmentId: string;
  departmentName: string;
  doctors: Doctor[];
  loading: boolean;
  error: string;
}

interface PatientCareTeamProps {
  /** Seed data — this patient's currently assigned doctors, fetched once by
   * the parent. Only read on mount; pass a `key` from the parent (e.g. the
   * patient id) to force a remount when the patient changes. */
  initialAssignedDoctors: Doctor[];
  doctorIds: number[];
  onChange: (ids: number[]) => void;
  /** Fires whenever a department has been added but has no doctor selected
   * yet, so the parent's Save can be gated on it. */
  onValidityChange?: (valid: boolean) => void;
}

export function PatientCareTeam({
  initialAssignedDoctors,
  doctorIds,
  onChange,
  onValidityChange,
}: PatientCareTeamProps) {
  const [groups, setGroups] = useState<CareTeamGroup[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [pendingDepartmentId, setPendingDepartmentId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const loadRoster = async (departmentId: string) => {
    try {
      const doctors = await fetchDoctors({ departmentId });
      setGroups((prev) =>
        prev.map((g) => (g.departmentId === departmentId ? { ...g, doctors, loading: false } : g))
      );
    } catch (e) {
      setGroups((prev) =>
        prev.map((g) =>
          g.departmentId === departmentId
            ? {
                ...g,
                loading: false,
                error: e instanceof ApiError ? e.message : 'Unable to load doctors.',
              }
            : g
        )
      );
    }
  };

  useEffect(() => {
    const byDept = new Map<string, string>();
    initialAssignedDoctors.forEach((d) => byDept.set(String(d.departmentId), d.departmentName));
    const initialGroups: CareTeamGroup[] = Array.from(byDept.entries()).map(([id, name]) => ({
      departmentId: id,
      departmentName: name,
      doctors: [],
      loading: true,
      error: '',
    }));
    setGroups(initialGroups);
    initialGroups.forEach((g) => loadRoster(g.departmentId));
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
    // Mount-only: the parent remounts this component (via `key`) when the
    // patient changes, so re-running this on every prop change isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const incomplete = groups.some(
      (g) => !g.loading && !g.doctors.some((d) => doctorIds.includes(d.id))
    );
    onValidityChange?.(!incomplete);
  }, [groups, doctorIds, onValidityChange]);

  const usedDepartmentIds = new Set(groups.map((g) => g.departmentId));

  const addDepartment = (departmentId: string) => {
    const dept = departments.find((d) => String(d.id) === departmentId);
    if (!dept || usedDepartmentIds.has(departmentId)) return;
    setGroups((prev) => [
      ...prev,
      { departmentId, departmentName: dept.name, doctors: [], loading: true, error: '' },
    ]);
    loadRoster(departmentId);
    setAddingDepartment(false);
    setPendingDepartmentId('');
  };

  const removeGroup = (departmentId: string) => {
    const group = groups.find((g) => g.departmentId === departmentId);
    if (group) {
      const idsInGroup = new Set(group.doctors.map((d) => d.id));
      onChange(doctorIds.filter((id) => !idsInGroup.has(id)));
    }
    setGroups((prev) => prev.filter((g) => g.departmentId !== departmentId));
    setRemoveTarget(null);
  };

  const toggleDoctor = (doctor: Doctor) => {
    const isSelected = doctorIds.includes(doctor.id);
    if (!isSelected && doctor.status !== 'active') return;
    onChange(isSelected ? doctorIds.filter((id) => id !== doctor.id) : [...doctorIds, doctor.id]);
  };

  const totalSelectedInGroup = (group: CareTeamGroup) =>
    group.doctors.filter((d) => doctorIds.includes(d.id)).length;

  const removeTargetGroup = groups.find((g) => g.departmentId === removeTarget);

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <Users size={16} color={Colors.blue600} />
        <Text style={styles.summaryText}>
          {groups.length} {groups.length === 1 ? 'department' : 'departments'} •{' '}
          {doctorIds.length} {doctorIds.length === 1 ? 'doctor' : 'doctors'} assigned
        </Text>
      </View>

      {groups.length === 0 && !addingDepartment ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No care team assigned yet.</Text>
          <Text style={styles.emptyText}>
            Add a department and assign one or more doctors responsible for this patient's care.
          </Text>
        </View>
      ) : null}

      {groups.map((group) => {
        const selectedCount = totalSelectedInGroup(group);
        return (
          <View key={group.departmentId} style={styles.groupCard}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{group.departmentName}</Text>
              <Pressable onPress={() => setRemoveTarget(group.departmentId)} hitSlop={6}>
                <Text style={styles.removeLink}>Remove Department</Text>
              </Pressable>
            </View>

            {group.loading ? (
              <View style={styles.groupStateBox}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.groupStateText}>Loading doctors...</Text>
              </View>
            ) : group.error ? (
              <View style={styles.groupStateBox}>
                <AlertCircle size={16} color={Colors.destructive} />
                <Text style={[styles.groupStateText, { color: Colors.destructive }]}>
                  {group.error}
                </Text>
              </View>
            ) : group.doctors.length === 0 ? (
              <Text style={styles.groupStateText}>No doctors are available in this department.</Text>
            ) : (
              <View style={styles.doctorList}>
                {group.doctors.map((doctor) => {
                  const isSelected = doctorIds.includes(doctor.id);
                  const isAvailable = doctor.status === 'active';
                  return (
                    <Pressable
                      key={doctor.id}
                      onPress={() => toggleDoctor(doctor)}
                      disabled={!isAvailable && !isSelected}
                      style={[
                        styles.doctorRow,
                        isSelected && styles.doctorRowSelected,
                        !isAvailable && !isSelected && styles.doctorRowDisabled,
                      ]}
                    >
                      {isSelected ? (
                        <CheckSquare size={18} color={Colors.primary} />
                      ) : (
                        <Square size={18} color={isAvailable ? Colors.gray400 : Colors.gray300} />
                      )}
                      <View style={styles.doctorInfo}>
                        <Text style={styles.doctorName}>{doctor.fullName}</Text>
                        <Text style={styles.doctorSpecialization}>{doctor.specialization}</Text>
                      </View>
                      <View style={styles.statusPill}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: isAvailable ? Colors.green600 : Colors.gray400 },
                          ]}
                        />
                        <Text style={styles.statusText}>
                          {isAvailable ? 'Available' : 'Inactive'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {!group.loading && !group.error && selectedCount === 0 ? (
              <Text style={styles.warningText}>
                Please assign at least one doctor to this department.
              </Text>
            ) : null}
          </View>
        );
      })}

      {addingDepartment ? (
        <View style={styles.addBox}>
          <Select
            label="Department *"
            value={pendingDepartmentId}
            onValueChange={setPendingDepartmentId}
            options={departments
              .filter((d) => !usedDepartmentIds.has(String(d.id)))
              .map((d) => ({ label: d.name, value: String(d.id) }))}
            placeholder="Choose a department"
            searchable
            searchPlaceholder="Search departments..."
          />
          <View style={styles.addBoxActions}>
            <Pressable
              onPress={() => {
                setAddingDepartment(false);
                setPendingDepartmentId('');
              }}
              style={styles.addBoxCancel}
            >
              <Text style={styles.addBoxCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => pendingDepartmentId && addDepartment(pendingDepartmentId)}
              disabled={!pendingDepartmentId}
              style={[styles.addBoxConfirm, !pendingDepartmentId && styles.addBoxConfirmDisabled]}
            >
              <Text style={styles.addBoxConfirmText}>Add to Care Team</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setAddingDepartment(true)} style={styles.addDeptBtn}>
          <Plus size={16} color={Colors.blue700} />
          <Text style={styles.addDeptText}>Add Department</Text>
        </Pressable>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove department?"
        description={
          removeTargetGroup
            ? `Remove ${removeTargetGroup.departmentName} and its assigned doctors from this patient's care team?`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removeTarget) removeGroup(removeTarget);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { fontSize: 13, fontWeight: '600', color: Colors.blue700 },
  emptyBox: {
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
    gap: 4,
  },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  emptyText: { fontSize: 12, color: Colors.mutedForeground, lineHeight: 17 },
  groupCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
    backgroundColor: Colors.card,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  removeLink: { fontSize: 12, fontWeight: '600', color: Colors.destructive },
  groupStateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  groupStateText: { fontSize: 12, color: Colors.mutedForeground },
  doctorList: { gap: 6 },
  doctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBackground,
  },
  doctorRowSelected: {
    backgroundColor: Colors.blue50,
    borderColor: Colors.blue200,
  },
  doctorRowDisabled: { opacity: 0.5 },
  doctorInfo: { flex: 1, gap: 1 },
  doctorName: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  doctorSpecialization: { fontSize: 11, color: Colors.mutedForeground },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, color: Colors.mutedForeground },
  warningText: { fontSize: 11, color: Colors.warning },
  addDeptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.blue300,
    backgroundColor: Colors.blue50,
  },
  addDeptText: { fontSize: 13, fontWeight: '600', color: Colors.blue700 },
  addBox: {
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.md,
    padding: 12,
    gap: 10,
    backgroundColor: Colors.blue50,
  },
  addBoxActions: { flexDirection: 'row', gap: 10 },
  addBoxCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  addBoxCancelText: { fontSize: 13, fontWeight: '600', color: Colors.mutedForeground },
  addBoxConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: Radius.md,
    backgroundColor: Colors.blue600,
  },
  addBoxConfirmDisabled: { opacity: 0.5 },
  addBoxConfirmText: { fontSize: 13, fontWeight: '600', color: Colors.white },
});
