import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Metrics {
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  }
  tasksByStatus: {
    OPEN: number
    BLOCKED: number
    DONE: number
    DISREGARDED: number
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
  BLOCKED: 'Com Impedimento',
  DONE: 'Concluído',
  DISREGARDED: 'Desconsiderado',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-accent',
  BLOCKED: 'bg-danger-text',
  DONE: 'bg-success-text',
  DISREGARDED: 'bg-neutral-text',
}

function formatDaysOverdue(daysOverdue: number, dueDate: string | null): string {
  if (!dueDate) return ''
  if (daysOverdue > 0) return `Vencido há ${daysOverdue}d`
  if (daysOverdue === 0) return 'Vence hoje'
  return `Vence em ${Math.abs(daysOverdue)}d`
}

function OverviewContent({ data }: { data: Metrics }) {
  const { kpis, tasksByStatus, atRisk } = data
  const maxTaskCount = Math.max(...Object.values(tasksByStatus), 1)

  const kpiCards = [
    { label: 'Processos ativos', value: kpis.activeBoards, color: 'border-accent', textColor: 'text-accent' },
    { label: 'Atrasados', value: kpis.overdueBoards, color: 'border-warning-text', textColor: 'text-warning-text' },
    { label: 'Concluídos no mês', value: kpis.completedTasksThisMonth, color: 'border-success-text', textColor: 'text-success-text' },
    { label: 'Tarefas urgentes abertas', value: kpis.urgentOpenTasks, color: 'border-danger-text', textColor: 'text-danger-text' },
  ]

  return (
    <div className="space-y-4 md:space-y-6 pt-4">
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

interface OnTimeBucket {
  onTime: number
  late: number
  applicable: number
}

interface MetricsBreakdown {
  volume: { os: number; recurring: number }
  onTimeRate: { target: OnTimeBucket; due: OnTimeBucket }
  avgCompletionDays: { os: number | null; recurring: number | null }
  lateClosureCount: number
  currentLoad: { os: number; recurring: number }
  blocked: { taskCount: number; totalDays: number }
}

interface PersonMetrics extends MetricsBreakdown { userId: string; userName: string }
interface DepartmentMetrics extends MetricsBreakdown { departmentId: string; departmentName: string }

interface ProductivityMetrics {
  period: { from: string; to: string }
  byPerson: PersonMetrics[]
  byDepartment: DepartmentMetrics[]
}

type Preset = '7d' | '30d' | '90d' | 'month' | 'custom'

function presetToRange(preset: Preset, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  const now = new Date()
  if (preset === 'custom') {
    return {
      from: customFrom ? new Date(customFrom) : new Date(now.getFullYear(), now.getMonth(), 1),
      to: customTo ? new Date(customTo) : now,
    }
  }
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { from, to: now }
}

function formatRate(bucket: OnTimeBucket): string {
  if (bucket.applicable === 0) return 'N/A'
  return `${Math.round((bucket.onTime / bucket.applicable) * 100)}%`
}

function formatDays(days: number | null): string {
  return days === null ? '—' : days.toFixed(1)
}

function ProductivityTable({ metrics, viewBy }: { metrics: ProductivityMetrics; viewBy: 'person' | 'department' }) {
  const rows = viewBy === 'person' ? metrics.byPerson : metrics.byDepartment
  const lateClosureTotal = metrics.byPerson.reduce((sum, p) => sum + p.lateClosureCount, 0)

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase">
              <th className="text-left py-2 px-3">{viewBy === 'person' ? 'Pessoa' : 'Departamento'}</th>
              <th className="px-3">Volume (OS | Rec.)</th>
              <th className="px-3">% Meta</th>
              <th className="px-3">% Vencimento</th>
              <th className="px-3">Tempo médio (dias)</th>
              <th className="px-3">Carga atual (OS | Rec.)</th>
              <th className="px-3">Impedimento</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Nenhum dado no período selecionado</td></tr>
            ) : rows.map((row) => {
              const key = viewBy === 'person' ? (row as PersonMetrics).userId : (row as DepartmentMetrics).departmentId
              const label = viewBy === 'person' ? (row as PersonMetrics).userName : (row as DepartmentMetrics).departmentName
              return (
                <tr key={key} className="border-t border-border">
                  <td className="py-2 px-3">{label}</td>
                  <td className="text-center px-3">{row.volume.os} | {row.volume.recurring}</td>
                  <td className="text-center px-3">{formatRate(row.onTimeRate.target)}</td>
                  <td className="text-center px-3">{formatRate(row.onTimeRate.due)}</td>
                  <td className="text-center px-3">{formatDays(row.avgCompletionDays.os)} | {formatDays(row.avgCompletionDays.recurring)}</td>
                  <td className="text-center px-3">{row.currentLoad.os} | {row.currentLoad.recurring}</td>
                  <td className="text-center px-3">{row.blocked.taskCount} ({row.blocked.totalDays.toFixed(1)}d)</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        {lateClosureTotal} tarefa(s) com indício de fechamento tardio no período.
      </p>
    </div>
  )
}

function ProductivityTab() {
  const { user } = useAuth()
  const isManagerOrAdmin = ['ORG_ADMIN', 'ORG_MANAGER'].includes(user?.role ?? '')

  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [userId, setUserId] = useState('')
  const [boardType, setBoardType] = useState<'' | 'OS' | 'RECURRING_SYSTEM'>('')
  const [viewBy, setViewBy] = useState<'person' | 'department'>('person')

  // `now` só pode ser recalculado quando o preset/intervalo muda — presetToRange chama `new
  // Date()` internamente, e se isso rodasse a cada render, `from`/`to` seriam objetos novos toda
  // vez, a queryKey abaixo nunca ficaria estável, e o React Query entraria num loop de refetch
  // infinito (foi exatamente o que aconteceu até essa correção: bateu no rate limit do backend).
  const { from, to } = useMemo(
    () => presetToRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
    enabled: isManagerOrAdmin,
  })

  const { data: teamMembers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['dashboard-team-members'],
    queryFn: () => api.get('/dashboard/team-members').then((r) => r.data),
    enabled: isManagerOrAdmin,
  })

  const { data: metrics, isLoading } = useQuery<ProductivityMetrics>({
    queryKey: ['productivity-metrics', from.toISOString(), to.toISOString(), departmentId, userId, boardType],
    queryFn: () => api.get('/dashboard/productivity', {
      params: {
        from: from.toISOString(), to: to.toISOString(),
        ...(departmentId ? { departmentId } : {}),
        ...(userId ? { userId } : {}),
        ...(boardType ? { boardType } : {}),
      },
    }).then((r) => r.data),
  })

  const PRESET_LABEL: Record<Preset, string> = {
    '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', month: 'Mês atual', custom: 'Personalizado',
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['7d', '30d', '90d', 'month', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors',
                preset === p ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
              )}
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="pm-from">De</Label>
              <Input id="pm-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-to">Até</Label>
              <Input id="pm-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}

        {isManagerOrAdmin && (
          <div className="space-y-1">
            <Label htmlFor="pm-department">Departamento</Label>
            <select
              id="pm-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="flex h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
            >
              <option value="">Todos</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        {isManagerOrAdmin && (
          <div className="space-y-1">
            <Label htmlFor="pm-person">Pessoa</Label>
            <select
              id="pm-person"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="flex h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
            >
              <option value="">Todos</option>
              {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="pm-boardtype">Tipo</Label>
          <select
            id="pm-boardtype"
            value={boardType}
            onChange={(e) => setBoardType(e.target.value as typeof boardType)}
            className="flex h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
          >
            <option value="">OS + Recorrente</option>
            <option value="OS">Só OS</option>
            <option value="RECURRING_SYSTEM">Só Recorrente</option>
          </select>
        </div>

        {isManagerOrAdmin && (
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['person', 'department'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewBy(v)}
                className={cn(
                  'px-3 py-2 text-sm font-medium transition-colors',
                  viewBy === v ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
                )}
              >
                {v === 'person' ? 'Por pessoa' : 'Por departamento'}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading || !metrics ? (
        <p className="text-muted-foreground">Carregando produtividade...</p>
      ) : (
        <ProductivityTable metrics={metrics} viewBy={isManagerOrAdmin ? viewBy : 'person'} />
      )}
    </div>
  )
}

export default function DashboardMetrics() {
  const [tab, setTab] = useState<'overview' | 'productivity'>('overview')
  const { data, isLoading } = useQuery<Metrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => api.get('/dashboard/metrics').then((r) => r.data),
    refetchInterval: 60_000,
  })

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Dashboard</h1>

      <div className="flex border-b border-border">
        {(['overview', 'productivity'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t ? 'border-[#185FA5] text-[#185FA5]' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'overview' ? 'Visão geral' : 'Produtividade'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        isLoading || !data ? (
          <div className="p-8 text-muted-foreground">Carregando métricas...</div>
        ) : (
          <OverviewContent data={data} />
        )
      )}

      {tab === 'productivity' && <ProductivityTab />}
    </div>
  )
}
