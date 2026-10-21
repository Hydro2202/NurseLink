import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { HeartPulse, CalendarClock, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';
import { fetchVitalsSchedule, saveVitalsSchedule, stopVitalsSchedule, ApiError } from '../services/api';
import type { VitalsScheduleResponse } from '../types/domain';
import { Input } from './Input';
import { DatePicker, todayIso } from './DatePicker';
import { TimePicker } from './TimePicker';
import { formatDateTime } from './tasks/taskLabels';
import { useAuth } from '../contexts/AuthContext';

export const VITALS_FREQUENCIES = [
  { hours: 1, label: 'Every 1 hour' },
  { hours: 2, label: 'Every 2 hours' },
  { hours: 4, label: 'Every 4 hours' },
] as const;

/** The next full hour as local "YYYY-MM-DD" + "HH:MM" — the default first check. */
function nextFullHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function toIso(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const local = new Date(y, m - 1, d, h, min);
  return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}

interface Props {
  patientId: string;
  patientName?: string;
  /** Defaults to nurses and head nurses; the server enforces who actually can. */
  canEdit?: boolean;
}

/**
 * The Kardex "Vital Signs Schedule" panel: how often this patient's vitals
 * must be taken (as ordered), when the next check is due, the last recorded
 * reading and whether checks are on schedule. Without a schedule it says so
 * plainly instead of inventing a next-check time.
 */
export function VitalsScheduleCard({ patientId, patientName, canEdit: canEditProp }: Props) {
  const { user } = useAuth();
  const canEdit = canEditProp ?? (user?.role === 'staff_nurse' || user?.role === 'head_nurse');
  const [data, setData] = useState<VitalsScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'scheduled' | 'prn'>('scheduled');
  const [frequency, setFrequency] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [basis, setBasis] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setData(await fetchVitalsSchedule(patientId));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the vital signs schedule.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const active = data?.active ?? null;

  const startEditing = () => {
    const next = nextFullHour();
    setMode(active?.mode ?? 'scheduled');
    setFrequency(active?.frequencyHours ?? null);
    setStartDate(next.date);
    setStartTime(next.time);
    setBasis(active?.basis ?? '');
    setReason('');
    setFormError(null);
    setEditing(true);
  };

  const save = async () => {
    if (mode === 'scheduled' && !frequency) {
      setFormError('Choose the frequency ordered for this patient.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      setData(
        await saveVitalsSchedule(patientId, {
          mode,
          frequencyHours: mode === 'scheduled' ? frequency! : undefined,
          startAt: toIso(startDate, startTime),
          basis: basis.trim(),
          reason: reason.trim() || undefined,
        })
      );
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.data as Record<string, string[] | string> | undefined;
        const first = fields && Object.values(fields).find(Boolean);
        setFormError(Array.isArray(first) ? first[0] : typeof first === 'string' ? first : err.message);
      } else {
        setFormError('Could not save. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const stop = async () => {
    setSaving(true);
    setFormError(null);
    try {
      setData(await stopVitalsSchedule(patientId, reason.trim() || undefined));
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not stop the schedule.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.card, styles.center]}>
        <ActivityIndicator color={Colors.blue600} />
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLabel="Vital signs schedule">
      <View style={styles.header}>
        <View style={styles.iconTile}>
          <HeartPulse size={22} color={Colors.teal600} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.title}>Vital Signs Schedule</Text>
          {patientName ? <Text style={styles.sub}>{patientName}</Text> : null}
        </View>
        {active ? (
          <View style={[styles.pill, active.monitoringStatus === 'overdue' ? styles.pillRed : styles.pillGreen]}>
            <Text style={[styles.pillText, { color: active.monitoringStatus === 'overdue' ? Colors.red700 : Colors.green700 }]}>
              {active.monitoringStatus === 'overdue'
                ? `${active.overdueChecks} overdue check${active.overdueChecks === 1 ? '' : 's'}`
                : 'Active'}
            </Text>
          </View>
        ) : null}
      </View>

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

      {active && !editing ? (
        <View style={styles.body}>
          <Text style={styles.muted}>Required monitoring frequency</Text>
          <Text style={styles.frequency}>{active.frequencyLabel}</Text>
          <View style={styles.grid}>
            <View style={styles.cell}>
              <Text style={styles.muted}>Next scheduled check</Text>
              <Text style={styles.value}>
                {active.mode === 'prn' ? 'As needed' : formatDateTime(active.nextCheckAt)}
              </Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.muted}>Most recent check</Text>
              <Text style={styles.value}>{active.lastCheckAt ? formatDateTime(active.lastCheckAt) : 'No reading yet'}</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.muted}>Started</Text>
              <Text style={styles.value}>{formatDateTime(active.startAt)}</Text>
            </View>
          </View>
          <View style={styles.note}>
            <CalendarClock size={16} color={Colors.teal600} />
            <View style={styles.flex1}>
              <Text style={styles.noteTitle}>
                Set by {active.setBy || '—'} on {formatDateTime(active.setAt)}
              </Text>
              <Text style={styles.noteText}>{active.basis ? `Order / protocol: ${active.basis}` : 'No order reference recorded.'}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {!active && !editing ? (
        <View style={styles.required}>
          <AlertTriangle size={18} color={Colors.orange600} />
          <View style={styles.flex1}>
            <Text style={styles.requiredTitle}>Vital Signs Schedule Required</Text>
            <Text style={styles.requiredText}>
              No monitoring frequency has been set for this patient. Set it as ordered by the physician or hospital
              protocol; it is never chosen automatically.
            </Text>
          </View>
        </View>
      ) : null}

      {editing ? (
        <View style={styles.form}>
          <Text style={styles.label}>Monitoring frequency (as ordered) *</Text>
          <View style={styles.segment}>
            {VITALS_FREQUENCIES.map((f) => {
              const selected = mode === 'scheduled' && frequency === f.hours;
              return (
                <Pressable
                  key={f.hours}
                  onPress={() => {
                    setMode('scheduled');
                    setFrequency(f.hours);
                  }}
                  style={[styles.segmentBtn, selected && styles.segmentBtnActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => {
                setMode('prn');
                setFrequency(null);
              }}
              style={[styles.segmentBtn, mode === 'prn' && styles.segmentBtnActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'prn' }}
            >
              <Text style={[styles.segmentText, mode === 'prn' && styles.segmentTextActive]}>As needed (PRN)</Text>
            </Pressable>
          </View>
          {mode === 'scheduled' ? (
            <View style={styles.row}>
              <DatePicker
                style={styles.flex1}
                label="First check date"
                value={startDate}
                onChange={setStartDate}
                minDate={todayIso()}
              />
              <TimePicker style={styles.flex1} label="First check time" value={startTime} onChange={setStartTime} />
            </View>
          ) : null}
          <Input
            label="Order / protocol reference"
            placeholder="e.g., Dr. Reyes order 10/20, post-op protocol"
            value={basis}
            onChangeText={setBasis}
          />
          {active ? (
            <Input
              label="Reason for change"
              placeholder="e.g., Patient stable, physician lowered frequency"
              value={reason}
              onChangeText={setReason}
            />
          ) : null}
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <View style={styles.actions}>
            {active ? (
              <Pressable onPress={stop} disabled={saving} style={[styles.btn, styles.btnDanger]}>
                <Text style={styles.btnDangerText}>Stop monitoring</Text>
              </Pressable>
            ) : null}
            <View style={styles.flex1} />
            <Pressable onPress={() => setEditing(false)} disabled={saving} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} style={[styles.btn, styles.btnPrimary, saving && styles.disabled]}>
              {saving ? <ActivityIndicator size="small" color={Colors.white} /> : null}
              <Text style={styles.btnPrimaryText}>{active ? 'Save change' : 'Set schedule'}</Text>
            </Pressable>
          </View>
        </View>
      ) : canEdit ? (
        <Pressable onPress={startEditing} style={[styles.btn, styles.btnOutline]}>
          <Text style={styles.btnOutlineText}>{active ? 'Change schedule' : 'Set vital signs schedule'}</Text>
        </Pressable>
      ) : null}

      {data && data.history.some((h) => h.endedAt) ? (
        <View>
          <Pressable onPress={() => setShowHistory((v) => !v)} style={styles.historyToggle}>
            <Text style={styles.historyToggleText}>Schedule history</Text>
            {showHistory ? <ChevronUp size={14} color={Colors.gray500} /> : <ChevronDown size={14} color={Colors.gray500} />}
          </Pressable>
          {showHistory
            ? data.history
                .filter((h) => h.endedAt)
                .map((h) => (
                  <Text key={h.id} style={styles.historyRow}>
                    {h.frequencyLabel} · set by {h.setBy || '—'} {formatDateTime(h.setAt)} · ended {formatDateTime(h.endedAt)}
                    {h.endReason ? ` (${h.endReason})` : ''}
                  </Text>
                ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 12,
  },
  center: { alignItems: 'center', paddingVertical: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.teal50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: Colors.gray900 },
  sub: { fontSize: 12, color: Colors.gray600, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  pillGreen: { backgroundColor: Colors.green50 },
  pillRed: { backgroundColor: Colors.red50 },
  pillText: { fontSize: 12, fontWeight: '700' },
  body: { gap: 4 },
  muted: { fontSize: 12, color: Colors.gray600 },
  frequency: { fontSize: 22, fontWeight: '800', color: Colors.gray900, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: 160, gap: 2 },
  value: { fontSize: 14, fontWeight: '600', color: Colors.gray900 },
  note: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    padding: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.teal50,
    alignItems: 'flex-start',
  },
  noteTitle: { fontSize: 13, fontWeight: '700', color: Colors.gray900 },
  noteText: { fontSize: 12, color: Colors.gray700, marginTop: 2 },
  required: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.orange50,
    borderWidth: 1,
    borderColor: Colors.orange100,
    alignItems: 'flex-start',
  },
  requiredTitle: { fontSize: 14, fontWeight: '700', color: Colors.orange700 },
  requiredText: { fontSize: 12, color: Colors.gray700, marginTop: 2 },
  form: { gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.gray800 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmentBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  segmentBtnActive: { borderColor: Colors.teal600, backgroundColor: Colors.teal50 },
  segmentText: { fontSize: 13, fontWeight: '600', color: Colors.gray700 },
  segmentTextActive: { color: Colors.teal700 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: Radius.md,
  },
  btnPrimary: { backgroundColor: Colors.teal600 },
  btnPrimaryText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: Colors.border },
  btnGhostText: { color: Colors.gray700, fontWeight: '600', fontSize: 13 },
  btnDanger: { borderWidth: 1, borderColor: Colors.red200 },
  btnDangerText: { color: Colors.red600, fontWeight: '600', fontSize: 13 },
  btnOutline: { borderWidth: 1, borderColor: Colors.teal600, alignSelf: 'flex-start' },
  btnOutlineText: { color: Colors.teal700, fontWeight: '700', fontSize: 13 },
  disabled: { opacity: 0.6 },
  error: { color: Colors.red600, fontSize: 13, fontWeight: '600' },
  historyToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  historyToggleText: { fontSize: 12, fontWeight: '600', color: Colors.gray600 },
  historyRow: { fontSize: 12, color: Colors.gray600, marginTop: 4 },
});
