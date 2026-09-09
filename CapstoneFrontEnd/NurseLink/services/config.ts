/**
 * Shared API base URL for Expo (web + native).
 *
 * IMPORTANT:
 * - On a physical phone, 127.0.0.1 means the PHONE, not your PC.
 * - Android emulator can use http://10.0.2.2:8010/api
 * - Run Django as: python manage.py runserver 0.0.0.0:8010
 *   (moved off 8000 — Windows reserves it dynamically for Hyper-V/WSL2 on
 *   this machine, which makes runserver fail with WinError 10048 even
 *   though no visible process owns the port)
 *
 * Resolution order:
 * 1. EXPO_PUBLIC_API_URL, if set — explicit override, e.g. for a staging server.
 * 2. The LAN host the phone is already using to reach the Metro dev server, so the
 *    app follows the PC across Wi-Fi/network changes without editing .env. Expo Go
 *    and dev-client builds expose this under different Constants fields, so both
 *    are checked.
 * 3. A platform default for emulators/simulators, which don't go through Metro's
 *    LAN address the same way.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

function hostFromMetro(): string | null {
  // Expo Go: "192.168.x.x:8081". Dev-client/embedded: same "host:port" shape.
  const hostPort =
    Constants.expoGoConfig?.debuggerHost || Constants.expoConfig?.hostUri;
  const host = hostPort?.split(':')[0];
  return host ? `http://${host}:8010` : null;
}

const DEFAULT_HOST =
  Platform.OS === 'android' ? 'http://10.0.2.2:8010' : 'http://127.0.0.1:8010';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || hostFromMetro() || `${DEFAULT_HOST}/api`
).replace(/\/api$/, '').replace(/\/$/, '') + '/api';

/**
 * WebSocket endpoint for live notifications.
 *
 * Derived from API_BASE_URL rather than configured separately, so pointing the
 * app at a different machine moves both together: http -> ws, https -> wss, and
 * the trailing /api is dropped because the socket is not under it.
 */
export const WS_URL = API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '')
  + '/ws/notifications/';

export const TOKEN_KEY = 'nurselink_token';
export const USER_KEY = 'nurselink_user';

if (__DEV__) {
  console.log('[NurseLink] API_BASE_URL =', API_BASE_URL);
  console.log('[NurseLink] WS_URL =', WS_URL);
}
