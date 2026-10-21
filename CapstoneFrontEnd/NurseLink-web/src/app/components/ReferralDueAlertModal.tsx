import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, User, ArrowRight } from 'lucide-react';
import { fetchNotifications, markNotificationRead, fetchHandover, ApiError } from '../api/nurselink';
import type { AppNotification, HandoverNote } from '../types/domain';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { useLiveRefresh } from '../contexts/LiveContext';

/**
 * The popup a nurse sees when a pending referral they're involved in is
 * almost due or overdue (see api/notifications.py's REFERRAL_ALMOST_DUE/
 * REFERRAL_OVERDUE events). Almost-due only ever reaches the receiver;
 * overdue reaches both the receiver and the sender — this one modal
 * handles either. Web port of the Expo ReferralDueAlertModal.
 */
const REFERRAL_DUE_EVENTS = new Set(['referral_almost_due', 'referral_overdue']);

function formatDueAt(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ReferralDueAlertModal() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<AppNotification[]>([]);
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [handover, setHandover] = useState<HandoverNote | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    fetchNotifications()
      .then(({ results }) => {
        setPending(results.filter((n) => REFERRAL_DUE_EVENTS.has(n.event || '') && !n.isRead));
      })
      .catch(() => {
        // Non-critical — the notification bell is still the fallback path.
      });
  };

  useEffect(refresh, []);
  useLiveRefresh('notifications', refresh);

  const queue = pending.filter((n) => !handled.has(n.id));

  useEffect(() => {
    if (current === null && queue.length > 0) {
      setCurrent(queue[queue.length - 1]);
    }
  }, [current, queue]);

  useEffect(() => {
    if (!current) {
      setHandover(null);
      return;
    }
    const handoverId = current.handoverId || current.action?.highlightId;
    if (!handoverId) {
      setHandover(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
    markNotificationRead(current.id).catch((err) => {
      if (!(err instanceof ApiError)) throw err;
    });
    close();
  };

  const viewReferral = () => {
    const handoverId = current.handoverId || current.action?.highlightId;
    void markNotificationRead(current.id).catch(() => {});
    close();
    navigate('/handover', { state: handoverId ? { highlightId: handoverId } : undefined });
  };

  const isOverdue = current.event === 'referral_overdue';
  const patientLabel = handover?.patientName || current.patient || 'a patient';

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-[420px]">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: isOverdue ? '#DC2626' : '#EA580C' }}
          >
            <Bell className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-lg font-extrabold">{isOverdue ? 'Endorsement Overdue' : 'Endorsement Almost Due'}</h2>
        </div>

        <p className="text-sm">{current.message || 'An endorsement needs your attention.'}</p>

        {loading ? (
          <div className="py-3 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-2 p-3.5 bg-muted rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Patient</span>
              <span className="text-sm font-semibold text-right">{patientLabel}</span>
            </div>
            {handover?.nurseFrom ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">From</span>
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  {handover.nurseFrom}
                </span>
              </div>
            ) : null}
            {handover?.dueAt ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Due</span>
                <span className="text-sm font-semibold" style={isOverdue ? { color: '#DC2626' } : undefined}>
                  {formatDueAt(handover.dueAt)}
                </span>
              </div>
            ) : null}
          </div>
        )}

        <div className="flex gap-3 mt-1">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Dismiss
          </Button>
          <Button className="flex-1" onClick={viewReferral}>
            Open Endorsement
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>

        {queue.length > 1 ? (
          <p className="text-xs text-muted-foreground text-center">
            {queue.length - 1} more endorsement{queue.length - 1 > 1 ? 's' : ''} waiting
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
