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
import { UserPlus, ArrowLeft, CheckCircle2 } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { DatePicker, todayIso } from './DatePicker';
import { createTask, createAssignment, fetchNurses, ApiError } from '../services/api';
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
  const [dueDate, setDueDate] = useState(todayIso());
  const [dueTime, setDueTime] = useState('');
  const [selectedNurse, setSelectedNurse] = useState('');
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [doctorOrder, setDoctorOrder] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Assign Nurse is a two-step flow — fill in the details, then review
  // exactly which nurse is being put on which patient/task before it's
  // final. Skipping straight to submit is how a wrong-nurse mistake happens.
  const [reviewMode, setReviewMode] = useState(false);

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
    (() => {
      if (patient?.attendingPhysician) {
        setAttendingPhysician(patient.attendingPhysician);
      }
    })();
  }, [patient]);

  // Always land back on the form, never mid-review, on a fresh open —
  // otherwise closing and reopening this modal could strand a head nurse on
  // a review screen for a form they never actually filled in this time.
  useEffect(() => {
    (() => {
      if (open) setReviewMode(false);
    })();
  }, [open]);

  const resetForm = () => {
    setTaskTitle('');
    setDescription('');
    setPriority('routine');
    setDueDate(todayIso());
    setDueTime('');
    setSelectedNurse('');
    setAttendingPhysician(patient?.attendingPhysician || '');
    setDoctorOrder('');
    setReviewMode(false);
  };

  const selectedNurseRecord = nurses.find((n) => n.id === selectedNurse);

  const handleReview = () => {
    if (!taskTitle || !selectedNurse || !dueDate || !dueTime || !patient) {
      toast.error('Please fill in all required fields');
      return;
    }
    setReviewMode(true);
  };

  const handleConfirmAssign = async () => {
    if (!patient) return;

    setIsSubmitting(true);
    try {
      await createTask({
        title: taskTitle,
        description,
        priority,
        dueDate,
        dueTime,
        patientId: patient.id,
        patientName: patient.name,
        patientRoom: patient.room,
        assignedTo: selectedNurseRecord?.name || '',
        attendingPhysician: attendingPhysician || patient.attendingPhysician,
        doctorOrder,
        status: 'pending',
        category: 'care',
      });

      // "Assign Nurse" is understood as putting this patient on that nurse's
      // caseload, not just handing them one task — so this also creates/updates
      // the real PatientAssignment (which the backend uses to close out any
      // previous nurse's active assignment and sync Patient.assigned_nurse).
      // Without this, the patient never showed up on the new nurse's own
      // My Patients screen even though the head nurse could see the task.
      if (selectedNurseRecord) {
        await createAssignment({
          patientId: patient.id,
          nurseId: selectedNurseRecord.id,
          nurseName: selectedNurseRecord.name,
          priority,
        });
      }

      toast.success('Nurse assigned successfully!', {
        description: `${selectedNurseRecord?.name || 'The selected nurse'} has been assigned to ${taskTitle}.`,
      });

      resetForm();
      onTaskAssigned?.();
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to assign nurse', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const riskColor =
    patient?.riskLevel === 'critical'
      ? Colors.red600
      : patient?.riskLevel === 'high'
        ? Colors.orange600
        : patient?.riskLevel === 'medium'
          ? Colors.warning
          : Colors.green600;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !isSubmitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            {reviewMode ? <CheckCircle2 size={20} color={Colors.blue600} /> : <UserPlus size={20} color={Colors.blue600} />}
            <Text style={styles.title}>{reviewMode ? 'Review Assignment' : 'Assign Nurse'}</Text>
          </View>
          <Text style={styles.description}>
            {reviewMode
              ? 'Confirm this is the right nurse for the right patient before assigning.'
              : patient
                ? `Assigning a nurse for ${patient.name} (${patient.id}) - Room ${patient.room}`
                : 'Assign a nurse to a patient task'}
          </Text>

          {reviewMode ? (
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={styles.form}>
                <View style={styles.reviewBox}>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Patient</Text>
                    <Text style={styles.reviewValue}>
                      {patient?.name} ({patient?.id})
                    </Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Room</Text>
                    <Text style={styles.reviewValue}>{patient?.room}</Text>
                  </View>
                  <View style={styles.reviewDivider} />
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Task</Text>
                    <Text style={styles.reviewValue}>{taskTitle}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Priority</Text>
                    <Text style={[styles.reviewValue, { textTransform: 'capitalize' }]}>{priority}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Due Date</Text>
                    <Text style={styles.reviewValue}>{dueDate}</Text>
                  </View>
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Due Time</Text>
                    <Text style={styles.reviewValue}>{dueTime}</Text>
                  </View>
                  <View style={styles.reviewDivider} />
                  <View style={styles.reviewRowHighlight}>
                    <Text style={styles.reviewLabel}>Assigned Nurse</Text>
                    <Text style={styles.reviewValueBold}>
                      {selectedNurseRecord?.name || 'Not selected'}
                    </Text>
                  </View>
                  {selectedNurseRecord ? (
                    <Text style={styles.reviewSubtext}>
                      {selectedNurseRecord.role}
                      {selectedNurseRecord.department ? ` • ${selectedNurseRecord.department}` : ''}
                      {selectedNurseRecord.shift ? ` • ${selectedNurseRecord.shift} shift` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            </ScrollView>
          ) : (
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

              <Select
                label="Priority *"
                value={priority}
                onValueChange={(value) => setPriority(value as 'urgent' | 'routine')}
                options={[
                  { label: 'Urgent', value: 'urgent' },
                  { label: 'Routine', value: 'routine' },
                ]}
                placeholder="Select priority"
              />

              <View style={styles.row}>
                <DatePicker
                  style={{ flex: 1 }}
                  label="Due Date"
                  required
                  value={dueDate}
                  onChange={setDueDate}
                />
                <TimePicker
                  style={{ flex: 1 }}
                  label="Due Time"
                  required
                  value={dueTime}
                  onChange={setDueTime}
                />
              </View>

              <Select
                label="Assign to Nurse *"
                value={selectedNurse}
                onValueChange={setSelectedNurse}
                options={nurses.map((nurse) => ({
                  // Shift only when the nurse actually has a duty on the roster.
                  label: `${nurse.name} — ${nurse.role}${nurse.shift ? ` • ${nurse.shift} shift` : ''}${nurse.specialization ? ` • ${nurse.specialization}` : ''}`,
                  value: nurse.id,
                  keywords: nurse.department || '',
                }))}
                placeholder="Select a nurse"
                searchable
                searchPlaceholder="Search by name or department..."
              />

              <Input
                label="Attending Physician"
                placeholder="e.g., Dr. Smith"
                value={attendingPhysician}
                onChangeText={setAttendingPhysician}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Doctor&apos;s Order</Text>
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
          )}

          <View style={styles.footer}>
            <Button
              variant="outline"
              onPress={() => (reviewMode ? setReviewMode(false) : onOpenChange(false))}
              disabled={isSubmitting}
              style={{ flex: 1 }}
            >
              {reviewMode ? (
                <View style={styles.btnInner}>
                  <ArrowLeft size={16} color={Colors.foreground} />
                  <Text>Back to Edit</Text>
                </View>
              ) : (
                'Cancel'
              )}
            </Button>
            <Button
              onPress={reviewMode ? handleConfirmAssign : handleReview}
              disabled={isSubmitting}
              loading={isSubmitting}
              style={{ flex: 1, backgroundColor: Colors.blue600 }}
            >
              {isSubmitting
                ? 'Assigning...'
                : reviewMode
                  ? 'Confirm Assignment'
                  : 'Review Assignment'}
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
    fontSize: 16,
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
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
  reviewBox: {
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.md,
    padding: 14,
    gap: 10,
  },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewRowHighlight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewLabel: { fontSize: 13, color: Colors.mutedForeground },
  reviewValue: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  reviewValueBold: { fontSize: 15, fontWeight: '700', color: Colors.blue700 },
  reviewSubtext: { fontSize: 12, color: Colors.mutedForeground, marginTop: -4 },
  reviewDivider: { height: 1, backgroundColor: Colors.blue200 },
});
