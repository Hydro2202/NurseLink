import { useNavigate } from 'react-router';
import { AlertCircle, CheckCircle, Info, X, ArrowRight } from 'lucide-react';
import { markNotificationRead, ApiError } from '../api/nurselink';
import type { AppNotification } from '../types/domain';

const STYLE_BY_TYPE: Record<
  AppNotification['type'],
  { icon: typeof AlertCircle; color: string; bg: string; border: string }
> = {
  critical: { icon: AlertCircle, color: '#DC2626', bg: '#FEF2F2', border: '#DC2626' },
  warning: { icon: AlertCircle, color: '#D97706', bg: '#FFFBEB', border: '#D97706' },
  info: { icon: Info, color: '#2563EB', bg: '#EFF6FF', border: '#2563EB' },
  success: { icon: CheckCircle, color: '#16A34A', bg: '#F0FDF4', border: '#16A34A' },
};

function formatTime(notification: AppNotification): string {
  if (!notification.createdAt) return notification.time;
  const parsed = new Date(notification.createdAt);
  if (Number.isNaN(parsed.getTime())) return notification.time;
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface NotificationToastCardProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}

/** One popup card in NotificationToastHost's stack — visual twin of mobile's
 * NotificationToastCard. Clicking the card body or its action button both
 * open the action path and mark it read; the X just dismisses. */
export function NotificationToastCard({ notification, onDismiss }: NotificationToastCardProps) {
  const navigate = useNavigate();
  const { icon: Icon, color, bg, border } = STYLE_BY_TYPE[notification.type] ?? STYLE_BY_TYPE.info;

  const act = () => {
    if (!notification.isRead) {
      markNotificationRead(notification.id).catch((err) => {
        if (!(err instanceof ApiError)) throw err;
      });
    }
    onDismiss(notification.id);
    if (!notification.action) return;
    // See NotificationPanel's handleActionClick for why both keys are sent.
    navigate(notification.action.path, {
      state: {
        highlightId: notification.action.highlightId,
        viewPatient: notification.action.highlightId,
      },
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={act}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') act();
      }}
      className="flex gap-2.5 p-3 rounded-lg shadow-lg border-l-4 w-full cursor-pointer text-left"
      style={{ backgroundColor: bg, borderLeftColor: border }}
    >
      <div className="mt-0.5 flex-shrink-0">
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-gray-900 truncate">{notification.title}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(notification.id);
            }}
            aria-label="Dismiss"
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-800 mt-0.5 line-clamp-3">{notification.message}</p>
        {notification.patient ? (
          <p className="text-[11px] text-gray-500 font-semibold mt-1 truncate">{notification.patient}</p>
        ) : null}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10.5px] text-gray-500">{formatTime(notification)}</span>
          {notification.action ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                act();
              }}
              className="flex items-center gap-1 text-[11.5px] font-bold"
              style={{ color }}
            >
              {notification.action.label}
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
