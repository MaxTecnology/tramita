import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Receipt, Send, LayoutGrid, CalendarClock } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/money'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { usePortalClient } from './Layout'

interface PortalHome {
  unpaidGuides: { count: number; overdueCount: number }
  documentsToSend: number
  processesInProgress: number
  dueThisWeek: { kind: 'guide' | 'request'; id: string; title: string; dueDate: string; amount?: string }[]
}

export default function PortalHomePage() {
  const { clientId } = usePortalClient()
  const { data, isLoading } = useQuery<PortalHome>({
    queryKey: ['portal-home', clientId],
    queryFn: () => api.get('/portal/home', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>

  const cards = [
    {
      to: '/portal/documents?situacao=a-pagar',
      icon: Receipt,
      label: 'Guias a pagar',
      value: data.unpaidGuides.count,
      hint: data.unpaidGuides.overdueCount > 0 ? `${data.unpaidGuides.overdueCount} vencida${data.unpaidGuides.overdueCount > 1 ? 's' : ''}` : null,
      tone: data.unpaidGuides.overdueCount > 0 ? 'border-danger-text' : 'border-warning-text',
    },
    { to: '/portal/send', icon: Send, label: 'Documentos a enviar', value: data.documentsToSend, hint: null, tone: 'border-accent-hover' },
    { to: '/portal/board', icon: LayoutGrid, label: 'Processos em andamento', value: data.processesInProgress, hint: null, tone: 'border-success-text' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-5">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Início</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map(({ to, icon: Icon, label, value, hint, tone }) => (
          <Link key={to} to={to} className={cn('rounded-lg border-l-4 bg-surface p-4 shadow-sm hover:bg-neutral-bg', tone)}>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon size={16} />
              {label}
            </div>
            <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
            {hint && <p className="text-xs font-medium text-danger-text">{hint}</p>}
          </Link>
        ))}
      </div>

      <section className="rounded-lg bg-surface p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock size={16} />
          Vencendo esta semana
        </h2>
        {data.dueThisWeek.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada vencendo nos próximos 7 dias.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.dueThisWeek.map((item) => {
              const overdue = isPastDateOnlyUTC(item.dueDate, new Date())
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    to={item.kind === 'guide' ? `/portal/documents/${item.id}` : '/portal/send'}
                    className="flex items-center justify-between gap-3 py-2 hover:bg-neutral-bg"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.kind === 'guide' ? 'Guia a pagar' : 'Documento a enviar'}</p>
                    </div>
                    <div className="text-right">
                      {item.amount && <p className="text-sm font-semibold text-foreground">{formatBRL(item.amount)}</p>}
                      <p className={cn('text-xs', overdue ? 'font-medium text-danger-text' : 'text-muted-foreground')}>
                        {overdue ? 'Venceu' : 'Vence'} {formatDateOnlyUTC(item.dueDate)}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
