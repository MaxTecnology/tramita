import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import type { FailedGeneration } from '@/types'
import { ADMIN_ONLY, settingsGroupsFor } from './settingsNav'

// Settings pages share a side menu on wide screens (move between pages without going back to the
// hub); on phones the hub of cards is the menu and each page shows a way back to it.
export default function SettingsLayout() {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const { pathname } = useLocation()
  const groups = settingsGroupsFor(role)

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: ADMIN_ONLY.includes(role),
  })

  return (
    <div className="flex min-h-full">
      <nav aria-label="Configurações" className="hidden lg:block w-60 flex-shrink-0 border-r border-border bg-surface/60">
        <div className="sticky top-0 max-h-screen overflow-y-auto px-3 py-5">
          <NavLink to="/app/settings" end className="block px-2 pb-3 text-sm font-semibold text-foreground hover:text-accent">
            Configurações
          </NavLink>
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.title}</p>
                <ul className="space-y-0.5">
                  {g.pages.map((p) => {
                    const active = pathname === p.to || pathname.startsWith(`${p.to}/`)
                    const Icon = p.icon
                    return (
                      <li key={p.to}>
                        <NavLink
                          to={p.to}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                            active ? 'bg-neutral-bg font-medium text-foreground' : 'text-muted-foreground hover:bg-neutral-bg hover:text-foreground',
                          )}
                        >
                          <Icon size={15} aria-hidden className={active ? 'text-accent' : undefined} />
                          <span className="flex-1 truncate">{p.title}</span>
                          {p.failuresBadge && failures.length > 0 && (
                            <span
                              aria-label={`${failures.length} ${failures.length === 1 ? 'geração com falha' : 'gerações com falha'}`}
                              className="min-w-5 rounded-full bg-danger-text px-1.5 text-center text-xs font-medium text-danger-foreground"
                            >
                              {failures.length > 9 ? '9+' : failures.length}
                            </span>
                          )}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
