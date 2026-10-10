import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, User, ArrowRight } from 'lucide-react';
import { fetchNotifications, markNotificationRead, ApiError } from '../api/nurselink';
import type { AppNotification } from '../types/domain';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';

/**
 * The popup a nurse sees when a patient is handed over to them — ported
 * from mobile's HandoverAlertModal. Becoming responsible for a patient you
 * have not seen is the one event in this app that should not wait until
 * somebody happens to open the bell menu, so it interrupts.
 *
 * Web has no live/WebSocket refresh layer yet (unlike mobile's LiveContext),
 * so this checks once per page load rather than polling — still strictly
 * better than the current state (no popup at all), and consistent with how
 * the rest of web's notification system already behaves (NotificationPanel
 * also only fetches once on mount).
 */
const HANDOVER_RECEIVED = 'handover_received';

function formatTime(notification: AppNotification): string {
  if (!notification.createdAt) return notification.time;
  const parsed = new Date(notification.createdAt);
  if (Number.isNaN(parsed.getTime())) return notification.time;
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function HandoverAlertModal() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<AppNotification[]>([]);
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetchNotifications()
      .then(({ results }) => {
        if (cancelled) return;
        setPending(results.filter((n) => n.event === HANDOVER_RECEIVED && !n.isRead));
      })
      .catch(() => {
        // Non-critical — the notification bell is still the fallback path.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const queue = pending.filter((n) => !handled.has(n.id));

  useEffect(() => {
    if (current === null && queue.length > 0) {
      // Oldest first: work through several handovers in the order they arrived.
      setCurrent(queue[queue.length - 1]);
    }
  }, [current, queue]);

  if (!current) return null;

  const close = () => {
    setHandled((prev) => new Set(prev).add(current.id));
    setCurrent(null);
  };

  const dismiss = () => {
    // Read, not deleted: the handover itself and this entry both stay in
    // the notification centre and in the nurse's handover list.
    markNotificationRead(current.id).catch((err) => {
      if (!(err instanceof ApiError)) throw err;
    });
    close();
  };

  const viewHandover = () => {
    const { handoverId, patientId } = current;
    void markNotificationRead(current.id).catch(() => {});
    close();
    if (handoverId) {
      navigate('/handover', { state: { highlightId: handoverId } });
      return;
    }
    if (patientId) {
      navigate('/my-patients', { state: { viewPatient: patientId } });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-[420px]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-lg font-extrabold">New Patient Referral</h2>
        </div>

        <p className="text-sm">A patient has been referred to you.</p>

        <div className="space-y-2 p-3.5 bg-muted rounded-lg border border-border">
          {current.patient ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Patient</span>
              <span className="text-sm font-semibold text-right">{current.patient}</span>
            </div>
          ) : null}
          {current.senderName ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">From</span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                {current.senderName}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Time</span>
            <span className="text-sm font-semibold">{formatTime(current)}</span>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">Please review the patient's information.</p>

        <div className="flex gap-3 mt-1">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Dismiss
          </Button>
          <Button className="flex-1" onClick={viewHandover}>
            View Referral
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>

        {queue.length > 1 ? (
          <p className="text-xs text-muted-foreground text-center">
            {queue.length - 1} more referral{queue.length - 1 > 1 ? 's' : ''} waiting
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
