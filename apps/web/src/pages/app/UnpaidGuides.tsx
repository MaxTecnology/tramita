import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/money'
import { formatDateOnlyUTC, formatCompetence } from '@/lib/dates'
import { ScopeFilter, useScopeFilter, scopeParams } from '@/components/shared/ScopeFilter'
import { useMyScope } from '@/hooks/useMyScope'
import { PageHeader } from '@/components/ui/page-header'
import { ListTable, ROW_OPENER } from '@/components/ui/list-table'

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
  link?: string
}

type Situation = '' | 'overdue' | 'upcoming' | 'paid'

const selectCls = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

// Office view of payment guides sent to clients: who still hasn't paid (overdue first, amount
// prominent) so the team can call the client before interest grows. No notification — just visibility.
export default function UnpaidGuides() {
  const [clientId, setClientId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [dueMonth, setDueMonth] = useState('')
  const [situation, setSituation] = useState<Situation>('')

  const me = useMyScope()
  const [scopeFilter, setScopeFilter] = useScopeFilter('guides', me)

  const { data: guides = [], isLoading } = useQuery<UnpaidGuide[]>({
    queryKey: ['unpaid-guides', clientId, departmentId, dueMonth, situation, scopeFilter],
    queryFn: () => api.get('/protocols/unpaid', {
      params: {
        ...scopeParams(scopeFilter),
        ...(clientId ? { clientId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(dueMonth ? { dueMonth } : {}),
        ...(situation ? { situation } : {}),
      },
    }).then((r) => r.data),
  })
  const { data: clients = [] } = useQuery<{ id: string; name: string; codigo: string | null }[]>({
    // Deactivated ones too: their old guides may still be unpaid
    queryKey: ['clients', { includeInactive: true }],
    queryFn: () => api.get('/clients', { params: { includeInactive: true } }).then((r) => r.data),
  })
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Guias não pagas"
        description="Guias enviadas aos clientes que eles ainda não marcaram como pagas. As vencidas vêm primeiro."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {me && <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />}
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={selectCls} aria-label="Filtrar por cliente">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
        </select>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={selectCls} aria-label="Filtrar por departamento">
          <option value="">Todos os departamentos</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={situation} onChange={(e) => setSituation(e.target.value as Situation)} className={selectCls} aria-label="Situação">
          <option value="">Todas as não pagas</option>
          <option value="overdue">Vencidas</option>
          <option value="upcoming">A vencer</option>
          <option value="paid">Já pagas</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Vencimento no mês
          <input type="month" value={dueMonth} onChange={(e) => setDueMonth(e.target.value)} className={selectCls} aria-label="Vencimento no mês" />
        </label>
        {dueMonth && <button type="button" onClick={() => setDueMonth('')} className="h-9 px-2 text-sm text-muted-foreground hover:text-foreground">Limpar mês</button>}
      </div>

      <ListTable<UnpaidGuide>
        label="Guias"
        loading={isLoading}
        rows={guides}
        rowKey={(g) => g.id}
        interactive
        empty={
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Receipt size={28} aria-hidden />
            <p className="text-sm">{situation === 'paid' ? 'Nenhuma guia paga com esses filtros.' : 'Nenhuma guia pendente de pagamento.'}</p>
          </div>
        }
        columns={[
          {
            header: 'Guia', width: 'minmax(0,2fr)',
            cell: (g) => (
              <div className="min-w-0">
                <Link to={g.link ?? `/app/board/${g.boardId}`} data-testid="guide-row" className={cn(ROW_OPENER, 'block truncate text-sm')}>{g.title}</Link>
                <p className="truncate text-xs text-muted-foreground">
                  {g.clientName} · {g.departmentName}
                  {g.competence && ` · competência ${formatCompetence(g.competence)}`}
                </p>
              </div>
            ),
          },
          {
            header: 'Vencimento', width: '9rem',
            cell: (g) => (
              <span className={cn('text-sm', g.overdue ? 'font-medium text-danger-text' : 'text-foreground')}>
                {g.dueDate ? formatDateOnlyUTC(g.dueDate) : 'Sem vencimento'}
              </span>
            ),
          },
          {
            header: 'Situação', width: '11rem',
            cell: (g) => (
              <div className="flex flex-col items-start gap-0.5">
                {g.paidAt ? (
                  <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-text">Pago{g.paidByName ? ` por ${g.paidByName}` : ''}</span>
                ) : g.overdue ? (
                  <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger-text">Vencida</span>
                ) : (
                  <span className="rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-medium text-muted-foreground">A vencer</span>
                )}
                {g.paidAt && g.paidAmount && g.amount && g.paidAmount !== g.amount && (
                  <span className="text-xs text-warning-text">Cliente informou {formatBRL(g.paidAmount)}</span>
                )}
              </div>
            ),
          },
          {
            header: 'Valor', width: '8rem', align: 'right',
            cell: (g) => <span className={cn('text-sm font-semibold tabular-nums', g.overdue ? 'text-danger-text' : 'text-foreground')}>{g.amount ? formatBRL(g.amount) : '—'}</span>,
          },
        ]}
      />
    </div>
  )
}
