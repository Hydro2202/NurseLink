import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { Alert, AlertDescription } from './Alert';
import { readmitPatient, fetchDepartments, ApiError } from '../services/api';
import type { Department, Patient } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

interface ReadmitPatientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onReadmitted: (patient: Patient) => void;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ReadmitPatientModal({ open, onOpenChange, patient, onReadmitted }: ReadmitPatientModalProps) {
  const toast = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [admissionDate, setAdmissionDate] = useState(todayIso());
  const [diagnosis, setDiagnosis] = useState('');
  const [room, setRoom] = useState('');
  const [attendingPhysician, setAttendingPhysician] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [riskLevel, setRiskLevel] = useState('low');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setAdmissionDate(todayIso());
      setDiagnosis('');
      setRoom('');
      setAttendingPhysician('');
      setDepartmentId('');
      setRiskLevel('low');
      setError('');
      return;
    }
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [open]);

  const handleSubmit = async () => {
    if (!patient) return;
    if (!diagnosis.trim() || !room.trim()) {
      setError('Diagnosis and room are required to readmit this patient.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const updated = await readmitPatient(patient.id, {
        admissionDate,
        diagnosis: diagnosis.trim(),
        room: room.trim(),
        attendingPhysician: attendingPhysician.trim(),
        departmentId: departmentId ? Number(departmentId) : null,
        riskLevel: riskLevel as Patient['riskLevel'],
      });
      toast.success('Patient readmitted', {
        description: `${patient.name} is admitted again under their existing profile (${patient.id}).`,
      });
      onReadmitted(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to readmit this patient.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => !submitting && onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <RotateCcw size={19} color={Colors.blue600} />
            <Text style={styles.title}>Readmit Patient</Text>
          </View>
          <Text style={styles.description}>
            {patient
              ? `${patient.name} (${patient.id}) was previously discharged. This reactivates their existing profile for a new admission — their prior visit history stays on record.`
              : ''}
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Input
                label="Admission Date *"
                value={admissionDate}
                onChangeText={setAdmissionDate}
                placeholder="YYYY-MM-DD"
              />
              <Input
                label="Diagnosis *"
                value={diagnosis}
                onChangeText={setDiagnosis}
                placeholder="e.g. Recurrent pneumonia"
              />
              <Input label="Room *" value={room} onChangeText={setRoom} placeholder="e.g. W-10" />
              <Input
                label="Attending Physician"
                value={attendingPhysician}
                onChangeText={setAttendingPhysician}
                placeholder="Optional"
              />
              <Select
                label="Risk Level"
                value={riskLevel}
                onValueChange={setRiskLevel}
                options={[
                  { label: 'Low', value: 'low' },
                  { label: 'Medium', value: 'medium' },
                  { label: 'High', value: 'high' },
                  { label: 'Critical', value: 'critical' },
                ]}
              />
              <Select
                label="Department"
                value={departmentId}
                onValueChange={setDepartmentId}
                placeholder="Optional"
                searchable
                options={departments.map((d) => ({ label: d.name, value: String(d.id) }))}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSubmit} disabled={submitting} loading={submitting} style={{ flex: 1 }}>
              {submitting ? 'Readmitting...' : 'Readmit Patient'}
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
    maxWidth: 480,
    maxHeight: '90%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  description: { fontSize: 13, color: Colors.mutedForeground, marginBottom: 14, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  form: { gap: 12, paddingBottom: 4 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
