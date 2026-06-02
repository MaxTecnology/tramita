import { createBrowserRouter, Navigate } from 'react-router-dom'
import Login from '@/pages/Login'
import MasterLayout from '@/pages/master/Layout'
import MasterDashboard from '@/pages/master/Dashboard'
import MasterPlans from '@/pages/master/Plans'
import MasterOrganizations from '@/pages/master/Organizations'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
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
  { path: '*', element: <Navigate to="/login" replace /> },
])
