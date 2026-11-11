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
import type { Department, Patient, VitalsMonitoringOrder } from '../types/domain';
import { useToast } from '../contexts/ToastContext';
import { computeBmi, bmiCategory, validateHeightCm, validateWeightKg } from '../utils/bmi';
import { VITALS_MONITORING_ORDER_OPTIONS } from './tasks/taskLabels';

/** "120/80" -> ['120', '80'] (missing half is '') — same split-and-combine
 * convention VitalSignsGrid's BloodPressureBlock uses, so the stored
 * "120/80" string (Patient.vitalSigns.bloodPressure) never changes shape. */
function splitBloodPressure(value: string): [string, string] {
  const [systolic = '', diastolic = ''] = (value || '').split('/');
  return [systolic.replace(/[^0-9]/g, ''), diastolic.replace(/[^0-9]/g, '')];
}

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
  vitalsMonitoringOrder: VitalsMonitoringOrder;
  vitalsMonitoringBasis: string;
  attendingPhysician: string;
  allergies: string;
  departmentId: string;
  admissionDate: string;
  heartRate: string;
  bloodPressure: string;
  temperature: string;
  oxygenSaturation: string;
  heightCm: string;
  weightKg: string;
};

function formFromPatient(patient: Patient): FormState {
  return {
    name: patient.name || '',
    age: String(patient.age ?? ''),
    gender: patient.gender || '',
    room: patient.room || '',
    diagnosis: patient.diagnosis || '',
    riskLevel: patient.riskLevel || 'low',
    vitalsMonitoringOrder: patient.vitalsMonitoringOrder || 'not_specified',
    vitalsMonitoringBasis: patient.vitalsMonitoringBasis || '',
    attendingPhysician: patient.attendingPhysician || '',
    allergies: (patient.allergies || []).join(', '),
    departmentId: patient.departmentId != null ? String(patient.departmentId) : '',
    admissionDate: patient.admissionDate || '',
    heartRate: patient.vitalSigns?.heartRate != null ? String(patient.vitalSigns.heartRate) : '',
    bloodPressure: patient.vitalSigns?.bloodPressure || '',
    temperature: patient.vitalSigns?.temperature != null ? String(patient.vitalSigns.temperature) : '',
    oxygenSaturation:
      patient.vitalSigns?.oxygenSaturation != null ? String(patient.vitalSigns.oxygenSaturation) : '',
    heightCm: patient.heightCm != null ? String(patient.heightCm) : '',
    weightKg: patient.weightKg != null ? String(patient.weightKg) : '',
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
    (() => {
      if (!open || !patient) {
        setForm(null);
        setError('');
        return;
      }
      setForm(formFromPatient(patient));
      fetchDepartments()
        .then(setDepartments)
        .catch(() => setDepartments([]));
    })();
  }, [open, patient]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const heightError = form ? validateHeightCm(form.heightCm) : null;
  const weightError = form ? validateWeightKg(form.weightKg) : null;
  const liveBmi = form ? computeBmi(form.heightCm, form.weightKg) : null;

  const handleSubmit = async () => {
    if (!patient || !form) return;
    if (!form.name.trim() || !form.age || !form.room.trim() || !form.diagnosis.trim()) {
      setError('Name, age, room, and diagnosis are required.');
      return;
    }
    if (heightError || weightError) {
      setError(heightError || weightError || '');
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
        vitalsMonitoringOrder: form.vitalsMonitoringOrder,
        vitalsMonitoringBasis: form.vitalsMonitoringBasis.trim(),
        attendingPhysician: form.attendingPhysician.trim(),
        allergies: form.allergies.split(',').map((a) => a.trim()).filter(Boolean),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        admissionDate: form.admissionDate,
        heightCm: form.heightCm ? Number(form.heightCm) : null,
        weightKg: form.weightKg ? Number(form.weightKg) : null,
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

                <View style={styles.row}>
                  <Select
                    label="Vital Signs Monitoring (as ordered)"
                    value={form.vitalsMonitoringOrder}
                    onValueChange={(v) => setField('vitalsMonitoringOrder', v as VitalsMonitoringOrder)}
                    options={VITALS_MONITORING_ORDER_OPTIONS}
                    style={styles.field}
                  />
                  <Input
                    label="Order / protocol reference"
                    value={form.vitalsMonitoringBasis}
                    onChangeText={(v) => setField('vitalsMonitoringBasis', v)}
                    placeholder="e.g., Dr. Reyes order"
                    containerStyle={styles.field}
                  />
                </View>
                <Text style={styles.fieldHint}>
                  A newly set schedule&apos;s first check is at the next full hour — change the
                  exact timing any time from the patient&apos;s Vital Signs Schedule on Kardex.
                  Leave the order as &quot;Not set yet&quot; and the Kardex will show monitoring
                  as unspecified rather than assuming an interval.
                </Text>

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
                <Input
                  label="Allergies"
                  value={form.allergies}
                  onChangeText={(v) => setField('allergies', v)}
                  placeholder="Separate with commas, e.g. Penicillin, Latex"
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

                <View style={styles.row}>
                  <Input
                    label="Height (cm)"
                    value={form.heightCm}
                    onChangeText={(v) => setField('heightCm', v)}
                    keyboardType="decimal-pad"
                    error={heightError || undefined}
                    containerStyle={styles.field}
                  />
                  <Input
                    label="Weight (kg)"
                    value={form.weightKg}
                    onChangeText={(v) => setField('weightKg', v)}
                    keyboardType="decimal-pad"
                    error={weightError || undefined}
                    containerStyle={styles.field}
                  />
                </View>
                {liveBmi != null ? (
                  <Text style={styles.bmiPreview}>
                    BMI: <Text style={styles.bmiPreviewValue}>{liveBmi}</Text> ({bmiCategory(liveBmi)})
                  </Text>
                ) : null}

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
                  <View style={styles.field}>
                    <Text style={styles.bpLabel}>Blood Pressure</Text>
                    <View style={styles.bpRow}>
                      <Input
                        value={splitBloodPressure(form.bloodPressure)[0]}
                        onChangeText={(v) =>
                          setField(
                            'bloodPressure',
                            `${v.replace(/[^0-9]/g, '')}/${splitBloodPressure(form.bloodPressure)[1]}`
                          )
                        }
                        keyboardType="numeric"
                        placeholder="120"
                        containerStyle={styles.bpInput}
                      />
                      <Text style={styles.bpSlash}>/</Text>
                      <Input
                        value={splitBloodPressure(form.bloodPressure)[1]}
                        onChangeText={(v) =>
                          setField(
                            'bloodPressure',
                            `${splitBloodPressure(form.bloodPressure)[0]}/${v.replace(/[^0-9]/g, '')}`
                          )
                        }
                        keyboardType="numeric"
                        placeholder="80"
                        containerStyle={styles.bpInput}
                      />
                    </View>
                  </View>
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
  bpLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, marginBottom: 6 },
  bpRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bpInput: { flex: 1, minWidth: 0, marginBottom: 0 },
  bpSlash: { fontSize: 18, fontWeight: '700', color: Colors.gray400 },
  fieldWide: { flex: 1 },
  fieldHint: { fontSize: 11, color: Colors.gray400, marginTop: -6, lineHeight: 15 },
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
  bmiPreview: { fontSize: 13, color: Colors.mutedForeground, marginTop: -6 },
  bmiPreviewValue: { fontWeight: '700', color: Colors.foreground },
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
