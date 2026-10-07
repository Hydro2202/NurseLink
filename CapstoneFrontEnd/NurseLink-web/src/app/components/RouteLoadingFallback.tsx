import { Loader2 } from 'lucide-react';

/**
 * Shown for the brief moment a lazy-loaded route or component's chunk is
 * being fetched. Sized to sit inside the dashboard content area without
 * disturbing the persistent header/sidebar in DashboardLayout, and tall
 * enough to look intentional as a full-page fallback for the routes
 * rendered outside that layout (signup, admin).
 */
export default function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  );
}
