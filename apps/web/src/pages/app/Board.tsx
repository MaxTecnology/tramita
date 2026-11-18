import { useState } from 'react'
import { StageTimesPanel } from '@/components/shared/StageTimesPanel'
import { AddOSDialog } from '@/components/process/AddOSDialog'
import { ProcessDelayReason } from '@/components/process/ProcessDelayReason'
import { DeadlineChip } from '@/components/shared/DeadlineChip'
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
import { cn, mensagemDeErro } from '@/lib/utils'
import { useServedDepartments } from '@/hooks/useServedDepartments'
import { useBoard } from '@/hooks/useBoard'
import { useBoardStream } from '@/hooks/useBoardStream'
import { api } from '@/lib/api'
import { TaskCard } from '@/components/TaskCard'
import { TaskDrawer, PRIORITY_LABEL } from '@/components/shared/TaskDrawer'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { useAuth } from '@/hooks/useAuth'
import type { Task } from '@/types'
import { useLinkedItem } from '@/hooks/useLinkedItem'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { toast } from 'sonner'

// The whole column (as tall as the longest one) takes the drop: a card from the bottom of a long
// column can be dropped on any other column at the same height
function DroppableColumn({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <section ref={setNodeRef} aria-label={title} className="flex w-[280px] flex-shrink-0 flex-col md:w-64">
      {children}
    </section>
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
  // Guarda só o id, não o objeto Task — o objeto é derivado ao vivo de `board` a cada render
  // (abaixo), pra que o TaskDrawer sempre reflita o estado atual da tarefa depois de uma edição
  // (ex.: título), em vez de um snapshot tirado no momento do clique que nunca se atualiza.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const clearLinkedTask = useLinkedItem('task', setSelectedTaskId)
  const selectedTask = selectedTaskId
    ? (board?.columns.flatMap((c) => c.tasks).find((t) => t.id === selectedTaskId) ?? null)
    : null
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [search, setSearch] = useState('')
  const [showStageTimes, setShowStageTimes] = useState(false)
  const [addingOS, setAddingOS] = useState(false)
  const [filterPriority, setFilterPriority] = useState('')
  const [filterCompetence, setFilterCompetence] = useState('')
  const hasFilters = search.trim() !== '' || filterPriority !== '' || filterCompetence !== ''
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDepartmentId, setNewTaskDepartmentId] = useState('')

  const { departments } = useServedDepartments(board?.clientId)

  // Computed values for board due date
  const boardDueDate = board?.dueDate ? new Date(board.dueDate) : null
  const boardDueDateOverdue = board?.dueDate ? isPastDateOnlyUTC(board.dueDate) : false

  const createTaskMutation = useMutation({
    mutationFn: ({ columnId, title, departmentId }: { columnId: string; title: string; departmentId: string }) =>
      api.post(`/columns/${columnId}/tasks`, { title, departmentId }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Tarefa criada')
      qc.invalidateQueries({ queryKey: ['board', boardId] })
      setAddingToColumn(null)
      setNewTaskTitle('')
      setNewTaskDepartmentId('')
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao criar tarefa')),
  })

  function handleAddTask(columnId: string) {
    if (!newTaskTitle.trim() || !newTaskDepartmentId) return
    createTaskMutation.mutate({ columnId, title: newTaskTitle.trim(), departmentId: newTaskDepartmentId })
  }

  const { data: searchResults } = useQuery<Task[]>({
    queryKey: ['board-search', boardId, search, filterPriority, filterCompetence],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (filterPriority) params.set('priority', filterPriority)
      if (filterCompetence) {
        const [year, month] = filterCompetence.split('-').map(Number)
        params.set('competence', new Date(Date.UTC(year, month - 1, 1)).toISOString())
      }
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

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando processo...</div>
  if (!board) return <div className="p-8 text-muted-foreground">Processo não encontrado.</div>

  const filterCls = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 border-b border-border bg-surface px-4 pt-4 pb-3 md:px-6">
        <Link to="/app/processes" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={12} aria-hidden /> Processos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px] flex-1">
            <h1 className="text-lg font-bold text-foreground md:text-xl">{board.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{board.client.name}</span>
              {board.deadline && board.deadline.state !== 'NONE' && <DeadlineChip deadline={board.deadline} />}
              {boardDueDate && (
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', boardDueDateOverdue ? 'bg-danger-bg text-danger-text' : 'bg-warning-bg text-warning-text')}>
                  {boardDueDateOverdue ? 'Venceu em' : 'Vence'} {formatDateOnlyUTC(boardDueDate)}
                </span>
              )}
              {board.type === 'PROCESS' && <ProcessDelayReason boardId={board.id} pending={!!board.delayReasonPending} />}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowStageTimes((v) => !v)} aria-pressed={showStageTimes}>
              Tempo por etapa
            </Button>
            {board.type === 'PROCESS' && (
              <Button type="button" size="sm" onClick={() => setAddingOS(true)} className="gap-1"><Plus size={14} aria-hidden />Adicionar OS</Button>
            )}
          </div>
        </div>
      </div>

      {board.type === 'PROCESS' && <AddOSDialog open={addingOS} board={board} onClose={() => setAddingOS(false)} />}

      {showStageTimes && (
        <div className="px-4 md:px-6 py-3 border-b border-border bg-neutral-bg/40">
          <StageTimesPanel boardId={board.id} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 md:px-6">
        <SearchField label="Buscar tarefas do processo" placeholder="Buscar tarefas" value={search} onChange={setSearch} className="w-full sm:w-64" />
        <select aria-label="Filtrar por prioridade" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className={filterCls}>
          <option value="">Todas as prioridades</option>
          {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <input type="month" aria-label="Competência" title="Filtrar por competência" value={filterCompetence} onChange={(e) => setFilterCompetence(e.target.value)} className={filterCls} />
        {hasFilters && (
          <button type="button" onClick={() => { setSearch(''); setFilterPriority(''); setFilterCompetence('') }} className="h-9 px-2 text-sm text-muted-foreground hover:text-foreground">
            Limpar filtros
          </button>
        )}
      </div>

      {hasFilters && searchResults && (
        <section aria-label="Resultados da busca" className="border-b border-border bg-neutral-bg/50 px-4 py-3 md:px-6">
          <p className="mb-2 text-xs text-muted-foreground">{searchResults.length === 1 ? '1 tarefa encontrada' : `${searchResults.length} tarefas encontradas`}</p>
          <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {searchResults.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => setSelectedTaskId(task.id)}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-2.5 text-left text-sm hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="font-medium text-foreground">{task.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">{PRIORITY_LABEL[task.priority]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex min-h-full items-stretch gap-3 md:gap-4">
            {board.columns.map((column) => (
              <DroppableColumn key={column.id} id={column.id} title={column.title}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
                  <span className="text-xs text-muted-foreground bg-neutral-bg rounded-full px-2 py-0.5">
                    {column.tasks.length}
                  </span>
                </div>
                <SortableContext
                  id={column.id}
                  items={column.tasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex min-h-[4rem] flex-col gap-2 rounded-lg bg-neutral-bg p-2">
                    {column.tasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTaskId(task.id)}
                      />
                    ))}
                  </div>
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
                      className="w-full text-sm rounded-md border border-border bg-surface px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <select
                      value={newTaskDepartmentId}
                      onChange={(e) => setNewTaskDepartmentId(e.target.value)}
                      className="w-full mt-1.5 text-xs rounded-md border border-border bg-surface px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="" disabled>Selecione um departamento</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2 mt-1.5">
                      <button
                        onClick={() => handleAddTask(column.id)}
                        disabled={!newTaskTitle.trim() || !newTaskDepartmentId || createTaskMutation.isPending}
                        className="text-xs bg-accent text-accent-foreground px-3 py-1 rounded hover:bg-accent-hover disabled:opacity-50"
                      >
                        {createTaskMutation.isPending ? '...' : 'Adicionar'}
                      </button>
                      <button
                        onClick={() => { setAddingToColumn(null); setNewTaskTitle(''); setNewTaskDepartmentId('') }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingToColumn(column.id); setNewTaskTitle(''); setNewTaskDepartmentId('') }}
                    className="mt-2 w-full text-left text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-neutral-bg flex items-center gap-1"
                  >
                    <Plus size={12} />
                    Adicionar tarefa
                  </button>
                )}
              </DroppableColumn>
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
          clientId={board.clientId}
          onClose={() => { setSelectedTaskId(null); clearLinkedTask() }}
        />
      )}
    </div>
  )
}
