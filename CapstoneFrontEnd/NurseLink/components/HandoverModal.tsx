import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import { FileText, User, X, ChevronDown, Plus, Trash2 } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Select } from './Select';
import { TimePicker } from './TimePicker';
import { DatePicker, todayIso } from './DatePicker';
import { Alert, AlertDescription } from './Alert';
import { SearchablePicker, PickerChip, PickerGroup } from './SearchablePicker';
import type {
  EligibleReceiver,
  EligibleReceiverGroup,
  EndorsablePatient,
  EndorsementTaskInput,
  HandoverNote,
} from '../types/domain';
import { fetchMyEndorsablePatients, fetchEligibleReceivers, ApiError } from '../services/api';
import { bmiCategory } from '../utils/bmi';

interface HandoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (handover: Partial<HandoverNote>) => Promise<void>;
}

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' },
];

/** One Unfinished Tasks row in the form — a local draft id (never sent;
 * the backend assigns the real one) plus the fields the backend accepts.
 * A row left with a blank description is dropped on submit rather than
 * blocking it — see handleSubmit's `tasks` filter. */
interface TaskDraft {
  draftId: string;
  description: string;
  dueTime: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

let taskDraftSeq = 0;
function newTaskDraft(): TaskDraft {
  taskDraftSeq += 1;
  return { draftId: `t${taskDraftSeq}`, description: '', dueTime: '', priority: 'MEDIUM' };
}

/**
 * DRF field errors ({"field_name": ["msg"]} or {"field_name": "msg"}) ->
 * {uiKey: message}, so each error lands under the input it's actually
 * about instead of a generic banner. Unmapped field names still show
 * somewhere (prefixed with a readable label) rather than being silently
 * dropped; only nonFieldErrors/detail go to the plain top banner.
 */
const API_FIELD_TO_UI_KEY: Record<string, string> = {
  nurseToId: 'nurse',
  patientIds: 'patient',
  recommendation: 'recommendation',
};
const API_FIELD_LABELS: Record<string, string> = {
  nurseToId: 'Receiving nurse',
  patientIds: 'Patient',
  recommendation: 'Recommendation',
};

function mapApiErrors(data: Record<string, unknown>): Record<string, string> {
  const messageFor = (value: unknown): string => {
    if (Array.isArray(value) && value.length) return String(value[0]);
    if (typeof value === 'string') return value;
    return '';
  };
  const mapped: Record<string, string> = {};
  const bannerParts: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    const message = messageFor(value);
    if (!message) continue;
    if (field === 'nonFieldErrors' || field === 'non_field_errors' || field === 'detail') {
      bannerParts.push(message);
      continue;
    }
    const uiKey = API_FIELD_TO_UI_KEY[field];
    if (uiKey) {
      mapped[uiKey] = message;
    } else {
      bannerParts.push(`${API_FIELD_LABELS[field] || field}: ${message}`);
    }
  }
  if (bannerParts.length) mapped.form = bannerParts.join(' ');
  return mapped;
}

// A nurse with no real duty right now cannot be picked as a receiver at
// all (see api/views.py::HandoverViewSet.eligible_receivers and the
// matching check in HandoverSerializer.create()), so there is no
// "Unassigned" shift here — only the three real shifts.
const SHIFT_GROUP_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  night: 'Night',
};

const SHIFT_CHIP_ORDER = ['morning', 'afternoon', 'night'];

