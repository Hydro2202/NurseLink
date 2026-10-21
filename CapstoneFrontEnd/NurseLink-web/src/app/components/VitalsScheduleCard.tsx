import React, { useEffect, useState } from 'react';
import { HeartPulse, Loader2, Square } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { fetchVitalsSchedule, saveVitalsSchedule, stopVitalsSchedule, ApiError } from '../api/nurselink';
import { toast } from 'sonner';
import type { VitalsScheduleResponse } from '../types/domain';

interface Props {
  /** The Patient's patient_code — see api/models.py's VitalSignsSchedule. */
  patientId: string;
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * The patient's "Vital Signs Monitoring (as ordered)" — Edit Patient
 * Information's simple dropdown sets the common case (see EditPatientModal),
 * this card is the richer editor: a start time and the order/protocol it
 * follows, plus the schedule's own history. Both write through the same
 * VitalSignsSchedule rows, so whichever screen changed it last is always
 * what the other one shows.
 */
export function VitalsScheduleCard({ patientId }: Props) {
  const [data, setData] = useState<VitalsScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'scheduled' | 'prn'>('scheduled');
  const [frequencyHours, setFrequencyHours] = useState<'1' | '2' | '4'>('2');
  const [basis, setBasis] = useState('');

  const load = () => {
    setLoading(true);
    fetchVitalsSchedule(patientId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await saveVitalsSchedule(patientId, {
        mode,
        frequencyHours: mode === 'scheduled' ? Number(frequencyHours) : undefined,
        basis: basis.trim() || undefined,
      });
      setData(updated);
      setBasis('');
      toast.success('Vital signs monitoring order saved');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to save the monitoring order');
    } finally {
      setSaving(false);
    }
  };

  const handleStop = async () => {
    setSaving(true);
    try {
      const updated = await stopVitalsSchedule(patientId);
      setData(updated);
      toast.success('Vital signs monitoring stopped');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to stop monitoring');
    } finally {
      setSaving(false);
    }
  };

  const active = data?.active ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-red-600" />
          Vital Signs Monitoring (as ordered)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading monitoring order...
          </div>
        ) : active ? (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="success">{active.frequencyLabel}</Badge>
              {active.basis ? <span className="text-xs text-gray-600">{active.basis}</span> : null}
            </div>
            {active.mode === 'scheduled' ? (
              <p className="text-xs text-gray-600">
                Next check: {fmtDateTime(active.nextCheckAt)}
                {active.overdueChecks > 0 ? (
                  <span className="text-red-600 font-semibold"> · {active.overdueChecks} overdue</span>
                ) : null}
              </p>
            ) : null}
            <p className="text-xs text-gray-500">Set by {active.setBy || 'a nurse'} · {fmtDateTime(active.setAt)}</p>
            <Button type="button" size="sm" variant="outline" onClick={handleStop} disabled={saving}>
              <Square className="w-3.5 h-3.5 mr-1.5" />
              Stop monitoring
            </Button>
          </div>
        ) : (
          <p className="text-sm italic text-gray-500">Not specified — no monitoring order on record.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'scheduled' | 'prn')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="prn">As needed (PRN)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === 'scheduled' ? (
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={frequencyHours} onValueChange={(v) => setFrequencyHours(v as '1' | '2' | '4')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every 1 hour</SelectItem>
                  <SelectItem value="2">Every 2 hours</SelectItem>
                  <SelectItem value="4">Every 4 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label>Order / protocol</Label>
            <Input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="e.g. Dr. Reyes order" />
          </div>
        </div>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
          Save monitoring order
        </Button>
      </CardContent>
    </Card>
  );
}
