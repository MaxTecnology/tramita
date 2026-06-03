import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { X } from 'lucide-react'
import { Comments } from '@/components/portal/Comments'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'

interface TaskHistory {
  id: string
  action: string
  fromValue: string | null
  toValue: string | null
  actorName: string
  createdAt: string
}

interface Props {
  task: Task
  onClose: () => void
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

export function TaskDrawer({ task, onClose }: Props) {
  const { data: history = [] } = useQuery<TaskHistory[]>({
    queryKey: ['task-history', task.id],
    queryFn: () => api.get(`/portal/tasks/${task.id}/history`).then((r) => r.data),
  })

  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate) < new Date()

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-96 bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-base font-semibold text-gray-900 leading-tight">{task.title}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLOR[task.priority])}>
                {PRIORITY_LABEL[task.priority]}
              </span>
              {task.dueDate && (
                <span className={cn('text-xs', isOverdue ? 'text-red-500 font-medium' : 'text-gray-500')}>
                  {isOverdue ? '⚠ ' : ''}Prazo: {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {task.description && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Descrição</h3>
              <p className="text-sm text-gray-700">{task.description}</p>
            </div>
          )}

          {history.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Histórico</h3>
              <div className="relative pl-4">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200" />
                {history.map((h) => (
                  <div key={h.id} className="relative mb-3 last:mb-0">
                    <div className="absolute -left-[11px] top-1.5 w-2 h-2 rounded-full bg-blue-400" />
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">{h.actorName}</span>
                      {' — '}
                      {h.action}
                      {h.toValue && <span className="text-gray-500"> → {h.toValue}</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(h.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Comentários</h3>
            <Comments taskId={task.id} />
          </div>
        </div>
      </aside>
    </>
  )
}
