import React, { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { Clock, X } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';

/**
 * Two time conventions already exist in this app, each tied to what the
 * field has always stored and displayed — this component preserves both
 * rather than forcing one, so no backend or display code needs to change:
 *   - '24h': 'HH:MM', zero-padded 24-hour (Task.dueTime, DutyAssignment's
 *     start/end/overtime times). e.g. '07:00', '15:30'.
 *   - '12h': 'h:mm AM/PM' (TaskVitalSignsBars' monitoring time). e.g.
 *     '8:00 AM'. Matches the TIME_PATTERN that already parses it there.
 * Minutes are offered in 5-minute steps — every existing stored value in
 * this app lands on :00 or :30, and full 60-value-per-hour scrolling isn't
 * warranted for shift/monitoring times that are always planned in advance.
 */

const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function roundToStep(n: number): number {
  return Math.round(n / MINUTE_STEP) * MINUTE_STEP;
}

interface ParsedTime {
  hour: number; // 24h internally, always — 0-23
  minute: number;
  isPm: boolean; // derived, kept for display convenience in 12h mode
}

function parse24(value: string): ParsedTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, isPm: hour >= 12 };
}

function parse12(value: string): ParsedTime | null {
  const match = /^(0?[1-9]|1[0-2]):([0-5]\d)\s?([AaPp][Mm])$/.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const isPm = match[3].toLowerCase() === 'pm';
  if (hour === 12) hour = 0;
  if (isPm) hour += 12;
  return { hour, minute, isPm };
}

function format24(t: ParsedTime): string {
  return `${pad(t.hour)}:${pad(t.minute)}`;
}

