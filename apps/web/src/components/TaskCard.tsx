import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'
import { computeSlaLevel } from '@/lib/sla'
import { useSlaConfig } from '@/hooks/useSlaConfig'

const PRIORITY_STYLES: Record<Task['priority'], string> = {
  LOW: 'bg-neutral-bg text-muted-foreground',
  MEDIUM: 'bg-info-bg text-info-text',
  HIGH: 'bg-warning-bg text-warning-text',
  URGENT: 'bg-danger-bg text-danger-text',
}

const PRIORITY_LABELS: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

function daysOpen(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Aberta hoje'
  if (days === 1) return 'Aberta há 1 dia'
  return `Aberta há ${days} dias`
}

interface Props {
  task: Task
  onClick: () => void
}

export function TaskCard({ task, onClick }: Props) {
  const slaConfig = useSlaConfig()
  const slaLevel = computeSlaLevel(
    task.targetDate ? new Date(task.targetDate) : null,
    task.dueDate ? new Date(task.dueDate) : null,
    new Date(),
    slaConfig,
  )
  const isAlertActive = task.status !== 'DONE' && task.status !== 'DISREGARDED' && slaLevel !== 'NONE'
  const effectiveLevel = isAlertActive ? slaLevel : 'NONE'

  return (
    <div
      className={cn(
        'bg-surface rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow select-none',
        effectiveLevel === 'DUE_CRITICAL' ? 'border-danger-text/60' : effectiveLevel === 'TARGET_WARNING' ? 'border-warning-text' : 'border-border',
      )}
      onClick={onClick}
    >
      <p className="text-sm font-medium text-foreground mb-2 line-clamp-2">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {task.sourceRequestId && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-highlight-bg text-highlight-text" title="Originado de uma solicitação do cliente">
            <Inbox size={11} />
            Solicitação
          </span>
        )}
        <span
          className={cn(
            'inline-flex text-xs font-medium px-2 py-0.5 rounded-full',
            PRIORITY_STYLES[task.priority],
          )}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
        {effectiveLevel === 'DUE_CRITICAL' && (
          <span className="text-xs text-danger-text font-medium">⚠ Prazo crítico</span>
        )}
        {effectiveLevel === 'TARGET_WARNING' && (
          <span className="text-xs text-warning-text font-medium">⏰ Meta próxima</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{daysOpen(task.createdAt)}</p>
    </div>
  )
}
