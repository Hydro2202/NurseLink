import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { X, User, UserCheck, ArrowRightLeft } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Badge } from './Badge';
import { fetchAssignments, ApiError } from '../services/api';
import type { Patient, PatientAssignmentRecord } from '../types/domain';

interface PatientAssignmentHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const END_REASON_LABEL: Record<string, string> = {
  ENDORSED: 'Endorsed to another nurse',
  REASSIGNED: 'Reassigned',
};

/**
 * Every nurse who has ever been responsible for this patient, newest
 * first — the head nurse's "who handles this patient" view. Reuses the
 * same PatientAssignment rows Workload Monitor and endorsement accept
 * already write (see AssignmentViewSet's patientId filter), so this is
 * real assignment history, not a guess reconstructed from other screens.
 */
export function PatientAssignmentHistoryModal({
  open,
  onOpenChange,
  patient,
}: PatientAssignmentHistoryModalProps) {
  const [records, setRecords] = useState<PatientAssignmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !patient) return;
    let cancelled = false;
    (() => {
      setLoading(true);
      setError('');
    })();
    fetchAssignments({ patientId: patient.id, status: 'all' })
      .then((data) => {
        if (!cancelled) setRecords(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load assignment history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patient]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Assigned Nurses</Text>
              <Text style={styles.subtitle}>
                {patient ? `${patient.name} · ${patient.id}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8} accessibilityLabel="Close">
              <X size={20} color={Colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={Colors.blue600} />
              </View>
            ) : error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : records.length === 0 ? (
              <Text style={styles.muted}>No nurse has been assigned to this patient yet.</Text>
            ) : (
              <View style={styles.list}>
                {records.map((record) => {
                  const isActive = record.status === 'active';
                  return (
                    <View
                      key={record.id}
                      style={[styles.card, isActive && styles.cardActive]}
                    >
                      <View style={styles.topRow}>
                        <View style={styles.nurseRow}>
                          {isActive ? (
                            <UserCheck size={15} color={Colors.blue700} />
                          ) : (
                            <User size={15} color={Colors.mutedForeground} />
                          )}
                          <Text style={styles.nurseName}>{record.assignedNurse || 'Unknown nurse'}</Text>
                        </View>
                        <Badge variant={isActive ? 'info' : 'secondary'}>
                          {isActive ? 'Current' : record.status === 'reassigned' ? 'Reassigned' : 'Ended'}
                        </Badge>
                      </View>

                      <Text style={styles.dateText}>
                        Assigned {formatDateTime(record.assignedAt)}
                        {record.assignedByName ? ` · by ${record.assignedByName}` : ''}
                      </Text>

                      {!isActive && record.endedAt ? (
                        <View style={styles.endRow}>
                          <ArrowRightLeft size={12.5} color={Colors.gray500} />
                          <Text style={styles.endText}>
                            {record.endReason ? END_REASON_LABEL[record.endReason] || 'Assignment ended' : 'Assignment ended'}
                            {' · '}
                            {formatDateTime(record.endedAt)}
                          </Text>
                        </View>
                      ) : null}

                      {record.notes ? <Text style={styles.notesText}>{record.notes}</Text> : null}
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 20,
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2 },
  scroll: { flexGrow: 0 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  muted: { color: Colors.mutedForeground, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  errorText: { color: Colors.destructive, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  list: { gap: 10, paddingBottom: 8 },
  card: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: 12,
    gap: 6,
    backgroundColor: Colors.gray50,
  },
  cardActive: {
    borderColor: Colors.blue300,
    backgroundColor: Colors.blue50,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nurseRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  nurseName: { fontSize: 14.5, fontWeight: '700', color: Colors.foreground, flexShrink: 1 },
  dateText: { fontSize: 12, color: Colors.mutedForeground },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  endText: { fontSize: 12, color: Colors.gray600 },
  notesText: { fontSize: 12.5, color: Colors.foreground, lineHeight: 17 },
});
