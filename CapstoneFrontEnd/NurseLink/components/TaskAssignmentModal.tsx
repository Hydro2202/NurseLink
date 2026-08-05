import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import { UserPlus } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { createTask, fetchNurses, ApiError } from '../services/api';
import type { Nurse, Patient } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

interface TaskAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onTaskAssigned?: () => void;
}

export function TaskAssignmentModal({
  open,
  onOpenChange,
  patient,
  onTaskAssigned,
}: TaskAssignmentModalProps) {
  const toast = useToast();
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'urgent' | 'routine'>('routine');
  const [dueTime, setDueTime] = useState('');
  const [selectedNurse, setSelectedNurse] = useState('');
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [doctorOrder, setDoctorOrder] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchNurses();
        if (!cancelled) setNurses(data);
      } catch {
        if (!cancelled) setNurses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (patient?.attendingPhysician) {
      setAttendingPhysician(patient.attendingPhysician);
    }
  }, [patient]);

  const resetForm = () => {
    setTaskTitle('');
    setDescription('');
    setPriority('routine');
    setDueTime('');
    setSelectedNurse('');
    setAttendingPhysician(patient?.attendingPhysician || '');
    setDoctorOrder('');
  };

  const handleSubmit = async () => {
    if (!taskTitle || !selectedNurse || !dueTime || !patient) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const nurse = nurses.find((n) => n.id === selectedNurse);
      await createTask({
        title: taskTitle,
        description,
        priority,
        dueTime,
        patientId: patient.id,
        patientName: patient.name,
        patientRoom: patient.room,
        assignedTo: nurse?.name || '',
        attendingPhysician: attendingPhysician || patient.attendingPhysician,
        doctorOrder,
        status: 'pending',
        category: 'care',
      });

      toast.success('Task assigned successfully!', {
        description: `${taskTitle} has been assigned to ${nurse?.name || 'the selected nurse'}`,
      });

      resetForm();
      onTaskAssigned?.();
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to assign task', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const riskColor =
    patient?.riskLevel === 'high'
      ? Colors.red600
      : patient?.riskLevel === 'medium'
        ? Colors.warning
        : Colors.green600;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !isSubmitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <UserPlus size={20} color={Colors.blue600} />
            <Text style={styles.title}>Assign Task to Nurse</Text>
          </View>
          <Text style={styles.description}>
            {patient
              ? `Assigning task for ${patient.name} (${patient.id}) - Room ${patient.room}`
              : 'Assign a task to a nurse'}
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              {patient ? (
                <View style={styles.patientBox}>
                  <View style={styles.patientGrid}>
                    <Text style={styles.patientItem}>
                      <Text style={styles.patientBold}>Patient: </Text>
                      {patient.name}
                    </Text>
                    <Text style={styles.patientItem}>
                      <Text style={styles.patientBold}>Room: </Text>
                      {patient.room}
                    </Text>
                    <Text style={styles.patientItem}>
                      <Text style={styles.patientBold}>Diagnosis: </Text>
                      {patient.diagnosis}
                    </Text>
                    <Text style={styles.patientItem}>
                      <Text style={styles.patientBold}>Risk Level: </Text>
                      <Text style={{ color: riskColor, textTransform: 'capitalize' }}>
                        {patient.riskLevel}
                      </Text>
                    </Text>
                  </View>
                </View>
              ) : null}

              <Input
                label="Task Title *"
                placeholder="e.g., Administer medication, Vital signs check"
                value={taskTitle}
                onChangeText={setTaskTitle}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={styles.textarea}
                  placeholder="Detailed instructions for the task..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.row}>
                <Select
                  style={{ flex: 1 }}
                  label="Priority *"
                  value={priority}
                  onValueChange={(value) => setPriority(value as 'urgent' | 'routine')}
                  options={[
                    { label: 'Urgent', value: 'urgent' },
                    { label: 'Routine', value: 'routine' },
                  ]}
                  placeholder="Select priority"
                />
                <Input
                  containerStyle={{ flex: 1 }}
                  label="Due Time *"
                  placeholder="HH:MM"
                  value={dueTime}
                  onChangeText={setDueTime}
                />
              </View>

              <Select
                label="Assign to Nurse *"
                value={selectedNurse}
                onValueChange={setSelectedNurse}
                options={nurses.map((nurse) => ({
                  label: `${nurse.name} — ${nurse.role} • ${nurse.shift} shift${nurse.specialization ? ` • ${nurse.specialization}` : ''}`,
                  value: nurse.id,
                }))}
                placeholder="Select a nurse"
              />

              <Input
                label="Attending Physician"
                placeholder="e.g., Dr. Smith"
                value={attendingPhysician}
                onChangeText={setAttendingPhysician}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Doctor's Order</Text>
                <TextInput
                  style={[styles.textarea, { minHeight: 64 }]}
                  placeholder="Specific orders from the physician..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={doctorOrder}
                  onChangeText={setDoctorOrder}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              variant="outline"
              onPress={() => onOpenChange(false)}
              disabled={isSubmitting}
              style={{ flex: 1 }}
            >
              Cancel
            </Button>
            <Button
              onPress={handleSubmit}
              disabled={isSubmitting}
              loading={isSubmitting}
              style={{ flex: 1, backgroundColor: Colors.blue600 }}
            >
              {isSubmitting ? 'Assigning...' : 'Assign Task'}
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
    maxWidth: 640,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  description: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 16,
    lineHeight: 18,
  },
  scroll: { flexGrow: 0 },
  form: { gap: 14, paddingBottom: 8 },
  patientBox: {
    padding: 12,
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.md,
  },
  patientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  patientItem: {
    width: '47%',
    fontSize: 13,
    color: Colors.foreground,
  },
  patientBold: {
    fontWeight: '600',
  },
  field: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  row: { flexDirection: 'row', gap: 12 },
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
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
