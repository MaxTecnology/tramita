import { useEffect, useMemo, useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData, type InfiniteData } from '@tanstack/react-query'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import { List, LayoutGrid, Inbox, ChevronLeft, ChevronRight, Calendar as CalendarIcon, SlidersHorizontal, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { TaskDrawer, STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR } from '@/components/shared/TaskDrawer'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { buildCalendarGrid, getCalendarGridRange } from './tasksCalendar'
import { periodRange, type PeriodKind } from './tasksPeriod'
import { changeTaskStatus, waitsForAnotherOS } from './tasksStatusChange'
import { STATUS_FILTER_OPTIONS, DEFAULT_STATUS_FILTER, statusFilterParams, type StatusFilter } from './tasksStatus'
import type { Task, User, Department, RecurringTaskTemplate, DeadlineInfo } from '@/types'
import { useBoardSensors, DND_INSTRUCTIONS, dndAnnouncements } from '@/lib/dnd'
import { ScopeFilter, useScopeFilter, scopeParams } from '@/components/shared/ScopeFilter'
import { useMyScope } from '@/hooks/useMyScope'
import { useLinkedItem } from '@/hooks/useLinkedItem'
import { useBoardStream } from '@/hooks/useBoardStream'
import { askConfirm } from '@/components/ui/app-dialogs'
import { DeadlineChip, OSTag } from '@/components/shared/DeadlineChip'
import { PageHeader } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { ListTable, ROW_OPENER } from '@/components/ui/list-table'

// GET /tasks retorna uma listagem flat de tarefas cruzando todos os boards da org (inclusive o
// board de sistema onde moram as recorrentes). O select do backend cobre todos os campos de Task,
// mais os relacionamentos abaixo — ou seja, cada item já satisfaz a interface Task e pode ser
// passado direto para o TaskDrawer, sem mapeamento.
interface TaskListItem extends Task {
  awaitingApproval?: boolean
  department: { id: string; name: string } | null
  assignee: { id: string; name: string } | null
  column: {
    board: {
      id: string
      clientId: string
      client: { id: string; name: string; codigo: string | null }
      type?: 'PROCESS' | 'RECURRING_SYSTEM' | 'SERVICE_SYSTEM'
      title?: string
    }
  }
  osModel?: { id: string; name: string } | null
  deadline?: DeadlineInfo
}

function AwaitingApprovalBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full bg-warning-bg text-warning-text whitespace-nowrap', className)}>
      Aguardando aprovação
    </span>
  )
}

interface ClientOption {
  id: string
  name: string
  codigo?: string
}

type ViewMode = 'list' | 'kanban' | 'calendar'

class GaveUp extends Error {}

const STATUS_ORDER: Task['status'][] = ['OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE']

// The less used filters sit in the "Filtros" panel, each with its name above it
function FilterSelect({
  label,
  value,
  onChange,
  placeholder,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-[11rem] flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">{placeholder}</option>
        {children}
      </select>
    </label>
  )
}

const selectCls = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

const PERIOD_LABEL: Record<PeriodKind, string> = { this: 'Este mês', last: 'Mês passado', custom: 'Personalizado' }

// Segmented buttons (view, period): the pressed one in the theme colour
function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string
  options: { value: T; label: string; icon?: React.ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-9 items-center gap-1.5 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
            value === o.value ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Medium and low are the usual: only high and urgent earn a tag
function PriorityTag({ priority }: { priority: Task['priority'] }) {
  if (priority !== 'HIGH' && priority !== 'URGENT') return null
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', PRIORITY_COLOR[priority])}>
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

function RequestTag() {
  return (
    <span title="Aberta a partir de uma solicitação do cliente" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-highlight-bg px-2 py-0.5 text-[11px] font-medium text-highlight-text">
      <Inbox size={11} aria-hidden /> Solicitação
    </span>
  )
}

function StatusPill({ status }: { status: Task['status'] }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[status])}>{STATUS_LABEL[status]}</span>
}

