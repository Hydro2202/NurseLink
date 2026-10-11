import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal as RNModal } from 'react-native';
import { FlaskConical, Pill, Plus, X, History as HistoryIcon, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Card, CardContent, CardHeader, CardTitle } from './Card';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { DatePicker, formatDisplayDate, todayIso } from './DatePicker';
import { TimePicker } from './TimePicker';
import { Badge } from './Badge';
import { ConfirmDialog } from './ConfirmDialog';
import { Shadows, Colors, Radius } from '../constants/colors';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
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
  ApiError,
} from '../services/api';
import type { LabEntry, MedicationOrder, MedicationIntakeEntry } from '../types/domain';

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

const ROUTE_OPTIONS = ['Oral', 'IV', 'IM', 'SubQ', 'Topical', 'Inhalation', 'Other'].map((r) => ({
  label: r,
  value: r,
}));

function fmtDate(iso?: string | null): string {
  return iso ? formatDisplayDate(iso) : '—';
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Combines a DatePicker (ISO date) + TimePicker (24h HH:MM) pair into one
 * ISO datetime string, and splits one back apart — there's no native
 * datetime-local equivalent in this app, so a date+time field is always
 * built from these two existing pickers (see e.g. DutyAssignmentModal). */
function toIsoDateTime(dateIso: string, time24: string): string {
  if (!dateIso) return '';
  const [h, m] = (time24 || '00:00').split(':').map((n) => parseInt(n, 10) || 0);
  const d = new Date(dateIso + 'T00:00:00');
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function splitIsoDateTime(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${mo}-${da}`, time: `${h}:${mi}` };
}

function nowSplit(): { date: string; time: string } {
  return splitIsoDateTime(new Date().toISOString());
}

export function KardexLabsAndMedications({ patientId }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const isHeadNurse = user?.role === 'head_nurse';

  const [labs, setLabs] = useState<LabEntry[]>([]);
  const [meds, setMeds] = useState<MedicationOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showDiscontinued, setShowDiscontinued] = useState(false);

  const reload = useCallback(() => {
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
  }, [patientId, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

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
    <View key={med.id} style={styles.rowCard}>
      <View style={styles.rowCardHeader}>
        <View style={{ flex: 1, flexShrink: 1 }}>
          <Text style={styles.rowCardTitle}>{med.medicationName}</Text>
          {med.isOverdue ? <Badge variant="destructive" style={styles.overdueBadge}>Overdue</Badge> : null}
        </View>
        <Badge variant={active ? 'success' : 'secondary'}>{active ? 'Active' : 'Discontinued'}</Badge>
      </View>
      <View style={styles.fieldGrid}>
        <View style={styles.fieldItem}>
          <Text style={styles.fieldLabel}>Dose</Text>
          <Text style={styles.fieldValue}>{med.dose || '—'}</Text>
        </View>
        <View style={styles.fieldItem}>
          <Text style={styles.fieldLabel}>Route</Text>
          <Text style={styles.fieldValue}>{med.route}</Text>
        </View>
        <View style={styles.fieldItem}>
          <Text style={styles.fieldLabel}>Frequency</Text>
          <Text style={styles.fieldValue}>{med.frequency || '—'}</Text>
        </View>
        <View style={styles.fieldItem}>
          <Text style={styles.fieldLabel}>Last Given</Text>
          <Text style={styles.fieldValue}>{fmtDateTime(med.lastGiven)}</Text>
        </View>
      </View>
      <View style={styles.fieldItemFull}>
        <Text style={styles.fieldLabel}>Start–End Date</Text>
        <Text style={styles.fieldValue}>
          {fmtDate(med.startDate)} – {med.endDate ? fmtDate(med.endDate) : 'ongoing'}
        </Text>
      </View>
      <View style={styles.rowCardActions}>
        {active ? (
          <View style={styles.actionItem}>
            <Pressable onPress={() => setIntakeMedication(med)}>
              <Text style={styles.linkText}>Record Intake</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.actionItem}>
          <Pressable onPress={() => setHistoryMedication(med)}>
            <Text style={styles.linkText}>History ({med.intakes.length})</Text>
          </Pressable>
        </View>
        <View style={styles.actionItem}>
          <Pressable onPress={() => { setEditingMed(med); setMedModalOpen(true); }}>
            <Text style={styles.linkText}>Edit</Text>
          </Pressable>
        </View>
        {active ? (
          <View style={styles.actionItem}>
            <Pressable onPress={() => handleDiscontinueMed(med)}>
              <Text style={[styles.linkText, { color: Colors.orange600 }]}>Discontinue</Text>
            </Pressable>
          </View>
        ) : null}
        {isHeadNurse ? (
          <View style={styles.actionItem}>
            <Pressable onPress={() => setDeletingMed(med)}>
              <Text style={[styles.linkText, { color: Colors.red600 }]}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      {/* Laboratories */}
      <Card>
        <CardHeader>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <FlaskConical size={20} color={Colors.blue600} />
              <CardTitle>Laboratories</CardTitle>
            </View>
            <Button
              size="sm"
              onPress={() => {
                setEditingLab(null);
                setLabModalOpen(true);
              }}
            >
              <View style={styles.btnInner}>
                <Plus size={14} color={Colors.white} />
                <Text style={styles.btnTextWhite}>Add Lab</Text>
              </View>
            </Button>
          </View>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <Text style={styles.emptyText}>Loading...</Text>
          ) : sortedLabs.length === 0 ? (
            <Text style={styles.emptyText}>No labs ordered yet.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {sortedLabs.map((lab) => (
                <View key={lab.id} style={styles.rowCard}>
                  <View style={styles.rowCardHeader}>
                    <View style={{ flex: 1, flexShrink: 1 }}>
                      <Text style={styles.rowCardTitle}>{lab.testName}</Text>
                      {lab.isOverdue ? <Badge variant="destructive" style={styles.overdueBadge}>Overdue</Badge> : null}
                    </View>
                    <Badge variant={LAB_STATUS_BADGE[lab.status].variant}>{LAB_STATUS_BADGE[lab.status].label}</Badge>
                  </View>
                  <View style={styles.fieldGrid}>
                    <View style={styles.fieldItem}>
                      <Text style={styles.fieldLabel}>Date Ordered</Text>
                      <Text style={styles.fieldValue}>{fmtDate(lab.dateOrdered)}</Text>
                    </View>
                    <View style={styles.fieldItem}>
                      <Text style={styles.fieldLabel}>Date Done</Text>
                      <Text style={styles.fieldValue}>{fmtDate(lab.dateDone)}</Text>
                    </View>
                  </View>
                  <View style={styles.fieldItemFull}>
                    <Text style={styles.fieldLabel}>Result</Text>
                    <Text style={styles.fieldValue}>{lab.result || '—'}</Text>
                  </View>
                  <View style={styles.fieldItemFull}>
                    <Text style={styles.fieldLabel}>Remarks</Text>
                    <Text style={styles.fieldValue}>{lab.remarks || '—'}</Text>
                  </View>
                  <View style={styles.rowCardActions}>
                    <View style={styles.actionItem}>
                      <Pressable onPress={() => { setEditingLab(lab); setLabModalOpen(true); }}>
                        <Text style={styles.linkText}>Edit</Text>
                      </Pressable>
                    </View>
                    {lab.status === 'pending' ? (
                      <View style={styles.actionItem}>
                        <Pressable onPress={() => handleCancelLab(lab)}>
                          <Text style={[styles.linkText, { color: Colors.orange600 }]}>Cancel</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {isHeadNurse ? (
                      <View style={styles.actionItem}>
                        <Pressable onPress={() => setDeletingLab(lab)}>
                          <Text style={[styles.linkText, { color: Colors.red600 }]}>Delete</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </CardContent>
      </Card>

      {/* Medication Intake */}
      <Card>
        <CardHeader>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Pill size={20} color={Colors.purple600} />
              <CardTitle>Medication Intake</CardTitle>
            </View>
            <Button
              size="sm"
              onPress={() => {
                setEditingMed(null);
                setMedModalOpen(true);
              }}
            >
              <View style={styles.btnInner}>
                <Plus size={14} color={Colors.white} />
                <Text style={styles.btnTextWhite}>Add Medication</Text>
              </View>
            </Button>
          </View>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <Text style={styles.emptyText}>Loading...</Text>
          ) : activeMeds.length === 0 ? (
            <Text style={styles.emptyText}>No active medications.</Text>
          ) : (
            <View style={{ gap: 10 }}>{activeMeds.map((med) => renderMedRow(med, true))}</View>
          )}

          {discontinuedMeds.length > 0 ? (
            <View style={styles.discontinuedBlock}>
              <Pressable style={styles.collapseToggle} onPress={() => setShowDiscontinued((s) => !s)}>
                {showDiscontinued ? (
                  <ChevronUp size={16} color={Colors.mutedForeground} />
                ) : (
                  <ChevronDown size={16} color={Colors.mutedForeground} />
                )}
                <Text style={styles.collapseToggleText}>
                  Discontinued Medications ({discontinuedMeds.length})
                </Text>
              </Pressable>
              {showDiscontinued ? (
                <View style={{ gap: 10, marginTop: 8 }}>
                  {discontinuedMeds.map((med) => renderMedRow(med, false))}
                </View>
              ) : null}
            </View>
          ) : null}
        </CardContent>
      </Card>

      <LabFormModal
        open={labModalOpen}
        onOpenChange={setLabModalOpen}
        patientId={patientId}
        lab={editingLab}
        onSaved={reload}
      />
      <MedicationFormModal
        open={medModalOpen}
        onOpenChange={setMedModalOpen}
        patientId={patientId}
        medication={editingMed}
        onSaved={reload}
      />
      <RecordIntakeModal
        medication={intakeMedication}
        onClose={() => setIntakeMedication(null)}
        onSaved={reload}
      />
      <IntakeHistoryModal medication={historyMedication} onClose={() => setHistoryMedication(null)} />
      <ConfirmDialog
        open={!!deletingLab}
        onOpenChange={(open) => !open && setDeletingLab(null)}
        title="Delete lab entry?"
        description={`This permanently removes "${deletingLab?.testName}" from this patient's Laboratories. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDeleteLab}
      />
      <ConfirmDialog
        open={!!deletingMed}
        onOpenChange={(open) => !open && setDeletingMed(null)}
        title="Delete medication order?"
        description={`This permanently removes "${deletingMed?.medicationName}" and its intake history from this patient. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDeleteMed}
      />
    </View>
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
  const toast = useToast();
  const [testName, setTestName] = useState('');
  const [dateOrdered, setDateOrdered] = useState(todayIso());
  const [dateDone, setDateDone] = useState('');
  const [status, setStatus] = useState<LabEntry['status']>('pending');
  const [result, setResult] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (() => {
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
    })();
  }, [open, lab]);

  const dateError =
    dateDone && dateOrdered && dateDone < dateOrdered ? 'Date done cannot be before date ordered.' : '';
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
      const payload = {
        testName: testName.trim(),
        dateOrdered,
        dateDone: dateDone || null,
        status,
        result,
        remarks,
      };
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
    <RNModal visible={open} transparent animationType="fade" onRequestClose={() => !submitting && onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.dialogTitle}>{lab ? 'Edit Lab Entry' : 'Add Lab'}</Text>
            <Pressable onPress={() => onOpenChange(false)}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
            <View style={{ gap: 12 }}>
              {error ? <Text style={styles.formError}>{error}</Text> : null}
              <Input
                label="Test Name *"
                value={testName}
                onChangeText={setTestName}
                placeholder="e.g. CBC, Urinalysis, FBS, Chest X-ray"
              />
              <View style={styles.rowWrap}>
                <DatePicker label="Date Ordered *" value={dateOrdered} onChange={setDateOrdered} style={styles.colHalf} />
                <DatePicker
                  label="Date Done"
                  value={dateDone}
                  onChange={setDateDone}
                  error={dateError || undefined}
                  style={styles.colHalf}
                />
              </View>
              <Select
                label="Status"
                value={status}
                onValueChange={(v) => setStatus(v as LabEntry['status'])}
                options={[
                  { label: 'Pending', value: 'pending' },
                  { label: 'Done', value: 'done' },
                  { label: 'Cancelled', value: 'cancelled' },
                ]}
              />
              <Input
                label="Result"
                value={result}
                onChangeText={setResult}
                multiline
                numberOfLines={3}
                style={styles.multiline}
                error={resultError || undefined}
                placeholder={status === 'done' ? 'Required when Done' : 'Optional'}
              />
              <Input label="Remarks" value={remarks} onChangeText={setRemarks} multiline numberOfLines={2} style={styles.multiline} />
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSave} disabled={submitting} loading={submitting} style={{ flex: 1 }}>
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
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

function MedicationFormModal({ open, onOpenChange, patientId, medication, onSaved }: MedicationFormModalProps) {
  const toast = useToast();
  const [medicationName, setMedicationName] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('Oral');
  const [frequency, setFrequency] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (() => {
      if (!open) return;
      if (medication) {
        setMedicationName(medication.medicationName);
        setDose(medication.dose);
        setRoute(medication.route);
        setFrequency(medication.frequency);
        setStartDate(medication.startDate);
        setEndDate(medication.endDate || '');
        setRemarks(medication.remarks);
      } else {
        setMedicationName('');
        setDose('');
        setRoute('Oral');
        setFrequency('');
        setStartDate(todayIso());
        setEndDate('');
        setRemarks('');
      }
      setError('');
    })();
  }, [open, medication]);

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
        startDate,
        endDate: endDate || null,
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
    <RNModal visible={open} transparent animationType="fade" onRequestClose={() => !submitting && onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.dialogTitle}>{medication ? 'Edit Medication' : 'Add Medication'}</Text>
            <Pressable onPress={() => onOpenChange(false)}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
            <View style={{ gap: 12 }}>
              {error ? <Text style={styles.formError}>{error}</Text> : null}
              <Input label="Medication Name *" value={medicationName} onChangeText={setMedicationName} />
              <View style={styles.rowWrap}>
                <Input
                  label="Dose"
                  value={dose}
                  onChangeText={setDose}
                  placeholder="e.g. 500 mg"
                  containerStyle={styles.colHalf}
                />
                <Select
                  label="Route"
                  value={route}
                  onValueChange={setRoute}
                  options={ROUTE_OPTIONS}
                  style={styles.colHalf}
                />
              </View>
              <Input
                label="Frequency"
                value={frequency}
                onChangeText={setFrequency}
                placeholder="e.g. q8h, BID, OD, PRN"
              />
              <View style={styles.rowWrap}>
                <DatePicker label="Start Date *" value={startDate} onChange={setStartDate} style={styles.colHalf} />
                <DatePicker
                  label="End Date"
                  value={endDate}
                  onChange={setEndDate}
                  error={dateError || undefined}
                  style={styles.colHalf}
                />
              </View>
              <Input label="Remarks" value={remarks} onChangeText={setRemarks} multiline numberOfLines={2} style={styles.multiline} />
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button variant="outline" onPress={() => onOpenChange(false)} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSave} disabled={submitting} loading={submitting} style={{ flex: 1 }}>
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

// ---------------------------------------------------------------------------

interface RecordIntakeModalProps {
  medication: MedicationOrder | null;
  onClose: () => void;
  onSaved: () => void;
}

function RecordIntakeModal({ medication, onClose, onSaved }: RecordIntakeModalProps) {
  const toast = useToast();
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [givenDate, setGivenDate] = useState('');
  const [givenTime, setGivenTime] = useState('');
  const [status, setStatus] = useState<MedicationIntakeEntry['status']>('given');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (() => {
      if (!medication) return;
      const now = nowSplit();
      setScheduledDate(now.date);
      setScheduledTime(now.time);
      setGivenDate(now.date);
      setGivenTime(now.time);
      setStatus('given');
      setReason('');
      setError('');
    })();
  }, [medication]);

  if (!medication) return null;

  const reasonRequired = status !== 'given';
  const reasonError = reasonRequired && !reason.trim() ? 'Reason is required when status is not Given.' : '';
  const administeredAtIso = givenDate ? toIsoDateTime(givenDate, givenTime) : '';
  const futureError = administeredAtIso && new Date(administeredAtIso) > new Date() ? 'Administered time cannot be in the future.' : '';

  const handleSave = async () => {
    if (!scheduledDate) {
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
        scheduledTime: toIsoDateTime(scheduledDate, scheduledTime),
        administeredAt: administeredAtIso || null,
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
    <RNModal visible={!!medication} transparent animationType="fade" onRequestClose={() => !submitting && onClose()}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onClose()}>
        <Pressable style={[styles.dialog, Shadows.xl, { maxWidth: 420 }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.dialogTitle}>Record Intake — {medication.medicationName}</Text>
            <Pressable onPress={onClose}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <View style={{ gap: 12 }}>
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <Text style={styles.fieldGroupLabel}>Scheduled Time</Text>
            <View style={styles.rowWrap}>
              <DatePicker value={scheduledDate} onChange={setScheduledDate} style={styles.colHalf} />
              <TimePicker value={scheduledTime} onChange={setScheduledTime} style={styles.colHalf} />
            </View>
            <Text style={styles.fieldGroupLabel}>Actual Time Given</Text>
            <View style={styles.rowWrap}>
              <DatePicker value={givenDate} onChange={setGivenDate} style={styles.colHalf} />
              <TimePicker value={givenTime} onChange={setGivenTime} style={styles.colHalf} />
            </View>
            {futureError ? <Text style={styles.fieldErrorText}>{futureError}</Text> : null}
            <Select
              label="Status"
              value={status}
              onValueChange={(v) => setStatus(v as MedicationIntakeEntry['status'])}
              options={[
                { label: 'Given', value: 'given' },
                { label: 'Held', value: 'held' },
                { label: 'Refused', value: 'refused' },
                { label: 'Missed', value: 'missed' },
              ]}
            />
            {reasonRequired ? (
              <Input
                label="Reason *"
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={2}
                style={styles.multiline}
                error={reasonError || undefined}
                placeholder="Why wasn't this dose given as scheduled?"
              />
            ) : null}
          </View>
          <View style={styles.footer}>
            <Button variant="outline" onPress={onClose} disabled={submitting} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button onPress={handleSave} disabled={submitting} loading={submitting} style={{ flex: 1 }}>
              {submitting ? 'Saving...' : 'Record'}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
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
    <RNModal visible={!!medication} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <HistoryIcon size={18} color={Colors.purple600} />
              <Text style={styles.dialogTitle}>Intake History — {medication.medicationName}</Text>
            </View>
            <Pressable onPress={onClose}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }}>
            {medication.intakes.length === 0 ? (
              <Text style={styles.emptyText}>No intakes recorded yet.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {medication.intakes.map((intake) => (
                  <View key={intake.id} style={styles.intakeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.intakeTime}>
                        {intake.administeredAt ? fmtDateTime(intake.administeredAt) : `Scheduled ${fmtDateTime(intake.scheduledTime)}`}
                      </Text>
                      {intake.reason ? <Text style={styles.intakeReason}>{intake.reason}</Text> : null}
                      <Text style={styles.intakeBy}>
                        {intake.administeredByName
                          ? `${intake.administeredByName}${intake.administeredByRole ? ` (${intake.administeredByRole})` : ''}`
                          : 'Unknown'}
                      </Text>
                    </View>
                    <Badge variant={INTAKE_STATUS_BADGE[intake.status].variant}>
                      {INTAKE_STATUS_BADGE[intake.status].label}
                    </Badge>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The title ("Medication Intake") and the "+ Add Medication" button
    // are both auto-width with no flex-shrink, so on a narrow phone (and
    // inside Card, which clips overflow) their combined width got cut off
    // instead of reflowing. Wrap lets the button drop to its own line.
    flexWrap: 'wrap',
    rowGap: 8,
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
  btnTextWhite: { color: Colors.white, fontWeight: '700', fontSize: 13, flexShrink: 1 },
  emptyText: { fontSize: 13, color: Colors.mutedForeground, paddingVertical: 8 },

  // Each lab/medication is a stacked card instead of a wide table row —
  // on a phone a table wider than the screen needs horizontal scrolling,
  // which turned out to be unreliable to trigger inside this modal's
  // nested scroll views on iOS (see commit history). Stacking every field
  // vertically means everything is visible with no swipe gesture needed.
  rowCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: 12,
    gap: 8,
  },
  rowCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  rowCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fieldItem: { minWidth: '40%', flexGrow: 1 },
  fieldItemFull: { width: '100%' },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldValue: { fontSize: 13, color: Colors.foreground, marginTop: 2 },
  rowCardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  // Content-sized Pressables (no explicit width) wrapping onto a second
  // line inside a flexWrap row is where this went wrong — fieldGrid above
  // wraps correctly because its items (fieldItem) have an explicit
  // minWidth for Yoga to wrap against; giving each action the same
  // treatment fixes it the same proven way instead of guessing again.
  actionItem: { minWidth: '28%' },

  linkText: { fontSize: 12, fontWeight: '700', color: Colors.blue600 },
  overdueBadge: { marginTop: 4 },

  discontinuedBlock: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  collapseToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  collapseToggleText: { fontSize: 13, fontWeight: '700', color: Colors.mutedForeground },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 20, width: '100%', maxWidth: 560, gap: 12 },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground, flexShrink: 1 },
  formError: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },
  fieldErrorText: { fontSize: 12, color: Colors.destructive },
  fieldGroupLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  rowWrap: { flexDirection: 'row', gap: 12 },
  colHalf: { flex: 1 },
  multiline: { height: 72, textAlignVertical: 'top', paddingTop: 8 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },

  intakeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  intakeTime: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  intakeReason: { fontSize: 12, color: Colors.mutedForeground, marginTop: 2 },
  intakeBy: { fontSize: 11, color: Colors.gray400, marginTop: 2 },
});
