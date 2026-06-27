import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList, Inbox, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on navigation (mobile)
  const handleNavClick = () => setSidebarOpen(false)

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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-200 flex flex-col',
          'transition-transform duration-200',
          'md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-blue-600">Tramita</h1>
            <p className="text-xs text-gray-500 truncate">{user?.name}</p>
          </div>
          <button
            aria-label="Fechar menu"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/processes" icon={<ClipboardList size={16} />} label="Processos" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/requests" icon={<Inbox size={16} />} label="Solicitações" onClick={handleNavClick} />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/clients" icon={<UserCheck size={16} />} label="Clientes" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/users" icon={<Users size={16} />} label="Usuários" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/templates" icon={<Settings size={16} />} label="Templates" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/notifications" icon={<Bell size={16} />} label="Notificações" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/subscription" icon={<CreditCard size={16} />} label="Assinatura" onClick={handleNavClick} />
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top-bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <button
            aria-label="Abrir menu de navegação"
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-gray-500 hover:text-gray-700"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-base font-bold text-blue-600">Tramita</h1>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarLink({
  to,
  icon,
  label,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
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
