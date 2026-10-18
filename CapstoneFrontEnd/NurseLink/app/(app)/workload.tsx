import { Redirect } from 'expo-router';

/**
 * Workload Monitor is no longer its own nav destination — its content
 * (Nurse Workload + Patient Assignments) now lives on the Analytics page
 * (see analytics.tsx + components/dashboard/WorkloadSection.tsx). This
 * route stays so old bookmarks/links keep working, redirecting straight to
 * that section instead of 404ing.
 */
export default function WorkloadRedirect() {
  return <Redirect href={'/(app)/analytics?section=workload' as any} />;
}
