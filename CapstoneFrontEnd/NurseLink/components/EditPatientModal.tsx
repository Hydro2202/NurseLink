import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Edit2 } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { DatePicker, todayIso } from './DatePicker';
import { Alert, AlertDescription } from './Alert';
import { updatePatient, fetchDepartments, ApiError } from '../services/api';
import type { Department, Patient } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

interface EditPatientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onSaved: (patient: Patient) => void;
}

type FormState = {
  name: string;
  age: string;
  gender: string;
  room: string;
  diagnosis: string;
  riskLevel: string;
  attendingPhysician: string;
  departmentId: string;
  admissionDate: string;
  heartRate: string;
  bloodPressure: string;
  temperature: string;
  oxygenSaturation: string;
};

function formFromPatient(patient: Patient): FormState {
  return {
    name: patient.name || '',
    age: String(patient.age ?? ''),
    gender: patient.gender || '',
    room: patient.room || '',
    diagnosis: patient.diagnosis || '',
    riskLevel: patient.riskLevel || 'low',
    attendingPhysician: patient.attendingPhysician || '',
    departmentId: patient.departmentId != null ? String(patient.departmentId) : '',
    admissionDate: patient.admissionDate || '',
    heartRate: patient.vitalSigns?.heartRate != null ? String(patient.vitalSigns.heartRate) : '',
    bloodPressure: patient.vitalSigns?.bloodPressure || '',
    temperature: patient.vitalSigns?.temperature != null ? String(patient.vitalSigns.temperature) : '',
    oxygenSaturation:
      patient.vitalSigns?.oxygenSaturation != null ? String(patient.vitalSigns.oxygenSaturation) : '',
  };
}

