import { Platform } from 'react-native';
import { Asset } from 'expo-asset';

/**
 * The sound that plays for an incoming notification — a quiet chime for a
 * normal one, a sharper three-beep alert for a critical one, so a critical
 * alert is audibly distinct, not just visually (see NotificationPanel's
 * red styling for the visual half of that).
 *
 * Web only, same as before: React Native has no built-in audio, and these
 * are real `<audio>` elements rather than the Web Audio oscillator this
 * module used to synthesize — real files are what let a browser's "has the
 * page been interacted with yet" autoplay gate be unlocked once up front
 * (see unlockNotificationAudio) instead of fighting an AudioContext's
 * suspended state on every single play.
 *
 * Callers must check the nurse's Sound Alerts preference first (and pick
 * `critical: true` for a critical-severity notification); this module
 * plays whenever it is asked to.
 */

const SOURCES = {
  normal: require('../assets/sounds/notification.wav'),
  critical: require('../assets/sounds/critical.wav'),
} as const;

type SoundKey = keyof typeof SOURCES;

// One real <audio> element per sound, created lazily and reused — reusing
// the same element (reset to the start each play) is what lets the browser
// treat it as already-unlocked after the first user gesture, rather than
// creating a brand-new, still-locked element on every notification.
const elements: Partial<Record<SoundKey, HTMLAudioElement>> = {};
let unlocked = false;
// Sounds are short and a ward can get several notifications in a burst —
// this is the guard against two chimes overlapping into noise. Only one
// plays at a time; a second arrival while one is still going is simply
// skipped, not queued, since the point is "something happened," not a count.
let playing = false;

function getElement(key: SoundKey): HTMLAudioElement | null {
  if (Platform.OS !== 'web' || typeof Audio === 'undefined') return null;
  let el = elements[key];
  if (!el) {
    const asset = Asset.fromModule(SOURCES[key]);
    el = new Audio(asset.uri || asset.localUri || undefined);
    el.preload = 'auto';
    el.volume = key === 'critical' ? 0.55 : 0.35;
    el.addEventListener('ended', () => {
      playing = false;
    });
    elements[key] = el;
  }
  return el;
}

/**
 * Primes both sounds against the browser's autoplay gate.
 *
 * Call once, on the very first click/tap anywhere in the app (see
 * AuthContext's activity listeners, which already fire on exactly that).
 * Playing-then-immediately-pausing inside a real user-gesture handler is
 * what the browser actually checks for; every `play()` after this happens
 * on a background timer with no gesture of its own, so without this step
 * the very first real notification would always fail silently.
 */
export function unlockNotificationAudio(): void {
  if (unlocked || Platform.OS !== 'web') return;
  // Only latched on confirmed success — not every caller of this is
  // necessarily inside a real user gesture (see AuthContext, which calls
  // it from every tracked activity event, not just discrete clicks/taps),
  // and a play() outside one is exactly what the browser refuses. Staying
  // unlatched on failure lets the next genuine gesture try again instead of
  // wrongly giving up after the first, non-gesture attempt.
  (Object.keys(SOURCES) as SoundKey[]).forEach((key) => {
    const el = getElement(key);
    if (!el) return;
    el.muted = true;
    const result = el.play();
    if (result && typeof result.then === 'function') {
      result
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
          unlocked = true;
        })
        .catch(() => {
          el.muted = false;
        });
    } else {
      el.muted = false;
      unlocked = true;
    }
  });
}

export function playNotificationSound(critical = false): void {
  if (Platform.OS !== 'web') return;
  if (playing) return;

  const el = getElement(critical ? 'critical' : 'normal');
  if (!el) return;

  try {
    el.currentTime = 0;
    const result = el.play();
    if (result && typeof result.then === 'function') {
      playing = true;
      result.catch(() => {
        // Autoplay refused (no interaction yet this session) or the file
        // failed to decode — sound is a courtesy, never worth surfacing.
        playing = false;
      });
    }
  } catch {
    playing = false;
  }
}
