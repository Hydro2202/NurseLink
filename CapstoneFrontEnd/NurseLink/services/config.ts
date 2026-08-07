/**
 * Shared API base URL for Expo (web + native).
 *
 * IMPORTANT:
 * - On a physical phone, 127.0.0.1 means the PHONE, not your PC.
 * - Set EXPO_PUBLIC_API_URL to your PC's LAN IP, e.g. http://192.168.x.x:8000/api
 * - Android emulator can use http://10.0.2.2:8000/api
 * - Run Django as: python manage.py runserver 0.0.0.0:8000
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

function getHostFromManifest(): string | null {
  const hostString =
    typeof Constants.manifest === 'object' && Constants.manifest?.debuggerHost
      ? String(Constants.manifest.debuggerHost)
      : typeof Constants.manifest2 === 'object' && Constants.manifest2?.debuggerHost
      ? String(Constants.manifest2.debuggerHost)
      : null;

  if (!hostString) return null;
  const [host] = hostString.split(':');
  return host || null;
}

const manifestHost = getHostFromManifest();
const DEFAULT_HOST = manifestHost
  ? `http://${manifestHost}:8000`
  : Platform.OS === 'android'
  ? 'http://10.0.2.2:8000'
  : 'http://127.0.0.1:8000';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || `${DEFAULT_HOST}/api`
).replace(/\/$/, '');

export const TOKEN_KEY = 'nurselink_token';
export const USER_KEY = 'nurselink_user';

if (__DEV__) {
  console.log('[NurseLink] API_BASE_URL =', API_BASE_URL);
}
