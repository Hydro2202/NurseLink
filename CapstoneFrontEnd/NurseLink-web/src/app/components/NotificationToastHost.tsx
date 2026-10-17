import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeNotifications, type RealtimeNotification } from '../contexts/RealtimeContext';
import { fetchPreferences } from '../api/nurselink';
import type { AppNotification } from '../types/domain';
import { NotificationToastCard } from './NotificationToastCard';
import { playNotificationSound } from '../utils/notificationSound';

/** "Stack at most 3 cards; newer cards push older ones down" — a 4th pushes
 * the oldest off the stack entirely, not just lower in the pile. */
const TOAST_STACK_LIMIT = 3;
/** Critical toasts stay until dismissed; everything else clears itself. */
const TOAST_AUTO_HIDE_MS = 6000;
/** These events already interrupt with their own dedicated, richer popup
 * (HandoverAlertModal, TaskDueAlertModal, ReferralDueAlertModal, all
 * mounted alongside this host in every DashboardLayout branch) — the
 * generic toast skips them so a nurse never sees two popups for one event. */
const EVENTS_WITH_OWN_POPUP = new Set([
  'handover_received', 'task_due_soon', 'task_due', 'referral_almost_due', 'referral_overdue',
]);

const VALID_TYPES = new Set(['critical', 'warning', 'info', 'success']);

function toNotification(pushed: RealtimeNotification): AppNotification {
  return {
    id: pushed.id,
    type: VALID_TYPES.has(pushed.notificationType)
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
    action: pushed.actionLabel && pushed.actionPath
      ? { label: pushed.actionLabel, path: pushed.actionPath, highlightId: pushed.actionHighlightId ?? undefined }
      : pushed.handoverId
      ? { label: 'Review handover', path: '/handover', highlightId: pushed.handoverId }
      : undefined,
  };
}

/**
 * The stack of popup cards for notifications that arrive while this nurse
 * has the app open — ported from mobile's NotificationToastHost. Only ever
 * fed by the realtime push channel (see RealtimeContext), which by
 * construction never replays the unread backlog from before this page
 * loaded, so there is nothing extra to filter out here.
 *
 * Mounted once in every DashboardLayout branch (mobile staff, mobile head
 * nurse, desktop/tablet) — same placement as HandoverAlertModal and the
 * due-reminder popups.
 */
export function NotificationToastHost() {
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [soundAlerts, setSoundAlerts] = useState(true);
  const seenPushes = useRef<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    fetchPreferences()
      .then((prefs) => setSoundAlerts(prefs.soundAlerts))
      .catch(() => {
        // Preferences are a courtesy here — default to sound on, same as
        // the rest of the app's fail-open-to-enabled convention.
      });
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  useRealtimeNotifications((pushed: RealtimeNotification) => {
    // A socket reconnect can replay an event — decide once, here, so the
    // chime and the card can't double-fire for something already shown.
    if (seenPushes.current.has(pushed.id)) return;
    seenPushes.current.add(pushed.id);

    const notification = toNotification(pushed);
    const critical = notification.type === 'critical';
    if (soundAlerts) playNotificationSound(critical);

    // Skipped for events with their own dedicated popup (see
    // EVENTS_WITH_OWN_POPUP) so a nurse never sees two popups for one event.
    if (EVENTS_WITH_OWN_POPUP.has(notification.event ?? '')) return;

    setToasts((prev) => [notification, ...prev].slice(0, TOAST_STACK_LIMIT));
    if (!critical) {
      const timer = setTimeout(() => dismiss(notification.id), TOAST_AUTO_HIDE_MS);
      timers.current.set(notification.id, timer);
    }
  });

  if (toasts.length === 0) return null;

  return (
    <div className="fixed z-[1000] flex flex-col gap-2 top-2 left-3 right-3 sm:left-auto sm:right-4 sm:top-4 sm:w-[380px]">
      {toasts.map((notification) => (
        <NotificationToastCard key={notification.id} notification={notification} onDismiss={dismiss} />
      ))}
    </div>
  );
}
