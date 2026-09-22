import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Input } from '@/components/ui/input'
import { Search, X, FileSearch } from 'lucide-react'
import type { Board, OSTemplate } from '@/types'

const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

export default function OSList() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterResponsible, setFilterResponsible] = useState('')

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  const { data: templates = [] } = useQuery<OSTemplate[]>({
    queryKey: ['os-templates'],
    queryFn: () => api.get('/os-templates').then((r) => r.data),
  })

  const templateName = useMemo(() => {
    const map = new Map(templates.map((t) => [t.id, t.name]))
    return (osTemplateId?: string | null) => (osTemplateId ? (map.get(osTemplateId) ?? 'Sem template') : 'Sem template')
  }, [templates])

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

  const filtered = useMemo(() => {
    return boards.filter((b) => {
      if (search) {
        const q = search.toLowerCase()
        if (!b.title.toLowerCase().includes(q) && !b.client.name.toLowerCase().includes(q)) return false
      }
      if (filterClient && b.client.id !== filterClient) return false
      if (filterResponsible && b.responsibleUser?.id !== filterResponsible) return false
      return true
    })
  }, [boards, search, filterClient, filterResponsible])

  const hasActiveFilter = search || filterClient || filterResponsible

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando ordens de serviço...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg md:text-xl font-bold text-foreground">Ordens de Serviço</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Acompanhe as ordens de serviço em andamento.</p>
      </div>

      {/* Card de filtros */}
      <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-full sm:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar OS ou cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 border-border focus:ring-accent"
            />
          </div>

          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Cliente</option>
            {uniqueClients.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>
            ))}
          </select>

          {MANAGER_ROLES.includes(user?.role ?? '') && (
            <select
              value={filterResponsible}
              onChange={(e) => setFilterResponsible(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Colaborador</option>
              {uniqueResponsible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => { setSearch(''); setFilterClient(''); setFilterResponsible('') }}
              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <X size={13} />
              Limpar
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <FileSearch size={40} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-base font-medium text-muted-foreground mb-1">Nenhuma ordem de serviço encontrada</p>
          <p className="text-sm text-muted-foreground">Ajuste os filtros ou crie uma nova OS a partir de Processos</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-neutral-bg/80 border-b border-border">
            <div className="flex-[2] text-xs font-semibold text-muted-foreground uppercase tracking-wide">OS</div>
            <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template</div>
            <div className="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Responsável</div>
            <div className="w-20 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Tarefas</div>
          </div>
          {filtered.map((board) => {
            const taskCount = board.columns.reduce((acc, c) => acc + c.tasks.length, 0)
            return (
              <Link
                key={board.id}
                to={`/app/board/${board.id}`}
                className="block px-4 py-3 hover:bg-neutral-bg transition-colors border-b border-border last:border-0"
              >
                {/* Mobile */}
                <div className="md:hidden">
                  <p className="text-sm font-medium text-foreground truncate">{board.title} — {board.client.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground truncate">{templateName(board.osTemplateId)}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{taskCount} tarefa{taskCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {/* Desktop */}
                <div className="hidden md:flex items-center gap-3">
                  <div className="flex-[2] min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{board.title} — {board.client.name}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground truncate">{templateName(board.osTemplateId)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground truncate">{board.responsibleUser?.name ?? '—'}</p>
                  </div>
                  <div className="w-20 text-right">
                    <span className="text-sm text-muted-foreground">{taskCount}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
