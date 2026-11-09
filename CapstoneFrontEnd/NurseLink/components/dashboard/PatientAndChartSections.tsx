import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { HeartPulse, ArrowRight, BarChart3 } from 'lucide-react-native';
import { BarChart } from '../Charts';
import { Card, CardContent } from '../Card';
import { Colors, Radius } from '../../constants/colors';
import type { Patient, Task } from '../../types/domain';

const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: 'admitted', label: 'Admitted', color: Colors.blue600 },
  { key: 'observation', label: 'Observation', color: Colors.warning },
  { key: 'discharged', label: 'Discharged', color: Colors.green600 },
];

/**
 * Patient Overview: live counts (total / assigned / unassigned) that open
 * All Patients, plus the current admitted/observation/discharged split. All
 * from the real patient list.
 */
export function PatientOverviewSection({
  patients,
  onOpenPatients,
}: {
  patients: Patient[];
  onOpenPatients: () => void;
}) {
  const stats = useMemo(() => {
    const active = patients.filter((p) => p.status !== 'discharged');
    const assigned = active.filter((p) => p.assignedNurseName?.trim()).length;
    const byStatus = STATUS_META.map((s) => ({ ...s, count: patients.filter((p) => (p.status || 'admitted') === s.key).length }));
    const total = active.length;
    return { total, assigned, unassigned: total - assigned, byStatus, max: Math.max(1, ...byStatus.map((b) => b.count)) };
  }, [patients]);

  const tile = (label: string, value: number, color: string) => (
    <Pressable onPress={onOpenPatients} style={({ pressed }) => [styles.tile, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={[styles.tileValue, { color }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <Card>
      <CardContent style={styles.body}>
        <View style={styles.header}>
          <HeartPulse size={18} color={Colors.blue600} />
          <Text style={styles.title}>Patient Overview</Text>
          <Pressable onPress={onOpenPatients} style={styles.link} hitSlop={6} accessibilityRole="button">
            <Text style={styles.linkText}>All patients</Text>
            <ArrowRight size={13} color={Colors.blue600} />
          </Pressable>
        </View>
        <View style={styles.tiles}>
          {tile('Active patients', stats.total, Colors.foreground)}
          {tile('Assigned', stats.assigned, Colors.green600)}
          {tile('Unassigned', stats.unassigned, stats.unassigned > 0 ? Colors.red600 : Colors.foreground)}
        </View>
        <View style={styles.distList}>
          {stats.byStatus.map((s) => (
            <View key={s.key} style={styles.distRow}>
              <Text style={styles.distLabel}>{s.label}</Text>
              <View style={styles.distTrack}>
                <View style={[styles.distFill, { width: `${(s.count / stats.max) * 100}%`, backgroundColor: s.color }]} />
              </View>
              <Text style={styles.distCount}>{s.count}</Text>
            </View>
          ))}
        </View>
      </CardContent>
    </Card>
  );
}

type Timeframe = 'today' | 'week' | 'month';

function inTimeframe(dateIso: string | null | undefined, tf: Timeframe, now: Date): boolean {
  if (!dateIso) return false;
  const d = new Date(dateIso + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (tf === 'today') {
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return d >= start && d < end;
  }
  if (tf === 'week') start.setDate(start.getDate() - 6);
  else start.setDate(start.getDate() - 29);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return d >= start && d <= end;
}

/**
 * Task load chart with Today / This Week / This Month filters that really
 * change the data — tasks are bucketed by their due date within the chosen
 * window, by status. Uses the already-loaded task list.
 */
export function TaskLoadChart({ tasks, now, width }: { tasks: Task[]; now: Date; width: number }) {
  const [tf, setTf] = useState<Timeframe>('today');

  const data = useMemo(() => {
    const scoped = tasks.filter((t) => inTimeframe(t.dueDate, tf, now));
    const count = (s: string) => scoped.filter((t) => t.status === s).length;
    return [
      { value: count('pending'), label: 'Pending', frontColor: Colors.mutedForeground },
      { value: count('in_progress'), label: 'Active', frontColor: Colors.warning },
      { value: count('overdue'), label: 'Overdue', frontColor: Colors.destructive },
      { value: count('completed'), label: 'Done', frontColor: Colors.success },
    ];
  }, [tasks, tf, now]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const maxValue = Math.max(4, ...data.map((d) => d.value));

  const tab = (key: Timeframe, label: string) => (
    <Pressable key={key} onPress={() => setTf(key)} style={[styles.tfTab, tf === key && styles.tfTabActive]} accessibilityRole="tab" accessibilityState={{ selected: tf === key }}>
      <Text style={[styles.tfText, tf === key && styles.tfTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <Card>
      <CardContent style={styles.body}>
        <View style={styles.header}>
          <BarChart3 size={18} color={Colors.blue600} />
          <Text style={styles.title}>Task Load</Text>
          <Text style={styles.subtle}>{total} due</Text>
        </View>
        <View style={styles.tfTabs}>
          {tab('today', 'Today')}
          {tab('week', 'This Week')}
          {tab('month', 'This Month')}
        </View>
        {total === 0 ? (
          <Text style={styles.empty}>No tasks due in this period.</Text>
        ) : (
          <BarChart
            data={data}
            width={Math.max(width - 80, 240)}
            height={150}
            barWidth={28}
            spacing={Math.max((Math.max(width - 80, 240) - 28 * 4) / 4, 14)}
            initialSpacing={14}
            roundedTop
            noOfSections={4}
            maxValue={Math.ceil(maxValue / 4) * 4}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={Colors.border}
            rulesColor={Colors.gray100}
            yAxisTextStyle={styles.axis}
            xAxisLabelTextStyle={styles.axis}
          />
        )}
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: Colors.foreground, flex: 1 },
  subtle: { fontSize: 12, color: Colors.mutedForeground, fontWeight: '600' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  linkText: { fontSize: 12.5, fontWeight: '700', color: Colors.blue600 },
  empty: { fontSize: 13, color: Colors.mutedForeground, paddingVertical: 16, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: Colors.gray50, borderRadius: Radius.md },
  pressed: { opacity: 0.7 },
  tileValue: { fontSize: 22, fontWeight: '800' },
  tileLabel: { fontSize: 11, color: Colors.mutedForeground, marginTop: 2 },
  distList: { gap: 8 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distLabel: { fontSize: 12, color: Colors.mutedForeground, width: 84 },
  distTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.gray100, overflow: 'hidden' },
  distFill: { height: 8, borderRadius: 4 },
  distCount: { fontSize: 12.5, fontWeight: '700', color: Colors.foreground, width: 28, textAlign: 'right' },
  tfTabs: { flexDirection: 'row', backgroundColor: Colors.gray100, borderRadius: 10, padding: 4, gap: 4 },
  tfTab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8 },
  tfTabActive: { backgroundColor: Colors.white },
  tfText: { fontSize: 12.5, fontWeight: '600', color: Colors.mutedForeground },
  tfTextActive: { color: Colors.blue700, fontWeight: '800' },
  axis: { fontSize: 10, color: Colors.mutedForeground },
});
