import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell, User, ArrowRight } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { Button } from './Button';
import { useNotifications } from '../contexts/NotificationsContext';
import { fetchHandover } from '../services/api';
import type { AppNotification, HandoverNote } from '../types/domain';
import { formatShortDateTime12 } from '../utils/time';

/**
 * The popup a nurse sees when a pending referral they're involved in is
 * almost due or overdue (see api/notifications.py's REFERRAL_ALMOST_DUE/
 * REFERRAL_OVERDUE events and check_due_referral_reminders). Almost-due
 * only ever reaches the receiver; overdue reaches both the receiver and
 * the sender — this one modal handles either, same as the backend sends
 * either to whoever is signed in.
 *
 * Same shape/lifecycle as HandoverAlertModal and TaskDueAlertModal: driven
 * by the notification list, dismiss marks it read.
 */

const REFERRAL_DUE_EVENTS = new Set(['referral_almost_due', 'referral_overdue']);

function formatDueAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatShortDateTime12(d);
}

export function ReferralDueAlertModal() {
  const router = useRouter();
  const { notifications, markRead } = useNotifications();
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const [handover, setHandover] = useState<HandoverNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  const [handled, setHandled] = useState<Set<string>>(() => new Set());

  const pending = notifications.filter(
    (item) => REFERRAL_DUE_EVENTS.has(item.event || '') && !item.isRead && !handled.has(item.id)
  );
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

  useEffect(() => {
    const handoverId = current?.handoverId || current?.action?.highlightId;
    if (!handoverId) {
      (() => setHandover(null))();
      return;
    }
    let cancelled = false;
    (() => setLoading(true))();
    fetchHandover(handoverId)
      .then((result) => {
        if (!cancelled) setHandover(result);
      })
      .catch(() => {
        if (!cancelled) setHandover(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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

  const viewReferral = () => {
    const handoverId = current.handoverId || current.action?.highlightId;
    void markRead(current.id);
    close();
    router.push({
      pathname: '/(app)/handover' as any,
      params: handoverId ? { highlightId: handoverId } : undefined,
    });
  };

  const isOverdue = current.event === 'referral_overdue';
  const patientCount = handover?.patients?.length ?? 0;
  const patientLabel =
    patientCount > 1
      ? `${patientCount} patients`
      : handover?.patientName || current.patient || 'a patient';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.dialog, Shadows.xl, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <View style={[styles.bellCircle, { backgroundColor: isOverdue ? Colors.red600 : Colors.orange600 }]}>
              <Bell size={22} color={Colors.white} />
            </View>
            <Text style={styles.title}>{isOverdue ? 'Endorsement Overdue' : 'Endorsement Almost Due'}</Text>
          </View>

          <Text style={styles.lead}>{current.message || 'An endorsement needs your attention.'}</Text>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={Colors.blue600} />
            </View>
          ) : (
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Patient</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{patientLabel}</Text>
              </View>
              {handover?.nurseFrom ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>From</Text>
                  <View style={styles.senderRow}>
                    <User size={13} color={Colors.mutedForeground} />
                    <Text style={styles.detailValue}>{handover.nurseFrom}</Text>
                  </View>
                </View>
              ) : null}
              {handover?.dueAt ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Due</Text>
                  <Text style={[styles.detailValue, isOverdue ? { color: Colors.red600 } : null]}>
                    {formatDueAt(handover.dueAt)}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.footer}>
            <Button variant="outline" onPress={dismiss} style={styles.footerBtn}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </Button>
            <Button onPress={viewReferral} style={styles.footerBtn}>
              <View style={styles.primaryInner}>
                <Text style={styles.primaryText}>Open Endorsement</Text>
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
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
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
