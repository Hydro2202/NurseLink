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
const TasksPage = lazy(() => import('./pages/TasksPage'));
const NurseTasksPage = lazy(() => import('./pages/NurseTasksPage'));
const HandoverPage = lazy(() => import('./pages/HandoverPage'));
const ChartingPage = lazy(() => import('./pages/ChartingPage'));
const KardexPage = lazy(() => import('./pages/KardexPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const WorkloadPage = lazy(() => import('./pages/WorkloadPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MyPatientsPage = lazy(() => import('./pages/MyPatientsPage'));
const AllPatientsPage = lazy(() => import('./pages/AllPatientsPage'));

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
        path: 'analytics',
        element: lazyRoute(<AnalyticsPage />),
      },
      {
        path: 'workload',
        element: lazyRoute(<WorkloadPage />),
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
    ],
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
]);