export function HandoverModal({ open, onOpenChange, onSave }: HandoverModalProps) {
  const [loading, setLoading] = useState(false);
  // A fast double-click/double-tap can both fire before React re-renders
  // with the Submit button's disabled={loading} applied — setLoading(true)
  // is a state update, not synchronous. This ref is set/checked
  // synchronously as the very first thing in handleSubmit, so a second call
  // re-entering before the first has even set state is still blocked.
  const submittingRef = useRef(false);
  const [patients, setPatients] = useState<EndorsablePatient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedNurseId, setSelectedNurseId] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [dueTime, setDueTime] = useState('');
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
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

  // Patient picker — single-select, so (unlike the nurse picker, which also
  // closes immediately on pick) there is no draft/Done step to worry about.
  const [patientSheetOpen, setPatientSheetOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');

  useEffect(() => {
    if (!open) {
      submittingRef.current = false;
      setSelectedPatientId('');
      setSelectedNurseId('');
      setDueDate(todayIso());
      setDueTime('');
      setTasks([]);
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

  // Patient picker — single-select: picking one replaces the current
  // selection and closes the sheet immediately, same as the nurse picker.
  const openPatientPicker = () => {
    setPatientSearch('');
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

  const selectedPatient = patients.find((p) => p.id === selectedPatientId);

  const handlePickPatient = (patient: EndorsablePatient) => {
    setSelectedPatientId(patient.id);
  };

  const clearSelectedPatient = () => setSelectedPatientId('');

  // Auto-fill SBAR from the selected patient — blank/manual when none is
  // selected yet.
  useEffect(() => {
    const patient = selectedPatient;
    if (!patient) {
      setFormData((prev) => ({ ...prev, situation: '', background: '', assessment: '', attendingPhysician: '' }));
      return;
    }
    const situation = `${patient.name} is a ${patient.age}-year-old ${patient.gender.toLowerCase()} admitted on ${patient.admissionDate} with ${patient.diagnosis}. Currently in ${patient.room}. Risk level: ${patient.riskLevel}.`;
    // Current Medications now pulls from the structured, active
    // KardexMedication orders (status === 'ACTIVE') rather than the old
    // free-text Patient.medications list — that field still exists (old
    // records keep showing whatever was typed there) but no longer feeds
    // this line; see api/models.py's KardexMedication docstring.
    const activeMeds = (patient.medicationOrders || []).filter((m) => m.status === 'ACTIVE');
    const currentMedsText =
      activeMeds.length > 0
        ? activeMeds
            .map(
              (m) =>
                `${m.medicationName} ${m.dose} ${m.route} ${m.frequency}${
                  m.lastGiven ? ` (last given ${new Date(m.lastGiven).toLocaleString()})` : ' (not yet given)'
                }`
            )
            .join('; ')
        : 'None known';
    const background = `Diagnosis: ${patient.diagnosis}\nAllergies: ${patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'}\nCurrent Medications: ${currentMedsText}\nAdmission Date: ${patient.admissionDate}`;
    const heightWeightLine =
      patient.heightCm != null || patient.weightKg != null
        ? `\nHeight: ${patient.heightCm != null ? `${patient.heightCm} cm` : 'N/A'} | Weight: ${
            patient.weightKg != null ? `${patient.weightKg} kg` : 'N/A'
          } | BMI: ${patient.bmi != null ? `${patient.bmi} (${bmiCategory(patient.bmi)})` : 'N/A'}`
        : '';
    const pendingLabs = (patient.laboratories || []).filter((l) => l.status === 'pending');
    const labsLine =
      pendingLabs.length > 0 ? `\n\nPending Labs: ${pendingLabs.map((l) => l.testName).join(', ')}` : '';
    const assessment = `Vital Signs:\n- Heart Rate: ${patient.vitalSigns.heartRate} bpm\n- Blood Pressure: ${patient.vitalSigns.bloodPressure}\n- Temperature: ${patient.vitalSigns.temperature}°C\n- Oxygen Saturation: ${patient.vitalSigns.oxygenSaturation}%\n- Respiratory Rate: ${patient.vitalSigns.respiratoryRate}/min${heightWeightLine}${labsLine}\n\nAlerts: ${patient.alerts.join('; ')}`;

    // Pending/scheduled department visits seed the Recommendation field —
    // only while it's still blank, so this never overwrites what the
    // nurse has already typed (Recommendation is the one SBAR field they
    // own, unlike the auto-filled/read-only ones above).
    const pendingVisits = (patient.departmentVisits || []).filter(
      (v) => v.status === 'PENDING' || v.status === 'SCHEDULED'
    );
    const pendingVisitsLine =
      pendingVisits.length > 0
        ? `Pending: ${pendingVisits
            .map((v) => `${v.departmentName} – ${v.purpose} (${v.priority})`)
            .join('; ')}`
        : '';

    setFormData((prev) => ({
      ...prev,
      situation,
      background,
      assessment,
      attendingPhysician: patient.attendingPhysician || '',
      recommendation: prev.recommendation.trim() ? prev.recommendation : pendingVisitsLine,
    }));
  }, [selectedPatient]);

  // Added/removed via the Unfinished Tasks section below; never blocks
  // submit — a row left with a blank description is just dropped (see
  // handleSubmit's `tasks` filter), not a validation error.
  const addTaskRow = () => setTasks((prev) => [...prev, newTaskDraft()]);
  const removeTaskRow = (draftId: string) =>
    setTasks((prev) => prev.filter((t) => t.draftId !== draftId));
  const updateTaskRow = (draftId: string, patch: Partial<TaskDraft>) =>
    setTasks((prev) => prev.map((t) => (t.draftId === draftId ? { ...t, ...patch } : t)));

  /** "YYYY-MM-DD" + "HH:MM" (local, 24h) -> a real Date, or null if either
   * piece is missing/unparseable — same combine-and-validate convention
   * tasks.tsx's isTaskOverdue already uses for Task.dueDate/dueTime. */
  const dueAtDate = (): Date | null => {
    if (!dueDate || !dueTime) return null;
    const [y, m, d] = dueDate.split('-').map(Number);
    const [h, min] = dueTime.split(':').map(Number);
    if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(min)) return null;
    return new Date(y, m - 1, d, h, min);
  };

  /** True when the chosen date + time is now or already past. */
  const isPastSchedule = (date: string, time: string): boolean => {
    if (!date || !time) return false;
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(min)) return false;
    return new Date(y, m - 1, d, h, min).getTime() <= Date.now();
  };

  const PAST_SCHEDULE_MESSAGE = 'This time has already passed. Choose a later time today or a future date.';

  // Date and time are validated together: moving the date back to today
  // clears a time that is now in the past instead of leaving it invalid.
  const handleDueDateChange = (date: string) => {
    setDueDate(date);
    if (dueTime && isPastSchedule(date, dueTime)) {
      setDueTime('');
      setErrors((prev) => ({ ...prev, dueDate: '', dueTime: PAST_SCHEDULE_MESSAGE }));
    } else {
      setErrors((prev) => ({ ...prev, dueDate: '', dueTime: '' }));
    }
  };

  const handleDueTimeChange = (time: string) => {
    setDueTime(time);
    setErrors((prev) => ({ ...prev, dueTime: isPastSchedule(dueDate, time) ? PAST_SCHEDULE_MESSAGE : '' }));
  };

  // On today's date, times before now (rounded up to the picker's 5-minute
  // step) can't be picked at all.
  const minDueTime = (() => {
    if (dueDate !== todayIso()) return undefined;
    const now = new Date();
    const minutes = Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 5) * 5, 23 * 60 + 55);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  })();

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!selectedPatientId) newErrors.patient = 'Select a patient';
    if (!selectedNurseId) newErrors.nurse = 'Please select a receiving nurse';
    if (!dueDate) newErrors.dueDate = 'Due date is required';
    if (!dueTime) newErrors.dueTime = 'Due time is required';
    const due = dueAtDate();
    if (dueDate && dueDate < todayIso()) {
      newErrors.dueDate = 'Due date cannot be in the past';
    }
    if (dueDate && dueTime && due && due.getTime() <= Date.now()) {
      newErrors.dueTime = PAST_SCHEDULE_MESSAGE;
    }
    if (!formData.recommendation.trim()) newErrors.recommendation = 'Recommendation is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!validateForm()) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      const taskPayload: EndorsementTaskInput[] = tasks
        .filter((t) => t.description.trim())
        .map((t) => ({
          description: t.description.trim(),
          ...(t.dueTime ? { due_time: t.dueTime } : {}),
          priority: t.priority,
        }));
      const due = dueAtDate();
      await onSave({
        patientIds: [selectedPatientId],
        nurseTo: formData.nurseTo,
        nurseToId: selectedNurseId,
        dueAt: due ? due.toISOString() : undefined,
        tasks: taskPayload,
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
      // since it was fetched. mapApiErrors puts each field error under its
      // matching input; only a real non-field error reaches the banner.
      if (error instanceof ApiError && error.data && typeof error.data === 'object') {
        setErrors((prev) => ({ ...prev, ...mapApiErrors(error.data as Record<string, unknown>) }));
      } else {
        setErrors((prev) => ({ ...prev, form: 'Failed to save the endorsement. Please try again.' }));
      }
    } finally {
      submittingRef.current = false;
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

              <Text style={styles.label}>Patient *</Text>
              <Pressable
                onPress={openPatientPicker}
                style={[styles.trigger, errors.patient ? styles.triggerError : null]}
              >
                {selectedPatient ? (
                  <View style={styles.chipsWrap}>
                    <View style={styles.selectedChip}>
                      <Text style={styles.selectedChipText} numberOfLines={1}>
                        {selectedPatient.name} • {selectedPatient.room}
                      </Text>
                      <Pressable
                        onPress={clearSelectedPatient}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${selectedPatient.name}`}
                      >
                        <X size={13} color={Colors.mutedForeground} />
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.triggerText, styles.placeholder]} numberOfLines={1}>
                    Select patient...
                  </Text>
                )}
                <ChevronDown size={16} color={Colors.mutedForeground} />
              </Pressable>
              {errors.patient ? <Text style={styles.error}>{errors.patient}</Text> : null}

              <SearchablePicker<EndorsablePatient>
                visible={patientSheetOpen}
                onClose={() => setPatientSheetOpen(false)}
                title="Select Patient"
                searchPlaceholder="Search by name, room, or diagnosis..."
                searchQuery={patientSearch}
                onSearchChange={setPatientSearch}
                groups={patientGroups}
                keyExtractor={(p) => p.id}
                isSelected={(p) => p.id === selectedPatientId}
                isDisabled={(p) => p.pendingEndorsement && p.id !== selectedPatientId}
                onToggle={handlePickPatient}
                emptyMessage={
                  patients.length === 0
                    ? 'You have no assigned patients to endorse.'
                    : 'No patients match your search.'
                }
                renderContent={(patient, selected, disabled) => (
                  <>
                    <View style={styles.patientInfo}>
                      <Text style={[styles.patientName, selected && styles.optionTextSelected]}>
                        {patient.name} • {patient.room}
                      </Text>
                      <Text style={styles.patientMeta}>{patient.diagnosis}</Text>
                    </View>
                    {disabled ? <Text style={styles.pendingBadge}>Pending endorsement</Text> : null}
                  </>
                )}
              />

              {selectedPatient && formData.attendingPhysician ? (
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

              <View style={styles.row}>
                <DatePicker
                  style={{ flex: 1 }}
                  label="Due Date *"
                  value={dueDate}
                  onChange={handleDueDateChange}
                  minDate={todayIso()}
                  error={errors.dueDate}
                />
                <TimePicker
                  style={{ flex: 1 }}
                  label="Due Time *"
                  value={dueTime}
                  onChange={handleDueTimeChange}
                  minTime={minDueTime}
                  error={errors.dueTime}
                  helperText="Now or later — past times can't be chosen"
                />
              </View>

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

                {!selectedPatient ? (
                  <View style={styles.emptySbar}>
                    <Text style={styles.emptySbarText}>Select at least one patient above.</Text>
                  </View>
                ) : (
                  <View style={styles.sbarFields}>
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

                    <View style={styles.recommendationBox}>
                      <View style={styles.labelRow}>
                        <View style={[styles.badge, { backgroundColor: Colors.blue100 }]}>
                          <Text style={[styles.badgeText, { color: Colors.blue700 }]}>R</Text>
                        </View>
                        <Text style={styles.label}>Recommendation *</Text>
                        <Text style={styles.recHint}>(Enter your recommendations)</Text>
                      </View>
                      <TextInput
                        style={[styles.textarea, styles.recInput, errors.recommendation ? styles.inputError : null]}
                        placeholder="What needs to be done for this patient? (e.g., pending tasks, follow-ups, special care)"
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

              <View style={styles.tasksSection}>
                <View style={styles.tasksHeaderRow}>
                  <Text style={styles.sbarTitle}>Unfinished Tasks</Text>
                  <Button variant="outline" size="sm" onPress={addTaskRow} style={styles.addTaskBtn}>
                    <Plus size={14} color={Colors.blue700} />
                    <Text style={styles.addTaskText}>Add Task</Text>
                  </Button>
                </View>

                {tasks.length === 0 ? (
                  <Text style={styles.emptySbarText}>No unfinished tasks. Tap + Add Task to add one.</Text>
                ) : (
                  <View style={styles.tasksList}>
                    {tasks.map((task) => (
                      <View key={task.draftId} style={styles.taskRow}>
                        <View style={styles.taskRowTop}>
                          <TextInput
                            style={[styles.textarea, styles.taskDescInput]}
                            placeholder="Task description"
                            placeholderTextColor={Colors.mutedForeground}
                            value={task.description}
                            onChangeText={(description) => updateTaskRow(task.draftId, { description })}
                          />
                          <Pressable
                            onPress={() => removeTaskRow(task.draftId)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Remove task"
                            style={styles.taskRemoveBtn}
                          >
                            <Trash2 size={16} color={Colors.red600} />
                          </Pressable>
                        </View>
                        {!task.description.trim() ? (
                          <Text style={styles.error}>Task description is required</Text>
                        ) : null}
                        <View style={styles.taskRowBottom}>
                          <TimePicker
                            value={task.dueTime}
                            onChange={(dueTime) => updateTaskRow(task.draftId, { dueTime })}
                            placeholder="Due time (optional)"
                            style={styles.taskTimePicker}
                          />
                          <Select
                            value={task.priority}
                            onValueChange={(priority) =>
                              updateTaskRow(task.draftId, { priority: priority as TaskDraft['priority'] })
                            }
                            options={PRIORITY_OPTIONS}
                            style={styles.taskPrioritySelect}
                          />
                        </View>
                      </View>
                    ))}
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
  row: {
    flexDirection: 'row',
    gap: 12,
  },
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
  tasksSection: {
    gap: 10,
  },
  tasksHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addTaskText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.blue700,
  },
  tasksList: {
    gap: 12,
  },
  taskRow: {
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
  },
  taskRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskDescInput: {
    flex: 1,
    minHeight: 40,
  },
  taskRemoveBtn: {
    padding: 6,
  },
  taskRowBottom: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskTimePicker: {
    flex: 1,
    minWidth: 140,
  },
  taskPrioritySelect: {
    flex: 1,
    minWidth: 120,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
});
