import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
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
