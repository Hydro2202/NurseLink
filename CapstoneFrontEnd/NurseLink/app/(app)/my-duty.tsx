import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import {
  Stethoscope,
  Building2,
  Clock,
  CalendarDays,
  CircleDot,
  Circle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Timer,
  ListChecks,
  Play,
  Square,
} from 'lucide-react-native';
import { fetchDutyAssignments, startDutyAssignment, endDutyAssignment, ApiError } from '../../services/api';
import type { DutyAssignment } from '../../types/domain';
import { Card, CardContent } from '../../components/Card';
import { Button } from '../../components/Button';
import { Alert, AlertDescription } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Colors, Shadows, Radius } from '../../constants/colors';

// Mirrors the backend default (DUTY_START_BUFFER_MINUTES) purely so the
// button's enabled/disabled state feels right immediately — the backend is
// still the real authority and rejects an attempt outside its own,
// independently-configurable window regardless of what this shows.
const START_BUFFER_MINUTES = 15;

const SHIFT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Evening', night: 'Night' };

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function toIsoLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso() {
  return toIsoLocal(new Date());
}
function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
}
function startOfWeek(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIsoLocal(d);
}
function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${period}`;
}
// Combines a duty_date + "HH:MM" into a real Date, purely from local
// calendar parts — never toISOString(), which converts to UTC and shifts
// the day in any timezone ahead of UTC.
function combine(dateIso: string, hhmm: string): Date {
  const [y, mo, da] = dateIso.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, da, h, m, 0, 0);
}

type LiveStatus = 'upcoming' | 'onduty' | 'overtime' | 'completed';

// Same midnight-wrap rule as DutyAssignment.duration_hours on the backend —
// an end time at or before the start time means the shift spills into the
// next calendar day.
function scheduledStart(a: DutyAssignment): Date {
  return combine(a.dutyDate, a.startTime.slice(0, 5));
}
function scheduledEnd(a: DutyAssignment): Date {
  const start = scheduledStart(a);
  let end = combine(a.dutyDate, a.endTime.slice(0, 5));
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
  return end;
}

// Real clock-in/out takes priority the moment it exists; a shift that has
// not been started yet still falls back to the pure schedule-vs-now logic,
// unchanged from before actual attendance existed.
function computeLiveStatus(a: DutyAssignment, now: Date): LiveStatus {
  if (a.actualEndTime) {
    return a.actualOvertimeHours > 0 ? 'overtime' : 'completed';
  }
  if (a.actualStartTime) {
    return now.getTime() < scheduledEnd(a).getTime() ? 'onduty' : 'overtime';
  }

  const start = scheduledStart(a);
  const end = scheduledEnd(a);
  if (now < start) return 'upcoming';
  if (now < end) return 'onduty';

  if (a.overtimeHours > 0 && a.overtimeStart && a.overtimeEnd) {
    let otStart = combine(a.dutyDate, a.overtimeStart.slice(0, 5));
    let otEnd = combine(a.dutyDate, a.overtimeEnd.slice(0, 5));
    if (otEnd.getTime() <= otStart.getTime()) otEnd = new Date(otEnd.getTime() + 86400000);
    if (otEnd.getTime() < end.getTime()) otEnd = new Date(otEnd.getTime() + 86400000);
    if (now < otEnd) return 'overtime';
  } else if (a.overtimeHours > 0) {
    return 'overtime';
  }
  return 'completed';
}

function formatDurationShort(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Overtime to show right now, as "+Xh Ym" — or null when there is none to
 * show at all (never rendered as "+0h", per the no-noise requirement).
 *
 * Frozen (actualEndTime set): the backend's own actualOvertimeHours,
 * converted to minutes — the same number everywhere else on the page shows.
 * Live (clocked in, still past scheduled end): minutes elapsed since the
 * scheduled end, ticking up with `now` until the nurse ends the shift.
 */
function liveOvertimeLabel(a: DutyAssignment, now: Date): string | null {
  if (a.actualEndTime) {
    return a.actualOvertimeHours > 0 ? formatDurationShort(a.actualOvertimeHours * 60) : null;
  }
  if (a.actualStartTime) {
    const end = scheduledEnd(a);
    const minutesPast = (now.getTime() - end.getTime()) / 60000;
    return minutesPast > 0 ? formatDurationShort(minutesPast) : null;
  }
  return null;
}

// One color language for the whole page — today card, pills, week-list
// accents all read from this instead of picking colors ad hoc.
const STATUS_CONFIG: Record<
  LiveStatus,
  { label: string; color: string; bg: string; border: string; icon: typeof Circle }
> = {
  upcoming: { label: 'Upcoming', color: Colors.blue700, bg: Colors.blue50, border: Colors.blue200, icon: Circle },
  onduty: { label: 'On Duty Now', color: Colors.green700, bg: Colors.green50, border: Colors.green200, icon: CircleDot },
  overtime: { label: 'Overtime', color: Colors.orange700, bg: Colors.orange50, border: Colors.orange300, icon: AlertTriangle },
  completed: { label: 'Completed', color: Colors.gray600, bg: Colors.gray100, border: Colors.gray200, icon: CheckCircle2 },
};
function statusIcon(status: LiveStatus, size: number, color: string) {
  const Icon = STATUS_CONFIG[status].icon;
  return <Icon size={size} color={color} />;
}

export default function MyDutyPage() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [assignments, setAssignments] = useState<DutyAssignment[]>([]);
  const [now, setNow] = useState(new Date());

  const loadData = async () => {
    try {
      // No lower bound: the bottom "no assignments yet" card needs to know
      // whether this nurse has ever had a real assignment, not just whether
      // this particular week is empty — same single endpoint, just not
      // artificially windowed to the last day.
      const to = addDays(todayIso(), 60);
      // No nurseId param needed/sent — the backend already scopes this to
      // the signed-in nurse's own rows (DutyAssignmentViewSet.get_queryset).
      const data = await fetchDutyAssignments({ dateTo: to });
      setAssignments(data);
      setLoadError('');
    } catch (error) {
      setLoadError(
        error instanceof ApiError
          ? error.message
          : 'Unable to load your duty schedule. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keeps the On Duty Now / Overtime / Completed status honest while the
  // screen stays open across a shift boundary, without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const today = todayIso();
  const yesterday = addDays(today, -1);

  const todayAssignment = useMemo(() => {
    const relevant = assignments.filter(
      (a) => (a.dutyDate === today || a.dutyDate === yesterday) && a.status !== 'cancelled'
    );
    const active = relevant.find((a) => {
      const s = computeLiveStatus(a, now);
      return s === 'onduty' || s === 'overtime';
    });
    return active || relevant.find((a) => a.dutyDate === today) || null;
  }, [assignments, today, yesterday, now]);

  const todayLiveStatus = todayAssignment ? computeLiveStatus(todayAssignment, now) : null;
  const todayOvertimeLabel = todayAssignment ? liveOvertimeLabel(todayAssignment, now) : null;
  // Regular Hours stays the plan either way; Overtime/Total switch to real
  // clocked numbers the moment there is real attendance to show instead.
  const todayDisplayOvertime = todayAssignment
    ? todayAssignment.actualEndTime
      ? todayAssignment.actualOvertimeHours
      : todayAssignment.actualStartTime
        ? Math.round(((now.getTime() - scheduledEnd(todayAssignment).getTime()) / 3600000) * 100) / 100
        : todayAssignment.overtimeHours
    : 0;
  const todayDisplayOvertimeHours = Math.max(0, todayDisplayOvertime);
  const todayDisplayTotal = todayAssignment
    ? Math.round((todayAssignment.regularHours + todayDisplayOvertimeHours) * 100) / 100
    : 0;

  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  const canStart =
    !!todayAssignment &&
    !todayAssignment.actualStartTime &&
    now.getTime() >= scheduledStart(todayAssignment).getTime() - START_BUFFER_MINUTES * 60000;
  const canEnd = !!todayAssignment && !!todayAssignment.actualStartTime && !todayAssignment.actualEndTime;

  // Never optimistic — the badge/buttons only change once the backend has
  // actually confirmed the clock-in/out, per the no-assume-success rule.
  const handleStart = async () => {
    if (!todayAssignment) return;
    setActionError('');
    setStarting(true);
    try {
      const updated = await startDutyAssignment(todayAssignment.id);
      setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Couldn't start your shift — please try again."
      );
    } finally {
      setStarting(false);
    }
  };

  const handleEndConfirmed = async () => {
    if (!todayAssignment) return;
    setActionError('');
    setEnding(true);
    try {
      const updated = await endDutyAssignment(todayAssignment.id);
      setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setConfirmEndOpen(false);
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Couldn't end your shift — please try again."
      );
      setConfirmEndOpen(false);
    } finally {
      setEnding(false);
    }
  };

  const weekDays = useMemo(() => {
    const start = startOfWeek(today);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [today]);

  const weekRows = useMemo(
    () =>
      weekDays.map((day) => ({
        day,
        assignment: assignments.find((a) => a.dutyDate === day && a.status !== 'cancelled') || null,
      })),
    [weekDays, assignments]
  );

  const hasAnyAssignmentEver = assignments.length > 0;

  const weekSummary = useMemo(() => {
    const withDuty = weekRows.filter((r) => r.assignment);
    const totalHours = withDuty.reduce((sum, r) => sum + (r.assignment?.totalHours || 0), 0);
    const overtimeHours = withDuty.reduce((sum, r) => sum + (r.assignment?.overtimeHours || 0), 0);
    return {
      shiftsCount: withDuty.length,
      totalHours: Math.round(totalHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
    };
  }, [weekRows]);

  // Fade/slide the content in once loading resolves, instead of a hard pop.
  const contentAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) {
      Animated.timing(contentAnim, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    }
  }, [loading, contentAnim]);

  // A smooth crossfade on the status pill/accent when the live status flips
  // (e.g. Upcoming -> On Duty Now) rather than an abrupt color flash.
  const statusAnim = useRef(new Animated.Value(1)).current;
  const lastStatus = useRef<LiveStatus | null>(null);
  useEffect(() => {
    if (todayLiveStatus && lastStatus.current && lastStatus.current !== todayLiveStatus) {
      statusAnim.setValue(0.3);
      Animated.timing(statusAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    }
    lastStatus.current = todayLiveStatus;
  }, [todayLiveStatus, statusAnim]);

  const quickInfoPanel = (
    <Card style={styles.quickCard}>
      <CardContent style={styles.quickCardBody}>
        <Text style={styles.quickTitle}>This Week</Text>
        <View style={styles.quickRow}>
          <View style={styles.quickIconWrap}>
            <ListChecks size={15} color={Colors.blue700} />
          </View>
          <View>
            <Text style={styles.quickValue}>{weekSummary.shiftsCount}</Text>
            <Text style={styles.quickLabel}>Shift{weekSummary.shiftsCount === 1 ? '' : 's'} scheduled</Text>
          </View>
        </View>
        <View style={styles.quickRow}>
          <View style={styles.quickIconWrap}>
            <Timer size={15} color={Colors.blue700} />
          </View>
          <View>
            <Text style={styles.quickValue}>{weekSummary.totalHours}h</Text>
            <Text style={styles.quickLabel}>Total hours this week</Text>
          </View>
        </View>
        {weekSummary.overtimeHours > 0 ? (
          <View style={styles.quickRow}>
            <View style={[styles.quickIconWrap, { backgroundColor: Colors.orange50 }]}>
              <AlertTriangle size={15} color={Colors.orange700} />
            </View>
            <View>
              <Text style={[styles.quickValue, { color: Colors.orange700 }]}>{weekSummary.overtimeHours}h</Text>
              <Text style={styles.quickLabel}>Overtime this week</Text>
            </View>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Stethoscope size={22} color={Colors.blue600} />
          <View>
            <Text style={styles.title}>My Duty</Text>
            <Text style={styles.subtitle}>Your assigned shifts, hours, and current status</Text>
          </View>
        </View>
        <View style={styles.headerDivider} />

        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
            <Button size="sm" variant="outline" onPress={loadData} style={styles.retryBtn}>
              <RefreshCw size={13} color={Colors.foreground} />
              <Text style={{ marginLeft: 6 }}>Retry</Text>
            </Button>
          </Alert>
        ) : null}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.blue600} />
            <Text style={styles.loadingText}>Loading your duty schedule...</Text>
          </View>
        ) : (
          <Animated.View
            style={{
              opacity: contentAnim,
              transform: [{ translateY: contentAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            }}
          >
            <View style={[styles.layout, isWide && styles.layoutWide]}>
              <View style={[styles.mainCol, isWide && styles.mainColWide]}>
                {/* Today card */}
                {todayAssignment && todayLiveStatus ? (
                  <Card style={{ ...styles.todayCard, borderColor: STATUS_CONFIG[todayLiveStatus].border }}>
                    <View style={[styles.todayAccent, { backgroundColor: STATUS_CONFIG[todayLiveStatus].color }]} />
                    <CardContent style={styles.todayCardBody}>
                      <View style={styles.todayTopRow}>
                        <Text style={styles.todayLabel}>Today's Duty</Text>
                        <Animated.View
                          style={[
                            styles.iconBadge,
                            { backgroundColor: STATUS_CONFIG[todayLiveStatus].bg, opacity: statusAnim },
                          ]}
                        >
                          {statusIcon(todayLiveStatus, 20, STATUS_CONFIG[todayLiveStatus].color)}
                        </Animated.View>
                      </View>

                      <View style={styles.todayTimeRow}>
                        <Text style={styles.todayShiftTime}>
                          {formatTime(todayAssignment.startTime.slice(0, 5))} –{' '}
                          {formatTime(todayAssignment.endTime.slice(0, 5))}
                        </Text>
                        {todayOvertimeLabel ? (
                          <Text style={styles.overtimeInline}>Overtime +{todayOvertimeLabel}</Text>
                        ) : null}
                      </View>

                      <View style={styles.todayMetaRow}>
                        <View style={styles.todayMetaItem}>
                          <Building2 size={14} color={Colors.mutedForeground} />
                          <Text style={styles.todayDept}>{todayAssignment.departmentName}</Text>
                        </View>
                        <View style={styles.todayMetaItem}>
                          <Clock size={14} color={Colors.mutedForeground} />
                          <Text style={styles.todayDept}>{SHIFT_LABELS[todayAssignment.shift] || todayAssignment.shift} Shift</Text>
                        </View>
                      </View>

                      <Animated.View
                        style={[
                          styles.statusPill,
                          { backgroundColor: STATUS_CONFIG[todayLiveStatus].bg, opacity: statusAnim },
                        ]}
                      >
                        {statusIcon(todayLiveStatus, 13, STATUS_CONFIG[todayLiveStatus].color)}
                        <Text style={[styles.statusPillText, { color: STATUS_CONFIG[todayLiveStatus].color }]}>
                          {STATUS_CONFIG[todayLiveStatus].label}
                        </Text>
                      </Animated.View>

                      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

                      {canStart ? (
                        <Button onPress={handleStart} loading={starting} disabled={starting} style={styles.clockBtnStart}>
                          {!starting ? <Play size={15} color={Colors.white} /> : null}
                          <Text style={styles.clockBtnText}>{starting ? 'Starting...' : 'Start Shift'}</Text>
                        </Button>
                      ) : canEnd ? (
                        <Button
                          onPress={() => setConfirmEndOpen(true)}
                          loading={ending}
                          disabled={ending}
                          style={styles.clockBtnEnd}
                        >
                          {!ending ? <Square size={14} color={Colors.white} /> : null}
                          <Text style={styles.clockBtnText}>{ending ? 'Ending...' : 'End Shift'}</Text>
                        </Button>
                      ) : null}

                      <View style={styles.hoursBox}>
                        <View style={styles.hoursRow}>
                          <Text style={styles.hoursLabel}>Regular Hours</Text>
                          <Text style={styles.hoursValue}>{todayAssignment.regularHours}h</Text>
                        </View>
                        {todayDisplayOvertimeHours > 0 ? (
                          <View style={styles.hoursRow}>
                            <Text style={styles.hoursLabel}>Overtime</Text>
                            <Text style={[styles.hoursValue, styles.overtimeInline]}>
                              {todayDisplayOvertimeHours}h
                            </Text>
                          </View>
                        ) : null}
                        <View style={[styles.hoursRow, styles.hoursTotalRow]}>
                          <Text style={styles.hoursTotalLabel}>Total</Text>
                          <Text style={styles.hoursTotalValue}>{todayDisplayTotal}h</Text>
                        </View>
                      </View>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent style={styles.emptyToday}>
                      <CalendarDays size={28} color={Colors.gray300} />
                      <Text style={styles.emptyTodayTitle}>No Duty Assigned Today</Text>
                      <Text style={styles.emptyTodayText}>You have no scheduled shift for today.</Text>
                    </CardContent>
                  </Card>
                )}

                {isWide ? null : <View style={styles.mobileQuickWrap}>{quickInfoPanel}</View>}

                {/* This week */}
                <View style={styles.weekSection}>
                  <Text style={styles.weekTitle}>This Week</Text>
                  <Card>
                    <CardContent style={styles.weekList}>
                      {weekRows.map(({ day, assignment }, i) => {
                        const status = assignment ? computeLiveStatus(assignment, now) : null;
                        const otLabel = assignment ? liveOvertimeLabel(assignment, now) : null;
                        const isToday = day === today;
                        const dObj = new Date(day + 'T00:00:00');
                        const dow = dObj.toLocaleDateString('en-US', { weekday: 'short' });
                        const dom = dObj.getDate();
                        return (
                          <Pressable
                            key={day}
                            style={({ hovered }: { hovered?: boolean }) => [
                              styles.weekRow,
                              i === weekRows.length - 1 && styles.weekRowLast,
                              isToday && [
                                styles.weekRowToday,
                                { backgroundColor: status ? STATUS_CONFIG[status].bg : Colors.blue50 },
                              ],
                              hovered && !isToday && styles.weekRowHover,
                            ]}
                          >
                            <View
                              style={[
                                styles.dateChip,
                                isToday && { borderColor: status ? STATUS_CONFIG[status].color : Colors.blue600 },
                              ]}
                            >
                              <Text style={[styles.dateChipDow, isToday && styles.dateChipDowToday]}>{dow}</Text>
                              <Text style={[styles.dateChipDom, isToday && styles.dateChipDomToday]}>{dom}</Text>
                            </View>

                            {assignment && status ? (
                              <View style={styles.weekDetail}>
                                <Text style={styles.weekDeptText} numberOfLines={1}>
                                  {assignment.departmentName} · {SHIFT_LABELS[assignment.shift] || assignment.shift} ·{' '}
                                  {formatTime(assignment.startTime.slice(0, 5))}–
                                  {formatTime(assignment.endTime.slice(0, 5))}
                                  {otLabel ? <Text style={styles.overtimeInline}> Overtime +{otLabel}</Text> : null}
                                </Text>
                                <View style={[styles.weekStatusPill, { backgroundColor: STATUS_CONFIG[status].bg }]}>
                                  {statusIcon(status, 10, STATUS_CONFIG[status].color)}
                                  <Text style={[styles.weekStatusText, { color: STATUS_CONFIG[status].color }]}>
                                    {STATUS_CONFIG[status].label}
                                  </Text>
                                </View>
                              </View>
                            ) : (
                              <View style={styles.weekDetail}>
                                <Text style={styles.weekOff}>Off</Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </CardContent>
                  </Card>
                </View>

                {!hasAnyAssignmentEver ? (
                  <Card>
                    <CardContent style={styles.emptyBottom}>
                      <CalendarDays size={26} color={Colors.gray300} />
                      <Text style={styles.emptyTodayTitle}>No Duty Assignments Yet</Text>
                      <Text style={styles.emptyTodayText}>
                        Your head nurse hasn't scheduled you for any shifts yet.
                      </Text>
                    </CardContent>
                  </Card>
                ) : null}
              </View>

              {isWide ? <View style={styles.sideCol}>{quickInfoPanel}</View> : null}
            </View>
          </Animated.View>
        )}
      </ScrollView>

      <ConfirmDialog
        open={confirmEndOpen}
        onOpenChange={setConfirmEndOpen}
        title="End your shift now?"
        description="This will record your actual end time. Your regular and overtime hours will be calculated from your real start and end times."
        confirmLabel="End Shift"
        cancelLabel="Cancel"
        onConfirm={handleEndConfirmed}
        loading={ending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32, gap: 16, maxWidth: 1180, width: '100%', alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.gray900 },
  subtitle: { fontSize: 13, color: Colors.gray600, marginTop: 2 },
  headerDivider: { height: 1, backgroundColor: Colors.gray100, marginTop: 2 },
  retryBtn: { marginTop: 8, alignSelf: 'flex-start' },

  loadingBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { color: Colors.mutedForeground, fontSize: 13 },

  layout: { gap: 16 },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mainCol: { gap: 16 },
  mainColWide: { flex: 1, minWidth: 0 },
  sideCol: { width: 260, gap: 16 },
  mobileQuickWrap: { marginTop: -4 },

  todayCard: { borderWidth: 1, ...Shadows.md, overflow: 'hidden', flexDirection: 'row' },
  todayAccent: { width: 5, alignSelf: 'stretch' },
  todayCardBody: { flex: 1, padding: 20, gap: 4 },
  todayTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  todayLabel: { fontSize: 12, fontWeight: '700', color: Colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  iconBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  todayTimeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 2 },
  todayShiftTime: { fontSize: 26, fontWeight: '800', color: Colors.gray900, letterSpacing: -0.3 },
  // Red text only for the overtime addition itself — the scheduled time
  // above stays in normal ink, so only the flag stands out.
  overtimeInline: { color: Colors.red600, fontWeight: '700', fontSize: 13 },
  todayMetaRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 4 },
  todayMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  todayDept: { fontSize: 13.5, color: Colors.gray600, fontWeight: '600' },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, marginTop: 10 },
  statusPillText: { fontSize: 12.5, fontWeight: '700' },

  actionError: { fontSize: 12, color: Colors.destructive, fontWeight: '600', marginTop: 8 },
  clockBtnStart: { backgroundColor: Colors.blue600, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 20 },
  clockBtnEnd: { backgroundColor: Colors.gray800, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 20 },
  clockBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },

  hoursBox: { backgroundColor: Colors.gray50, borderWidth: 1, borderColor: Colors.gray100, borderRadius: Radius.md, padding: 12, gap: 6, marginTop: 12 },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between' },
  hoursLabel: { fontSize: 12.5, color: Colors.gray600, fontWeight: '600' },
  hoursValue: { fontSize: 12.5, color: Colors.gray800, fontWeight: '700' },
  hoursTotalRow: { borderTopWidth: 1, borderTopColor: Colors.gray200, paddingTop: 6, marginTop: 2 },
  hoursTotalLabel: { fontSize: 13, color: Colors.gray900, fontWeight: '700' },
  hoursTotalValue: { fontSize: 14, color: Colors.gray900, fontWeight: '800' },

  emptyToday: { alignItems: 'center', paddingVertical: 22, gap: 6 },
  emptyBottom: { alignItems: 'center', paddingVertical: 18, gap: 6 },
  emptyTodayTitle: { fontSize: 14.5, fontWeight: '700', color: Colors.gray900, marginTop: 2 },
  emptyTodayText: { fontSize: 12.5, color: Colors.gray500, textAlign: 'center' },

  weekSection: { gap: 8 },
  weekTitle: { fontSize: 14, fontWeight: '700', color: Colors.gray900 },
  weekList: { padding: 6 },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    marginVertical: 2,
  },
  weekRowLast: {},
  weekRowToday: { borderWidth: 1, borderColor: 'transparent' },
  weekRowHover: { backgroundColor: Colors.gray50 },

  dateChip: {
    width: 46,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.gray200,
    backgroundColor: Colors.white,
  },
  dateChipDow: { fontSize: 10, fontWeight: '700', color: Colors.gray500, textTransform: 'uppercase' },
  dateChipDowToday: { color: Colors.blue700 },
  dateChipDom: { fontSize: 15, fontWeight: '800', color: Colors.gray800, marginTop: 1 },
  dateChipDomToday: { color: Colors.blue700 },

  weekDetail: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  weekDeptText: { fontSize: 12.5, color: Colors.gray800, fontWeight: '600', flexShrink: 1 },
  weekStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.full },
  weekStatusText: { fontSize: 10.5, fontWeight: '700' },
  weekOff: { fontSize: 12.5, color: Colors.gray400, fontWeight: '500' },

  quickCard: { ...Shadows.sm },
  quickCardBody: { padding: 16, gap: 14 },
  quickTitle: { fontSize: 12, fontWeight: '700', color: Colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quickIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.blue50, alignItems: 'center', justifyContent: 'center' },
  quickValue: { fontSize: 16, fontWeight: '800', color: Colors.gray900 },
  quickLabel: { fontSize: 11.5, color: Colors.gray500, fontWeight: '600' },
});
