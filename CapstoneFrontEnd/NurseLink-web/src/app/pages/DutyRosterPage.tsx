import React, { useEffect, useMemo, useState } from 'react';
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
  Loader2,
} from 'lucide-react';
import {
  fetchDutyAssignments,
  deleteDutyAssignment,
  closeDutyAssignment,
  fetchDepartments,
  fetchNurses,
  ApiError,
} from '../api/nurselink';
import type { Department, DutyAssignment, Nurse } from '../types/domain';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DutyAssignmentModal } from '../components/DutyAssignmentModal';
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
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

type DateFilter = 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'custom' | 'all';
type ViewMode = 'list' | 'weekly';

const SHIFT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Evening', night: 'Night' };

const SHIFT_COLORS: Record<string, { color: string; bg: string; border: string; leftBorder: string; icon: typeof Sun }> = {
  morning: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', leftBorder: 'border-l-orange-500', icon: Sun },
  afternoon: { color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', leftBorder: 'border-l-purple-500', icon: Moon },
  night: { color: 'text-blue-900', bg: 'bg-blue-50', border: 'border-blue-200', leftBorder: 'border-l-blue-900', icon: MoonStar },
};
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  scheduled: { color: 'text-primary', bg: 'bg-primary-light' },
  in_progress: { color: 'text-warning-hover', bg: 'bg-warning-light' },
  completed: { color: 'text-success-hover', bg: 'bg-success-light' },
  cancelled: { color: 'text-destructive', bg: 'bg-destructive-light' },
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
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
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
function formatActualTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(d.getMinutes())} ${period}`;
}
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
function effectiveOvertimeHours(a: DutyAssignment, now: Date): number {
  if (a.actualEndTime) return a.actualOvertimeHours;
  if (a.actualStartTime) {
    const ms = now.getTime() - scheduledEnd(a).getTime();
    return ms > 0 ? Math.round((ms / 3600000) * 100) / 100 : 0;
  }
  return a.overtimeHours;
}

type AttendanceStatus = 'live' | 'overtimeLive' | 'completed' | 'overtimeDone';
function attendanceStatus(a: DutyAssignment, now: Date): AttendanceStatus | null {
  if (a.status === 'cancelled') return null;
  if (a.actualEndTime) return a.actualOvertimeHours > 0 ? 'overtimeDone' : 'completed';
  if (a.actualStartTime) return now.getTime() < scheduledEnd(a).getTime() ? 'live' : 'overtimeLive';
  return null;
}
const ATTENDANCE_CONFIG: Record<AttendanceStatus, { label: string; color: string; bg: string; dot?: string; live?: boolean }> = {
  live: { label: 'On Duty (Live)', color: 'text-success-hover', bg: 'bg-success-light', dot: 'bg-success', live: true },
  overtimeLive: { label: 'Overtime (Live)', color: 'text-destructive', bg: 'bg-destructive-light', dot: 'bg-destructive', live: true },
  completed: { label: 'Completed', color: 'text-muted-foreground', bg: 'bg-muted' },
  overtimeDone: { label: 'Completed — Overtime', color: 'text-destructive', bg: 'bg-destructive-light' },
};
const SHIFT_DOT: Record<string, string> = { morning: 'bg-orange-500', afternoon: 'bg-purple-500', night: 'bg-blue-900' };
const MISSED_CLOCKOUT_MINUTES = 120;
function isMissedClockout(a: DutyAssignment, now: Date): boolean {
  if (!a.actualStartTime || a.actualEndTime) return false;
  return (now.getTime() - scheduledEnd(a).getTime()) / 60000 > MISSED_CLOCKOUT_MINUTES;
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function avatarHue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export default function DutyRosterPage() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'head_nurse';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [assignments, setAssignments] = useState<DutyAssignment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [nurses, setNurses] = useState<Nurse[]>([]);

  const [view, setView] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('week');
  const [customDate, setCustomDate] = useState(todayIso());
  const [shiftFilter, setShiftFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editing, setEditing] = useState<DutyAssignment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DutyAssignment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [toClose, setToClose] = useState<DutyAssignment | null>(null);
  const [closing, setClosing] = useState(false);
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
    void loadData();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => void loadData(), 120000);
    return () => clearInterval(id);
  }, []);

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
        if (shiftFilter !== 'all' && a.shift !== shiftFilter) return false;
        if (deptFilter !== 'all' && String(a.departmentId) !== deptFilter) return false;
        if (statusFilter !== 'all' && a.status !== statusFilter) return false;
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
      overtimeHours: Math.round(todaysActive.reduce((sum, a) => sum + effectiveOvertimeHours(a, now), 0) * 100) / 100,
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
    { label: 'All Shifts', value: 'all' },
    { label: 'Morning', value: 'morning' },
    { label: 'Evening', value: 'afternoon' },
    { label: 'Night', value: 'night' },
  ];
  const deptOptions = [{ label: 'All Departments', value: 'all' }, ...departments.map((d) => ({ label: d.name, value: String(d.id) }))];
  const statusOptions = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Scheduled', value: 'scheduled' },
    { label: 'In Progress', value: 'in_progress' },
    { label: 'Completed', value: 'completed' },
    { label: 'Cancelled', value: 'cancelled' },
  ];

  const filtersActive = dateFilter !== 'week' || shiftFilter !== 'all' || deptFilter !== 'all' || statusFilter !== 'all';
  const clearFilters = () => {
    setDateFilter('week');
    setShiftFilter('all');
    setDeptFilter('all');
    setStatusFilter('all');
  };

  const renderCard = (a: DutyAssignment) => {
    const shiftColors = SHIFT_COLORS[a.shift] || SHIFT_COLORS.morning;
    const attendance = attendanceStatus(a, now);
    const badge = attendance
      ? ATTENDANCE_CONFIG[attendance]
      : { label: a.statusLabel, ...(STATUS_COLORS[a.status] || STATUS_COLORS.scheduled) };
    const otLabel = liveOvertimeLabel(a, now);
    const effectiveOT = effectiveOvertimeHours(a, now);
    const missedClockout = isMissedClockout(a, now);
    const highlighted = justSavedId === a.id;
    return (
      <Card
        key={a.id}
        className={`border-l-4 transition-shadow hover:shadow-md ${shiftColors.leftBorder} ${highlighted ? 'ring-2 ring-primary bg-primary-light' : ''}`}
      >
        <CardContent className={`p-3 space-y-1.5 ${shiftColors.color}`}>
          <div className="flex items-center justify-between gap-2 text-foreground">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div
                className="w-6.5 h-6.5 rounded-full flex items-center justify-center shrink-0 text-white text-[10.5px] font-extrabold"
                style={{ width: 26, height: 26, backgroundColor: `hsl(${avatarHue(a.nurseName)} 60% 42%)` }}
              >
                {initials(a.nurseName)}
              </div>
              <p className="text-sm font-bold truncate">{a.nurseName}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.bg} ${badge.color}`}>
              {'live' in badge && badge.live ? <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> : null}
              {badge.label}
            </span>
          </div>

          {missedClockout ? (
            <div className="inline-flex items-center gap-1.5 bg-destructive-light border border-destructive/30 rounded px-2 py-1">
              <AlertTriangle className="w-3 h-3 text-destructive" />
              <span className="text-[11px] font-bold text-destructive">Not clocked out — needs follow-up</span>
            </div>
          ) : null}

          <div className="flex items-center gap-3 flex-wrap text-foreground">
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{a.departmentName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{formatDateLabel(a.dutyDate)}</span>
            </div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] font-bold ${shiftColors.bg} ${shiftColors.color}`}>
              <Clock className="w-2.5 h-2.5" />
              {a.scheduleWindowLabel
                ? `${SHIFT_LABELS[a.shift] || a.shift} · ${a.scheduleWindowLabel}`
                : `${SHIFT_LABELS[a.shift] || a.shift} · ${formatTime(a.startTime)}–${formatTime(a.endTime)}`}
            </span>
          </div>
          {otLabel ? <p className="text-destructive font-bold text-[11.5px]">Overtime +{otLabel}</p> : null}

          {a.actualStartTime ? (
            <p className="text-[11.5px] text-gray-600 font-semibold">
              Started: {formatActualTime(a.actualStartTime)}
              {a.actualEndTime ? ` · Ended: ${formatActualTime(a.actualEndTime)}` : ''}
            </p>
          ) : null}
          {a.actualEndRecordedBy ? (
            <div className="inline-flex items-center gap-1.5 bg-warning-light border border-warning/40 rounded px-2 py-1">
              <ShieldAlert className="w-3 h-3 text-warning-hover" />
              <span className="text-[11px] font-bold text-warning-hover">
                Closed by {a.actualEndRecordedBy} (head nurse correction)
              </span>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2.5 flex-wrap pt-0.5">
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">Reg {a.regularHours}h</span>
              {effectiveOT > 0 ? (
                <span className="text-[11px] font-bold text-warning-hover bg-warning-light px-1.5 py-0.5 rounded">OT {effectiveOT}h</span>
              ) : null}
              <span className="text-[11px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
                Total {Math.round((a.regularHours + effectiveOT) * 100) / 100}h
              </span>
            </div>
            {isSupervisor ? (
              <div className="flex gap-1">
                {a.actualStartTime && !a.actualEndTime ? (
                  <button onClick={() => askClose(a)} className="flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-semibold text-warning-hover hover:bg-warning-light">
                    <StopCircle className="w-3 h-3" />
                    Close Shift
                  </button>
                ) : null}
                <button onClick={() => openEdit(a)} className="flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-semibold text-gray-600 hover:bg-gray-100">
                  <Edit2 className="w-3 h-3" />
                  Edit
                </button>
                <button onClick={() => askDelete(a)} className="flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-semibold text-destructive hover:bg-destructive-light">
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold">Duty Roster</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage nurse schedules, departments, shifts, and overtime</p>
      </div>

      <div className="rounded-md border border-primary/20 bg-primary-light p-3">
        <p className="text-sm text-primary">
          Manage staff assignments and monitor scheduled working hours and overtime. Only authorized head nurses can
          create or modify duty assignments.
        </p>
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: CalendarDays, value: summary.todayCount, label: "Today's Duty", color: 'text-primary', bg: 'bg-primary-light' },
          { icon: Sun, value: summary.morningCount, label: 'Morning Shift', color: 'text-orange-600', bg: 'bg-orange-50' },
          { icon: Moon, value: summary.eveningCount, label: 'Evening Shift', color: 'text-purple-600', bg: 'bg-purple-50' },
          {
            icon: AlertTriangle,
            value: `${summary.overtimeHours}h`,
            label: 'Overtime Today',
            color: summary.overtimeHours > 0 ? 'text-destructive' : 'text-gray-400',
            bg: summary.overtimeHours > 0 ? 'bg-destructive-light' : 'bg-gray-50',
          },
        ].map((card) => (
          <Card key={card.label} className="shadow-sm hover:-translate-y-0.5 transition-transform">
            <CardContent className="p-3.5 space-y-0.5">
              <div className={`w-7 h-7 rounded-md flex items-center justify-center mb-1 ${card.bg}`}>
                <card.icon className={`w-3.5 h-3.5 ${card.color}`} />
              </div>
              <p className="text-2xl font-extrabold tracking-tight">{card.value}</p>
              <p className="text-[11.5px] text-muted-foreground font-semibold">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3 items-start flex-wrap">
        <div className="flex-1 min-w-[220px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by nurse, department, shift, or date..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isSupervisor ? (
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1.5" />
            Assign Nurse
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-muted p-2.5 space-y-1.5">
        <div className="flex gap-2.5 flex-wrap">
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger className={`min-w-[150px] flex-1 ${dateFilter !== 'week' ? 'border-primary' : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dateFilterOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dateFilter === 'custom' ? (
            <Input type="date" className="min-w-[150px] flex-1" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
          ) : null}
          <Select value={shiftFilter} onValueChange={setShiftFilter}>
            <SelectTrigger className={`min-w-[150px] flex-1 ${shiftFilter !== 'all' ? 'border-primary' : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shiftOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className={`min-w-[150px] flex-1 ${deptFilter !== 'all' ? 'border-primary' : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deptOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={`min-w-[150px] flex-1 ${statusFilter !== 'all' ? 'border-primary' : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtersActive ? (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-bold text-primary">
            <X className="w-3 h-3" />
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="inline-flex bg-gray-100 rounded-full p-0.5 gap-0.5">
        {(['list', 'weekly'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold ${
              view === mode ? 'bg-primary text-white shadow-sm' : 'text-gray-600'
            }`}
          >
            {mode === 'list' ? <List className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            {mode === 'list' ? 'List' : 'Weekly'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading duty roster...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 py-16">
          <CalendarDays className="w-10 h-10 text-gray-300" />
          <p className="text-base font-bold mt-1">No Duty Assignments Yet</p>
          <p className="text-sm text-gray-500 text-center max-w-xs">
            There are no nurse assignments for the selected date or filters.
          </p>
          {isSupervisor ? (
            <Button onClick={openAdd} className="mt-1">
              <Plus className="w-4 h-4 mr-1.5" />
              Assign Nurse
            </Button>
          ) : null}
        </div>
      ) : view === 'list' ? (
        <div className="space-y-2.5">{filtered.map(renderCard)}</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <div className="flex gap-2.5 px-1">
            {weekDays.map((day) => {
              const dayAssignments = filtered.filter((a) => a.dutyDate === day);
              return (
                <div key={day} className="w-[190px] shrink-0 bg-white border border-border rounded-lg p-2.5 space-y-2">
                  <div className="border-b border-border pb-1.5 mb-0.5">
                    <p className="text-xs font-bold">{formatDateLabel(day)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{dayAssignments.length} assigned</p>
                  </div>
                  {dayAssignments.length === 0 ? (
                    <p className="text-[11.5px] text-gray-400 italic py-1.5">No duties</p>
                  ) : (
                    dayAssignments.map((a) => {
                      const sc = SHIFT_COLORS[a.shift] || SHIFT_COLORS.morning;
                      const attendance = attendanceStatus(a, now);
                      const otLabel = liveOvertimeLabel(a, now);
                      return (
                        <button
                          key={a.id}
                          onClick={() => isSupervisor && openEdit(a)}
                          className={`w-full text-left rounded-md border p-2 space-y-0.5 ${sc.bg} ${sc.border}`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <p className={`text-[11.5px] font-bold truncate ${sc.color}`}>{a.departmentName}</p>
                            {attendance && ATTENDANCE_CONFIG[attendance].live ? (
                              <span className={`w-1.5 h-1.5 rounded-full ${ATTENDANCE_CONFIG[attendance].dot} animate-pulse`} />
                            ) : null}
                          </div>
                          <p className={`text-[10.5px] font-semibold ${sc.color}`}>{SHIFT_LABELS[a.shift]}</p>
                          <p className="text-[11px] text-gray-700 truncate">{a.nurseName}</p>
                          {a.actualStartTime ? (
                            <p className="text-[10px] text-gray-500 font-semibold truncate">
                              Started {formatActualTime(a.actualStartTime)}
                              {a.actualEndTime ? ` · Ended ${formatActualTime(a.actualEndTime)}` : ''}
                            </p>
                          ) : null}
                          {otLabel ? <p className="text-destructive font-bold text-[10px] truncate">Overtime +{otLabel}</p> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isSupervisor && departmentWorkload.length > 0 ? (
        <div className="rounded-lg border border-primary/20 bg-primary-light p-3.5 space-y-1">
          <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1">Department Workload — Today</p>
          {departmentWorkload.map(([name, counts]) => (
            <div key={name} className="py-2 border-t border-primary/15 space-y-1.5 first:border-t-0">
              <p className="text-sm font-bold">{name}</p>
              <div className="flex gap-3.5 flex-wrap">
                {(['morning', 'afternoon', 'night'] as const).map((shift) => (
                  <div key={shift} className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${SHIFT_DOT[shift]}`} />
                    <span className="text-[11.5px] text-muted-foreground font-semibold">
                      {SHIFT_LABELS[shift]} {counts[shift]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Duty Assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `Are you sure you want to remove ${toDelete.nurseName}'s duty assignment for ${toDelete.departmentName} on ${formatDateLabel(toDelete.dutyDate)}?`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Assignment'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Out This Shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {toClose
                ? `${toClose.nurseName} started this shift but never ended it. Ending it now will set the end time to right now and log it as a head nurse correction — this cannot be undone and will be clearly marked as your action, not theirs.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={closing}
              onClick={(e) => {
                e.preventDefault();
                void confirmClose();
              }}
            >
              {closing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Closing...
                </>
              ) : (
                'Close Shift Now'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
