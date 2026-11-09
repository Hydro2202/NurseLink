import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Users, X, Stethoscope, ClipboardList, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react-native';
import { Card, CardContent } from '../Card';
import { Colors, Radius } from '../../constants/colors';
import type { Nurse, Patient, WorkloadData } from '../../types/domain';

type Filter = 'all' | 'onDuty' | 'offDuty';

const SHIFT_LABEL: Record<string, string> = {
  morning: 'Morning', afternoon: 'Afternoon', night: 'Night', '': '',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/**
 * Head-nurse Nurse Overview: every nurse with department and live duty
 * status, filterable by On Duty / Off Duty, each row opening a detail panel
 * of that nurse's current patient assignments. All from real data —
 * fetchNurses (roster + presence) and fetchWorkload (who is on shift now).
 */
export function NurseOverviewSection({
  nurses,
  workload,
  patients,
  onOpenPatient,
}: {
  nurses: Nurse[];
  workload: WorkloadData[];
  patients: Patient[];
  onOpenPatient: (patientId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Nurse | null>(null);

  const onDuty = useMemo(() => {
    const byId = new Map(workload.map((w) => [w.nurseId, w]));
    return { ids: new Set(workload.map((w) => w.nurseId)), byId };
  }, [workload]);

  const rows = useMemo(() => {
    return nurses
      .map((n) => ({ nurse: n, live: onDuty.ids.has(n.id) }))
      .filter((r) => (filter === 'onDuty' ? r.live : filter === 'offDuty' ? !r.live : true))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.nurse.name.localeCompare(b.nurse.name));
  }, [nurses, onDuty, filter]);

  const counts = useMemo(
    () => ({ all: nurses.length, onDuty: onDuty.ids.size, offDuty: nurses.length - onDuty.ids.size }),
    [nurses, onDuty]
  );

  const selectedPatients = useMemo(
    () =>
      selected
        ? patients.filter((p) => p.status !== 'discharged' && p.assignedNurseName?.trim() === selected.name.trim())
        : [],
    [selected, patients]
  );
  const selectedWork = selected ? onDuty.byId.get(selected.id) : undefined;

  const tab = (key: Filter, label: string) => (
    <Pressable
      key={key}
      onPress={() => setFilter(key)}
      style={[styles.tab, filter === key && styles.tabActive]}
      accessibilityRole="tab"
      accessibilityState={{ selected: filter === key }}
    >
      <Text style={[styles.tabText, filter === key && styles.tabTextActive]}>
        {label} {counts[key]}
      </Text>
    </Pressable>
  );

  return (
    <Card>
      <CardContent style={styles.body}>
        <View style={styles.header}>
          <Users size={18} color={Colors.blue600} />
          <Text style={styles.title}>Nurse Overview</Text>
        </View>
        <View style={styles.tabs}>
          {tab('all', 'All')}
          {tab('onDuty', 'On Duty')}
          {tab('offDuty', 'Off Duty')}
        </View>

        {rows.length === 0 ? (
          <Text style={styles.empty}>No nurses match this filter.</Text>
        ) : (
          <View style={styles.list}>
            {rows.map(({ nurse, live }) => (
              <Pressable
                key={nurse.id}
                onPress={() => setSelected(nurse)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`${nurse.name}, ${live ? 'on duty' : 'off duty'}`}
              >
                <View style={[styles.avatar, !live && styles.avatarOff]}>
                  <Text style={[styles.avatarText, !live && styles.avatarTextOff]}>{initials(nurse.name)}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>{nurse.name}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {nurse.department || 'No department'}
                    {live && nurse.shift ? ` · ${SHIFT_LABEL[nurse.shift] || nurse.shift}` : ''}
                  </Text>
                </View>
                <View style={[styles.statusPill, live ? styles.pillOn : styles.pillOff]}>
                  <Text style={[styles.statusPillText, live ? styles.pillOnText : styles.pillOffText]}>
                    {live ? 'On Duty' : 'Off Duty'}
                  </Text>
                </View>
                <ChevronRight size={16} color={Colors.gray300} />
              </Pressable>
            ))}
          </View>
        )}
      </CardContent>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <View style={styles.dialogHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(selected.name)}</Text>
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.dialogName}>{selected.name}</Text>
                    <Text style={styles.dialogMeta}>
                      {selected.department || 'No department'} · {onDuty.ids.has(selected.id) ? 'On Duty' : 'Off Duty'}
                    </Text>
                  </View>
                  <Pressable onPress={() => setSelected(null)} hitSlop={8} accessibilityLabel="Close">
                    <X size={20} color={Colors.gray500} />
                  </Pressable>
                </View>

                <View style={styles.metricRow}>
                  <Metric icon={Stethoscope} label="Patients" value={selectedWork?.patientCount ?? selectedPatients.length} color={Colors.blue600} />
                  <Metric icon={ClipboardList} label="Tasks" value={selectedWork?.taskCount ?? 0} color={Colors.purple600} />
                  <Metric icon={CheckCircle2} label="Done" value={selectedWork?.completedTasks ?? 0} color={Colors.green600} />
                  <Metric icon={AlertCircle} label="Overdue" value={selectedWork?.overdueTasks ?? 0} color={Colors.red600} />
                </View>

                <Text style={styles.sectionLabel}>Current patient assignments</Text>
                <ScrollView style={styles.dialogList}>
                  {selectedPatients.length === 0 ? (
                    <Text style={styles.empty}>No patients currently assigned.</Text>
                  ) : (
                    selectedPatients.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => { setSelected(null); onOpenPatient(p.id); }}
                        style={({ pressed }) => [styles.assignRow, pressed && styles.rowPressed]}
                      >
                        <View style={styles.flex1}>
                          <Text style={styles.assignName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.assignMeta} numberOfLines={1}>
                            {p.id} · Room {p.room} · {p.diagnosis || 'No diagnosis'}
                          </Text>
                        </View>
                        <ChevronRight size={16} color={Colors.gray300} />
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; value: number; color: string }) {
  return (
    <View style={styles.metric}>
      <Icon size={15} color={color} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: Colors.foreground },
  tabs: { flexDirection: 'row', backgroundColor: Colors.gray100, borderRadius: 10, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  tabActive: { backgroundColor: Colors.white, ...( { shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 }) },
  tabText: { fontSize: 12.5, fontWeight: '600', color: Colors.mutedForeground },
  tabTextActive: { color: Colors.blue700, fontWeight: '800' },
  empty: { fontSize: 13, color: Colors.mutedForeground, paddingVertical: 10, textAlign: 'center' },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: Radius.md },
  rowPressed: { backgroundColor: Colors.gray50 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.blue100, alignItems: 'center', justifyContent: 'center' },
  avatarOff: { backgroundColor: Colors.gray100 },
  avatarText: { fontSize: 14, fontWeight: '800', color: Colors.blue700 },
  avatarTextOff: { color: Colors.gray500 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  rowMeta: { fontSize: 12, color: Colors.mutedForeground, marginTop: 1 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillOn: { backgroundColor: Colors.green50 },
  pillOff: { backgroundColor: Colors.gray100 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  pillOnText: { color: Colors.green700 },
  pillOffText: { color: Colors.gray600 },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 520, maxHeight: '86%', backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 18, gap: 14 },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex1: { flex: 1, minWidth: 0 },
  dialogName: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  dialogMeta: { fontSize: 12.5, color: Colors.mutedForeground, marginTop: 2 },
  metricRow: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, backgroundColor: Colors.gray50, borderRadius: Radius.md },
  metricValue: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  metricLabel: { fontSize: 10.5, color: Colors.mutedForeground },
  sectionLabel: { fontSize: 11.5, fontWeight: '800', color: Colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  dialogList: { maxHeight: 240 },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 8, borderRadius: Radius.md },
  assignName: { fontSize: 13.5, fontWeight: '700', color: Colors.foreground },
  assignMeta: { fontSize: 11.5, color: Colors.mutedForeground, marginTop: 1 },
});
