import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { fetchLiveState, ApiError, type LiveState } from '../api/nurselink';
import { useAuth } from './AuthContext';
import { useRealtime } from './RealtimeContext';

/**
 * The app's single source of "something changed" — ported from mobile's
 * LiveContext.
 *
 * Referrals, tasks and notifications all originate on other nurses'
 * devices, so nothing local can announce them — the app has to ask. Having
 * each page ask for its own list on a timer would mean several full
 * responses per nurse per tick, nearly all identical to the last. Instead
 * one poller asks the server for a revision string per area, and pages
 * refetch only when their revision actually moves.
 *
 * This is the safety net rather than the delivery path. RealtimeContext
 * holds a WebSocket that pushes notifications the moment they're saved;
 * what polling adds is recovery — a socket can be down or mid-reconnect,
 * and it carries notifications only, so task/handover lists still need to
 * notice edits made elsewhere. While push is connected this backs off; if
 * push is unavailable the app keeps working unchanged.
 */

/** How often the server is asked whether anything changed, with push
 * unavailable. Deliberately short — this sets how long one nurse's action
 * takes to appear on another's screen. */
const POLL_INTERVAL_MS = 4000;

/** Interval used while the WebSocket is connected — push is the real
 * delivery path once it's up, so this drops back to a slower safety net. */
const BACKGROUND_POLL_INTERVAL_MS = 10000;

const EMPTY: LiveState = {
  notifications: '',
  tasks: '',
  handovers: '',
  patients: '',
  duty: '',
  profile: '',
  unreadCount: 0,
};

export type LiveConnectionStatus = 'connected' | 'offline';

interface LiveContextType {
  revisions: LiveState;
  /** Ask the server immediately, e.g. right after an action of your own. */
  poll: () => Promise<void>;
  connectionStatus: LiveConnectionStatus;
}

const LiveContext = createContext<LiveContextType | undefined>(undefined);

export const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { connected } = useRealtime();
  const [revisions, setRevisions] = useState<LiveState>(EMPTY);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('connected');
  const connectionStatusRef = useRef(connectionStatus);
  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  // Guards against overlapping polls on a slow connection.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetchLiveState();
      if (mounted.current) {
        setRevisions(next);
        if (connectionStatusRef.current === 'offline') {
          console.info('[NurseLink] Live connection restored.');
          setConnectionStatus('connected');
        }
      }
    } catch (error) {
      // A real HTTP response (4xx/5xx with a status) means the backend was
      // reached, so that's not a connectivity issue — only a thrown
      // network/abort error (no status at all) counts as offline.
      const isConnectivityIssue = !(error instanceof ApiError) || error.status === 0;
      if (isConnectivityIssue && mounted.current && connectionStatusRef.current === 'connected') {
        console.warn('[NurseLink] Live connection unavailable — will keep retrying.', error);
        setConnectionStatus('offline');
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setRevisions(EMPTY);
      setConnectionStatus('connected');
      return;
    }

    // One poll on mount regardless, so opening the app shows current data.
    void poll();

    const timer = setInterval(
      () => {
        void poll();
      },
      connected || connectionStatus === 'offline' ? BACKGROUND_POLL_INTERVAL_MS : POLL_INTERVAL_MS
    );

    // Coming back to a backgrounded tab is when a nurse is most likely to
    // have missed something, so check straight away.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user, poll, connected, connectionStatus]);

  // A socket that just reconnected may have missed events while down, so
  // reconcile against the server rather than trusting the gap was empty.
  useEffect(() => {
    if (user && connected) void poll();
  }, [connected, user, poll]);

  return (
    <LiveContext.Provider value={{ revisions, poll, connectionStatus }}>
      {children}
    </LiveContext.Provider>
  );
};

export function useLive(): LiveContextType {
  const context = useContext(LiveContext);
  if (!context) {
    throw new Error('useLive must be used within a LiveProvider');
  }
  return context;
}

/**
 * Run `onChange` whenever one area's revision moves.
 *
 * Skips the first value, because pages load their own data on mount and
 * shouldn't immediately fetch it a second time.
 */
export function useLiveRefresh(area: keyof Omit<LiveState, 'unreadCount'>, onChange: () => void) {
  const { revisions } = useLive();
  const revision = revisions[area];
  const previous = useRef<string | null>(null);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!revision) return;
    if (previous.current === null) {
      previous.current = revision;
      return;
    }
    if (previous.current !== revision) {
      previous.current = revision;
      handler.current();
    }
  }, [revision]);
}
