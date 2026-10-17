import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, BedDouble, ArrowRight } from 'lucide-react';
import { fetchNotifications, markNotificationRead, fetchTask, ApiError } from '../api/nurselink';
import type { AppNotification, Task } from '../types/domain';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { useLiveRefresh } from '../contexts/LiveContext';

/**
 * The popup a nurse sees when one of their own tasks is due soon or due
 * now (see api/notifications.py's TASK_DUE_SOON/TASK_DUE events and
 * check_due_task_reminders). Web port of the Expo TaskDueAlertModal — same
 * shape as HandoverAlertModal: driven by the notification list, refetched
 * on every live tick, dismiss marks it read.
 */
const TASK_DUE_EVENTS = new Set(['task_due_soon', 'task_due']);

const RISK_COLORS: Record<string, string> = {
  high: '#DC2626',
  medium: '#EA580C',
  low: '#16A34A',
};

function formatDueDateTime(task: Task): string {
  if (!task.dueDate) return task.dueTime || '';
  const [y, m, d] = task.dueDate.split('-').map(Number);
  if (!y || !m || !d) return task.dueTime || '';
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return task.dueTime ? `${dateLabel} · ${task.dueTime}` : dateLabel;
}

export function TaskDueAlertModal() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<AppNotification[]>([]);
  const [current, setCurrent] = useState<AppNotification | null>(null);
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [task, setTask] = useState<Task | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);

  const refresh = () => {
    fetchNotifications()
      .then(({ results }) => {
        setPending(results.filter((n) => TASK_DUE_EVENTS.has(n.event || '') && !n.isRead));
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
      setTask(null);
      return;
    }
    const taskId = current.action?.highlightId;
    if (!taskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    setTaskLoading(true);
    fetchTask(taskId)
      .then((result) => {
        if (!cancelled) setTask(result);
      })
      .catch(() => {
        if (!cancelled) setTask(null);
      })
      .finally(() => {
        if (!cancelled) setTaskLoading(false);
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

  const openTask = () => {
    const taskId = current.action?.highlightId;
    void markNotificationRead(current.id).catch(() => {});
    close();
    navigate('/tasks', { state: taskId ? { taskId } : undefined });
  };

  const isSoonEvent = current.event === 'task_due_soon';
  const riskColor = task ? RISK_COLORS[task.priority] || '#6B7280' : '#6B7280';

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-[420px]">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: isSoonEvent ? '#EA580C' : '#DC2626' }}
          >
            <Bell className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-lg font-extrabold">{isSoonEvent ? 'Task Due Soon' : 'Task Due Now'}</h2>
        </div>

        <p className="text-sm">{current.message || 'One of your tasks needs attention.'}</p>

        {taskLoading ? (
          <div className="py-3 text-center text-sm text-muted-foreground">Loading…</div>
        ) : task ? (
          <div className="space-y-2 p-3.5 bg-muted rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Task</span>
              <span className="text-sm font-semibold text-right">{task.title}</span>
            </div>
            {task.patientName ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Patient</span>
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {task.patientRoom ? <BedDouble className="w-3.5 h-3.5 text-muted-foreground" /> : null}
                  {task.patientName}
                  {task.patientRoom ? ` • ${task.patientRoom}` : ''}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Risk Level</span>
              <span className="flex items-center gap-1.5 text-sm font-semibold capitalize" style={{ color: riskColor }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: riskColor }} />
                {task.priority}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Due</span>
              <span className="text-sm font-semibold">{formatDueDateTime(task)}</span>
            </div>
          </div>
        ) : null}

        <div className="flex gap-3 mt-1">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Dismiss
          </Button>
          <Button className="flex-1" onClick={openTask}>
            Open Task
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>

        {queue.length > 1 ? (
          <p className="text-xs text-muted-foreground text-center">
            {queue.length - 1} more task{queue.length - 1 > 1 ? 's' : ''} waiting
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
