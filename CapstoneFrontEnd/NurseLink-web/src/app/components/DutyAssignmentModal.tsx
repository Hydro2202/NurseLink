import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { CalendarDays, CircleCheck, CircleAlert, CircleX, Loader2 } from 'lucide-react';
import {
  createDutyAssignment,
  updateDutyAssignment,
  ApiError,
  type DutyAssignmentInput,
} from '../api/nurselink';
import type { Department, DutyAssignment, Nurse } from '../types/domain';
import { toast } from 'sonner';
import { PresenceDot } from './PresenceDot';
import { sortByPresence } from '../utils/presence';

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
  const startMin = Number(s[1]) * 60 + Number(s[2]);
  let endMin = Number(e[1]) * 60 + Number(e[2]);
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

function toMinutesOfDay(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayIso(): string {
  return toIsoLocal(new Date());
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
    const dayOffset = (d: string) =>
      (new Date(d + 'T00:00:00').getTime() - new Date(dutyDate + 'T00:00:00').getTime()) / 86400000;
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
  const totalHours = regularHours !== null ? Math.round((regularHours + (overtimeHours || 0)) * 100) / 100 : null;

  const availability = useMemo(
    () => checkAvailability(nurseId, dutyDate, startTime, endTime, allAssignments, assignment?.id),
    [nurseId, dutyDate, startTime, endTime, allAssignments, assignment?.id]
  );

  // Several real accounts in this hospital's roster share the same display
  // name — the email is what actually tells them apart, so it's shown in
  // the option label itself. Active nurses are listed first.
  const nurseOptions = sortByPresence(nurses).map((n) => ({
    label: n.email ? `${n.name} — ${n.email}` : n.name,
    value: n.id,
    presence: n.presence,
    lastSeenAt: n.lastSeenAt,
  }));
  const departmentOptions = departments.map((d) => ({ label: d.name, value: String(d.id) }));

  const canSubmit = !!nurseId && !!departmentId && isValidDate(dutyDate) && regularHours !== null && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        toast.success('Duty Assignment Updated', { description: `${nurseName}'s assignment was updated.` });
      } else {
        saved = await createDutyAssignment(payload);
        toast.success('Duty Assignment Created', { description: `${nurseName} has been assigned to ${deptName}.` });
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

  const availabilityStyle: Record<Availability, string> = {
    available: 'bg-success-light border-success/30 text-success-hover',
    scheduled: 'bg-warning-light border-warning/30 text-warning-hover',
    conflict: 'bg-destructive-light border-destructive/30 text-destructive',
  };
  const availabilityText: Record<Availability, string> = {
    available: 'Available for this date and time',
    scheduled: 'Already scheduled this day (different time)',
    conflict: 'Schedule conflict — overlaps an existing duty',
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[525px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            {mode === 'edit' ? 'Edit Duty Assignment' : 'Assign Nurse'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? "Update this nurse's department, date, shift, or hours."
              : 'Assign a nurse to a department, date, and shift.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError ? <p className="text-sm text-destructive font-medium">{formError}</p> : null}

          <div className="space-y-2">
            <Label htmlFor="duty-nurse">Nurse *</Label>
            <Select value={nurseId} onValueChange={setNurseId}>
              <SelectTrigger id="duty-nurse">
                <SelectValue placeholder="Select nurse" />
              </SelectTrigger>
              <SelectContent>
                {nurseOptions.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No approved nurses found.
                  </SelectItem>
                ) : (
                  nurseOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="inline-flex items-center gap-1.5">
                        <PresenceDot presence={o.presence} lastSeenAt={o.lastSeenAt} />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {availability && nurseId ? (
            <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${availabilityStyle[availability]}`}>
              {availability === 'available' ? (
                <CircleCheck className="w-4 h-4 shrink-0" />
              ) : availability === 'scheduled' ? (
                <CircleAlert className="w-4 h-4 shrink-0" />
              ) : (
                <CircleX className="w-4 h-4 shrink-0" />
              )}
              <span>{availabilityText[availability]}</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="duty-department">Department *</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger id="duty-department">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departmentOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="duty-date">Duty Date *</Label>
            <Input id="duty-date" type="date" value={dutyDate} onChange={(e) => setDutyDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duty-shift">Shift *</Label>
            <Select value={shift} onValueChange={handleShiftChange}>
              <SelectTrigger id="duty-shift">
                <SelectValue placeholder="Select shift" />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duty-start">Start Time *</Label>
              <Input id="duty-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duty-end">End Time *</Label>
              <Input id="duty-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary-light p-3 space-y-1.5">
            <div className="flex justify-between text-xs font-semibold text-primary">
              <span>Regular Hours</span>
              <span>{regularHours !== null ? `${regularHours}h` : '—'}</span>
            </div>
            <div className="flex justify-between text-xs font-semibold text-primary">
              <span>Overtime</span>
              <span>{overtimeHours ? `${overtimeHours}h` : '0h'}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-primary border-t border-primary/20 pt-1.5 mt-1">
              <span>Total Hours</span>
              <span>{totalHours !== null ? `${totalHours}h` : '—'}</span>
            </div>
          </div>

          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide -mb-2">Overtime (optional)</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duty-ot-start">Overtime Start</Label>
              <Input id="duty-ot-start" type="time" value={overtimeStart} onChange={(e) => setOvertimeStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duty-ot-end">Overtime End</Label>
              <Input id="duty-ot-end" type="time" value={overtimeEnd} onChange={(e) => setOvertimeEnd(e.target.value)} />
            </div>
          </div>

          {mode === 'edit' ? (
            <div className="space-y-2">
              <Label htmlFor="duty-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="duty-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="duty-notes">Notes</Label>
            <Textarea
              id="duty-notes"
              placeholder="Optional notes for this assignment..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : mode === 'edit' ? (
                'Save Changes'
              ) : (
                'Assign Nurse'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
