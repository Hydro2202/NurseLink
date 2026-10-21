import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius } from '../../constants/colors';
import type { Task, TaskType, VitalsMonitoringOrder } from '../../types/domain';
import { formatDateTime12 } from '../../utils/time';

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  procedure: 'Procedure',
  referral: 'Endorsement',
};

const TYPE_COLORS: Record<TaskType, { bg: string; fg: string }> = {
  procedure: { bg: Colors.teal50, fg: Colors.teal700 },
  referral: { bg: Colors.indigo50, fg: Colors.indigo600 },
};

/** The four labels a nurse sees for a task's status, one per stored value. */
export const TASK_STATUS_LABELS: Record<Task['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  overdue: 'Not yet completed',
  completed: 'Completed',
};

const STATUS_COLORS: Record<Task['status'], { bg: string; fg: string }> = {
  pending: { bg: Colors.orange50, fg: Colors.orange700 },
  in_progress: { bg: Colors.blue50, fg: Colors.blue700 },
  overdue: { bg: Colors.red50, fg: Colors.red700 },
  completed: { bg: Colors.green50, fg: Colors.green700 },
};

export function TaskTypeBadge({ type }: { type?: TaskType }) {
  const key: TaskType = type === 'referral' ? 'referral' : 'procedure';
  const c = TYPE_COLORS[key];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{TASK_TYPE_LABELS[key]}</Text>
    </View>
  );
}

export function TaskStatusBadge({ status }: { status: Task['status'] }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{TASK_STATUS_LABELS[status] || status}</Text>
    </View>
  );
}

/** "Oct 20, 2026, 10:00 PM" — the shared 12-hour format (utils/time). */
export function formatDateTime(iso?: string | null): string {
  return formatDateTime12(iso);
}

export const VITALS_MONITORING_ORDER_LABELS: Record<VitalsMonitoringOrder, string> = {
  every_1h: 'Every 1 hour',
  every_2h: 'Every 2 hours',
  every_4h: 'Every 4 hours',
  prn: 'As needed (PRN)',
  not_specified: 'Not specified',
};

/** "Every 2 hours" / "As needed (PRN)" / "Not specified" for a Vital Signs
 * Check task card or modal — see Task.vitalsMonitoringOrder. */
export function vitalsMonitoringOrderLabel(order?: VitalsMonitoringOrder | null): string {
  return VITALS_MONITORING_ORDER_LABELS[order || 'not_specified'];
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },
});
