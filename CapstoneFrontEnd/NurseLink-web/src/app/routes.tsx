import { Suspense, lazy, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './layouts/DashboardLayout';
import RouteLoadingFallback from './components/RouteLoadingFallback';

// Everything except the login page and the shared dashboard shell loads on
// demand: these are the modules a first-time, unauthenticated visit never
// needs. See DEPLOYMENT.md-equivalent notes in the PR for before/after sizes.
const SignUpPage = lazy(() => import('./pages/SignUpPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const NurseTasksPage = lazy(() => import('./pages/NurseTasksPage'));
const HandoverPage = lazy(() => import('./pages/HandoverPage'));
const ChartingPage = lazy(() => import('./pages/ChartingPage'));
const KardexPage = lazy(() => import('./pages/KardexPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MyPatientsPage = lazy(() => import('./pages/MyPatientsPage'));
const AllPatientsPage = lazy(() => import('./pages/AllPatientsPage'));
const DutyRosterPage = lazy(() => import('./pages/DutyRosterPage'));
const MyDutyPage = lazy(() => import('./pages/MyDutyPage'));

// One Suspense boundary per route element (not one global one) — so
// switching between two lazy pages inside DashboardLayout only shows the
// fallback in the content area, never blanks the persistent header/sidebar.
function lazyRoute(element: ReactNode) {
  return <Suspense fallback={<RouteLoadingFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/signup',
    element: lazyRoute(<SignUpPage />),
  },
  {
    path: '/admin',
    element: lazyRoute(<AdminDashboardPage />),
  },
  {
    path: '/',
    element: <DashboardLayout />,
    children: [
      {
        path: 'dashboard',
        element: lazyRoute(<DashboardPage />),
      },
      {
        path: 'tasks',
        element: lazyRoute(<TasksPage />),
      },
      {
        path: 'nurse-tasks/:nurseName',
        element: lazyRoute(<NurseTasksPage />),
      },
      {
        path: 'handover',
        element: lazyRoute(<HandoverPage />),
      },
      {
        path: 'charting',
        element: lazyRoute(<ChartingPage />),
      },
      {
        path: 'kardex',
        element: lazyRoute(<KardexPage />),
      },
      {
        // The one Analytics destination — stats, charts and workload all
        // live on this single page now (see pages/AnalyticsPage.tsx).
        path: 'analytics',
        element: lazyRoute(<AnalyticsPage />),
      },
      {
        // Workload Monitor is no longer its own page — its content now
        // lives on the Analytics page. This route stays so old bookmarks/
        // links — including notify_safety_alert's action_path on
        // notifications saved before that change — keep working.
        path: 'workload',
        element: <Navigate to="/analytics?section=workload" replace />,
      },
      {
        path: 'settings',
        element: lazyRoute(<SettingsPage />),
      },
      {
        path: 'my-patients',
        element: lazyRoute(<MyPatientsPage />),
      },
      {
        path: 'all-patients',
        element: lazyRoute(<AllPatientsPage />),
      },
      {
        path: 'duty-roster',
        element: lazyRoute(<DutyRosterPage />),
      },
      {
        path: 'my-duty',
        element: lazyRoute(<MyDutyPage />),
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
]);
