import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import { FileText, User, X, ChevronDown, CheckSquare, Square } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Alert, AlertDescription } from './Alert';
import { SearchablePicker, PickerChip, PickerGroup } from './SearchablePicker';
import type { EligibleReceiver, EligibleReceiverGroup, EndorsablePatient, HandoverNote } from '../types/domain';
import { fetchMyEndorsablePatients, fetchEligibleReceivers, ApiError } from '../services/api';
import { bmiCategory } from '../utils/bmi';

interface HandoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (handover: Partial<HandoverNote>) => Promise<void>;
}

const SHIFT_GROUP_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  night: 'Night',
  unassigned: 'Unassigned',
};

const SHIFT_CHIP_ORDER = ['morning', 'afternoon', 'night', 'unassigned'];

export function HandoverModal({ open, onOpenChange, onSave }: HandoverModalProps) {
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState<EndorsablePatient[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([]);
  const [selectedNurseId, setSelectedNurseId] = useState('');
  const [patientNotes, setPatientNotes] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    nurseTo: '',
    situation: '',
    background: '',
    assessment: '',
    recommendation: '',
    attendingPhysician: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Any active, approved nurse, any shift/department — see
  // api/views.py::HandoverViewSet.eligible_receivers. Grouped by shift so
  // the picker reads like a duty roster rather than a flat alphabetical list.
  const [groups, setGroups] = useState<EligibleReceiverGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState('');

  // Receiving Nurse picker
  const [nurseSheetOpen, setNurseSheetOpen] = useState(false);
  const [nurseSearch, setNurseSearch] = useState('');
  const [nurseShiftChip, setNurseShiftChip] = useState('all');

  // Patients picker — a draft selection so Cancel/closing without Done
  // leaves the real selection (selectedPatientIds) unchanged.
  const [patientSheetOpen, setPatientSheetOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [draftPatientIds, setDraftPatientIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setSelectedPatientIds([]);
      setSelectedNurseId('');
      setPatientNotes({});
      setFormData({
        nurseTo: '', situation: '', background: '', assessment: '', recommendation: '', attendingPhysician: '',
      });
      setErrors({});
      setGroups([]);
      setGroupsError('');
      setNurseSheetOpen(false);
      setNurseSearch('');
      setNurseShiftChip('all');
      setPatientSheetOpen(false);
      setPatientSearch('');
      setDraftPatientIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMyEndorsablePatients();
        if (!cancelled) setPatients(data);
      } catch {
        if (!cancelled) setPatients([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadReceivers = async () => {
    setGroupsLoading(true);
    setGroupsError('');
    try {
      const data = await fetchEligibleReceivers();
      setGroups(data);
    } catch (err) {
      setGroups([]);
      setGroupsError(err instanceof ApiError ? err.message : 'Failed to load nurses.');
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadReceivers();
  }, [open]);

  const allNurses = useMemo(() => groups.flatMap((g) => g.nurses), [groups]);
  const selectedNurse = allNurses.find((n) => n.id === selectedNurseId);

  useEffect(() => {
    if (selectedNurse) setFormData((prev) => ({ ...prev, nurseTo: selectedNurse.fullName }));
  }, [selectedNurse]);

  // Reset search/chip each time the nurse picker opens, per spec.
  const openNursePicker = () => {
    setNurseSearch('');
    setNurseShiftChip('all');
    setNurseSheetOpen(true);
  };

  const nurseChips: PickerChip[] = useMemo(() => {
    const chips: PickerChip[] = [{ key: 'all', label: 'All', count: allNurses.length }];
    for (const key of SHIFT_CHIP_ORDER) {
      const group = groups.find((g) => g.shift.id === key);
      if (!group) continue;
      if (key === 'unassigned' && group.nurses.length === 0) continue;
      chips.push({ key, label: SHIFT_GROUP_LABELS[key], count: group.nurses.length });
    }
    return chips;
  }, [groups, allNurses.length]);

  const nurseGroups: PickerGroup<EligibleReceiver>[] = useMemo(() => {
    const q = nurseSearch.trim().toLowerCase();
    const matches = (n: EligibleReceiver) =>
      !q || n.fullName.toLowerCase().includes(q) || n.department.name.toLowerCase().includes(q);
    return groups
      .filter((g) => nurseShiftChip === 'all' || g.shift.id === nurseShiftChip)
      .map((g) => ({
        key: g.shift.id,
        label: `${g.shift.name.toUpperCase()} SHIFT`,
        items: g.nurses.filter(matches),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, nurseSearch, nurseShiftChip]);

  const handlePickNurse = (nurse: EligibleReceiver) => {
    setSelectedNurseId(nurse.id);
  };

  // Patients picker
  const openPatientPicker = () => {
    setPatientSearch('');
    setDraftPatientIds(selectedPatientIds);
    setPatientSheetOpen(true);
  };

  const patientGroups: PickerGroup<EndorsablePatient>[] = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    const matches = (p: EndorsablePatient) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.room.toLowerCase().includes(q) ||
      p.diagnosis.toLowerCase().includes(q);
    return [{ key: 'patients', items: patients.filter(matches) }];
  }, [patients, patientSearch]);

  const toggleDraftPatient = (patient: EndorsablePatient) => {
    setDraftPatientIds((prev) =>
      prev.includes(patient.id) ? prev.filter((id) => id !== patient.id) : [...prev, patient.id]
    );
  };

  const selectAllFilteredPatients = () => {
    const filteredIds = patientGroups[0].items
      .filter((p) => !p.pendingEndorsement || draftPatientIds.includes(p.id))
      .map((p) => p.id);
    setDraftPatientIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const clearDraftPatients = () => setDraftPatientIds([]);

  const confirmPatientSelection = () => {
    setSelectedPatientIds(draftPatientIds);
    setPatientSheetOpen(false);
  };

  const removeSelectedPatient = (id: string) => {
    setSelectedPatientIds((prev) => prev.filter((pid) => pid !== id));
  };

  // Auto-fill SBAR from the single selected patient — the same one-patient
  // behavior the old single-patient referral form had. With zero or
  // several patients selected there is no one chart to summarize, so these
  // fields stay blank/manual and the nurse writes one recommendation
  // covering the whole endorsement (per-patient specifics go in each
  // patient's own note below instead).
  useEffect(() => {
    if (selectedPatientIds.length !== 1) {
      setFormData((prev) => ({ ...prev, situation: '', background: '', assessment: '', attendingPhysician: '' }));
      return;
    }
    const patient = patients.find((p) => p.id === selectedPatientIds[0]);
    if (!patient) return;
    const situation = `${patient.name} is a ${patient.age}-year-old ${patient.gender.toLowerCase()} admitted on ${patient.admissionDate} with ${patient.diagnosis}. Currently in ${patient.room}. Risk level: ${patient.riskLevel}.`;
    const background = `Diagnosis: ${patient.diagnosis}\nAllergies: ${patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'}\nCurrent Medications: ${patient.medications.join(', ')}\nAdmission Date: ${patient.admissionDate}`;
    const heightWeightLine =
      patient.heightCm != null || patient.weightKg != null
        ? `\nHeight: ${patient.heightCm != null ? `${patient.heightCm} cm` : 'N/A'} | Weight: ${
            patient.weightKg != null ? `${patient.weightKg} kg` : 'N/A'
          } | BMI: ${patient.bmi != null ? `${patient.bmi} (${bmiCategory(patient.bmi)})` : 'N/A'}`
        : '';
    const pendingLabs = (patient.laboratories || []).filter((l) => l.status === 'pending');
    const activeMeds = (patient.medicationOrders || []).filter((m) => m.isActive);
    const labsAndMedsLine =
      pendingLabs.length > 0 || activeMeds.length > 0
        ? `\n\nPending Labs: ${
            pendingLabs.length > 0 ? pendingLabs.map((l) => l.testName).join(', ') : 'None'
          }\nActive Medications: ${
            activeMeds.length > 0
              ? activeMeds
                  .map(
                    (m) =>
                      `${m.medicationName} ${m.dose} ${m.route} ${m.frequency}${
                        m.lastGiven ? ` (last given ${new Date(m.lastGiven).toLocaleString()})` : ' (not yet given)'
                      }`
                  )
                  .join('; ')
              : 'None'
          }`
        : '';
    const assessment = `Vital Signs:\n- Heart Rate: ${patient.vitalSigns.heartRate} bpm\n- Blood Pressure: ${patient.vitalSigns.bloodPressure}\n- Temperature: ${patient.vitalSigns.temperature}°C\n- Oxygen Saturation: ${patient.vitalSigns.oxygenSaturation}%\n- Respiratory Rate: ${patient.vitalSigns.respiratoryRate}/min${heightWeightLine}${labsAndMedsLine}\n\nAlerts: ${patient.alerts.join('; ')}`;

    setFormData((prev) => ({ ...prev, situation, background, assessment, attendingPhysician: patient.attendingPhysician || '' }));
  }, [selectedPatientIds, patients]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (selectedPatientIds.length === 0) newErrors.patient = 'Select at least one patient';
    if (!selectedNurseId) newErrors.nurse = 'Please select a receiving nurse';
    if (!formData.recommendation.trim()) newErrors.recommendation = 'Recommendation is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave({
        patientIds: selectedPatientIds,
        patientNotes,
        nurseTo: formData.nurseTo,
        nurseToId: selectedNurseId,
        sbar: {
          situation: formData.situation,
          background: formData.background,
          assessment: formData.assessment,
          recommendation: formData.recommendation,
        },
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving endorsement:', error);
      // Every create-time rule (ownership, already-pending, active receiver,
      // self-endorsement) is re-checked server-side — never trust this
      // form's own state alone, since the roster/assignments may have moved
      // since it was fetched. Map the field the backend rejected onto the
      // matching form field instead of a generic failure toast.
      if (error instanceof ApiError && error.data && typeof error.data === 'object') {
        const data = error.data as Record<string, unknown>;
        const messageFor = (field: string): string => {
          const value = data[field];
          if (Array.isArray(value) && value.length) return String(value[0]);
          if (typeof value === 'string') return value;
          return '';
        };
        const nurseToIdMessage = messageFor('nurseToId');
        const patientIdsMessage = messageFor('patientIds');
        const nonFieldMessage = messageFor('nonFieldErrors');
        setErrors((prev) => ({
          ...prev,
          ...(nurseToIdMessage ? { nurse: nurseToIdMessage } : {}),
          ...(patientIdsMessage ? { patient: patientIdsMessage } : {}),
          ...(nonFieldMessage
            ? { form: nonFieldMessage }
            : nurseToIdMessage || patientIdsMessage
              ? {}
              : { form: error.message }),
        }));
      } else {
        setErrors((prev) => ({ ...prev, form: 'Failed to save the endorsement. Please try again.' }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !loading && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <FileText size={20} color={Colors.primary} />
            <Text style={styles.title}>New Endorsement</Text>
          </View>
          <Text style={styles.description}>
            Hand over one or more of your patients to another nurse, on any shift or department.
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              <Alert variant="info" style={styles.demoNotice}>
                <AlertDescription>
                  Demo system: don&apos;t enter real patient information.
                </AlertDescription>
              </Alert>

              <Text style={styles.label}>Patients *</Text>
              <Pressable
                onPress={openPatientPicker}
                style={[styles.trigger, errors.patient ? styles.triggerError : null]}
              >
                {selectedPatientIds.length === 0 ? (
                  <Text style={[styles.triggerText, styles.placeholder]} numberOfLines={1}>
                    Select patients...
                  </Text>
                ) : selectedPatientIds.length > 3 ? (
                  <Text style={styles.triggerText} numberOfLines={1}>
                    {selectedPatientIds.length} patients selected
                  </Text>
                ) : (
                  <View style={styles.chipsWrap}>
                    {selectedPatientIds.map((id) => {
                      const patient = patients.find((p) => p.id === id);
                      if (!patient) return null;
                      return (
                        <View key={id} style={styles.selectedChip}>
                          <Text style={styles.selectedChipText} numberOfLines={1}>
                            {patient.name} • {patient.room}
                          </Text>
                          <Pressable
                            onPress={() => removeSelectedPatient(id)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${patient.name}`}
                          >
                            <X size={13} color={Colors.mutedForeground} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
                <ChevronDown size={16} color={Colors.mutedForeground} />
              </Pressable>
              {errors.patient ? <Text style={styles.error}>{errors.patient}</Text> : null}

              <SearchablePicker<EndorsablePatient>
                visible={patientSheetOpen}
                onClose={() => setPatientSheetOpen(false)}
                title="Select Patients"
                searchPlaceholder="Search by name, room, or diagnosis..."
                searchQuery={patientSearch}
                onSearchChange={setPatientSearch}
                groups={patientGroups}
                keyExtractor={(p) => p.id}
                isSelected={(p) => draftPatientIds.includes(p.id)}
                isDisabled={(p) => p.pendingEndorsement && !draftPatientIds.includes(p.id)}
                onToggle={toggleDraftPatient}
                multiSelect
                selectedCount={draftPatientIds.length}
                onSelectAll={selectAllFilteredPatients}
                onClearSelection={clearDraftPatients}
                onDone={confirmPatientSelection}
                emptyMessage={
                  patients.length === 0
                    ? 'You have no assigned patients to endorse.'
                    : 'No patients match your search.'
                }
                renderContent={(patient, selected, disabled) => (
                  <>
                    {selected ? (
                      <CheckSquare size={18} color={Colors.primary} />
                    ) : (
                      <Square size={18} color={disabled ? Colors.gray300 : Colors.gray400} />
                    )}
                    <View style={styles.patientInfo}>
                      <Text style={styles.patientName}>{patient.name} • {patient.room}</Text>
                      <Text style={styles.patientMeta}>{patient.diagnosis}</Text>
                    </View>
                    {disabled ? <Text style={styles.pendingBadge}>Pending endorsement</Text> : null}
                  </>
                )}
              />

              {selectedPatientIds.length > 1 ? (
                <View style={styles.patientNotesBox}>
                  <Text style={styles.label}>Per-patient notes (optional)</Text>
                  {selectedPatientIds.map((id) => {
                    const patient = patients.find((p) => p.id === id);
                    if (!patient) return null;
                    return (
                      <View key={id} style={styles.patientNoteRow}>
                        <Text style={styles.patientNoteLabel}>{patient.name}</Text>
                        <TextInput
                          style={styles.patientNoteInput}
                          placeholder="e.g. watch sats, NPO after midnight..."
                          placeholderTextColor={Colors.mutedForeground}
                          value={patientNotes[id] || ''}
                          onChangeText={(text) => setPatientNotes((prev) => ({ ...prev, [id]: text }))}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : selectedPatientIds.length === 1 && formData.attendingPhysician ? (
                <View style={styles.physicianBox}>
                  <View style={styles.labelRow}>
                    <User size={16} color={Colors.blue600} />
                    <Text style={styles.physicianLabel}>Attending Physician</Text>
                  </View>
                  <Text style={styles.physicianValue}>{formData.attendingPhysician}</Text>
                </View>
              ) : null}

              {errors.form ? (
                <Alert variant="destructive">
                  <AlertDescription>{errors.form}</AlertDescription>
                </Alert>
              ) : null}

              {groupsError ? (
                <Alert variant="destructive">
                  <AlertDescription>{groupsError}</AlertDescription>
                  <Pressable onPress={loadReceivers} style={styles.retryBtn} accessibilityRole="button">
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </Pressable>
                </Alert>
              ) : null}

              <Text style={styles.label}>Receiving Nurse *</Text>
              <Pressable
                onPress={openNursePicker}
                style={[styles.trigger, errors.nurse ? styles.triggerError : null]}
              >
                <Text style={[styles.triggerText, !selectedNurse && styles.placeholder]} numberOfLines={1}>
                  {selectedNurse
                    ? `${selectedNurse.fullName}${selectedNurse.department.name ? ` • ${selectedNurse.department.name}` : ''}`
                    : groupsLoading
                      ? 'Loading nurses...'
                      : 'Choose a nurse — any shift, any department'}
                </Text>
                <ChevronDown size={16} color={Colors.mutedForeground} />
              </Pressable>
              {errors.nurse ? <Text style={styles.error}>{errors.nurse}</Text> : null}

              <SearchablePicker<EligibleReceiver>
                visible={nurseSheetOpen}
                onClose={() => setNurseSheetOpen(false)}
                title="Receiving Nurse"
                searchPlaceholder="Search by name or department..."
                searchQuery={nurseSearch}
                onSearchChange={setNurseSearch}
                chips={nurseChips}
                activeChipKey={nurseShiftChip}
                onChipChange={setNurseShiftChip}
                groups={nurseGroups}
                keyExtractor={(n) => n.id}
                isSelected={(n) => n.id === selectedNurseId}
                isDisabled={() => false}
                onToggle={handlePickNurse}
                emptyMessage="No nurses found for this shift."
                onClearFilters={() => {
                  setNurseSearch('');
                  setNurseShiftChip('all');
                }}
                renderContent={(nurse, selected) => (
                  <View style={styles.nurseRowContent}>
                    <View style={styles.flex1}>
                      <Text style={[styles.patientName, selected && styles.optionTextSelected]}>
                        {nurse.fullName}
                      </Text>
                      <Text style={styles.patientMeta}>{nurse.department.name || 'No department'}</Text>
                    </View>
                    {nurseShiftChip === 'all' ? (
                      <View style={styles.shiftBadge}>
                        <Text style={styles.shiftBadgeText}>
                          {SHIFT_GROUP_LABELS[nurse.shift] || nurse.shift}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              />

              <View style={styles.sbarSection}>
                <Text style={styles.sbarTitle}>SBAR Report</Text>

                {selectedPatientIds.length === 0 ? (
                  <View style={styles.emptySbar}>
                    <Text style={styles.emptySbarText}>Select at least one patient above.</Text>
                  </View>
                ) : (
                  <View style={styles.sbarFields}>
                    {selectedPatientIds.length === 1 ? (
                      <>
                        <SbarField
                          badge="S" badgeBg={Colors.blue100} badgeColor={Colors.blue700}
                          label="Situation" hint="(Auto-filled)" value={formData.situation} readOnly
                        />
                        <SbarField
                          badge="B" badgeBg={Colors.green100} badgeColor={Colors.green700}
                          label="Background" hint="(Auto-filled)" value={formData.background} readOnly minHeight={100}
                        />
                        <SbarField
                          badge="A" badgeBg={Colors.yellow100} badgeColor={Colors.orange700}
                          label="Assessment" hint="(Auto-filled)" value={formData.assessment} readOnly minHeight={120}
                        />
                      </>
                    ) : null}

                    <View style={styles.recommendationBox}>
                      <View style={styles.labelRow}>
                        <View style={[styles.badge, { backgroundColor: Colors.purple100 }]}>
                          <Text style={[styles.badgeText, { color: Colors.purple700 }]}>R</Text>
                        </View>
                        <Text style={styles.label}>Recommendation *</Text>
                        <Text style={styles.recHint}>(Enter your recommendations)</Text>
                      </View>
                      <TextInput
                        style={[styles.textarea, styles.recInput, errors.recommendation ? styles.inputError : null]}
                        placeholder="What needs to be done for these patients? (e.g., pending tasks, follow-ups, special care)"
                        placeholderTextColor={Colors.mutedForeground}
                        value={formData.recommendation}
                        onChangeText={(recommendation) => setFormData({ ...formData, recommendation })}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                      />
                      {errors.recommendation ? <Text style={styles.error}>{errors.recommendation}</Text> : null}
                    </View>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={loading} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSubmit} disabled={loading} loading={loading} style={{ flex: 1 }}>
              {loading ? 'Submitting...' : 'Submit Endorsement'}
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
    marginBottom: 12,
  },
  scroll: {
    maxHeight: 480,
  },
  form: {
    gap: 14,
  },
  demoNotice: {
    marginBottom: 0,
  },
  flex1: {
    flex: 1,
  },
  trigger: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
    gap: 8,
  },
  triggerError: {
    borderColor: Colors.destructive,
  },
  triggerText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
  },
  placeholder: {
    color: Colors.mutedForeground,
  },
  chipsWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.blue100,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 200,
  },
  selectedChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.blue700,
    flexShrink: 1,
  },
  nurseRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionTextSelected: {
    color: Colors.primary,
  },
  shiftBadge: {
    backgroundColor: Colors.gray100,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  shiftBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.mutedForeground,
  },
  patientInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  patientMeta: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  pendingBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.orange700,
    backgroundColor: Colors.yellow100,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  patientNotesBox: {
    gap: 8,
  },
  patientNoteRow: {
    gap: 4,
  },
  patientNoteLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.foreground,
  },
  patientNoteInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.foreground,
  },
  physicianBox: {
    backgroundColor: Colors.blue100,
    borderRadius: Radius.md,
    padding: 10,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  physicianLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.blue700,
  },
  physicianValue: {
    fontSize: 13,
    color: Colors.foreground,
  },
  retryBtn: {
    marginTop: 6,
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.blue700,
  },
  sbarSection: {
    gap: 10,
  },
  sbarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
  },
  emptySbar: {
    padding: 16,
    alignItems: 'center',
  },
  emptySbarText: {
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  sbarFields: {
    gap: 12,
  },
  field: {
    gap: 4,
  },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
  },
  hintInline: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  recHint: {
    fontSize: 11,
    color: Colors.mutedForeground,
  },
  textarea: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.foreground,
    minHeight: 80,
  },
  readOnly: {
    backgroundColor: Colors.gray100 || '#f5f5f5',
  },
  recommendationBox: {
    gap: 4,
  },
  recInput: {
    minHeight: 90,
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
    gap: 10,
    marginTop: 14,
  },
});
