import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft } from 'lucide-react'
import { useBoard } from '@/hooks/useBoard'
import { useBoardStream } from '@/hooks/useBoardStream'
import { api } from '@/lib/api'
import { TaskCard } from '@/components/TaskCard'
import { TaskModal } from '@/components/TaskModal'
import type { Task } from '@/types'

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
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const hasFilters = search.trim() !== '' || filterPriority !== ''

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
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
        <Link to="/app/dashboard" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{board.title}</h1>
          <p className="text-sm text-gray-500">{board.client.name}</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 px-6 py-2 border-b border-gray-100 bg-white">
        <input
          type="text"
          placeholder="Buscar tarefas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        <div className="px-6 py-3 border-b border-gray-100 bg-yellow-50">
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

      <div className="flex-1 overflow-x-auto p-6">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full">
            {board.columns.map((column) => (
              <div key={column.id} className="flex-shrink-0 w-64">
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
                  <div className="flex flex-col gap-2 min-h-[4rem] rounded-lg bg-gray-50 p-2">
                    {column.tasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTask(task)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} onClick={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
