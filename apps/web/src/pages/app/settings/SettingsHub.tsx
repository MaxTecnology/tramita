import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import type { FailedGeneration } from '@/types'
import { ADMIN_ONLY, settingsGroupsFor } from './settingsNav'

// Entry of the settings: every page the person can open, grouped like the side menu
export default function SettingsHub() {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const groups = settingsGroupsFor(role)

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: ADMIN_ONLY.includes(role),
  })

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">Como o escritório trabalha no Tramita: estrutura, rotinas, comunicação e robô.</p>
      </div>
      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-2 text-sm font-semibold text-foreground">{group.title}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.pages.map((p) => {
                const Icon = p.icon
                const badge = p.failuresBadge ? failures.length : 0
                return (
                  <Link
                    key={p.to}
                    to={p.to}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-neutral-bg text-accent">
                      <Icon size={18} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{p.title}</span>
                        {badge > 0 && (
                          <span
                            aria-label={`${badge} ${badge === 1 ? 'geração com falha' : 'gerações com falha'}`}
                            className="min-w-5 rounded-full bg-danger-text px-1.5 text-center text-xs font-medium text-danger-foreground"
                          >
                            {badge > 9 ? '9+' : badge}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{p.description}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
