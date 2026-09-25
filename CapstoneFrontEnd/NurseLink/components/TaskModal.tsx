import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import { Bed, ClipboardList, Building2, CheckCircle2, Square, CheckSquare, AlertCircle } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import {
  fetchPatients,
  fetchPatientAssignedDoctors,
  ApiError,
} from '../services/api';
import type { Doctor, Patient, Task } from '../types/domain';

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSave: (task: Partial<Task>) => Promise<void>;
  mode: 'add' | 'edit';
  allTasks?: Task[];
  // 'mine' scopes the patient picker to patients assigned to the logged-in
  // user (nurse's own Add New Task). Defaults to 'all' so head-nurse-facing
  // call sites (e.g. managing a specific nurse's tasks) keep their existing
  // unscoped roster.
  patientScope?: 'mine' | 'all';
}

export function TaskModal({
  open,
  onOpenChange,
  task,
  onSave,
  mode,
  allTasks = [],
  patientScope = 'all',
}: TaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [doctorIds, setDoctorIds] = useState<number[]>([]);
  // The selected patient's Kardex-assigned doctors — Add New Task's doctor
  // and department fields are both derived from this list, never from the
  // hospital-wide Doctor/Department rosters (see PatientCareTeam, where
  // doctors are actually assigned to a patient).
  const [patientDoctors, setPatientDoctors] = useState<Doctor[]>([]);
  const [patientDoctorsLoading, setPatientDoctorsLoading] = useState(false);
  const [patientDoctorsError, setPatientDoctorsError] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'routine' as 'urgent' | 'routine',
    patientName: '',
    patientId: '',
    dueTime: '',
    patientRoom: '',
    doctorOrder: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const patientData = await fetchPatients(
          patientScope === 'mine' ? { mine: true } : undefined
        );
        if (!cancelled) setPatients(patientData);
      } catch {
        if (!cancelled) setPatients([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientScope]);

  useEffect(() => {
    if (task && mode === 'edit') {
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority === 'urgent' ? 'urgent' : 'routine',
        patientName: task.patientName,
        patientId: task.patientId || '',
        dueTime: task.dueTime,
        patientRoom: task.patientRoom || '',
        doctorOrder: task.doctorOrder || '',
      });
      setDepartmentId(task.departmentId ? String(task.departmentId) : '');
      setDoctorIds((task.assignedDoctors || []).map((d) => d.id));
    } else {
      setFormData({
        title: '',
        description: '',
        priority: 'routine',
        patientName: '',
        patientId: '',
        dueTime: '',
        patientRoom: '',
        doctorOrder: '',
      });
      setDepartmentId('');
      setDoctorIds([]);
    }
    setErrors({});
  }, [task, mode, open]);

  // The patient is the source of truth for which doctors exist to pick from —
  // reload whenever the selected patient changes (including on open, for edit
  // mode's pre-filled patient).
  useEffect(() => {
    if (!open || !formData.patientId) {
      setPatientDoctors([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPatientDoctorsLoading(true);
      setPatientDoctorsError('');
      try {
        const data = await fetchPatientAssignedDoctors(formData.patientId);
        if (!cancelled) setPatientDoctors(data);
      } catch (e) {
        if (!cancelled) {
          setPatientDoctors([]);
          setPatientDoctorsError(
            e instanceof ApiError
              ? e.message
              : "Unable to load the patient's assigned doctors. Please try again."
          );
        }
      } finally {
        if (!cancelled) setPatientDoctorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, formData.patientId]);

  // Only departments the patient actually has a Kardex-assigned doctor in are
  // offered here — Add New Task must never fall back to the full hospital
  // department list.
  const patientDepartments = Array.from(
    new Map(patientDoctors.map((d) => [String(d.departmentId), d.departmentName])).entries()
  ).map(([id, name]) => ({ id, name }));

  const matchingDoctors = departmentId
    ? patientDoctors.filter((d) => String(d.departmentId) === departmentId)
    : [];

  // Auto-assign the moment there is exactly one match — the nurse should
  // never have to manually pick a doctor who is the only option anyway.
  useEffect(() => {
    if (matchingDoctors.length === 1) {
      setDoctorIds([matchingDoctors[0].id]);
    }
    // matchingDoctors is derived fresh each render from departmentId/patientDoctors,
    // so depending on those two (rather than the array itself) avoids re-running
    // this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, patientDoctors]);

  const handlePatientChange = (patientId: string) => {
    const selectedPatient = patients.find((p) => p.id === patientId);
    setFormData({
      ...formData,
      patientId,
      patientName: selectedPatient?.name || '',
      patientRoom: selectedPatient?.room || formData.patientRoom,
    });
    // A doctor assigned to the previous patient must never carry over.
    setDoctorIds([]);
    setPatientDoctors([]);
  };

  const handleDepartmentChange = (value: string) => {
    // Doctors belong to a specific patient+department pair — changing either
    // half invalidates whatever was selected before.
    setDoctorIds([]);
    setDepartmentId(value);
  };

  const toggleDoctor = (doctorId: number) => {
    setDoctorIds((prev) =>
      prev.includes(doctorId) ? prev.filter((id) => id !== doctorId) : [...prev, doctorId]
    );
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = 'Task title is required';
    if (!formData.patientId.trim() || !formData.patientName.trim()) {
      newErrors.patientName = 'Patient is required';
    }
    if (!formData.dueTime) newErrors.dueTime = 'Due time is required';
    if (!departmentId) newErrors.department = 'No department selected.';
    if (doctorIds.length === 0) {
      newErrors.doctors = patientDoctors.length === 0
        ? 'No doctors are assigned to this patient.'
        : matchingDoctors.length === 0
          ? 'No doctor is currently assigned to this patient in the selected department.'
          : 'Please select at least one doctor.';
    }
    if (!formData.patientRoom.trim()) newErrors.patientRoom = 'Patient room is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const canSubmit =
    !!formData.title.trim() &&
    !!formData.patientId.trim() &&
    !!formData.dueTime &&
    !!formData.patientRoom.trim() &&
    !!departmentId &&
    doctorIds.length > 0;

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave({
        ...formData,
        departmentId,
        doctorIds,
        id: task?.id || `task-${Date.now()}`,
        status: task?.status || 'pending',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving task:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !loading && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{mode === 'add' ? 'Add New Task' : 'Edit Task'}</Text>
          <Text style={styles.description}>
            {mode === 'add'
              ? 'Create a new task and assign it to a patient.'
              : 'Update the task details below.'}
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              <Input
                label="Task Title *"
                placeholder="e.g., Administer medication"
                value={formData.title}
                onChangeText={(title) => setFormData({ ...formData, title })}
                error={errors.title}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={styles.textarea}
                  placeholder="Additional details about the task..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={formData.description}
                  onChangeText={(description) => setFormData({ ...formData, description })}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.row}>
                <Select
                  style={{ flex: 1 }}
                  label="Priority *"
                  value={formData.priority}
                  onValueChange={(value) =>
                    setFormData({ ...formData, priority: value as 'urgent' | 'routine' })
                  }
                  options={[
                    { label: '🔴 Urgent', value: 'urgent' },
                    { label: '🟡 Routine', value: 'routine' },
                  ]}
                  placeholder="Select priority"
                />
                <TimePicker
                  style={{ flex: 1 }}
                  label="Due Time"
                  required
                  value={formData.dueTime}
                  onChange={(dueTime) => setFormData({ ...formData, dueTime })}
                  error={errors.dueTime}
                />
              </View>

              <Select
                label="Patient Name *"
                value={formData.patientId}
                onValueChange={handlePatientChange}
                options={
                  patients.length
                    ? patients.map((p) => {
                        // Same name, different patient is exactly the mixup
                        // Patient ID exists to prevent — spell out age/sex/
                        // room too so picking the right one doesn't depend
                        // on a nurse memorizing or double-checking IDs.
                        const sameName = patients.filter(
                          (other) => other.name.toLowerCase() === p.name.toLowerCase()
                        );
                        const label =
                          sameName.length > 1
                            ? `${p.name} (${p.id}) — ${p.age}y, ${p.gender}, Room ${p.room}`
                            : `${p.name} (${p.id})`;
                        return { label, value: p.id, keywords: `${p.id} ${p.room} ${p.diagnosis}` };
                      })
                    : [{ label: 'No patients found', value: '', disabled: true }]
                }
                placeholder="Select patient"
                searchable
                searchPlaceholder="Search by name, ID, or room..."
                error={errors.patientName}
              />

              <Input
                label="Patient ID"
                placeholder="Select patient to view ID"
                value={formData.patientId}
                editable={false}
                inputWrapperStyle={styles.readOnly}
              />
              <Text style={styles.hint}>Patient ID is automatically filled from selected patient</Text>

              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Building2 size={16} color={Colors.blue600} />
                  <Text style={styles.label}>Department *</Text>
                </View>
                <Select
                  value={departmentId}
                  onValueChange={handleDepartmentChange}
                  options={patientDepartments.map((d) => ({ label: d.name, value: d.id }))}
                  placeholder={
                    !formData.patientId
                      ? 'Select a patient first'
                      : patientDoctorsLoading
                        ? 'Loading...'
                        : patientDepartments.length === 0
                          ? 'No departments assigned to this patient'
                          : 'Choose a department'
                  }
                  searchable
                  searchPlaceholder="Search departments..."
                  emptyMessage="No departments assigned to this patient."
                  error={errors.department}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Doctor *</Text>
                {!formData.patientId ? (
                  <View style={styles.doctorStateBox}>
                    <Text style={styles.doctorStateText}>No patient selected.</Text>
                  </View>
                ) : patientDoctorsLoading ? (
                  <View style={styles.doctorStateBox}>
                    <Text style={styles.doctorStateText}>Loading assigned doctors...</Text>
                  </View>
                ) : patientDoctorsError ? (
                  <View style={[styles.doctorStateBox, styles.doctorStateError]}>
                    <AlertCircle size={16} color={Colors.destructive} />
                    <Text style={[styles.doctorStateText, { color: Colors.destructive }]}>
                      {patientDoctorsError}
                    </Text>
                  </View>
                ) : !departmentId ? (
                  <View style={styles.doctorStateBox}>
                    <Text style={styles.doctorStateText}>
                      Select a department to see this patient&apos;s assigned doctor.
                    </Text>
                  </View>
                ) : patientDoctors.length === 0 ? (
                  <View style={styles.doctorStateBox}>
                    <Text style={styles.doctorStateText}>No doctors are assigned to this patient.</Text>
                  </View>
                ) : matchingDoctors.length === 0 ? (
                  <View style={styles.doctorStateBox}>
                    <Text style={styles.doctorStateText}>
                      No doctor is currently assigned to this patient in the selected department.
                    </Text>
                  </View>
                ) : matchingDoctors.length === 1 ? (
                  <>
                    <View style={styles.doctorAutoBox}>
                      <Text style={styles.doctorAutoName}>{matchingDoctors[0].fullName}</Text>
                      <CheckCircle2 size={18} color={Colors.green600} />
                    </View>
                    <Text style={styles.hint}>
                      Doctor is automatically assigned based on the patient&apos;s Kardex.
                    </Text>
                  </>
                ) : (
                  <View style={styles.doctorMultiBox}>
                    {matchingDoctors.map((doctor) => {
                      const isSelected = doctorIds.includes(doctor.id);
                      return (
                        <Pressable
                          key={doctor.id}
                          onPress={() => toggleDoctor(doctor.id)}
                          style={[styles.doctorMultiRow, isSelected && styles.doctorMultiRowSelected]}
                        >
                          {isSelected ? (
                            <CheckSquare size={18} color={Colors.primary} />
                          ) : (
                            <Square size={18} color={Colors.gray400} />
                          )}
                          <View>
                            <Text style={styles.doctorName}>{doctor.fullName}</Text>
                            <Text style={styles.doctorSpecialization}>{doctor.specialization}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {errors.doctors ? <Text style={styles.error}>{errors.doctors}</Text> : null}
              </View>

              <View style={{ gap: 6 }}>
                <View style={styles.labelRow}>
                  <Bed size={16} color={Colors.gray600} />
                  <Text style={styles.label}>Room *</Text>
                </View>
                <Input
                  placeholder="Room number"
                  value={formData.patientRoom}
                  onChangeText={(patientRoom) => setFormData({ ...formData, patientRoom })}
                  error={errors.patientRoom}
                />
              </View>

              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <ClipboardList size={16} color={Colors.blue600} />
                  <Text style={styles.label}>Doctor&apos;s Order / Notes</Text>
                </View>
                <TextInput
                  style={styles.textarea}
                  placeholder="Enter doctor's orders or clinical notes..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={formData.doctorOrder}
                  onChangeText={(doctorOrder) => setFormData({ ...formData, doctorOrder })}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <Text style={styles.hint}>
                  Medical instructions or clinical notes from the attending physician
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              variant="outline"
              onPress={() => onOpenChange(false)}
              disabled={loading}
              style={{ flex: 1 }}
            >
              Cancel
            </Button>
            <Button
              onPress={handleSubmit}
              disabled={loading || !canSubmit}
              loading={loading}
              style={{ flex: 1 }}
            >
              {mode === 'add' ? 'Add Task' : 'Save Changes'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 525,
    maxHeight: '85%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 16,
    lineHeight: 18,
  },
  scroll: { flexGrow: 0 },
  form: { gap: 14, paddingBottom: 8 },
  field: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  textarea: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.foreground,
    backgroundColor: Colors.inputBackground,
  },
  readOnly: {
    backgroundColor: Colors.gray100,
  },
  hint: {
    fontSize: 11,
    color: Colors.gray500,
    marginTop: -8,
  },
  error: {
    fontSize: 12,
    color: Colors.destructive,
  },
  doctorStateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
  },
  doctorStateError: {
    backgroundColor: Colors.destructiveLight,
    borderColor: Colors.destructive,
  },
  doctorStateText: {
    flex: 1,
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  doctorAutoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.green200,
    borderRadius: Radius.md,
    backgroundColor: Colors.green50,
  },
  doctorAutoName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  doctorMultiBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  doctorMultiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  doctorMultiRowSelected: {
    backgroundColor: Colors.blue50,
  },
  doctorName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  doctorSpecialization: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
