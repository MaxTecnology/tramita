import { createContext, useContext, useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayoutGrid, User, LogOut, Inbox, Home, FileText, Send } from 'lucide-react'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'
import { NotificationBell } from '@/components/shared/NotificationBell'
import { useInboxStream } from '@/hooks/useInboxStream'
import type { InAppNotification } from '@/components/shared/notifications'

// Document-centric portal: what the client received, what they must send, processes in progress.
// shortLabel fits the 6-tab bottom bar on phones.
const tabs = [
  { to: '/portal/home', icon: Home, label: 'Início', shortLabel: 'Início' },
  { to: '/portal/documents', icon: FileText, label: 'Documentos recebidos', shortLabel: 'Recebidos' },
  { to: '/portal/send', icon: Send, label: 'Enviar documentos', shortLabel: 'Enviar' },
  { to: '/portal/board', icon: LayoutGrid, label: 'Processos', shortLabel: 'Processos' },
  { to: '/portal/requests', icon: Inbox, label: 'Solicitações', shortLabel: 'Pedidos' },
  { to: '/portal/profile', icon: User, label: 'Perfil', shortLabel: 'Perfil' },
] as const

interface PortalClientContextValue {
  clientId: string
  setClientId: (id: string) => void
  clients: { id: string; name: string }[]
}

const PortalClientContext = createContext<PortalClientContextValue | null>(null)

export function usePortalClient(): PortalClientContextValue {
  const ctx = useContext(PortalClientContext)
  if (!ctx) throw new Error('usePortalClient must be used within PortalLayout')
  return ctx
}

export default function PortalLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  useInboxStream()

  const { data: accessibleClients = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-clients'],
    queryFn: () => api.get('/portal/clients').then((r) => r.data),
  })

  const [selectedClientId, setSelectedClientId] = useState<string>(() => localStorage.getItem('portal-client-id') ?? '')

  useEffect(() => {
    if (accessibleClients.length === 0) return
    if (!accessibleClients.some((c) => c.id === selectedClientId)) {
      setSelectedClientId(accessibleClients[0].id)
    }
  }, [accessibleClients])

  useEffect(() => {
    if (selectedClientId) localStorage.setItem('portal-client-id', selectedClientId)
  }, [selectedClientId])

  // A stored id from a company the user no longer accesses (or deleted) is never used: pages wait
  // until the list arrives and the selection is valid (no 404 for a stale company)
  const validClientId = accessibleClients.some((c) => c.id === selectedClientId) ? selectedClientId : ''

  // A notification about another company switches the portal to it before opening
  const openNotification = (n: InAppNotification) => {
    if (n.clientId && accessibleClients.some((c) => c.id === n.clientId)) setSelectedClientId(n.clientId)
  }

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      try { await api.post('/auth/logout', { refreshToken }) } catch { /* ignore */ }
    }
    logout()
    navigate('/login')
  }

  return (
    <PortalClientContext.Provider
      value={{ clientId: validClientId, setClientId: setSelectedClientId, clients: accessibleClients }}
    >
      <div className="flex h-screen bg-background">
        {/* Sidebar — desktop only */}
        <aside className="hidden md:flex w-52 bg-surface border-r border-border flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-accent">Tramita</h1>
              <NotificationBell base="/portal" onOpen={openNotification} />
            </div>
            <p className="text-xs text-foreground font-medium truncate mt-0.5">{user?.orgName}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.name}</p>
            {accessibleClients.length > 1 && (
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="mt-2 w-full rounded-md border border-border bg-surface text-foreground text-xs px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {accessibleClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {tabs.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive ? 'bg-neutral-bg text-accent font-medium' : 'text-muted-foreground hover:bg-neutral-bg',
                  )
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="p-3 border-t border-border space-y-1">
            <ChangePasswordDialog triggerClassName="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-neutral-bg" />
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-neutral-bg"
            >
              <LogOut size={16} />
              Sair
            </button>
          </div>
        </aside>

        {/* Main content — pb-16 evita conteúdo atrás da tab bar no mobile */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          {/* Top bar — mobile only: bell and, with more than one company, the selector */}
          <div className="md:hidden sticky top-0 z-40 bg-surface border-b border-border px-4 py-2 flex items-center gap-2">
            {accessibleClients.length > 1 ? (
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="flex-1 min-w-0 rounded-md border border-border bg-surface text-foreground text-sm px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {accessibleClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <h1 className="flex-1 text-base font-bold text-accent">Tramita</h1>
            )}
            <NotificationBell base="/portal" onOpen={openNotification} align="right" />
          </div>
          <Outlet />
        </main>

        {/* Bottom tab bar — mobile only */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-surface border-t border-border flex h-16">
          {tabs.map(({ to, icon: Icon, shortLabel: label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 transition-colors',
                  isActive ? 'text-accent' : 'text-muted-foreground',
                )
              }
            >
              <Icon size={20} />
              <span className="text-[10px] font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </PortalClientContext.Provider>
  )
}
