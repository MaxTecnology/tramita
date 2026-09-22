import { useMemo, useState } from 'react'
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
  useDraggable,
} from '@dnd-kit/core'
import { List, LayoutGrid, Inbox } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { TaskDrawer, STATUS_LABEL, STATUS_COLOR } from '@/components/shared/TaskDrawer'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import type { Task, User, Department, RecurringTaskTemplate } from '@/types'

// GET /tasks retorna uma listagem flat de tarefas cruzando todos os boards da org (inclusive o
// board de sistema onde moram as recorrentes). O select do backend cobre todos os campos de Task,
// mais os relacionamentos abaixo — ou seja, cada item já satisfaz a interface Task e pode ser
// passado direto para o TaskDrawer, sem mapeamento.
interface TaskListItem extends Task {
  department: { id: string; name: string } | null
  assignee: { id: string; name: string } | null
  column: {
    board: {
      id: string
      clientId: string
      client: { id: string; name: string; codigo: string | null }
    }
  }
}

interface ClientOption {
  id: string
  name: string
  codigo?: string
}

type ViewMode = 'list' | 'kanban'

const STATUS_ORDER: Task['status'][] = ['OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE']

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  LOW: 'bg-neutral-bg text-muted-foreground',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  )
}

function TaskRow({ task, onClick }: { task: TaskListItem; onClick: () => void }) {
  const isOverdue = task.dueDate !== null && task.status !== 'DONE' && isPastDateOnlyUTC(task.dueDate)
  return (
    <tr
      onClick={onClick}
      className="border-b border-border last:border-0 cursor-pointer hover:bg-neutral-bg transition-colors"
    >
      <td className="px-3 py-2.5 text-sm text-foreground">
        <span className="font-medium">{task.column.board.client.name}</span>
        {task.column.board.client.codigo && (
          <span className="text-muted-foreground text-xs ml-1.5">#{task.column.board.client.codigo}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-sm text-foreground">{task.title}</td>
      <td className="px-3 py-2.5 text-sm text-muted-foreground">{task.department?.name ?? '—'}</td>
      <td className="px-3 py-2.5 text-sm text-muted-foreground">{task.assignee?.name ?? '—'}</td>
      <td className="px-3 py-2.5">
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_COLOR[task.status])}>
          {STATUS_LABEL[task.status]}
        </span>
      </td>
      <td className={cn('px-3 py-2.5 text-sm', isOverdue ? 'text-danger-text font-medium' : 'text-muted-foreground')}>
        {task.targetDate ? formatDateOnlyUTC(new Date(task.targetDate)) : '—'}
      </td>
    </tr>
  )
}

function DroppableStatusColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-2 min-h-[6rem] rounded-lg bg-neutral-bg p-2 flex-1',
        isOver && 'ring-2 ring-accent',
      )}
    >
      {children}
    </div>
  )
}

function DraggableTaskCard({ task, onClick }: { task: TaskListItem; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  const isOverdue = task.dueDate !== null && task.status !== 'DONE' && isPastDateOnlyUTC(task.dueDate)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'bg-surface rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow select-none',
        isOverdue ? 'border-danger-text' : 'border-border',
        isDragging && 'opacity-40',
      )}
    >
      <p className="text-sm font-medium text-foreground mb-1.5 line-clamp-2">{task.title}</p>
      <p className="text-xs text-muted-foreground mb-1.5">
        {task.column.board.client.name}
        {task.column.board.client.codigo && <span className="ml-1">#{task.column.board.client.codigo}</span>}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {task.sourceRequestId && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-600" title="Originado de uma solicitação do cliente">
            <Inbox size={11} />
          </span>
        )}
        <span className={cn('inline-flex text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLOR[task.priority])}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.department?.name && (
          <span className="text-xs text-muted-foreground">{task.department.name}</span>
        )}
      </div>
      {task.targetDate && (
        <p className={cn('text-xs mt-1.5', isOverdue ? 'text-danger-text font-medium' : 'text-muted-foreground')}>
          {isOverdue ? '⚠ ' : ''}Meta: {formatDateOnlyUTC(new Date(task.targetDate))}
        </p>
      )}
    </div>
  )
}

