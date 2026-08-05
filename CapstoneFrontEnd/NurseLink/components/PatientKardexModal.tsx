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
import { Save, X } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import {
  createKardexRecord,
  updatePatient,
  ApiError,
} from '../services/api';
import type { Patient } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

export type PatientKardexForm = {
  lastName: string;
  firstName: string;
  middleName: string;
  age: string;
  gender: string;
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  temperature: string;
  pulseRate: string;
  respiratoryRate: string;
  bloodPressure: string;
  oxygenSaturation: string;
  specialEndorsements: string;
};

const emptyForm = (): PatientKardexForm => ({
  lastName: '',
  firstName: '',
  middleName: '',
  age: '',
  gender: '',
  religion: '',
  room: '',
  bedNumber: '',
  admissionDate: '',
  attendingPhysician: '',
  chiefComplaint: '',
  admittingDiagnosis: '',
  finalDiagnosis: '',
  diet: '',
  temperature: '',
  pulseRate: '',
  respiratoryRate: '',
  bloodPressure: '',
  oxygenSaturation: '',
  specialEndorsements: '',
});

function patientToForm(patient: Patient): PatientKardexForm {
  const parts = patient.name.trim().split(/\s+/);
  return {
    ...emptyForm(),
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    age: String(patient.age ?? ''),
    gender: patient.gender || '',
    room: patient.room || '',
    admissionDate: patient.admissionDate || '',
    attendingPhysician: patient.attendingPhysician || '',
    admittingDiagnosis: patient.diagnosis || '',
    temperature: patient.vitalSigns?.temperature != null ? String(patient.vitalSigns.temperature) : '',
    pulseRate: patient.vitalSigns?.heartRate != null ? String(patient.vitalSigns.heartRate) : '',
    respiratoryRate:
      patient.vitalSigns?.respiratoryRate != null ? String(patient.vitalSigns.respiratoryRate) : '',
    bloodPressure: patient.vitalSigns?.bloodPressure || '',
    oxygenSaturation:
      patient.vitalSigns?.oxygenSaturation != null
        ? String(patient.vitalSigns.oxygenSaturation)
        : '',
  };
}

interface PatientKardexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  patient?: Patient | null;
  onSaved: () => void;
}

