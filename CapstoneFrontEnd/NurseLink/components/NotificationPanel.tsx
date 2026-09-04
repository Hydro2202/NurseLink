import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, AlertCircle, CheckCircle, Info, Clock, ArrowRight } from 'lucide-react-native';
import { Badge } from './Badge';
import { Button } from './Button';
import { useToast } from '../contexts/ToastContext';
import { Colors, Shadows, Radius } from '../constants/colors';
import { ApiError } from '../services/api';
import { useNotifications } from '../contexts/NotificationsContext';
import type { AppNotification } from '../types/domain';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PANEL_WIDTH = Math.min(Dimensions.get('window').width, 384);

/**
 * Turn a stored action path into a route inside the (app) group.
 *
 * Notifications store plain paths like "/tasks". The leading group segment is
 * added here — and stripped first if it is already present, because a path that
 * arrives as "/(app)/tasks" would otherwise become "/(app)/(app)/tasks" and
 * land the nurse on Unmatched Route.
 */
function mapAppPath(path: string): string {
  let clean = path.startsWith('/') ? path.slice(1) : path;
  if (clean.startsWith('(app)/')) clean = clean.slice('(app)/'.length);
  return `/(app)/${clean}`;
}

export function NotificationPanel({ isOpen, onClose }: NotificationPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(PANEL_WIDTH)).current;
  const [visible, setVisible] = useState(false);

  const { notifications, unreadCount, refresh, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      slideAnim.setValue(PANEL_WIDTH);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
      void refresh();
      return;
    }

    Animated.timing(slideAnim, {
      toValue: PANEL_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [isOpen, slideAnim, refresh]);

  const handleActionClick = (notification: AppNotification) => {
    const action = notification.action!;
    // Acting on a notification is the clearest possible signal it has been
    // seen, so drop it out of the unread count instead of leaving the badge
    // stuck until the nurse remembers to clear the whole inbox.
    if (!notification.isRead) void markRead(notification.id);
    onClose();
    const href = mapAppPath(action.path);
    if (action.highlightId) {
      router.push({ pathname: href as any, params: { highlightId: action.highlightId } });
    } else {
      router.push(href as any);
    }
  };

  const handleMarkAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.isRead).length;

    if (unread === 0) {
      toast.info('All notifications are already marked as read');
      return;
    }

    try {
      await markAllRead();
      toast.success('All notifications marked as read', {
        description: `${unread} notification${unread > 1 ? 's' : ''} marked as read`,
      });
    } catch (error) {
      toast.error('Failed to update notifications', {
        description: error instanceof ApiError ? error.message : 'Please try again.',
      });
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical':
        return <AlertCircle size={20} color={Colors.destructive} />;
      case 'warning':
        return <AlertCircle size={20} color={Colors.warning} />;
      case 'success':
        return <CheckCircle size={20} color={Colors.success} />;
      default:
        return <Info size={20} color={Colors.primary} />;
    }
  };

  const getBadgeVariant = (
    type: string
  ): 'destructive' | 'warning' | 'success' | 'info' => {
    switch (type) {
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'warning';
      case 'success':
        return 'success';
      default:
        return 'info';
    }
  };

  const getBackgroundStyle = (type: string) => {
    switch (type) {
      case 'critical':
        return {
          backgroundColor: Colors.destructiveLight,
          borderLeftColor: Colors.destructive,
        };
      case 'warning':
        return {
          backgroundColor: Colors.warningLight,
          borderLeftColor: Colors.warning,
        };
      case 'success':
        return {
          backgroundColor: Colors.successLight,
          borderLeftColor: Colors.success,
        };
      default:
        return {
          backgroundColor: Colors.infoLight,
          borderLeftColor: Colors.primary,
        };
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <Animated.View
          style={[
            styles.panel,
            {
              width: PANEL_WIDTH,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
            Shadows.xl,
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Notifications</Text>
              {unreadCount > 0 ? (
                <Badge variant="secondary" style={styles.countBadge}>
                  {unreadCount}
                </Badge>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
              accessibilityLabel="Close notifications"
            >
              <X size={20} color={Colors.white} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {notifications.length === 0 ? (
              <View style={styles.empty}>
                <CheckCircle size={48} color={Colors.muted} />
                <Text style={styles.emptyTitle}>No new notifications</Text>
                <Text style={styles.emptyDesc}>You're all caught up!</Text>
              </View>
            ) : (
              notifications.map((notification) => (
                <View
                  key={notification.id}
                  style={[styles.item, getBackgroundStyle(notification.type)]}
                >
                  <View style={styles.itemRow}>
                    <View style={styles.iconWrap}>{getIcon(notification.type)}</View>
                    <View style={styles.itemBody}>
                      <View style={styles.itemHeader}>
                        <Text style={styles.itemTitle} numberOfLines={2}>
                          {notification.title}
                        </Text>
                        <Badge
                          variant={getBadgeVariant(notification.type)}
                          textStyle={styles.typeBadgeText}
                        >
                          {notification.type.toUpperCase()}
                        </Badge>
                      </View>
                      <Text style={styles.itemMessage}>{notification.message}</Text>
                      {notification.patient ? (
                        <Text style={styles.patient}>Patient: {notification.patient}</Text>
                      ) : null}
                      <View style={styles.itemFooter}>
                        <View style={styles.timeRow}>
                          <Clock size={12} color={Colors.mutedForeground} />
                          <Text style={styles.time}>{notification.time}</Text>
                        </View>
                        {notification.action ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onPress={() => handleActionClick(notification)}
                            style={styles.actionBtn}
                            textStyle={styles.actionBtnText}
                          >
                            <View style={styles.actionInner}>
                              <Text style={styles.actionBtnText}>{notification.action.label}</Text>
                              <ArrowRight size={12} color={Colors.foreground} />
                            </View>
                          </Button>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="outline" onPress={handleMarkAllAsRead} style={styles.markAll}>
              Mark All as Read
            </Button>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  panel: {
    height: '100%',
    backgroundColor: Colors.card,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: -4, height: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.primary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.white,
  },
  countBadge: {
    marginLeft: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnPressed: {
    backgroundColor: Colors.primaryHover,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.mutedForeground,
  },
  emptyDesc: {
    fontSize: 13,
    color: Colors.mutedForeground,
  },
  item: {
    padding: 16,
    borderRadius: Radius.lg,
    borderLeftWidth: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    marginTop: 2,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
  },
  typeBadgeText: {
    fontSize: 10,
  },
  itemMessage: {
    fontSize: 13,
    color: Colors.mutedForeground,
    marginBottom: 8,
    lineHeight: 18,
  },
  patient: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.mutedForeground,
    marginBottom: 8,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  time: {
    fontSize: 12,
    color: Colors.mutedForeground,
  },
  actionBtn: {
    height: 28,
    paddingHorizontal: 10,
  },
  actionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    color: Colors.foreground,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.muted,
  },
  markAll: {
    width: '100%',
  },
});
