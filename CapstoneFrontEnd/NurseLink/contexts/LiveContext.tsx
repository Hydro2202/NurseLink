import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchLiveState, ApiError, type LiveState } from '../services/api';
import { useAuth } from './AuthContext';
import { useRealtime } from './RealtimeContext';
import { usePreferences } from './PreferencesContext';

/**
 * The app's single source of "something changed".
 *
 * Referrals, tasks and notifications all originate on other nurses' devices, so
 * nothing local can announce them — the app has to ask. Having each screen ask
 * for its own list on a timer would mean several full responses per nurse per
 * tick, nearly all of them identical to the last. Instead one poller asks the
 * server for a revision string per area, and screens refetch only when their
 * revision actually moves.
 *
 * The steady state is therefore one ~200-byte request every few seconds no
 * matter how many screens are mounted, and real list queries happen only when
 * there is genuinely something new to show.
 *
 * This is the safety net rather than the delivery path. RealtimeContext holds a
 * WebSocket that pushes notifications the moment they are saved; what polling
 * adds is recovery. A socket can be down or mid-reconnect over hospital wi-fi,
 * and it carries notifications only — task and handover lists still need to
 * notice edits made elsewhere. So while push is connected this backs right off,
 * and if push is unavailable the app keeps working unchanged.
 */

/**
 * How often the server is asked whether anything changed, with push unavailable.
 *
 * This then sets how long one nurse's action takes to appear on another's
 * screen, so it is deliberately short. The request is skipped whenever the app
 * is backgrounded or a poll is already in flight.
 */
const POLL_INTERVAL_MS = 4000;

/**
 * Interval used while the WebSocket is connected.
 *
 * Push is the real delivery path once it is up, so this drops back to a
 * slower safety net rather than matching POLL_INTERVAL_MS — but not so slow
 * that a push silently dropped by a flaky connection (socket still reports
 * "connected" right up until its next failed heartbeat) leaves a nurse
 * waiting the better part of a minute for something that already happened.
 */
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

/** Whether the live poll is currently reaching the backend at all — for a
 * small, unobtrusive status indicator (e.g. the app header), not for
 * gating functionality. Screens keep working from their last-known data
 * either way; this is purely informational. */
export type LiveConnectionStatus = 'connected' | 'offline';

interface LiveContextType {
  /** Revision strings; compare, never parse. */
  revisions: LiveState;
  /** Ask the server immediately, e.g. straight after an action of your own. */
  poll: () => Promise<void>;
  /** 'offline' once a poll fails to reach the backend at all (network/
   * timeout/server error) — flips back to 'connected' the moment a poll
   * succeeds again. Unrelated to the WebSocket's own `connected` (see
   * RealtimeContext) — this tracks the polling safety net specifically. */
  connectionStatus: LiveConnectionStatus;
}

const LiveContext = createContext<LiveContextType | undefined>(undefined);

export const LiveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { connected } = useRealtime();
  const { preferences } = usePreferences();
  const { autoRefresh, backgroundSync } = preferences;
  const [revisions, setRevisions] = useState<LiveState>(EMPTY);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('connected');
  const connectionStatusRef = useRef(connectionStatus);
  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  // Guards against overlapping polls on a slow connection, where a request can
  // still be in flight when the next tick fires.
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
      // Only a genuine connectivity problem (unreachable/timed out/the
      // server itself erroring) counts as "offline" — an HTTP 4xx or an
      // auth failure means the backend was reached and responded, so it's
      // not a connection issue (401 already triggers a sign-out elsewhere).
      // Logged once on the transition, not every tick, so a real outage
      // doesn't spam the console while the next tick keeps quietly retrying.
      const kind = error instanceof ApiError ? error.kind : 'network';
      const isConnectivityIssue = kind === 'network' || kind === 'timeout' || kind === 'server';
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

    // One poll on mount regardless: opening the app should show current data
    // even for a nurse who has turned automatic refreshing off.
    void poll();

    // Auto-Refresh Data off means exactly that — no repeating timer at all.
    // The socket still delivers, and returning to the app still reconciles, so
    // turning this off reduces background work rather than freezing the app.
    // While offline, back off to the slower cadence too — no point hammering
    // a backend that just told us it's unreachable.
    const timer = autoRefresh
      ? setInterval(
          () => {
            void poll();
          },
          connected || connectionStatus === 'offline' ? BACKGROUND_POLL_INTERVAL_MS : POLL_INTERVAL_MS
        )
      : null;

    // Coming back to the app is when a nurse is most likely to have missed
    // something, so check straight away rather than waiting for the next tick.
    // Background Data Sync off skips this: the nurse has asked the app not to
    // work while they are elsewhere, and this is the one thing it does on the
    // way back in.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active' && backgroundSync) void poll();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [user, poll, connected, connectionStatus, autoRefresh, backgroundSync]);

  // A socket that just came back may have missed events while it was down, so
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
 * Skips the first value, because screens load their own data on mount and
 * should not immediately fetch it a second time.
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