export function PatientKardexModal({
  open,
  onOpenChange,
  mode,
  patient,
  onSaved,
}: PatientKardexModalProps) {
  const toast = useToast();
  const [form, setForm] = useState<PatientKardexForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && patient) {
      setForm(patientToForm(patient));
    } else {
      setForm(emptyForm());
    }
  }, [open, mode, patient]);

  const setField = <K extends keyof PatientKardexForm>(key: K, value: PatientKardexForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    const errors: string[] = [];
    if (!form.firstName) errors.push('First Name');
    if (!form.lastName) errors.push('Last Name');
    if (!form.age) errors.push('Age');
    if (!form.gender) errors.push('Sex/Gender');
    if (!form.admissionDate) errors.push('Admission Date');
    if (!form.room) errors.push('Room');
    return errors;
  };

  const handleSave = async () => {
    const errors = validate();
    if (errors.length) {
      toast.error('Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }
    setSaving(true);
    try {
      if (mode === 'add') {
        await createKardexRecord({ ...form });
        toast.success('Patient added', {
          description: 'Patient created from Kardex and added to the patient list.',
        });
      } else if (patient) {
        const name = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ');
        await updatePatient(patient.id, {
          name,
          age: Number(form.age) || 0,
          gender: form.gender as Patient['gender'],
          room: form.room,
          diagnosis: form.admittingDiagnosis || form.chiefComplaint || patient.diagnosis,
          admissionDate: form.admissionDate,
          attendingPhysician: form.attendingPhysician,
          vitalSigns: {
            heartRate: Number(form.pulseRate) || 0,
            bloodPressure: form.bloodPressure || '',
            temperature: Number(form.temperature) || 0,
            oxygenSaturation: Number(form.oxygenSaturation) || 0,
            respiratoryRate: Number(form.respiratoryRate) || 0,
          },
        });
        // Also store a fresh kardex snapshot linked to this patient
        await createKardexRecord({ ...form, patientId: patient.id });
        toast.success('Patient updated');
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(mode === 'add' ? 'Failed to add patient' : 'Failed to update patient', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => onOpenChange(false)}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{mode === 'add' ? 'Add Patient (Kardex)' : 'Edit Patient'}</Text>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8}>
              <X size={22} color={Colors.gray700} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.section}>Patient Demographics</Text>
            <Input label="Last Name *" value={form.lastName} onChangeText={(v) => setField('lastName', v)} />
            <Input label="First Name *" value={form.firstName} onChangeText={(v) => setField('firstName', v)} />
            <Input label="Middle Name" value={form.middleName} onChangeText={(v) => setField('middleName', v)} />
            <Input label="Age *" value={form.age} onChangeText={(v) => setField('age', v)} keyboardType="numeric" />
            <Select
              label="Sex/Gender *"
              value={form.gender}
              onValueChange={(v) => setField('gender', v)}
              options={[
                { label: 'Male', value: 'Male' },
                { label: 'Female', value: 'Female' },
              ]}
              placeholder="Select"
            />
            <Input label="Religion" value={form.religion} onChangeText={(v) => setField('religion', v)} />
            <Input
              label="Admission Date *"
              value={form.admissionDate}
              onChangeText={(v) => setField('admissionDate', v)}
              placeholder="YYYY-MM-DD"
            />
            <Input label="Room *" value={form.room} onChangeText={(v) => setField('room', v)} />
            <Input label="Bed Number" value={form.bedNumber} onChangeText={(v) => setField('bedNumber', v)} />

            <Text style={styles.section}>Medical Information</Text>
            <Input
              label="Attending Physician"
              value={form.attendingPhysician}
              onChangeText={(v) => setField('attendingPhysician', v)}
              placeholder="Physician name"
            />
            <Text style={styles.label}>Chief Complaint</Text>
            <TextInput
              style={styles.textarea}
              value={form.chiefComplaint}
              onChangeText={(v) => setField('chiefComplaint', v)}
              multiline
            />
            <Text style={styles.label}>Admitting Diagnosis</Text>
            <TextInput
              style={styles.textarea}
              value={form.admittingDiagnosis}
              onChangeText={(v) => setField('admittingDiagnosis', v)}
              multiline
            />
            <Text style={styles.label}>Final Diagnosis</Text>
            <TextInput
              style={styles.textarea}
              value={form.finalDiagnosis}
              onChangeText={(v) => setField('finalDiagnosis', v)}
              multiline
            />
            <Input label="Diet" value={form.diet} onChangeText={(v) => setField('diet', v)} />

            <Text style={styles.section}>Vital Signs</Text>
            <Input label="Temperature" value={form.temperature} onChangeText={(v) => setField('temperature', v)} />
            <Input label="Pulse Rate" value={form.pulseRate} onChangeText={(v) => setField('pulseRate', v)} />
            <Input
              label="Respiratory Rate"
              value={form.respiratoryRate}
              onChangeText={(v) => setField('respiratoryRate', v)}
            />
            <Input
              label="Blood Pressure"
              value={form.bloodPressure}
              onChangeText={(v) => setField('bloodPressure', v)}
            />
            <Input
              label="Oxygen Saturation"
              value={form.oxygenSaturation}
              onChangeText={(v) => setField('oxygenSaturation', v)}
            />

            <Text style={styles.section}>Special Endorsements</Text>
            <TextInput
              style={[styles.textarea, { minHeight: 90 }]}
              value={form.specialEndorsements}
              onChangeText={(v) => setField('specialEndorsements', v)}
              multiline
            />
          </ScrollView>
          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} style={{ flex: 1 }}>
              <Text>Cancel</Text>
            </Button>
            <Button onPress={handleSave} loading={saving} style={{ flex: 1 }}>
              <Save size={16} color={Colors.white} />
              <Text style={{ color: Colors.white, fontWeight: '600' }}>
                {mode === 'add' ? 'Save Patient' : 'Update'}
              </Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    ...Shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  section: {
    marginTop: 8,
    marginBottom: 2,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.blue700,
  },
  label: { fontSize: 13, fontWeight: '600', color: Colors.gray700 },
  textarea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 10,
    minHeight: 64,
    textAlignVertical: 'top',
    color: Colors.foreground,
    backgroundColor: Colors.inputBackground,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
