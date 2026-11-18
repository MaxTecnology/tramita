import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { diffDaysDateOnlyUTC, formatDateOnlyUTC } from '@/lib/dates'
import { Plus, ChevronDown, ChevronRight, AlertTriangle, Clock, ClipboardList, CheckCircle2, Search, X, FileSearch } from 'lucide-react'
import type { Board } from '@/types'
import { DeadlineChip } from '@/components/shared/DeadlineChip'
import { NewProcessDialog } from '@/components/process/NewProcessDialog'
import { PageHeader } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { ListTable, ROW_OPENER } from '@/components/ui/list-table'

const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

// Progress = OS finished (by their status: an OS done in its panel counts even if it stayed in an
// earlier column); disregarded ones are left out
function osCount(board: Board): { done: number; total: number; dispensed: number } {
  const all = board.columns.flatMap((c) => c.tasks)
  const tasks = all.filter((t) => t.status !== 'DISREGARDED')
  return { done: tasks.filter((t) => t.status === 'DONE').length, total: tasks.length, dispensed: all.length - tasks.length }
}
const isFinished = (board: Board) => { const { done, total } = osCount(board); return total > 0 && done === total }

// The date the process must meet: the nearest due date of an open OS, otherwise the process's own.
// A finished process has none left to meet.
function dueDateOf(board: Board): Date | null {
  if (isFinished(board)) return null
  const dates = board.columns
    .flatMap((c) => c.tasks)
    .filter((t) => t.dueDate && t.status !== 'DONE' && t.status !== 'DISREGARDED')
    .map((t) => new Date(t.dueDate!))
    .sort((a, b) => a.getTime() - b.getTime())
  return dates[0] ?? (board.dueDate ? new Date(board.dueDate) : null)
}

// Late: past its due date, or past the process internal deadline
function isLate(board: Board, now: Date): boolean {
  const d = dueDateOf(board)
  return (!!d && diffDaysDateOnlyUTC(d, now) < 0) || board.deadline?.state === 'LATE'
}
function isDueSoon(board: Board, now: Date): boolean {
  const d = dueDateOf(board)
  const diff = d ? diffDaysDateOnlyUTC(d, now) : null
  return (diff !== null && diff >= 0 && diff <= 7) || board.deadline?.state === 'DUE_SOON'
}

function getCurrentStage(board: Board): string {
  const all = board.columns.flatMap((c) => c.tasks)
  if (all.length === 0) return '—'
  const counts = board.columns.map((col) => ({
    title: col.title,
    count: col.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'DISREGARDED').length,
  }))
  const active = counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
  return active[0]?.title ?? (isFinished(board) ? 'Concluído' : '—')
}

function formatDueDate(date: Date | null, now: Date): { label: string; cls: string } | null {
  if (!date) return null
  const diff = diffDaysDateOnlyUTC(date, now)
  if (diff < 0) return { label: `Vencido há ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'dia' : 'dias'}`, cls: 'text-danger-text font-medium' }
  if (diff === 0) return { label: 'Vence hoje', cls: 'text-danger-text font-medium' }
  if (diff <= 7) return { label: `Vence em ${diff} ${diff === 1 ? 'dia' : 'dias'}`, cls: 'text-warning-text font-medium' }
  return { label: `Vence ${formatDateOnlyUTC(date)}`, cls: 'text-muted-foreground' }
}

interface Group {
  label: string
  boards: Board[]
  headerCls: string
  icon: React.ReactNode
  defaultOpen: boolean
}

