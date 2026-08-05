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
import { Stethoscope, Bed, ClipboardList } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { fetchPatients } from '../services/api';
import type { Patient, Task } from '../types/domain';

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSave: (task: Partial<Task>) => Promise<void>;
  mode: 'add' | 'edit';
  allTasks?: Task[];
}

export function TaskModal({
  open,
  onOpenChange,
  task,
  onSave,
  mode,
  allTasks = [],
}: TaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'routine' as 'urgent' | 'routine',
    patientName: '',
    patientId: '',
    dueTime: '',
    attendingPhysician: '',
    patientRoom: '',
    doctorOrder: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPatients();
        if (!cancelled) setPatients(data);
      } catch {
        if (!cancelled) setPatients([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (task && mode === 'edit') {
      setFormData({
        title: task.title,
        description: task.description || '',
        priority: task.priority === 'urgent' ? 'urgent' : 'routine',
        patientName: task.patientName,
        patientId: task.patientId || '',
        dueTime: task.dueTime,
        attendingPhysician: task.attendingPhysician || '',
        patientRoom: task.patientRoom || '',
        doctorOrder: task.doctorOrder || '',
      });
    } else {
      setFormData({
        title: '',
        description: '',
        priority: 'routine',
        patientName: '',
        patientId: '',
        dueTime: '',
        attendingPhysician: '',
        patientRoom: '',
        doctorOrder: '',
      });
    }
    setErrors({});
  }, [task, mode, open]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.title.trim()) newErrors.title = 'Task title is required';
    if (!formData.patientId.trim() || !formData.patientName.trim()) {
      newErrors.patientName = 'Patient is required';
    }
    if (!formData.dueTime) newErrors.dueTime = 'Due time is required';
    if (!formData.attendingPhysician.trim()) {
      newErrors.attendingPhysician = 'Attending physician is required';
    }
    if (!formData.patientRoom.trim()) newErrors.patientRoom = 'Patient room is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave({
        ...formData,
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
                <Input
                  containerStyle={{ flex: 1 }}
                  label="Due Time *"
                  placeholder="HH:MM"
                  value={formData.dueTime}
                  onChangeText={(dueTime) => setFormData({ ...formData, dueTime })}
                  error={errors.dueTime}
                />
              </View>

              <Select
                label="Patient Name *"
                value={formData.patientId}
                onValueChange={(patientId) => {
                  const selectedPatient = patients.find((p) => p.id === patientId);
                  setFormData({
                    ...formData,
                    patientId,
                    patientName: selectedPatient?.name || '',
                    attendingPhysician:
                      selectedPatient?.attendingPhysician || formData.attendingPhysician,
                    patientRoom: selectedPatient?.room || formData.patientRoom,
                  });
                }}
                options={
                  patients.length
                    ? patients.map((p) => ({
                        label: `${p.name} (${p.id})`,
                        value: p.id,
                      }))
                    : [{ label: 'No patients found', value: '', disabled: true }]
                }
                placeholder="Select patient"
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

              <View style={styles.row}>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.labelRow}>
                    <Stethoscope size={16} color={Colors.blue600} />
                    <Text style={styles.label}>Doctor *</Text>
                  </View>
                  <Input
                    placeholder="Physician name"
                    value={formData.attendingPhysician}
                    onChangeText={(attendingPhysician) =>
                      setFormData({ ...formData, attendingPhysician })
                    }
                    error={errors.attendingPhysician}
                  />
                </View>

                <View style={{ flex: 1, gap: 6 }}>
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
              </View>

              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <ClipboardList size={16} color={Colors.blue600} />
                  <Text style={styles.label}>Doctor's Order / Notes</Text>
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
            <Button onPress={handleSubmit} disabled={loading} loading={loading} style={{ flex: 1 }}>
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
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
