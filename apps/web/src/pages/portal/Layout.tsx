import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayoutGrid, User, LogOut, Inbox } from 'lucide-react'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'

const tabs = [
  { to: '/portal/board', icon: LayoutGrid, label: 'Processos' },
  { to: '/portal/requests', icon: Inbox, label: 'Solicitações' },
  { to: '/portal/profile', icon: User, label: 'Perfil' },
] as const

export default function PortalLayout() {
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

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-52 bg-white border-r border-gray-200 flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-[#185FA5]">Tramita</h1>
          <p className="text-xs text-gray-800 font-medium truncate mt-0.5">{user?.orgName}</p>
          <p className="text-xs text-gray-500 truncate">{user?.name}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {tabs.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-blue-50 text-[#185FA5] font-medium' : 'text-gray-600 hover:bg-gray-100',
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200 space-y-1">
          <ChangePasswordDialog triggerClassName="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100" />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content — pb-16 evita conteúdo atrás da tab bar no mobile */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Bottom tab bar — mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-200 flex h-16">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors',
                isActive ? 'text-[#185FA5]' : 'text-gray-400',
              )
            }
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
