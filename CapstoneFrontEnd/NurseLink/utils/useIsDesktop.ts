import { Platform } from 'react-native';
import { useWindowDimensions } from 'react-native';

/**
 * Width at or above which a *web* viewport counts as desktop for compact
 * button/layout sizing — matches the convention already used ad hoc for
 * desktop/mobile-chrome switching in app/(app)/_layout.tsx (`isDesktop =
 * width >= 1024`) and NurseLink-web's DashboardLayout.tsx
 * (`window.innerWidth >= 1024`).
 *
 * Deliberately NOT the same threshold or signals as isDesktopBrowser.ts —
 * that helper answers a different question ("can this device take a selfie
 * for signup?"), biased hard toward "not desktop" via a 900px floor plus
 * user-agent and touch checks. This hook only ever needs "is there enough
 * width, on the web, to show a compact button instead of a full-height
 * touch target" — a native tablet at this same width must still get the
 * 44px touch sizing, which is why Platform.OS === 'web' gates this and
 * isDesktopBrowser's touch/UA checks do not apply here.
 */
export const DESKTOP_MIN_WIDTH = 1024;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
