import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Plus, ChevronDown, ChevronRight } from 'lucide-react'
import type { Board, Client } from '@/types'

const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

function getProgress(board: Board): number {
  const all = board.columns.flatMap((c) => c.tasks)
  if (all.length === 0) return 0
  return Math.round((all.filter((t) => t.status === 'DONE').length / all.length) * 100)
}

function getMostUrgentDueDate(board: Board): Date | null {
  const dates = board.columns
    .flatMap((c) => c.tasks)
    .filter((t) => t.dueDate && t.status !== 'DONE' && t.status !== 'CANCELLED')
    .map((t) => new Date(t.dueDate!))
    .sort((a, b) => a.getTime() - b.getTime())
  return dates[0] ?? null
}

function getCurrentStage(board: Board): string {
  const counts = board.columns.map((col) => ({
    title: col.title,
    count: col.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length,
  }))
  const active = counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
  return active[0]?.title ?? 'Concluído'
}

function formatDueDate(date: Date | null, now: Date): { label: string; cls: string } {
  if (!date) return { label: '—', cls: 'text-gray-400' }
  const diff = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diff < 0) return { label: `Vencido há ${Math.abs(diff)}d`, cls: 'text-red-600 font-medium' }
  if (diff === 0) return { label: 'Vence hoje', cls: 'text-red-600 font-medium' }
  if (diff <= 7) return { label: `Em ${diff}d`, cls: 'text-amber-600 font-medium' }
  return { label: date.toLocaleDateString('pt-BR'), cls: 'text-gray-500' }
}

interface Group {
  label: string
  boards: Board[]
  headerCls: string
  defaultOpen: boolean
}

