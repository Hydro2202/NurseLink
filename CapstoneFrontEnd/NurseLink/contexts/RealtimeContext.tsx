import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { WS_URL } from '../services/config';
import { fetchWsTicket } from '../services/api';
import { useAuth } from './AuthContext';

/**
 * One WebSocket per signed-in nurse, for the whole app.
 *
 * Referrals happen on other people's devices, so the app has to be told rather
 * than ask. This holds a single socket open for as long as the nurse is signed
 * in, and every screen sees its events through this context — the connection is
 * deliberately not owned by any screen, so navigating between Dashboard,
 * Referral, Kardex and the rest neither drops it nor opens a second one.
 *
 * The socket is authenticated with the same token as the REST API. It carries
 * the events themselves, not just a nudge, so a popup can appear the instant a
 * handover is saved without waiting for a fetch to come back.
 *
 * Delivery is still best-effort by design: every event it carries also exists
 * as a row in the database. If the socket is down — laptop asleep, wi-fi
 * dropped, server restarted — the app falls back to the existing live poll and
 * nothing is lost, which is why `connected` is exposed for the poll to slow
 * itself down when push is genuinely working.
 */

/** Message pushed by the server for a saved notification. */
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

// Backoff between reconnect attempts, so a server that is down does not get
// hammered by every open tab on the ward.
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000];
// Keeps idle connections from being closed by proxies and phone radios.
const HEARTBEAT_MS = 25000;

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<Listener>>(new Set());
  const attempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set while tearing down deliberately (logout, unmount), so the close handler
  // does not immediately reconnect a socket we meant to close.
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

  // connect and scheduleReconnect call each other. Holding one behind a ref
  // breaks the cycle, so neither has a stale-closure dependency on the other.
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const connect = useCallback(async () => {
    if (closing.current) return;
    // Never open a second socket: duplicate connections mean duplicate popups.
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) return;

    let ticket: string;
    try {
      ticket = await fetchWsTicket();
    } catch (error) {
      // No ticket (signed out, server unreachable, token already dead) —
      // same as before when there was no token to connect with: give up
      // quietly and let the normal reconnect backoff try again.
      if (__DEV__) console.log('[Realtime] Could not get a connect ticket', error);
      scheduleReconnectRef.current();
      return;
    }

    const url = `${WS_URL}?ticket=${encodeURIComponent(ticket)}`;
    if (__DEV__) console.log('[Realtime] Connecting...');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      if (__DEV__) console.log('[Realtime] Could not open socket', error);
      scheduleReconnectRef.current();
      return;
    }
    socket.current = ws;

    ws.onopen = () => {
      attempt.current = 0;
      setConnected(true);
      if (__DEV__) console.log('[Realtime] Connected — listening for handover events');

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
        if (__DEV__) console.log('[Realtime] Authenticated as user', data.userId);
        return;
      }
      if (data?.type !== 'notification') return;

      if (__DEV__) console.log('[Realtime] Received', data.event, data.id);
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
      if (__DEV__) console.log('[Realtime] Socket error');
    };

    ws.onclose = (closeEvent) => {
      setConnected(false);
      clearTimers();
      socket.current = null;
      if (closing.current) return;

      // 4401 is the server refusing the token. Retrying cannot fix that, and
      // hammering it would be pointless; the poll keeps the app working.
      if (closeEvent?.code === 4401) {
        if (__DEV__) console.log('[Realtime] Rejected: token not accepted');
        return;
      }
      if (__DEV__) console.log('[Realtime] Disconnected — will retry');
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
      // Signed out: close deliberately and stay closed.
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

    // A phone suspends sockets in the background; reconnect on the way back in
    // rather than waiting for the next failed heartbeat to notice.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active' && !socket.current) void connect();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      closing.current = true;
      subscription.remove();
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

  // Synced via an effect, not during render — React Compiler can memoize a
  // render and skip re-running it, which would silently leave this ref
  // pointing at a stale closure of handler.
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}
