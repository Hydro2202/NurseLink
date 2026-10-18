import React, { useEffect, useState } from 'react';
import { X, AlertCircle, CheckCircle, Info, Clock, ArrowRight } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  fetchNotifications,
  markAllNotificationsRead,
  ApiError,
} from '../api/nurselink';
import type { AppNotification } from '../types/domain';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUnreadChange?: (count: number) => void;
}

export function NotificationPanel({ isOpen, onClose, onUnreadChange }: NotificationPanelProps) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchNotifications();
        if (!cancelled) {
          setNotifications(data.results);
          onUnreadChange?.(data.unreadCount);
        }
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : 'Failed to load notifications');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, onUnreadChange]);

  const handleActionClick = (action: { label: string; path: string; highlightId?: string }) => {
    onClose();
    if (action.highlightId) {
      navigate(action.path, { state: { highlightId: action.highlightId } });
    } else {
      navigate(action.path);
    }
  };

  const handleMarkAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.isRead).length;
    if (unread === 0) {
      toast.info('All notifications are already marked as read');
      return;
    }
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      onUnreadChange?.(0);
      toast.success('All notifications marked as read', {
        description: `${unread} notification${unread > 1 ? 's' : ''} marked as read`,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update notifications');
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-warning" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-success" />;
      default:
        return <Info className="w-5 h-5 text-primary" />;
    }
  };

  const getBadgeVariant = (type: string): any => {
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

  const getBackgroundClass = (type: string) => {
    switch (type) {
      case 'critical':
        return 'bg-destructive-light border-l-4 border-destructive';
      case 'warning':
        return 'bg-warning-light border-l-4 border-warning';
      case 'success':
        return 'bg-success-light border-l-4 border-success';
      default:
        return 'bg-info-light border-l-4 border-primary';
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      <div className="fixed top-0 right-0 h-full w-full sm:w-96 bg-card shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border bg-primary">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {unreadCount}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white hover:bg-primary-hover"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <CheckCircle className="w-12 h-12 mb-3 text-muted" />
              <p className="font-medium">No new notifications</p>
              <p className="text-sm">You're all caught up!</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 rounded-lg transition-all hover:shadow-md ${getBackgroundClass(
                  notification.type
                )}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">{getIcon(notification.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="font-semibold text-foreground text-sm">
                        {notification.title}
                      </h4>
                      <Badge variant={getBadgeVariant(notification.type)} className="text-xs">
                        {notification.type.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{notification.message}</p>
                    {notification.patient && (
                      <p className="text-xs text-muted-foreground font-medium mb-2">
                        Patient: {notification.patient}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {notification.time}
                      </span>
                      {notification.action && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleActionClick(notification.action!)}
                        >
                          {notification.action.label}
                          <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-border bg-muted">
          <Button variant="outline" className="w-full md:w-auto" onClick={handleMarkAllAsRead}>
            Mark All as Read
          </Button>
        </div>
      </div>
    </>
  );
}
