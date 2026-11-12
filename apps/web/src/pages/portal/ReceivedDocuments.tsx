import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Inbox, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/money'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { Input } from '@/components/ui/input'
import { usePortalClient } from './Layout'
import { documentState, STATE_UI, type ReceivedDocument } from './receivedDocuments'

const selectCls = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground'

export default function ReceivedDocuments() {
  const { clientId } = usePortalClient()
  const [params, setParams] = useSearchParams()
  const situacao = params.get('situacao') ?? ''
  const [search, setSearch] = useState('')
  const [competence, setCompetence] = useState('')
  const [departmentId, setDepartmentId] = useState('')

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-departments', clientId],
    queryFn: () => api.get('/portal/departments', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })
  const { data: docs = [], isLoading } = useQuery<ReceivedDocument[]>({
    queryKey: ['portal-protocols', clientId, situacao, search, competence, departmentId],
    queryFn: () => api.get('/portal/protocols', {
      params: {
        clientId,
        ...(search ? { search } : {}),
        ...(competence ? { competence } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(situacao === 'a-pagar' ? { paymentStatus: 'unpaid' } : situacao === 'pagos' ? { paymentStatus: 'paid' } : {}),
      },
    }).then((r) => r.data),
    enabled: !!clientId,
  })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Documentos recebidos</h1>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar documento..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className={selectCls} aria-label="Competência" />
        {departments.length > 1 && (
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={selectCls} aria-label="Departamento">
            <option value="">Todos os departamentos</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <select
          value={situacao}
          onChange={(e) => setParams(e.target.value ? { situacao: e.target.value } : {})}
          className={selectCls}
          aria-label="Situação"
        >
          <option value="">Todos</option>
          <option value="a-pagar">A pagar</option>
          <option value="pagos">Pagos</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Inbox size={40} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum documento</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const overdue = !!d.dueDate && isPastDateOnlyUTC(d.dueDate, new Date())
            const st = STATE_UI[documentState(d, overdue)]
            return (
              <Link key={d.id} to={`/portal/documents/${d.id}`} className="block rounded-lg border border-border bg-surface px-4 py-3 hover:bg-neutral-bg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.departmentName}
                      {d.competence && ` · competência ${formatDateOnlyUTC(d.competence).slice(3)}`}
                      {d.dueDate && ` · vence ${formatDateOnlyUTC(d.dueDate)}`}
                    </p>
                    {d.fileUpdatedAt && (
                      <p className="text-xs text-muted-foreground">Documento atualizado em {new Date(d.fileUpdatedAt).toLocaleDateString('pt-BR')}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {d.requiresPayment && d.amount && <span className="text-sm font-semibold text-foreground">{formatBRL(d.amount)}</span>}
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', st.cls)}>{st.label}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
