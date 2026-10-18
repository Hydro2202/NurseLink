import { useEffect, useState, type ReactNode } from 'react';
import {
  HeartPulse,
  Clock,
  Plus,
  Check,
  X,
  Pencil,
  Activity,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { fetchVitalReadings, createVitalSigns, ApiError } from '../api/nurselink';
import type { VitalReading } from '../types/domain';

/** Web port of mobile's components/TaskVitalSignsBars.tsx — same slot flow
 * (enter a monitoring time, then the vitals for it), same required fields,
 * same abnormal thresholds, same "N needed to complete" gate. */

const BASE_SLOT_COUNT = 3;
// <input type="time"> always yields 24h "HH:mm" regardless of display locale.
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface TaskVitalSignsBarsProps {
  taskId: string;
  patientId: string;
  /** How many logged readings unlock the gated checklist step — surfaced
   * here too so the hint text and the gate agree on the same number. */
  readingsRequired?: number;
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

type ReadingForm = ReturnType<typeof emptyReadingForm>;
type NumericField = Exclude<keyof ReadingForm, 'oxygenUse'>;

// Same clinical thresholds as mobile (and its Kardex VitalSignsGrid) so a
// value never reads "normal" on one platform and "abnormal" on the other.
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

/** "20:05" -> "8:05 PM", for showing a draft slot time. */
function formatDraftTime(hhmm: string) {
  const match = TIME_PATTERN.exec(hhmm);
  if (!match) return hhmm;
  const h = Number(match[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${match[2]} ${suffix}`;
}

/** "20:05" -> today's date at that time, as an ISO string for `recordedAt`. */
function buildRecordedAtIso(hhmm: string): string | null {
  const match = TIME_PATTERN.exec(hhmm.trim());
  if (!match) return null;
  const d = new Date();
  d.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return d.toISOString();
}

/** Parses a field to a finite number, or 'invalid' so the caller can tell
 * "left blank" apart from "typed something non-numeric". */
function parseOptionalNumber(text: string): number | undefined | 'invalid' {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : 'invalid';
}

type SlotStatus = 'not_recorded' | 'time_entered' | 'completed';

const STATUS_DOTS: { key: NumericField; label: string }[] = [
  { key: 'systolic', label: 'SBP' },
  { key: 'diastolic', label: 'DBP' },
  { key: 'pulseRate', label: 'HR' },
  { key: 'respiratoryRate', label: 'RR' },
  { key: 'oxygenSaturation', label: 'SpO2' },
  { key: 'painScale', label: 'Pain' },
];

function VitalSignRow({
  label,
  hint,
  abnormal,
  children,
}: {
  label: string;
  hint: string;
  abnormal: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-md border p-3 space-y-1.5 ${
        abnormal ? 'border-orange-300 bg-orange-50' : 'border-border bg-gray-50'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
      <p className={`text-[11px] ${abnormal ? 'text-orange-700' : 'text-gray-500'}`}>{hint}</p>
    </div>
  );
}

function VitalValueInput({
  value,
  onChange,
  unit,
  abnormal,
  center,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  abnormal: boolean;
  center?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <Input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`min-w-0 flex-1 bg-white text-lg font-bold ${center ? 'text-center' : ''} ${
          abnormal ? 'border-orange-500 text-orange-700' : ''
        }`}
      />
      {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
    </div>
  );
}

export function TaskVitalSignsBars({
  taskId,
  patientId,
  readingsRequired = 2,
  onReadingsChange,
}: TaskVitalSignsBarsProps) {
  const [readings, setReadings] = useState<VitalReading[]>([]);
  const [loading, setLoading] = useState(true);
  // Only grows on an explicit "Add Monitoring Time" click — visibleSlots is
  // derived below, widening automatically once readings catch up to it.
  const [manualSlotFloor, setManualSlotFloor] = useState(BASE_SLOT_COUNT);
  // A slot's time is entered before its vitals, and isn't a database row
  // until the vitals are saved (VitalSigns is insert-only), so it lives here
  // as a draft keyed by slot index.
  const [draftTimes, setDraftTimes] = useState<Record<number, string>>({});
  const [timeInputIndex, setTimeInputIndex] = useState<number | null>(null);
  const [timeInputValue, setTimeInputValue] = useState('');
  const [vitalsFormIndex, setVitalsFormIndex] = useState<number | null>(null);
  const [form, setForm] = useState(emptyReadingForm());
  const [saving, setSaving] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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

  const visibleSlots = Math.max(manualSlotFloor, readings.length);
  const canAddSlot = readings.length >= visibleSlots;

  const startTimeEntry = (index: number) => {
    setTimeInputValue(draftTimes[index] || '');
    setTimeInputIndex(index);
    setVitalsFormIndex(null);
  };

  const confirmTime = (index: number) => {
    if (!TIME_PATTERN.test(timeInputValue.trim())) {
      toast.error('Select a time', { description: 'Choose an hour and minute before continuing.' });
      return;
    }
    setDraftTimes((prev) => ({ ...prev, [index]: timeInputValue.trim() }));
    setTimeInputIndex(null);
  };

  const openVitalsForm = (index: number) => {
    setForm(emptyReadingForm());
    setVitalsFormIndex(index);
  };

  const closeVitalsForm = () => {
    setVitalsFormIndex(null);
    setForm(emptyReadingForm());
  };

  const setField = (key: NumericField, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setOxygenUse = (value: 'yes' | 'no') => {
    setForm((prev) => ({ ...prev, oxygenUse: prev.oxygenUse === value ? '' : value }));
  };

  const handleSaveReading = async (index: number) => {
    const timeText = draftTimes[index];
    const recordedAt = timeText ? buildRecordedAtIso(timeText) : null;
    if (!recordedAt) {
      toast.error('Monitoring time is required', {
        description: 'Enter the time this reading was taken before saving.',
      });
      return;
    }

    // Every field is required except Pain Level.
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
    const invalidField = (
      [
        ['Temperature', temperature],
        ['Heart Rate', heartRate],
        ['Resp Rate', respiratoryRate],
        ['Systolic BP', systolic],
        ['Diastolic BP', diastolic],
        ['SpO2', oxygenSaturation],
        ['Pain Level', painScale],
      ] as const
    ).find(([, v]) => v === 'invalid');
    if (invalidField) {
      toast.error('Invalid value', { description: `${invalidField[0]} must be a number.` });
      return;
    }

    setSaving(true);
    try {
      const created = await createVitalSigns({
        patientId,
        taskId,
        recordedAt,
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
      setDraftTimes((prev) => {
        const rest = { ...prev };
        delete rest[index];
        return rest;
      });
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin text-red-600" />
        Loading vital signs check-ins...
      </div>
    );
  }

  const slots = Array.from({ length: visibleSlots }, (_, i) => i);
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  const newestFirstReadings = [...readings].reverse();

  const badge = (tone: 'done' | 'pending' | 'none', text: string) => (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
        tone === 'done'
          ? 'bg-green-100 text-green-700'
          : tone === 'pending'
            ? 'bg-orange-50 text-orange-700'
            : 'bg-gray-100 text-gray-500'
      }`}
    >
      {text}
    </span>
  );

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] items-start">
      {/* Main column: monitoring slots */}
      <div className="space-y-2 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <HeartPulse className="w-4 h-4 text-red-600" />
          <span className="text-sm font-bold text-gray-800">Vital Signs Monitoring</span>
          <span className="ml-auto text-xs text-gray-500">
            {readings.length}/{readingsRequired} needed to complete
          </span>
        </div>
        {readings.length < readingsRequired ? (
          <p className="text-xs text-orange-700">
            Record at least {readingsRequired} completed vital sign checks before this task's checklist
            can be marked complete.
          </p>
        ) : (
          <p className="text-xs font-semibold text-green-700">
            Minimum met — the checklist step can now be marked complete.
          </p>
        )}

        <div className="space-y-2">
          {slots.map((index) => {
            const reading = readings[index];
            const isNextSlot = !reading && index === readings.length;
            const status: SlotStatus = reading
              ? 'completed'
              : draftTimes[index]
                ? 'time_entered'
                : 'not_recorded';
            const isEnteringTime = timeInputIndex === index;
            const isEnteringVitals = vitalsFormIndex === index;
            const slotLabel = (
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                Monitoring {index + 1}
              </p>
            );

            if (status === 'completed' && reading) {
              return (
                <div key={index} className="rounded-md border border-green-200 bg-green-50 p-2.5 space-y-1">
                  {slotLabel}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-green-700" />
                    <span className="text-xs font-bold text-green-700">{formatTime(reading.recordedAt)}</span>
                    {badge('done', 'Completed ✓')}
                    {reading.recordedByName ? (
                      <span className="ml-auto text-[11px] text-gray-500">by {reading.recordedByName}</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-700">
                    {reading.temperature != null ? `${reading.temperature}°C` : '—'}
                    {' · '}
                    {reading.heartRate != null ? `${reading.heartRate}bpm` : '—'}
                    {' · '}
                    {reading.bloodPressure || '—'}
                    {' · '}
                    {reading.oxygenSaturation != null ? `${reading.oxygenSaturation}%` : '—'}
                  </p>
                </div>
              );
            }

            return (
              <div key={index} className="space-y-1">
                {slotLabel}
                {status === 'not_recorded' ? (
                  <button
                    type="button"
                    disabled={!isNextSlot}
                    onClick={() => startTimeEntry(index)}
                    className={`w-full flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-2.5 text-left ${
                      isNextSlot
                        ? 'border-blue-300 bg-blue-50 hover:bg-blue-100'
                        : 'border-border bg-gray-50 cursor-not-allowed'
                    }`}
                  >
                    <Clock className={`w-3.5 h-3.5 ${isNextSlot ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span
                      className={`text-xs ${
                        isNextSlot ? 'font-semibold text-blue-700' : 'font-medium text-gray-400'
                      }`}
                    >
                      {isNextSlot ? 'Click to enter monitoring time' : 'Waiting on earlier entries'}
                    </span>
                    <span className="ml-auto">{badge('none', 'Not Recorded')}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-md border border-orange-100 bg-orange-50 px-2.5 py-2.5">
                    <Clock className="w-3.5 h-3.5 text-orange-700" />
                    <span className="text-xs font-bold text-orange-700">
                      {formatDraftTime(draftTimes[index])}
                    </span>
                    {badge('pending', 'Time entered')}
                    <button
                      type="button"
                      aria-label="Change monitoring time"
                      onClick={() => startTimeEntry(index)}
                      className="ml-auto p-1 rounded hover:bg-orange-100"
                    >
                      <Pencil className="w-3 h-3 text-gray-500" />
                    </button>
                  </div>
                )}

                {isEnteringTime ? (
                  <div className="mt-2 rounded-md border border-border bg-white p-3 space-y-3 shadow-sm">
                    <div className="space-y-2">
                      <Label htmlFor={`vitals-time-${taskId}-${index}`}>Monitoring Time</Label>
                      <Input
                        id={`vitals-time-${taskId}-${index}`}
                        type="time"
                        value={timeInputValue}
                        onChange={(e) => setTimeInputValue(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setTimeInputIndex(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => confirmTime(index)}
                      >
                        Set Time
                      </Button>
                    </div>
                  </div>
                ) : null}

                {status === 'time_entered' && !isEnteringTime ? (
                  isEnteringVitals ? (
                    <div className="mt-2 rounded-md border border-border bg-white p-3 space-y-2.5 shadow-sm">
                      <div className="flex flex-wrap justify-between border-b border-border pb-2">
                        {STATUS_DOTS.map((dot) => {
                          const abnormal = isAbnormal(dot.key, form[dot.key]);
                          return (
                            <div key={dot.key} className="flex min-w-[40px] flex-col items-center gap-1">
                              <span
                                className={`h-2 w-2 rounded-full ${abnormal ? 'bg-orange-600' : 'bg-green-600'}`}
                              />
                              <span className="text-[9px] font-bold text-gray-500">{dot.label}</span>
                            </div>
                          );
                        })}
                      </div>

                      <VitalSignRow
                        label="Temperature"
                        hint="Normal: 36.1-37.5°C"
                        abnormal={isAbnormal('temperature', form.temperature)}
                      >
                        <VitalValueInput
                          ariaLabel="Temperature"
                          value={form.temperature}
                          onChange={(v) => setField('temperature', v)}
                          unit="°C"
                          abnormal={isAbnormal('temperature', form.temperature)}
                        />
                      </VitalSignRow>

                      <VitalSignRow
                        label="Blood Pressure"
                        hint="Normal: 90-140 / 60-90 mmHg"
                        abnormal={
                          isAbnormal('systolic', form.systolic) || isAbnormal('diastolic', form.diastolic)
                        }
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
                          <VitalValueInput
                            ariaLabel="Systolic blood pressure"
                            value={form.systolic}
                            onChange={(v) => setField('systolic', v)}
                            abnormal={isAbnormal('systolic', form.systolic)}
                            center
                          />
                          <span className="text-lg font-bold text-gray-400">/</span>
                          <VitalValueInput
                            ariaLabel="Diastolic blood pressure"
                            value={form.diastolic}
                            onChange={(v) => setField('diastolic', v)}
                            abnormal={isAbnormal('diastolic', form.diastolic)}
                            center
                          />
                        </div>
                      </VitalSignRow>

                      <VitalSignRow
                        label="Heart Rate"
                        hint="Normal: 60-100 bpm"
                        abnormal={isAbnormal('pulseRate', form.pulseRate)}
                      >
                        <VitalValueInput
                          ariaLabel="Heart rate"
                          value={form.pulseRate}
                          onChange={(v) => setField('pulseRate', v)}
                          unit="bpm"
                          abnormal={isAbnormal('pulseRate', form.pulseRate)}
                        />
                      </VitalSignRow>

                      <VitalSignRow
                        label="Resp Rate"
                        hint="Normal: 12-20/min"
                        abnormal={isAbnormal('respiratoryRate', form.respiratoryRate)}
                      >
                        <VitalValueInput
                          ariaLabel="Respiratory rate"
                          value={form.respiratoryRate}
                          onChange={(v) => setField('respiratoryRate', v)}
                          unit="/min"
                          abnormal={isAbnormal('respiratoryRate', form.respiratoryRate)}
                        />
                      </VitalSignRow>

                      <VitalSignRow
                        label="SpO2"
                        hint="Normal: 95-100%"
                        abnormal={isAbnormal('oxygenSaturation', form.oxygenSaturation)}
                      >
                        <VitalValueInput
                          ariaLabel="Oxygen saturation"
                          value={form.oxygenSaturation}
                          onChange={(v) => setField('oxygenSaturation', v)}
                          unit="%"
                          abnormal={isAbnormal('oxygenSaturation', form.oxygenSaturation)}
                        />
                      </VitalSignRow>

                      <VitalSignRow label="O2 Use" hint="On supplemental oxygen?" abnormal={false}>
                        <div className="flex gap-2">
                          {(['yes', 'no'] as const).map((opt) => {
                            const active = form.oxygenUse === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setOxygenUse(opt)}
                                className={`flex-1 rounded-full border py-1.5 text-sm font-semibold transition-colors ${
                                  active
                                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                                    : 'border-border bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                              >
                                {opt === 'yes' ? 'Yes' : 'No'}
                              </button>
                            );
                          })}
                        </div>
                      </VitalSignRow>

                      <VitalSignRow
                        label="Pain Level"
                        hint="Scale: 0-10"
                        abnormal={isAbnormal('painScale', form.painScale)}
                      >
                        <VitalValueInput
                          ariaLabel="Pain level"
                          value={form.painScale}
                          onChange={(v) => setField('painScale', v)}
                          unit="/10"
                          abnormal={isAbnormal('painScale', form.painScale)}
                        />
                      </VitalSignRow>

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={closeVitalsForm}
                          disabled={saving}
                        >
                          <X className="w-3.5 h-3.5" />
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => handleSaveReading(index)}
                          disabled={saving}
                        >
                          {saving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          Save Reading
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2 w-full md:w-auto bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => openVitalsForm(index)}
                    >
                      <HeartPulse className="w-3.5 h-3.5" />
                      Input Vital Signs
                    </Button>
                  )
                ) : null}
              </div>
            );
          })}

          {canAddSlot ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full md:w-auto border-blue-200 text-blue-600 hover:text-blue-700"
              onClick={() => setManualSlotFloor((v) => v + 1)}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Monitoring Time
            </Button>
          ) : null}
        </div>
      </div>

      {/* Side column: latest summary + history */}
      <div className="space-y-3 min-w-0">
        <div className="rounded-md border border-border bg-gray-50 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-xs font-bold text-gray-800">Latest Vital Signs</span>
          </div>
          {latestReading ? (
            <>
              <p className="text-[11px] text-gray-500">
                {formatDate(latestReading.recordedAt)} · {formatTime(latestReading.recordedAt)}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['TEMP', latestReading.temperature != null ? `${latestReading.temperature}°C` : '—'],
                  ['PULSE', latestReading.heartRate != null ? `${latestReading.heartRate}bpm` : '—'],
                  [
                    'RESP',
                    latestReading.respiratoryRate != null ? `${latestReading.respiratoryRate}/min` : '—',
                  ],
                  ['BP', latestReading.bloodPressure || '—'],
                  [
                    'O2 SAT',
                    latestReading.oxygenSaturation != null ? `${latestReading.oxygenSaturation}%` : '—',
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-border bg-white px-2 py-1.5">
                    <p className="text-[9px] font-bold tracking-wide text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-xs font-bold text-gray-900">{value}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs italic text-gray-500">No vital signs recorded yet for this task.</p>
          )}
        </div>

        <div className="rounded-md border border-border bg-gray-50 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-purple-600" />
            <span className="text-xs font-bold text-gray-800">Monitoring History</span>
          </div>
          {newestFirstReadings.length === 0 ? (
            <p className="text-xs italic text-gray-500">Entries will appear here once saved.</p>
          ) : (
            <div className="space-y-2">
              {newestFirstReadings.map((reading) => {
                const isExpanded = expandedHistoryId === reading.id;
                return (
                  <div key={reading.id} className="rounded border border-border bg-white p-2">
                    <button
                      type="button"
                      className="w-full flex items-center gap-1.5 text-left"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : reading.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800">
                          {formatDate(reading.recordedAt)} · {formatTime(reading.recordedAt)}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          #{reading.id}
                          {reading.recordedByName ? ` · by ${reading.recordedByName}` : ''}
                        </p>
                      </div>
                      {badge('done', 'Completed ✓')}
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                      )}
                    </button>
                    {isExpanded ? (
                      <p className="mt-1.5 text-[11px] leading-4 text-gray-700">
                        Temp {reading.temperature != null ? `${reading.temperature}°C` : '—'} · Pulse{' '}
                        {reading.heartRate != null ? `${reading.heartRate}bpm` : '—'} · Resp{' '}
                        {reading.respiratoryRate != null ? `${reading.respiratoryRate}/min` : '—'} · BP{' '}
                        {reading.bloodPressure || '—'} · O2{' '}
                        {reading.oxygenSaturation != null ? `${reading.oxygenSaturation}%` : '—'}
                        {reading.oxygenUse != null ? ` · O2 Use ${reading.oxygenUse ? 'Yes' : 'No'}` : ''}
                        {reading.painScale != null ? ` · Pain ${reading.painScale}/10` : ''}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
