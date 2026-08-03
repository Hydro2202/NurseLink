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

const DEFAULT_HOST =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || `${DEFAULT_HOST}/api`
).replace(/\/$/, '');

export const TOKEN_KEY = 'nurselink_token';
export const USER_KEY = 'nurselink_user';

if (__DEV__) {
  console.log('[NurseLink] API_BASE_URL =', API_BASE_URL);
}
