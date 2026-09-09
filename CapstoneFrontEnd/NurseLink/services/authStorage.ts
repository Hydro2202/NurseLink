import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Storage for the session (auth token + cached user) only — everything else
 * in the app keeps using AsyncStorage directly.
 *
 * On native there is no "tab" concept, so this is just AsyncStorage, same as
 * before. On web, AsyncStorage is backed by the browser's shared per-origin
 * storage, which every tab reads and writes the same keys in — logging into
 * a second tab silently overwrote the first tab's session, making it look
 * like a random logout/account swap on reload. sessionStorage is scoped to
 * a single tab (cleared when that tab closes, never shared with another
 * tab), which is what makes independent multi-tab testing possible; the
 * real-world tradeoff is that opening the app in a new tab is a fresh
 * session rather than picking up where the last tab left off.
 */
const isWeb = Platform.OS === 'web';

function webStorage(): Storage | null {
  return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    const store = webStorage();
    return store ? store.getItem(key) : null;
  }
  return AsyncStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    webStorage()?.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    webStorage()?.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}
