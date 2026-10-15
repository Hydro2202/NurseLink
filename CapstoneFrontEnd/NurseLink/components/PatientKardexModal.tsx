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
import {
  Save,
  X,
  Stethoscope,
  User,
  UserRound,
  FileText,
  HeartPulse,
  AlertTriangle,
  MapPin,
  BedDouble,
  Plus,
} from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { DatePicker, todayIso } from './DatePicker';
import { PatientCareTeam } from './PatientCareTeam';
import { VitalSignsGrid } from './VitalSignsGrid';
import {
  createKardexRecord,
  updatePatient,
  fetchPatientAssignedDoctors,
  setPatientAssignedDoctors,
  ApiError,
} from '../services/api';
import type { Doctor, DuplicatePatientMatch, Patient } from '../types/domain';
import { useToast } from '../contexts/ToastContext';
import { assessRiskLevel } from '../utils/riskLevel';
import { computeBmi, bmiCategory, validateHeightCm, validateWeightKg } from '../utils/bmi';
import { sanitizeName } from '../utils/textSanitize';
import { KardexLabsAndMedications } from './KardexLabsAndMedications';
import { RiskBadge } from './RiskBadge';

export type PatientKardexForm = {
  lastName: string;
  firstName: string;
  middleName: string;
  age: string;
  gender: string;
  heightCm: string;
  weightKg: string;
  birthday: string;
  religion: string;
  room: string;
  bedNumber: string;
  admissionDate: string;
  attendingPhysician: string;
  chiefComplaint: string;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  diet: string;
  ivf: string;
  allergies: string[];
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
  heightCm: '',
  weightKg: '',
  birthday: '',
  religion: '',
  room: '',
  bedNumber: '',
  admissionDate: '',
  attendingPhysician: '',
  chiefComplaint: '',
  admittingDiagnosis: '',
  finalDiagnosis: '',
  diet: '',
  ivf: '',
  allergies: [],
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
    heightCm: patient.heightCm != null ? String(patient.heightCm) : '',
    weightKg: patient.weightKg != null ? String(patient.weightKg) : '',
    room: patient.room || '',
    admissionDate: patient.admissionDate || '',
    attendingPhysician: patient.attendingPhysician || '',
    admittingDiagnosis: patient.diagnosis || '',
    allergies: patient.allergies || [],
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
  const [doctorIds, setDoctorIds] = useState<number[]>([]);
  const [initialAssignedDoctors, setInitialAssignedDoctors] = useState<Doctor[]>([]);
  const [careTeamValid, setCareTeamValid] = useState(true);
  const [allergyDraft, setAllergyDraft] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicatePatientMatch[] | null>(null);

  const riskLevel = assessRiskLevel({
    temperature: form.temperature,
    pulseRate: form.pulseRate,
    respiratoryRate: form.respiratoryRate,
    bloodPressure: form.bloodPressure,
    oxygenSaturation: form.oxygenSaturation,
  });
  const liveBmi = computeBmi(form.heightCm, form.weightKg);
  const heightError = validateHeightCm(form.heightCm);
  const weightError = validateWeightKg(form.weightKg);

  const addAllergy = () => {
    const entry = allergyDraft.trim();
    if (!entry) return;
    setForm((prev) =>
      prev.allergies.some((a) => a.toLowerCase() === entry.toLowerCase())
        ? prev
        : { ...prev, allergies: [...prev.allergies, entry] }
    );
    setAllergyDraft('');
  };

  const removeAllergy = (index: number) => {
    setForm((prev) => ({ ...prev, allergies: prev.allergies.filter((_, i) => i !== index) }));
  };

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && patient) {
      (() => {
        setForm(patientToForm(patient));
      })();
      let cancelled = false;
      fetchPatientAssignedDoctors(patient.id)
        .then((doctors) => {
          if (!cancelled) {
            setDoctorIds(doctors.map((d) => d.id));
            setInitialAssignedDoctors(doctors);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDoctorIds([]);
            setInitialAssignedDoctors([]);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    (() => {
      setForm(emptyForm());
      setDoctorIds([]);
      setInitialAssignedDoctors([]);
    })();
  }, [open, mode, patient]);

  useEffect(() => {
    (() => {
      if (!open) {
        setAllergyDraft('');
        setDuplicateWarning(null);
      }
    })();
  }, [open]);

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
    if (validateHeightCm(form.heightCm)) errors.push('Height');
    if (validateWeightKg(form.weightKg)) errors.push('Weight');
    return errors;
  };

  const handleSave = async (confirmDuplicate = false) => {
    const errors = validate();
    if (errors.length) {
      toast.error('Missing Required Fields', {
        description: `Please fill in: ${errors.join(', ')}`,
      });
      return;
    }
    if (!careTeamValid) {
      toast.error('Incomplete Care Team', {
        description: 'Please assign at least one doctor to each selected department.',
      });
      return;
    }
    setSaving(true);
    try {
      if (mode === 'add') {
        const created = await createKardexRecord({ ...form, confirmDuplicate });
        if (created.patientCode && doctorIds.length > 0) {
          await setPatientAssignedDoctors(created.patientCode, doctorIds);
        }
        setDuplicateWarning(null);
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
          heightCm: form.heightCm ? Number(form.heightCm) : null,
          weightKg: form.weightKg ? Number(form.weightKg) : null,
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
        await setPatientAssignedDoctors(patient.id, doctorIds);
        toast.success('Patient updated');
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      if (mode === 'add' && error instanceof ApiError && error.status === 400) {
        const data = error.data as { possibleDuplicates?: DuplicatePatientMatch[] } | undefined;
        if (data?.possibleDuplicates?.length) {
          setDuplicateWarning(data.possibleDuplicates);
          return;
        }
      }
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
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {/* Patient quick summary — live preview of what's been entered */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryHeaderRow}>
                <UserRound size={16} color={Colors.blue700} />
                <Text style={styles.summaryEyebrow}>PATIENT</Text>
              </View>
              <View style={styles.summaryNameRow}>
                <Text style={styles.summaryName} numberOfLines={1}>
                  {[form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ') ||
                    'New patient'}
                </Text>
                <RiskBadge level={riskLevel} size="sm" />
              </View>
              <Text style={styles.riskHint}>Based on the latest vital signs entered below</Text>
              <View style={styles.summaryFactsRow}>
                <Text style={styles.summaryFact}>{form.age ? `${form.age} yrs` : 'Age —'}</Text>
                <Text style={styles.summaryDivider}>•</Text>
                <Text style={styles.summaryFact}>{form.gender || 'Sex —'}</Text>
                <Text style={styles.summaryDivider}>•</Text>
                <View style={styles.summaryFactIconRow}>
                  <MapPin size={12} color={Colors.mutedForeground} />
                  <Text style={styles.summaryFact}>{form.room ? `Room ${form.room}` : 'Room —'}</Text>
                </View>
                {form.bedNumber ? (
                  <>
                    <Text style={styles.summaryDivider}>•</Text>
                    <View style={styles.summaryFactIconRow}>
                      <BedDouble size={12} color={Colors.mutedForeground} />
                      <Text style={styles.summaryFact}>Bed {form.bedNumber}</Text>
                    </View>
                  </>
                ) : null}
                {liveBmi != null ? (
                  <>
                    <Text style={styles.summaryDivider}>•</Text>
                    <Text style={styles.summaryFact}>
                      BMI {liveBmi} ({bmiCategory(liveBmi)})
                    </Text>
                  </>
                ) : null}
              </View>
            </View>

            <View style={styles.labelRow}>
              <User size={16} color={Colors.blue600} />
              <Text style={styles.section}>Patient Demographics</Text>
            </View>
            <Text style={styles.groupHeading}>Personal Information</Text>
            <View style={styles.rowWrap}>
              <View style={[styles.field, styles.colThird]}>
                <Input
                  label="Last Name *"
                  value={form.lastName}
                  onChangeText={(v) => setField('lastName', sanitizeName(v))}
                />
              </View>
              <View style={[styles.field, styles.colThird]}>
                <Input
                  label="First Name *"
                  value={form.firstName}
                  onChangeText={(v) => setField('firstName', sanitizeName(v))}
                />
              </View>
              <View style={[styles.field, styles.colThird]}>
                <Input
                  label="Middle Name"
                  value={form.middleName}
                  onChangeText={(v) => setField('middleName', sanitizeName(v))}
                />
              </View>
            </View>
            <View style={styles.rowWrap}>
              <View style={[styles.field, styles.colThird]}>
                <Input
                  label="Age *"
                  value={form.age}
                  onChangeText={(v) => setField('age', v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                />
              </View>
              <View style={[styles.field, styles.colThird]}>
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
              </View>
              <View style={[styles.field, styles.colThird]}>
                <Input label="Religion" value={form.religion} onChangeText={(v) => setField('religion', v)} />
              </View>
              <View style={[styles.field, styles.colThird]}>
                <DatePicker
                  label="Birthday"
                  value={form.birthday}
                  onChange={(v) => setField('birthday', v)}
                  maxDate={todayIso()}
                  helperText="Cannot be in the future"
                />
              </View>
            </View>
            <View style={styles.rowWrap}>
              <View style={[styles.field, styles.colHalf]}>
                <Input
                  label="Height (cm)"
                  value={form.heightCm}
                  onChangeText={(v) => setField('heightCm', v)}
                  placeholder="e.g. 165.0"
                  keyboardType="decimal-pad"
                  error={heightError || undefined}
                />
              </View>
              <View style={[styles.field, styles.colHalf]}>
                <Input
                  label="Weight (kg)"
                  value={form.weightKg}
                  onChangeText={(v) => setField('weightKg', v)}
                  placeholder="e.g. 62.5"
                  keyboardType="decimal-pad"
                  error={weightError || undefined}
                />
              </View>
            </View>
            {liveBmi != null ? (
              <Text style={styles.bmiPreview}>
                BMI: <Text style={styles.bmiPreviewValue}>{liveBmi}</Text> ({bmiCategory(liveBmi)})
              </Text>
            ) : null}

            <View style={styles.groupDivider} />
            <Text style={styles.groupHeading}>Admission Information</Text>
            <View style={styles.rowWrap}>
              <View style={[styles.field, styles.colThird]}>
                <DatePicker
                  label="Admission Date"
                  required
                  value={form.admissionDate}
                  onChange={(v) => setField('admissionDate', v)}
                  maxDate={todayIso()}
                />
              </View>
              <View style={[styles.field, styles.colThird]}>
                <Input label="Room *" value={form.room} onChangeText={(v) => setField('room', v)} />
              </View>
              <View style={[styles.field, styles.colThird]}>
                <Input label="Bed Number" value={form.bedNumber} onChangeText={(v) => setField('bedNumber', v)} />
              </View>
            </View>

            <View style={[styles.labelRow, styles.sectionSpacing]}>
              <FileText size={16} color={Colors.green600} />
              <Text style={styles.section}>Medical Information</Text>
            </View>
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
            <Input
              label="IVF"
              value={form.ivf}
              onChangeText={(v) => setField('ivf', v)}
              placeholder="e.g., D5LR 1L @ 80cc/hr"
            />

            <Text style={styles.label}>Allergies</Text>
            <View style={styles.allergyInputRow}>
              <View style={{ flex: 1 }}>
                <Input
                  value={allergyDraft}
                  onChangeText={setAllergyDraft}
                  placeholder="e.g., Penicillin, Latex, Shellfish"
                  onSubmitEditing={addAllergy}
                  returnKeyType="done"
                />
              </View>
              <Pressable
                onPress={addAllergy}
                disabled={!allergyDraft.trim()}
                style={[styles.allergyAddBtn, !allergyDraft.trim() && styles.allergyAddBtnDisabled]}
              >
                <Plus size={16} color={Colors.white} />
              </Pressable>
            </View>
            {form.allergies.length > 0 ? (
              <View style={styles.allergyChipsRow}>
                {form.allergies.map((allergy, index) => (
                  <View key={`${allergy}-${index}`} style={styles.allergyChip}>
                    <AlertTriangle size={12} color={Colors.orange700} />
                    <Text style={styles.allergyChipText}>{allergy}</Text>
                    <Pressable onPress={() => removeAllergy(index)} hitSlop={6}>
                      <X size={13} color={Colors.orange700} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>No known allergies recorded.</Text>
            )}

            <View style={[styles.labelRow, styles.sectionSpacing]}>
              <Stethoscope size={16} color={Colors.blue600} />
              <Text style={styles.section}>Patient Care Team</Text>
            </View>
            <Text style={styles.hint}>
              Assign the departments and doctors responsible for this patient&apos;s care. Add New
              Task can only assign tasks to doctors selected here.
            </Text>
            <PatientCareTeam
              key={open ? `${mode}-${patient?.id || 'new'}` : 'closed'}
              initialAssignedDoctors={initialAssignedDoctors}
              doctorIds={doctorIds}
              onChange={setDoctorIds}
              onValidityChange={setCareTeamValid}
            />

            <View style={[styles.labelRow, styles.sectionSpacing]}>
              <HeartPulse size={16} color={Colors.red600} />
              <Text style={styles.section}>Latest Vital Signs</Text>
            </View>
            <VitalSignsGrid
              temperature={form.temperature}
              onTemperatureChange={(v) => setField('temperature', v)}
              pulseRate={form.pulseRate}
              onPulseRateChange={(v) => setField('pulseRate', v)}
              respiratoryRate={form.respiratoryRate}
              onRespiratoryRateChange={(v) => setField('respiratoryRate', v)}
              bloodPressure={form.bloodPressure}
              onBloodPressureChange={(v) => setField('bloodPressure', v)}
              oxygenSaturation={form.oxygenSaturation}
              onOxygenSaturationChange={(v) => setField('oxygenSaturation', v)}
            />

            <View style={[styles.labelRow, styles.sectionSpacing]}>
              <AlertTriangle size={16} color={Colors.orange600} />
              <Text style={styles.section}>Special Endorsements</Text>
            </View>
            <Text style={styles.hint}>
              Important instructions, precautions, and patient-specific notes.
            </Text>
            <TextInput
              style={[styles.textarea, styles.endorsementsTextarea, { minHeight: 90 }]}
              value={form.specialEndorsements}
              onChangeText={(v) => setField('specialEndorsements', v)}
              placeholder="Enter any special instructions, precautions, or important notes..."
              placeholderTextColor={Colors.gray400}
              multiline
            />

            {mode === 'edit' && patient ? (
              <>
                <View style={styles.groupDivider} />
                <KardexLabsAndMedications patientId={patient.id} />
              </>
            ) : null}
          </ScrollView>
          <View style={styles.footer}>
            <View style={styles.footerButtons}>
              <Button variant="outline" onPress={() => onOpenChange(false)} style={{ flex: 1 }}>
                <Text>Cancel</Text>
              </Button>
              <Button onPress={() => handleSave(false)} loading={saving} style={{ flex: 1.4 }}>
                <Save size={16} color={Colors.white} />
                <Text style={{ color: Colors.white, fontWeight: '600' }}>
                  {mode === 'add' ? 'Save Patient' : 'Update'}
                </Text>
              </Button>
            </View>
            <Text style={styles.requiredHint}>
              <Text style={styles.required}>*</Text> Required fields must be completed
            </Text>
          </View>
        </View>
      </View>

      {duplicateWarning ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDuplicateWarning(null)}>
          <Pressable style={styles.confirmBackdrop} onPress={() => setDuplicateWarning(null)}>
            <Pressable style={[styles.confirmSheet, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.confirmTitle}>Possible Duplicate Patient</Text>
              <Text style={styles.confirmDesc}>
                A patient with similar information already exists. Please verify before creating a
                new patient.
              </Text>
              <View style={{ gap: 12 }}>
                {duplicateWarning.map((match) => (
                  <View key={match.patientId} style={styles.duplicateMatchBox}>
                    <Text style={styles.duplicateMatchName}>
                      {match.name} ({match.patientId})
                    </Text>
                    <Text style={styles.duplicateMatchMeta}>
                      {match.age}y • {match.gender} • Room {match.room}
                      {match.admissionDate ? ` • Admitted ${match.admissionDate}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.confirmFooter}>
                <Button variant="outline" style={{ flex: 1 }} onPress={() => setDuplicateWarning(null)}>
                  <Text>Back, Let Me Check</Text>
                </Button>
                <Button
                  style={{ flex: 1, backgroundColor: Colors.orange600 }}
                  loading={saving}
                  onPress={() => handleSave(true)}
                >
                  <Text style={{ color: Colors.white, fontWeight: '600' }}>
                    Continue, This Is a New Patient
                  </Text>
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
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
    marginBottom: 2,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.blue700,
  },
  sectionSpacing: { marginTop: 10 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.gray700 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { fontSize: 11, color: Colors.gray500, marginTop: -6 },
  textarea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 10,
    minHeight: 64,
    textAlignVertical: 'top',
    fontSize: 16,
    color: Colors.foreground,
    backgroundColor: Colors.inputBackground,
  },
  endorsementsTextarea: {
    borderColor: Colors.orange100,
    backgroundColor: Colors.orange50,
  },
  allergyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  allergyAddBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.blue600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allergyAddBtnDisabled: {
    opacity: 0.5,
  },
  allergyChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  allergyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
  },
  allergyChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.orange700,
  },
  footer: {
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  requiredHint: {
    fontSize: 11,
    color: Colors.gray500,
    textAlign: 'center',
  },
  required: {
    color: Colors.red600,
  },
  field: { gap: 6 },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colThird: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 130,
  },
  colHalf: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
  },
  bmiPreview: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginTop: -6,
  },
  bmiPreviewValue: {
    fontWeight: '700',
    color: Colors.foreground,
  },
  groupHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.blue700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  groupDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 6,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.blue700,
    letterSpacing: 0.5,
  },
  summaryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryName: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.gray900,
  },
  riskHint: {
    fontSize: 10,
    color: Colors.gray500,
    marginTop: -2,
  },
  summaryFactsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryFactIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  summaryFact: {
    fontSize: 13,
    color: Colors.foreground,
    fontWeight: '500',
  },
  summaryDivider: {
    fontSize: 12,
    color: Colors.gray400,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  confirmSheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    gap: 12,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  confirmDesc: {
    fontSize: 14,
    color: Colors.mutedForeground,
    lineHeight: 20,
  },
  duplicateMatchBox: {
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
    borderRadius: Radius.md,
    padding: 12,
    gap: 4,
  },
  duplicateMatchName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.foreground,
  },
  duplicateMatchMeta: {
    fontSize: 13,
    color: Colors.gray700,
  },
  confirmFooter: {
    flexDirection: 'row',
    gap: 12,
  },
});
