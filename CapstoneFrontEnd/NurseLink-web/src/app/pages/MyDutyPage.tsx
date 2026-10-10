import React, { useEffect, useMemo, useState } from 'react';
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
  Loader2,
} from 'lucide-react';
import { fetchDutyAssignments, startDutyAssignment, endDutyAssignment, ApiError } from '../api/nurselink';
import { useLiveRefresh } from '../contexts/LiveContext';
import type { DutyAssignment } from '../types/domain';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';

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
function combine(dateIso: string, hhmm: string): Date {
  const [y, mo, da] = dateIso.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, da, h, m, 0, 0);
}

type LiveStatus = 'upcoming' | 'onduty' | 'overtime' | 'completed';

function scheduledStart(a: DutyAssignment): Date {
  if (a.scheduledStartAt) return new Date(a.scheduledStartAt);
  return combine(a.dutyDate, a.startTime.slice(0, 5));
}
function scheduledEnd(a: DutyAssignment): Date {
  if (a.scheduledEndAt) return new Date(a.scheduledEndAt);
  const start = scheduledStart(a);
  let end = combine(a.dutyDate, a.endTime.slice(0, 5));
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);
  return end;
}

function computeLiveStatus(a: DutyAssignment, now: Date): LiveStatus {
  if (a.actualEndTime) {
    return a.actualOvertimeHours > 0 ? 'overtime' : 'completed';
  }
  if (a.status === 'completed') {
    return 'completed';
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

const STATUS_CONFIG: Record<
  LiveStatus,
  { label: string; color: string; bg: string; accent: string; border: string; icon: typeof Circle }
> = {
  upcoming: { label: 'Upcoming', color: 'text-primary', bg: 'bg-primary-light', accent: 'bg-primary', border: 'border-primary/30', icon: Circle },
  onduty: { label: 'On Duty Now', color: 'text-success-hover', bg: 'bg-success-light', accent: 'bg-success', border: 'border-success/30', icon: CircleDot },
  overtime: { label: 'Overtime', color: 'text-warning-hover', bg: 'bg-warning-light', accent: 'bg-warning', border: 'border-warning/40', icon: AlertTriangle },
  completed: { label: 'Completed', color: 'text-muted-foreground', bg: 'bg-muted', accent: 'bg-gray-400', border: 'border-border', icon: CheckCircle2 },
};

export default function MyDutyPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [assignments, setAssignments] = useState<DutyAssignment[]>([]);
  const [now, setNow] = useState(new Date());

  const loadData = async () => {
    try {
      const to = addDays(todayIso(), 60);
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
    void loadData();
  }, []);

  // A head nurse editing/closing this nurse's shift from the Duty Roster
  // happens on a different device, so this follows the shared live
  // revision instead of only what this device has done itself.
  useLiveRefresh('duty', () => {
    void loadData();
  });

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

  const handleStart = async () => {
    if (!todayAssignment) return;
    setActionError('');
    setStarting(true);
    try {
      const updated = await startDutyAssignment(todayAssignment.id);
      setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Couldn't start your shift — please try again.");
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
      setActionError(error instanceof ApiError ? error.message : "Couldn't end your shift — please try again.");
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

  const quickInfoPanel = (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">This Week</p>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
            <ListChecks className="w-3.5 h-3.5 text-primary" />
          </div>
          <div>
            <p className="text-base font-extrabold">{weekSummary.shiftsCount}</p>
            <p className="text-[11px] text-muted-foreground font-semibold">
              Shift{weekSummary.shiftsCount === 1 ? '' : 's'} scheduled
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
            <Timer className="w-3.5 h-3.5 text-primary" />
          </div>
          <div>
            <p className="text-base font-extrabold">{weekSummary.totalHours}h</p>
            <p className="text-[11px] text-muted-foreground font-semibold">Total hours this week</p>
          </div>
        </div>
        {weekSummary.overtimeHours > 0 ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-warning-light flex items-center justify-center shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-warning-hover" />
            </div>
            <div>
              <p className="text-base font-extrabold text-warning-hover">{weekSummary.overtimeHours}h</p>
              <p className="text-[11px] text-muted-foreground font-semibold">Overtime this week</p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 py-4 space-y-4">
      <div className="flex items-center gap-2.5">
        <Stethoscope className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold">My Duty</h1>
          <p className="text-sm text-muted-foreground">Your assigned shifts, hours, and current status</p>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive-light p-3">
          <p className="text-sm text-destructive font-medium">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void loadData()} className="mt-2">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your duty schedule...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {todayAssignment && todayLiveStatus ? (
              <Card className={`overflow-hidden border-2 ${STATUS_CONFIG[todayLiveStatus].border}`}>
                <div className="flex">
                  <div className={`w-1.5 ${STATUS_CONFIG[todayLiveStatus].accent}`} />
                  <CardContent className="flex-1 p-5 space-y-1">
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mt-1">
                        Today&apos;s Duty
                      </p>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${STATUS_CONFIG[todayLiveStatus].bg}`}>
                        {React.createElement(STATUS_CONFIG[todayLiveStatus].icon, {
                          className: `w-5 h-5 ${STATUS_CONFIG[todayLiveStatus].color}`,
                        })}
                      </div>
                    </div>

                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <p className="text-2xl font-extrabold tracking-tight">
                        {todayAssignment.scheduleWindowLabel ??
                          `${formatTime(todayAssignment.startTime.slice(0, 5))} – ${formatTime(todayAssignment.endTime.slice(0, 5))}`}
                      </p>
                      {todayOvertimeLabel ? (
                        <span className="text-destructive font-bold text-sm">Overtime +{todayOvertimeLabel}</span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-4 flex-wrap pt-1">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm text-gray-600 font-semibold">{todayAssignment.departmentName}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm text-gray-600 font-semibold">
                          {SHIFT_LABELS[todayAssignment.shift] || todayAssignment.shift} Shift
                        </span>
                      </div>
                    </div>

                    <div
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mt-2 ${STATUS_CONFIG[todayLiveStatus].bg}`}
                    >
                      {React.createElement(STATUS_CONFIG[todayLiveStatus].icon, {
                        className: `w-3.5 h-3.5 ${STATUS_CONFIG[todayLiveStatus].color}`,
                      })}
                      <span className={`text-xs font-bold ${STATUS_CONFIG[todayLiveStatus].color}`}>
                        {STATUS_CONFIG[todayLiveStatus].label}
                      </span>
                    </div>

                    {actionError ? <p className="text-xs text-destructive font-semibold mt-2">{actionError}</p> : null}

                    {canStart ? (
                      <Button onClick={handleStart} disabled={starting} className="mt-3">
                        {starting ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 mr-2" />
                        )}
                        {starting ? 'Starting...' : 'Start Shift'}
                      </Button>
                    ) : canEnd ? (
                      <Button
                        onClick={() => setConfirmEndOpen(true)}
                        disabled={ending}
                        className="mt-3 bg-gray-800 hover:bg-gray-900"
                      >
                        {ending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Square className="w-3.5 h-3.5 mr-2" />
                        )}
                        {ending ? 'Ending...' : 'End Shift'}
                      </Button>
                    ) : null}

                    <div className="rounded-md border border-border bg-muted p-3 space-y-1.5 mt-3">
                      <div className="flex justify-between text-xs font-semibold text-gray-600">
                        <span>Regular Hours</span>
                        <span className="text-gray-800 font-bold">{todayAssignment.regularHours}h</span>
                      </div>
                      {todayDisplayOvertimeHours > 0 ? (
                        <div className="flex justify-between text-xs font-semibold text-gray-600">
                          <span>Overtime</span>
                          <span className="text-destructive font-bold">{todayDisplayOvertimeHours}h</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between text-sm font-bold border-t border-border pt-1.5 mt-1">
                        <span>Total</span>
                        <span>{todayDisplayTotal}h</span>
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center gap-1.5 py-8">
                  <CalendarDays className="w-7 h-7 text-gray-300" />
                  <p className="text-sm font-bold mt-1">No Duty Assigned Today</p>
                  <p className="text-xs text-gray-500 text-center">You have no scheduled shift for today.</p>
                </CardContent>
              </Card>
            )}

            <div className="lg:hidden">{quickInfoPanel}</div>

            <div className="space-y-2">
              <p className="text-sm font-bold">This Week</p>
              <Card>
                <CardContent className="p-1.5 space-y-0.5">
                  {weekRows.map(({ day, assignment }) => {
                    const status = assignment ? computeLiveStatus(assignment, now) : null;
                    const otLabel = assignment ? liveOvertimeLabel(assignment, now) : null;
                    const isToday = day === today;
                    const dObj = new Date(day + 'T00:00:00');
                    const dow = dObj.toLocaleDateString('en-US', { weekday: 'short' });
                    const dom = dObj.getDate();
                    return (
                      <div
                        key={day}
                        className={`flex items-center gap-3 px-2 py-2.5 rounded-md ${
                          isToday ? (status ? STATUS_CONFIG[status].bg : 'bg-primary-light') : ''
                        }`}
                      >
                        <div
                          className={`w-11 flex flex-col items-center py-1.5 rounded-md border bg-white ${
                            isToday ? (status ? STATUS_CONFIG[status].color : 'text-primary') + ' border-current' : 'border-border'
                          }`}
                        >
                          <span className="text-[10px] font-bold uppercase text-gray-500">{dow}</span>
                          <span className="text-base font-extrabold text-gray-800">{dom}</span>
                        </div>

                        {assignment && status ? (
                          <div className="flex-1 min-w-0 flex items-center justify-between gap-2.5 flex-wrap">
                            <p className="text-xs text-gray-800 font-semibold truncate">
                              {assignment.departmentName} · {SHIFT_LABELS[assignment.shift] || assignment.shift} ·{' '}
                              {assignment.scheduleWindowLabel ??
                                `${formatTime(assignment.startTime.slice(0, 5))}–${formatTime(assignment.endTime.slice(0, 5))}`}
                              {otLabel ? <span className="text-destructive font-bold"> Overtime +{otLabel}</span> : null}
                            </p>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold ${STATUS_CONFIG[status].bg} ${STATUS_CONFIG[status].color}`}>
                              {STATUS_CONFIG[status].label}
                            </span>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 font-medium">Off</p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            {!hasAnyAssignmentEver ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-1.5 py-6">
                  <CalendarDays className="w-6 h-6 text-gray-300" />
                  <p className="text-sm font-bold mt-1">No Duty Assignments Yet</p>
                  <p className="text-xs text-gray-500 text-center">
                    Your head nurse hasn&apos;t scheduled you for any shifts yet.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="hidden lg:block">{quickInfoPanel}</div>
        </div>
      )}

      <AlertDialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End your shift now?</AlertDialogTitle>
            <AlertDialogDescription>
              This will record your actual end time. Your regular and overtime hours will be calculated from your
              real start and end times.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleEndConfirmed();
              }}
              disabled={ending}
            >
              {ending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Ending...
                </>
              ) : (
                'End Shift'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