function format12(t: ParsedTime): string {
  let h12 = t.hour % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad(t.minute)} ${t.isPm ? 'PM' : 'AM'}`;
}

function nowParsed(): ParsedTime {
  const d = new Date();
  const hour = d.getHours();
  const minute = roundToStep(d.getMinutes()) % 60;
  return { hour, minute, isPm: hour >= 12 };
}

export interface TimePickerProps {
  /** In the format given by `format` — see the module doc comment. Empty
   * string for no time selected. */
  value: string;
  onChange: (time: string) => void;
  /** Which stored/display convention this field uses. Default '24h'. */
  format?: '24h' | '12h';
  label?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: ViewStyle;
  helperText?: string;
  accessibilityLabel?: string;
}

export function TimePicker({
  value,
  onChange,
  format = '24h',
  label,
  required,
  error,
  placeholder,
  disabled,
  style,
  helperText,
  accessibilityLabel,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const formatOut = format === '12h' ? format12 : format24;
  const parsed = useMemo(
    () => (format === '12h' ? parse12(value) : parse24(value)),
    [value, format]
  );

  // Draft selection while the sheet is open — committed to onChange only on
  // "Done" or a direct tap, same two-step feel as DatePicker's day grid
  // (tap commits immediately there; here Hour/Minute/AM-PM are three
  // separate choices, so a draft avoids firing onChange after every one).
  const [draftHour, setDraftHour] = useState(0);
  const [draftMinute, setDraftMinute] = useState(0);
  const [draftPm, setDraftPm] = useState(false);

  const openPicker = () => {
    if (disabled) return;
    const base = parsed || nowParsed();
    setDraftHour(base.hour);
    setDraftMinute(roundToStep(base.minute) % 60);
    setDraftPm(base.isPm);
    setOpen(true);
  };

  const close = () => setOpen(false);

  const commit = (hour: number, minute: number, isPm: boolean) => {
    onChange(formatOut({ hour, minute, isPm }));
  };

  const selectHour = (h: number) => {
    // In 12h mode the wheel shows 1-12; convert to the internal 0-23 value
    // using the draft's current AM/PM before committing.
    const hour24 = format === '12h' ? (h % 12) + (draftPm ? 12 : 0) : h;
    setDraftHour(hour24);
    commit(hour24, draftMinute, draftPm);
  };

  const selectMinute = (m: number) => {
    setDraftMinute(m);
    commit(draftHour, m, draftPm);
  };

  const selectAmPm = (isPm: boolean) => {
    const hour24 = (draftHour % 12) + (isPm ? 12 : 0);
    setDraftHour(hour24);
    setDraftPm(isPm);
    commit(hour24, draftMinute, isPm);
  };

  const clear = () => {
    onChange('');
    close();
  };

  const setNow = () => {
    const t = nowParsed();
    setDraftHour(t.hour);
    setDraftMinute(t.minute);
    setDraftPm(t.isPm);
    commit(t.hour, t.minute, t.isPm);
    close();
  };

  const displayValue = parsed ? formatOut(parsed) : value ? value : '';
  const displayHour12 = draftHour % 12 === 0 ? 12 : draftHour % 12;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}
      <Pressable
        onPress={openPicker}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label || 'Time'}
        accessibilityHint="Opens a time picker"
        accessibilityState={{ disabled: !!disabled }}
        style={[
          styles.trigger,
          error ? styles.triggerError : null,
          disabled ? styles.triggerDisabled : null,
        ]}
      >
        <Clock size={16} color={disabled ? Colors.gray400 : Colors.mutedForeground} />
        <Text style={[styles.triggerText, !displayValue && styles.placeholder]} numberOfLines={1}>
          {displayValue || placeholder || (format === '12h' ? 'h:mm AM/PM' : 'HH:MM')}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && helperText ? <Text style={styles.helper}>{helperText}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, Shadows.lg]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label || 'Select time'}</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.gray500} />
              </Pressable>
            </View>

            <View style={styles.wheelsRow}>
              <View style={styles.wheelCol}>
                <Text style={styles.wheelLabel}>Hour</Text>
                <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
                  {(format === '12h' ? HOURS_12 : HOURS_24).map((h) => {
                    const isSelected =
                      format === '12h' ? displayHour12 === h : draftHour === h;
                    return (
                      <Pressable
                        key={h}
                        onPress={() => selectHour(h)}
                        style={[styles.wheelCell, isSelected && styles.wheelCellActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text style={[styles.wheelText, isSelected && styles.wheelTextActive]}>
                          {format === '12h' ? h : pad(h)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <Text style={styles.wheelColon}>:</Text>

              <View style={styles.wheelCol}>
                <Text style={styles.wheelLabel}>Minute</Text>
                <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
                  {MINUTES.map((m) => {
                    const isSelected = draftMinute === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => selectMinute(m)}
                        style={[styles.wheelCell, isSelected && styles.wheelCellActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text style={[styles.wheelText, isSelected && styles.wheelTextActive]}>
                          {pad(m)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {format === '12h' ? (
                <View style={styles.ampmCol}>
                  <Pressable
                    onPress={() => selectAmPm(false)}
                    style={[styles.ampmBtn, !draftPm && styles.ampmBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !draftPm }}
                  >
                    <Text style={[styles.ampmText, !draftPm && styles.ampmTextActive]}>AM</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => selectAmPm(true)}
                    style={[styles.ampmBtn, draftPm && styles.ampmBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draftPm }}
                  >
                    <Text style={[styles.ampmText, draftPm && styles.ampmTextActive]}>PM</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <View style={styles.footer}>
              <Pressable onPress={clear} style={styles.footerBtn} accessibilityRole="button">
                <Text style={styles.footerBtnText}>Clear</Text>
              </Pressable>
              <Pressable onPress={setNow} style={styles.footerBtn} accessibilityRole="button">
                <Text style={styles.footerBtnText}>Now</Text>
              </Pressable>
              <Pressable onPress={close} style={styles.footerBtn} accessibilityRole="button">
                <Text style={[styles.footerBtnText, styles.footerBtnTextPrimary]}>Done</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500', color: Colors.foreground },
  required: { color: Colors.destructive },
  trigger: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBackground,
    gap: 8,
  },
  triggerError: { borderColor: Colors.destructive },
  triggerDisabled: { opacity: 0.5 },
  triggerText: { flex: 1, fontSize: 14, color: Colors.foreground },
  placeholder: { color: Colors.mutedForeground },
  error: { fontSize: 12, color: Colors.destructive },
  helper: { fontSize: 12, color: Colors.mutedForeground },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
    paddingBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  wheelsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  wheelCol: { alignItems: 'center', width: 72 },
  wheelLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  wheel: { height: 220, width: '100%' },
  wheelCell: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  wheelCellActive: { backgroundColor: Colors.blue600 },
  wheelText: { fontSize: 16, color: Colors.foreground },
  wheelTextActive: { color: Colors.white, fontWeight: '700' },
  wheelColon: { fontSize: 20, fontWeight: '700', color: Colors.gray400, marginTop: 34 },
  ampmCol: { gap: 8, marginTop: 22 },
  ampmBtn: {
    width: 56,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  ampmBtnActive: { backgroundColor: Colors.blue600, borderColor: Colors.blue600 },
  ampmText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  ampmTextActive: { color: Colors.white },
  footer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 12,
  },
  footerBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  footerBtnText: { fontSize: 13.5, fontWeight: '600', color: Colors.mutedForeground },
  footerBtnTextPrimary: { color: Colors.blue700, fontWeight: '700' },
});
