import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Animated,
  useWindowDimensions,
} from 'react-native';
import {
  CalendarDays,
  Plus,
  Search,
  Sun,
  Moon,
  MoonStar,
  Clock,
  AlertTriangle,
  Building2,
  Edit2,
  Trash2,
  RefreshCw,
  X,
  List,
  LayoutGrid,
  StopCircle,
  ShieldAlert,
} from 'lucide-react-native';
import {
  fetchDutyAssignments,
  deleteDutyAssignment,
  closeDutyAssignment,
  fetchDepartments,
  fetchNurses,
  ApiError,
} from '../../services/api';
import type { Department, DutyAssignment, Nurse } from '../../types/domain';
import { Card, CardContent } from '../../components/Card';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Alert, AlertDescription } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DutyAssignmentModal } from '../../components/DutyAssignmentModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../../constants/colors';

type DateFilter = 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'custom' | 'all';
type ViewMode = 'list' | 'weekly';

const SHIFT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Evening', night: 'Night' };

// One color language, reused for the shift accent on every card, the
// weekly-view entries, and the department workload dots.
const SHIFT_COLORS: Record<string, { color: string; bg: string; border: string; icon: typeof Sun }> = {
  morning: { color: Colors.orange600, bg: Colors.orange50, border: Colors.orange300, icon: Sun },
  afternoon: { color: Colors.purple600, bg: Colors.purple50, border: Colors.purple100, icon: Moon },
  night: { color: Colors.blue900, bg: Colors.blue50, border: Colors.blue200, icon: MoonStar },
};
// Same status vocabulary as the rest of NurseLink (scheduled=blue,
// completed=gray, cancelled=red), extended with in-progress=green.
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  scheduled: { color: Colors.blue700, bg: Colors.blue50 },
  in_progress: { color: Colors.green700, bg: Colors.green50 },
  completed: { color: Colors.gray600, bg: Colors.gray100 },
  cancelled: { color: Colors.red700, bg: Colors.red50 },
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso() {
  return toIso(new Date());
}
function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIso(d);
}
function startOfWeek(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // back up to Monday
  d.setDate(d.getDate() + diff);
  return toIso(d);
}
function formatDateLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${period}`;
}
// actualStartTime/actualEndTime come from the backend as full ISO
// datetimes (unlike the scheduled startTime/endTime "HH:MM" strings), so
// they need the Date constructor rather than the string-split helper above.
function formatActualTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(d.getMinutes())} ${period}`;
}
// duty_date + "HH:MM" as a real Date, purely from local calendar parts —
// same wrap-past-midnight rule as DutyAssignment.duration_hours on the
// backend (end_time <= start_time means the shift ends the next day).
function combine(dateIso: string, hhmm: string): Date {
  const [y, mo, da] = dateIso.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, da, h, m, 0, 0);
}
function scheduledEnd(a: DutyAssignment): Date {
  const start = combine(a.dutyDate, a.startTime.slice(0, 5));
  let end = combine(a.dutyDate, a.endTime.slice(0, 5));
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
  return end;
}
function formatDurationShort(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
// "+Xh Ym" beside the shift time — null (render nothing) when there is no
// overtime to show. Live while clocked in past the scheduled end, frozen to
// the backend's own actualOvertimeHours once the shift has been ended.
function liveOvertimeLabel(a: DutyAssignment, now: Date): string | null {
  if (a.actualEndTime) {
    return a.actualOvertimeHours > 0 ? formatDurationShort(a.actualOvertimeHours * 60) : null;
  }
  if (a.actualStartTime) {
    const minutesPast = (now.getTime() - scheduledEnd(a).getTime()) / 60000;
    return minutesPast > 0 ? formatDurationShort(minutesPast) : null;
  }
  return null;
}
// The number this page sums for "Overtime Today" — real/live attendance
// data takes priority, the scheduled overtimeHours is only the fallback for
// a shift nobody has clocked into yet.
function effectiveOvertimeHours(a: DutyAssignment, now: Date): number {
  if (a.actualEndTime) return a.actualOvertimeHours;
  if (a.actualStartTime) {
    const ms = now.getTime() - scheduledEnd(a).getTime();
    return ms > 0 ? Math.round((ms / 3600000) * 100) / 100 : 0;
  }
  return a.overtimeHours;
}

type AttendanceStatus = 'live' | 'overtimeLive' | 'completed' | 'overtimeDone';
// Real clock-in/out overrides the administrative status field the moment it
// exists; a shift nobody has started yet (or one marked cancelled) keeps
// showing the existing status/statusLabel exactly as before.
function attendanceStatus(a: DutyAssignment, now: Date): AttendanceStatus | null {
  if (a.status === 'cancelled') return null;
  if (a.actualEndTime) return a.actualOvertimeHours > 0 ? 'overtimeDone' : 'completed';
  if (a.actualStartTime) return now.getTime() < scheduledEnd(a).getTime() ? 'live' : 'overtimeLive';
  return null;
}
const ATTENDANCE_CONFIG: Record<AttendanceStatus, { label: string; color: string; bg: string; live?: boolean }> = {
  live: { label: 'On Duty (Live)', color: Colors.green700, bg: Colors.green50, live: true },
  overtimeLive: { label: 'Overtime (Live)', color: Colors.red700, bg: Colors.red50, live: true },
  completed: { label: 'Completed', color: Colors.gray600, bg: Colors.gray100 },
  overtimeDone: { label: 'Completed — Overtime', color: Colors.red700, bg: Colors.red50 },
};
// A nurse still clocked in this long past their scheduled end is more
// likely a forgotten clock-out than real overtime — flagged distinctly so
// a head nurse can follow up, never auto-guessed or silently closed out.
const MISSED_CLOCKOUT_MINUTES = 120;
function isMissedClockout(a: DutyAssignment, now: Date): boolean {
  if (!a.actualStartTime || a.actualEndTime) return false;
  return (now.getTime() - scheduledEnd(a).getTime()) / 60000 > MISSED_CLOCKOUT_MINUTES;
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
// Deterministic so the same nurse always gets the same avatar color across
// cards, without needing a stored color field.
function avatarHue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export default function DutyRosterPage() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'head_nurse';
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isNarrow = width < 640;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [assignments, setAssignments] = useState<DutyAssignment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [nurses, setNurses] = useState<Nurse[]>([]);

  const [view, setView] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('week');
  const [customDate, setCustomDate] = useState(todayIso());
  const [shiftFilter, setShiftFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editing, setEditing] = useState<DutyAssignment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DutyAssignment | null>(null);
  const [deleting, setDeleting] = useState(false);
  // A head nurse manually closing out a shift the nurse forgot to end — kept
  // separate from delete's dialog so it reads distinctly (correction, not removal).
  const [closeOpen, setCloseOpen] = useState(false);
  const [toClose, setToClose] = useState<DutyAssignment | null>(null);
  const [closing, setClosing] = useState(false);
  // Briefly highlighted so a head nurse can visually confirm their edit/add
  // actually landed, rather than the list just silently reflowing.
  const [justSavedId, setJustSavedId] = useState<number | null>(null);
  const [now, setNow] = useState(new Date());

  const loadData = async () => {
    try {
      const from = addDays(todayIso(), -30);
      const to = addDays(todayIso(), 90);
      const [assignmentData, departmentData, nurseData] = await Promise.all([
        fetchDutyAssignments({ dateFrom: from, dateTo: to }),
        fetchDepartments(),
        fetchNurses(),
      ]);
      setAssignments(assignmentData);
      setDepartments(departmentData);
      setNurses(nurseData);
      setLoadError('');
    } catch (error) {
      setLoadError(
        error instanceof ApiError
          ? error.message
          : 'Unable to load the duty roster. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keeps live status/overtime honest between refreshes, without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  // "Overtime Today" and every live status badge reflect real, live clock
  // data — this is the "reasonable polling interval" refresh that catches a
  // nurse starting/ending a shift on another device, so a head nurse
  // watching this page does not have to manually reload to see it.
  useEffect(() => {
    const id = setInterval(() => {
      void loadData();
    }, 120000);
    return () => clearInterval(id);
  }, []);

  // One continuous pulse, shared by every "live" status dot on the page —
  // cheaper than a separate animated value per card, and keeps every pulse
  // in sync.
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const today = todayIso();

  const dateRange = useMemo((): [string, string] | null => {
    switch (dateFilter) {
      case 'today':
        return [today, today];
      case 'tomorrow': {
        const t = addDays(today, 1);
        return [t, t];
      }
      case 'week': {
        const start = startOfWeek(today);
        return [start, addDays(start, 6)];
      }
      case 'nextWeek': {
        const start = addDays(startOfWeek(today), 7);
        return [start, addDays(start, 6)];
      }
      case 'custom':
        return [customDate, customDate];
      case 'all':
      default:
        return null;
    }
  }, [dateFilter, customDate, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments
      .filter((a) => {
        if (dateRange && (a.dutyDate < dateRange[0] || a.dutyDate > dateRange[1])) return false;
        if (shiftFilter && a.shift !== shiftFilter) return false;
        if (deptFilter && String(a.departmentId) !== deptFilter) return false;
        if (statusFilter && a.status !== statusFilter) return false;
        if (
          q &&
          !(
            a.nurseName.toLowerCase().includes(q) ||
            a.departmentName.toLowerCase().includes(q) ||
            SHIFT_LABELS[a.shift]?.toLowerCase().includes(q) ||
            a.dutyDate.includes(q)
          )
        )
          return false;
        return true;
      })
      .sort((a, b) => (a.dutyDate + a.startTime).localeCompare(b.dutyDate + b.startTime));
  }, [assignments, dateRange, shiftFilter, deptFilter, statusFilter, search]);

  const todaysActive = useMemo(
    () => assignments.filter((a) => a.dutyDate === today && a.status !== 'cancelled'),
    [assignments, today]
  );
  const summary = useMemo(
    () => ({
      todayCount: todaysActive.length,
      morningCount: todaysActive.filter((a) => a.shift === 'morning').length,
      eveningCount: todaysActive.filter((a) => a.shift === 'afternoon').length,
      // Real/live attendance data, not just the originally-scheduled figure —
      // a nurse currently in overtime counts here before anyone ends the
      // shift, ticking up the same way the card-level labels do.
      overtimeHours:
        Math.round(todaysActive.reduce((sum, a) => sum + effectiveOvertimeHours(a, now), 0) * 100) / 100,
    }),
    [todaysActive, now]
  );

  const departmentWorkload = useMemo(() => {
    const map = new Map<string, { morning: number; afternoon: number; night: number }>();
    todaysActive.forEach((a) => {
      const row = map.get(a.departmentName) || { morning: 0, afternoon: 0, night: 0 };
      row[a.shift as 'morning' | 'afternoon' | 'night'] += 1;
      map.set(a.departmentName, row);
    });
    // Busiest department first, so a head nurse sees where the day's
    // weight actually is without reading every row.
    return Array.from(map.entries()).sort((a, b) => {
      const totalA = a[1].morning + a[1].afternoon + a[1].night;
      const totalB = b[1].morning + b[1].afternoon + b[1].night;
      return totalB - totalA || a[0].localeCompare(b[0]);
    });
  }, [todaysActive]);

  const weekDays = useMemo(() => {
    const anchor = dateFilter === 'custom' ? customDate : dateFilter === 'nextWeek' ? addDays(today, 7) : today;
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [dateFilter, customDate, today]);

  const openAdd = () => {
    setModalMode('add');
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (a: DutyAssignment) => {
    setModalMode('edit');
    setEditing(a);
    setModalOpen(true);
  };
  const askDelete = (a: DutyAssignment) => {
    setToDelete(a);
    setDeleteOpen(true);
  };
  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteDutyAssignment(toDelete.id);
      toast.success('Duty Assignment Deleted', {
        description: `${toDelete.nurseName}'s duty on ${formatDateLabel(toDelete.dutyDate)} was removed.`,
      });
      setDeleteOpen(false);
      setToDelete(null);
      await loadData();
    } catch (error) {
      toast.error('Failed to delete assignment', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setDeleting(false);
    }
  };
  const askClose = (a: DutyAssignment) => {
    setToClose(a);
    setCloseOpen(true);
  };
  const confirmClose = async () => {
    if (!toClose) return;
    setClosing(true);
    try {
      await closeDutyAssignment(toClose.id);
      toast.success('Shift Closed Out', {
        description: `${toClose.nurseName}'s shift was ended now and logged as a head nurse correction.`,
      });
      setCloseOpen(false);
      setToClose(null);
      await loadData();
    } catch (error) {
      toast.error('Failed to close shift', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setClosing(false);
    }
  };
  const handleSaved = (saved: DutyAssignment) => {
    setJustSavedId(saved.id);
    void loadData();
    setTimeout(() => setJustSavedId(null), 2200);
  };

  const dateFilterOptions = [
    { label: 'Today', value: 'today' },
    { label: 'Tomorrow', value: 'tomorrow' },
    { label: 'This Week', value: 'week' },
    { label: 'Next Week', value: 'nextWeek' },
    { label: 'Custom Date', value: 'custom' },
    { label: 'All Upcoming', value: 'all' },
  ];
  const shiftOptions = [
    { label: 'All Shifts', value: '' },
    { label: 'Morning', value: 'morning' },
    { label: 'Evening', value: 'afternoon' },
    { label: 'Night', value: 'night' },
  ];
  const deptOptions = [
    { label: 'All Departments', value: '' },
    ...departments.map((d) => ({ label: d.name, value: String(d.id) })),
  ];
  const statusOptions = [
    { label: 'All Statuses', value: '' },
    { label: 'Scheduled', value: 'scheduled' },
    { label: 'In Progress', value: 'in_progress' },
    { label: 'Completed', value: 'completed' },
    { label: 'Cancelled', value: 'cancelled' },
  ];

  const filtersActive = dateFilter !== 'week' || !!shiftFilter || !!deptFilter || !!statusFilter;
  const clearFilters = () => {
    setDateFilter('week');
    setShiftFilter('');
    setDeptFilter('');
    setStatusFilter('');
  };

  // Crossfade the list/weekly body whenever the view or the filtered result
  // changes, instead of an abrupt re-render.
  const bodyAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    bodyAnim.setValue(0);
    Animated.timing(bodyAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [view, filtered.length, bodyAnim]);

  const renderCard = (a: DutyAssignment) => {
    const shiftColors = SHIFT_COLORS[a.shift] || SHIFT_COLORS.morning;
    const attendance = attendanceStatus(a, now);
    // Real attendance overrides the administrative status badge the moment
    // it exists; a shift nobody has started (or one marked cancelled) keeps
    // showing the existing status exactly as before.
    const badge = attendance
      ? ATTENDANCE_CONFIG[attendance]
      : { label: a.statusLabel, ...(STATUS_COLORS[a.status] || STATUS_COLORS.scheduled) };
    const otLabel = liveOvertimeLabel(a, now);
    const effectiveOT = effectiveOvertimeHours(a, now);
    const missedClockout = isMissedClockout(a, now);
    const highlighted = justSavedId === a.id;
    return (
      <Pressable key={a.id} style={({ hovered }: { hovered?: boolean }) => (hovered ? styles.assignCardHover : null)}>
        <Card
          style={{
            ...styles.assignCard,
            borderLeftColor: shiftColors.color,
            ...(highlighted ? styles.assignCardHighlighted : null),
          }}
        >
          <CardContent style={styles.assignCardBody}>
            <View style={styles.assignHeaderRow}>
              <View style={styles.assignNurseRow}>
                <View style={[styles.avatar, { backgroundColor: `hsl(${avatarHue(a.nurseName)} 60% 42%)` }]}>
                  <Text style={styles.avatarText}>{initials(a.nurseName)}</Text>
                </View>
                <Text style={styles.assignNurse} numberOfLines={1}>{a.nurseName}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: badge.bg }]}>
                {badge.live ? (
                  <Animated.View style={[styles.liveDot, { backgroundColor: badge.color, opacity: pulseAnim }]} />
                ) : null}
                <Text style={[styles.statusPillText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            </View>

            {missedClockout ? (
              <View style={styles.missedClockoutTag}>
                <AlertTriangle size={11} color={Colors.red700} />
                <Text style={styles.missedClockoutText}>Not clocked out — needs follow-up</Text>
              </View>
            ) : null}

            <View style={styles.assignMetaWrap}>
              <View style={styles.assignMetaRow}>
                <Building2 size={12.5} color={Colors.mutedForeground} />
                <Text style={styles.assignMetaText}>{a.departmentName}</Text>
              </View>
              <View style={styles.assignMetaRow}>
                <CalendarDays size={12.5} color={Colors.mutedForeground} />
                <Text style={styles.assignMetaText}>{formatDateLabel(a.dutyDate)}</Text>
              </View>
              <View style={[styles.shiftTag, { backgroundColor: shiftColors.bg }]}>
                <Clock size={11} color={shiftColors.color} />
                <Text style={[styles.shiftTagText, { color: shiftColors.color }]}>
                  {SHIFT_LABELS[a.shift] || a.shift} · {formatTime(a.startTime)}–{formatTime(a.endTime)}
                </Text>
              </View>
              {otLabel ? <Text style={styles.overtimeInline}>Overtime +{otLabel}</Text> : null}
            </View>

            {a.actualStartTime ? (
              <Text style={styles.actualTimeText}>
                Started: {formatActualTime(a.actualStartTime)}
                {a.actualEndTime ? ` · Ended: ${formatActualTime(a.actualEndTime)}` : ''}
              </Text>
            ) : null}
            {a.actualEndRecordedBy ? (
              <View style={styles.closedByTag}>
                <ShieldAlert size={11} color={Colors.orange700} />
                <Text style={styles.closedByText}>Closed by {a.actualEndRecordedBy} (head nurse correction)</Text>
              </View>
            ) : null}

            <View style={styles.footerRow}>
              <View style={styles.hoursRow}>
                <Text style={styles.hoursChip}>Reg {a.regularHours}h</Text>
                {effectiveOT > 0 ? (
                  <Text style={[styles.hoursChip, styles.hoursChipOT]}>OT {effectiveOT}h</Text>
                ) : null}
                <Text style={styles.hoursChip}>Total {Math.round((a.regularHours + effectiveOT) * 100) / 100}h</Text>
              </View>
              {isSupervisor ? (
                <View style={styles.cardActions}>
                  {a.actualStartTime && !a.actualEndTime ? (
                    <Pressable onPress={() => askClose(a)} style={styles.iconTextBtn} hitSlop={6}>
                      <StopCircle size={13} color={Colors.orange700} />
                      <Text style={[styles.iconTextBtnLabel, { color: Colors.orange700 }]}>Close Shift</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => openEdit(a)} style={styles.iconTextBtn} hitSlop={6}>
                    <Edit2 size={13} color={Colors.gray600} />
                    <Text style={styles.iconTextBtnLabel}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => askDelete(a)} style={styles.iconTextBtn} hitSlop={6}>
                    <Trash2 size={13} color={Colors.destructive} />
                    <Text style={[styles.iconTextBtnLabel, { color: Colors.destructive }]}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </CardContent>
        </Card>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View>
          <Text style={styles.title}>Duty Roster</Text>
          <Text style={styles.subtitle}>Manage nurse schedules, departments, shifts, and overtime</Text>
        </View>

        <Alert variant="info">
          <AlertDescription>
            Manage staff assignments and monitor scheduled working hours and overtime. Only authorized
            head nurses can create or modify duty assignments.
          </AlertDescription>
        </Alert>

        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
            <Button size="sm" variant="outline" onPress={loadData} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
              <RefreshCw size={13} color={Colors.foreground} />
              <Text style={{ marginLeft: 6 }}>Retry</Text>
            </Button>
          </Alert>
        ) : null}

        <View style={styles.summaryGrid}>
          {[
            { key: 'today', icon: CalendarDays, value: summary.todayCount, label: "Today's Duty", color: Colors.blue600, bg: Colors.blue50 },
            { key: 'morning', icon: Sun, value: summary.morningCount, label: 'Morning Shift', color: Colors.orange600, bg: Colors.orange50 },
            { key: 'evening', icon: Moon, value: summary.eveningCount, label: 'Evening Shift', color: Colors.purple600, bg: Colors.purple50 },
            {
              key: 'overtime',
              icon: AlertTriangle,
              value: `${summary.overtimeHours}h`,
              label: 'Overtime Today',
              color: summary.overtimeHours > 0 ? Colors.red600 : Colors.gray400,
              bg: summary.overtimeHours > 0 ? Colors.red50 : Colors.gray50,
            },
          ].map((card) => (
            <Pressable
              key={card.key}
              style={({ hovered }: { hovered?: boolean }) => [
                styles.summaryCardWrap,
                { flexBasis: isNarrow ? '47%' : 150 },
                hovered && styles.summaryCardHover,
              ]}
            >
              <Card style={{ ...styles.summaryCard, borderLeftColor: card.color }}>
                <CardContent style={styles.summaryCardBody}>
                  <View style={[styles.summaryIconWrap, { backgroundColor: card.bg }]}>
                    <card.icon size={15} color={card.color} />
                  </View>
                  <Text style={styles.summaryValue}>{card.value}</Text>
                  <Text style={styles.summaryLabel}>{card.label}</Text>
                </CardContent>
              </Card>
            </Pressable>
          ))}
        </View>

        <View style={styles.controls}>
          <View style={styles.searchWrap}>
            <Input
              placeholder="Search by nurse, department, shift, or date..."
              value={search}
              onChangeText={setSearch}
              leftIcon={<Search size={18} color={Colors.mutedForeground} />}
            />
          </View>
          {isSupervisor ? (
            <Button onPress={openAdd} style={styles.newBtn}>
              <Plus size={17} color={Colors.white} />
              <Text style={styles.newBtnText}>Assign Nurse</Text>
            </Button>
          ) : null}
        </View>

        <View style={styles.filterBar}>
          <View style={styles.filterRow}>
            <Select
              value={dateFilter}
              onValueChange={(v) => setDateFilter(v as DateFilter)}
              options={dateFilterOptions}
              style={dateFilter !== 'week' ? { ...styles.filterSelect, ...styles.filterSelectActive } : styles.filterSelect}
            />
            {dateFilter === 'custom' ? (
              <Input value={customDate} onChangeText={setCustomDate} placeholder="YYYY-MM-DD" containerStyle={styles.customDateInput} />
            ) : null}
            <Select
              value={shiftFilter}
              onValueChange={setShiftFilter}
              options={shiftOptions}
              style={shiftFilter ? { ...styles.filterSelect, ...styles.filterSelectActive } : styles.filterSelect}
            />
            <Select
              value={deptFilter}
              onValueChange={setDeptFilter}
              options={deptOptions}
              style={deptFilter ? { ...styles.filterSelect, ...styles.filterSelectActive } : styles.filterSelect}
              searchable
            />
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={statusOptions}
              style={statusFilter ? { ...styles.filterSelect, ...styles.filterSelectActive } : styles.filterSelect}
            />
          </View>
          {filtersActive ? (
            <Pressable onPress={clearFilters} style={styles.clearFiltersBtn} hitSlop={6}>
              <X size={12} color={Colors.blue700} />
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.segmentedWrap}>
          <View style={styles.segmented}>
            {(['list', 'weekly'] as ViewMode[]).map((mode) => (
              <Pressable key={mode} onPress={() => setView(mode)} style={[styles.segment, view === mode && styles.segmentActive]}>
                {mode === 'list' ? (
                  <List size={13} color={view === mode ? Colors.white : Colors.gray600} />
                ) : (
                  <LayoutGrid size={13} color={view === mode ? Colors.white : Colors.gray600} />
                )}
                <Text style={[styles.segmentText, view === mode && styles.segmentTextActive]}>
                  {mode === 'list' ? 'List' : 'Weekly'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.blue600} />
            <Text style={styles.loadingText}>Loading duty roster...</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <CalendarDays size={40} color={Colors.gray300} />
            <Text style={styles.emptyTitle}>No Duty Assignments Yet</Text>
            <Text style={styles.emptyText}>
              There are no nurse assignments for the selected date or filters.
            </Text>
            {isSupervisor ? (
              <Button onPress={openAdd} style={styles.newBtn}>
                <Plus size={16} color={Colors.white} />
                <Text style={styles.newBtnText}>Assign Nurse</Text>
              </Button>
            ) : null}
          </View>
        ) : (
          <Animated.View style={{ opacity: bodyAnim }}>
            {view === 'list' ? (
              <View style={styles.list}>{filtered.map(renderCard)}</View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekScroll}>
                <View style={styles.weekRow}>
                  {weekDays.map((day) => {
                    const dayAssignments = filtered.filter((a) => a.dutyDate === day);
                    return (
                      <View key={day} style={styles.weekCol}>
                        <View style={styles.weekColHeader}>
                          <Text style={styles.weekColDate}>{formatDateLabel(day)}</Text>
                          <Text style={styles.weekColCount}>{dayAssignments.length} assigned</Text>
                        </View>
                        {dayAssignments.length === 0 ? (
                          <Text style={styles.weekColEmpty}>No duties</Text>
                        ) : (
                          dayAssignments.map((a) => {
                            const sc = SHIFT_COLORS[a.shift] || SHIFT_COLORS.morning;
                            const attendance = attendanceStatus(a, now);
                            const otLabel = liveOvertimeLabel(a, now);
                            return (
                              <Pressable
                                key={a.id}
                                style={({ hovered }: { hovered?: boolean }) => [
                                  styles.weekEntry,
                                  { backgroundColor: sc.bg, borderColor: sc.border },
                                  hovered && styles.weekEntryHover,
                                ]}
                                onPress={() => isSupervisor && openEdit(a)}
                              >
                                <View style={styles.weekEntryTopRow}>
                                  <Text style={[styles.weekEntryDept, { color: sc.color }]} numberOfLines={1}>{a.departmentName}</Text>
                                  {attendance && ATTENDANCE_CONFIG[attendance].live ? (
                                    <Animated.View
                                      style={[styles.liveDot, { backgroundColor: ATTENDANCE_CONFIG[attendance].color, opacity: pulseAnim }]}
                                    />
                                  ) : null}
                                </View>
                                <Text style={[styles.weekEntryShift, { color: sc.color }]}>{SHIFT_LABELS[a.shift]}</Text>
                                <Text style={styles.weekEntryNurse} numberOfLines={1}>{a.nurseName}</Text>
                                {a.actualStartTime ? (
                                  <Text style={styles.weekEntryActual} numberOfLines={1}>
                                    Started {formatActualTime(a.actualStartTime)}
                                    {a.actualEndTime ? ` · Ended ${formatActualTime(a.actualEndTime)}` : ''}
                                  </Text>
                                ) : null}
                                {otLabel ? (
                                  <Text style={styles.overtimeInline} numberOfLines={1}>Overtime +{otLabel}</Text>
                                ) : null}
                              </Pressable>
                            );
                          })
                        )}
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </Animated.View>
        )}

        {isSupervisor && departmentWorkload.length > 0 ? (
          <View style={styles.workloadCard}>
            <Text style={styles.workloadTitle}>Department Workload — Today</Text>
            {departmentWorkload.map(([name, counts]) => (
              <View key={name} style={styles.workloadRow}>
                <Text style={styles.workloadDept} numberOfLines={1}>{name}</Text>
                <View style={styles.workloadDots}>
                  {(['morning', 'afternoon', 'night'] as const).map((shift) => (
                    <View key={shift} style={styles.workloadDotItem}>
                      <View style={[styles.workloadDot, { backgroundColor: SHIFT_COLORS[shift].color }]} />
                      <Text style={styles.workloadCounts}>
                        {SHIFT_LABELS[shift]} {counts[shift]}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <DutyAssignmentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={modalMode}
        assignment={editing}
        nurses={nurses}
        departments={departments}
        allAssignments={assignments}
        onSaved={handleSaved}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Duty Assignment?"
        description={
          toDelete
            ? `Are you sure you want to remove ${toDelete.nurseName}'s duty assignment for ${toDelete.departmentName} on ${formatDateLabel(toDelete.dutyDate)}?`
            : ''
        }
        confirmLabel="Delete Assignment"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
      />
      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Close Out This Shift?"
        description={
          toClose
            ? `${toClose.nurseName} started this shift but never ended it. Ending it now will set the end time to right now and log it as a head nurse correction — this cannot be undone and will be clearly marked as your action, not theirs.`
            : ''
        }
        confirmLabel="Close Shift Now"
        cancelLabel="Cancel"
        onConfirm={confirmClose}
        loading={closing}
        destructive
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32, gap: 16, maxWidth: 1180, width: '100%', alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: Colors.gray900 },
  subtitle: { fontSize: 14, color: Colors.gray600, marginTop: 2 },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryCardWrap: { flexGrow: 1 },
  summaryCardHover: { transform: [{ translateY: -2 }] },
  summaryCard: { ...Shadows.sm, borderLeftWidth: 3 },
  summaryCardBody: { padding: 14, gap: 3 },
  summaryIconWrap: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  summaryValue: { fontSize: 26, fontWeight: '800', color: Colors.gray900, letterSpacing: -0.3 },
  summaryLabel: { fontSize: 11.5, color: Colors.mutedForeground, fontWeight: '600' },

  controls: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  searchWrap: { flex: 1, minWidth: 220 },
  newBtn: { backgroundColor: Colors.blue600, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, ...Shadows.sm },
  newBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },

  filterBar: { backgroundColor: Colors.gray50, borderWidth: 1, borderColor: Colors.gray100, borderRadius: Radius.lg, padding: 10, gap: 6 },
  filterRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  filterSelect: { minWidth: 150, flexGrow: 1, flexBasis: 150 },
  filterSelectActive: { borderColor: Colors.blue500 },
  customDateInput: { minWidth: 150, flexGrow: 1, flexBasis: 150 },
  clearFiltersBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 3 },
  clearFiltersText: { fontSize: 12, fontWeight: '700', color: Colors.blue700 },

  segmentedWrap: { flexDirection: 'row' },
  segmented: { flexDirection: 'row', backgroundColor: Colors.gray100, borderRadius: Radius.full, padding: 3, gap: 2 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full },
  segmentActive: { backgroundColor: Colors.blue600, ...Shadows.sm },
  segmentText: { fontSize: 12.5, fontWeight: '700', color: Colors.gray600 },
  segmentTextActive: { color: Colors.white },

  loadingBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { color: Colors.mutedForeground, fontSize: 13 },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Colors.gray900, marginTop: 4 },
  emptyText: { color: Colors.gray500, fontSize: 13, textAlign: 'center', maxWidth: 320 },

  list: { gap: 10 },
  assignCardHover: { transform: [{ translateY: -1 }] },
  assignCard: { borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4 },
  assignCardHighlighted: { borderColor: Colors.blue500, backgroundColor: Colors.blue50 },
  assignCardBody: { padding: 12, gap: 6 },
  assignHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  assignNurseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 10.5, fontWeight: '800', color: Colors.white },
  assignNurse: { fontSize: 14.5, fontWeight: '700', color: Colors.gray900, flexShrink: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },

  missedClockoutTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.red50, borderWidth: 1, borderColor: Colors.red200, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  missedClockoutText: { fontSize: 11, fontWeight: '700', color: Colors.red700 },

  // Red text only for the overtime addition — the scheduled time next to it
  // stays in normal ink, so only the flag itself stands out.
  overtimeInline: { color: Colors.red600, fontWeight: '700', fontSize: 11.5 },
  actualTimeText: { fontSize: 11.5, color: Colors.gray600, fontWeight: '600' },
  closedByTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.orange50, borderWidth: 1, borderColor: Colors.orange300, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  closedByText: { fontSize: 11, fontWeight: '700', color: Colors.orange700 },

  assignMetaWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  assignMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assignMetaText: { fontSize: 12, color: Colors.mutedForeground },
  shiftTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.sm },
  shiftTagText: { fontSize: 11.5, fontWeight: '700' },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2, flexWrap: 'wrap' },
  hoursRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  hoursChip: { fontSize: 11, fontWeight: '700', color: Colors.gray700, backgroundColor: Colors.gray100, paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.sm },
  hoursChipOT: { color: Colors.orange700, backgroundColor: Colors.orange50 },
  cardActions: { flexDirection: 'row', gap: 4 },
  iconTextBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: Radius.sm },
  iconTextBtnLabel: { fontSize: 11.5, fontWeight: '600', color: Colors.gray600 },

  weekScroll: { marginHorizontal: -4 },
  weekRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  weekCol: { width: 190, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 10, gap: 8 },
  weekColHeader: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 6, marginBottom: 2 },
  weekColDate: { fontSize: 12.5, fontWeight: '700', color: Colors.gray900 },
  weekColCount: { fontSize: 11, color: Colors.mutedForeground, marginTop: 2 },
  weekColEmpty: { fontSize: 11.5, color: Colors.gray400, fontStyle: 'italic', paddingVertical: 6 },
  weekEntry: { borderRadius: Radius.md, borderWidth: 1, padding: 8, gap: 2 },
  weekEntryHover: { transform: [{ translateY: -1 }] },
  weekEntryTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  weekEntryDept: { fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
  weekEntryShift: { fontSize: 10.5, fontWeight: '600' },
  weekEntryNurse: { fontSize: 11, color: Colors.gray700 },
  weekEntryActual: { fontSize: 10, color: Colors.gray500, fontWeight: '600' },

  workloadCard: { backgroundColor: Colors.blue50, borderWidth: 1, borderColor: Colors.blue100, borderRadius: Radius.lg, padding: 14, gap: 4 },
  workloadTitle: { fontSize: 12.5, fontWeight: '700', color: Colors.blue800, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  workloadRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.blue100, gap: 6 },
  workloadDept: { fontSize: 13, fontWeight: '700', color: Colors.gray900 },
  workloadDots: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  workloadDotItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  workloadDot: { width: 7, height: 7, borderRadius: 4 },
  workloadCounts: { fontSize: 11.5, color: Colors.mutedForeground, fontWeight: '600' },
});
