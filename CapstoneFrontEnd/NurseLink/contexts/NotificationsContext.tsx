import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../services/api';
import type { AppNotification } from '../types/domain';
import { useAuth } from './AuthContext';
import { useLive, useLiveRefresh } from './LiveContext';
import { useRealtimeNotifications, type RealtimeNotification } from './RealtimeContext';

/**
 * Keeps every nurse's inbox current without them having to reload anything.
 *
 * Notifications arrive from other people — a handover sent to you, a task a
 * supervisor just assigned — so the app cannot know about them from its own
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
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

/**
 * Shape a pushed event like a fetched notification.
 *
 * The socket sends what a popup needs immediately; the refetch that follows
 * replaces this with the server's own version. Both are the same row.
 */
function toNotification(pushed: RealtimeNotification): AppNotification {
  return {
    id: pushed.id,
    type: 'warning',
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
    action: pushed.handoverId
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
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Guards against overlapping polls on a slow connection, where a request can
  // still be in flight when the next tick fires.
  const inFlight = useRef(false);
  const mounted = useRef(true);

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
      setNotifications([]);
      setUnreadCount(0);
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
    setNotifications((prev) => {
      // The same notification can arrive twice — pushed, then again in a
      // refetch, or after a socket reconnect. Keyed by id, it lands once.
      if (prev.some((item) => item.id === pushed.id)) return prev;
      return [toNotification(pushed), ...prev];
    });
    setUnreadCount((prev) => prev + 1);
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
    try {
      await markNotificationRead(id);
    } catch {
      void refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      void refresh();
    }
  }, [refresh]);

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, loading, refresh, markRead, markAllRead }}
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
