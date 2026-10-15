import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal as RNModal } from 'react-native';
import {
  FlaskConical,
  Pill,
  Building2,
  Plus,
  X,
  History as HistoryIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
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
  fetchDepartmentVisits,
  createDepartmentVisit,
  updateDepartmentVisit,
  deleteDepartmentVisit,
  fetchDepartments,
  ApiError,
} from '../services/api';
import type { LabEntry, MedicationOrder, MedicationIntakeEntry, DepartmentVisit, Department } from '../types/domain';

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

const MED_STATUS_BADGE: Record<
  MedicationOrder['status'],
  { label: string; variant: 'success' | 'warning' | 'secondary' }
> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  ON_HOLD: { label: 'On Hold', variant: 'warning' },
  DISCONTINUED: { label: 'Discontinued', variant: 'secondary' },
};

const VISIT_PRIORITY_BADGE: Record<
  DepartmentVisit['priority'],
  { label: string; variant: 'destructive' | 'warning' | 'secondary' }
> = {
  STAT: { label: 'STAT', variant: 'destructive' },
  URGENT: { label: 'Urgent', variant: 'warning' },
  ROUTINE: { label: 'Routine', variant: 'secondary' },
};

const VISIT_STATUS_BADGE: Record<
  DepartmentVisit['status'],
  { label: string; variant: 'warning' | 'success' | 'secondary' }
> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  SCHEDULED: { label: 'Scheduled', variant: 'warning' },
  DONE: { label: 'Done', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'secondary' },
};

const VISIT_PRIORITY_ORDER: Record<DepartmentVisit['priority'], number> = { STAT: 0, URGENT: 1, ROUTINE: 2 };

/** Pending/Scheduled first, by priority (STAT -> Urgent -> Routine) then
 * scheduled time; Done/Cancelled pushed to the end — the server already
 * sorts this way (KardexDepartmentVisitQuerySet.ordered_for_display), this
 * just keeps the list correctly ordered after a local optimistic update. */
