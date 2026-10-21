import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  ViewStyle,
} from 'react-native';
import {
  HeartPulse,
  Clock,
  Check,
  X,
  Pencil,
  Activity,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { TimePicker } from './TimePicker';
import { ConfirmDialog } from './ConfirmDialog';
import { fetchVitalReadings, createVitalSigns, updateVitalSigns, ApiError } from '../services/api';
import type { AdminVitalReading } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

// Accepts "8:00 AM", "08:00 am", "12:30 PM" — the same light-touch,
// free-text time convention Task.dueTime already uses elsewhere in this
// app, rather than a native picker dependency this project doesn't have.
// Only used by the edit-an-existing-reading flow below — a new reading
// always records at the actual moment it's saved.
const TIME_PATTERN = /^(0?[1-9]|1[0-2]):([0-5]\d)\s?([AaPp][Mm])$/;

interface TaskVitalSignsBarsProps {
  taskId: string;
  patientId: string;
  onReadingsChange?: (count: number) => void;
}

const emptyReadingForm = () => ({
  temperature: '',
  pulseRate: '',
  respiratoryRate: '',
  systolic: '',
  diastolic: '',
  oxygenSaturation: '',
  oxygenUse: '' as '' | 'yes' | 'no',
  painScale: '',
});

// Same clinical thresholds VitalSignsGrid already flags elsewhere in the
// app (Kardex, PatientKardexModal) — kept in sync deliberately so a value
// doesn't read as "normal" here and "abnormal" there. Pain has no shared
// precedent to match, so 7+/10 (commonly treated as severe pain) is this
// form's own call.
function isAbnormal(field: string, value: string): boolean {
  const n = parseFloat(value);
  if (value.trim() === '' || Number.isNaN(n)) return false;
  switch (field) {
    case 'temperature':
      return n < 36.1 || n > 37.5;
    case 'pulseRate':
      return n < 60 || n > 100;
    case 'respiratoryRate':
      return n < 12 || n > 20;
    case 'systolic':
      return n < 90 || n > 140;
    case 'diastolic':
      return n < 60 || n > 90;
    case 'oxygenSaturation':
      return n < 95;
    case 'painScale':
      return n >= 7;
    default:
      return false;
  }
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The reverse of TimePicker's own output — an ISO timestamp back to the
 * "8:05 PM" form the picker (and TIME_PATTERN) expects, so editing a
 * saved reading's time starts from its actual value instead of blank. */
function isoToTimePickerValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const isPm = hours >= 12;
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`;
}

/** "8:05 PM" -> today's date at that time, as an ISO string. Returns null
 * for anything that doesn't match TIME_PATTERN. Only used when editing an
 * existing reading's recorded time. */
function buildRecordedAtIso(timeText: string): string | null {
  const match = TIME_PATTERN.exec(timeText.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const isPm = match[3].toLowerCase() === 'pm';
  if (hours === 12) hours = 0;
  if (isPm) hours += 12;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

/** Parses a vital-sign field to a finite number, or returns 'invalid' so the
 * caller can tell "left blank" apart from "typed something non-numeric". */
function parseOptionalNumber(text: string): number | undefined | 'invalid' {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : 'invalid';
}

/** One labeled value box: the field name (same uppercase/muted label style
 * as Kardex's VitalSignsGrid, not a separate "VITAL SIGN" header — a field
 * already says what it is), a bordered value area, and a normal-range hint
 * — border/text turn orange the moment the typed value reads as abnormal,
 * live as the nurse types. */
function VitalSignRow({
  label,
  hint,
  abnormal,
  children,
}: {
  label: string;
  hint: string;
  abnormal: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.vsRow, abnormal && styles.vsRowAbnormal]}>
      <Text style={styles.vsRowLabel}>{label}</Text>
      {children}
      <Text style={[styles.vsRowHint, abnormal && styles.vsRowHintAbnormal]}>{hint}</Text>
    </View>
  );
}

function VitalValueInput({
  value,
  onChangeText,
  unit,
  abnormal,
  placeholder,
  center,
}: {
  value: string;
  onChangeText: (v: string) => void;
  unit?: string;
  abnormal: boolean;
  placeholder: string;
  /** Blood Pressure's two boxes have no trailing unit competing for space,
   * so their value can sit centered like the reference design — the other
   * fields keep their value left-aligned next to a trailing unit. */
  center?: boolean;
}) {
  return (
    <View style={styles.vsValueRow}>
      <TextInput
        style={[
          styles.vsValueInput,
          center && styles.vsValueInputCentered,
          abnormal && styles.vsValueInputAbnormal,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.gray400}
        keyboardType="decimal-pad"
      />
      {unit ? <Text style={styles.vsUnit}>{unit}</Text> : null}
    </View>
  );
}

const STATUS_DOTS: { key: string; label: string }[] = [
  { key: 'systolic', label: 'SBP' },
  { key: 'diastolic', label: 'DBP' },
  { key: 'pulseRate', label: 'HR' },
  { key: 'respiratoryRate', label: 'RR' },
  { key: 'oxygenSaturation', label: 'SpO2' },
  { key: 'painScale', label: 'Pain' },
];

export function TaskVitalSignsBars({ taskId, patientId, onReadingsChange }: TaskVitalSignsBarsProps) {
  const toast = useToast();
  const [readings, setReadings] = useState<AdminVitalReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [form, setForm] = useState(emptyReadingForm());
  const [saving, setSaving] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  // "Are you sure?" gate before a new reading is actually persisted.
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  // Editing a previously saved reading (the recorded entry, or a Monitoring
  // History row) — opens a modal pre-filled from that reading.
  const [editingReading, setEditingReading] = useState<AdminVitalReading | null>(null);
  const [editForm, setEditForm] = useState(emptyReadingForm());
  const [editTimeValue, setEditTimeValue] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchVitalReadings({ taskId });
        if (cancelled) return;
        const sorted = [...data].sort(
          (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
        );
        setReadings(sorted);
        onReadingsChange?.(sorted.length);
      } catch {
        // An empty history is fine — this task just hasn't had a reading logged yet.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const openVitalsForm = () => {
    setForm(emptyReadingForm());
    setRecording(true);
  };

  const closeVitalsForm = () => {
    setRecording(false);
    setForm(emptyReadingForm());
  };

  const setField = (
    key: Exclude<keyof ReturnType<typeof emptyReadingForm>, 'oxygenUse'>,
    value: string
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setOxygenUse = (value: 'yes' | 'no') => {
    setForm((prev) => ({ ...prev, oxygenUse: prev.oxygenUse === value ? '' : value }));
  };

  const handleSaveReading = async () => {
    // Every field is required except Pain Level — checked by name first so
    // the error is "fill these in", not the more cryptic "that's not a
    // number" a blank field would otherwise fall through to.
    const missing: string[] = [];
    if (form.temperature.trim() === '') missing.push('Temperature');
    if (form.systolic.trim() === '') missing.push('Systolic BP');
    if (form.diastolic.trim() === '') missing.push('Diastolic BP');
    if (form.pulseRate.trim() === '') missing.push('Heart Rate');
    if (form.respiratoryRate.trim() === '') missing.push('Resp Rate');
    if (form.oxygenSaturation.trim() === '') missing.push('SpO2');
    if (form.oxygenUse === '') missing.push('O2 Use');
    if (missing.length > 0) {
      toast.error('Missing required fields', { description: `Please fill in: ${missing.join(', ')}` });
      return;
    }

    const temperature = parseOptionalNumber(form.temperature);
    const heartRate = parseOptionalNumber(form.pulseRate);
    const respiratoryRate = parseOptionalNumber(form.respiratoryRate);
    const systolic = parseOptionalNumber(form.systolic);
    const diastolic = parseOptionalNumber(form.diastolic);
    const oxygenSaturation = parseOptionalNumber(form.oxygenSaturation);
    const painScale = parseOptionalNumber(form.painScale);
    const invalidField = [
      ['Temperature', temperature],
      ['Heart Rate', heartRate],
      ['Resp Rate', respiratoryRate],
      ['Systolic BP', systolic],
      ['Diastolic BP', diastolic],
      ['SpO2', oxygenSaturation],
      ['Pain Level', painScale],
    ].find(([, v]) => v === 'invalid');
    if (invalidField) {
      toast.error('Invalid value', { description: `${invalidField[0]} must be a number.` });
      return;
    }

    setSaving(true);
    try {
      const created = await createVitalSigns({
        patientId,
        taskId,
        // The actual moment of recording — a single-entry task has no
        // separate "which scheduled slot is this" time to pick in advance.
        recordedAt: new Date().toISOString(),
        temperature: temperature as number,
        heartRate: heartRate as number,
        respiratoryRate: respiratoryRate as number,
        bloodPressure: `${systolic}/${diastolic}`,
        oxygenSaturation: oxygenSaturation as number,
        oxygenUse: form.oxygenUse === 'yes',
        painScale: painScale === 'invalid' ? undefined : painScale,
      });
      const next = [...readings, created];
      setReadings(next);
      onReadingsChange?.(next.length);
      closeVitalsForm();
      toast.success('Vital signs recorded');
    } catch (error) {
      toast.error('Failed to record vital signs', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const openEditReading = (reading: AdminVitalReading) => {
    const [systolic, diastolic] = (reading.bloodPressure || '').split('/');
    setEditForm({
      temperature: reading.temperature != null ? String(reading.temperature) : '',
      pulseRate: reading.heartRate != null ? String(reading.heartRate) : '',
      respiratoryRate: reading.respiratoryRate != null ? String(reading.respiratoryRate) : '',
      systolic: systolic || '',
      diastolic: diastolic || '',
      oxygenSaturation: reading.oxygenSaturation != null ? String(reading.oxygenSaturation) : '',
      oxygenUse: reading.oxygenUse == null ? '' : reading.oxygenUse ? 'yes' : 'no',
      painScale: reading.painScale != null ? String(reading.painScale) : '',
    });
    setEditTimeValue(isoToTimePickerValue(reading.recordedAt));
    setEditingReading(reading);
  };

  const closeEditReading = () => {
    setEditingReading(null);
    setEditForm(emptyReadingForm());
    setEditTimeValue('');
  };

  const setEditField = (
    key: Exclude<keyof ReturnType<typeof emptyReadingForm>, 'oxygenUse'>,
    value: string
  ) => {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  };

  const setEditOxygenUse = (value: 'yes' | 'no') => {
    setEditForm((prev) => ({ ...prev, oxygenUse: prev.oxygenUse === value ? '' : value }));
  };

  const handleSaveEdit = async () => {
    if (!editingReading) return;

    const missing: string[] = [];
    if (editForm.temperature.trim() === '') missing.push('Temperature');
    if (editForm.systolic.trim() === '') missing.push('Systolic BP');
    if (editForm.diastolic.trim() === '') missing.push('Diastolic BP');
    if (editForm.pulseRate.trim() === '') missing.push('Heart Rate');
    if (editForm.respiratoryRate.trim() === '') missing.push('Resp Rate');
    if (editForm.oxygenSaturation.trim() === '') missing.push('SpO2');
    if (editForm.oxygenUse === '') missing.push('O2 Use');
    if (missing.length > 0) {
      toast.error('Missing required fields', { description: `Please fill in: ${missing.join(', ')}` });
      return;
    }

    const recordedAt = buildRecordedAtIso(editTimeValue);
    if (!recordedAt) {
      toast.error('Select a time', { description: 'Choose an hour and minute before saving.' });
      return;
    }

    const temperature = parseOptionalNumber(editForm.temperature);
    const heartRate = parseOptionalNumber(editForm.pulseRate);
    const respiratoryRate = parseOptionalNumber(editForm.respiratoryRate);
    const systolic = parseOptionalNumber(editForm.systolic);
    const diastolic = parseOptionalNumber(editForm.diastolic);
    const oxygenSaturation = parseOptionalNumber(editForm.oxygenSaturation);
    const painScale = parseOptionalNumber(editForm.painScale);
    const invalidField = [
      ['Temperature', temperature],
      ['Heart Rate', heartRate],
      ['Resp Rate', respiratoryRate],
      ['Systolic BP', systolic],
      ['Diastolic BP', diastolic],
      ['SpO2', oxygenSaturation],
      ['Pain Level', painScale],
    ].find(([, v]) => v === 'invalid');
    if (invalidField) {
      toast.error('Invalid value', { description: `${invalidField[0]} must be a number.` });
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await updateVitalSigns(editingReading.id, {
        recordedAt,
        temperature: temperature as number,
        heartRate: heartRate as number,
        respiratoryRate: respiratoryRate as number,
        bloodPressure: `${systolic}/${diastolic}`,
        oxygenSaturation: oxygenSaturation as number,
        oxygenUse: editForm.oxygenUse === 'yes',
        painScale: painScale === 'invalid' ? undefined : painScale,
      });
      setReadings((prev) =>
        [...prev.map((r) => (r.id === updated.id ? updated : r))].sort(
          (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
        )
      );
      closeEditReading();
      toast.success('Vital signs reading updated');
    } catch (error) {
      toast.error('Failed to update vital signs', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={Colors.red600} />
        <Text style={styles.loadingText}>Loading vital signs check-in...</Text>
      </View>
    );
  }

  const reading = readings.length > 0 ? readings[readings.length - 1] : null;
  const newestFirstReadings = [...readings].reverse();

  return (
    <>
    <View style={styles.layout}>
      <View style={styles.mainColumn}>
        <View style={styles.headerRow}>
          <HeartPulse size={15} color={Colors.red600} />
          <Text style={styles.header}>Vital Signs Monitoring</Text>
          <Text style={reading ? styles.statusBadgeDone : styles.statusBadgeNone}>
            {reading ? 'Recorded' : 'Not Recorded'}
          </Text>
        </View>
        {!reading ? (
          <Text style={styles.gateHint}>
            Record the vital signs reading before this task&apos;s checklist can be marked complete.
          </Text>
        ) : (
          <Text style={styles.gateHintMet}>
            Recorded — the checklist step can now be marked complete.
          </Text>
        )}

      <View style={styles.bars}>
        {reading ? (
          <View style={styles.barFilled}>
            <View style={styles.barFilledTopRow}>
              <Pressable onPress={() => openEditReading(reading)} hitSlop={6} style={styles.editReadingBtn}>
                <Pencil size={12} color={Colors.gray500} />
                <Text style={styles.editReadingBtnText}>Edit</Text>
              </Pressable>
            </View>
            <View style={styles.barFilledHeader}>
              <Clock size={13} color={Colors.green700} />
              <Text style={styles.barFilledTime}>
                {formatDate(reading.recordedAt)} · {formatTime(reading.recordedAt)}
              </Text>
              <Text style={styles.statusBadgeDone}>Recorded ✓</Text>
              {reading.recordedByName ? (
                <Text style={styles.barFilledBy}>by {reading.recordedByName}</Text>
              ) : null}
            </View>
            <Text style={styles.barFilledSummary}>
              {reading.temperature != null ? `${reading.temperature}°C` : '—'}
              {' · '}
              {reading.heartRate != null ? `${reading.heartRate}bpm` : '—'}
              {' · '}
              {reading.bloodPressure || '—'}
              {' · '}
              {reading.oxygenSaturation != null ? `${reading.oxygenSaturation}%` : '—'}
            </Text>
            {reading.edited ? <Text style={styles.editedTag}>Edited</Text> : null}
          </View>
        ) : recording ? (
          <View style={[styles.entryPanel, Shadows.sm]}>
            <View style={styles.statusDotsRow}>
              {STATUS_DOTS.map((dot) => {
                const value = form[dot.key as keyof typeof form] as string;
                const abnormal = isAbnormal(dot.key, value);
                return (
                  <View key={dot.key} style={styles.statusDotItem}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: abnormal ? Colors.orange600 : Colors.green600 },
                      ]}
                    />
                    <Text style={styles.statusDotLabel}>{dot.label}</Text>
                  </View>
                );
              })}
            </View>

            <VitalSignRow
              label="Temperature"
              hint="Normal: 36.1-37.5°C"
              abnormal={isAbnormal('temperature', form.temperature)}
            >
              <VitalValueInput
                value={form.temperature}
                onChangeText={(v) => setField('temperature', v)}
                unit="°C"
                abnormal={isAbnormal('temperature', form.temperature)}
                placeholder="—"
              />
            </VitalSignRow>

            <VitalSignRow
              label="Blood Pressure"
              hint="Normal: 90-140 / 60-90 mmHg"
              abnormal={isAbnormal('systolic', form.systolic) || isAbnormal('diastolic', form.diastolic)}
            >
              <View style={styles.bpRow}>
                <View style={styles.bpBox}>
                  <VitalValueInput
                    value={form.systolic}
                    onChangeText={(v) => setField('systolic', v)}
                    abnormal={isAbnormal('systolic', form.systolic)}
                    placeholder="—"
                    center
                  />
                </View>
                <Text style={styles.bpSlash}>/</Text>
                <View style={styles.bpBox}>
                  <VitalValueInput
                    value={form.diastolic}
                    onChangeText={(v) => setField('diastolic', v)}
                    abnormal={isAbnormal('diastolic', form.diastolic)}
                    placeholder="—"
                    center
                  />
                </View>
              </View>
            </VitalSignRow>

            <VitalSignRow
              label="Heart Rate"
              hint="Normal: 60-100 bpm"
              abnormal={isAbnormal('pulseRate', form.pulseRate)}
            >
              <VitalValueInput
                value={form.pulseRate}
                onChangeText={(v) => setField('pulseRate', v)}
                unit="bpm"
                abnormal={isAbnormal('pulseRate', form.pulseRate)}
                placeholder="—"
              />
            </VitalSignRow>

            <VitalSignRow
              label="Resp Rate"
              hint="Normal: 12-20/min"
              abnormal={isAbnormal('respiratoryRate', form.respiratoryRate)}
            >
              <VitalValueInput
                value={form.respiratoryRate}
                onChangeText={(v) => setField('respiratoryRate', v)}
                unit="/min"
                abnormal={isAbnormal('respiratoryRate', form.respiratoryRate)}
                placeholder="—"
              />
            </VitalSignRow>

            <VitalSignRow
              label="SpO2"
              hint="Normal: 95-100%"
              abnormal={isAbnormal('oxygenSaturation', form.oxygenSaturation)}
            >
              <VitalValueInput
                value={form.oxygenSaturation}
                onChangeText={(v) => setField('oxygenSaturation', v)}
                unit="%"
                abnormal={isAbnormal('oxygenSaturation', form.oxygenSaturation)}
                placeholder="—"
              />
            </VitalSignRow>

            <VitalSignRow label="O2 Use" hint="On supplemental oxygen?" abnormal={false}>
              <View style={styles.yesNoRow}>
                <Pressable
                  onPress={() => setOxygenUse('yes')}
                  style={[styles.yesNoBtn, form.oxygenUse === 'yes' && styles.yesNoBtnActive]}
                >
                  <Text style={[styles.yesNoBtnText, form.oxygenUse === 'yes' && styles.yesNoBtnTextActive]}>
                    Yes
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setOxygenUse('no')}
                  style={[styles.yesNoBtn, form.oxygenUse === 'no' && styles.yesNoBtnActive]}
                >
                  <Text style={[styles.yesNoBtnText, form.oxygenUse === 'no' && styles.yesNoBtnTextActive]}>
                    No
                  </Text>
                </Pressable>
              </View>
            </VitalSignRow>

            <VitalSignRow
              label="Pain Level"
              hint="Scale: 0-10"
              abnormal={isAbnormal('painScale', form.painScale)}
            >
              <VitalValueInput
                value={form.painScale}
                onChangeText={(v) => setField('painScale', v)}
                unit="/10"
                abnormal={isAbnormal('painScale', form.painScale)}
                placeholder="—"
              />
            </VitalSignRow>

            <View style={styles.entryActions}>
              <Button variant="outline" size="sm" onPress={closeVitalsForm} style={{ flex: 1 }}>
                <View style={styles.btnInner}>
                  <X size={14} color={Colors.foreground} />
                  <Text>Cancel</Text>
                </View>
              </Button>
              <Button
                size="sm"
                onPress={() => setConfirmSaveOpen(true)}
                loading={saving}
                style={{ flex: 1, backgroundColor: Colors.blue600 }}
              >
                <View style={styles.btnInner}>
                  <Check size={14} color={Colors.white} />
                  <Text style={{ color: Colors.white, fontWeight: '600', flexShrink: 1 }}>Save Reading</Text>
                </View>
              </Button>
            </View>
          </View>
        ) : (
          <Pressable onPress={openVitalsForm} style={styles.barEmpty}>
            <HeartPulse size={13} color={Colors.blue600} />
            <Text style={styles.barEmptyText}>Tap to record vital signs</Text>
          </Pressable>
        )}
        </View>
      </View>

      <View style={styles.sideColumn}>
        <View style={styles.sideCard}>
          <View style={styles.headerRow}>
            <Activity size={14} color={Colors.blue600} />
            <Text style={styles.header}>Latest Vital Signs</Text>
          </View>
          {reading ? (
            <>
              <Text style={styles.summaryTime}>
                {formatDate(reading.recordedAt)} · {formatTime(reading.recordedAt)}
              </Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>TEMP</Text>
                  <Text style={styles.summaryCellValue}>
                    {reading.temperature != null ? `${reading.temperature}°C` : '—'}
                  </Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>PULSE</Text>
                  <Text style={styles.summaryCellValue}>
                    {reading.heartRate != null ? `${reading.heartRate}bpm` : '—'}
                  </Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>RESP</Text>
                  <Text style={styles.summaryCellValue}>
                    {reading.respiratoryRate != null ? `${reading.respiratoryRate}/min` : '—'}
                  </Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>BP</Text>
                  <Text style={styles.summaryCellValue}>{reading.bloodPressure || '—'}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>O2 SAT</Text>
                  <Text style={styles.summaryCellValue}>
                    {reading.oxygenSaturation != null ? `${reading.oxygenSaturation}%` : '—'}
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.emptyStateText}>No vital signs recorded yet for this task.</Text>
          )}
        </View>

        <View style={styles.sideCard}>
          <View style={styles.headerRow}>
            <Clock size={14} color={Colors.purple600} />
            <Text style={styles.header}>Monitoring History</Text>
          </View>
          {newestFirstReadings.length === 0 ? (
            <Text style={styles.emptyStateText}>Entries will appear here once saved.</Text>
          ) : (
            // A plain View, not a nested ScrollView — a scroll view inside
            // the modal's own outer ScrollView (see tasks.tsx) is what made
            // scrolling feel stuck/janky on mobile, where the two gesture
            // regions fight each other. History just flows as part of the
            // one outer scroll instead.
            <View style={styles.historyList}>
              {newestFirstReadings.map((r) => {
                const isExpanded = expandedHistoryId === r.id;
                return (
                  <View key={r.id} style={styles.historyRow}>
                    <Pressable
                      style={styles.historyRowHeader}
                      onPress={() => setExpandedHistoryId(isExpanded ? null : r.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyRowTime}>
                          {formatDate(r.recordedAt)} · {formatTime(r.recordedAt)}
                        </Text>
                        <Text style={styles.historyRowMeta}>
                          #{r.id}
                          {r.recordedByName ? ` · by ${r.recordedByName}` : ''}
                        </Text>
                      </View>
                      <Text style={styles.statusBadgeDone}>Recorded ✓</Text>
                      {isExpanded ? (
                        <ChevronUp size={14} color={Colors.gray500} />
                      ) : (
                        <ChevronDown size={14} color={Colors.gray500} />
                      )}
                    </Pressable>
                    {isExpanded ? (
                      <Text style={styles.historyRowDetail}>
                        Temp {r.temperature != null ? `${r.temperature}°C` : '—'} ·
                        {' '}Pulse {r.heartRate != null ? `${r.heartRate}bpm` : '—'} ·
                        {' '}Resp {r.respiratoryRate != null ? `${r.respiratoryRate}/min` : '—'} ·
                        {' '}BP {r.bloodPressure || '—'} ·
                        {' '}O2 {r.oxygenSaturation != null ? `${r.oxygenSaturation}%` : '—'}
                        {r.oxygenUse != null ? ` · O2 Use ${r.oxygenUse ? 'Yes' : 'No'}` : ''}
                        {r.painScale != null ? ` · Pain ${r.painScale}/10` : ''}
                        {r.edited ? ' · (edited)' : ''}
                      </Text>
                    ) : null}
                    {isExpanded ? (
                      <Pressable
                        onPress={() => openEditReading(r)}
                        hitSlop={6}
                        style={styles.historyEditBtn}
                      >
                        <Pencil size={12} color={Colors.blue600} />
                        <Text style={styles.historyEditBtnText}>Edit this reading</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </View>

    <ConfirmDialog
      open={confirmSaveOpen}
      onOpenChange={setConfirmSaveOpen}
      title="Save this vital signs reading?"
      description="Double-check the values above before saving — once recorded, this reading becomes part of the patient's monitoring history."
      confirmLabel="Save Reading"
      loading={saving}
      onConfirm={async () => {
        await handleSaveReading();
        setConfirmSaveOpen(false);
      }}
    />

    <Modal
      visible={editingReading !== null}
      transparent
      animationType="fade"
      onRequestClose={closeEditReading}
    >
      <View style={styles.editModalBackdrop}>
        <View style={[styles.editModalSheet, Shadows.xl]}>
          <View style={styles.editModalHeader}>
            <Pencil size={18} color={Colors.blue600} />
            <Text style={styles.editModalTitle}>Edit Vital Signs Reading</Text>
            <Pressable onPress={closeEditReading} hitSlop={8}>
              <X size={20} color={Colors.gray500} />
            </Pressable>
          </View>
          {editingReading ? (
            <Text style={styles.editModalSubtitle}>
              Originally {formatDate(editingReading.recordedAt)} · {formatTime(editingReading.recordedAt)}
            </Text>
          ) : null}

          <ScrollView style={styles.editModalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.entryPanel}>
              <TimePicker
                label="Monitoring Time"
                format="12h"
                value={editTimeValue}
                onChange={setEditTimeValue}
              />

              <VitalSignRow
                label="Temperature"
                hint="Normal: 36.1-37.5°C"
                abnormal={isAbnormal('temperature', editForm.temperature)}
              >
                <VitalValueInput
                  value={editForm.temperature}
                  onChangeText={(v) => setEditField('temperature', v)}
                  unit="°C"
                  abnormal={isAbnormal('temperature', editForm.temperature)}
                  placeholder="—"
                />
              </VitalSignRow>

              <VitalSignRow
                label="Blood Pressure"
                hint="Normal: 90-140 / 60-90 mmHg"
                abnormal={isAbnormal('systolic', editForm.systolic) || isAbnormal('diastolic', editForm.diastolic)}
              >
                <View style={styles.bpRow}>
                  <View style={styles.bpBox}>
                    <VitalValueInput
                      value={editForm.systolic}
                      onChangeText={(v) => setEditField('systolic', v)}
                      abnormal={isAbnormal('systolic', editForm.systolic)}
                      placeholder="—"
                      center
                    />
                  </View>
                  <Text style={styles.bpSlash}>/</Text>
                  <View style={styles.bpBox}>
                    <VitalValueInput
                      value={editForm.diastolic}
                      onChangeText={(v) => setEditField('diastolic', v)}
                      abnormal={isAbnormal('diastolic', editForm.diastolic)}
                      placeholder="—"
                      center
                    />
                  </View>
                </View>
              </VitalSignRow>

              <VitalSignRow
                label="Heart Rate"
                hint="Normal: 60-100 bpm"
                abnormal={isAbnormal('pulseRate', editForm.pulseRate)}
              >
                <VitalValueInput
                  value={editForm.pulseRate}
                  onChangeText={(v) => setEditField('pulseRate', v)}
                  unit="bpm"
                  abnormal={isAbnormal('pulseRate', editForm.pulseRate)}
                  placeholder="—"
                />
              </VitalSignRow>

              <VitalSignRow
                label="Resp Rate"
                hint="Normal: 12-20/min"
                abnormal={isAbnormal('respiratoryRate', editForm.respiratoryRate)}
              >
                <VitalValueInput
                  value={editForm.respiratoryRate}
                  onChangeText={(v) => setEditField('respiratoryRate', v)}
                  unit="/min"
                  abnormal={isAbnormal('respiratoryRate', editForm.respiratoryRate)}
                  placeholder="—"
                />
              </VitalSignRow>

              <VitalSignRow
                label="SpO2"
                hint="Normal: 95-100%"
                abnormal={isAbnormal('oxygenSaturation', editForm.oxygenSaturation)}
              >
                <VitalValueInput
                  value={editForm.oxygenSaturation}
                  onChangeText={(v) => setEditField('oxygenSaturation', v)}
                  unit="%"
                  abnormal={isAbnormal('oxygenSaturation', editForm.oxygenSaturation)}
                  placeholder="—"
                />
              </VitalSignRow>

              <VitalSignRow label="O2 Use" hint="On supplemental oxygen?" abnormal={false}>
                <View style={styles.yesNoRow}>
                  <Pressable
                    onPress={() => setEditOxygenUse('yes')}
                    style={[styles.yesNoBtn, editForm.oxygenUse === 'yes' && styles.yesNoBtnActive]}
                  >
                    <Text
                      style={[styles.yesNoBtnText, editForm.oxygenUse === 'yes' && styles.yesNoBtnTextActive]}
                    >
                      Yes
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditOxygenUse('no')}
                    style={[styles.yesNoBtn, editForm.oxygenUse === 'no' && styles.yesNoBtnActive]}
                  >
                    <Text
                      style={[styles.yesNoBtnText, editForm.oxygenUse === 'no' && styles.yesNoBtnTextActive]}
                    >
                      No
                    </Text>
                  </Pressable>
                </View>
              </VitalSignRow>

              <VitalSignRow
                label="Pain Level"
                hint="Scale: 0-10"
                abnormal={isAbnormal('painScale', editForm.painScale)}
              >
                <VitalValueInput
                  value={editForm.painScale}
                  onChangeText={(v) => setEditField('painScale', v)}
                  unit="/10"
                  abnormal={isAbnormal('painScale', editForm.painScale)}
                  placeholder="—"
                />
              </VitalSignRow>
            </View>
          </ScrollView>

          <View style={styles.entryActions}>
            <Button variant="outline" onPress={closeEditReading} style={{ flex: 1 }} disabled={savingEdit}>
              <Text>Cancel</Text>
            </Button>
            <Button
              onPress={handleSaveEdit}
              loading={savingEdit}
              style={{ flex: 1, backgroundColor: Colors.blue600 }}
            >
              <View style={styles.btnInner}>
                <Check size={14} color={Colors.white} />
                <Text style={{ color: Colors.white, fontWeight: '600', flexShrink: 1 }}>Save Changes</Text>
              </View>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // The main bars card and the summary/history side cards sit side by side
  // on a roomy screen (web) and stack automatically once either column
  // drops below its minWidth (mobile / a narrow modal) — plain flexWrap,
  // same responsive convention already used for Kardex's field rows,
  // instead of a manual width breakpoint.
  layout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 4,
    alignItems: 'flex-start',
  },
  mainColumn: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 260,
    gap: 8,
  },
  sideColumn: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 220,
    gap: 12,
  },
  sideCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray50,
    padding: 12,
    gap: 8,
  },
  gateHintMet: {
    fontSize: 11,
    color: Colors.green700,
    fontWeight: '600',
  },
  statusBadgeNone: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.gray500,
    backgroundColor: Colors.gray100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 'auto',
  },
  summaryTime: { fontSize: 11, color: Colors.gray500 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCell: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 70,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  summaryCellLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.mutedForeground,
    letterSpacing: 0.3,
  },
  summaryCellValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.gray900,
    marginTop: 2,
  },
  emptyStateText: { fontSize: 12, color: Colors.gray500, fontStyle: 'italic' },
  historyList: { gap: 8 },
  historyRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.white,
    padding: 8,
  },
  historyRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyRowTime: { fontSize: 12, fontWeight: '700', color: Colors.gray800 },
  historyRowMeta: { fontSize: 10, color: Colors.gray500, marginTop: 1 },
  historyRowDetail: {
    fontSize: 11,
    color: Colors.gray700,
    marginTop: 6,
    lineHeight: 16,
  },
  historyEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  historyEditBtnText: { fontSize: 11, fontWeight: '700', color: Colors.blue600 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  loadingText: { fontSize: 12, color: Colors.gray500 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  header: { fontSize: 12, fontWeight: '700', color: Colors.gray800 },
  gateHint: { fontSize: 11, color: Colors.orange700, lineHeight: 15 },
  bars: { gap: 8 },
  barFilled: {
    borderWidth: 1,
    borderColor: Colors.green200,
    backgroundColor: Colors.green50,
    borderRadius: Radius.md,
    padding: 10,
    gap: 4,
  },
  barFilledTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  editReadingBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  editReadingBtnText: { fontSize: 10, fontWeight: '700', color: Colors.gray500 },
  editedTag: { fontSize: 10, fontStyle: 'italic', color: Colors.gray500 },
  barFilledHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  barFilledTime: { fontSize: 12, fontWeight: '700', color: Colors.green700 },
  barFilledBy: { fontSize: 11, color: Colors.gray500, marginLeft: 'auto' },
  barFilledSummary: { fontSize: 12, color: Colors.gray700 },
  statusBadgeDone: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.green700,
    backgroundColor: Colors.green100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  barEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.blue300,
    backgroundColor: Colors.blue50,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  barEmptyText: { fontSize: 13, fontWeight: '600', color: Colors.blue700 },
  entryPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    padding: 12,
    gap: 10,
  },
  statusDotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statusDotItem: { alignItems: 'center', gap: 3, minWidth: 40 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotLabel: { fontSize: 9, fontWeight: '700', color: Colors.gray500 },
  // Native (iOS/Android) renders shadowOpacity/shadowRadius visibly even at
  // Shadows.sm's low numbers, and the user confirmed mobile already looks
  // right — but react-native-web converts those same numbers into a literal
  // CSS box-shadow (confirmed in RNW's resolveShadowValue.js), and at sm's
  // values that box-shadow is real but essentially imperceptible on a
  // screen. So this only strengthens the shadow on web; native keeps
  // exactly the Shadows.sm it already had, untouched.
  vsRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.gray50,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 8,
    ...(Platform.OS === 'web' ? Shadows.md : Shadows.sm),
  },
  vsRowAbnormal: {
    borderColor: Colors.orange300,
    backgroundColor: Colors.orange50,
  },
  // Same convention as Kardex's VitalSignsGrid.vitalLabel — one uppercase,
  // muted label per field, not a separate generic header above it.
  vsRowLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  vsRowHint: { fontSize: 10, color: Colors.gray500 },
  vsRowHintAbnormal: { color: Colors.orange700 },
  // width: '100%' is explicit on purpose — this View's own sizing inside
  // bpBox otherwise depends on implicit flex-stretch from its parent, which
  // is exactly what wasn't resolving reliably on web for the systolic/
  // diastolic pair (see bpBox below).
  vsValueRow: { width: '100%', flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  vsValueInput: {
    flex: 1,
    // The actual <input> element's own default min-width is 'auto' too —
    // the same root cause as bpBox/vsRow above, just one level deeper.
    // Confirmed by direct measurement: the grid column was correctly
    // 153.56px on both sides, but the <input> inside was still rendering
    // at 291px and overflowing past it regardless, because this specific
    // property was never set on the input element itself.
    minWidth: 0,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.gray900,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  vsValueInputCentered: { textAlign: 'center' },
  vsValueInputAbnormal: {
    borderColor: Colors.orange600,
    color: Colors.orange700,
  },
  // Web-only: three levels of nested flex (bpRow > bpBox > vsValueRow >
  // TextInput) kept letting the diastolic input's own intrinsic width win
  // out over flex-grow distribution on react-native-web specifically —
  // flex:1, minWidth:0, and width:'100%' were each tried and each still
  // left it overflowing past its box on web only (mobile was always fine,
  // confirmed by the user). CSS Grid replaces flex here, for web only —
  // but plain '1fr' computes as minmax(auto, 1fr), so a track's own
  // min-content width (the TextInput's intrinsic width again) can still
  // inflate it past its share, which is exactly what happened the first
  // time this shipped. minmax(0, 1fr) is the actual fix — it removes that
  // content-based floor so both tracks are forced strictly equal.
  vsUnit: { fontSize: 12, color: Colors.mutedForeground },
  bpRow: (Platform.OS === 'web'
    ? {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        gap: 10,
      }
    : { flexDirection: 'row', alignItems: 'center', gap: 10 }) as unknown as ViewStyle,
  // overflow: 'hidden' was here defensively from an earlier flex-based
  // attempt — with grid now sizing the columns correctly it's not needed,
  // and it was actually clipping the input's own border/radius at a
  // sub-pixel boundary, which is why the boxes rendered borderless instead
  // of matching Temperature/Heart Rate/etc.
  bpBox: (Platform.OS === 'web' ? { minWidth: 0 } : { flex: 1, minWidth: 0 }) as ViewStyle,
  bpSlash: { fontSize: 20, fontWeight: '700', color: Colors.gray400, textAlign: 'center' },
  yesNoRow: { flexDirection: 'row', gap: 8 },
  yesNoBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  yesNoBtnActive: {
    borderColor: Colors.blue600,
    backgroundColor: Colors.blue50,
  },
  yesNoBtnText: { fontSize: 13, fontWeight: '600', color: Colors.gray600 },
  yesNoBtnTextActive: { color: Colors.blue700 },
  entryActions: { flexDirection: 'row', gap: 8 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
  editModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  editModalSheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    padding: 16,
    gap: 12,
  },
  editModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editModalTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.foreground },
  editModalSubtitle: { fontSize: 12, color: Colors.gray500 },
  editModalScroll: { flexShrink: 1 },
});
