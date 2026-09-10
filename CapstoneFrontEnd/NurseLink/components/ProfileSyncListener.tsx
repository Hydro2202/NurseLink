import { useAuth } from '../contexts/AuthContext';
import { useLiveRefresh } from '../contexts/LiveContext';

/**
 * Keeps the signed-in nurse's own department/shift current on this device.
 *
 * AuthContext fetches the profile once at sign-in and otherwise never
 * refetches it — so when a supervisor reassigns a nurse's department/shift
 * (see NurseViewSet.assign), that nurse's own session kept showing the old
 * values (Settings, the Dashboard greeting's shift label, etc.) until they
 * happened to log out and back in.
 *
 * Driven by LiveContext's `profile` revision (department:shift, server-
 * computed in LiveStateView) rather than the `nurse_reassigned`
 * notification: a notification is gated by that nurse's own
 * task_notifications preference, and this has to stay correct even when
 * that preference is off — it's account data, not an alert. Same
 * push-or-poll cadence every other live area (tasks, handovers, patients)
 * already uses.
 *
 * Renders nothing — mount once, near the root of the signed-in app, same as
 * HandoverAlertModal.
 */
export function ProfileSyncListener() {
  const { refreshUser } = useAuth();
  useLiveRefresh('profile', () => {
    void refreshUser();
  });
  return null;
}
