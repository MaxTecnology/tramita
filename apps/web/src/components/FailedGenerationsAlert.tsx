import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useRetryFailedGeneration } from '@/hooks/useRetryFailedGeneration'
import type { FailedGeneration } from '@/types'

const VIEWER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

function competenceLabel(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

// Tarefa recorrente que não nasceu é uma obrigação do cliente que ninguém vai fazer — fica no topo
// do Dashboard, com o motivo e o atalho pra corrigir, até não haver mais falha pendente.
export function FailedGenerationsAlert() {
  const { user } = useAuth()
  const canView = VIEWER_ROLES.includes(user?.role ?? '')
  const retry = useRetryFailedGeneration()

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: canView,
    refetchInterval: 60_000,
  })

  if (!canView || failures.length === 0) return null

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
      <div className="flex items-center gap-2 text-red-700">
        <AlertTriangle size={16} />
        <p className="text-sm font-semibold">{failures.length} tarefa(s) recorrente(s) não foram geradas</p>
      </div>
      <ul className="space-y-2">
        {failures.map((f) => (
          <li key={`${f.templateId}-${f.clientId}-${f.competence}`} className="rounded-md bg-surface border border-red-100 px-3 py-2 space-y-1">
            <p className="text-sm text-foreground">
              <span className="font-medium">{f.templateTitle}</span> — {f.clientName} — competência {competenceLabel(f.competence)}
            </p>
            <p className="text-xs text-red-700">{f.errorMessage}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Link to={`/app/clients?edit=${f.clientId}`} className="text-accent hover:underline">Abrir cliente</Link>
              <Link to={`/app/settings/recurring-templates/${f.templateId}/manage`} className="text-accent hover:underline">Abrir template</Link>
              {f.retryable && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={retry.isPending} onClick={() => retry.mutate(f)}>
                  Gerar novamente
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
