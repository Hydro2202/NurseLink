import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../contexts/LiveContext';

/**
 * Keeps the signed-in nurse's own department/shift current on this device —
 * ported from mobile's ProfileSyncListener.
 *
 * AuthContext fetches the profile once at sign-in and otherwise never
 * refetches it, so when a head nurse reassigns a nurse's department/shift,
 * that nurse's own session kept showing the old values until they happened
 * to log out and back in.
 *
 * Driven by LiveContext's `profile` revision rather than a notification: a
 * notification is gated by that nurse's own preferences, and this has to
 * stay correct regardless — it's account data, not an alert.
 *
 * Renders nothing — mounted once near the root of the signed-in app.
 */
export function ProfileSyncListener() {
  const { refreshUser } = useAuth();
  useLiveRefresh('profile', () => {
    void refreshUser();
  });
  return null;
}
