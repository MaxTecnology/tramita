import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ArrowLeft, Search } from 'lucide-react'
import { useBoardStream } from '@/hooks/useBoardStream'
import { TaskDrawer } from '@/components/portal/TaskDrawer'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import type { Board, Task } from '@/types'

export default function PortalBoard() {
  const { boardId } = useParams<{ boardId: string }>()
  useBoardStream(boardId)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [titleSearch, setTitleSearch] = useState('')
  const { user } = useAuth()

  const { data: board, isLoading } = useQuery<Board>({
    queryKey: ['portal-board', boardId],
    queryFn: () => api.get(`/boards/${boardId}`).then((r) => r.data),
    enabled: !!boardId,
  })

  const PRIORITY_LABELS: Record<string, string> = {
    LOW: 'Baixa',
    MEDIUM: 'Média',
    HIGH: 'Alta',
    URGENT: 'Urgente',
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>
  if (!board) return <div className="p-8 text-gray-500">Processo não encontrado.</div>

  const allTasks = board.columns.flatMap((c) => c.tasks)
  const doneTasks = allTasks.filter((t) => t.status === 'DONE').length
  const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0

  const filteredColumns = board.columns.map((col) => ({
    ...col,
    tasks: titleSearch.trim()
      ? col.tasks.filter((t) =>
          t.title.toLowerCase().includes(titleSearch.toLowerCase()),
        )
      : col.tasks,
  }))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
        <Link to="/portal/board" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-900">{board.title}</h1>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', progress >= 80 ? 'bg-green-500' : 'bg-[#185FA5]')}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 flex-shrink-0">{progress}% concluído</span>
          </div>
        </div>
      </div>

      {/* Title search */}
      <div className="px-4 md:px-6 py-2 border-b border-gray-100 bg-white">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por título..."
            value={titleSearch}
            onChange={(e) => setTitleSearch(e.target.value)}
            className="w-full h-8 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <div className="flex gap-3 md:gap-4 h-full">
          {filteredColumns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-[280px] md:w-64">
              <div
                className="flex items-center justify-between mb-3 pb-2 border-b-2"
                style={{ borderBottomColor: column.color ?? '#e5e7eb' }}
              >
                <h3 className="text-sm font-semibold text-gray-700">{column.title}</h3>
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                  {column.tasks.length}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {column.tasks.map((task) => {
                  const isOverdue =
                    task.dueDate !== null &&
                    task.status !== 'DONE' &&
                    new Date(task.dueDate) < new Date()

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={cn(
                        'bg-white rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow',
                        isOverdue ? 'border-red-400' : 'border-gray-200',
                      )}
                    >
                      <p className="text-sm font-medium text-gray-800 line-clamp-2">{task.title}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          {
                            LOW: 'bg-gray-100 text-gray-600',
                            MEDIUM: 'bg-blue-100 text-blue-600',
                            HIGH: 'bg-orange-100 text-orange-600',
                            URGENT: 'bg-red-100 text-red-600',
                          }[task.priority],
                        )}>
                          {PRIORITY_LABELS[task.priority] ?? task.priority}
                        </span>
                        {task.dueDate && (
                          <span className={cn('text-xs', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                            {isOverdue ? '⚠ ' : ''}{new Date(task.dueDate).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

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
