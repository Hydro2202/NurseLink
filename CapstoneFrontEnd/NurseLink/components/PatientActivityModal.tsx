import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { History, X, ArrowRight } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { formatDateTime12 } from '../utils/time';
import type { Patient } from '../types/domain';

type Change = { field: string; label: string; from: string; to: string };

/** Normalises a history entry's `changes` — newer rows are {field,label,from,to}
 *  objects, older rows are plain label strings. */
function normalizeChanges(changes: (string | Change)[]): Change[] {
  return (changes || []).map((c) =>
    typeof c === 'string'
      ? { field: c, label: c, from: '', to: '' }
      : c
  );
}

/**
 * Patient Activity History — the audit trail of changes to a patient's record
 * (room transfers, condition, diagnosis, attending physician, risk, vitals),
 * each with who made it, when, and the before -> after value. Reads the
 * patient's own edit_history (already loaded with the patient), so it opens
 * instantly with no extra request.
 */
export function PatientActivityModal({
  open,
  onOpenChange,
  patient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
}) {
  const entries = useMemo(
    () => [...(patient?.editHistory || [])].reverse(), // newest first
    [patient]
  );

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
      <Pressable style={styles.backdrop} onPress={() => onOpenChange(false)}>
        <Pressable style={[styles.dialog, Shadows.xl]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <History size={16} color={Colors.blue700} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.title}>Activity History</Text>
              {patient ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {patient.name} · {patient.id}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => onOpenChange(false)} hitSlop={8} accessibilityLabel="Close">
              <X size={20} color={Colors.gray500} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {entries.length === 0 ? (
              <Text style={styles.empty}>No changes have been recorded for this patient yet.</Text>
            ) : (
              entries.map((entry, i) => {
                const changes = normalizeChanges(entry.changes);
                return (
                  <View key={i} style={styles.entry}>
                    <View style={styles.timeline}>
                      <View style={styles.dot} />
                      {i < entries.length - 1 ? <View style={styles.line} /> : null}
                    </View>
                    <View style={styles.entryBody}>
                      <Text style={styles.entryMeta}>
                        {formatDateTime12(entry.editedAt)}
                        {entry.editedBy ? ` · ${entry.editedBy}` : ''}
                      </Text>
                      <View style={styles.changeList}>
                        {changes.map((c, j) => (
                          <View key={j} style={styles.change}>
                            <Text style={styles.changeLabel}>{c.label}</Text>
                            {c.from || c.to ? (
                              <View style={styles.fromTo}>
                                <Text style={styles.fromVal} numberOfLines={1}>
                                  {c.from || '—'}
                                </Text>
                                <ArrowRight size={12} color={Colors.gray400} />
                                <Text style={styles.toVal} numberOfLines={1}>
                                  {c.to || '—'}
                                </Text>
                              </View>
                            ) : (
                              <Text style={styles.changedTag}>changed</Text>
                            )}
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 520, maxHeight: '86%', backgroundColor: Colors.white, borderRadius: Radius.xl, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.blue50, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '800', color: Colors.foreground },
  subtitle: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 1 },
  body: { maxHeight: 460 },
  bodyContent: { padding: 16 },
  empty: { fontSize: 13, color: Colors.mutedForeground, textAlign: 'center', paddingVertical: 24 },
  entry: { flexDirection: 'row', gap: 12 },
  timeline: { width: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.blue600, marginTop: 4 },
  line: { flex: 1, width: 2, backgroundColor: Colors.gray200, marginTop: 2 },
  entryBody: { flex: 1, paddingBottom: 18 },
  entryMeta: { fontSize: 12, color: Colors.mutedForeground, fontWeight: '600' },
  changeList: { marginTop: 6, gap: 6 },
  change: { backgroundColor: Colors.gray50, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 8, gap: 3 },
  changeLabel: { fontSize: 12, fontWeight: '700', color: Colors.foreground },
  fromTo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fromVal: { fontSize: 12.5, color: Colors.red700, flexShrink: 1 },
  toVal: { fontSize: 12.5, color: Colors.green700, fontWeight: '600', flexShrink: 1 },
  changedTag: { fontSize: 11.5, color: Colors.mutedForeground, fontStyle: 'italic' },
});
