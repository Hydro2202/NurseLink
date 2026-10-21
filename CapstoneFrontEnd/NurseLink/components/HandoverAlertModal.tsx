import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, User, ArrowRight } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { useNotifications } from '../contexts/NotificationsContext';
import type { AppNotification } from '../types/domain';
import { formatClock } from '../utils/time';

/**
 * The popup a nurse sees when a patient is handed over to them.
 *
 * Becoming responsible for a patient you have not seen is the one event in this
 * app that should not wait until somebody happens to open the bell menu, so it
 * interrupts. Everything else stays in the notification centre.
 *
 * It is driven entirely by the notification list, which the live layer keeps
 * current — so the popup appears without a refresh while the nurse is signed
 * in, and equally appears on next sign-in for a handover that arrived while
 * they were away. There is no separate delivery path and nothing local
 * fabricates it: no popup exists that the database does not.
 *
 * Showing it is deliberately kept distinct from marking it read. Dismiss marks
 * it read, which is what stops it returning. A nurse who closes the app without
 * dismissing will see it again, because they still have not acknowledged that
 * the patient is theirs.
 */

const HANDOVER_RECEIVED = 'handover_received';

function formatTime(notification: AppNotification): string {
  if (!notification.createdAt) return notification.time;
  const parsed = new Date(notification.createdAt);
  if (Number.isNaN(parsed.getTime())) return notification.time;
  return formatClock(parsed);
}

export function HandoverAlertModal() {
  const router = useRouter();
  const { notifications, markRead } = useNotifications();
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  // Handovers dealt with on this device. Marking one read is what really
  // retires it, but the server round-trip takes a moment and the list can
  // refresh in between — without this the popup can flash back.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());

  const pending = notifications.filter(
    (item) => item.event === HANDOVER_RECEIVED && !item.isRead && !handled.has(item.id)
  );
  // Oldest first: a nurse returning to several handovers works through them in
  // the order they arrived rather than backwards.
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
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [current, fadeAnim]);

  if (!current) return null;

  const close = () => {
    setHandled((prev) => {
      const next = new Set(prev);
      next.add(current.id);
      return next;
    });
    setCurrent(null);
  };

  const dismiss = () => {
    // Read, not deleted: the handover itself and this entry both stay in the
    // notification centre and in the nurse's handover list.
    void markRead(current.id);
    close();
  };

  const viewHandover = () => {
    const { handoverId, patientId } = current;
    void markRead(current.id);
    close();

    if (handoverId) {
      router.push({
        pathname: '/(app)/handover' as any,
        params: { highlightId: handoverId },
      });
      return;
    }
    // Nothing to open on the handover side; fall back to the patient record.
    if (patientId) {
      router.push({
        pathname: '/(app)/my-patients' as any,
        params: { viewPatient: patientId },
      });
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.dialog, Shadows.xl, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <View style={styles.bellCircle}>
              <Bell size={22} color={Colors.white} />
            </View>
            <Text style={styles.title}>New Patient Endorsement</Text>
          </View>

          <Text style={styles.lead}>A patient has been endorsed to you.</Text>

          <View style={styles.details}>
            {current.patient ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Patient</Text>
                <Text style={styles.detailValue}>{current.patient}</Text>
              </View>
            ) : null}
            {current.senderName ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>From</Text>
                <View style={styles.senderRow}>
                  <User size={13} color={Colors.mutedForeground} />
                  <Text style={styles.detailValue}>{current.senderName}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Time</Text>
              <Text style={styles.detailValue}>{formatTime(current)}</Text>
            </View>
          </View>

          <Text style={styles.hint}>{"Please review the patient's information."}</Text>

          <View style={styles.footer}>
            <Button variant="outline" onPress={dismiss} style={styles.footerBtn}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </Button>
            <Button onPress={viewHandover} style={styles.footerBtn}>
              <View style={styles.primaryInner}>
                <Text style={styles.primaryText}>View Endorsement</Text>
                <ArrowRight size={14} color={Colors.white} />
              </View>
            </Button>
          </View>

          {pending.length > 1 ? (
            <Text style={styles.queue}>
              {pending.length - 1} more endorsement{pending.length - 1 > 1 ? 's' : ''} waiting
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
    backgroundColor: Colors.blue600,
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
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  hint: {
    fontSize: 13,
    color: Colors.mutedForeground,
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
