import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { CalendarClock, ArrowRight, Activity, UserPlus, LogIn, LogOut, Sun, Moon, Sunset } from 'lucide-react-native';
import { Card, CardContent } from '../Card';
import { Colors, Radius } from '../../constants/colors';
import type { DutyAssignment } from '../../types/domain';
import type { PatientAssignment } from '../../types';

function timeAgo(d: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SHIFT_ICON: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  morning: Sun, afternoon: Sunset, night: Moon,
};

// Dashboard list cards show a few rows and scroll inside the card for the
// rest, so the page itself never grows with the data.
const VISIBLE_ROWS = 5;
const ROW_HEIGHT = 60;

/**
 * Today's duty schedule at a glance — real DutyAssignment rows for today,
 * each showing the nurse, shift and department, with a link to the full
 * Duty Roster. Clocked-in shifts are flagged live.
 */
export function DutyRosterSummary({
  duty,
  onOpenRoster,
}: {
  duty: DutyAssignment[];
  onOpenRoster: () => void;
}) {
  const rows = useMemo(
    () =>
      duty
        .filter((d) => d.status !== 'cancelled')
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.nurseName.localeCompare(b.nurseName)),
    [duty]
  );

  return (
    <Card>
      <CardContent style={styles.body}>
        <View style={styles.header}>
          <CalendarClock size={18} color={Colors.blue600} />
          <Text style={styles.title}>Duty Roster — Today</Text>
          <Pressable onPress={onOpenRoster} style={styles.link} hitSlop={6} accessibilityRole="button">
            <Text style={styles.linkText}>Full roster</Text>
            <ArrowRight size={13} color={Colors.blue600} />
          </Pressable>
        </View>
        {rows.length === 0 ? (
          <Text style={styles.empty}>No duty scheduled for today.</Text>
        ) : (
          <ScrollView
            style={rows.length > VISIBLE_ROWS ? { maxHeight: VISIBLE_ROWS * ROW_HEIGHT } : undefined}
            contentContainerStyle={styles.list}
            nestedScrollEnabled
            showsVerticalScrollIndicator={rows.length > VISIBLE_ROWS}
          >
            {rows.map((d) => {
              const Icon = SHIFT_ICON[d.shift] || CalendarClock;
              const live = !!d.actualStartTime && !d.actualEndTime;
              return (
                <Pressable
                  key={d.id}
                  onPress={onOpenRoster}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                >
                  <View style={styles.shiftIcon}>
                    <Icon size={15} color={Colors.blue700} />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.rowName} numberOfLines={1}>{d.nurseName}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {d.shiftLabel} · {d.startTime.slice(0, 5)}–{d.endTime.slice(0, 5)} · {d.departmentName || 'No department'}
                    </Text>
                  </View>
                  {live ? (
                    <View style={styles.livePill}>
                      <View style={styles.liveDot} />
                      <Text style={styles.livePillText}>Live</Text>
                    </View>
                  ) : (
                    <Text style={styles.statusText}>{d.statusLabel}</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </CardContent>
    </Card>
  );
}

type ActivityItem = { id: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; text: string; at: Date };

/**
 * Recent Activities, built only from real dated records: patient
 * assignments (assignedAt) and duty clock-in/clock-out (actualStart/EndTime).
 * No synthetic events — every row has a real timestamp from the backend.
 */
export function RecentActivitySection({
  assignments,
  duty,
  now,
}: {
  assignments: PatientAssignment[];
  duty: DutyAssignment[];
  now: Date;
}) {
  const items = useMemo<ActivityItem[]>(() => {
    const list: ActivityItem[] = [];
    for (const a of assignments) {
      if (!a.assignedAt) continue;
      list.push({
        id: `assign-${a.id}`,
        icon: UserPlus,
        color: Colors.blue600,
        text: `${a.assignedNurse || 'A nurse'} was assigned to ${a.patientName}`,
        at: a.assignedAt instanceof Date ? a.assignedAt : new Date(a.assignedAt),
      });
    }
    for (const d of duty) {
      if (d.actualEndTime) {
        list.push({ id: `end-${d.id}`, icon: LogOut, color: Colors.gray600, text: `${d.nurseName} ended their ${d.shiftLabel} shift`, at: new Date(d.actualEndTime) });
      }
      if (d.actualStartTime) {
        list.push({ id: `start-${d.id}`, icon: LogIn, color: Colors.green600, text: `${d.nurseName} started their ${d.shiftLabel} shift`, at: new Date(d.actualStartTime) });
      }
    }
    return list
      .filter((i) => !isNaN(i.at.getTime()))
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 20);
  }, [assignments, duty]);

  return (
    <Card>
      <CardContent style={styles.body}>
        <View style={styles.header}>
          <Activity size={18} color={Colors.blue600} />
          <Text style={styles.title}>Recent Activity</Text>
        </View>
        {items.length === 0 ? (
          <Text style={styles.empty}>No recent activity yet.</Text>
        ) : (
          <ScrollView
            style={items.length > VISIBLE_ROWS ? { maxHeight: VISIBLE_ROWS * ROW_HEIGHT } : undefined}
            contentContainerStyle={styles.list}
            nestedScrollEnabled
            showsVerticalScrollIndicator={items.length > VISIBLE_ROWS}
          >
            {items.map((i) => {
              const Icon = i.icon;
              return (
                <View key={i.id} style={styles.activityRow}>
                  <View style={[styles.activityIcon, { backgroundColor: Colors.gray50 }]}>
                    <Icon size={14} color={i.color} />
                  </View>
                  <Text style={styles.activityText}>{i.text}</Text>
                  <Text style={styles.activityTime}>{timeAgo(i.at, now)}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: Colors.foreground, flex: 1 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  linkText: { fontSize: 12.5, fontWeight: '700', color: Colors.blue600 },
  empty: { fontSize: 13, color: Colors.mutedForeground, paddingVertical: 10, textAlign: 'center' },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: Radius.md },
  rowPressed: { backgroundColor: Colors.gray50 },
  shiftIcon: { width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.blue50, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  rowMeta: { fontSize: 12, color: Colors.mutedForeground, marginTop: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.green50, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.green600 },
  livePillText: { fontSize: 11, fontWeight: '800', color: Colors.green700 },
  statusText: { fontSize: 11.5, fontWeight: '600', color: Colors.mutedForeground },

  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activityIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  activityText: { flex: 1, fontSize: 12.5, color: Colors.foreground },
  activityTime: { fontSize: 11, color: Colors.mutedForeground },
});