export default function Tasks() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [view, setView] = useState<ViewMode>('list')
  const [selectedTask, setSelectedTask] = useState<TaskListItem | null>(null)
  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null)

  const [clientId, setClientId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [recurringTemplateId, setRecurringTemplateId] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  const { data: clients = [] } = useQuery<ClientOption[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const { data: recurringTemplates = [] } = useQuery<RecurringTaskTemplate[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
  })

  const filters = { clientId, assigneeId, departmentId, recurringTemplateId, status, dateFrom, dateTo, search }

  const { data: tasks = [], isLoading } = useQuery<TaskListItem[]>({
    queryKey: ['tasks', filters],
    queryFn: () => {
      const params: Record<string, string> = {}
      if (clientId) params.clientId = clientId
      if (assigneeId) params.assigneeId = assigneeId
      if (departmentId) params.departmentId = departmentId
      if (recurringTemplateId) params.recurringTemplateId = recurringTemplateId
      if (status) params.status = status
      if (search.trim()) params.q = search.trim()
      if (dateFrom) params.dateFrom = new Date(`${dateFrom}T00:00:00Z`).toISOString()
      if (dateTo) params.dateTo = new Date(`${dateTo}T23:59:59Z`).toISOString()
      return api.get('/tasks', { params }).then((r) => r.data)
    },
  })

  const hasFilters =
    !!clientId || !!assigneeId || !!departmentId || !!recurringTemplateId || !!status || !!dateFrom || !!dateTo || !!search.trim()

  function clearFilters() {
    setClientId('')
    setAssigneeId('')
    setDepartmentId('')
    setRecurringTemplateId('')
    setStatus('')
    setDateFrom('')
    setDateTo('')
    setSearch('')
  }

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, newStatus }: { taskId: string; newStatus: Task['status'] }) =>
      api.patch(`/tasks/${taskId}`, { status: newStatus }).then((r) => r.data),
    onMutate: async ({ taskId, newStatus }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const snapshot = qc.getQueryData<TaskListItem[]>(['tasks', filters])
      if (snapshot) {
        qc.setQueryData<TaskListItem[]>(
          ['tasks', filters],
          snapshot.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
        )
      }
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(['tasks', filters], ctx.snapshot)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const columns = useMemo(() => {
    const grouped = new Map<Task['status'], TaskListItem[]>(STATUS_ORDER.map((s) => [s, []]))
    for (const task of tasks) {
      grouped.get(task.status)?.push(task)
    }
    return grouped
  }, [tasks])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over) return

    const taskId = active.id as string
    const newStatus = over.id as Task['status']
    if (!STATUS_ORDER.includes(newStatus)) return

    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return

    updateStatusMutation.mutate({ taskId, newStatus })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-3 md:py-4 border-b border-border bg-surface flex-shrink-0">
        <h1 className="text-base md:text-lg font-semibold text-foreground">Tarefas</h1>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-neutral-bg">
          <button
            type="button"
            onClick={() => setView('list')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              view === 'list' ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <List size={14} />
            Lista
          </button>
          <button
            type="button"
            onClick={() => setView('kanban')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              view === 'kanban' ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutGrid size={14} />
            Kanban
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-2 border-b border-border bg-surface">
        <input
          type="text"
          placeholder="Buscar por título..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] h-8 rounded-md border border-border bg-surface px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <FilterSelect value={clientId} onChange={setClientId} placeholder="Cliente">
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={assigneeId} onChange={setAssigneeId} placeholder="Colaborador">
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={departmentId} onChange={setDepartmentId} placeholder="Departamento">
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={recurringTemplateId} onChange={setRecurringTemplateId} placeholder="Tipo de tarefa">
          {recurringTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={status} onChange={setStatus} placeholder="Status">
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </FilterSelect>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Meta de"
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Meta até"
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">
            Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando tarefas...</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa encontrada.</p>
        ) : view === 'list' ? (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-neutral-bg">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tarefa</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Departamento</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Responsável</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meta</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-3 md:gap-4 h-full">
              {STATUS_ORDER.map((s) => {
                const columnTasks = columns.get(s) ?? []
                return (
                  <div key={s} className="flex-shrink-0 w-[280px] md:w-64 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground">{STATUS_LABEL[s]}</h3>
                      <span className="text-xs text-muted-foreground bg-neutral-bg rounded-full px-2 py-0.5">
                        {columnTasks.length}
                      </span>
                    </div>
                    <DroppableStatusColumn id={s}>
                      {columnTasks.map((task) => (
                        <DraggableTaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                      ))}
                    </DroppableStatusColumn>
                  </div>
                )
              })}
            </div>

            <DragOverlay>
              {activeTask ? <DraggableTaskCard task={activeTask} onClick={() => {}} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {selectedTask && user && (
        <TaskDrawer
          task={selectedTask}
          currentUserId={user.id}
          role={user.role as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
