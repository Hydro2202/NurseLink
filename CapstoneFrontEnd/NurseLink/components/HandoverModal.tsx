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
import { Shield, User, Plus, X } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Select } from './Select';
import { Alert, AlertDescription } from './Alert';
import type { HandoverNote } from '../types/domain';
import { fetchPatients, fetchNurses } from '../services/api';
import type { Nurse, Patient } from '../types/domain';

interface HandoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (handover: Partial<HandoverNote>) => Promise<void>;
}

export function HandoverModal({ open, onOpenChange, onSave }: HandoverModalProps) {
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedNurseId, setSelectedNurseId] = useState('');
  // Work the outgoing nurse could not finish. On acknowledgement the API turns
  // each line into a task on the receiving nurse's list, so this is the part of
  // the handover that actually carries over rather than just being read.
  const [unfinishedTasks, setUnfinishedTasks] = useState<string[]>([]);
  const [taskDraft, setTaskDraft] = useState('');
  const [formData, setFormData] = useState({
    patientName: '',
    shift: 'morning' as 'morning' | 'afternoon' | 'night',
    nurseTo: '',
    situation: '',
    background: '',
    assessment: '',
    recommendation: '',
    attendingPhysician: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [nursesLoading, setNursesLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedPatientId('');
      setSelectedNurseId('');
      setUnfinishedTasks([]);
      setTaskDraft('');
      setFormData({
        patientName: '',
        shift: 'morning',
        nurseTo: '',
        situation: '',
        background: '',
        assessment: '',
        recommendation: '',
        attendingPhysician: '',
      });
      setErrors({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const patientData = await fetchPatients({ mine: true });
        if (!cancelled) setPatients(patientData);
      } catch {
        if (!cancelled) setPatients([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Nurses who already received this patient's handover must not be offered
  // again for it, so the eligible list is re-fetched per selected patient
  // rather than loaded once for the whole modal.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setNursesLoading(true);
      try {
        const nurseData = await fetchNurses(
          selectedPatientId ? { excludeForPatient: selectedPatientId } : undefined
        );
        if (!cancelled) {
          setNurses(nurseData);
          // The previously selected nurse may no longer be eligible for the
          // newly selected patient — clear it rather than silently submitting
          // a stale choice.
          setSelectedNurseId((prev) =>
            prev && !nurseData.some((n) => n.id === prev) ? '' : prev
          );
        }
      } catch {
        if (!cancelled) setNurses([]);
      } finally {
        if (!cancelled) setNursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedPatientId]);

  useEffect(() => {
    if (selectedNurseId) {
      const nurse = nurses.find((n) => n.id === selectedNurseId);
      if (nurse) {
        setFormData((prev) => ({ ...prev, nurseTo: nurse.name }));
      }
    }
  }, [selectedNurseId, nurses]);

  useEffect(() => {
    if (selectedPatientId) {
      const patient = patients.find((p) => p.id === selectedPatientId);
      if (patient) {
        const situation = `${patient.name} is a ${patient.age}-year-old ${patient.gender.toLowerCase()} admitted on ${patient.admissionDate} with ${patient.diagnosis}. Currently in ${patient.room}. Risk level: ${patient.riskLevel}.`;
        const background = `Diagnosis: ${patient.diagnosis}\nAllergies: ${patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'}\nCurrent Medications: ${patient.medications.join(', ')}\nAdmission Date: ${patient.admissionDate}`;
        const assessment = `Vital Signs:\n- Heart Rate: ${patient.vitalSigns.heartRate} bpm\n- Blood Pressure: ${patient.vitalSigns.bloodPressure}\n- Temperature: ${patient.vitalSigns.temperature}°C\n- Oxygen Saturation: ${patient.vitalSigns.oxygenSaturation}%\n- Respiratory Rate: ${patient.vitalSigns.respiratoryRate}/min\n\nAlerts: ${patient.alerts.join('; ')}`;

        setFormData((prev) => ({
          ...prev,
          patientName: patient.name,
          situation,
          background,
          assessment,
          attendingPhysician: patient.attendingPhysician || '',
        }));
      }
    }
  }, [selectedPatientId, patients]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!selectedPatientId) newErrors.patient = 'Please select a patient';
    if (!selectedNurseId) newErrors.nurse = 'Please select a receiving nurse';
    if (!formData.recommendation.trim()) newErrors.recommendation = 'Recommendation is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const addUnfinishedTask = () => {
    const entry = taskDraft.trim();
    if (!entry) return;
    setUnfinishedTasks((prev) => (prev.includes(entry) ? prev : [...prev, entry]));
    setTaskDraft('');
  };

  const removeUnfinishedTask = (index: number) => {
    setUnfinishedTasks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave({
        patientId: selectedPatientId,
        patientName: formData.patientName,
        shift: formData.shift,
        nurseTo: formData.nurseTo,
        // Sent alongside the name so the API can notify exactly this nurse —
        // display names are not unique on this ward.
        nurseToId: selectedNurseId,
        sbar: {
          situation: formData.situation,
          background: formData.background,
          assessment: formData.assessment,
          recommendation: formData.recommendation,
        },
        unfinishedTasks,
        status: 'pending',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving handover:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !loading && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Shield size={20} color={Colors.primary} />
            <Text style={styles.title}>Create Handover Note</Text>
          </View>
          <Text style={styles.description}>
            Complete the SBAR form to submit a secure handover note to the incoming nurse.
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              <Alert variant="info" style={styles.hipaaAlert}>
                <AlertDescription>
                  All handover notes are encrypted and comply with HIPAA security standards.
                </AlertDescription>
              </Alert>

              <Select
                label="Select Patient *"
                value={selectedPatientId}
                onValueChange={setSelectedPatientId}
                options={patients.map((p) => ({
                  label: `${p.name} • ${p.room}`,
                  value: p.id,
                  keywords: `${p.id} ${p.room} ${p.diagnosis}`,
                }))}
                placeholder="Choose a patient"
                error={errors.patient}
                searchable
                searchPlaceholder="Search by name, ID, or room..."
              />

              {selectedPatientId ? (
                <View style={styles.physicianBox}>
                  <View style={styles.labelRow}>
                    <User size={16} color={Colors.blue600} />
                    <Text style={styles.physicianLabel}>Attending Physician</Text>
                  </View>
                  <Text style={styles.physicianValue}>{formData.attendingPhysician}</Text>
                </View>
              ) : null}

              <View style={styles.row}>
                <Select
                  style={{ flex: 1 }}
                  label="Shift *"
                  value={formData.shift}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      shift: value as 'morning' | 'afternoon' | 'night',
                    })
                  }
                  options={[
                    { label: '☀️ Morning (07:00-15:00)', value: 'morning' },
                    { label: '🌤️ Afternoon (15:00-23:00)', value: 'afternoon' },
                    { label: '🌙 Night (23:00-07:00)', value: 'night' },
                  ]}
                  placeholder="Select shift"
                />
                <Select
                  style={{ flex: 1 }}
                  label="Receiving Nurse *"
                  value={selectedNurseId}
                  onValueChange={setSelectedNurseId}
                  options={nurses.map((n) => ({
                    label: `${n.name} • ${n.role}${n.specialization ? ` (${n.specialization})` : ''}`,
                    value: n.id,
                    keywords: `${n.email || ''} ${n.department || ''}`,
                  }))}
                  placeholder={
                    nursesLoading
                      ? 'Loading nurses...'
                      : selectedPatientId && nurses.length === 0
                        ? 'All available nurses have already received this patient.'
                        : 'Choose a nurse'
                  }
                  searchable
                  searchPlaceholder="Search by name, username, or email..."
                  emptyMessage={
                    selectedPatientId
                      ? 'All available nurses have already received this patient.'
                      : 'No nurses found.'
                  }
                  error={errors.nurse}
                />
              </View>

              {selectedPatientId && !nursesLoading && nurses.length === 0 ? (
                <Alert variant="warning">
                  <AlertDescription>
                    All available nurses have already received this patient. This patient
                    cannot be handed over again until a different nurse becomes eligible.
                  </AlertDescription>
                </Alert>
              ) : null}

              <View style={styles.sbarSection}>
                <Text style={styles.sbarTitle}>SBAR Report</Text>

                {!selectedPatientId ? (
                  <View style={styles.emptySbar}>
                    <Text style={styles.emptySbarText}>
                      Please select a patient to view SBAR information
                    </Text>
                  </View>
                ) : (
                  <View style={styles.sbarFields}>
                    <SbarField
                      badge="S"
                      badgeBg={Colors.blue100}
                      badgeColor={Colors.blue700}
                      label="Situation"
                      hint="(Auto-filled)"
                      value={formData.situation}
                      readOnly
                    />
                    <SbarField
                      badge="B"
                      badgeBg={Colors.green100}
                      badgeColor={Colors.green700}
                      label="Background"
                      hint="(Auto-filled)"
                      value={formData.background}
                      readOnly
                      minHeight={100}
                    />
                    <SbarField
                      badge="A"
                      badgeBg={Colors.yellow100}
                      badgeColor={Colors.orange700}
                      label="Assessment"
                      hint="(Auto-filled)"
                      value={formData.assessment}
                      readOnly
                      minHeight={120}
                    />

                    <View style={styles.recommendationBox}>
                      <View style={styles.labelRow}>
                        <View style={[styles.badge, { backgroundColor: Colors.purple100 }]}>
                          <Text style={[styles.badgeText, { color: Colors.purple700 }]}>R</Text>
                        </View>
                        <Text style={styles.label}>Recommendation *</Text>
                        <Text style={styles.recHint}>(Enter your recommendations)</Text>
                      </View>
                      <TextInput
                        style={[
                          styles.textarea,
                          styles.recInput,
                          errors.recommendation ? styles.inputError : null,
                        ]}
                        placeholder="What needs to be done for this patient? (e.g., pending tasks, follow-ups, special care)"
                        placeholderTextColor={Colors.mutedForeground}
                        value={formData.recommendation}
                        onChangeText={(recommendation) =>
                          setFormData({ ...formData, recommendation })
                        }
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                      />
                      {errors.recommendation ? (
                        <Text style={styles.error}>{errors.recommendation}</Text>
                      ) : null}
                    </View>

                    <View style={styles.unfinishedBox}>
                      <Text style={styles.label}>Unfinished Tasks</Text>
                      <Text style={styles.unfinishedHint}>
                        Anything still outstanding. When the receiving nurse acknowledges
                        this handover, each line becomes a task on their list.
                      </Text>

                      <View style={styles.taskInputRow}>
                        <TextInput
                          style={[styles.textarea, styles.taskInput]}
                          placeholder="e.g., Recheck IV site at 14:00"
                          placeholderTextColor={Colors.mutedForeground}
                          value={taskDraft}
                          onChangeText={setTaskDraft}
                          onSubmitEditing={addUnfinishedTask}
                          returnKeyType="done"
                          blurOnSubmit={false}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onPress={addUnfinishedTask}
                          disabled={!taskDraft.trim()}
                          style={styles.taskAddBtn}
                        >
                          <Plus size={16} color={Colors.blue700} />
                          <Text style={styles.taskAddText}>Add</Text>
                        </Button>
                      </View>

                      {unfinishedTasks.map((task, index) => (
                        <View key={`${task}-${index}`} style={styles.taskChip}>
                          <Text style={styles.taskChipText}>{task}</Text>
                          <Pressable
                            onPress={() => removeUnfinishedTask(index)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${task}`}
                          >
                            <X size={15} color={Colors.mutedForeground} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
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
              {loading ? 'Submitting...' : 'Submit Handover'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SbarField({
  badge,
  badgeBg,
  badgeColor,
  label,
  hint,
  value,
  readOnly,
  minHeight = 80,
}: {
  badge: string;
  badgeBg: string;
  badgeColor: string;
  label: string;
  hint: string;
  value: string;
  readOnly?: boolean;
  minHeight?: number;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
        </View>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hintInline}>{hint}</Text>
      </View>
      <TextInput
        style={[styles.textarea, styles.readOnly, { minHeight }]}
        value={value}
        editable={!readOnly}
        multiline
        textAlignVertical="top"
      />
    </View>
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
    maxWidth: 700,
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
  hipaaAlert: {
    backgroundColor: Colors.blue50,
    borderLeftColor: Colors.blue200,
  },
  physicianBox: {
    backgroundColor: Colors.blue50,
    borderWidth: 1,
    borderColor: Colors.blue200,
    borderRadius: Radius.md,
    padding: 14,
    gap: 6,
  },
  physicianLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue900,
  },
  physicianValue: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.blue800,
    marginLeft: 22,
  },
  row: { flexDirection: 'row', gap: 12 },
  sbarSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 16,
    marginTop: 4,
  },
  sbarTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.foreground,
    marginBottom: 14,
  },
  emptySbar: {
    backgroundColor: Colors.gray50,
    borderWidth: 1,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: 24,
    alignItems: 'center',
  },
  emptySbarText: {
    fontSize: 13,
    color: Colors.gray500,
    textAlign: 'center',
  },
  sbarFields: { gap: 14 },
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
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  hintInline: {
    fontSize: 11,
    color: Colors.mutedForeground,
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
    backgroundColor: Colors.gray50,
    borderColor: Colors.gray200,
  },
  unfinishedBox: {
    gap: 8,
    paddingTop: 14,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  unfinishedHint: {
    fontSize: 12,
    color: Colors.mutedForeground,
    lineHeight: 16,
  },
  taskInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  taskInput: {
    flex: 1,
    minHeight: 44,
  },
  taskAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskAddText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue700,
  },
  taskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.muted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  taskChipText: {
    flex: 1,
    fontSize: 13,
    color: Colors.foreground,
  },
  recommendationBox: {
    backgroundColor: Colors.purple50,
    borderWidth: 2,
    borderColor: Colors.purple100,
    borderRadius: Radius.md,
    padding: 14,
    gap: 8,
  },
  recHint: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.purple700,
  },
  recInput: {
    backgroundColor: Colors.white,
    borderColor: Colors.purple100,
    minHeight: 100,
  },
  inputError: {
    borderColor: Colors.destructive,
  },
  error: {
    fontSize: 12,
    color: Colors.destructive,
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
