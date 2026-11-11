import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, acknowledgeNotification } from '../services/api';
import type { AppNotification } from '../types/domain';
import { useAuth } from './AuthContext';
import { useLive, useLiveRefresh } from './LiveContext';
import { useRealtimeNotifications, type RealtimeNotification } from './RealtimeContext';
import { usePreferences } from './PreferencesContext';
import { playNotificationSound } from '../utils/notificationSound';
import { vibrateForNotification } from '../utils/notificationVibration';

/**
 * Keeps every nurse's inbox current without them having to reload anything.
 *
 * Notifications arrive from other people — a handover sent to you, a task a
 * head nurse just assigned — so the app cannot know about them from its own
 * actions. It asks the server on a short timer instead.
 *
 * The asking is done once for the whole app by LiveContext, which reports a
 * revision string for the inbox. This provider fetches the full list only when
 * that revision moves, so an idle nurse costs one tiny request every few
 * seconds rather than a full notification list.
 *
 * The unread badge is the exception: it rides along on every live poll, so the
 * bell updates even before the list behind it has been fetched.
 */


interface NotificationsContextType {
  notifications: AppNotification[];
  unreadCount: number;
  /** True only for the very first load, so the UI can avoid an empty flash. */
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
  /** Notifications new since this session started, for NotificationToastHost
   * — newest first, capped at TOAST_STACK_LIMIT. Never the unread backlog a
   * nurse already had waiting at login; only ones that arrived just now. */
  toasts: AppNotification[];
  dismissToast: (id: string) => void;
}

/** "Stack at most 3 cards; newer cards push older ones down" — a 4th pushes
 * the oldest off the stack entirely, not just lower in the pile. */
const TOAST_STACK_LIMIT = 3;
/** Critical toasts stay until dismissed; everything else clears itself. */
const TOAST_AUTO_HIDE_MS = 6000;
/** These events already interrupt with their own dedicated, richer popup
 * (HandoverAlertModal, TaskDueAlertModal, ReferralDueAlertModal, all
 * mounted alongside NotificationToastHost in every (app) layout) — the
 * generic toast skips them so a nurse never sees two popups for one event. */
const EVENTS_WITH_OWN_POPUP = new Set([
  'handover_received', 'task_due_soon', 'task_due', 'referral_almost_due', 'referral_overdue',
]);

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

const VALID_NOTIFICATION_TYPES = new Set(['critical', 'warning', 'info', 'success']);

/**
 * Shape a pushed event like a fetched notification.
 *
 * The socket sends what a popup needs immediately; the refetch that follows
 * replaces this with the server's own version. Both are the same row.
 */