const processOf = (task: TaskListItem) => (task.column.board.type === 'PROCESS' ? task.column.board.title ?? null : null)
const isOverdueTask = (task: TaskListItem) => task.dueDate !== null && task.status !== 'DONE' && isPastDateOnlyUTC(task.dueDate)

// What a task carries besides its title: OS and process, approval, request, priority
function TaskTags({ task, inRow = false }: { task: TaskListItem; inRow?: boolean }) {
  const tags = [
    task.awaitingApproval && <AwaitingApprovalBadge key="approval" />,
    task.sourceRequestId && <RequestTag key="request" />,
    <PriorityTag key="priority" priority={task.priority} />,
  ]
  return (
    <>
      {task.osModel && <OSTag className="mt-1 flex" truncate={!inRow} model={task.osModel.name} process={processOf(task)} />}
      <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">{tags}</div>
    </>
  )
}

// Deadline: the OS internal deadline in words, otherwise the target date
function TaskDeadline({ task }: { task: TaskListItem }) {
  const meta = task.targetDate ? formatDateOnlyUTC(new Date(task.targetDate)) : null
  if (task.deadline && task.osModel && task.deadline.state !== 'NONE') {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <DeadlineChip deadline={task.deadline} />
        {meta && <span className="text-xs text-muted-foreground">Meta {meta}</span>}
      </div>
    )
  }
  if (!meta) return <span className="text-sm text-muted-foreground">—</span>
  return <span className={cn('text-sm', isOverdueTask(task) ? 'font-medium text-danger-text' : 'text-foreground')}>{meta}</span>
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
  const isOverdue = isOverdueTask(task)
  const hasDeadlineChip = !!(task.deadline && task.osModel && task.deadline.state !== 'NONE')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isDragging) { e.preventDefault(); onClick(); return }
        listeners?.onKeyDown?.(e)
      }}
      onClick={onClick}
      data-task-card
      className={cn(
        'min-w-0 cursor-pointer select-none rounded-lg border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isOverdue ? 'border-danger-text' : 'border-border',
        isDragging && 'opacity-40',
      )}
    >
      <p className="line-clamp-2 text-sm font-medium text-foreground">{task.title}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {task.column.board.client.name}
        {task.column.board.client.codigo && <span className="ml-1">#{task.column.board.client.codigo}</span>}
      </p>
      <TaskTags task={task} />
      {hasDeadlineChip && task.deadline && <DeadlineChip className="mt-1.5" deadline={task.deadline} />}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{task.assignee?.name ?? 'Sem responsável'}</span>
        {task.targetDate && (
          <span className={cn('flex-shrink-0', isOverdue && 'font-medium text-danger-text')}>
            Meta {formatDateOnlyUTC(new Date(task.targetDate))}
          </span>
        )}
      </div>
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
          <div key={w} className="text-xs font-medium text-muted-foreground text-center py-1.5 border-b border-border">
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
  const clearLinkedTask = useLinkedItem('task', setSelectedTaskId)
  const [activeTask, setActiveTask] = useState<TaskListItem | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => startOfCurrentMonthUTC())

  const [clientId, setClientId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [recurringTemplateId, setRecurringTemplateId] = useState('')
  // Default: open tasks of the current month — with many tasks the list never loads "all time"
  const [status, setStatus] = useState<StatusFilter>(DEFAULT_STATUS_FILTER)
  const [periodKind, setPeriodKind] = useState<PeriodKind>('this')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

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

  // /users/options (id+name) is open to the whole team; /users is admin-only.
  const { data: users = [] } = useQuery<{ id: string; name: string; departmentIds?: string[] }[]>({
    queryKey: ['user-options'],
    queryFn: () => api.get('/users/options').then((r) => r.data),
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
  const period = periodRange(periodKind, new Date(), { from: dateFrom, to: dateTo })
  const effectiveDateFrom = calendarRange ? calendarRange.from : period.from
  const effectiveDateTo = calendarRange ? calendarRange.to : period.to
  // 'period' also keeps tasks with no date (OS tasks often have none) in the month view
  const dateField = calendarRange ? 'effective' : 'period'
  // Kanban is organized by status columns: the status filter only applies to List and Calendar
  const statusParam: StatusFilter = view === 'kanban' ? 'ALL' : status

  const me = useMyScope()
  const [scopeFilter, setScopeFilter] = useScopeFilter('tasks', me)

  const filters = {
    clientId, assigneeId, departmentId, recurringTemplateId, status: statusParam, search,
    dateFrom: effectiveDateFrom, dateTo: effectiveDateTo, dateField, scopeFilter,
  }

  const {
    data: tasksPages,
    isLoading,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{ items: TaskListItem[]; nextCursor: string | null }>({
    queryKey: ['tasks', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params: Record<string, string> = { ...scopeParams(scopeFilter) }
      if (clientId) params.clientId = clientId
      if (assigneeId) params.assigneeId = assigneeId
      if (departmentId) params.departmentId = departmentId
      if (recurringTemplateId) params.recurringTemplateId = recurringTemplateId
      Object.assign(params, statusFilterParams(statusParam))
      if (search.trim()) params.q = search.trim()
      if (effectiveDateFrom) params.dateFrom = new Date(`${effectiveDateFrom}T00:00:00Z`).toISOString()
      if (effectiveDateTo) params.dateTo = new Date(`${effectiveDateTo}T23:59:59Z`).toISOString()
      if (dateField) params.dateField = dateField
      if (pageParam) params.cursor = pageParam as string
      return api.get('/tasks', { params }).then((r) => r.data)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Changing a filter keeps the current rows until the new ones arrive (no blank list in between)
    placeholderData: keepPreviousData,
  })

  const tasks = useMemo(() => tasksPages?.pages.flatMap((p) => p.items) ?? [], [tasksPages])
  type TasksData = InfiniteData<{ items: TaskListItem[]; nextCursor: string | null }>

  // Cover an absent colleague: take all their open tasks of my departments at once
  const bulkQc = useQueryClient()
  const colleague = assigneeId && me && assigneeId !== me.id && scopeFilter.scope === 'department'
    && (me.role !== 'ORG_MEMBER' || me.seesDepartmentWork)
    ? users.find((u) => u.id === assigneeId) ?? null
    : null
  const colleagueOpenCount = colleague
    ? tasks.filter((t) => t.assigneeId === colleague.id && t.status !== 'DONE' && t.status !== 'DISREGARDED').length
    : 0
  const assumeBulkMutation = useMutation({
    mutationFn: () => api.post('/tasks/assume-bulk', {
      fromUserId: assigneeId,
      ...(scopeFilter.departmentId ? { departmentId: scopeFilter.departmentId } : {}),
    }).then((r) => r.data as { count: number }),
    onSuccess: ({ count }) => {
      toast.success(count === 1 ? '1 tarefa assumida' : `${count} tarefas assumidas`)
      bulkQc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao assumir as tarefas')),
  })

  // A task opened from a notification may be outside the current filters: fetched on its own
  const selectedInList = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null
  const { data: linkedTask = null } = useQuery<TaskListItem | null>({
    queryKey: ['tasks', 'linked', selectedTaskId],
    queryFn: () => api.get('/tasks', { params: { taskId: selectedTaskId } }).then((r) => r.data.items[0] ?? null),
    enabled: !!selectedTaskId && !selectedInList && !isLoading,
  })
  const selectedTask = selectedInList ?? linkedTask
  // The open task's board in real time: what the client sends shows up in the panel without reload
  useBoardStream(selectedTask?.column.board.id)

  const hasFilters =
    !!clientId || !!assigneeId || !!departmentId || !!recurringTemplateId || status !== DEFAULT_STATUS_FILTER || periodKind !== 'this' || !!search.trim()

  function clearFilters() {
    setClientId('')
    setAssigneeId('')
    setDepartmentId('')
    setRecurringTemplateId('')
    setStatus(DEFAULT_STATUS_FILTER)
    setPeriodKind('this')
    setDateFrom('')
    setDateTo('')
    setSearch('')
  }

  // "Minhas" has no colleague to pick; in "Meu departamento" only colleagues of my departments
  const myDepartmentIds = new Set((me?.departments ?? []).map((d) => d.id))
  const isAdmin = me?.role === 'ORG_ADMIN'
  const colleagueOptions = isAdmin ? users : users.filter((u) => (u.departmentIds ?? []).some((d) => myDepartmentIds.has(d)))
  const departmentOptions = isAdmin ? departments : departments.filter((d) => myDepartmentIds.has(d.id))
  const showColleagueFilter = scopeFilter.scope !== 'mine'
  useEffect(() => {
    if (!showColleagueFilter && assigneeId) setAssigneeId('')
  }, [showColleagueFilter, assigneeId])

  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, newStatus }: { taskId: string; newStatus: Task['status'] }) => {
      // Giving up the delay reason: the card goes back where it was, without an error message
      if (!(await changeTaskStatus(taskId, newStatus))) throw new GaveUp()
    },
    // The list is paginated (InfiniteData): the card moves at once, inside its page
    onMutate: async ({ taskId, newStatus }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const key = ['tasks', filters]
      const snapshot = qc.getQueryData<TasksData>(key)
      if (snapshot) {
        qc.setQueryData<TasksData>(key, {
          ...snapshot,
          pages: snapshot.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)) })),
        })
      }
      return { snapshot, key }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(ctx.key, ctx.snapshot)
      if (!(err instanceof GaveUp)) toast.error(mensagemDeErro(err, 'Não foi possível mudar o status da tarefa'))
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

  const sensors = useBoardSensors()
  const dndName = (id: string | number) => STATUS_LABEL[id as Task['status']] ?? tasks.find((t) => t.id === id)?.title ?? String(id)

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
    if (waitsForAnotherOS(task)) {
      toast.info(`Esta OS aguarda ${task.waitingFor?.join(', ') || 'outra OS'}: o status muda quando ela for liberada.`)
      return
    }

    updateStatusMutation.mutate({ taskId, newStatus })
  }

  // The filters behind "Filtros": what is chosen shows as a chip that removes it
  const clientLabel = (id: string) => { const c = clients.find((x) => x.id === id); return c ? (c.codigo ? `${c.codigo} - ${c.name}` : c.name) : '' }
  const advanced = [
    clientId && { key: 'client', label: `Cliente: ${clientLabel(clientId)}`, clear: () => setClientId('') },
    assigneeId && { key: 'assignee', label: `Colaborador: ${users.find((u) => u.id === assigneeId)?.name ?? ''}`, clear: () => setAssigneeId('') },
    departmentId && { key: 'department', label: `Departamento: ${departments.find((d) => d.id === departmentId)?.name ?? ''}`, clear: () => setDepartmentId('') },
    recurringTemplateId && { key: 'type', label: `Tipo: ${recurringTemplates.find((t) => t.id === recurringTemplateId)?.title ?? ''}`, clear: () => setRecurringTemplateId('') },
  ].filter((f): f is { key: string; label: string; clear: () => void } => !!f)

  return (
    // Phones scroll the whole page (filters included); wide screens keep the header still and
    // scroll only the list or board below it
    <div className="h-full overflow-auto lg:flex lg:flex-col lg:overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          title="Tarefas"
          description="O que a equipe tem a fazer: obrigações recorrentes, ordens de serviço e etapas de processo."
          actions={
            <Segmented<ViewMode>
              label="Visualização"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'Lista', icon: <List size={14} aria-hidden /> },
                { value: 'kanban', label: 'Kanban', icon: <LayoutGrid size={14} aria-hidden /> },
                { value: 'calendar', label: 'Calendário', icon: <CalendarIcon size={14} aria-hidden /> },
              ]}
            />
          }
        />

        <div className="flex flex-wrap items-center gap-2 pb-3">
          {me && (me.role !== 'ORG_MEMBER' || me.seesDepartmentWork) && (
            <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />
          )}
          <SearchField label="Buscar tarefas" placeholder="Título, cliente ou código" value={search} onChange={setSearch} className="w-full sm:w-64" />
          {view !== 'kanban' && (
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(STATUS_FILTER_OPTIONS.find((o) => o.value === e.target.value)?.value ?? DEFAULT_STATUS_FILTER)}
              className={selectCls}
            >
              {STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          {view !== 'calendar' && (
            <>
              <Segmented<PeriodKind>
                label="Período"
                value={periodKind}
                onChange={setPeriodKind}
                options={(['this', 'last', 'custom'] as const).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))}
              />
              {periodKind === 'custom' && (
                <>
                  <input type="date" aria-label="De" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selectCls} />
                  <input type="date" aria-label="Até" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selectCls} />
                </>
              )}
            </>
          )}
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="task-more-filters"
            onClick={() => setFiltersOpen((o) => !o)}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              advanced.length > 0 ? 'border-accent text-foreground' : 'border-border text-muted-foreground hover:bg-neutral-bg',
            )}
          >
            <SlidersHorizontal size={14} aria-hidden />
            {advanced.length > 0 ? `Filtros (${advanced.length})` : 'Filtros'}
          </button>
          {colleague && colleagueOpenCount > 0 && !isPlaceholderData && (
            <button
              type="button"
              disabled={assumeBulkMutation.isPending}
              onClick={async () => {
                if (await askConfirm({
                  title: `Assumir ${colleagueOpenCount === 1 ? 'a tarefa aberta' : `as ${colleagueOpenCount} tarefas abertas`} de ${colleague.name}?`,
                  description: `${colleague.name} recebe um aviso. A carteira de clientes não muda.`,
                  confirmLabel: 'Assumir',
                })) assumeBulkMutation.mutate()
              }}
              className="h-9 rounded-md border border-warning-text/40 bg-warning-bg px-3 text-sm font-medium text-warning-text hover:opacity-90 disabled:opacity-50"
            >
              Assumir todas as abertas de {colleague.name}
            </button>
          )}
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="h-9 px-2 text-sm text-muted-foreground hover:text-foreground">
              Limpar filtros
            </button>
          )}
        </div>

        {filtersOpen ? (
          <div id="task-more-filters" className="mb-3 flex flex-wrap gap-3 rounded-lg border border-border bg-surface p-3">
            <FilterSelect label="Cliente" value={clientId} onChange={setClientId} placeholder="Todos">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>
              ))}
            </FilterSelect>
            {showColleagueFilter && (
              <FilterSelect label="Colaborador" value={assigneeId} onChange={setAssigneeId} placeholder="Todos">
                {colleagueOptions.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </FilterSelect>
            )}
            <FilterSelect label="Departamento" value={departmentId} onChange={setDepartmentId} placeholder="Todos">
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Tipo de tarefa" value={recurringTemplateId} onChange={setRecurringTemplateId} placeholder="Todos">
              {recurringTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </FilterSelect>
          </div>
        ) : advanced.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {advanced.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={f.clear}
                aria-label={`Tirar filtro ${f.label}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {f.label} <X size={12} aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* While another filter loads, the rows on screen are the old ones: shown as loading and
          out of reach (no opening, dragging or "Carregar mais" on what is about to go) */}
      <div
        data-testid="task-results"
        aria-busy={isPlaceholderData}
        inert={isPlaceholderData}
        className={cn('px-4 pb-6 transition-opacity md:px-6 lg:min-h-0 lg:flex-1 lg:overflow-auto', isPlaceholderData && 'opacity-60')}
      >
        {view === 'calendar' ? (
          isLoading ? <p className="text-sm text-muted-foreground">Carregando tarefas...</p> : (
            <CalendarView
              tasks={tasks}
              month={calendarMonth}
              onPrevMonth={() => setCalendarMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
              onNextMonth={() => setCalendarMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
              onToday={() => setCalendarMonth(startOfCurrentMonthUTC())}
              onTaskClick={(taskId) => setSelectedTaskId(taskId)}
            />
          )
        ) : view === 'list' ? (
          <ListTable<TaskListItem>
            label="Tarefas"
            loading={isLoading}
            rows={tasks}
            rowKey={(t) => t.id}
            interactive
            empty={<p className="text-sm text-muted-foreground">{hasFilters ? 'Nenhuma tarefa com esses filtros.' : 'Nenhuma tarefa neste período.'}</p>}
            columns={[
              {
                header: 'Tarefa', width: 'minmax(0,2.2fr)',
                cell: (t) => (
                  <div className="min-w-0">
                    <button type="button" onClick={() => setSelectedTaskId(t.id)} className={cn(ROW_OPENER, 'text-sm')}>{t.title}</button>
                    <TaskTags task={t} inRow />
                  </div>
                ),
              },
              {
                header: 'Cliente', width: 'minmax(0,1.4fr)',
                cell: (t) => (
                  <p className="text-sm text-foreground">
                    <span>{t.column.board.client.name}</span>
                    {t.column.board.client.codigo && <span className="ml-1 text-xs text-muted-foreground">#{t.column.board.client.codigo}</span>}
                  </p>
                ),
              },
              {
                header: 'Responsável', width: 'minmax(0,1.2fr)',
                cell: (t) => (
                  <div className="min-w-0 text-sm">
                    <p className={cn('truncate', t.assignee ? 'text-foreground' : 'text-muted-foreground')}>{t.assignee?.name ?? 'Sem responsável'}</p>
                    {t.department && <p className="truncate text-xs text-muted-foreground">{t.department.name}</p>}
                  </div>
                ),
              },
              { header: 'Status', width: '9rem', cell: (t) => <StatusPill status={t.status} /> },
              { header: 'Prazo', width: '10rem', cell: (t) => <TaskDeadline task={t} /> },
            ]}
          />
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando tarefas...</p>
        ) : (
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} accessibility={{ screenReaderInstructions: DND_INSTRUCTIONS, announcements: dndAnnouncements(dndName) }}>
            {/* Columns grow with the longest one: a card at the bottom of a long column can be dropped
                on any other column at the same height */}
            <div className="flex min-h-full items-stretch gap-3 overflow-x-auto pb-2 lg:overflow-visible">
              {STATUS_ORDER.map((s) => {
                const columnTasks = columns.get(s) ?? []
                return (
                  <section key={s} aria-label={STATUS_LABEL[s]} className="flex w-[260px] flex-shrink-0 flex-col lg:w-auto lg:min-w-[13rem] lg:flex-1 lg:flex-shrink">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-foreground">{STATUS_LABEL[s]}</h2>
                      <span className="rounded-full bg-neutral-bg px-2 py-0.5 text-xs text-muted-foreground">{columnTasks.length}</span>
                    </div>
                    <DroppableStatusColumn id={s}>
                      {columnTasks.map((task) => (
                        <DraggableTaskCard key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
                      ))}
                    </DroppableStatusColumn>
                  </section>
                )
              })}
            </div>

            <DragOverlay>
              {activeTask ? <DraggableTaskCard task={activeTask} onClick={() => {}} /> : null}
            </DragOverlay>
          </DndContext>
        )}

        {!isLoading && !isPlaceholderData && hasNextPage && (
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
          clientId={selectedTask.column.board.clientId}
          onClose={() => { setSelectedTaskId(null); clearLinkedTask() }}
        />
      )}
    </div>
  )
}
