import React, { useEffect, useState } from 'react';
import { FlaskConical, Pill, Plus, History as HistoryIcon, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  fetchLaboratories,
  createLaboratory,
  updateLaboratory,
  deleteLaboratory,
  fetchMedications,
  createMedication,
  updateMedication,
  deleteMedication,
  recordMedicationIntake,
  fetchPatient,
  fetchDoctors,
  fetchPatientAssignedDoctors,
  ApiError,
} from '../api/nurselink';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import type { LabEntry, MedicationOrder, MedicationIntakeEntry, Doctor } from '../types/domain';

interface Props {
  /** The Patient's patient_code — labs/medications are linked to the
   * patient, not to a single append-only Kardex snapshot (see
   * api/models.py's KardexLaboratory/KardexMedication docstrings). */
  patientId: string;
}

const LAB_STATUS_BADGE: Record<LabEntry['status'], { label: string; variant: 'warning' | 'success' | 'secondary' }> = {
  pending: { label: 'Pending', variant: 'warning' },
  done: { label: 'Done', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

const INTAKE_STATUS_BADGE: Record<
  MedicationIntakeEntry['status'],
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  given: { label: 'Given', variant: 'success' },
  held: { label: 'Held', variant: 'warning' },
  refused: { label: 'Refused', variant: 'destructive' },
  missed: { label: 'Missed', variant: 'secondary' },
};

const ROUTE_OPTIONS = ['Oral', 'IV', 'IM', 'SubQ', 'Topical', 'Inhalation', 'Other'];

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString() : '—';
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** datetime-local's value format needs seconds stripped and no timezone. */
function toDateTimeLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function KardexLabsAndMedications({ patientId }: Props) {
  const { user } = useAuth();
  const isHeadNurse = user?.role === 'head_nurse';

  const [labs, setLabs] = useState<LabEntry[]>([]);
  const [meds, setMeds] = useState<MedicationOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showDiscontinued, setShowDiscontinued] = useState(false);

  const reload = () => {
    Promise.all([fetchLaboratories(patientId), fetchMedications(patientId)])
      .then(([labsData, medsData]) => {
        setLabs(labsData);
        setMeds(medsData);
      })
      .catch((err) => {
        toast.error('Failed to load labs/medications', {
          description: err instanceof ApiError ? err.message : undefined,
        });
      })
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const [labModalOpen, setLabModalOpen] = useState(false);
  const [editingLab, setEditingLab] = useState<LabEntry | null>(null);
  const [deletingLab, setDeletingLab] = useState<LabEntry | null>(null);

  const [medModalOpen, setMedModalOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<MedicationOrder | null>(null);
  const [deletingMed, setDeletingMed] = useState<MedicationOrder | null>(null);

  const [intakeMedication, setIntakeMedication] = useState<MedicationOrder | null>(null);
  const [historyMedication, setHistoryMedication] = useState<MedicationOrder | null>(null);

  const sortedLabs = [...labs].sort((a, b) => {
    const order = { pending: 0, done: 1, cancelled: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.dateOrdered.localeCompare(a.dateOrdered);
  });
  const activeMeds = meds.filter((m) => m.isActive);
  const discontinuedMeds = meds.filter((m) => !m.isActive);

  const handleDiscontinueMed = async (med: MedicationOrder) => {
    try {
      await updateMedication(med.id, { isActive: false });
      toast.success('Medication discontinued');
      reload();
    } catch (err) {
      toast.error('Failed to discontinue medication', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    }
  };

  const handleCancelLab = async (lab: LabEntry) => {
    try {
      await updateLaboratory(lab.id, { status: 'cancelled' });
      toast.success('Lab cancelled');
      reload();
    } catch (err) {
      toast.error('Failed to cancel lab', { description: err instanceof ApiError ? err.message : undefined });
    }
  };

  const handleConfirmDeleteLab = async () => {
    if (!deletingLab) return;
    try {
      await deleteLaboratory(deletingLab.id);
      toast.success('Lab entry deleted');
      setDeletingLab(null);
      reload();
    } catch (err) {
      toast.error('Failed to delete lab', { description: err instanceof ApiError ? err.message : undefined });
    }
  };

  const handleConfirmDeleteMed = async () => {
    if (!deletingMed) return;
    try {
      await deleteMedication(deletingMed.id);
      toast.success('Medication order deleted');
      setDeletingMed(null);
      reload();
    } catch (err) {
      toast.error('Failed to delete medication', { description: err instanceof ApiError ? err.message : undefined });
    }
  };

  const renderMedRow = (med: MedicationOrder, active: boolean) => (
    <TableRow key={med.id}>
      <TableCell className="whitespace-normal">
        <div className="font-medium">{med.medicationName}</div>
        {med.isOverdue && <Badge variant="destructive" className="mt-1">Overdue</Badge>}
      </TableCell>
      <TableCell>{med.dose || '—'}</TableCell>
      <TableCell>{med.route}</TableCell>
      <TableCell>{med.frequency || '—'}</TableCell>
      <TableCell>
        {fmtDate(med.startDate)} – {med.endDate ? fmtDate(med.endDate) : 'ongoing'}
      </TableCell>
      <TableCell>
        <Badge variant={active ? 'success' : 'secondary'}>{active ? 'Active' : 'Discontinued'}</Badge>
      </TableCell>
      <TableCell>{fmtDateTime(med.lastGiven)}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          {active && (
            <button className="text-xs font-semibold text-primary hover:underline text-left" onClick={() => setIntakeMedication(med)}>
              Record Intake
            </button>
          )}
          <button className="text-xs font-semibold text-primary hover:underline text-left" onClick={() => setHistoryMedication(med)}>
            History ({med.intakes.length})
          </button>
          <button
            className="text-xs font-semibold text-primary hover:underline text-left"
            onClick={() => {
              setEditingMed(med);
              setMedModalOpen(true);
            }}
          >
            Edit
          </button>
          {active && (
            <button className="text-xs font-semibold text-amber-600 hover:underline text-left" onClick={() => handleDiscontinueMed(med)}>
              Discontinue
            </button>
          )}
          {isHeadNurse && (
            <button className="text-xs font-semibold text-red-600 hover:underline text-left" onClick={() => setDeletingMed(med)}>
              Delete
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      {/* Laboratories */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-blue-600" />
              <CardTitle>Laboratories</CardTitle>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setEditingLab(null);
                setLabModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Add Lab
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <p className="text-sm text-muted-foreground py-2">Loading...</p>
          ) : sortedLabs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No labs ordered yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Date Ordered</TableHead>
                  <TableHead>Date Done</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLabs.map((lab) => (
                  <TableRow key={lab.id}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{lab.testName}</div>
                      {lab.isOverdue && <Badge variant="destructive" className="mt-1">Overdue</Badge>}
                    </TableCell>
                    <TableCell>{fmtDate(lab.dateOrdered)}</TableCell>
                    <TableCell>{fmtDate(lab.dateDone)}</TableCell>
                    <TableCell>
                      <Badge variant={LAB_STATUS_BADGE[lab.status].variant}>{LAB_STATUS_BADGE[lab.status].label}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal max-w-[200px]">{lab.result || '—'}</TableCell>
                    <TableCell className="whitespace-normal max-w-[160px]">{lab.remarks || '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <button
                          className="text-xs font-semibold text-primary hover:underline text-left"
                          onClick={() => {
                            setEditingLab(lab);
                            setLabModalOpen(true);
                          }}
                        >
                          Edit
                        </button>
                        {lab.status === 'pending' && (
                          <button className="text-xs font-semibold text-amber-600 hover:underline text-left" onClick={() => handleCancelLab(lab)}>
                            Cancel
                          </button>
                        )}
                        {isHeadNurse && (
                          <button className="text-xs font-semibold text-red-600 hover:underline text-left" onClick={() => setDeletingLab(lab)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Medication Intake */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Pill className="w-5 h-5 text-purple-600" />
              <CardTitle>Medication Intake</CardTitle>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setEditingMed(null);
                setMedModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Add Medication
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <p className="text-sm text-muted-foreground py-2">Loading...</p>
          ) : activeMeds.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No active medications.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medication</TableHead>
                  <TableHead>Dose</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Start–End Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Given</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{activeMeds.map((med) => renderMedRow(med, true))}</TableBody>
            </Table>
          )}

          {discontinuedMeds.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <button
                className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"
                onClick={() => setShowDiscontinued((s) => !s)}
              >
                {showDiscontinued ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Discontinued Medications ({discontinuedMeds.length})
              </button>
              {showDiscontinued && (
                <div className="mt-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Medication</TableHead>
                        <TableHead>Dose</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead>Start–End Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Given</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{discontinuedMeds.map((med) => renderMedRow(med, false))}</TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <LabFormModal open={labModalOpen} onOpenChange={setLabModalOpen} patientId={patientId} lab={editingLab} onSaved={reload} />
      <MedicationFormModal
        open={medModalOpen}
        onOpenChange={setMedModalOpen}
        patientId={patientId}
        medication={editingMed}
        onSaved={reload}
      />
      <RecordIntakeModal medication={intakeMedication} onClose={() => setIntakeMedication(null)} onSaved={reload} />
      <IntakeHistoryModal medication={historyMedication} onClose={() => setHistoryMedication(null)} />

      <Dialog open={!!deletingLab} onOpenChange={(open) => !open && setDeletingLab(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete lab entry?</DialogTitle>
            <DialogDescription>
              This permanently removes "{deletingLab?.testName}" from this patient's Laboratories. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingLab(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteLab}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingMed} onOpenChange={(open) => !open && setDeletingMed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete medication order?</DialogTitle>
            <DialogDescription>
              This permanently removes "{deletingMed?.medicationName}" and its intake history from this patient. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingMed(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteMed}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface LabFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  lab: LabEntry | null;
  onSaved: () => void;
}

function LabFormModal({ open, onOpenChange, patientId, lab, onSaved }: LabFormModalProps) {
  const [testName, setTestName] = useState('');
  const [dateOrdered, setDateOrdered] = useState(todayIso());
  const [dateDone, setDateDone] = useState('');
  const [status, setStatus] = useState<LabEntry['status']>('pending');
  const [result, setResult] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (lab) {
      setTestName(lab.testName);
      setDateOrdered(lab.dateOrdered);
      setDateDone(lab.dateDone || '');
      setStatus(lab.status);
      setResult(lab.result);
      setRemarks(lab.remarks);
    } else {
      setTestName('');
      setDateOrdered(todayIso());
      setDateDone('');
      setStatus('pending');
      setResult('');
      setRemarks('');
    }
    setError('');
  }, [open, lab]);

  const dateError = dateDone && dateOrdered && dateDone < dateOrdered ? 'Date done cannot be before date ordered.' : '';
  const resultError = status === 'done' && !result.trim() ? 'Result is required when status is Done.' : '';

  const handleSave = async () => {
    if (!testName.trim() || !dateOrdered) {
      setError('Test name and date ordered are required.');
      return;
    }
    if (dateError || resultError) {
      setError(dateError || resultError);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = { testName: testName.trim(), dateOrdered, dateDone: dateDone || null, status, result, remarks };
      if (lab) {
        await updateLaboratory(lab.id, payload);
      } else {
        await createLaboratory({ ...payload, patientId });
      }
      toast.success(lab ? 'Lab entry updated' : 'Lab entry added');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save lab entry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lab ? 'Edit Lab Entry' : 'Add Lab'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="labTestName">Test Name *</Label>
            <Input id="labTestName" value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="e.g. CBC, Urinalysis, FBS, Chest X-ray" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="labDateOrdered">Date Ordered *</Label>
              <Input id="labDateOrdered" type="date" value={dateOrdered} onChange={(e) => setDateOrdered(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labDateDone">Date Done</Label>
              <Input id="labDateDone" type="date" value={dateDone} onChange={(e) => setDateDone(e.target.value)} aria-invalid={!!dateError} />
              {dateError && <p className="text-sm text-red-600">{dateError}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as LabEntry['status'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="labResult">Result</Label>
            <Textarea id="labResult" value={result} onChange={(e) => setResult(e.target.value)} rows={3} placeholder={status === 'done' ? 'Required when Done' : 'Optional'} />
            {resultError && <p className="text-sm text-red-600">{resultError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="labRemarks">Remarks</Label>
            <Textarea id="labRemarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface MedicationFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  medication: MedicationOrder | null;
  onSaved: () => void;
}

// "08:00" / "16:00" / "00:00" — 24h HH:MM, the same comma-separated list
// the backend's KardexMedicationSerializer.validate_scheduledTimes expects.
const SCHEDULED_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function MedicationFormModal({ open, onOpenChange, patientId, medication, onSaved }: MedicationFormModalProps) {
  const [medicationName, setMedicationName] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('Oral');
  const [frequency, setFrequency] = useState('');
  const [scheduledTimes, setScheduledTimes] = useState('');
  // A fresh pick from the time input — not yet added to scheduledTimes as a chip.
  const [timeDraft, setTimeDraft] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [prescribedBy, setPrescribedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Doctors to prescribe from — the patient's attending physician and
  // Kardex care team first, then every other active doctor. Prescribed By
  // still just stores the chosen name (no schema change), so this is a
  // richer picker over the same free-text field, not a new relationship.
  const [doctorOptions, setDoctorOptions] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    if (medication) {
      setMedicationName(medication.medicationName);
      setDose(medication.dose);
      setRoute(medication.route);
      setFrequency(medication.frequency);
      setScheduledTimes(medication.scheduledTimes || '');
      setStartDate(medication.startDate);
      setEndDate(medication.endDate || '');
      setPrescribedBy(medication.prescribedBy || '');
      setRemarks(medication.remarks);
    } else {
      setMedicationName('');
      setDose('');
      setRoute('Oral');
      setFrequency('');
      setScheduledTimes('');
      setStartDate(todayIso());
      setEndDate('');
      setPrescribedBy('');
      setRemarks('');
    }
    setTimeDraft('');
    setError('');
  }, [open, medication]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [patient, allDoctors, careTeam] = await Promise.all([
          fetchPatient(patientId).catch(() => null),
          fetchDoctors().catch(() => []),
          fetchPatientAssignedDoctors(patientId).catch(() => []),
        ]);
        if (cancelled) return;
        const attending = (patient?.attendingPhysician || '').trim();
        const attendingDoctor = attending ? allDoctors.find((d) => d.fullName === attending) : undefined;
        const careTeamIds = new Set(careTeam.map((d) => d.id));
        const ordered: Doctor[] = [];
        if (attendingDoctor) ordered.push(attendingDoctor);
        careTeam.forEach((d) => {
          if (d.id !== attendingDoctor?.id) ordered.push(d);
        });
        allDoctors.forEach((d) => {
          if (d.id === attendingDoctor?.id || careTeamIds.has(d.id)) return;
          ordered.push(d);
        });
        setDoctorOptions(
          ordered.map((d) => ({
            label: d.specialization ? `${d.fullName} • ${d.specialization}` : d.fullName,
            value: d.fullName,
          }))
        );
        // Add mode only, and only if the nurse hasn't already picked
        // something while this was loading.
        if (!medication && attending) {
          setPrescribedBy((prev) => prev || attending);
        }
      } catch {
        if (!cancelled) setDoctorOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  // The current value might be a legacy/unmatched name — shown as its own
  // option rather than leaving the trigger blank and silently losing it.
  const prescribedByOptions =
    prescribedBy && !doctorOptions.some((o) => o.value === prescribedBy)
      ? [{ label: prescribedBy, value: prescribedBy }, ...doctorOptions]
      : doctorOptions;

  const scheduledTimesList = scheduledTimes
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const scheduledTimesValid =
    scheduledTimesList.length > 0 && scheduledTimesList.every((t) => SCHEDULED_TIME_PATTERN.test(t));
  // Old free-text that doesn't parse as picked times — shown so the nurse
  // can see what's there, but not rendered as chips (it isn't one).
  const legacyScheduledText = scheduledTimesList.length > 0 && !scheduledTimesValid ? scheduledTimes : '';

  const addScheduledTime = () => {
    if (!timeDraft) return;
    const base = scheduledTimesValid ? scheduledTimesList : [];
    if (base.includes(timeDraft)) {
      setTimeDraft('');
      return;
    }
    setScheduledTimes([...base, timeDraft].sort().join(', '));
    setTimeDraft('');
  };

  const removeScheduledTime = (time: string) => {
    setScheduledTimes(scheduledTimesList.filter((t) => t !== time).join(', '));
  };

  const dateError = endDate && startDate && endDate < startDate ? 'End date cannot be before start date.' : '';

  const handleSave = async () => {
    if (!medicationName.trim() || !startDate) {
      setError('Medication name and start date are required.');
      return;
    }
    if (dateError) {
      setError(dateError);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        medicationName: medicationName.trim(),
        dose,
        route: route as MedicationOrder['route'],
        frequency,
        scheduledTimes,
        startDate,
        endDate: endDate || null,
        prescribedBy,
        remarks,
      };
      if (medication) {
        await updateMedication(medication.id, payload);
      } else {
        await createMedication({ ...payload, patientId });
      }
      toast.success(medication ? 'Medication updated' : 'Medication added');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save medication.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{medication ? 'Edit Medication' : 'Add Medication'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="medName">Medication Name *</Label>
            <Input id="medName" value={medicationName} onChange={(e) => setMedicationName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="medDose">Dose</Label>
              <Input id="medDose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 500 mg" />
            </div>
            <div className="space-y-2">
              <Label>Route</Label>
              <Select value={route} onValueChange={setRoute}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="medFrequency">Frequency</Label>
            <Input id="medFrequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. q8h, BID, OD, PRN" />
          </div>
          <div className="space-y-2">
            <Label>Scheduled Times</Label>
            {legacyScheduledText ? (
              <p className="text-xs italic text-muted-foreground">
                Existing value: &quot;{legacyScheduledText}&quot; — pick a time below to replace it.
              </p>
            ) : scheduledTimesList.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {scheduledTimesList.map((time) => (
                  <span
                    key={time}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium"
                  >
                    {time}
                    <button type="button" onClick={() => removeScheduledTime(time)} className="hover:text-blue-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Input type="time" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} className="flex-1" />
              <Button type="button" variant="outline" onClick={addScheduledTime} disabled={!timeDraft}>
                Add Time
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="medStart">Start Date *</Label>
              <Input id="medStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="medEnd">End Date</Label>
              <Input id="medEnd" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-invalid={!!dateError} />
              {dateError && <p className="text-sm text-red-600">{dateError}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Prescribed By</Label>
            <Select value={prescribedBy} onValueChange={setPrescribedBy}>
              <SelectTrigger>
                <SelectValue placeholder="Defaults to the attending physician" />
              </SelectTrigger>
              <SelectContent>
                {prescribedByOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="medRemarks">Remarks</Label>
            <Textarea id="medRemarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface RecordIntakeModalProps {
  medication: MedicationOrder | null;
  onClose: () => void;
  onSaved: () => void;
}

function RecordIntakeModal({ medication, onClose, onSaved }: RecordIntakeModalProps) {
  const [scheduledTime, setScheduledTime] = useState('');
  const [administeredAt, setAdministeredAt] = useState('');
  const [status, setStatus] = useState<MedicationIntakeEntry['status']>('given');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!medication) return;
    const now = toDateTimeLocal(new Date().toISOString());
    setScheduledTime(now);
    setAdministeredAt(now);
    setStatus('given');
    setReason('');
    setError('');
  }, [medication]);

  if (!medication) return null;

  const reasonRequired = status !== 'given';
  const reasonError = reasonRequired && !reason.trim() ? 'Reason is required when status is not Given.' : '';
  const administeredIso = administeredAt ? new Date(administeredAt).toISOString() : '';
  const futureError = administeredIso && new Date(administeredIso) > new Date() ? 'Administered time cannot be in the future.' : '';

  const handleSave = async () => {
    if (!scheduledTime) {
      setError('Scheduled time is required.');
      return;
    }
    if (reasonError || futureError) {
      setError(reasonError || futureError);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await recordMedicationIntake({
        medicationId: medication.id,
        scheduledTime: new Date(scheduledTime).toISOString(),
        administeredAt: administeredIso || null,
        status,
        reason,
      });
      toast.success('Intake recorded');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record intake.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!medication} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Intake — {medication.medicationName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="intakeScheduled">Scheduled Time</Label>
            <Input id="intakeScheduled" type="datetime-local" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="intakeGiven">Actual Time Given</Label>
            <Input id="intakeGiven" type="datetime-local" value={administeredAt} onChange={(e) => setAdministeredAt(e.target.value)} aria-invalid={!!futureError} />
            {futureError && <p className="text-sm text-red-600">{futureError}</p>}
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as MedicationIntakeEntry['status'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="given">Given</SelectItem>
                <SelectItem value="held">Held</SelectItem>
                <SelectItem value="refused">Refused</SelectItem>
                <SelectItem value="missed">Missed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {reasonRequired && (
            <div className="space-y-2">
              <Label htmlFor="intakeReason">Reason *</Label>
              <Textarea
                id="intakeReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why wasn't this dose given as scheduled?"
                aria-invalid={!!reasonError}
              />
              {reasonError && <p className="text-sm text-red-600">{reasonError}</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving...' : 'Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface IntakeHistoryModalProps {
  medication: MedicationOrder | null;
  onClose: () => void;
}

function IntakeHistoryModal({ medication, onClose }: IntakeHistoryModalProps) {
  if (!medication) return null;
  return (
    <Dialog open={!!medication} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="w-4 h-4 text-purple-600" />
            Intake History — {medication.medicationName}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[420px] overflow-y-auto space-y-3">
          {medication.intakes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No intakes recorded yet.</p>
          ) : (
            medication.intakes.map((intake) => (
              <div key={intake.id} className="flex items-start justify-between gap-2 pb-3 border-b last:border-0">
                <div className="flex-1">
                  <p className="text-sm font-semibold">
                    {intake.administeredAt ? fmtDateTime(intake.administeredAt) : `Scheduled ${fmtDateTime(intake.scheduledTime)}`}
                  </p>
                  {intake.reason && <p className="text-sm text-muted-foreground mt-0.5">{intake.reason}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {intake.administeredByName
                      ? `${intake.administeredByName}${intake.administeredByRole ? ` (${intake.administeredByRole})` : ''}`
                      : 'Unknown'}
                  </p>
                </div>
                <Badge variant={INTAKE_STATUS_BADGE[intake.status].variant}>{INTAKE_STATUS_BADGE[intake.status].label}</Badge>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
