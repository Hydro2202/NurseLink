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
import {
  X,
  CalendarDays,
  MapPin,
  Stethoscope,
  User,
  Building2,
  HeartPulse,
  FileText,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Badge } from './Badge';
import { fetchPatientVisits, ApiError } from '../services/api';
import type { Patient, PatientVisit } from '../types/domain';

interface PatientVisitHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const METHOD_FIELDS: { key: 'medications' | 'environment' | 'treatment' | 'healthTeaching' | 'outpatientReferral' | 'diet'; letter: string; label: string }[] = [
  { key: 'medications', letter: 'M', label: 'Medications' },
  { key: 'environment', letter: 'E', label: 'Environment' },
  { key: 'treatment', letter: 'T', label: 'Treatment' },
  { key: 'healthTeaching', letter: 'H', label: 'Health Teaching' },
  { key: 'outpatientReferral', letter: 'O', label: 'Outpatient Referral' },
  { key: 'diet', letter: 'D', label: 'Diet' },
];

export function PatientVisitHistoryModal({ open, onOpenChange, patient }: PatientVisitHistoryModalProps) {
  const [visits, setVisits] = useState<PatientVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedPlans, setExpandedPlans] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || !patient) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchPatientVisits(patient.id)
      .then((data) => {
        if (!cancelled) setVisits(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load visit history.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patient]);

  const togglePlan = (visitId: number) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Visit History</Text>
              <Text style={styles.subtitle}>
                {patient ? `${patient.name} · ${patient.id}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8}>
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
            ) : visits.length === 0 ? (
              <Text style={styles.muted}>No visit history recorded yet.</Text>
            ) : (
              <View style={styles.visitList}>
                {visits.map((visit) => (
                  <View
                    key={visit.id}
                    style={[styles.visitCard, visit.isActive && styles.visitCardActive]}
                  >
                    <View style={styles.visitTopRow}>
                      <View style={styles.visitDates}>
                        <CalendarDays size={14} color={Colors.blue700} />
                        <Text style={styles.visitDateText}>
                          {formatDate(visit.admissionDate)} —{' '}
                          {visit.isActive ? 'Present' : formatDate(visit.dischargeDate)}
                        </Text>
                      </View>
                      <Badge variant={visit.isActive ? 'info' : 'secondary'}>
                        {visit.isActive ? 'Current Visit' : 'Past Visit'}
                      </Badge>
                    </View>

                    <Text style={styles.diagnosisText}>{visit.diagnosis || 'No diagnosis recorded'}</Text>

                    <View style={styles.metaGrid}>
                      <View style={styles.metaItem}>
                        <MapPin size={12.5} color={Colors.mutedForeground} />
                        <Text style={styles.metaText}>{visit.room || 'No room recorded'}</Text>
                      </View>
                      <View style={styles.metaItem}>
                        <Stethoscope size={12.5} color={Colors.mutedForeground} />
                        <Text style={styles.metaText}>
                          {visit.attendingPhysician || 'No physician recorded'}
                        </Text>
                      </View>
                      <View style={styles.metaItem}>
                        <User size={12.5} color={Colors.mutedForeground} />
                        <Text style={styles.metaText}>
                          {visit.assignedNurseName || 'No nurse recorded'}
                        </Text>
                      </View>
                    </View>

                    {visit.medicalTeam.length > 0 ? (
                      <View style={styles.teamRow}>
                        <Building2 size={12.5} color={Colors.blue700} />
                        <Text style={styles.teamText} numberOfLines={2}>
                          {visit.medicalTeam.map((d) => `${d.name} (${d.departmentName})`).join(', ')}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.statsRow}>
                      <View style={styles.statChip}>
                        <HeartPulse size={12} color={Colors.red600} />
                        <Text style={styles.statChipText}>
                          {visit.vitals.length} vitals reading{visit.vitals.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <View style={styles.statChip}>
                        <FileText size={12} color={Colors.blue600} />
                        <Text style={styles.statChipText}>
                          {visit.notes.length} note{visit.notes.length === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </View>

                    {visit.vitals.length > 0 ? (
                      <View style={styles.latestVitalBox}>
                        <Text style={styles.latestVitalLabel}>
                          Most recent · {formatDateTime(visit.vitals[0].recordedAt)}
                        </Text>
                        <Text style={styles.latestVitalValue}>
                          {[
                            visit.vitals[0].heartRate != null ? `HR ${visit.vitals[0].heartRate}` : null,
                            visit.vitals[0].bloodPressure ? `BP ${visit.vitals[0].bloodPressure}` : null,
                            visit.vitals[0].temperature != null ? `Temp ${visit.vitals[0].temperature}°C` : null,
                            visit.vitals[0].oxygenSaturation != null
                              ? `SpO2 ${visit.vitals[0].oxygenSaturation}%`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'No values documented'}
                        </Text>
                      </View>
                    ) : null}

                    {visit.dischargedByName ? (
                      <Text style={styles.dischargedByText}>
                        Discharged by {visit.dischargedByName}
                      </Text>
                    ) : null}

                    {visit.hasDischargePlan && visit.dischargePlan ? (
                      <View style={styles.planSection}>
                        <Pressable
                          style={styles.planToggle}
                          onPress={() => togglePlan(visit.id)}
                          hitSlop={4}
                        >
                          <View style={styles.planToggleLeft}>
                            <ClipboardCheck size={13} color={Colors.blue700} />
                            <Text style={styles.planToggleText}>Discharge Plan</Text>
                            {visit.dischargePlan.aiGenerated ? (
                              <View style={styles.aiBadge}>
                                <Sparkles size={9} color={Colors.blue700} />
                                <Text style={styles.aiBadgeText}>AI-assisted</Text>
                              </View>
                            ) : null}
                          </View>
                          {expandedPlans.has(visit.id) ? (
                            <ChevronUp size={14} color={Colors.mutedForeground} />
                          ) : (
                            <ChevronDown size={14} color={Colors.mutedForeground} />
                          )}
                        </Pressable>

                        {expandedPlans.has(visit.id) ? (
                          <View style={styles.planBody}>
                            {METHOD_FIELDS.map(({ key, letter, label }) => (
                              <View key={key} style={styles.planField}>
                                <View style={styles.planFieldLabelRow}>
                                  <View style={styles.planLetterBadge}>
                                    <Text style={styles.planLetterBadgeText}>{letter}</Text>
                                  </View>
                                  <Text style={styles.planFieldLabel}>{label}</Text>
                                </View>
                                <Text style={styles.planFieldValue}>
                                  {visit.dischargePlan?.[key] || 'Not documented'}
                                </Text>
                              </View>
                            ))}
                            <Text style={styles.planCompletedText}>
                              Completed by {visit.dischargePlan.completedByName || 'Unknown'}
                              {visit.dischargePlan.completedAt
                                ? ` on ${formatDateTime(visit.dischargePlan.completedAt)}`
                                : ''}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))}
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
    maxWidth: 620,
    maxHeight: '85%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  subtitle: { fontSize: 13, color: Colors.mutedForeground, marginTop: 2 },
  scroll: { flexGrow: 0 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  muted: { color: Colors.mutedForeground, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  errorText: { color: Colors.destructive, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  visitList: { gap: 12, paddingBottom: 8 },
  visitCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 8,
    backgroundColor: Colors.gray50,
  },
  visitCardActive: {
    borderColor: Colors.blue300,
    backgroundColor: Colors.blue50,
  },
  visitTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  visitDates: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  visitDateText: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  diagnosisText: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  metaGrid: { gap: 5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12.5, color: Colors.mutedForeground, flexShrink: 1 },
  teamRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  teamText: { flex: 1, fontSize: 12, color: Colors.blue800 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statChipText: { fontSize: 11, fontWeight: '600', color: Colors.gray700 },
  latestVitalBox: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 8,
    gap: 2,
  },
  latestVitalLabel: { fontSize: 10.5, color: Colors.mutedForeground, fontWeight: '600' },
  latestVitalValue: { fontSize: 12.5, color: Colors.foreground, fontWeight: '600' },
  dischargedByText: { fontSize: 11.5, color: Colors.gray500, fontStyle: 'italic' },
  planSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 4,
    paddingTop: 8,
  },
  planToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planToggleText: { fontSize: 12.5, fontWeight: '700', color: Colors.blue700 },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.blue100,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  aiBadgeText: { fontSize: 9.5, fontWeight: '600', color: Colors.blue700 },
  planBody: {
    gap: 10,
    marginTop: 10,
  },
  planField: { gap: 3 },
  planFieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planLetterBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.blue100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planLetterBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.blue700 },
  planFieldLabel: { fontSize: 11.5, fontWeight: '600', color: Colors.gray700 },
  planFieldValue: { fontSize: 12.5, color: Colors.foreground, lineHeight: 17, paddingLeft: 22 },
  planCompletedText: { fontSize: 11, color: Colors.gray500, fontStyle: 'italic', marginTop: 2 },
});
