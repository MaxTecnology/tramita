import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ClipboardList } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { TaskDrawer, STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR } from '@/components/shared/TaskDrawer'
import { cn } from '@/lib/utils'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import type { Task } from '@/types'
import { usePortalClient } from './Layout'

// GET /portal/tasks já cobre o mesmo formato de Task usado no board — inclui tarefas
// recorrentes (que moram no board de sistema RECURRING_SYSTEM, nunca listado por /portal/boards).
interface PortalTaskListItem extends Task {
  department: { id: string; name: string } | null
  column: { id: string; title: string; board: { id: string; clientId: string } }
}

export default function PortalTasks() {
  const { user } = useAuth()
  const { clientId } = usePortalClient()
  const [selectedTask, setSelectedTask] = useState<PortalTaskListItem | null>(null)

  const { data: tasks = [], isLoading } = useQuery<PortalTaskListItem[]>({
    queryKey: ['portal-tasks', clientId],
    queryFn: () => api.get('/portal/tasks', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Minhas Tarefas</h1>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <ClipboardList size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma tarefa encontrada</p>
          <p className="text-xs mt-1">Tarefas recorrentes e de processos aparecem aqui quando disponíveis.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => {
            const isOverdue = task.dueDate !== null && task.status !== 'DONE' && isPastDateOnlyUTC(task.dueDate)
            return (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                aria-label={`Abrir tarefa: ${task.title}`}
                onClick={() => setSelectedTask(task)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedTask(task)}
                className={cn(
                  'bg-surface rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow',
                  isOverdue ? 'border-red-400' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground line-clamp-2">{task.title}</p>
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0', STATUS_COLOR[task.status])}>
                    {STATUS_LABEL[task.status]}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLOR[task.priority])}>
                    {PRIORITY_LABEL[task.priority]}
                  </span>
                  {task.department?.name && (
                    <span className="text-xs text-muted-foreground">{task.department.name}</span>
                  )}
                  {task.targetDate && (
                    <span className={cn('text-xs ml-auto', isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground')}>
                      {isOverdue ? '⚠ ' : ''}{formatDateOnlyUTC(task.targetDate)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          currentUserId={user?.id ?? ''}
          role="CLIENT"
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