function BoardRow({ board, now }: { board: Board; now: Date }) {
  const progress = getProgress(board)
  const dueDate = getMostUrgentDueDate(board)
  const { label: dueDateLabel, cls: dueDateCls } = formatDueDate(dueDate, now)
  const stage = getCurrentStage(board)

  return (
    <Link
      to={`/app/board/${board.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
    >
      <div className="flex-[2] min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{board.title}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-600 truncate">{board.client.name}</p>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate">{stage}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 truncate">{board.responsibleUser?.name ?? '—'}</p>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-gray-500 w-8 text-right">{progress}%</span>
      </div>
      <div className="w-24 text-right">
        <span className={cn('text-xs', dueDateCls)}>{dueDateLabel}</span>
      </div>
    </Link>
  )
}

function BoardGroup({ group, now }: { group: Group; now: Date }) {
  const [open, setOpen] = useState(group.defaultOpen)

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn('w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-left', group.headerCls)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {group.label}
        <span className="ml-1 font-normal opacity-70">({group.boards.length})</span>
      </button>

      {open && (
        <>
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex-[2] text-xs font-semibold text-gray-500 uppercase tracking-wide">Processo</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Etapa</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsável</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progresso</div>
            <div className="w-24 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Prazo</div>
          </div>
          {group.boards.map((board) => (
            <BoardRow key={board.id} board={board} now={now} />
          ))}
        </>
      )}
    </div>
  )
}

export default function Processes() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterResponsible, setFilterResponsible] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false)
  const [newProcessOpen, setNewProcessOpen] = useState(false)
  const [newProcessForm, setNewProcessForm] = useState({ title: '', clientId: '' })

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
    enabled: newProcessOpen,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/boards', { title: newProcessForm.title, clientId: newProcessForm.clientId }).then((r) => r.data),
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ['boards'] })
      setNewProcessOpen(false)
      setNewProcessForm({ title: '', clientId: '' })
      navigate(`/app/board/${board.id}`)
    },
  })

  const now = useMemo(() => new Date(), [])
  const in7days = useMemo(() => new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), [now])

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
    () => [...new Set(boards.flatMap((b) => b.columns.map((c) => c.title)))].sort(),
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
      if (filterStage && !b.columns.some((c) => c.title.toLowerCase().includes(filterStage.toLowerCase()))) return false
      if (showOnlyOverdue) {
        const hasOverdue = b.columns.some((c) =>
          c.tasks.some((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'DONE' && t.status !== 'CANCELLED'),
        )
        if (!hasOverdue) return false
      }
      return true
    })
  }, [boards, search, filterClient, filterResponsible, filterStage, showOnlyOverdue, now])

  const hasActiveFilter = search || filterClient || filterResponsible || filterStage || showOnlyOverdue

  const groups = useMemo((): Group[] => {
    if (hasActiveFilter) {
      return [
        {
          label: 'Resultados',
          boards: [...filtered].sort((a, b) => {
            const da = getMostUrgentDueDate(a)
            const db = getMostUrgentDueDate(b)
            if (!da && !db) return 0
            if (!da) return 1
            if (!db) return -1
            return da.getTime() - db.getTime()
          }),
          headerCls: 'bg-gray-100 text-gray-700',
          defaultOpen: true,
        },
      ]
    }

    const overdue = filtered.filter((b) => {
      const d = getMostUrgentDueDate(b)
      return d && d < now
    })
    const dueSoon = filtered.filter((b) => {
      const d = getMostUrgentDueDate(b)
      return d && d >= now && d <= in7days
    })
    const inProgress = filtered.filter((b) => {
      const d = getMostUrgentDueDate(b)
      const p = getProgress(b)
      return p < 100 && (!d || d > in7days)
    })
    const completed = filtered.filter((b) => getProgress(b) === 100)

    return [
      { label: '⚠ Atrasados', boards: overdue, headerCls: 'bg-red-50 text-red-700', defaultOpen: true },
      { label: '⏰ Vence em 7 dias', boards: dueSoon, headerCls: 'bg-amber-50 text-amber-700', defaultOpen: true },
      { label: '📋 Em andamento', boards: inProgress, headerCls: 'bg-blue-50 text-blue-700', defaultOpen: true },
      { label: '✓ Concluídos', boards: completed, headerCls: 'bg-gray-100 text-gray-600', defaultOpen: false },
    ].filter((g) => g.boards.length > 0)
  }, [filtered, hasActiveFilter, now, in7days])

  if (isLoading) return <div className="p-8 text-gray-500">Carregando processos...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Processos</h1>
        {MANAGER_ROLES.includes(user?.role ?? '') && (
          <Button
            onClick={() => setNewProcessOpen(true)}
            className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2"
          >
            <Plus size={16} />
            Novo Processo
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Buscar processo ou cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60"
        />

        <select
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Cliente</option>
          {uniqueClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {MANAGER_ROLES.includes(user?.role ?? '') && (
          <select
            value={filterResponsible}
            onChange={(e) => setFilterResponsible(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Colaborador</option>
            {uniqueResponsible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}

        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Etapa</option>
          {uniqueStages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <button
          type="button"
          onClick={() => setShowOnlyOverdue(!showOnlyOverdue)}
          className={cn(
            'h-9 px-3 rounded-md text-sm font-medium border transition-colors',
            showOnlyOverdue
              ? 'bg-red-500 text-white border-red-500'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50',
          )}
        >
          ⚠ Atrasados
        </button>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFilterClient(''); setFilterResponsible(''); setFilterStage(''); setShowOnlyOverdue(false) }}
            className="text-xs text-blue-600 hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Grupos */}
      <div className="space-y-3">
        {groups.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg font-medium mb-2">Nenhum processo encontrado</p>
            <p className="text-sm">Ajuste os filtros ou crie um novo processo</p>
          </div>
        ) : (
          groups.map((group) => <BoardGroup key={group.label} group={group} now={now} />)
        )}
      </div>

      {/* Modal Novo Processo */}
      <Dialog open={newProcessOpen} onOpenChange={setNewProcessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Novo Processo</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (newProcessForm.title.trim() && newProcessForm.clientId) createMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="proc-title">Título do processo</Label>
              <Input
                id="proc-title"
                placeholder="Ex: Abertura de empresa LTDA"
                value={newProcessForm.title}
                onChange={(e) => setNewProcessForm({ ...newProcessForm, title: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-client">Cliente</Label>
              <select
                id="proc-client"
                value={newProcessForm.clientId}
                onChange={(e) => setNewProcessForm({ ...newProcessForm, clientId: e.target.value })}
                required
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">Selecione um cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400">3 colunas padrão serão criadas automaticamente: Pendente → Em andamento → Concluído</p>
            {createMutation.isError && <p className="text-sm text-red-600">Erro ao criar processo. Tente novamente.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setNewProcessOpen(false)}>Cancelar</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !newProcessForm.title.trim() || !newProcessForm.clientId}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {createMutation.isPending ? 'Criando...' : 'Criar processo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
