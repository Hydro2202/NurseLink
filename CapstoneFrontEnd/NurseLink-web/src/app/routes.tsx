import { createBrowserRouter, Navigate } from 'react-router';
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import NurseTasksPage from './pages/NurseTasksPage';
import HandoverPage from './pages/HandoverPage';
import ChartingPage from './pages/ChartingPage';
import KardexPage from './pages/KardexPage';
import AnalyticsPage from './pages/AnalyticsPage';
import WorkloadPage from './pages/WorkloadPage';
import SettingsPage from './pages/SettingsPage';
import MyPatientsPage from './pages/MyPatientsPage';
import AllPatientsPage from './pages/AllPatientsPage';

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
    element: <SignUpPage />,
  },
  {
    path: '/',
    element: <DashboardLayout />,
    children: [
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'tasks',
        element: <TasksPage />,
      },
      {
        path: 'nurse-tasks/:nurseName',
        element: <NurseTasksPage />,
      },
      {
        path: 'handover',
        element: <HandoverPage />,
      },
      {
        path: 'charting',
        element: <ChartingPage />,
      },
      {
        path: 'kardex',
        element: <KardexPage />,
      },
      {
        path: 'analytics',
        element: <AnalyticsPage />,
      },
      {
        path: 'workload',
        element: <WorkloadPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: 'my-patients',
        element: <MyPatientsPage />,
      },
      {
        path: 'all-patients',
        element: <AllPatientsPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
]);