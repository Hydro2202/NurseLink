import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { AlertCircle, CheckCircle, Info, X, ArrowRight } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../constants/colors';
import { useNotifications } from '../contexts/NotificationsContext';
import { resolveNotificationAction } from './NotificationPanel';
import type { AppNotification } from '../types/domain';

const STYLE_BY_TYPE: Record<
  AppNotification['type'],
  { icon: typeof AlertCircle; color: string; bg: string; border: string }
> = {
  critical: { icon: AlertCircle, color: Colors.destructive, bg: Colors.destructiveLight, border: Colors.destructive },
  warning: { icon: AlertCircle, color: Colors.warning, bg: Colors.warningLight, border: Colors.warning },
  info: { icon: Info, color: Colors.primary, bg: Colors.infoLight, border: Colors.primary },
  success: { icon: CheckCircle, color: Colors.success, bg: Colors.successLight, border: Colors.success },
};

function formatTime(notification: AppNotification): string {
  if (!notification.createdAt) return notification.time;
  const parsed = new Date(notification.createdAt);
  if (Number.isNaN(parsed.getTime())) return notification.time;
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface NotificationToastCardProps {
  notification: AppNotification;
}

/** One popup card in NotificationToastHost's stack. Tapping the card body or
 * its action button both open the action path and mark it read; the X just
 * dismisses. See the item-2 spec in FIX_PROMPT_2.md for the full behaviour
 * this and NotificationToastHost implement together. */
export function NotificationToastCard({ notification }: NotificationToastCardProps) {
  const router = useRouter();
  const { markRead, dismissToast } = useNotifications();
  const { icon: Icon, color, bg, border } = STYLE_BY_TYPE[notification.type] ?? STYLE_BY_TYPE.info;

  const act = () => {
    // markRead (NotificationsContext) already dismisses the toast as a side
    // effect, so this never double-dismisses.
    if (!notification.isRead) void markRead(notification.id);
    else dismissToast(notification.id);
    if (!notification.action) return;
    const { href, params } = resolveNotificationAction(notification.action.path, notification.action.highlightId);
    if (Object.keys(params).length) {
      router.push({ pathname: href as any, params });
    } else {
      router.push(href as any);
    }
  };

  return (
    <Pressable
      onPress={act}
      style={[styles.card, Shadows.lg, { backgroundColor: bg, borderLeftColor: border }]}
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}. ${notification.message}`}
    >
      <View style={styles.iconWrap}>
        <Icon size={20} color={color} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{notification.title}</Text>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              dismissToast(notification.id);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <X size={16} color={Colors.mutedForeground} />
          </Pressable>
        </View>
        <Text style={styles.message} numberOfLines={3}>{notification.message}</Text>
        {notification.patient ? (
          <Text style={styles.patient} numberOfLines={1}>{notification.patient}</Text>
        ) : null}
        <View style={styles.footerRow}>
          <Text style={styles.time}>{formatTime(notification)}</Text>
          {notification.action ? (
            <Pressable onPress={act} style={styles.actionBtn} accessibilityRole="button">
              <Text style={[styles.actionText, { color }]}>{notification.action.label}</Text>
              <ArrowRight size={12} color={color} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: Radius.lg,
    borderLeftWidth: 4,
    width: '100%',
  },
  iconWrap: { marginTop: 1 },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 13.5, fontWeight: '700', color: Colors.foreground, flex: 1 },
  message: { fontSize: 12.5, color: Colors.foreground, marginTop: 2, lineHeight: 17 },
  patient: { fontSize: 11.5, color: Colors.mutedForeground, marginTop: 3, fontWeight: '600' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  time: { fontSize: 10.5, color: Colors.mutedForeground },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actionText: { fontSize: 11.5, fontWeight: '700' },
});
