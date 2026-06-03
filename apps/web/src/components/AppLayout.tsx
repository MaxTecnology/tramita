import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      try { await api.post('/auth/logout', { refreshToken }) } catch { /* ignore */ }
    }
    logout()
    navigate('/login')
  }

  const role = user?.role ?? ''

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-600">Tramita</h1>
          <p className="text-xs text-gray-500 truncate">{user?.name}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/clients" icon={<UserCheck size={16} />} label="Clientes" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/users" icon={<Users size={16} />} label="Usuários" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/templates" icon={<Settings size={16} />} label="Templates" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/notifications" icon={<Bell size={16} />} label="Notificações" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/subscription" icon={<CreditCard size={16} />} label="Assinatura" />
          )}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function SidebarLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
