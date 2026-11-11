import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { X, UserX, ArrowRight, Users, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { Input } from './Input';
import { Select } from './Select';
import { Colors, Radius, Shadows } from '../constants/colors';
import {
  markDutyAbsent,
  fetchReassignmentCandidates,
  reassignAbsentPatients,
  ApiError,
} from '../services/api';
import { useToast } from '../contexts/ToastContext';
import type { DutyAssignment, AbsenceDetail, EligibleReplacementNurse, Patient } from '../types/domain';

type Step = 'confirm' | 'reassign';

/**
 * Nurse Absence Management, end to end:
 *  1. Confirm marking the nurse absent for this shift (optional reason). The
 *     shift row is preserved — the backend only flags it Absent and records
 *     who/when.
 *  2. Reassign that nurse's patients to replacement nurses. Each patient's
 *     unfinished tasks move with them automatically (server-side); completed
 *     tasks stay with the original nurse. The receiving nurses and the head
 *     nurse are notified.
 *
 * Opening it on a shift already marked Absent jumps straight to step 2 so a
 * head nurse can finish (or revisit) the reassignment.
 */
export function NurseAbsenceModal({
  open,
  onOpenChange,
  assignment,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: DutyAssignment | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('confirm');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState<AbsenceDetail | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [error, setError] = useState('');

  // Reset the whole flow whenever the dialog (re)opens for an assignment —
  // render-time reset, so there's no setState-in-effect.
  const openKey = open && assignment ? assignment.id : null;
  const [lastKey, setLastKey] = useState<number | null>(null);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    if (open && assignment) {
      const alreadyAbsent = assignment.status === 'absent';
      setReason(assignment.absenceReason || '');
      setPicks({});
      setDetail(null);
      setError('');
      setStep(alreadyAbsent ? 'reassign' : 'confirm');
      // Setting loading here (during the render-time reset) rather than inside
      // the effect keeps the effect free of synchronous setState. It also
      // doubles as the re-entry guard for the loader effect below.
      setLoadingCandidates(alreadyAbsent);
    }
  }

  // Load the absent nurse's patients + eligible nurses when the dialog lands on
  // the reassign step without them yet (i.e. opened on an already-absent
  // shift). Runs only while loadingCandidates is true (set once in the reset
  // block) and clears it in finally, so it never double-fetches; the
  // mark-absent path fills `detail` directly and leaves loading false.
  useEffect(() => {
    if (!open || !assignment || step !== 'reassign' || detail || !loadingCandidates) return;
    let cancelled = false;
    fetchReassignmentCandidates(assignment.id)
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the reassignment candidates.');
      })
      .finally(() => { if (!cancelled) setLoadingCandidates(false); });
    return () => { cancelled = true; };
  }, [open, assignment, step, detail, loadingCandidates]);

  const confirmAbsent = async () => {
    if (!assignment) return;
    setBusy(true);
    setError('');
    try {
      const data = await markDutyAbsent(assignment.id, reason.trim());
      setDetail(data);
      setStep('reassign');
      toast.success('Nurse marked absent', {
        description: `${assignment.nurseName}'s ${assignment.shiftLabel} shift was flagged absent. Reassign their patients below.`,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark the nurse absent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitReassignment = async () => {
    if (!assignment) return;
    const assignments = Object.entries(picks)
      .filter(([, nurseId]) => !!nurseId)
      .map(([patientId, nurseId]) => ({ patientId, nurseId }));
    if (assignments.length === 0) {
      setError('Pick a replacement nurse for at least one patient.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { results } = await reassignAbsentPatients(assignment.id, assignments, reason.trim());
      const totalTasks = results.reduce((n, r) => n + r.tasksTransferred, 0);
      toast.success('Patients reassigned', {
        description: `${results.length} patient${results.length !== 1 ? 's' : ''} moved · ${totalTasks} pending task${totalTasks !== 1 ? 's' : ''} transferred.`,
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reassign the patients. Nothing was changed — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const patients: Patient[] = detail?.patients || [];
  const eligible: EligibleReplacementNurse[] = detail?.eligibleNurses || [];
  const nurseOptions = [
    { label: '— Select nurse —', value: '' },
    ...eligible.map((n) => ({
      label: `${n.fullName} · ${n.shiftLabel} · ${n.patientCount} patient${n.patientCount !== 1 ? 's' : ''}`,
      value: n.id,
    })),
  ];
  const pickedCount = Object.values(picks).filter(Boolean).length;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <UserX size={16} color={Colors.red700} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.title}>{step === 'confirm' ? 'Mark Nurse Absent' : 'Reassign Patients'}</Text>
              {assignment ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {assignment.nurseName} · {assignment.shiftLabel} · {assignment.departmentName}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8} accessibilityLabel="Close">
              <X size={20} color={Colors.gray500} />
            </Pressable>
          </View>

          {step === 'confirm' ? (
            <View style={styles.body}>
              <View style={styles.warnRow}>
                <AlertTriangle size={15} color={Colors.orange700} />
                <Text style={styles.warnText}>
                  This flags {assignment?.nurseName}&apos;s shift as absent — the shift itself is kept. You&apos;ll
                  then reassign their patients to other nurses.
                </Text>
              </View>
              <Input
                label="Reason (optional)"
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Called in sick"
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable onPress={() => onOpenChange(false)} style={[styles.btn, styles.cancelBtn]}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmAbsent}
                  disabled={busy}
                  style={[styles.btn, styles.dangerBtn, busy && styles.btnDisabled]}
                >
                  {busy ? <ActivityIndicator size="small" color={Colors.white} /> : (
                    <Text style={styles.confirmText}>Mark Absent</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.body}>
              {loadingCandidates ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color={Colors.blue600} />
                  <Text style={styles.loadingText}>Loading patients…</Text>
                </View>
              ) : patients.length === 0 ? (
                <View style={styles.doneBox}>
                  <CheckCircle2 size={28} color={Colors.green600} />
                  <Text style={styles.doneText}>
                    {assignment?.nurseName} has no patients left to reassign.
                  </Text>
                  <Pressable onPress={() => onOpenChange(false)} style={[styles.btn, styles.confirmBtn, styles.wide]}>
                    <Text style={styles.confirmText}>Done</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <View style={styles.infoRow}>
                    <Users size={14} color={Colors.blue700} />
                    <Text style={styles.infoText}>
                      Assign each patient to a replacement nurse. Pending tasks move with the patient; completed
                      tasks stay on {assignment?.nurseName}&apos;s record.
                    </Text>
                  </View>
                  {eligible.length === 0 ? (
                    <View style={styles.warnRow}>
                      <AlertTriangle size={15} color={Colors.orange700} />
                      <Text style={styles.warnText}>No other on-duty nurse is available right now to receive patients.</Text>
                    </View>
                  ) : null}
                  <ScrollView style={styles.patientScroll} contentContainerStyle={styles.patientList}>
                    {patients.map((p) => (
                      <View key={p.id} style={styles.patientRow}>
                        <View style={styles.patientInfo}>
                          <Text style={styles.patientName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.patientMeta} numberOfLines={1}>
                            Room {p.room || '—'} · {p.id}
                          </Text>
                        </View>
                        <ArrowRight size={14} color={Colors.gray400} />
                        <Select
                          value={picks[p.id] || ''}
                          onValueChange={(v) => setPicks((prev) => ({ ...prev, [p.id]: v }))}
                          options={nurseOptions}
                          style={styles.nurseSelect}
                          searchable
                        />
                      </View>
                    ))}
                  </ScrollView>
                  {error ? <Text style={styles.error}>{error}</Text> : null}
                  <View style={styles.actions}>
                    <Pressable onPress={() => onOpenChange(false)} style={[styles.btn, styles.cancelBtn]}>
                      <Text style={styles.cancelText}>Close</Text>
                    </Pressable>
                    <Pressable
                      onPress={submitReassignment}
                      disabled={busy || pickedCount === 0}
                      style={[styles.btn, styles.confirmBtn, (busy || pickedCount === 0) && styles.btnDisabled]}
                    >
                      {busy ? <ActivityIndicator size="small" color={Colors.white} /> : (
                        <Text style={styles.confirmText}>
                          Reassign{pickedCount > 0 ? ` ${pickedCount}` : ''}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 520, maxHeight: '88%', backgroundColor: Colors.white, borderRadius: Radius.xl, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.red50, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '800', color: Colors.foreground },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 1 },
  body: { padding: 16, gap: 12 },

  warnRow: { flexDirection: 'row', gap: 8, backgroundColor: Colors.orange50, borderWidth: 1, borderColor: Colors.orange300, borderRadius: Radius.md, padding: 10 },
  warnText: { flex: 1, fontSize: 12.5, color: Colors.orange700, lineHeight: 18 },
  infoRow: { flexDirection: 'row', gap: 8, backgroundColor: Colors.blue50, borderWidth: 1, borderColor: Colors.blue100, borderRadius: Radius.md, padding: 10 },
  infoText: { flex: 1, fontSize: 12.5, color: Colors.blue800, lineHeight: 18 },

  patientScroll: { maxHeight: 320 },
  patientList: { gap: 8 },
  patientRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.gray50, borderRadius: Radius.md, padding: 8 },
  patientInfo: { width: 130, minWidth: 0 },
  patientName: { fontSize: 13, fontWeight: '700', color: Colors.gray900 },
  patientMeta: { fontSize: 11, color: Colors.mutedForeground, marginTop: 1 },
  nurseSelect: { flex: 1, minWidth: 0 },

  loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  loadingText: { color: Colors.mutedForeground, fontSize: 13 },
  doneBox: { alignItems: 'center', paddingVertical: 20, gap: 12 },
  doneText: { fontSize: 13.5, color: Colors.gray700, textAlign: 'center', maxWidth: 320 },

  error: { fontSize: 12.5, color: Colors.red700 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  wide: { flex: 0, paddingHorizontal: 28 },
  cancelBtn: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  cancelText: { fontSize: 14, fontWeight: '700', color: Colors.gray700 },
  confirmBtn: { backgroundColor: Colors.blue600 },
  dangerBtn: { backgroundColor: Colors.red600 },
  confirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  btnDisabled: { opacity: 0.5 },
});
