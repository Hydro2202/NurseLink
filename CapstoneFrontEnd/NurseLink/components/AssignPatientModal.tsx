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
import { User, FileText } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { Task } from '../data/mockData';
import { PatientAssignment } from '../types';

const rooms = [
  'ICU-201',
  'ICU-202',
  'ICU-203',
  'ICU-204',
  'ICU-205',
  'Ward 4A-101',
  'Ward 4A-102',
  'Ward 4A-103',
  'Ward 4A-104',
  'Ward 4B-201',
  'Ward 4B-202',
  'Ward 4B-203',
  'Ward 5A-101',
  'Ward 5A-102',
  'Ward 5A-103',
  'ER-1',
  'ER-2',
  'ER-3',
];

export type { PatientAssignment };

interface AssignPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    assignment: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>
  ) => void;
  editingAssignment?: PatientAssignment | null;
  availableNurses: Array<{ id: string; name: string; patientCount: number }>;
  allTasks?: Task[];
  allAssignments?: PatientAssignment[];
}

export function AssignPatientModal({
  isOpen,
  onClose,
  onSubmit,
  editingAssignment,
  availableNurses,
  allTasks = [],
  allAssignments = [],
}: AssignPatientModalProps) {
  const [formData, setFormData] = useState({
    patientName: '',
    patientId: '',
    room: '',
    ward: 'ICU',
    diagnosis: '',
    assignedNurse: '',
    assignedNurseId: '',
    priority: 'routine' as 'urgent' | 'routine',
    notes: '',
  });

  const getOccupiedRooms = () => {
    const occupiedRooms = new Map<string, { patientName: string; taskId: string }>();
    allTasks.forEach((task) => {
      if (task.patientRoom && task.status !== 'completed') {
        if (editingAssignment && editingAssignment.room === task.patientRoom) return;
        occupiedRooms.set(task.patientRoom, {
          patientName: task.patientName,
          taskId: task.id,
        });
      }
    });
    return occupiedRooms;
  };

  const occupiedRooms = getOccupiedRooms();

  useEffect(() => {
    if (editingAssignment) {
      setFormData({
        patientName: editingAssignment.patientName,
        patientId: editingAssignment.patientId,
        room: editingAssignment.room,
        ward: editingAssignment.ward,
        diagnosis: editingAssignment.diagnosis,
        assignedNurse: editingAssignment.assignedNurse,
        assignedNurseId: editingAssignment.assignedNurseId,
        priority: editingAssignment.priority,
        notes: editingAssignment.notes,
      });
    } else {
      let nextPatientNumber = 4;
      allAssignments.forEach((assignment) => {
        const match = assignment.patientId.match(/^P(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= nextPatientNumber) nextPatientNumber = num + 1;
        }
      });
      const generatedPatientId = `P${String(nextPatientNumber).padStart(3, '0')}`;
      setFormData({
        patientName: '',
        patientId: generatedPatientId,
        room: '',
        ward: 'ICU',
        diagnosis: '',
        assignedNurse: '',
        assignedNurseId: '',
        priority: 'routine',
        notes: '',
      });
    }
  }, [editingAssignment, isOpen, allAssignments]);

  const handleSubmit = () => {
    if (!formData.patientName || !formData.room || !formData.assignedNurseId) return;
    onSubmit(formData);
    onClose();
  };

  const handleNurseSelect = (nurseId: string) => {
    const nurse = availableNurses.find((n) => n.id === nurseId);
    if (nurse) {
      setFormData((prev) => ({
        ...prev,
        assignedNurseId: nurse.id,
        assignedNurse: nurse.name,
      }));
    }
  };

  const canSubmit = !!(formData.patientName && formData.room && formData.assignedNurseId);

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <User size={20} color={Colors.blue600} />
            <Text style={styles.title}>
              {editingAssignment ? 'Edit Patient Assignment' : 'Assign Patient to Nurse'}
            </Text>
          </View>
          <Text style={styles.description}>
            {editingAssignment
              ? 'Update patient assignment details'
              : 'Assign a patient to a nurse for care'}
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              {/* Patient Information */}
              <View style={styles.sectionHeader}>
                <FileText size={16} color={Colors.blue600} />
                <Text style={styles.sectionTitle}>Patient Information</Text>
              </View>

              <View style={styles.row}>
                <Input
                  containerStyle={{ flex: 1 }}
                  label="Patient Name *"
                  value={formData.patientName}
                  onChangeText={(patientName) => setFormData((prev) => ({ ...prev, patientName }))}
                  placeholder="Enter patient full name"
                />
                <View style={{ flex: 1, gap: 6 }}>
                  <Input
                    label="Patient ID (Auto-generated)"
                    value={formData.patientId}
                    editable={false}
                    placeholder="Auto-generated"
                    inputWrapperStyle={styles.readOnly}
                  />
                  <Text style={styles.hint}>Patient ID is automatically assigned</Text>
                </View>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Select
                    label="Room Number *"
                    value={formData.room}
                    onValueChange={(room) => setFormData((prev) => ({ ...prev, room }))}
                    options={rooms.map((room) => {
                      const occupation = occupiedRooms.get(room);
                      const isOccupied = !!occupation;
                      return {
                        label: isOccupied
                          ? `${room} (Occupied - Patient: ${occupation.patientName})`
                          : room,
                        value: room,
                        disabled: isOccupied,
                      };
                    })}
                    placeholder="Select room"
                  />
                  <Text style={styles.hint}>Select an available room for the patient</Text>
                </View>
                <Select
                  style={{ flex: 1 }}
                  label="Ward / Department *"
                  value={formData.ward}
                  onValueChange={(ward) => setFormData((prev) => ({ ...prev, ward }))}
                  options={[
                    { label: 'ICU (Intensive Care Unit)', value: 'ICU' },
                    { label: 'General Ward', value: 'General Ward' },
                    { label: 'Emergency Department', value: 'Emergency' },
                    { label: 'Surgery Department', value: 'Surgery' },
                    { label: 'Pediatrics', value: 'Pediatrics' },
                    { label: 'Maternity Ward', value: 'Maternity' },
                  ]}
                  placeholder="Select ward"
                />
              </View>

              <Input
                label="Diagnosis (Optional)"
                value={formData.diagnosis}
                onChangeText={(diagnosis) => setFormData((prev) => ({ ...prev, diagnosis }))}
                placeholder="e.g., Myocardial Infarction, Post-operative care"
              />

              {/* Assignment Details */}
              <View style={styles.sectionHeader}>
                <User size={16} color={Colors.blue600} />
                <Text style={styles.sectionTitle}>Assignment Details</Text>
              </View>

              <View style={{ gap: 6 }}>
                <Select
                  label="Assign to Nurse *"
                  value={formData.assignedNurseId}
                  onValueChange={handleNurseSelect}
                  options={availableNurses.map((nurse) => ({
                    label: `${nurse.name} (${nurse.patientCount} patients)`,
                    value: nurse.id,
                  }))}
                  placeholder="Select a nurse"
                />
                <Text style={styles.hint}>Select a nurse from the available staff</Text>
              </View>

              <Select
                label="Priority Level *"
                value={formData.priority}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    priority: value as 'urgent' | 'routine',
                  }))
                }
                options={[
                  {
                    label: 'Urgent - Requires immediate attention',
                    value: 'urgent',
                  },
                  {
                    label: 'Routine - Standard care',
                    value: 'routine',
                  },
                ]}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Notes / Special Instructions (Optional)</Text>
                <TextInput
                  style={styles.textarea}
                  value={formData.notes}
                  onChangeText={(notes) => setFormData((prev) => ({ ...prev, notes }))}
                  placeholder="Enter any special care instructions, allergies, or important notes..."
                  placeholderTextColor={Colors.mutedForeground}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Text style={styles.hint}>Include any relevant information for the assigned nurse</Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="outline" onPress={onClose} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={{ flex: 1, backgroundColor: Colors.blue600 }}
            >
              {editingAssignment ? 'Update Assignment' : 'Assign Patient'}
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
    flex: 1,
  },
  description: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 16,
    lineHeight: 18,
  },
  scroll: { flexGrow: 0 },
  form: { gap: 14, paddingBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.gray900,
  },
  row: { flexDirection: 'row', gap: 12 },
  field: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.foreground,
  },
  textarea: {
    minHeight: 100,
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
