import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { User } from '@/types'

interface PortfolioEntry {
  clientId: string
  clientName: string
  codigo: string
  departments: { id: string; name: string }[]
  boardsCount: number
  openTasksCount: number
}

interface TransferResult { assignments: number; boards: number; tasks: number }

const selectClass = 'h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

// Repartir a carteira de um colaborador (responsável por departamento no cliente, por processo e
// tarefas abertas) entre outros — dá pra transferir em lotes, a lista encolhe a cada transferência.
export default function UserTransfer() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [departmentId, setDepartmentId] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toUserId, setToUserId] = useState('')
  const [includeBoards, setIncludeBoards] = useState(true)
  const [includeTasks, setIncludeTasks] = useState(true)

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  })
  const source = users.find((u) => u.id === id)

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const { data: portfolio = [], isLoading } = useQuery<PortfolioEntry[]>({
    queryKey: ['user-portfolio', id, departmentId],
    queryFn: () =>
      api.get(`/users/${id}/portfolio`, { params: departmentId ? { departmentId } : {} }).then((r) => r.data),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return portfolio.filter((p) => !q || p.clientName.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
  }, [portfolio, search])

  const destinations = users.filter((u) => u.id !== id && u.isActive && u.role !== 'MASTER')

  const transferMutation = useMutation({
    mutationFn: () =>
      api.post<TransferResult>(`/users/${id}/transfer`, {
        toUserId,
        clientIds: [...selected],
        departmentId: departmentId || undefined,
        includeBoards: !departmentId && includeBoards,
        includeTasks,
      }).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(`Transferido: ${r.assignments} responsabilidade(s), ${r.boards} processo(s), ${r.tasks} tarefa(s)`)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ['user-portfolio', id] })
      qc.invalidateQueries({ queryKey: ['client-assignments'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao transferir')),
  })

  const deactivateMutation = useMutation({
    mutationFn: () => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success('Colaborador desativado')
      qc.invalidateQueries({ queryKey: ['users'] })
      navigate('/app/users')
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao desativar colaborador')),
  })

  function toggle(clientId: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.clientId))

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/app/users" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">
          Transferir responsabilidades{source ? ` — ${source.name}` : ''}
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Buscar cliente"
          placeholder="Buscar cliente por nome ou código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <select
          aria-label="Filtrar por departamento"
          value={departmentId}
          onChange={(e) => { setDepartmentId(e.target.value); setSelected(new Set()) }}
          className={selectClass}
        >
          <option value="">Todos os departamentos</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : portfolio.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {departmentId
              ? 'Nenhuma responsabilidade neste departamento.'
              : 'Este colaborador não tem mais clientes, processos nem tarefas abertas.'}
          </p>
          {!departmentId && source?.isActive && (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700"
              disabled={deactivateMutation.isPending}
              onClick={() => { if (window.confirm(`Desativar ${source.name}?`)) deactivateMutation.mutate() }}
            >
              Desativar colaborador
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-surface divide-y divide-border">
            <label className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((p) => p.clientId)))}
              />
              Selecionar todos ({filtered.length})
            </label>
            {filtered.map((p) => (
              <label key={p.clientId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" checked={selected.has(p.clientId)} onChange={() => toggle(p.clientId)} />
                <span className="font-medium text-foreground flex-1 min-w-[12rem]">{p.codigo} - {p.clientName}</span>
                <span className="text-xs text-muted-foreground">
                  {p.departments.map((d) => d.name).join(', ') || 'sem departamento'}
                  {' · '}{p.boardsCount} processo(s) · {p.openTasksCount} tarefa(s) aberta(s)
                </span>
              </label>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-surface p-3 flex flex-wrap items-center gap-3">
            <select aria-label="Colaborador de destino" value={toUserId} onChange={(e) => setToUserId(e.target.value)} className={selectClass}>
              <option value="">Transferir para…</option>
              {destinations.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-foreground" title={departmentId ? 'Processo não tem departamento: só é transferido com o filtro "Todos os departamentos"' : undefined}>
              <input type="checkbox" checked={!departmentId && includeBoards} disabled={!!departmentId} onChange={(e) => setIncludeBoards(e.target.checked)} />
              Incluir processos
            </label>
            <label className="flex items-center gap-1.5 text-sm text-foreground">
              <input type="checkbox" checked={includeTasks} onChange={(e) => setIncludeTasks(e.target.checked)} />
              Incluir tarefas abertas
            </label>
            <Button
              className="ml-auto bg-[#185FA5] hover:bg-[#0C447C] text-white"
              disabled={!toUserId || selected.size === 0 || transferMutation.isPending}
              onClick={() => transferMutation.mutate()}
            >
              {transferMutation.isPending ? 'Transferindo...' : `Transferir ${selected.size} cliente(s)`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
