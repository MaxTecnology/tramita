import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useRequestsBadgeStream } from '@/hooks/useRequestsBadgeStream'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList, ListChecks, Inbox, Menu, X, UserCircle, Building2, Repeat, UserCog, FileStack } from 'lucide-react'
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
  const isOrgRole = ORG_ROLES.includes(role)

  const { data: pendingCount } = useQuery<{ count: number }>({
    queryKey: ['requests-pending-count'],
    queryFn: () => api.get('/requests/pending-count').then((r) => r.data),
    enabled: isOrgRole,
    refetchOnWindowFocus: true,
  })

  useRequestsBadgeStream()

  return (
    <div className="flex h-screen bg-background">
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
          'fixed inset-y-0 left-0 z-50 w-56 bg-surface border-r border-border flex flex-col',
          'transition-transform duration-200',
          'md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent to-accent-hover flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground leading-none">Tramita</h1>
              <p className="text-xs text-muted-foreground truncate">{user?.name}</p>
            </div>
          </div>
          <button
            aria-label="Fechar menu"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {ORG_ROLES.includes(role) && (
            <SidebarSectionLabel>Geral</SidebarSectionLabel>
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/processes" icon={<ClipboardList size={16} />} label="Processos" onClick={handleNavClick} />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/os" icon={<FileStack size={16} />} label="Ordens de Serviço" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/tasks" icon={<ListChecks size={16} />} label="Tarefas" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink
              to="/app/requests"
              icon={<Inbox size={16} />}
              label="Solicitações"
              badge={pendingCount?.count}
              onClick={handleNavClick}
            />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/clients" icon={<UserCheck size={16} />} label="Clientes" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/users" icon={<Users size={16} />} label="Usuários" onClick={handleNavClick} />
          )}

          {ADMIN_ROLES.includes(role) && (
            <SidebarSectionLabel>Configurações</SidebarSectionLabel>
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
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/departments" icon={<Building2 size={16} />} label="Departamentos" onClick={handleNavClick} />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/client-users" icon={<UserCog size={16} />} label="Usuários de Cliente" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/recurring-templates" icon={<Repeat size={16} />} label="Tarefas Recorrentes" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/os-templates" icon={<FileStack size={16} />} label="Templates de OS" onClick={handleNavClick} />
          )}
        </nav>

        <div className="p-3 border-t border-border space-y-1">
          <SidebarLink to="/app/perfil" icon={<UserCircle size={16} />} label="Meu Perfil" onClick={handleNavClick} />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-neutral-bg"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top-bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-surface border-b border-border flex-shrink-0">
          <button
            aria-label="Abrir menu de navegação"
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-base font-bold text-accent">Tramita</h1>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1.5 mt-3 first:mt-0">
      {children}
    </div>
  )
}

function SidebarLink({
  to,
  icon,
  label,
  badge,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
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
            ? 'bg-neutral-bg text-accent font-medium'
            : 'text-muted-foreground hover:bg-neutral-bg',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!badge && badge > 0 && (
        <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-danger-text text-danger-foreground text-xs font-medium flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </NavLink>
  )
}
