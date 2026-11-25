import { useState } from 'react'
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
  // Geração e tela de vínculos do template são só de admin (rotas adminOnly) — o gerente vê a falha
  // e pode corrigir o cliente, mas não as ações que dariam 403.
  const isAdmin = user?.role === 'ORG_ADMIN'
  const retry = useRetryFailedGeneration()

  const { data: allFailures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: canView,
    refetchInterval: 60_000,
  })

  // Falha sem como reprocessar (vínculo removido, cliente desativado) não fica presa no topo do
  // Dashboard — o console de geração em Configurações continua mostrando todas.
  const failures = allFailures.filter((f) => f.retryable)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? failures : failures.slice(0, 3)

  if (!canView || failures.length === 0) return null

  return (
    <div role="alert" className="rounded-lg border border-danger-text/30 bg-danger-bg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-danger-text">
          <AlertTriangle size={16} aria-hidden />
          {failures.length === 1 ? '1 tarefa recorrente não foi gerada' : `${failures.length} tarefas recorrentes não foram geradas`}
        </p>
        {isAdmin && (
          <Link to="/app/settings/recurring-generation" className="text-xs font-medium text-accent hover:underline">Ver todas em Geração manual</Link>
        )}
      </div>
      <ul className="divide-y divide-danger-text/20 rounded-md border border-danger-text/30 bg-surface">
        {shown.map((f) => (
          <li key={`${f.templateId}-${f.clientId}-${f.competence}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-foreground">
                <span className="font-medium">{f.templateTitle}</span>
                <span className="text-muted-foreground"> · {f.clientName} · competência {competenceLabel(f.competence)}</span>
              </p>
              <p className="text-xs text-danger-text">{f.errorMessage}</p>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-3 text-xs">
              <Link to={`/app/clients?edit=${f.clientId}`} className="text-accent hover:underline">Abrir cliente</Link>
              {isAdmin && (
                <Link to={`/app/settings/recurring-templates/${f.templateId}/manage`} className="text-accent hover:underline">Abrir tarefa recorrente</Link>
              )}
              {isAdmin && f.retryable && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={retry.isPending} onClick={() => retry.mutate(f)}>
                  Gerar novamente
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {failures.length > 3 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-medium text-danger-text hover:underline">
          {showAll ? 'Mostrar menos' : `Mostrar mais ${failures.length - 3}`}
        </button>
      )}
    </div>
  )
}
