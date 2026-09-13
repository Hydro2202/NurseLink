import React, { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';

/**
 * App-wide date convention (see also app/signup.tsx, which this generalises):
 *   - Stored/submitted value: ISO 8601 'YYYY-MM-DD', always. That is what
 *     onChange hands back and what `value` must be — never a display string.
 *   - Displayed to the nurse: MM/DD/YYYY, everywhere, via formatDisplayDate.
 * Every calendar-day computation below works in pure y/m/d integers, never
 * through Date.toISOString() or a UTC round-trip — that shifts the day for
 * anyone east of UTC (see my-duty.tsx/dashboard.tsx's toIsoLocal for the
 * same rule applied elsewhere in this app).
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

/** Local calendar 'today' — never UTC, so it matches the device's own clock. */
function todayYmd(): Ymd {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function toIso({ y, m, d }: Ymd): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parses a strict 'YYYY-MM-DD' string. Returns null for anything else,
 * including a technically-ISO string that is not a real calendar date
 * (2025-02-30) — round-tripped the same way signup.tsx's parseDisplayDate
 * validates, but starting from ISO instead of MM/DD/YYYY. */
function parseIso(iso: string | null | undefined): Ymd | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** 0 (Sunday) – 6 (Saturday) for the 1st of the given month. */
function firstWeekday(y: number, m: number): number {
  return new Date(y, m - 1, 1).getDay();
}

function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

/** ISO -> 'MM/DD/YYYY'. Anything not a valid ISO date passes through
 * unchanged, same fallback signup.tsx's formatDisplayDate uses. */
export function formatDisplayDate(iso: string | null | undefined): string {
  const parsed = parseIso(iso);
  if (!parsed) return iso || '';
  return `${pad(parsed.m)}/${pad(parsed.d)}/${parsed.y}`;
}

/** Local 'today' as an ISO string — the usual maxDate for "no future dates". */
export function todayIso(): string {
  return toIso(todayYmd());
}

export interface DatePickerProps {
  /** ISO 'YYYY-MM-DD', or '' / undefined for no date selected. Never a
   * display-formatted string — see the module doc comment. */
  value: string;
  /** Always receives ISO 'YYYY-MM-DD'. */
  onChange: (isoDate: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  /** Shown in the trigger when value is empty. Defaults to the display format
   * itself, which doubles as a format hint. */
  placeholder?: string;
  /** Inclusive. Days, months and years entirely before this are disabled. */
  minDate?: string;
  /** Inclusive. Days, months and years entirely after this are disabled. */
  maxDate?: string;
  disabled?: boolean;
  style?: ViewStyle;
  /** Small helper line under the field, e.g. "Must be before the end date." */
  helperText?: string;
  /** Accessible name for the trigger when `label` isn't descriptive enough
   * on its own (e.g. two date fields sharing a visual label elsewhere). */
  accessibilityLabel?: string;
}

type ViewMode = 'days' | 'months' | 'years';

export function DatePicker({
  value,
  onChange,
  label,
  required,
  error,
  placeholder,
  minDate,
  maxDate,
  disabled,
  style,
  helperText,
  accessibilityLabel,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>('days');
  const selected = useMemo(() => parseIso(value), [value]);
  const min = useMemo(() => parseIso(minDate), [minDate]);
  const max = useMemo(() => parseIso(maxDate), [maxDate]);
  const today = useMemo(() => todayYmd(), []);

  // The month/year currently on screen — seeded from the selected date (or
  // today) each time the picker opens, not kept in sync while closed.
  const [cursor, setCursor] = useState<{ y: number; m: number }>(() => {
    const base = selected || today;
    return { y: base.y, m: base.m };
  });

  const openPicker = () => {
    if (disabled) return;
    const base = selected || today;
    setCursor({ y: base.y, m: base.m });
    setMode('days');
    setOpen(true);
  };

  const close = () => setOpen(false);

  const isBeforeMin = (ymd: Ymd) => (min ? compareYmd(ymd, min) < 0 : false);
  const isAfterMax = (ymd: Ymd) => (max ? compareYmd(ymd, max) > 0 : false);
  const isDisabledDay = (ymd: Ymd) => isBeforeMin(ymd) || isAfterMax(ymd);

  // A month is fully blocked only when every day in it is out of range —
  // partial months (min/max falls inside them) stay open so the boundary
  // day itself is reachable.
  const isMonthBlocked = (y: number, m: number) => {
    const first = { y, m, d: 1 };
    const last = { y, m, d: daysInMonth(y, m) };
    return isAfterMax(first) || isBeforeMin(last);
  };
  // A year is blocked only when the whole year (Jan 1 – Dec 31) falls
  // outside [min, max] — same "block only if fully out of range" rule as
  // isMonthBlocked, one level up.
  const isYearBlocked = (y: number) =>
    isAfterMax({ y, m: 12, d: 31 }) || isBeforeMin({ y, m: 1, d: 1 });

  const selectDay = (d: number) => {
    const ymd = { y: cursor.y, m: cursor.m, d };
    if (isDisabledDay(ymd)) return;
    onChange(toIso(ymd));
    close();
  };

  const goMonth = (delta: number) => {
    setCursor((prev) => {
      let m = prev.m + delta;
      let y = prev.y;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { y, m };
    });
  };

  const clear = () => {
    onChange('');
    close();
  };

  const goToToday = () => {
    if (isDisabledDay(today)) return;
    onChange(toIso(today));
    close();
  };

  const grid = useMemo(() => {
    const total = daysInMonth(cursor.y, cursor.m);
    const lead = firstWeekday(cursor.y, cursor.m);
    const cells: (number | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= total; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  // Years within [min.y, max.y] when bounded, else a century back from today
  // plus a decade forward — generous enough for a birthday or a licence
  // expiry without an unbounded, unusable list.
  const yearRange = useMemo(() => {
    const lo = min ? min.y : today.y - 100;
    const hi = max ? max.y : today.y + 10;
    const years: number[] = [];
    for (let y = hi; y >= lo; y -= 1) years.push(y);
    return years;
  }, [min, max, today.y]);

  const displayValue = value ? formatDisplayDate(value) : '';

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
        accessibilityLabel={accessibilityLabel || label || 'Date'}
        accessibilityHint="Opens a calendar to choose a date"
        accessibilityState={{ disabled: !!disabled }}
        style={[
          styles.trigger,
          error ? styles.triggerError : null,
          disabled ? styles.triggerDisabled : null,
        ]}
      >
        <Calendar size={16} color={disabled ? Colors.gray400 : Colors.mutedForeground} />
        <Text
          style={[styles.triggerText, !displayValue && styles.placeholder]}
          numberOfLines={1}
        >
          {displayValue || placeholder || 'MM/DD/YYYY'}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && helperText ? <Text style={styles.helper}>{helperText}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, Shadows.lg]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label || 'Select date'}</Text>
              <Pressable
                onPress={close}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={20} color={Colors.gray500} />
              </Pressable>
            </View>

            {mode === 'days' ? (
              <>
                <View style={styles.navRow}>
                  <Pressable
                    onPress={() => goMonth(-1)}
                    style={styles.navBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Previous month"
                  >
                    <ChevronLeft size={18} color={Colors.blue700} />
                  </Pressable>
                  <Pressable
                    onPress={() => setMode('months')}
                    style={styles.navTitleBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Choose a different month or year"
                  >
                    <Text style={styles.navTitle}>
                      {MONTH_NAMES[cursor.m - 1]} {cursor.y}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => goMonth(1)}
                    style={styles.navBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Next month"
                  >
                    <ChevronRight size={18} color={Colors.blue700} />
                  </Pressable>
                </View>

                <View style={styles.weekdayRow}>
                  {WEEKDAY_SHORT.map((w) => (
                    <Text key={w} style={styles.weekdayText}>{w}</Text>
                  ))}
                </View>

                <View style={styles.dayGrid}>
                  {grid.map((d, i) => {
                    if (d === null) return <View key={`blank-${i}`} style={styles.dayCell} />;
                    const ymd = { y: cursor.y, m: cursor.m, d };
                    const isSelected = !!selected && compareYmd(ymd, selected) === 0;
                    const isToday = compareYmd(ymd, today) === 0;
                    const blocked = isDisabledDay(ymd);
                    return (
                      <Pressable
                        key={`d-${d}`}
                        onPress={() => selectDay(d)}
                        disabled={blocked}
                        accessibilityRole="button"
                        accessibilityLabel={`${MONTH_NAMES[cursor.m - 1]} ${d}, ${cursor.y}`}
                        accessibilityState={{ selected: isSelected, disabled: blocked }}
                        style={styles.dayCell}
                      >
                        <View
                          style={[
                            styles.dayInner,
                            isSelected && styles.daySelected,
                            isToday && !isSelected && styles.dayToday,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayText,
                              isSelected && styles.dayTextSelected,
                              blocked && styles.dayTextDisabled,
                            ]}
                          >
                            {d}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : mode === 'months' ? (
              <>
                <View style={styles.navRow}>
                  <Pressable
                    onPress={() => setCursor((c) => ({ ...c, y: c.y - 1 }))}
                    style={styles.navBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Previous year"
                  >
                    <ChevronLeft size={18} color={Colors.blue700} />
                  </Pressable>
                  <Pressable
                    onPress={() => setMode('years')}
                    style={styles.navTitleBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Choose a different year"
                  >
                    <Text style={styles.navTitle}>{cursor.y}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCursor((c) => ({ ...c, y: c.y + 1 }))}
                    style={styles.navBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Next year"
                  >
                    <ChevronRight size={18} color={Colors.blue700} />
                  </Pressable>
                </View>
                <View style={styles.monthGrid}>
                  {MONTH_SHORT.map((label2, idx) => {
                    const m = idx + 1;
                    const blocked = isMonthBlocked(cursor.y, m);
                    const isCurrentSelection = cursor.m === m;
                    return (
                      <Pressable
                        key={label2}
                        disabled={blocked}
                        onPress={() => {
                          setCursor((c) => ({ ...c, m }));
                          setMode('days');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${MONTH_NAMES[idx]} ${cursor.y}`}
                        accessibilityState={{ disabled: blocked, selected: isCurrentSelection }}
                        style={[styles.monthCell, isCurrentSelection && styles.monthCellActive]}
                      >
                        <Text
                          style={[
                            styles.monthText,
                            isCurrentSelection && styles.monthTextActive,
                            blocked && styles.dayTextDisabled,
                          ]}
                        >
                          {label2}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : (
              <ScrollView style={styles.yearList}>
                {yearRange.map((y) => {
                  const blocked = isYearBlocked(y);
                  const isCurrentSelection = cursor.y === y;
                  return (
                    <Pressable
                      key={y}
                      disabled={blocked}
                      onPress={() => {
                        setCursor((c) => ({ ...c, y }));
                        setMode('months');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Year ${y}`}
                      accessibilityState={{ disabled: blocked, selected: isCurrentSelection }}
                      style={[styles.yearRow, isCurrentSelection && styles.yearRowActive]}
                    >
                      <Text
                        style={[
                          styles.yearText,
                          isCurrentSelection && styles.yearTextActive,
                          blocked && styles.dayTextDisabled,
                        ]}
                      >
                        {y}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.footer}>
              <Pressable onPress={clear} style={styles.footerBtn} accessibilityRole="button">
                <Text style={styles.footerBtnText}>Clear</Text>
              </Pressable>
              <Pressable
                onPress={goToToday}
                disabled={isDisabledDay(today)}
                style={styles.footerBtn}
                accessibilityRole="button"
              >
                <Text style={[styles.footerBtnText, isDisabledDay(today) && styles.dayTextDisabled]}>
                  Today
                </Text>
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
    maxWidth: 360,
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitleBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.md },
  navTitle: { fontSize: 14.5, fontWeight: '700', color: Colors.blue800 },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 8 },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.mutedForeground,
    paddingBottom: 4,
  },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingBottom: 8 },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: Colors.blue600 },
  dayToday: { borderWidth: 1, borderColor: Colors.blue300 },
  dayText: { fontSize: 13.5, color: Colors.foreground },
  dayTextSelected: { color: Colors.white, fontWeight: '700' },
  dayTextDisabled: { color: Colors.gray300 },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  monthCell: {
    width: '30%',
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: 'center',
    backgroundColor: Colors.gray50,
  },
  monthCellActive: { backgroundColor: Colors.blue600 },
  monthText: { fontSize: 13.5, fontWeight: '600', color: Colors.foreground },
  monthTextActive: { color: Colors.white },
  yearList: { maxHeight: 280 },
  yearRow: { paddingVertical: 12, paddingHorizontal: 20 },
  yearRowActive: { backgroundColor: Colors.blue50 },
  yearText: { fontSize: 14.5, color: Colors.foreground, textAlign: 'center' },
  yearTextActive: { color: Colors.blue700, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 4,
  },
  footerBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  footerBtnText: { fontSize: 13.5, fontWeight: '600', color: Colors.mutedForeground },
  footerBtnTextPrimary: { color: Colors.blue700, fontWeight: '700' },
});
