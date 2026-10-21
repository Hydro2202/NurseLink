import { useEffect, useState, type ReactNode } from 'react';
import {
  HeartPulse,
  Clock,
  Check,
  X,
  Activity,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { fetchVitalReadings, createVitalSigns, ApiError } from '../api/nurselink';
import type { VitalReading } from '../types/domain';

/** Web port of mobile's components/TaskVitalSignsBars.tsx — one monitoring
 * entry per Vital Signs Check task (the patient's recurring schedule is the
 * next scheduled task, not repeated entries inside this one), same required
 * fields and abnormal thresholds as before. */

interface TaskVitalSignsBarsProps {
  taskId: string;
  patientId: string;
  /** How many logged readings unlock the gated checklist step — 1 for a
   * task generated from the Kardex-interval schedule, 2 for a
   * free-standing one (see Task.vital_readings_required on the backend).
   * Defaults to 1 — the common case. */
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

/** Parses a field to a finite number, or 'invalid' so the caller can tell
 * "left blank" apart from "typed something non-numeric". */
function parseOptionalNumber(text: string): number | undefined | 'invalid' {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : 'invalid';
}

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
  readingsRequired = 1,
  onReadingsChange,
}: TaskVitalSignsBarsProps) {
  const [readings, setReadings] = useState<VitalReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
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

  const openVitalsForm = () => {
    setForm(emptyReadingForm());
    setRecording(true);
  };

  const closeVitalsForm = () => {
    setRecording(false);
    setForm(emptyReadingForm());
  };

  const setField = (key: NumericField, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setOxygenUse = (value: 'yes' | 'no') => {
    setForm((prev) => ({ ...prev, oxygenUse: prev.oxygenUse === value ? '' : value }));
  };

  const handleSaveReading = async () => {
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
        // The actual moment of recording — a single-entry task has no
        // separate "which scheduled slot is this" time to pick in advance.
        recordedAt: new Date().toISOString(),
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
        Loading vital signs check-in...
      </div>
    );
  }

  // Most tasks only ever need 1 (the common, Kardex-scheduled case); a
  // free-standing vital signs task needs 2 (see readingsRequired above).
  // Rendering every already-recorded reading as its own card, not just the
  // latest, is what makes the rare 2-required case show progress instead
  // of silently replacing the first reading's card with the second's.
  const required = Math.max(readingsRequired, 1);
  const isComplete = readings.length >= required;
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  const newestFirstReadings = [...readings].reverse();

  const badge = (tone: 'done' | 'none', text: string) => (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
        tone === 'done' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {text}
    </span>
  );

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] items-start">
      {/* Main column: the one monitoring entry */}
      <div className="space-y-2 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <HeartPulse className="w-4 h-4 text-red-600" />
          <span className="text-sm font-bold text-gray-800">Vital Signs Monitoring</span>
          <span className="ml-auto">
            {isComplete
              ? badge('done', 'Recorded')
              : badge('none', required > 1 ? `${readings.length}/${required} Recorded` : 'Not Recorded')}
          </span>
        </div>
        {!isComplete ? (
          <p className="text-xs text-orange-700">
            {required > 1
              ? `Record ${required} vital sign readings (${readings.length} so far) before this task's checklist can be marked complete.`
              : "Record the vital signs reading before this task's checklist can be marked complete."}
          </p>
        ) : (
          <p className="text-xs font-semibold text-green-700">
            Recorded — the checklist step can now be marked complete.
          </p>
        )}

        {readings.map((r) => (
          <div key={r.id} className="rounded-md border border-green-200 bg-green-50 p-2.5 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-green-700" />
              <span className="text-xs font-bold text-green-700">
                {formatDate(r.recordedAt)} · {formatTime(r.recordedAt)}
              </span>
              {badge('done', 'Recorded ✓')}
              {r.recordedByName ? (
                <span className="ml-auto text-[11px] text-gray-500">by {r.recordedByName}</span>
              ) : null}
            </div>
            <p className="text-xs text-gray-700">
              {r.temperature != null ? `${r.temperature}°C` : '—'}
              {' · '}
              {r.heartRate != null ? `${r.heartRate}bpm` : '—'}
              {' · '}
              {r.bloodPressure || '—'}
              {' · '}
              {r.oxygenSaturation != null ? `${r.oxygenSaturation}%` : '—'}
            </p>
          </div>
        ))}
        {isComplete ? null : recording ? (
          <div className="mt-2 rounded-md border border-border bg-white p-3 space-y-2.5 shadow-sm">
            <div className="flex flex-wrap justify-between border-b border-border pb-2">
              {STATUS_DOTS.map((dot) => {
                const abnormal = isAbnormal(dot.key, form[dot.key]);
                return (
                  <div key={dot.key} className="flex min-w-[40px] flex-col items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${abnormal ? 'bg-orange-600' : 'bg-green-600'}`} />
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
              abnormal={isAbnormal('systolic', form.systolic) || isAbnormal('diastolic', form.diastolic)}
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

            <VitalSignRow label="Heart Rate" hint="Normal: 60-100 bpm" abnormal={isAbnormal('pulseRate', form.pulseRate)}>
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

            <VitalSignRow label="Pain Level" hint="Scale: 0-10" abnormal={isAbnormal('painScale', form.painScale)}>
              <VitalValueInput
                ariaLabel="Pain level"
                value={form.painScale}
                onChange={(v) => setField('painScale', v)}
                unit="/10"
                abnormal={isAbnormal('painScale', form.painScale)}
              />
            </VitalSignRow>

            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={closeVitalsForm} disabled={saving}>
                <X className="w-3.5 h-3.5" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleSaveReading}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save Reading
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openVitalsForm}
            className="w-full flex items-center gap-1.5 rounded-md border border-dashed border-blue-300 bg-blue-50 px-2.5 py-2.5 text-left hover:bg-blue-100"
          >
            <HeartPulse className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-xs font-semibold text-blue-700">Tap to record vital signs</span>
          </button>
        )}
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
                  ['RESP', latestReading.respiratoryRate != null ? `${latestReading.respiratoryRate}/min` : '—'],
                  ['BP', latestReading.bloodPressure || '—'],
                  ['O2 SAT', latestReading.oxygenSaturation != null ? `${latestReading.oxygenSaturation}%` : '—'],
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
              {newestFirstReadings.map((r) => {
                const isExpanded = expandedHistoryId === r.id;
                return (
                  <div key={r.id} className="rounded border border-border bg-white p-2">
                    <button
                      type="button"
                      className="w-full flex items-center gap-1.5 text-left"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : r.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800">
                          {formatDate(r.recordedAt)} · {formatTime(r.recordedAt)}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          #{r.id}
                          {r.recordedByName ? ` · by ${r.recordedByName}` : ''}
                        </p>
                      </div>
                      {badge('done', 'Recorded ✓')}
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                      )}
                    </button>
                    {isExpanded ? (
                      <p className="mt-1.5 text-[11px] leading-4 text-gray-700">
                        Temp {r.temperature != null ? `${r.temperature}°C` : '—'} · Pulse{' '}
                        {r.heartRate != null ? `${r.heartRate}bpm` : '—'} · Resp{' '}
                        {r.respiratoryRate != null ? `${r.respiratoryRate}/min` : '—'} · BP{' '}
                        {r.bloodPressure || '—'} · O2{' '}
                        {r.oxygenSaturation != null ? `${r.oxygenSaturation}%` : '—'}
                        {r.oxygenUse != null ? ` · O2 Use ${r.oxygenUse ? 'Yes' : 'No'}` : ''}
                        {r.painScale != null ? ` · Pain ${r.painScale}/10` : ''}
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
