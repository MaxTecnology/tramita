import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2, History, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type {
  RecurringTaskTemplate,
  RecurringTaskAssignment,
  RecurringGenerationLog,
  Client,
  BulkGenerationResult,
  FailedGeneration,
} from '@/types'

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthValueToISO(monthValue: string): string {
  return new Date(`${monthValue}-01T00:00:00.000Z`).toISOString()
}

export default function RecurringTemplateManage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [dueMonth, setDueMonth] = useState(currentMonthValue())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [clientId, setClientId] = useState('')

  const { data: template, isLoading: loadingTemplate } = useQuery<RecurringTaskTemplate>({
    queryKey: ['recurring-template', id],
    queryFn: () => api.get(`/recurring-templates/${id}`).then((r) => r.data),
  })

  const { data: assignments = [] } = useQuery<RecurringTaskAssignment[]>({
    queryKey: ['recurring-assignments', id, search],
    queryFn: () => api.get(`/recurring-templates/${id}/assignments`, { params: search ? { q: search } : {} }).then((r) => r.data),
    enabled: !!id,
  })

  // Lista completa (sem filtro de busca) usada pelo retryMutation pra resolver assignmentIds
  // da falha clicada no banner — independe do que está digitado na busca da lista de checkboxes.
  const { data: allAssignments = [] } = useQuery<RecurringTaskAssignment[]>({
    queryKey: ['recurring-assignments-all', id],
    queryFn: () => api.get(`/recurring-templates/${id}/assignments`).then((r) => r.data),
    enabled: !!id,
  })

  const { data: logs = [] } = useQuery<RecurringGenerationLog[]>({
    queryKey: ['recurring-generation-log', id],
    queryFn: () => api.get(`/recurring-templates/${id}/generation-log`).then((r) => r.data),
    enabled: !!id,
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: allFailures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
  })
  const templateFailures = allFailures.filter((f) => f.templateId === id)

  const addMutation = useMutation({
    mutationFn: () => api.post(`/recurring-templates/${id}/assignments`, { clientId }),
    onSuccess: () => {
      toast.success('Cliente vinculado')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', id] })
      setClientId('')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao vincular cliente')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/recurring-templates/${id}/assignments/${assignmentId}`),
    onSuccess: () => {
      toast.success('Vínculo removido')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', id] })
      setSelected((prev) => {
        const next = new Set(prev)
        return next
      })
    },
  })

  const bulkGenerateMutation = useMutation({
    mutationFn: () =>
      api.post<BulkGenerationResult>(`/recurring-templates/${id}/assignments/bulk-generate`, {
        dueMonth: monthValueToISO(dueMonth),
        assignmentIds: [...selected],
      }).then((r) => r.data),
    onSuccess: (result) => {
      toast.success(`${result.generated} geradas, ${result.alreadyExists} já existiam, ${result.failed.length} falharam`)
      qc.invalidateQueries({ queryKey: ['recurring-generation-log', id] })
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
      setSelected(new Set())
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao gerar em lote')
    },
  })

  const retryMutation = useMutation({
    mutationFn: (failure: FailedGeneration) =>
      api.post(`/recurring-templates/${failure.templateId}/assignments/bulk-generate`, {
        dueMonth: failure.competence,
        // Usa allAssignments (sem filtro de busca) — não assignments (filtrado pelo search state),
        // senão o cliente da falha pode não estar na lista filtrada e assignmentIds fica vazio,
        // o que falha a validação .min(1) do backend e quebra o botão "Gerar novamente".
        assignmentIds: allAssignments.filter((a) => a.clientId === failure.clientId).map((a) => a.id),
      }),
    onSuccess: () => {
      toast.success('Tentativa de nova geração enviada')
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
      qc.invalidateQueries({ queryKey: ['recurring-generation-log', id] })
    },
  })

  function toggleSelected(assignmentId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(assignmentId)) next.delete(assignmentId)
      else next.add(assignmentId)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(assignments.map((a) => a.id)))
  }

  if (loadingTemplate || !template) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/app/settings/recurring-templates" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">{template.title} — vínculos e geração</h1>
      </div>

      {templateFailures.length > 0 && (
        <Card className="border-danger-text bg-danger-bg px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-danger-text font-medium text-sm">
            <AlertTriangle size={16} />
            {templateFailures.length} {templateFailures.length === 1 ? 'tarefa não foi gerada' : 'tarefas não foram geradas'}
          </div>
          <ul className="space-y-1">
            {templateFailures.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-danger-text">
                <span>{f.clientName} — competência {new Date(f.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — {f.errorMessage}</span>
                <button
                  type="button"
                  onClick={() => retryMutation.mutate(f)}
                  disabled={retryMutation.isPending}
                  className="underline hover:no-underline flex-shrink-0 ml-2"
                >
                  Gerar novamente
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="px-4 py-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="space-y-1.5">
            <Label>Mês de vencimento</Label>
            <input
              type="month"
              value={dueMonth}
              onChange={(e) => setDueMonth(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            />
          </div>
          <div className="space-y-1.5 flex-1">
            <Label>Buscar cliente</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do cliente..." />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button type="button" onClick={selectAll} className="text-xs text-accent hover:underline">Selecionar todos</button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">Limpar seleção</button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => bulkGenerateMutation.mutate()}
            disabled={selected.size === 0 || bulkGenerateMutation.isPending}
          >
            {bulkGenerateMutation.isPending ? 'Gerando...' : `Gerar selecionados (${selected.size})`}
          </Button>
        </div>

        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {assignments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
          ) : (
            assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelected(a.id)} />
                  {a.client.codigo ? `${a.client.codigo} - ${a.client.name}` : a.client.name}
                </label>
                <button onClick={() => removeMutation.mutate(a.id)} className="text-muted-foreground hover:text-danger-text flex-shrink-0">
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="px-4 py-3 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Vincular novo cliente</Label>
        <div className="grid grid-cols-2 gap-2">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
            <option value="">Cliente</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
          </select>
        </div>
        <Button type="button" size="sm" onClick={() => addMutation.mutate()} disabled={!clientId || addMutation.isPending}>
          Vincular cliente
        </Button>
      </Card>

      <Card className="px-4 py-3 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <History size={12} /> Log de geração
        </Label>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma geração registrada ainda.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className={`text-xs rounded px-2 py-1 ${l.status === 'FAILED' ? 'bg-danger-bg text-danger-text' : 'bg-success-bg text-success-text'}`}>
                {new Date(l.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — {l.status === 'FAILED' ? l.errorMessage : 'Gerado com sucesso'}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
