import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { homeForRole } from '@/lib/homeForRole'

// Unknown address: without a session it is the login; with one, say so and lead back to the start
// of that profile (sending a logged person to the login looked like being logged out)
export default function NotFound() {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-foreground">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço não existe ou foi removido.</p>
        <Link to={homeForRole(user.role)} className="inline-block text-sm font-medium text-accent-hover hover:underline">
          Voltar para o início
        </Link>
      </div>
    </div>
  )
}
