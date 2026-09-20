import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Metrics {
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  }
  tasksByStatus: {
    OPEN: number
    IN_PROGRESS: number
    REVIEW: number
    DONE: number
  }
  atRisk: Array<{
    boardId: string
    boardTitle: string
    clientName: string
    mostUrgentDueDate: string | null
    daysOverdue: number
  }>
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Andamento',
  REVIEW: 'Revisão',
  DONE: 'Concluído',
}

// REVIEW usa roxo (bg-violet-400) intencionalmente fora dos tokens — é só uma
// cor categórica de gráfico (4 status distintos), não um estado semântico
// (warning/success/danger) reaproveitado em outro lugar do app.
const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-accent',
  IN_PROGRESS: 'bg-warning-text',
  REVIEW: 'bg-violet-400',
  DONE: 'bg-success-text',
}

function formatDaysOverdue(daysOverdue: number, dueDate: string | null): string {
  if (!dueDate) return ''
  if (daysOverdue > 0) return `Vencido há ${daysOverdue}d`
  if (daysOverdue === 0) return 'Vence hoje'
  return `Vence em ${Math.abs(daysOverdue)}d`
}

export default function DashboardMetrics() {
  const { data, isLoading } = useQuery<Metrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => api.get('/dashboard/metrics').then((r) => r.data),
    refetchInterval: 60_000,
  })

  if (isLoading || !data) {
    return <div className="p-8 text-muted-foreground">Carregando métricas...</div>
  }

  const { kpis, tasksByStatus, atRisk } = data

  const maxTaskCount = Math.max(...Object.values(tasksByStatus), 1)

  const kpiCards = [
    { label: 'Processos ativos', value: kpis.activeBoards, color: 'border-accent', textColor: 'text-accent' },
    { label: 'Atrasados', value: kpis.overdueBoards, color: 'border-warning-text', textColor: 'text-warning-text' },
    { label: 'Concluídos no mês', value: kpis.completedTasksThisMonth, color: 'border-success-text', textColor: 'text-success-text' },
    { label: 'Tarefas urgentes abertas', value: kpis.urgentOpenTasks, color: 'border-danger-text', textColor: 'text-danger-text' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div key={card.label} className={cn('bg-surface rounded-lg border-l-4 p-4 shadow-sm', card.color)}>
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className={cn('text-3xl font-bold mt-1', card.textColor)}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de barras — tarefas por status */}
        <div className="lg:col-span-2 bg-surface rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Tarefas por status</h2>
          <div className="flex items-end gap-2 md:gap-6 h-40">
            {Object.entries(tasksByStatus).map(([status, count]) => (
              <div key={status} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{count}</span>
                <div className="w-full flex items-end" style={{ height: '100px' }}>
                  <div
                    className={cn('w-full rounded-t-md transition-all', STATUS_COLORS[status])}
                    style={{ height: `${Math.max((count / maxTaskCount) * 100, count > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Painel em risco */}
        <div className="bg-surface rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Em risco</h2>
            <Link to="/app/processes" className="text-xs text-accent hover:underline">
              Ver todos
            </Link>
          </div>

          {atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum processo em risco 🎉</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-72">
              {atRisk.map((item) => {
                const isOverdue = item.daysOverdue > 0
                return (
                  <Link
                    key={item.boardId}
                    to={`/app/board/${item.boardId}`}
                    className={cn(
                      'block rounded-md p-3 border-l-2 hover:bg-neutral-bg transition-colors',
                      isOverdue ? 'border-danger-text bg-danger-bg' : 'border-warning-text bg-warning-bg',
                    )}
                  >
                    <p className="text-sm font-medium text-foreground truncate">{item.boardTitle}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.clientName}</p>
                    <p className={cn('text-xs font-medium mt-0.5', isOverdue ? 'text-danger-text' : 'text-warning-text')}>
                      {formatDaysOverdue(item.daysOverdue, item.mostUrgentDueDate)}
                    </p>
                  </Link>
                )
              })}
            </div>
          )}

          <Link
            to="/app/processes"
            className="mt-3 block text-center text-xs text-accent hover:underline"
          >
            Ver todos os processos →
          </Link>
        </div>
      </div>
    </div>
  )
}
