import { Platform } from 'react-native';

/**
 * True only for a desktop/laptop web browser.
 *
 * Registration needs a live camera: a PRC ID scan and a face match against it.
 * Desktops are the one place that reliably falls apart — many have no camera
 * at all, and those that do have a fixed front webcam that cannot photograph a
 * card held flat. Sending desktop users to a phone is kinder than letting them
 * start a five-step wizard they cannot finish.
 *
 * The browser never actually says "I am a desktop", so this is a judgement
 * made from three signals, ALL of which must agree:
 *
 *   1. running in a browser at all (never the installed app)
 *   2. the user agent does not name a phone or tablet
 *   3. the viewport is wide
 *   4. the device has no touch screen
 *
 * Requiring all four biases the answer toward "not desktop", which is the
 * safer mistake: a stray Sign Up button on a narrow desktop window costs
 * nothing, whereas hiding it from a nurse on a phone blocks registration
 * entirely.
 *
 * The touch check exists for iPadOS specifically — Safari there reports itself
 * as a Mac by default, so the user agent alone would classify an iPad as a
 * desktop and take signup away from it.
 */

/** Width at or above which a browser viewport is treated as desktop-sized. */
export const DESKTOP_MIN_WIDTH = 900;

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|PlayBook|BB10/i;

export function isDesktopBrowser(viewportWidth: number): boolean {
  // The installed app is never a desktop browser, whatever its window size.
  if (Platform.OS !== 'web') return false;

  // Guard every DOM access: this module is imported by native builds too, and
  // web rendering can run without a window (static export, prerender).
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent ?? '';
  if (MOBILE_UA.test(userAgent)) return false;

  // An iPad pretending to be a Mac still has a touch screen; a laptop does not.
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const hasTouch = maxTouchPoints > 1 || 'ontouchstart' in window;
  if (hasTouch) return false;

  return viewportWidth >= DESKTOP_MIN_WIDTH;
}
