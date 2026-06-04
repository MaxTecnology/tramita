import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBoard } from '@/hooks/useBoard'
import { useBoardStream } from '@/hooks/useBoardStream'
import { api } from '@/lib/api'
import { TaskCard } from '@/components/TaskCard'
import { TaskDrawer } from '@/components/shared/TaskDrawer'
import { useAuth } from '@/hooks/useAuth'
import type { Task } from '@/types'

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className="flex flex-col gap-2 min-h-[4rem] rounded-lg bg-gray-50 p-2">
      {children}
    </div>
  )
}

function SortableTaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onClick={onClick} />
    </div>
  )
}

export default function Board() {
  const { boardId } = useParams<{ boardId: string }>()
  const { board, isLoading, moveTask } = useBoard(boardId!)
  useBoardStream(boardId)
  const qc = useQueryClient()
  const { user } = useAuth()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const hasFilters = search.trim() !== '' || filterPriority !== ''
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')

  // Computed values for board due date
  const boardDueDate = board?.dueDate ? new Date(board.dueDate) : null
  const boardDueDateOverdue = boardDueDate ? boardDueDate < new Date() : false

  const createTaskMutation = useMutation({
    mutationFn: ({ columnId, title }: { columnId: string; title: string }) =>
      api.post(`/columns/${columnId}/tasks`, { title }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board', boardId] })
      setAddingToColumn(null)
      setNewTaskTitle('')
    },
  })

  function handleAddTask(columnId: string) {
    if (!newTaskTitle.trim()) return
    createTaskMutation.mutate({ columnId, title: newTaskTitle.trim() })
  }

  const { data: searchResults } = useQuery<Task[]>({
    queryKey: ['board-search', boardId, search, filterPriority],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (filterPriority) params.set('priority', filterPriority)
      return api.get(`/boards/${boardId}/tasks/search?${params}`).then((r) => r.data)
    },
    enabled: !!boardId && hasFilters,
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragStart(event: DragStartEvent) {
    const allTasks = board?.columns.flatMap((c) => c.tasks) ?? []
    const task = allTasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over || !board) return

    const taskId = active.id as string
    const targetColumn =
      board.columns.find((col) => col.id === over.id) ??
      board.columns.find((col) => col.tasks.some((t) => t.id === over.id))

    if (!targetColumn) return

    const currentColumn = board.columns.find((col) => col.tasks.some((t) => t.id === taskId))
    if (currentColumn?.id === targetColumn.id) return

    const position = targetColumn.tasks.length
    moveTask({ taskId, columnId: targetColumn.id, position })
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando board...</div>
  if (!board) return <div className="p-8 text-gray-500">Board não encontrado.</div>

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 bg-white flex-shrink-0">
        <Link to="/app/processes" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base md:text-lg font-semibold text-gray-900 truncate">{board.title}</h1>
          <p className="text-xs md:text-sm text-gray-500 truncate">{board.client.name}</p>
        </div>
        {boardDueDate && (
          <span className={cn(
            'text-xs px-2 py-1 rounded-full font-medium flex-shrink-0',
            boardDueDateOverdue
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-50 text-amber-700'
          )}>
            {boardDueDateOverdue ? '⚠ ' : ''}{boardDueDate.toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-2 border-b border-gray-100 bg-white">
        <input
          type="text"
          placeholder="Buscar tarefas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0 h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Prioridade</option>
          <option value="LOW">Baixa</option>
          <option value="MEDIUM">Média</option>
          <option value="HIGH">Alta</option>
          <option value="URGENT">Urgente</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setFilterPriority('')
            }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Search results */}
      {hasFilters && searchResults && (
        <div className="px-4 md:px-6 py-3 border-b border-gray-100 bg-yellow-50">
          <p className="text-xs text-gray-500 mb-2">{searchResults.length} resultado(s)</p>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {searchResults.map((task) => (
              <div
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="bg-white rounded-lg p-2.5 border border-gray-200 cursor-pointer hover:shadow-sm text-sm flex items-center justify-between"
              >
                <span className="font-medium text-gray-800">{task.title}</span>
                <span className="text-xs text-gray-400 ml-2">{task.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 md:gap-4 h-full">
            {board.columns.map((column) => (
              <div key={column.id} className="flex-shrink-0 w-[220px] sm:w-[240px] md:w-64">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">{column.title}</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                    {column.tasks.length}
                  </span>
                </div>
                <SortableContext
                  id={column.id}
                  items={column.tasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <DroppableColumn id={column.id}>
                    {column.tasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTask(task)}
                      />
                    ))}
                  </DroppableColumn>
                </SortableContext>

                {addingToColumn === column.id ? (
                  <div className="mt-2 p-1">
                    <input
                      autoFocus
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTask(column.id)
                        if (e.key === 'Escape') { setAddingToColumn(null); setNewTaskTitle('') }
                      }}
                      placeholder="Nome da tarefa..."
                      className="w-full text-sm rounded-md border border-gray-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex gap-2 mt-1.5">
                      <button
                        onClick={() => handleAddTask(column.id)}
                        disabled={!newTaskTitle.trim() || createTaskMutation.isPending}
                        className="text-xs bg-[#185FA5] text-white px-3 py-1 rounded hover:bg-[#0C447C] disabled:opacity-50"
                      >
                        {createTaskMutation.isPending ? '...' : 'Adicionar'}
                      </button>
                      <button
                        onClick={() => { setAddingToColumn(null); setNewTaskTitle('') }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingToColumn(column.id); setNewTaskTitle('') }}
                    className="mt-2 w-full text-left text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 flex items-center gap-1"
                  >
                    <Plus size={12} />
                    Adicionar tarefa
                  </button>
                )}
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} onClick={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedTask && user && (
        <TaskDrawer
          task={selectedTask}
          currentUserId={user.id}
          role={user.role as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'}
          boardDueDate={board.dueDate}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