function sortVisits(visits: DepartmentVisit[]): DepartmentVisit[] {
  const notDone = (v: DepartmentVisit) => v.status === 'PENDING' || v.status === 'SCHEDULED';
  return [...visits].sort((a, b) => {
    if (notDone(a) !== notDone(b)) return notDone(a) ? -1 : 1;
    if (notDone(a)) {
      if (VISIT_PRIORITY_ORDER[a.priority] !== VISIT_PRIORITY_ORDER[b.priority]) {
        return VISIT_PRIORITY_ORDER[a.priority] - VISIT_PRIORITY_ORDER[b.priority];
      }
      return (a.scheduledDatetime || '').localeCompare(b.scheduledDatetime || '');
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

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
  const [visits, setVisits] = useState<DepartmentVisit[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showDiscontinued, setShowDiscontinued] = useState(false);
  const [showCompletedVisits, setShowCompletedVisits] = useState(false);

  const reload = useCallback(() => {
    Promise.all([
      fetchLaboratories(patientId),
      fetchMedications(patientId),
      fetchDepartmentVisits(patientId),
      fetchDepartments(),
    ])
      .then(([labsData, medsData, visitsData, departmentsData]) => {
        setLabs(labsData);
        setMeds(medsData);
        setVisits(visitsData);
        setDepartments(departmentsData);
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

  const [visitModalOpen, setVisitModalOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<DepartmentVisit | null>(null);
  const [deletingVisit, setDeletingVisit] = useState<DepartmentVisit | null>(null);

  const sortedLabs = [...labs].sort((a, b) => {
    const order = { pending: 0, done: 1, cancelled: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.dateOrdered.localeCompare(a.dateOrdered);
  });
  const activeMeds = meds.filter((m) => m.status !== 'DISCONTINUED');
  const discontinuedMeds = meds.filter((m) => m.status === 'DISCONTINUED');
  const sortedVisits = sortVisits(visits);
  const pendingVisits = sortedVisits.filter((v) => v.status === 'PENDING' || v.status === 'SCHEDULED');
  const completedVisits = sortedVisits.filter((v) => v.status === 'DONE' || v.status === 'CANCELLED');

  const handleSetMedStatus = async (med: MedicationOrder, status: MedicationOrder['status']) => {
    try {
      await updateMedication(med.id, { status });
      toast.success(
        status === 'DISCONTINUED' ? 'Medication discontinued' : status === 'ON_HOLD' ? 'Medication put on hold' : 'Medication reactivated'
      );
      reload();
    } catch (err) {
      toast.error('Failed to update medication', {
        description: err instanceof ApiError ? err.message : undefined,
      });
    }
  };

  const handleMarkVisitDone = async (visit: DepartmentVisit) => {
    try {
      await updateDepartmentVisit(visit.id, { status: 'DONE' });
      toast.success('Department visit marked done');
      reload();
    } catch (err) {
      toast.error('Failed to update visit', { description: err instanceof ApiError ? err.message : undefined });
    }
  };

  const handleCancelVisit = async (visit: DepartmentVisit) => {
    try {
      await updateDepartmentVisit(visit.id, { status: 'CANCELLED' });
      toast.success('Department visit cancelled');
      reload();
    } catch (err) {
      toast.error('Failed to cancel visit', { description: err instanceof ApiError ? err.message : undefined });
    }
  };

  const handleConfirmDeleteVisit = async () => {
    if (!deletingVisit) return;
    try {
      await deleteDepartmentVisit(deletingVisit.id);
      toast.success('Department visit deleted');
      setDeletingVisit(null);
      reload();
    } catch (err) {
      toast.error('Failed to delete visit', { description: err instanceof ApiError ? err.message : undefined });
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

  const renderMedRow = (med: MedicationOrder) => {
    const isActive = med.status === 'ACTIVE';
    const isDiscontinued = med.status === 'DISCONTINUED';
    return (
      <View key={med.id} style={styles.rowCard}>
        <View style={styles.rowCardHeader}>
          <View style={{ flex: 1, flexShrink: 1 }}>
            <Text style={styles.rowCardTitle}>{med.medicationName}</Text>
            {med.isOverdue ? <Badge variant="destructive" style={styles.overdueBadge}>Overdue</Badge> : null}
          </View>
          <Badge variant={MED_STATUS_BADGE[med.status].variant}>{MED_STATUS_BADGE[med.status].label}</Badge>
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
            <Text style={styles.fieldLabel}>Times</Text>
            <Text style={styles.fieldValue}>{med.scheduledTimes || '—'}</Text>
          </View>
          <View style={styles.fieldItem}>
            <Text style={styles.fieldLabel}>Last Given</Text>
            <Text style={styles.fieldValue}>{fmtDateTime(med.lastGiven)}</Text>
          </View>
          <View style={styles.fieldItem}>
            <Text style={styles.fieldLabel}>Prescribed By</Text>
            <Text style={styles.fieldValue}>{med.prescribedBy || '—'}</Text>
          </View>
        </View>
        <View style={styles.fieldItemFull}>
          <Text style={styles.fieldLabel}>Start–End Date</Text>
          <Text style={styles.fieldValue}>
            {fmtDate(med.startDate)} – {med.endDate ? fmtDate(med.endDate) : 'ongoing'}
          </Text>
        </View>
        <View style={styles.rowCardActions}>
          {isActive ? (
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
          {!isDiscontinued ? (
            <View style={styles.actionItem}>
              <Pressable onPress={() => handleSetMedStatus(med, isActive ? 'ON_HOLD' : 'ACTIVE')}>
                <Text style={[styles.linkText, { color: Colors.orange600 }]}>
                  {isActive ? 'Put On Hold' : 'Reactivate'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {!isDiscontinued ? (
            <View style={styles.actionItem}>
              <Pressable onPress={() => handleSetMedStatus(med, 'DISCONTINUED')}>
                <Text style={[styles.linkText, { color: Colors.red600 }]}>Discontinue</Text>
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
  };

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
          ) : meds.length === 0 ? (
            <Text style={styles.emptyText}>No medications recorded.</Text>
          ) : activeMeds.length === 0 ? (
            <Text style={styles.emptyText}>No active or on-hold medications.</Text>
          ) : (
            <View style={{ gap: 10 }}>{activeMeds.map((med) => renderMedRow(med))}</View>
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
                  Show discontinued ({discontinuedMeds.length})
                </Text>
              </Pressable>
              {showDiscontinued ? (
                <View style={{ gap: 10, marginTop: 8 }}>
                  {discontinuedMeds.map((med) => renderMedRow(med))}
                </View>
              ) : null}
            </View>
          ) : null}
        </CardContent>
      </Card>

      {/* Required Department Visits */}
      <Card>
        <CardHeader>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Building2 size={20} color={Colors.teal600} />
              <CardTitle>Required Department Visits</CardTitle>
            </View>
            <Button
              size="sm"
              onPress={() => {
                setEditingVisit(null);
                setVisitModalOpen(true);
              }}
            >
              <View style={styles.btnInner}>
                <Plus size={14} color={Colors.white} />
                <Text style={styles.btnTextWhite}>Add Department Visit</Text>
              </View>
            </Button>
          </View>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <Text style={styles.emptyText}>Loading...</Text>
          ) : visits.length === 0 ? (
            <Text style={styles.emptyText}>No required department visits.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {pendingVisits.length === 0 ? (
                <Text style={styles.emptyText}>No pending or scheduled visits.</Text>
              ) : (
                pendingVisits.map((visit) => (
                  <View key={visit.id} style={styles.rowCard}>
                    <View style={styles.rowCardHeader}>
                      <View style={{ flex: 1, flexShrink: 1 }}>
                        <Text style={styles.rowCardTitle}>{visit.departmentName}</Text>
                        <Text style={styles.fieldValue}>{visit.purpose}</Text>
                      </View>
                      <View style={{ gap: 6, alignItems: 'flex-end' }}>
                        <Badge variant={VISIT_PRIORITY_BADGE[visit.priority].variant}>
                          {VISIT_PRIORITY_BADGE[visit.priority].label}
                        </Badge>
                        <Badge variant={VISIT_STATUS_BADGE[visit.status].variant}>
                          {VISIT_STATUS_BADGE[visit.status].label}
                        </Badge>
                      </View>
                    </View>
                    <View style={styles.fieldItemFull}>
                      <Text style={styles.fieldLabel}>Scheduled</Text>
                      <Text style={styles.fieldValue}>{fmtDateTime(visit.scheduledDatetime)}</Text>
                    </View>
                    {visit.preparationNotes ? (
                      <View style={styles.fieldItemFull}>
                        <Text style={styles.fieldLabel}>Preparation</Text>
                        <Text style={[styles.fieldValue, { color: Colors.mutedForeground }]}>
                          {visit.preparationNotes}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.rowCardActions}>
                      <View style={styles.actionItem}>
                        <Pressable onPress={() => handleMarkVisitDone(visit)}>
                          <Text style={[styles.linkText, { color: Colors.green600 }]}>Mark as Done</Text>
                        </Pressable>
                      </View>
                      <View style={styles.actionItem}>
                        <Pressable onPress={() => { setEditingVisit(visit); setVisitModalOpen(true); }}>
                          <Text style={styles.linkText}>Edit</Text>
                        </Pressable>
                      </View>
                      <View style={styles.actionItem}>
                        <Pressable onPress={() => handleCancelVisit(visit)}>
                          <Text style={[styles.linkText, { color: Colors.orange600 }]}>Cancel</Text>
                        </Pressable>
                      </View>
                      {isHeadNurse ? (
                        <View style={styles.actionItem}>
                          <Pressable onPress={() => setDeletingVisit(visit)}>
                            <Text style={[styles.linkText, { color: Colors.red600 }]}>Delete</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {completedVisits.length > 0 ? (
            <View style={styles.discontinuedBlock}>
              <Pressable style={styles.collapseToggle} onPress={() => setShowCompletedVisits((s) => !s)}>
                {showCompletedVisits ? (
                  <ChevronUp size={16} color={Colors.mutedForeground} />
                ) : (
                  <ChevronDown size={16} color={Colors.mutedForeground} />
                )}
                <Text style={styles.collapseToggleText}>Show completed ({completedVisits.length})</Text>
              </Pressable>
              {showCompletedVisits ? (
                <View style={{ gap: 10, marginTop: 8 }}>
                  {completedVisits.map((visit) => (
                    <View key={visit.id} style={styles.rowCard}>
                      <View style={styles.rowCardHeader}>
                        <View style={{ flex: 1, flexShrink: 1 }}>
                          <Text style={styles.rowCardTitle}>{visit.departmentName}</Text>
                          <Text style={styles.fieldValue}>{visit.purpose}</Text>
                        </View>
                        <Badge variant={VISIT_STATUS_BADGE[visit.status].variant}>
                          {VISIT_STATUS_BADGE[visit.status].label}
                        </Badge>
                      </View>
                      <View style={styles.rowCardActions}>
                        {isHeadNurse ? (
                          <View style={styles.actionItem}>
                            <Pressable onPress={() => setDeletingVisit(visit)}>
                              <Text style={[styles.linkText, { color: Colors.red600 }]}>Delete</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))}
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
      <DepartmentVisitFormModal
        open={visitModalOpen}
        onOpenChange={setVisitModalOpen}
        patientId={patientId}
        departments={departments}
        visit={editingVisit}
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
      <ConfirmDialog
        open={!!deletingVisit}
        onOpenChange={(open) => !open && setDeletingVisit(null)}
        title="Delete department visit?"
        description={`This permanently removes "${deletingVisit?.purpose}" at ${deletingVisit?.departmentName} from this patient's Required Department Visits. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDeleteVisit}
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

const MED_STATUS_OPTIONS = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'On Hold', value: 'ON_HOLD' },
  { label: 'Discontinued', value: 'DISCONTINUED' },
];

function MedicationFormModal({ open, onOpenChange, patientId, medication, onSaved }: MedicationFormModalProps) {
  const toast = useToast();
  const [medicationName, setMedicationName] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('Oral');
  const [frequency, setFrequency] = useState('');
  const [scheduledTimes, setScheduledTimes] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [prescribedBy, setPrescribedBy] = useState('');
  const [status, setStatus] = useState<MedicationOrder['status']>('ACTIVE');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (() => {
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
        setStatus(medication.status);
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
        setStatus('ACTIVE');
        setRemarks('');
      }
      setError('');
      setTouched({});
    })();
  }, [open, medication]);

  const dateError = endDate && startDate && endDate < startDate ? 'End date cannot be before start date.' : '';
  const nameError = touched.medicationName && !medicationName.trim() ? 'Drug name is required.' : '';
  const doseError = touched.dose && !dose.trim() ? 'Dosage is required.' : '';
  const frequencyError = touched.frequency && !frequency.trim() ? 'Frequency is required.' : '';

  const handleSave = async () => {
    setTouched({ medicationName: true, dose: true, frequency: true });
    if (!medicationName.trim() || !dose.trim() || !frequency.trim() || !startDate) {
      setError('Drug name, dosage, route, and frequency are required.');
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
        status,
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
              <Input
                label="Drug Name *"
                value={medicationName}
                onChangeText={setMedicationName}
                onBlur={() => setTouched((t) => ({ ...t, medicationName: true }))}
                error={nameError || undefined}
              />
              <View style={styles.rowWrap}>
                <Input
                  label="Dosage *"
                  value={dose}
                  onChangeText={setDose}
                  onBlur={() => setTouched((t) => ({ ...t, dose: true }))}
                  error={doseError || undefined}
                  placeholder="e.g. 500 mg"
                  containerStyle={styles.colHalf}
                />
                <Select
                  label="Route *"
                  value={route}
                  onValueChange={setRoute}
                  options={ROUTE_OPTIONS}
                  style={styles.colHalf}
                />
              </View>
              <Input
                label="Frequency *"
                value={frequency}
                onChangeText={setFrequency}
                onBlur={() => setTouched((t) => ({ ...t, frequency: true }))}
                error={frequencyError || undefined}
                placeholder="e.g. q8h, BID, Once daily, PRN"
              />
              <Input
                label="Scheduled Times"
                value={scheduledTimes}
                onChangeText={setScheduledTimes}
                placeholder="e.g. 08:00, 16:00, 00:00"
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
              <Input
                label="Prescribed By"
                value={prescribedBy}
                onChangeText={setPrescribedBy}
                placeholder="Defaults to the attending physician"
              />
              {medication ? (
                <Select
                  label="Status"
                  value={status}
                  onValueChange={(v) => setStatus(v as MedicationOrder['status'])}
                  options={MED_STATUS_OPTIONS}
                />
              ) : null}
              <Input
                label="Special Instructions"
                value={remarks}
                onChangeText={setRemarks}
                multiline
                numberOfLines={2}
                style={styles.multiline}
                placeholder="e.g. Give after meals, Hold if BP < 90/60"
              />
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

interface DepartmentVisitFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  departments: Department[];
  visit: DepartmentVisit | null;
  onSaved: () => void;
}

const VISIT_PRIORITY_OPTIONS = [
  { label: 'Routine', value: 'ROUTINE' },
  { label: 'Urgent', value: 'URGENT' },
  { label: 'STAT', value: 'STAT' },
];

function DepartmentVisitFormModal({
  open, onOpenChange, patientId, departments, visit, onSaved,
}: DepartmentVisitFormModalProps) {
  const toast = useToast();
  const [departmentId, setDepartmentId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [priority, setPriority] = useState<DepartmentVisit['priority']>('ROUTINE');
  const [preparationNotes, setPreparationNotes] = useState('');
  const [orderedBy, setOrderedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    if (visit) {
      setDepartmentId(String(visit.departmentId));
      setPurpose(visit.purpose);
      const split = splitIsoDateTime(visit.scheduledDatetime);
      setScheduledDate(split.date);
      setScheduledTime(split.time);
      setPriority(visit.priority);
      setPreparationNotes(visit.preparationNotes);
      setOrderedBy(visit.orderedBy || '');
    } else {
      setDepartmentId('');
      setPurpose('');
      setScheduledDate('');
      setScheduledTime('');
      setPriority('ROUTINE');
      setPreparationNotes('');
      setOrderedBy('');
    }
    setError('');
    setTouched({});
  }, [open, visit]);

  const departmentError = touched.departmentId && !departmentId ? 'Department is required.' : '';
  const purposeError = touched.purpose && !purpose.trim() ? 'Purpose is required.' : '';

  const handleSave = async () => {
    setTouched({ departmentId: true, purpose: true });
    if (!departmentId || !purpose.trim()) {
      setError('Department and purpose are required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        departmentId: Number(departmentId),
        purpose: purpose.trim(),
        scheduledDatetime: scheduledDate ? toIsoDateTime(scheduledDate, scheduledTime) : null,
        priority,
        preparationNotes,
        orderedBy,
      };
      if (visit) {
        await updateDepartmentVisit(visit.id, payload);
      } else {
        await createDepartmentVisit({ ...payload, patientId });
      }
      toast.success(visit ? 'Department visit updated' : 'Department visit added');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save department visit.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RNModal visible={open} transparent animationType="fade" onRequestClose={() => !submitting && onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => !submitting && onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.dialogTitle}>{visit ? 'Edit Department Visit' : 'Add Department Visit'}</Text>
            <Pressable onPress={() => onOpenChange(false)}>
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
            <View style={{ gap: 12 }}>
              {error ? <Text style={styles.formError}>{error}</Text> : null}
              <Select
                label="Department *"
                value={departmentId}
                onValueChange={(v) => { setDepartmentId(v); setTouched((t) => ({ ...t, departmentId: true })); }}
                options={departments.map((d) => ({ label: d.name, value: String(d.id) }))}
                searchable
                searchPlaceholder="Search departments..."
                placeholder="Select a department"
                error={departmentError || undefined}
              />
              <Input
                label="Purpose *"
                value={purpose}
                onChangeText={setPurpose}
                onBlur={() => setTouched((t) => ({ ...t, purpose: true }))}
                error={purposeError || undefined}
                placeholder="e.g. Chest X-ray, CBC, Hemodialysis session"
              />
              <Text style={styles.fieldGroupLabel}>Scheduled</Text>
              <View style={styles.rowWrap}>
                <DatePicker value={scheduledDate} onChange={setScheduledDate} style={styles.colHalf} />
                <TimePicker value={scheduledTime} onChange={setScheduledTime} style={styles.colHalf} />
              </View>
              <Select
                label="Priority"
                value={priority}
                onValueChange={(v) => setPriority(v as DepartmentVisit['priority'])}
                options={VISIT_PRIORITY_OPTIONS}
              />
              <Input
                label="Preparation Notes"
                value={preparationNotes}
                onChangeText={setPreparationNotes}
                multiline
                numberOfLines={2}
                style={styles.multiline}
                placeholder="e.g. NPO after midnight, Bring previous films, Needs wheelchair"
              />
              <Input label="Ordered By" value={orderedBy} onChangeText={setOrderedBy} />
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
