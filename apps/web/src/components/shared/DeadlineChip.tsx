import { cn } from '@/lib/utils'
import type { DeadlineInfo } from '@/types'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Situation of the internal deadline of an OS or process, in words (business days; pauses while the
// client is awaited)
export function deadlineLabel(d: DeadlineInfo, waitingFor?: string): string | null {
  switch (d.state) {
    case 'ON_TIME':
    case 'DUE_SOON': {
      const left = d.businessDaysLeft ?? 0
      if (left === 0) return 'vence hoje'
      return left === 1 ? 'falta 1 dia útil' : `faltam ${left} dias úteis`
    }
    case 'LATE': return `atrasada há ${plural(d.businessDaysLate ?? 0, 'dia útil', 'dias úteis')}`
    case 'PAUSED':
      if (d.pausedSinceDays === undefined) return '⏸ aguardando cliente'
      return d.pausedSinceDays === 0 ? '⏸ aguardando cliente desde hoje' : `⏸ aguardando cliente há ${plural(d.pausedSinceDays, 'dia', 'dias')}`
    case 'WAITING_DEPENDENCY': return waitingFor ? `aguardando ${waitingFor}` : 'aguardando outra OS'
    case 'DONE': return 'concluída'
    default: return null
  }
}

const TONE: Record<DeadlineInfo['state'], string> = {
  NONE: '',
  ON_TIME: 'bg-success-bg text-success-text',
  DUE_SOON: 'bg-warning-bg text-warning-text',
  LATE: 'bg-danger-bg text-danger-text',
  PAUSED: 'bg-info-bg text-info-text',
  WAITING_DEPENDENCY: 'bg-neutral-bg text-muted-foreground',
  DONE: 'bg-neutral-bg text-muted-foreground',
}

export function DeadlineChip({ deadline, waitingFor, className }: { deadline: DeadlineInfo; waitingFor?: string; className?: string }) {
  const label = deadlineLabel(deadline, waitingFor)
  if (!label) return null
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', TONE[deadline.state], className)}>{label}</span>
}

// Marks a task that is an OS (and the process it belongs to) in task lists
export function OSTag({ model, process, className }: { model: string; process?: string | null; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}>
      <span title={`Ordem de serviço: ${model}`} className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-info-bg text-info-text">OS</span>
      {process && <span className="text-[11px] text-muted-foreground">{process}</span>}
    </span>
  )
}
