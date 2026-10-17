import { Redirect } from 'expo-router';

/**
 * Analytics was folded into the head nurse dashboard's own Analytics
 * section (see dashboard.tsx + components/dashboard/AnalyticsSection.tsx).
 * This route stays so old bookmarks/links keep working, redirecting
 * straight to that section instead of 404ing.
 */
export default function AnalyticsRedirect() {
  return <Redirect href={'/(app)/dashboard?section=analytics' as any} />;
}