export function EditPatientModal({ open, onOpenChange, patient, onSaved }: EditPatientModalProps) {
  const toast = useToast();
  const isDischarged = patient?.status === 'discharged';
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !patient) {
      setForm(null);
      setError('');
      return;
    }
    setForm(formFromPatient(patient));
    fetchDepartments()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [open, patient]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSubmit = async () => {
    if (!patient || !form) return;
    if (!form.name.trim() || !form.age || !form.room.trim() || !form.diagnosis.trim()) {
      setError('Name, age, room, and diagnosis are required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const updated = await updatePatient(patient.id, {
        name: form.name.trim(),
        age: Number(form.age) || 0,
        gender: form.gender as Patient['gender'],
        room: form.room.trim(),
        diagnosis: form.diagnosis.trim(),
        riskLevel: form.riskLevel as Patient['riskLevel'],
        attendingPhysician: form.attendingPhysician.trim(),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        admissionDate: form.admissionDate,
        vitalSigns: {
          heartRate: form.heartRate ? Number(form.heartRate) : 0,
          bloodPressure: form.bloodPressure.trim(),
          temperature: form.temperature ? Number(form.temperature) : 0,
          oxygenSaturation: form.oxygenSaturation ? Number(form.oxygenSaturation) : 0,
        },
      } as Partial<Patient>);
      toast.success('Patient record updated', {
        description: `Changes to ${patient.name} were saved${
          updated.lastEditedByName ? ` and logged under ${updated.lastEditedByName}` : ''
        }.`,
      });
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => !submitting && onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Edit2 size={18} color={Colors.blue600} />
            <Text style={styles.title}>Edit Patient Record</Text>
          </View>
          <Text style={styles.description}>
            {isDischarged
              ? 'This patient is discharged — corrections here fix the stored record (and their closed visit history) without readmitting them.'
              : 'Only the fields you change are logged to the record’s edit history.'}
          </Text>

          {form && patient ? (
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.form}>
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <View style={styles.row}>
                  <Input
                    label="Patient Name *"
                    value={form.name}
                    onChangeText={(v) => setField('name', v)}
                    containerStyle={styles.fieldWide}
                  />
                </View>
                <View style={styles.row}>
                  <Input
                    label="Age *"
                    value={form.age}
                    onChangeText={(v) => setField('age', v)}
                    keyboardType="numeric"
                    containerStyle={styles.field}
                  />
                  <Select
                    label="Sex *"
                    value={form.gender}
                    onValueChange={(v) => setField('gender', v)}
                    options={[
                      { label: 'Male', value: 'Male' },
                      { label: 'Female', value: 'Female' },
                    ]}
                    style={styles.field}
                  />
                </View>

                <View style={styles.row}>
                  <Input
                    label={isDischarged ? 'Last Room *' : 'Room *'}
                    value={form.room}
                    onChangeText={(v) => setField('room', v)}
                    containerStyle={styles.field}
                  />
                  <Select
                    label="Risk Level"
                    value={form.riskLevel}
                    onValueChange={(v) => setField('riskLevel', v)}
                    options={[
                      { label: 'Low', value: 'low' },
                      { label: 'Medium', value: 'medium' },
                      { label: 'High', value: 'high' },
                      { label: 'Critical', value: 'critical' },
                    ]}
                    style={styles.field}
                  />
                </View>

                <Input
                  label={isDischarged ? 'Last Diagnosis *' : 'Diagnosis *'}
                  value={form.diagnosis}
                  onChangeText={(v) => setField('diagnosis', v)}
                />
                <Input
                  label="Attending Physician"
                  value={form.attendingPhysician}
                  onChangeText={(v) => setField('attendingPhysician', v)}
                  placeholder="Optional"
                />
                <Select
                  label="Department"
                  value={form.departmentId}
                  onValueChange={(v) => setField('departmentId', v)}
                  placeholder="Optional"
                  searchable
                  options={departments.map((d) => ({ label: d.name, value: String(d.id) }))}
                />

                <View style={styles.row}>
                  <DatePicker
                    label="Admission Date"
                    value={form.admissionDate}
                    onChange={(v) => setField('admissionDate', v)}
                    maxDate={todayIso()}
                    style={styles.field}
                  />
                  {isDischarged ? (
                    <Input
                      label="Discharge Date"
                      value={patient.dischargedAt ? new Date(patient.dischargedAt).toLocaleString() : '—'}
                      onChangeText={() => {}}
                      editable={false}
                      containerStyle={styles.field}
                    />
                  ) : null}
                </View>

                <View style={styles.readOnlyBox}>
                  <Text style={styles.readOnlyLabel}>Assigned Nurse</Text>
                  <Text style={styles.readOnlyValue}>
                    {patient.assignedNurseName || 'Unassigned'}
                    {isDischarged ? ' (last on record)' : ''}
                  </Text>
                  <Text style={styles.readOnlyHint}>
                    Use Assign Nurse{isDischarged ? '/Readmit' : ''} to change this.
                  </Text>
                </View>

                <Text style={styles.sectionLabel}>
                  {isDischarged ? 'Last Recorded Vitals' : 'Current Vitals'}
                </Text>
                <View style={styles.row}>
                  <Input
                    label="Heart Rate (bpm)"
                    value={form.heartRate}
                    onChangeText={(v) => setField('heartRate', v)}
                    keyboardType="numeric"
                    containerStyle={styles.field}
                  />
                  <Input
                    label="Blood Pressure"
                    value={form.bloodPressure}
                    onChangeText={(v) => setField('bloodPressure', v)}
                    placeholder="e.g. 120/80"
                    containerStyle={styles.field}
                  />
                </View>
                <View style={styles.row}>
                  <Input
                    label="Temperature (°C)"
                    value={form.temperature}
                    onChangeText={(v) => setField('temperature', v)}
                    keyboardType="numeric"
                    containerStyle={styles.field}
                  />
                  <Input
                    label="SpO2 (%)"
                    value={form.oxygenSaturation}
                    onChangeText={(v) => setField('oxygenSaturation', v)}
                    keyboardType="numeric"
                    containerStyle={styles.field}
                  />
                </View>
              </View>
            </ScrollView>
          ) : null}

          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSubmit} disabled={submitting} loading={submitting} style={{ flex: 1 }}>
              {submitting ? 'Saving...' : 'Save Changes'}
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
    maxWidth: 560,
    maxHeight: '90%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  description: { fontSize: 13, color: Colors.mutedForeground, marginBottom: 14, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  form: { gap: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', gap: 12 },
  field: { flex: 1 },
  fieldWide: { flex: 1 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  readOnlyBox: {
    backgroundColor: Colors.gray50,
    borderRadius: Radius.md,
    padding: 10,
    gap: 2,
  },
  readOnlyLabel: { fontSize: 11, fontWeight: '700', color: Colors.mutedForeground },
  readOnlyValue: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  readOnlyHint: { fontSize: 11, color: Colors.gray400, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
