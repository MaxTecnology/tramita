import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/money'
import { formatDateOnlyUTC } from '@/lib/dates'
import { ScopeFilter, useScopeFilter, scopeParams } from '@/components/shared/ScopeFilter'
import { useMyScope } from '@/hooks/useMyScope'

export interface UnpaidGuide {
  id: string
  number: string
  title: string
  clientId: string
  clientName: string
  departmentName: string
  competence: string | null
  dueDate: string | null
  amount: string | null
  overdue: boolean
  paidAt: string | null
  paidAmount: string | null
  paidByName: string | null
  boardId: string
}

type Situation = '' | 'overdue' | 'upcoming' | 'paid'

const selectCls = 'h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground'

// Office view of payment guides sent to clients: who still hasn't paid (overdue first, amount
// prominent) so the team can call the client before interest grows. No notification — just visibility.
export default function UnpaidGuides() {
  const [clientId, setClientId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [competence, setCompetence] = useState('')
  const [situation, setSituation] = useState<Situation>('')

  const me = useMyScope()
  const [scopeFilter, setScopeFilter] = useScopeFilter('guides', me)

  const { data: guides = [], isLoading } = useQuery<UnpaidGuide[]>({
    queryKey: ['unpaid-guides', clientId, departmentId, competence, situation, scopeFilter],
    queryFn: () => api.get('/protocols/unpaid', {
      params: {
        ...scopeParams(scopeFilter),
        ...(clientId ? { clientId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(competence ? { competence } : {}),
        ...(situation ? { situation } : {}),
      },
    }).then((r) => r.data),
  })
  const { data: clients = [] } = useQuery<{ id: string; name: string; codigo: string | null }[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Guias não pagas</h1>
        <p className="text-sm text-muted-foreground">Guias enviadas aos clientes que eles ainda não marcaram como pagas.</p>
      </div>

      {me && <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />}

      <div className="flex flex-wrap gap-2">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={selectCls} aria-label="Cliente">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
        </select>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={selectCls} aria-label="Departamento">
          <option value="">Todos os departamentos</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className={selectCls} aria-label="Competência" />
        <select value={situation} onChange={(e) => setSituation(e.target.value as Situation)} className={selectCls} aria-label="Situação">
          <option value="">Não pagas</option>
          <option value="overdue">Vencidas</option>
          <option value="upcoming">A vencer</option>
          <option value="paid">Pagas</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : guides.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Receipt size={28} />
          <p className="text-sm">{situation === 'paid' ? 'Nenhuma guia paga com esses filtros.' : 'Nenhuma guia pendente de pagamento.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {guides.map((g) => (
            <Link
              key={g.id}
              to={`/app/board/${g.boardId}`}
              data-testid="guide-row"
              className={cn(
                'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-lg border bg-surface p-3 hover:bg-neutral-bg',
                g.overdue ? 'border-danger-text/40' : 'border-border',
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{g.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {g.clientName} · {g.departmentName}
                  {g.competence && ` · competência ${formatDateOnlyUTC(g.competence).slice(3)}`}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:justify-end">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {g.dueDate ? `Vence ${formatDateOnlyUTC(g.dueDate)}` : 'Sem vencimento'}
                </span>
                {g.overdue && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-danger-bg text-danger-text">Vencida</span>
                )}
                {g.paidAt && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success-bg text-success-text">
                    Pago{g.paidByName ? ` por ${g.paidByName}` : ''}
                  </span>
                )}
                <span className={cn('text-base font-semibold whitespace-nowrap', g.overdue ? 'text-danger-text' : 'text-foreground')}>
                  {g.amount ? formatBRL(g.amount) : '—'}
                </span>
              </div>
              {g.paidAt && g.paidAmount && g.amount && g.paidAmount !== g.amount && (
                <p className="text-xs text-warning-text sm:basis-full">
                  Valor informado pelo cliente: {formatBRL(g.paidAmount)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
