import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchWsTicket } from '../api/nurselink';
import { API_BASE_URL } from '../api/client';
import { useAuth } from './AuthContext';

/**
 * One WebSocket per signed-in nurse, for the whole app — ported from
 * mobile's RealtimeContext.
 *
 * Referrals happen on other people's devices, so the app has to be told
 * rather than ask. This holds a single socket open for as long as the nurse
 * is signed in; every page sees its events through this context, so
 * navigating between pages neither drops it nor opens a second one.
 *
 * Delivery is still best-effort by design: every event it carries also
 * exists as a row in the database. If the socket is down, the app falls
 * back to LiveContext's poll and nothing is lost — `connected` is exposed so
 * the poll can slow itself down when push is genuinely working.
 */

/** Derived from API_BASE_URL rather than configured separately, so pointing
 * the app at a different backend moves both together: http -> ws,
 * https -> wss, and the trailing /api is dropped since the socket isn't
 * under it. */
const WS_URL =
  API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws/notifications/';

export interface RealtimeNotification {
  type: 'notification';
  event: string;
  id: string;
  title: string;
  message: string;
  patientId: string | null;
  patientName: string | null;
  handoverId: string | null;
  senderName: string | null;
  createdAt: string;
}

type Listener = (event: RealtimeNotification) => void;

interface RealtimeContextType {
  connected: boolean;
  /** Subscribe to pushed notifications. Returns an unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

// Backoff between reconnect attempts, so a down server doesn't get hammered
// by every open tab on the ward.
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000];
// Keeps idle connections from being closed by proxies.
const HEARTBEAT_MS = 25000;

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<Listener>>(new Set());
  const attempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set while tearing down deliberately (logout, unmount), so the close
  // handler doesn't immediately reconnect a socket we meant to close.
  const closing = useRef(false);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const clearTimers = () => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (heartbeat.current) {
      clearInterval(heartbeat.current);
      heartbeat.current = null;
    }
  };

  // connect and scheduleReconnect call each other — holding one behind a
  // ref breaks the cycle, so neither has a stale-closure dependency.
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const connect = useCallback(async () => {
    if (closing.current) return;
    // Never open a second socket: duplicate connections mean duplicate popups.
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) return;

    let ticket: string;
    try {
      ticket = await fetchWsTicket();
    } catch (error) {
      if (import.meta.env.DEV) console.log('[Realtime] Could not get a connect ticket', error);
      scheduleReconnectRef.current();
      return;
    }

    const url = `${WS_URL}?ticket=${encodeURIComponent(ticket)}`;
    if (import.meta.env.DEV) console.log('[Realtime] Connecting...');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      if (import.meta.env.DEV) console.log('[Realtime] Could not open socket', error);
      scheduleReconnectRef.current();
      return;
    }
    socket.current = ws;

    ws.onopen = () => {
      attempt.current = 0;
      setConnected(true);
      if (import.meta.env.DEV) console.log('[Realtime] Connected');

      heartbeat.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (message) => {
      let data: any;
      try {
        data = JSON.parse(message.data as string);
      } catch {
        return;
      }
      if (data?.type === 'connected') {
        if (import.meta.env.DEV) console.log('[Realtime] Authenticated as user', data.userId);
        return;
      }
      if (data?.type !== 'notification') return;

      if (import.meta.env.DEV) console.log('[Realtime] Received', data.event, data.id);
      listeners.current.forEach((listener) => {
        try {
          listener(data as RealtimeNotification);
        } catch (error) {
          console.warn('[Realtime] Listener failed', error);
        }
      });
    };

    ws.onerror = () => {
      // onclose always follows, which is where reconnection is handled.
      if (import.meta.env.DEV) console.log('[Realtime] Socket error');
    };

    ws.onclose = (closeEvent) => {
      setConnected(false);
      clearTimers();
      socket.current = null;
      if (closing.current) return;

      // 4401 is the server refusing the token — retrying cannot fix that.
      if (closeEvent?.code === 4401) {
        if (import.meta.env.DEV) console.log('[Realtime] Rejected: token not accepted');
        return;
      }
      if (import.meta.env.DEV) console.log('[Realtime] Disconnected — will retry');
      scheduleReconnectRef.current();
    };
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (closing.current || reconnectTimer.current) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt.current, RECONNECT_DELAYS_MS.length - 1)];
    attempt.current += 1;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      void connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  useEffect(() => {
    if (!user) {
      closing.current = true;
      clearTimers();
      socket.current?.close();
      socket.current = null;
      setConnected(false);
      return;
    }

    closing.current = false;
    attempt.current = 0;
    void connect();

    // A laptop/tab that was asleep suspends the socket; reconnect on the
    // way back rather than waiting for the next failed heartbeat.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !socket.current) void connect();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      closing.current = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimers();
      socket.current?.close();
      socket.current = null;
      setConnected(false);
    };
  }, [user, connect]);

  return (
    <RealtimeContext.Provider value={{ connected, subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
};

export function useRealtime(): RealtimeContextType {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return context;
}

/** Run `handler` for every pushed notification, for as long as the caller lives. */
export function useRealtimeNotifications(handler: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}
