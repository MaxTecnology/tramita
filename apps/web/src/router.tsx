import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import AppLayout from '@/components/AppLayout'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import MasterLayout from '@/pages/master/Layout'
import MasterDashboard from '@/pages/master/Dashboard'
import MasterPlans from '@/pages/master/Plans'
import MasterOrganizations from '@/pages/master/Organizations'
import OrgSubscription from '@/pages/org/Subscription'
import Dashboard from '@/pages/app/Dashboard'
import Board from '@/pages/app/Board'
import Clients from '@/pages/app/Clients'
import Users from '@/pages/app/Users'
import Templates from '@/pages/app/settings/Templates'
import Notifications from '@/pages/app/settings/Notifications'
import AppSubscription from '@/pages/app/settings/Subscription'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/master',
    element: <MasterLayout />,
    children: [
      { index: true, element: <Navigate to="/master/dashboard" replace /> },
      { path: 'dashboard', element: <MasterDashboard /> },
      { path: 'plans', element: <MasterPlans /> },
      { path: 'organizations', element: <MasterOrganizations /> },
    ],
  },
  { path: '/org/subscription', element: <OrgSubscription /> },
  {
    path: '/app',
    element: (
      <ProtectedRoute allowedRoles={ORG_ROLES}>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'board/:boardId', element: <Board /> },
      {
        path: 'clients',
        element: (
          <ProtectedRoute allowedRoles={MANAGER_ROLES}>
            <Clients />
          </ProtectedRoute>
        ),
      },
      {
        path: 'users',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Users />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/templates',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Templates />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/notifications',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Notifications />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/subscription',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <AppSubscription />
          </ProtectedRoute>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
])
