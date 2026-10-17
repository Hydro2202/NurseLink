import { Redirect } from 'expo-router';

/**
 * Workload Monitor was folded into the head nurse dashboard's own Workload
 * section (see dashboard.tsx + components/dashboard/WorkloadSection.tsx).
 * This route stays so old bookmarks/links — including notify_safety_alert's
 * action_path on notifications saved before that change — keep working,
 * redirecting straight to that section instead of 404ing.
 */
export default function WorkloadRedirect() {
  return <Redirect href={'/(app)/dashboard?section=workload' as any} />;
}
