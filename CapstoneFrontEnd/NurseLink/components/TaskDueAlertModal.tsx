import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, Bed, ArrowRight } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { useNotifications } from '../contexts/NotificationsContext';
import { fetchTask } from '../services/api';
import type { AppNotification, Task } from '../types/domain';
import { formatDueDateTime as formatDueDateTimeLabel } from '../utils/time';

/**
 * The popup a nurse sees when one of their own tasks is due soon or due now
 * (see api/notifications.py's TASK_DUE_SOON/TASK_DUE events and
 * check_due_task_reminders, which raises them off the live poll).
 *
 * Same shape as HandoverAlertModal: driven entirely by the notification
 * list, so it appears live while signed in and again on next sign-in for
 * one that arrived while away. Dismiss marks it read, which is what stops
 * it returning — closing the app without dismissing shows it again, since
 * the task is still due.
 */

const TASK_DUE_EVENTS = new Set(['task_due_soon', 'task_due']);

const RISK_COLORS: Record<string, string> = {
  high: Colors.red600,
  medium: Colors.orange600,
  low: Colors.green600,
};

function formatDueDateTime(task: Task): string {
  return formatDueDateTimeLabel(task.dueDate, task.dueTime);
}

export function TaskDueAlertModal() {
  const router = useRouter();
  const { notifications, markRead } = useNotifications();
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  // Dealt with on this device — same reasoning as HandoverAlertModal's
  // `handled`: marking one read is what really retires it, but the round
  // trip takes a moment and the list can refresh in between.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());

  const pending = notifications.filter(
    (item) => TASK_DUE_EVENTS.has(item.event || '') && !item.isRead && !handled.has(item.id)
  );
  // Oldest first — same ordering HandoverAlertModal uses.
  const next = pending.length > 0 ? pending[pending.length - 1] : null;

  useEffect(() => {
    (() => {
      if (current === null && next !== null) {
        setCurrent(next);
      }
    })();
  }, [current, next]);

  useEffect(() => {
    if (!current) return;
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [current, fadeAnim]);

  // Fetch the full task once a notification is showing — the notification
  // itself carries only title/message text, not room or risk level.
  useEffect(() => {
    if (!current || !current.action?.highlightId) {
      (() => setTask(null))();
      return;
    }
    const taskId = current.action.highlightId;
    let cancelled = false;
    (() => setTaskLoading(true))();
    fetchTask(taskId)
      .then((result) => {
        if (!cancelled) setTask(result);
      })
      .catch(() => {
        if (!cancelled) setTask(null);
      })
      .finally(() => {
        if (!cancelled) setTaskLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  if (!current) return null;

  const close = () => {
    setHandled((prev) => new Set(prev).add(current.id));
    setCurrent(null);
  };

  const dismiss = () => {
    void markRead(current.id);
    close();
  };

  // A scheduled vital signs check (action path /tasks?openVitals=1) opens
  // straight into that task's Vital Signs Check-ins.
  const isVitalsCheck = (current.action?.path || '').includes('openVitals=1');

  const openTask = () => {
    const taskId = current.action?.highlightId;
    void markRead(current.id);
    close();
    router.push({
      pathname: '/(app)/tasks' as any,
      params: taskId ? { highlightId: taskId, ...(isVitalsCheck ? { openVitals: '1' } : {}) } : undefined,
    });
  };

  const isSoonEvent = current.event === 'task_due_soon';
  const riskColor = task ? RISK_COLORS[task.priority] || Colors.gray500 : Colors.gray500;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.dialog, Shadows.xl, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <View style={[styles.bellCircle, { backgroundColor: isSoonEvent ? Colors.orange600 : Colors.red600 }]}>
              <Bell size={22} color={Colors.white} />
            </View>
            <Text style={styles.title}>
              {isVitalsCheck ? current.title || 'Vital Signs Check Due' : isSoonEvent ? 'Task Due Soon' : 'Task Due Now'}
            </Text>
          </View>

          <Text style={styles.lead}>{current.message || 'One of your tasks needs attention.'}</Text>

          {taskLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={Colors.blue600} />
            </View>
          ) : task ? (
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Task</Text>
                <Text style={styles.detailValue} numberOfLines={2}>{task.title}</Text>
              </View>
              {task.patientName ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Patient</Text>
                  <View style={styles.inlineRow}>
                    {task.patientRoom ? <Bed size={13} color={Colors.mutedForeground} /> : null}
                    <Text style={styles.detailValue}>
                      {task.patientName}{task.patientRoom ? ` • ${task.patientRoom}` : ''}
                    </Text>
                  </View>
                </View>
              ) : null}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Risk Level</Text>
                <View style={styles.riskRow}>
                  <View style={[styles.riskDot, { backgroundColor: riskColor }]} />
                  <Text style={[styles.detailValue, { color: riskColor, textTransform: 'capitalize' }]}>
                    {task.priority}
                  </Text>
                </View>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Due</Text>
                <Text style={styles.detailValue}>{formatDueDateTime(task)}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.footer}>
            <Button variant="outline" onPress={dismiss} style={styles.footerBtn}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </Button>
            <Button onPress={openTask} style={styles.footerBtn}>
              <View style={styles.primaryInner}>
                <Text style={styles.primaryText}>{isVitalsCheck ? 'Record Vital Signs' : 'Open Task'}</Text>
                <ArrowRight size={14} color={Colors.white} />
              </View>
            </Button>
          </View>

          {pending.length > 1 ? (
            <Text style={styles.queue}>
              {pending.length - 1} more task{pending.length - 1 > 1 ? 's' : ''} waiting
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: 22,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bellCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: Colors.foreground,
  },
  lead: {
    fontSize: 14,
    color: Colors.foreground,
    lineHeight: 20,
  },
  loadingRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  details: {
    gap: 10,
    padding: 14,
    backgroundColor: Colors.muted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
    textAlign: 'right',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riskDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  footerBtn: {
    flex: 1,
  },
  dismissText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  primaryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },
  queue: {
    fontSize: 12,
    color: Colors.mutedForeground,
    textAlign: 'center',
  },
});
