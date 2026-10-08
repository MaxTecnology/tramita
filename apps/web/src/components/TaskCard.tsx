import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'
import { computeSlaLevel } from '@/lib/sla'
import { useSlaConfig } from '@/hooks/useSlaConfig'

const PRIORITY_STYLES: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
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
        effectiveLevel === 'DUE_CRITICAL' ? 'border-red-400' : effectiveLevel === 'TARGET_WARNING' ? 'border-yellow-400' : 'border-border',
      )}
      onClick={onClick}
    >
      <p className="text-sm font-medium text-foreground mb-2 line-clamp-2">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {task.sourceRequestId && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-600" title="Originado de uma solicitação do cliente">
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
          <span className="text-xs text-red-500 font-medium">⚠ Prazo crítico</span>
        )}
        {effectiveLevel === 'TARGET_WARNING' && (
          <span className="text-xs text-yellow-600 font-medium">⏰ Meta próxima</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{daysOpen(task.createdAt)}</p>
    </div>
  )
}
