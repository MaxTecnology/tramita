import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  allowedRoles: string[]
  children: React.ReactNode
}

export function ProtectedRoute({ allowedRoles, children }: Props) {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!allowedRoles.includes(user?.role ?? '')) return <Navigate to="/login" replace />
  return <>{children}</>
}
