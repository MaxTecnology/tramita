import { useMemo, useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
import { List, LayoutGrid, Inbox, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { TaskDrawer, STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR } from '@/components/shared/TaskDrawer'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { buildCalendarGrid, getCalendarGridRange } from './tasksCalendar'
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

type ViewMode = 'list' | 'kanban' | 'calendar'

const STATUS_ORDER: Task['status'][] = ['OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE']

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

// buildCalendarGrid/getCalendarGridRange leem o mês via getUTCFullYear/getUTCMonth — por isso o
// "mês atual" precisa ser representado como meia-noite UTC do dia 1 do mês LOCAL do viewer, nunca
// um `new Date()` cru (cujos getters UTC refletem o dia em Greenwich, não o dia local). Entre
// ~21h e 23h59 num fuso atrás de UTC (todo o Brasil), um `new Date()` cru já é o dia seguinte em
// UTC — ver convenção documentada em `@/lib/dates`.
function startOfCurrentMonthUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
}

const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_VISIBLE_PER_DAY = 2

const GRID_COLUMNS = 7

function CalendarView({
  tasks,
  month,
  onPrevMonth,
  onNextMonth,
  onToday,
  onTaskClick,
}: {
  tasks: TaskListItem[]
  month: Date
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onTaskClick: (taskId: string) => void
}) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const grid = useMemo(() => buildCalendarGrid<TaskListItem>(tasks, month), [tasks, month])
  const tasksByDateKey = useMemo(() => {
    const map = new Map<string, TaskListItem[]>()
    for (const day of grid) map.set(day.dateKey, day.tasks)
    return map
  }, [grid])
  const rowCount = grid.length / GRID_COLUMNS

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-neutral-bg">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrevMonth} className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={onNextMonth} className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground">
            <ChevronRight size={16} />
          </button>
          <button type="button" onClick={onToday} className="ml-1 text-xs text-muted-foreground hover:text-foreground underline">
            Hoje
          </button>
        </div>
        <span className="text-sm font-semibold text-foreground capitalize">{MONTH_LABEL.format(month)}</span>
        <div className="w-16" />
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center py-1.5 border-b border-border">
            {w}
          </div>
        ))}
        {grid.map((day, i) => {
          const dayTasks = tasksByDateKey.get(day.dateKey) ?? []
          const visible = dayTasks.slice(0, MAX_VISIBLE_PER_DAY)
          const extra = dayTasks.length - visible.length
          const col = i % GRID_COLUMNS
          const row = Math.floor(i / GRID_COLUMNS)
          // Popover de 224px (w-56) não cabe se abrir pra fora da grade — nas duas últimas colunas
          // (Sex/Sáb) ele abre pra esquerda em vez de pra direita, e nas duas últimas linhas ele
          // abre pra cima em vez de pra baixo, pra nunca ficar clipado pelas bordas da página.
          const openLeft = col >= GRID_COLUMNS - 2
          const openUp = row >= rowCount - 2
          return (
            <div
              key={day.dateKey}
              className={cn(
                'min-h-[90px] border-b border-r border-border p-1.5 relative',
                !day.isCurrentMonth && 'bg-neutral-bg/40',
              )}
            >
              <span className={cn('text-xs', day.isCurrentMonth ? 'text-foreground' : 'text-muted-foreground')}>
                {day.dayOfMonth}
              </span>
              <div className="flex flex-col gap-1 mt-1">
                {visible.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onTaskClick(task.id)}
                    className="text-left text-[11px] leading-tight px-1.5 py-1 rounded bg-neutral-bg hover:bg-border truncate"
                  >
                    <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1', STATUS_COLOR[task.status])} />
                    {task.title}
                  </button>
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(day.dateKey)}
                    className="text-left text-[11px] text-muted-foreground hover:text-foreground px-1.5"
                  >
                    +{extra} mais
                  </button>
                )}
              </div>

              {expandedDay === day.dateKey && (
                <div
                  className={cn(
                    'absolute z-10 w-56 bg-surface border border-border rounded-lg shadow-lg p-2',
                    openUp ? 'bottom-full mb-1' : 'top-full mt-1',
                    openLeft ? 'right-0' : 'left-0',
                  )}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-foreground">{day.dayOfMonth} — todas as tarefas</span>
                    <button type="button" onClick={() => setExpandedDay(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                  </div>
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {dayTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => { onTaskClick(task.id); setExpandedDay(null) }}
                        className="text-left text-xs px-1.5 py-1 rounded hover:bg-neutral-bg truncate"
                      >
                        <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1', STATUS_COLOR[task.status])} />
                        {task.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Tasks() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [view, setView] = useState<ViewMode>('list')
  // Guarda só o id — o objeto é derivado ao vivo de `tasks` (abaixo, depois da query), pra que o
  // TaskDrawer sempre reflita a tarefa atual depois de uma edição, não um snapshot do clique.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => startOfCurrentMonthUTC())

  const [clientId, setClientId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [recurringTemplateId, setRecurringTemplateId] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')

  // No modo Calendário, a navegação de mês É o filtro de data — mas calculada aqui, no momento de
  // montar a query, em vez de escrita no estado dateFrom/dateTo compartilhado com os inputs manuais
  // de Lista/Kanban. Isso evita: (a) "Limpar" zerar as datas sem a grade reagir (nenhuma dependência
  // do efeito mudaria); (b) voltar pra Lista/Kanban herdar silenciosamente a janela do calendário;
  // (c) um round-trip de query extra a cada troca de mês (efeito corre depois do render, não durante).
  // Também pede `dateField=effective` à API — ver tasks.schema.ts — pra não excluir tarefas sem
  // targetDate (toda tarefa que não é recorrente) da janela do mês via fallback pra dueDate.
  const calendarRange = useMemo(
    () => (view === 'calendar' ? getCalendarGridRange(calendarMonth) : null),
    [view, calendarMonth],
  )

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

  // Em modo Calendário, a janela efetiva de data vem de calendarRange (grade do mês), nunca do
  // estado dateFrom/dateTo — que permanece sob controle exclusivo dos inputs manuais de Lista/
  // Kanban (ocultos em modo Calendário). Isso também garante que `hasFilters`/"Limpar", abaixo,
  // nunca contem a janela interna do calendário como filtro escolhido pelo usuário.
  const effectiveDateFrom = calendarRange ? calendarRange.from : dateFrom
  const effectiveDateTo = calendarRange ? calendarRange.to : dateTo
  const dateField = calendarRange ? 'effective' : undefined

  const filters = {
    clientId, assigneeId, departmentId, recurringTemplateId, status, search,
    dateFrom: effectiveDateFrom, dateTo: effectiveDateTo, dateField,
  }

  const {
    data: tasksPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{ items: TaskListItem[]; nextCursor: string | null }>({
    queryKey: ['tasks', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params: Record<string, string> = {}
      if (clientId) params.clientId = clientId
      if (assigneeId) params.assigneeId = assigneeId
      if (departmentId) params.departmentId = departmentId
      if (recurringTemplateId) params.recurringTemplateId = recurringTemplateId
      if (status) params.status = status
      if (search.trim()) params.q = search.trim()
      if (effectiveDateFrom) params.dateFrom = new Date(`${effectiveDateFrom}T00:00:00Z`).toISOString()
      if (effectiveDateTo) params.dateTo = new Date(`${effectiveDateTo}T23:59:59Z`).toISOString()
      if (dateField) params.dateField = dateField
      if (pageParam) params.cursor = pageParam as string
      return api.get('/tasks', { params }).then((r) => r.data)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const tasks = useMemo(() => tasksPages?.pages.flatMap((p) => p.items) ?? [], [tasksPages])

  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null

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
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              view === 'calendar' ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CalendarIcon size={14} />
            Calendário
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
            <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>
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
        {view !== 'calendar' && (
          <>
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
          </>
        )}
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">
            Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando tarefas...</p>
        ) : view === 'calendar' ? (
          <CalendarView
            tasks={tasks}
            month={calendarMonth}
            onPrevMonth={() => setCalendarMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
            onNextMonth={() => setCalendarMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
            onToday={() => setCalendarMonth(startOfCurrentMonthUTC())}
            onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          />
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
                  <TaskRow key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
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
                        <DraggableTaskCard key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
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

        {!isLoading && hasNextPage && (
          <div className="flex justify-center mt-4">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 bg-surface disabled:opacity-50"
            >
              {isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        )}
      </div>

      {selectedTask && user && (
        <TaskDrawer
          task={selectedTask}
          currentUserId={user.id}
          role={user.role as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  )
}
