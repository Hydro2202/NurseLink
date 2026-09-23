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
import type { Patient, Task } from '../types/domain';
import { PatientAssignment } from '../types';
import { fetchPatients } from '../services/api';

export type { PatientAssignment };

interface AssignPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    assignment: Omit<PatientAssignment, 'id' | 'assignedAt' | 'updatedAt' | 'status'>
  ) => void | Promise<void>;
  editingAssignment?: PatientAssignment | null;
  availableNurses: { id: string; name: string; patientCount: number }[];
  allTasks?: Task[];
  allAssignments?: PatientAssignment[];
}

export function AssignPatientModal({
  isOpen,
  onClose,
  onSubmit,
  editingAssignment,
  availableNurses,
}: AssignPatientModalProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [formData, setFormData] = useState({
    patientName: '',
    patientId: '',
    room: '',
    ward: '',
    diagnosis: '',
    assignedNurse: '',
    assignedNurseId: '',
    priority: 'routine' as 'urgent' | 'routine',
    notes: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    fetchPatients()
      .then(setPatients)
      .catch(() => setPatients([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
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
      setFormData({
        patientName: '',
        patientId: '',
        room: '',
        ward: '',
        diagnosis: '',
        assignedNurse: '',
        assignedNurseId: '',
        priority: 'routine',
        notes: '',
      });
    }
  }, [editingAssignment, isOpen]);

  const handlePatientSelect = (patientId: string) => {
    const patient = patients.find((p) => p.id === patientId);
    if (!patient) return;
    setFormData((prev) => ({
      ...prev,
      patientId: patient.id,
      patientName: patient.name,
      room: patient.room || '',
      diagnosis: patient.diagnosis || '',
      ward: prev.ward,
    }));
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

  const canSubmit =
    !!formData.patientId && !!formData.room && !!formData.assignedNurseId;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit(formData);
    onClose();
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {editingAssignment ? 'Edit Assignment' : 'Assign Patient'}
            </Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.sectionHeader}>
              <FileText size={16} color={Colors.blue600} />
              <Text style={styles.sectionTitle}>Patient</Text>
            </View>
            {patients.length === 0 ? (
              <Text style={styles.hint}>No patients found. Create a patient via Kardex first.</Text>
            ) : (
              <Select
                label="Select Patient *"
                value={formData.patientId}
                onValueChange={handlePatientSelect}
                options={patients.map((p) => ({
                  label: `${p.name} • ${p.room} (${p.id})`,
                  value: p.id,
                  keywords: `${p.id} ${p.room} ${p.diagnosis}`,
                }))}
                placeholder="Choose a patient"
                searchable
                searchPlaceholder="Search by name, ID, or room..."
              />
            )}
            <Input label="Room *" value={formData.room} onChangeText={(room) => setFormData((p) => ({ ...p, room }))} />
            <Input label="Ward / Department" value={formData.ward} onChangeText={(ward) => setFormData((p) => ({ ...p, ward }))} />
            <Input
              label="Diagnosis"
              value={formData.diagnosis}
              onChangeText={(diagnosis) => setFormData((p) => ({ ...p, diagnosis }))}
            />

            <View style={styles.sectionHeader}>
              <User size={16} color={Colors.blue600} />
              <Text style={styles.sectionTitle}>Assignment Details</Text>
            </View>
            {availableNurses.length === 0 ? (
              <Text style={styles.hint}>No nurses available.</Text>
            ) : (
              <Select
                label="Assign to Nurse *"
                value={formData.assignedNurseId}
                onValueChange={handleNurseSelect}
                options={availableNurses.map((nurse) => ({
                  label: `${nurse.name} (${nurse.patientCount} patients)`,
                  value: nurse.id,
                }))}
                placeholder="Select a nurse"
                searchable
                searchPlaceholder="Search by name..."
              />
            )}
            <Select
              label="Priority *"
              value={formData.priority}
              onValueChange={(value) =>
                setFormData((p) => ({ ...p, priority: value as 'urgent' | 'routine' }))
              }
              options={[
                { label: 'Routine', value: 'routine' },
                { label: 'Urgent', value: 'urgent' },
              ]}
            />
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={styles.textarea}
              value={formData.notes}
              onChangeText={(notes) => setFormData((p) => ({ ...p, notes }))}
              multiline
            />
          </ScrollView>
          <View style={styles.footer}>
            <Button variant="outline" onPress={onClose} style={{ flex: 1 }}>
              <Text>Cancel</Text>
            </Button>
            <Button onPress={handleSubmit} disabled={!canSubmit} style={{ flex: 1 }}>
              <Text style={{ color: Colors.white, fontWeight: '600' }}>
                {editingAssignment ? 'Update' : 'Assign'}
              </Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    ...Shadows.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  close: { color: Colors.blue600, fontWeight: '600' },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.blue700 },
  hint: { fontSize: 12, color: Colors.mutedForeground },
  label: { fontSize: 13, fontWeight: '600', color: Colors.gray700 },
  textarea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    minHeight: 72,
    padding: 10,
    textAlignVertical: 'top',
    color: Colors.foreground,
  },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: Colors.border },
});
