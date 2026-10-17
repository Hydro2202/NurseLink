import React from 'react';
import { View, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '../contexts/NotificationsContext';
import { NotificationToastCard } from './NotificationToastCard';

/**
 * The stack of popup cards for notifications that arrived while this nurse
 * had the app open (see NotificationsContext's push handler, the one place
 * that decides what counts as "new" — never the backlog from before login).
 *
 * Mounted once in every (app) layout branch (mobile staff, mobile head
 * nurse, mobile admin, desktop/tablet) — same placement as HandoverAlertModal
 * and the due-reminder popups just above it in each of those files.
 */
export function NotificationToastHost() {
  const { toasts } = useNotifications();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = Platform.OS === 'web' && width >= 1024;

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.root,
        isDesktop
          ? { top: insets.top + 12, right: 16, width: 360 }
          : { top: insets.top + 8, left: 12, right: 12 },
      ]}
    >
      {toasts.map((notification) => (
        <View key={notification.id} style={styles.item}>
          <NotificationToastCard notification={notification} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    zIndex: 1000,
    gap: 8,
  },
  item: {
    width: '100%',
  },
});
