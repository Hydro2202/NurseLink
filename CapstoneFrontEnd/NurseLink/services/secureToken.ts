import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { TOKEN_KEY } from './config';

/**
 * The ONLY module that touches where the auth token lives on disk.
 *
 * Native: expo-secure-store (Keychain on iOS, Keystore-backed EncryptedSharedPreferences
 * on Android) — unlike AsyncStorage, this is encrypted at rest.
 *
 * Web: there is no secure-store equivalent in a browser, so this keeps using
 * sessionStorage, same as the rest of the session (see authStorage.ts) — scoped
 * to one tab, cleared when that tab closes, never written to a plain file.
 */
const isWeb = Platform.OS === 'web';

function webStorage(): Storage | null {
  return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
}

export async function getStoredToken(): Promise<string | null> {
  if (isWeb) return webStorage()?.getItem(TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setStoredToken(token: string): Promise<void> {
  if (isWeb) {
    webStorage()?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearStoredToken(): Promise<void> {
  if (isWeb) {
    webStorage()?.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * One-time migration for devices upgrading from a build that kept the token in
 * plain AsyncStorage. Moves it into secure storage and deletes the old copy, so
 * an existing nurse stays signed in across the update instead of being logged
 * out. Web never stored the token in AsyncStorage (it used sessionStorage
 * directly), so there is nothing to migrate there.
 */
export async function migrateLegacyAsyncStorageToken(): Promise<void> {
  if (isWeb) return;
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (!legacy) return;
  await SecureStore.setItemAsync(TOKEN_KEY, legacy);
  await AsyncStorage.removeItem(TOKEN_KEY);
}
