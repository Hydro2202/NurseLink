import { Platform, Vibration } from 'react-native';

/**
 * Device vibration for an incoming notification — a short pulse for a
 * normal one, a longer pattern for a critical one, same "make critical
 * stand out" idea as the different sound (see notificationSound.ts).
 *
 * Feature-detected rather than assumed: desktop browsers have no Vibration
 * API at all, and iOS Safari ships the API but silently ignores every call
 * — both must fail safely, never throw, and `isVibrationSupported()` is
 * what the Settings toggle uses to hide itself (or show "Not supported on
 * this device") rather than offer a control that visibly does nothing.
 */

// ms on, ms off, on, off, ... — a quick double-pulse for a normal
// notification, a longer, more insistent pattern for a critical one.
const NORMAL_PATTERN = [80, 60, 80];
const CRITICAL_PATTERN = [150, 80, 150, 80, 150];

export function isVibrationSupported(): boolean {
  if (Platform.OS === 'web') {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }
  // React Native's Vibration module itself has no capability check — iOS
  // silently no-ops on Vibration.vibrate(pattern) (it only ever supports a
  // single fixed buzz, not patterns), so pattern-based vibration is treated
  // as Android-only on native.
  return Platform.OS === 'android';
}

export function vibrateForNotification(critical = false): void {
  if (!isVibrationSupported()) return;
  const pattern = critical ? CRITICAL_PATTERN : NORMAL_PATTERN;
  try {
    if (Platform.OS === 'web') {
      navigator.vibrate(pattern);
    } else {
      Vibration.vibrate(pattern);
    }
  } catch {
    // Vibration is a courtesy, same as sound — never worth surfacing.
  }
}
