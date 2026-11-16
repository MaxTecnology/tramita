import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'

interface StageTimes {
  columns: { columnId: string; title: string; totalBusinessDays: number; avgBusinessDays: number }[]
  os: { taskId: string; title: string; officeBusinessDays: number; clientBusinessDays: number; state: string }[]
}

const days = (n: number) => `${n} ${n === 1 ? 'dia útil' : 'dias úteis'}`

// Time per stage of a process: business days the OS spent in each column, and per OS how much was
// office work versus waiting for the client
export function StageTimesPanel({ boardId }: { boardId: string }) {
  const { data, isLoading } = useQuery<StageTimes>({
    queryKey: ['stage-times', boardId],
    queryFn: () => api.get(`/boards/${boardId}/stage-times`).then((r) => r.data),
  })
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Carregando...</p>
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="p-3 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por etapa</p>
        {data.columns.map((c) => (
          <div key={c.columnId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground">{c.title}</span>
            <span className="text-muted-foreground tabular-nums">{days(c.totalBusinessDays)} (média {c.avgBusinessDays})</span>
          </div>
        ))}
      </Card>
      <Card className="p-3 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por OS</p>
        {data.os.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma OS neste processo.</p>}
        {data.os.map((o) => (
          <div key={o.taskId} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground truncate">{o.title}</span>
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">{o.officeBusinessDays} do escritório · {o.clientBusinessDays} aguardando o cliente</span>
          </div>
        ))}
      </Card>
    </div>
  )
}

interface OSDashboard {
  delaysByReason: { reasonId: string; name: string; count: number }[]
  pendingReasons: number
  byModel: { kind: 'OS' | 'PROCESS'; id: string; name: string; count: number; avgOfficeBusinessDays: number; avgClientBusinessDays: number; lateCount: number }[]
}

// Dashboard cards: why things are late, what is still to be explained, office × client time per model
export function OSIndicators({ from, to }: { from: string; to: string }) {
  const { data } = useQuery<OSDashboard>({
    queryKey: ['dashboard-os', from, to],
    queryFn: () => api.get('/dashboard/os', { params: { from, to } }).then((r) => r.data),
  })
  if (!data) return null
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="p-4 space-y-2">
        <p className="text-sm font-semibold text-foreground">Atrasos por motivo</p>
        {data.delaysByReason.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum atraso no período.</p> : data.delaysByReason.map((r) => (
          <div key={r.reasonId} className="flex items-center justify-between text-sm">
            <span className="text-foreground">{r.name}</span>
            <span className="text-muted-foreground tabular-nums">{r.count}</span>
          </div>
        ))}
        {data.pendingReasons > 0 && (
          <p className="text-xs text-danger-text">{data.pendingReasons} OS ou processos concluídos com atraso sem motivo</p>
        )}
      </Card>
      <Card className="p-4 space-y-2 lg:col-span-2">
        <p className="text-sm font-semibold text-foreground">Tempo médio: escritório × cliente</p>
        {data.byModel.length === 0 ? <p className="text-sm text-muted-foreground">Nada concluído no período.</p> : data.byModel.map((m) => (
          <div key={`${m.kind}:${m.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-foreground">{m.name}<span className="ml-1.5 text-[10px] font-semibold text-muted-foreground">{m.kind === 'PROCESS' ? 'PROCESSO' : 'OS'}</span></span>
            <span className="text-muted-foreground tabular-nums">
              {`${m.avgOfficeBusinessDays} dias do escritório + ${m.avgClientBusinessDays} esperando o cliente (média de ${m.count})`}
              {m.lateCount > 0 && <span className="ml-2 text-danger-text">{m.lateCount} com atraso</span>}
            </span>
          </div>
        ))}
      </Card>
    </div>
  )
}
