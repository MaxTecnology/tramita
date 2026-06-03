import { cn } from '@/lib/utils'
import type { Task } from '@/types'

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
  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate) < new Date()

  return (
    <div
      className={cn(
        'bg-white rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow select-none',
        isOverdue ? 'border-red-400' : 'border-gray-200',
      )}
      onClick={onClick}
    >
      <p className="text-sm font-medium text-gray-800 mb-2 line-clamp-2">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            'inline-flex text-xs font-medium px-2 py-0.5 rounded-full',
            PRIORITY_STYLES[task.priority],
          )}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
        {isOverdue && (
          <span className="text-xs text-red-500 font-medium">⚠ Prazo vencido</span>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-1.5">{daysOpen(task.createdAt)}</p>
    </div>
  )
}
