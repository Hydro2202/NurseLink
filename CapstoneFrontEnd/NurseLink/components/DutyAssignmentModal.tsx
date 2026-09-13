import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import { CalendarDays, CircleCheck, CircleAlert, CircleX } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { DatePicker, todayIso } from './DatePicker';
import { Alert, AlertDescription } from './Alert';
import {
  createDutyAssignment,
  updateDutyAssignment,
  ApiError,
  type DutyAssignmentInput,
} from '../services/api';
import type { Department, DutyAssignment, Nurse } from '../types/domain';
import { useToast } from '../contexts/ToastContext';

interface DutyAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  assignment?: DutyAssignment | null;
  nurses: Nurse[];
  departments: Department[];
  /** The whole currently-loaded roster — used only for the availability check. */
  allAssignments: DutyAssignment[];
  onSaved: (saved: DutyAssignment) => void;
}

const SHIFT_OPTIONS = [
  { label: 'Morning · 7:00 AM – 3:00 PM', value: 'morning' },
  { label: 'Evening · 3:00 PM – 11:00 PM', value: 'afternoon' },
  { label: 'Night · 11:00 PM – 7:00 AM', value: 'night' },
];
const SHIFT_DEFAULTS: Record<string, { start: string; end: string }> = {
  morning: { start: '07:00', end: '15:00' },
  afternoon: { start: '15:00', end: '23:00' },
  night: { start: '23:00', end: '07:00' },
};
const STATUS_OPTIONS = [
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

// Mirrors DutyAssignment.duration_hours on the backend exactly, purely for
// an instant preview as the head nurse types — the backend recomputes and
// stores the real numbers itself; this never gets sent as-is.
function durationHours(start: string, end: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/;
  const s = start.match(m);
  const e = end.match(m);
  if (!s || !e) return null;
  let startMin = Number(s[1]) * 60 + Number(s[2]);
  let endMin = Number(e[1]) * 60 + Number(e[2]);
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

function toMinutesOfDay(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Local-calendar getters only, never toISOString() — that converts to UTC,
// which rolls local midnight back a day in any timezone ahead of UTC
// (e.g. UTC+8) and made every date here look "invalid" or off-by-one.
function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isValidDate(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
}

type Availability = 'available' | 'scheduled' | 'conflict';

// Same wrap-aware overlap rule as DutyAssignmentSerializer.validate() —
// checked against whatever roster is already loaded, so this only ever
// reads real assignment data, never invents an answer.
function checkAvailability(
  nurseId: string,
  dutyDate: string,
  startTime: string,
  endTime: string,
  all: DutyAssignment[],
  excludeId?: number
): Availability | null {
  if (!nurseId || !isValidDate(dutyDate)) return null;
  const startMin = toMinutesOfDay(startTime);
  const endMinRaw = toMinutesOfDay(endTime);
  const candidates = all.filter(
    (a) =>
      a.nurseId === nurseId &&
      a.status !== 'cancelled' &&
      a.id !== excludeId &&
      (a.dutyDate === dutyDate || a.dutyDate === addDaysIso(dutyDate, -1) || a.dutyDate === addDaysIso(dutyDate, 1))
  );
  if (!candidates.length) return 'available';

  if (startMin !== null && endMinRaw !== null) {
    const dayOffset = (d: string) => (new Date(d + 'T00:00:00').getTime() - new Date(dutyDate + 'T00:00:00').getTime()) / 86400000;
    const thisStart = startMin;
    const thisEnd = endMinRaw <= startMin ? endMinRaw + 24 * 60 : endMinRaw;
    for (const a of candidates) {
      const offset = dayOffset(a.dutyDate) * 24 * 60;
      const aStartMin = toMinutesOfDay(a.startTime);
      const aEndMinRaw = toMinutesOfDay(a.endTime);
      if (aStartMin === null || aEndMinRaw === null) continue;
      const aStart = offset + aStartMin;
      const aEnd = offset + (aEndMinRaw <= aStartMin ? aEndMinRaw + 24 * 60 : aEndMinRaw);
      if (thisStart < aEnd && aStart < thisEnd) return 'conflict';
    }
  }
  return candidates.some((a) => a.dutyDate === dutyDate) ? 'scheduled' : 'available';
}

export function DutyAssignmentModal({
  open,
  onOpenChange,
  mode,
  assignment,
  nurses,
  departments,
  allAssignments,
  onSaved,
}: DutyAssignmentModalProps) {
  const toast = useToast();
  const [nurseId, setNurseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [dutyDate, setDutyDate] = useState(todayIso());
  const [shift, setShift] = useState('morning');
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:00');
  const [overtimeStart, setOvertimeStart] = useState('');
  const [overtimeEnd, setOvertimeEnd] = useState('');
  const [status, setStatus] = useState('scheduled');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && assignment) {
      setNurseId(assignment.nurseId);
      setDepartmentId(String(assignment.departmentId));
      setDutyDate(assignment.dutyDate);
      setShift(assignment.shift);
      setStartTime(assignment.startTime.slice(0, 5));
      setEndTime(assignment.endTime.slice(0, 5));
      setOvertimeStart(assignment.overtimeStart ? assignment.overtimeStart.slice(0, 5) : '');
      setOvertimeEnd(assignment.overtimeEnd ? assignment.overtimeEnd.slice(0, 5) : '');
      setStatus(assignment.status);
      setNotes(assignment.notes || '');
    } else {
      setNurseId('');
      setDepartmentId('');
      setDutyDate(todayIso());
      setShift('morning');
      setStartTime(SHIFT_DEFAULTS.morning.start);
      setEndTime(SHIFT_DEFAULTS.morning.end);
      setOvertimeStart('');
      setOvertimeEnd('');
      setStatus('scheduled');
      setNotes('');
    }
    setFormError('');
  }, [open, mode, assignment]);

  const handleShiftChange = (value: string) => {
    setShift(value);
    const defaults = SHIFT_DEFAULTS[value];
    if (defaults) {
      setStartTime(defaults.start);
      setEndTime(defaults.end);
    }
  };

  const regularHours = useMemo(() => durationHours(startTime, endTime), [startTime, endTime]);
  const overtimeHours = useMemo(
    () => (overtimeStart && overtimeEnd ? durationHours(overtimeStart, overtimeEnd) : 0),
    [overtimeStart, overtimeEnd]
  );
  const totalHours =
    regularHours !== null ? Math.round(((regularHours + (overtimeHours || 0)) * 100)) / 100 : null;

  const availability = useMemo(
    () => checkAvailability(nurseId, dutyDate, startTime, endTime, allAssignments, assignment?.id),
    [nurseId, dutyDate, startTime, endTime, allAssignments, assignment?.id]
  );

  // Several real accounts in this hospital's roster share the same display
  // name (duplicate/near-duplicate signups) — the email is what actually
  // tells them apart, so it has to be visible in the option itself, not just
  // searchable via keywords.
  const nurseOptions = nurses.map((n) => ({
    label: n.email ? `${n.name} — ${n.email}` : n.name,
    value: n.id,
    keywords: `${n.email || ''} ${n.department || ''}`,
  }));
  const departmentOptions = departments.map((d) => ({ label: d.name, value: String(d.id) }));

  const canSubmit =
    !!nurseId && !!departmentId && isValidDate(dutyDate) && regularHours !== null && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setFormError('');
    setSubmitting(true);
    const payload: DutyAssignmentInput = {
      nurseId,
      departmentId: Number(departmentId),
      dutyDate,
      shift,
      startTime,
      endTime,
      overtimeStart: overtimeStart || null,
      overtimeEnd: overtimeEnd || null,
      status,
      notes,
    };
    try {
      const nurseName = nurses.find((n) => n.id === nurseId)?.name || 'The nurse';
      const deptName = departments.find((d) => String(d.id) === departmentId)?.name || 'the department';
      let saved;
      if (mode === 'edit' && assignment) {
        saved = await updateDutyAssignment(assignment.id, payload);
        toast.success('Duty Assignment Updated', {
          description: `${nurseName}'s assignment was updated.`,
        });
      } else {
        saved = await createDutyAssignment(payload);
        toast.success('Duty Assignment Created', {
          description: `${nurseName} has been assigned to ${deptName}.`,
        });
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Please try again.';
      setFormError(message);
      toast.error('Could not save duty assignment', { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <CalendarDays size={20} color={Colors.blue600} />
            <Text style={styles.title}>{mode === 'edit' ? 'Edit Duty Assignment' : 'Assign Nurse'}</Text>
          </View>
          <Text style={styles.description}>
            {mode === 'edit'
              ? 'Update this nurse\'s department, date, shift, or hours.'
              : 'Assign a nurse to a department, date, and shift.'}
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.form}>
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <Select
                label="Nurse *"
                value={nurseId}
                onValueChange={setNurseId}
                options={nurseOptions}
                placeholder="Search nurse..."
                searchable
                searchPlaceholder="Search by name, username, or email..."
                emptyMessage="No approved nurses found."
              />

              {availability && nurseId ? (
                <View
                  style={[
                    styles.availRow,
                    availability === 'available' && styles.availGood,
                    availability === 'scheduled' && styles.availWarn,
                    availability === 'conflict' && styles.availBad,
                  ]}
                >
                  {availability === 'available' ? (
                    <CircleCheck size={15} color={Colors.green700} />
                  ) : availability === 'scheduled' ? (
                    <CircleAlert size={15} color={Colors.orange700} />
                  ) : (
                    <CircleX size={15} color={Colors.red700} />
                  )}
                  <Text
                    style={[
                      styles.availText,
                      availability === 'available' && { color: Colors.green700 },
                      availability === 'scheduled' && { color: Colors.orange700 },
                      availability === 'conflict' && { color: Colors.red700 },
                    ]}
                  >
                    {availability === 'available'
                      ? 'Available for this date and time'
                      : availability === 'scheduled'
                        ? 'Already scheduled this day (different time)'
                        : 'Schedule conflict — overlaps an existing duty'}
                  </Text>
                </View>
              ) : null}

              <Select
                label="Department *"
                value={departmentId}
                onValueChange={setDepartmentId}
                options={departmentOptions}
                placeholder="Select department"
                searchable
                searchPlaceholder="Search departments..."
              />

              <DatePicker
                label="Duty Date"
                required
                value={dutyDate}
                onChange={setDutyDate}
              />

              <Select
                label="Shift *"
                value={shift}
                onValueChange={handleShiftChange}
                options={SHIFT_OPTIONS}
                placeholder="Select shift"
              />

              <View style={styles.row}>
                <Input
                  containerStyle={{ flex: 1 }}
                  label="Start Time *"
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="HH:MM"
                />
                <Input
                  containerStyle={{ flex: 1 }}
                  label="End Time *"
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="HH:MM"
                />
              </View>

              <View style={styles.hoursBox}>
                <View style={styles.hoursRow}>
                  <Text style={styles.hoursLabel}>Regular Hours</Text>
                  <Text style={styles.hoursValue}>{regularHours !== null ? `${regularHours}h` : '—'}</Text>
                </View>
                <View style={styles.hoursRow}>
                  <Text style={styles.hoursLabel}>Overtime</Text>
                  <Text style={styles.hoursValue}>{overtimeHours ? `${overtimeHours}h` : '0h'}</Text>
                </View>
                <View style={[styles.hoursRow, styles.hoursTotalRow]}>
                  <Text style={styles.hoursTotalLabel}>Total Hours</Text>
                  <Text style={styles.hoursTotalValue}>{totalHours !== null ? `${totalHours}h` : '—'}</Text>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Overtime (optional)</Text>
              <View style={styles.row}>
                <Input
                  containerStyle={{ flex: 1 }}
                  label="Overtime Start"
                  value={overtimeStart}
                  onChangeText={setOvertimeStart}
                  placeholder="HH:MM"
                />
                <Input
                  containerStyle={{ flex: 1 }}
                  label="Overtime End"
                  value={overtimeEnd}
                  onChangeText={setOvertimeEnd}
                  placeholder="HH:MM"
                />
              </View>

              {mode === 'edit' ? (
                <Select label="Status" value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>Notes</Text>
                <TextInput
                  style={styles.textarea}
                  placeholder="Optional notes for this assignment..."
                  placeholderTextColor={Colors.mutedForeground}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={2}
                />
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button
              onPress={handleSubmit}
              disabled={!canSubmit}
              loading={submitting}
              style={{ flex: 1, backgroundColor: Colors.blue600 }}
            >
              {submitting ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Assign Nurse'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 20, width: '100%', maxWidth: 520, maxHeight: '92%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  description: { fontSize: 13, color: Colors.mutedForeground, marginBottom: 14, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  form: { gap: 14, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.foreground },
  textarea: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.foreground,
    backgroundColor: Colors.inputBackground,
  },
  sectionLabel: { fontSize: 12.5, fontWeight: '700', color: Colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: -4 },
  hoursBox: { backgroundColor: Colors.blue50, borderWidth: 1, borderColor: Colors.blue200, borderRadius: Radius.md, padding: 12, gap: 6 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between' },
  hoursLabel: { fontSize: 12.5, color: Colors.blue700, fontWeight: '600' },
  hoursValue: { fontSize: 12.5, color: Colors.blue800, fontWeight: '700' },
  hoursTotalRow: { borderTopWidth: 1, borderTopColor: Colors.blue200, paddingTop: 6, marginTop: 2 },
  hoursTotalLabel: { fontSize: 13, color: Colors.blue800, fontWeight: '700' },
  hoursTotalValue: { fontSize: 14, color: Colors.blue800, fontWeight: '800' },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8, marginTop: -6 },
  availGood: { backgroundColor: Colors.green50, borderColor: Colors.green200 },
  availWarn: { backgroundColor: Colors.orange50, borderColor: Colors.orange300 },
  availBad: { backgroundColor: Colors.red50, borderColor: Colors.red200 },
  availText: { fontSize: 12, fontWeight: '600', flex: 1 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
});