function ProgressCell({ board }: { board: Board }) {
  const { done, total, dispensed } = osCount(board)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{total === 0 ? (dispensed > 0 ? 'Sem OS ativas' : 'Sem OS') : `${done} de ${total} OS concluídas`}</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-bg" aria-hidden>
        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-success-text' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BoardGroup({ group, now }: { group: Group; now: Date }) {
  const [open, setOpen] = useState(group.defaultOpen)
  const id = `process-group-${group.label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <section>
      <h2 className="mb-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(!open)}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', group.headerCls)}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {group.icon}
          {group.label}
          <span className="font-normal opacity-70">({group.boards.length})</span>
        </button>
      </h2>
      {open && (
        <div id={id}>
          <ListTable<Board>
            label={`Processos: ${group.label}`}
            rows={group.boards}
            rowKey={(b) => b.id}
            interactive
            empty={null}
            columns={[
              {
                header: 'Processo', width: 'minmax(0,2fr)',
                cell: (b) => (
                  <div className="min-w-0">
                    <Link to={`/app/board/${b.id}`} className={cn(ROW_OPENER, 'block text-sm')}>{b.title}</Link>
                    {b.deadline && b.deadline.state !== 'NONE' && <DeadlineChip className="mt-1" deadline={b.deadline} />}
                  </div>
                ),
              },
              { header: 'Cliente', width: 'minmax(0,1.2fr)', cell: (b) => <span className="text-sm text-foreground">{b.client.name}</span> },
              { header: 'Etapa', width: 'minmax(0,1fr)', cell: (b) => <span className="text-sm text-foreground">{getCurrentStage(b)}</span> },
              {
                header: 'Responsável', width: 'minmax(0,1fr)',
                cell: (b) => <span className={cn('text-sm', b.responsibleUser ? 'text-foreground' : 'text-muted-foreground')}>{b.responsibleUser?.name ?? 'Sem responsável'}</span>,
              },
              { header: 'Progresso', width: '10rem', cell: (b) => <ProgressCell board={b} /> },
              {
                header: 'Vencimento', width: '9rem',
                cell: (b) => {
                  const due = formatDueDate(dueDateOf(b), now)
                  return due ? <span className={cn('text-xs', due.cls)}>{due.label}</span> : <span className="text-sm text-muted-foreground">—</span>
                },
              },
            ]}
          />
        </div>
      )}
    </section>
  )
}

export default function Processes() {
  const { user } = useAuth()

  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterResponsible, setFilterResponsible] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false)
  const [newProcessOpen, setNewProcessOpen] = useState(false)

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  // Re-read every minute: a tab left open from one day to the next reclassifies late / due soon
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const uniqueClients = useMemo(
    () => [...new Map(boards.map((b) => [b.client.id, b.client])).values()],
    [boards],
  )
  const uniqueResponsible = useMemo(
    () => [
      ...new Map(
        boards
          .filter((b) => b.responsibleUser)
          .map((b) => [b.responsibleUser!.id, b.responsibleUser!]),
      ).values(),
    ],
    [boards],
  )
  const uniqueStages = useMemo(
    () => [...new Set(boards.map(getCurrentStage))].filter((st) => st !== '—').sort(),
    [boards],
  )

  const filtered = useMemo(() => {
    return boards.filter((b) => {
      if (search) {
        const q = search.toLowerCase()
        if (!b.title.toLowerCase().includes(q) && !b.client.name.toLowerCase().includes(q)) return false
      }
      if (filterClient && b.client.id !== filterClient) return false
      if (filterResponsible && b.responsibleUser?.id !== filterResponsible) return false
      if (filterStage && getCurrentStage(b) !== filterStage) return false
      if (showOnlyOverdue && (isFinished(b) || !isLate(b, now))) return false
      return true
    })
  }, [boards, search, filterClient, filterResponsible, filterStage, showOnlyOverdue, now])

  const hasActiveFilter = search || filterClient || filterResponsible || filterStage || showOnlyOverdue

  const stats = useMemo(() => {
    // dueDate é um rótulo de dia-calendário, não instante real — `d < now`/`d >= now` compara
    // bruto e classifica "vence hoje" como atrasado horas antes do dia terminar. diffDaysDateOnlyUTC
    // já lê isso corretamente (ver apps/web/src/lib/dates.ts).
    const open = filtered.filter((b) => !isFinished(b))
    const overdue = open.filter((b) => isLate(b, now)).length
    const dueSoon = open.filter((b) => !isLate(b, now) && isDueSoon(b, now)).length
    const completed = filtered.filter(isFinished).length
    return { total: filtered.length, overdue, dueSoon, completed }
  }, [filtered, now])

  const groups = useMemo((): Group[] => {
    if (hasActiveFilter) {
      return [
        {
          label: 'Resultados',
          // Late first, then by the nearest due date
          boards: [...filtered].sort((a, b) => {
            const la = isLate(a, now) ? 0 : 1
            const lb = isLate(b, now) ? 0 : 1
            if (la !== lb) return la - lb
            const da = dueDateOf(a)
            const db = dueDateOf(b)
            if (!da && !db) return 0
            if (!da) return 1
            if (!db) return -1
            return da.getTime() - db.getTime()
          }),
          headerCls: 'text-foreground',
          icon: <Search size={14} aria-hidden />,
          defaultOpen: true,
        },
      ]
    }

    const open = filtered.filter((b) => !isFinished(b))
    const overdue = open.filter((b) => isLate(b, now))
    const dueSoon = open.filter((b) => !isLate(b, now) && isDueSoon(b, now))
    const inProgress = open.filter((b) => !isLate(b, now) && !isDueSoon(b, now))
    const completed = filtered.filter(isFinished)

    return [
      { label: 'Atrasados', boards: overdue, headerCls: 'text-danger-text', icon: <AlertTriangle size={14} aria-hidden />, defaultOpen: true },
      { label: 'Vencem em 7 dias', boards: dueSoon, headerCls: 'text-warning-text', icon: <Clock size={14} aria-hidden />, defaultOpen: true },
      { label: 'Em andamento', boards: inProgress, headerCls: 'text-foreground', icon: <ClipboardList size={14} aria-hidden />, defaultOpen: true },
      { label: 'Concluídos', boards: completed, headerCls: 'text-success-text', icon: <CheckCircle2 size={14} aria-hidden />, defaultOpen: false },
    ].filter((g) => g.boards.length > 0)
  }, [filtered, hasActiveFilter, now])

  const selectCls = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Processos"
        description="Abertura, alteração, encerramento e outros trabalhos em etapas, com as OS de cada um."
        actions={MANAGER_ROLES.includes(user?.role ?? '') && (
          <Button onClick={() => setNewProcessOpen(true)} className="gap-1.5"><Plus size={16} aria-hidden />Novo processo</Button>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField label="Buscar processos" placeholder="Processo ou cliente" value={search} onChange={setSearch} className="w-full sm:w-64" />
        <select aria-label="Filtrar por cliente" value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className={selectCls}>
          <option value="">Todos os clientes</option>
          {uniqueClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {MANAGER_ROLES.includes(user?.role ?? '') && (
          <select aria-label="Filtrar por responsável" value={filterResponsible} onChange={(e) => setFilterResponsible(e.target.value)} className={selectCls}>
            <option value="">Todos os responsáveis</option>
            {uniqueResponsible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select aria-label="Filtrar por etapa" value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className={selectCls}>
          <option value="">Todas as etapas</option>
          {uniqueStages.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <button
          type="button"
          aria-pressed={showOnlyOverdue}
          onClick={() => setShowOnlyOverdue(!showOnlyOverdue)}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            showOnlyOverdue ? 'border-danger-text bg-danger-bg text-danger-text' : 'border-border bg-surface text-muted-foreground hover:bg-neutral-bg',
          )}
        >
          <AlertTriangle size={14} aria-hidden />
          Só atrasados
        </button>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFilterClient(''); setFilterResponsible(''); setFilterStage(''); setShowOnlyOverdue(false) }}
            className="flex h-9 items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <X size={14} aria-hidden />
            Limpar filtros
          </button>
        )}
      </div>

      {stats.total > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{stats.total} {stats.total === 1 ? 'processo' : 'processos'}</span>
          {stats.overdue > 0 && <span className="font-medium text-danger-text">{stats.overdue} {stats.overdue === 1 ? 'atrasado' : 'atrasados'}</span>}
          {stats.dueSoon > 0 && <span className="text-warning-text">{stats.dueSoon} {stats.dueSoon === 1 ? 'vence' : 'vencem'} em 7 dias</span>}
          {!showOnlyOverdue && <span>{stats.completed} {stats.completed === 1 ? 'concluído' : 'concluídos'}</span>}
        </p>
      )}

      {isLoading ? (
        <ListTable<Board> label="Processos" loading rows={[]} rowKey={(b) => b.id} empty={null} columns={[{ header: 'Processo', width: '1fr', cell: () => null }]} />
      ) : (
        <div className="space-y-5">
          {groups.length === 0 ? (
            <div className="py-16 text-center">
              <FileSearch size={40} aria-hidden className="mx-auto mb-3 text-muted-foreground" />
              <p className="mb-1 text-base font-medium text-foreground">{hasActiveFilter ? 'Nenhum processo com esses filtros' : 'Nenhum processo ainda'}</p>
              <p className="text-sm text-muted-foreground">{hasActiveFilter ? 'Ajuste ou limpe os filtros.' : 'Abra um processo pelo botão "Novo processo".'}</p>
            </div>
          ) : (
            groups.map((group) => <BoardGroup key={group.label} group={group} now={now} />)
          )}
        </div>
      )}

      <NewProcessDialog open={newProcessOpen} onClose={() => setNewProcessOpen(false)} />
    </div>
  )
}