export function toNotification(pushed: RealtimeNotification): AppNotification {
  return {
    id: pushed.id,
    // Previously hardcoded to 'warning' regardless of real severity, so a
    // pushed critical alert (urgent task, patient safety alert) rendered
    // and sounded like any other notification until the follow-up refetch
    // quietly fixed it a moment later. Falls back to 'warning' only if the
    // server ever sends something unrecognized.
    type: VALID_NOTIFICATION_TYPES.has(pushed.notificationType)
      ? (pushed.notificationType as AppNotification['type'])
      : 'warning',
    event: pushed.event,
    title: pushed.title,
    message: pushed.message,
    time: 'Just now',
    createdAt: pushed.createdAt,
    patient: pushed.patientName ?? undefined,
    patientId: pushed.patientId,
    handoverId: pushed.handoverId,
    senderName: pushed.senderName,
    isRead: false,
    // The notification's own action, when it has one — falls back to the
    // handover-review shortcut only for the one event type that has
    // historically always opened straight to Handover without the server
    // needing to say so explicitly.
    action: pushed.actionLabel && pushed.actionPath
      ? {
          label: pushed.actionLabel,
          path: pushed.actionPath,
          highlightId: pushed.actionHighlightId ?? undefined,
        }
      : pushed.handoverId
      ? {
          label: 'Review handover',
          path: '/handover',
          highlightId: pushed.handoverId,
        }
      : undefined,
  };
}

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { revisions } = useLive();
  const liveUnread = revisions.unreadCount;
  const { preferences } = usePreferences();
  const soundAlerts = preferences.soundAlerts;
  const vibrationAlerts = preferences.vibrationAlerts;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<AppNotification[]>([]);

  // Guards against overlapping polls on a slow connection, where a request can
  // still be in flight when the next tick fires.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  // Ids already delivered by push on this connection, so a replay after a
  // reconnect cannot double-count the badge, chime, or popup twice.
  const seenPushes = useRef<Set<string>>(new Set());
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await fetchNotifications();
      if (!mounted.current) return;
      setNotifications(data.results);
      setUnreadCount(data.unreadCount);
    } catch {
      // A failed poll is not worth a toast — the ward network drops out
      // regularly and the next tick will pick things up.
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Clear the inbox on logout so the next nurse to sign in on a shared ward
  // tablet never sees the previous one's notifications.
  useEffect(() => {
    if (!user) {
      seenPushes.current.clear();
      toastTimers.current.forEach((timer) => clearTimeout(timer));
      toastTimers.current.clear();
      setNotifications([]);
      setUnreadCount(0);
      setToasts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    void refresh();
  }, [user, refresh]);

  // Refetch the list only when the server says the inbox actually changed.
  useLiveRefresh('notifications', () => {
    void refresh();
  });

  // Push. The socket carries the notification itself, so it goes into the list
  // straight away — the popup appears on the event, not on the fetch that
  // follows it. That fetch still happens, to pick up the fields the push does
  // not carry, but nothing waits for it.
  useRealtimeNotifications((pushed: RealtimeNotification) => {
    // The same notification can arrive twice — a socket reconnect can replay
    // one, and a refetch can race the push that caused it. Decide once, here,
    // rather than inside setState: the badge and the chime are side effects
    // that must not fire again for something already seen.
    if (seenPushes.current.has(pushed.id)) return;
    seenPushes.current.add(pushed.id);

    const notification = toNotification(pushed);
    setNotifications((prev) =>
      prev.some((item) => item.id === pushed.id) ? prev : [notification, ...prev]
    );
    setUnreadCount((prev) => prev + 1);

    // Only on a genuinely new pushed notification, and only if the nurse
    // asked for sound/vibration. Nothing plays or buzzes on a refetch. This
    // is the one central place either ever fires — see notificationSound.ts
    // and notificationVibration.ts's own docs — so a screen never needs its
    // own check.
    const critical = notification.type === 'critical';
    // An emergency ("Respond Now") always sounds and vibrates, whatever the
    // nurse's sound/vibration preferences — it's a call to come now.
    const emergency = notification.event === 'emergency_response';
    if (soundAlerts || emergency) playNotificationSound(critical || emergency);
    if (vibrationAlerts || emergency) vibrateForNotification(critical || emergency);

    // The popup card (NotificationToastHost, mounted in every (app) layout)
    // — same genuinely-new-only guard as the sound above, so the backlog a
    // nurse already had at login never pops up, only what arrives live.
    // Skipped for events with their own dedicated popup (see
    // EVENTS_WITH_OWN_POPUP) so a nurse never sees two popups for one event.
    if (!EVENTS_WITH_OWN_POPUP.has(notification.event ?? '')) {
      setToasts((prev) => [notification, ...prev].slice(0, TOAST_STACK_LIMIT));
      if (!critical) {
        const timer = setTimeout(() => dismissToast(notification.id), TOAST_AUTO_HIDE_MS);
        toastTimers.current.set(notification.id, timer);
      }
    }

    // Fill in anything the push left out, without blocking the popup on it.
    void refresh();
  });

  // The badge does not need to wait for that fetch: the live poll already
  // carries the unread count, so the bell moves on the very next tick.
  useEffect(() => {
    if (user) setUnreadCount(liveUnread);
  }, [liveUnread, user]);

  const markRead = useCallback(async (id: string) => {
    // Update locally first: the tap should feel instant, and the server is
    // being told the same thing either way.
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isRead: true } : item))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    dismissToast(id);
    try {
      await markNotificationRead(id);
    } catch {
      void refresh();
    }
  }, [refresh, dismissToast]);

  const acknowledge = useCallback(async (id: string) => {
    // A required acknowledgement both acknowledges and dismisses the alert.
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isRead: true, acknowledgedAt: new Date().toISOString() } : item))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    dismissToast(id);
    try {
      await acknowledgeNotification(id);
    } catch {
      void refresh();
    }
  }, [refresh, dismissToast]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    toastTimers.current.forEach((timer) => clearTimeout(timer));
    toastTimers.current.clear();
    setToasts([]);
    try {
      await markAllNotificationsRead();
    } catch {
      void refresh();
    }
  }, [refresh]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications, unreadCount, loading, refresh, markRead, markAllRead, acknowledge, toasts, dismissToast,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
};

export function useNotifications(): NotificationsContextType {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}
