import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, X, FileStack, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { formatDateOnlyUTC } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeadlineChip } from '@/components/shared/DeadlineChip'
import type { DeadlineInfo, DeadlineState } from '@/types'

interface OSItem {
  id: string
  title: string
  status: string
  competence: string | null
  dueDate: string | null
  targetDate: string | null
  client: { id: string; name: string; codigo: string | null }
  osModel: { id: string; name: string }
  assignee: { id: string; name: string } | null
  department: { id: string; name: string }
  process: { id: string; title: string } | null
  deadline: DeadlineInfo
  delayReasonPending: boolean
  link: string
}

const SITUATIONS: { value: '' | DeadlineState; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'LATE', label: 'Atrasadas' },
  { value: 'DUE_SOON', label: 'Vencem logo' },
  { value: 'ON_TIME', label: 'No prazo' },
  { value: 'PAUSED', label: 'Aguardando cliente' },
  { value: 'WAITING_DEPENDENCY', label: 'Aguardando outra OS' },
  { value: 'DONE', label: 'Concluídas' },
]

const selectCls = 'h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm'

// Ordens de Serviço: every OS (standalone or inside a process) with the situation of its internal
// deadline. A row opens the OS where it lives (Tarefas for standalone, the process board otherwise).
export default function OSList() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [osModelId, setOsModelId] = useState('')
  const [situation, setSituation] = useState<'' | DeadlineState>('')
  const [creating, setCreating] = useState(false)

  const params = { ...(clientId ? { clientId } : {}), ...(osModelId ? { osModelId } : {}), ...(situation ? { situation } : {}), ...(search.trim() ? { search: search.trim() } : {}) }
  const { data: items = [], isLoading } = useQuery<OSItem[]>({
    queryKey: ['os', params],
    queryFn: () => api.get('/os', { params }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })
  const { data: models = [] } = useQuery<OSModelOption[]>({
    queryKey: ['os-models', 'all'],
    queryFn: () => api.get('/os-models').then((r) => r.data),
  })
  const { data: clients = [] } = useQuery<{ id: string; name: string; codigo: string | null }[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const hasFilter = !!(search || clientId || osModelId || situation)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-foreground">Ordens de Serviço</h1>
          <p className="text-sm text-muted-foreground">Serviços avulsos e etapas de processos, com o prazo de cada um.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2"><Plus size={16} />Nova OS</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar" className="pl-8 w-56" placeholder="OS ou cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select aria-label="Filtrar por cliente" className={selectCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
        </select>
        <select aria-label="Filtrar por modelo" className={selectCls} value={osModelId} onChange={(e) => setOsModelId(e.target.value)}>
          <option value="">Todos os modelos</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {hasFilter && (
          <button type="button" onClick={() => { setSearch(''); setClientId(''); setOsModelId(''); setSituation('') }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X size={12} />Limpar
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label="Situação" className="flex flex-wrap gap-1.5">
        {SITUATIONS.map((s) => (
          <button key={s.value || 'all'} type="button" role="radio" aria-checked={situation === s.value} onClick={() => setSituation(s.value)}
            className={cn('rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              situation === s.value ? 'bg-accent text-accent-foreground border-accent' : 'border-border text-muted-foreground hover:text-foreground')}>
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando ordens de serviço...</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FileStack size={44} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma OS {hasFilter ? 'com esses filtros' : 'ainda'}</p>
          <p className="text-xs mt-1">Abra uma OS pelo botão acima, ou aprove uma solicitação de serviço.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">OS</th>
                <th className="px-3 py-2 font-medium hidden md:table-cell">Responsável</th>
                <th className="px-3 py-2 font-medium">Prazo</th>
                <th className="px-3 py-2 font-medium hidden md:table-cell">Meta</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} onClick={() => navigate(o.link)} className="border-b border-border last:border-0 cursor-pointer hover:bg-neutral-bg">
                  <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                    {o.client.name}{o.client.codigo && <span className="ml-1 text-xs text-muted-foreground">#{o.client.codigo}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-foreground">{o.title}</span>
                    {o.process && <span className="block text-xs text-muted-foreground">{o.process.title}</span>}
                    {o.delayReasonPending && <span className="block text-xs text-danger-text">Motivo do atraso pendente</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">{o.assignee?.name ?? o.department.name}</td>
                  <td className="px-3 py-2.5"><DeadlineChip deadline={o.deadline} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell tabular-nums">{o.targetDate ? formatDateOnlyUTC(o.targetDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Process-only and inactive models can't be opened alone (the list filter still shows them) */}
      <NewOSDialog open={creating} onClose={() => setCreating(false)} models={models.filter((m) => m.usableStandalone && m.isActive)} clients={clients} />
    </div>
  )
}

type OSModelOption = { id: string; name: string; requiresCompetence: boolean; usableStandalone: boolean; isActive: boolean }

function NewOSDialog({ open, onClose, models, clients }: {
  open: boolean
  onClose: () => void
  models: OSModelOption[]
  clients: { id: string; name: string; codigo: string | null }[]
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [osModelId, setOsModelId] = useState('')
  const [clientId, setClientId] = useState('')
  const [competence, setCompetence] = useState('')
  const model = useMemo(() => models.find((m) => m.id === osModelId), [models, osModelId])

  const create = useMutation({
    mutationFn: () => api.post('/os', { osModelId, clientId, ...(model?.requiresCompetence ? { competence } : {}) }).then((r) => r.data as { id: string }),
    onSuccess: (os) => {
      toast.success('OS aberta')
      qc.invalidateQueries({ queryKey: ['os'] })
      onClose()
      setOsModelId(''); setClientId(''); setCompetence('')
      navigate(`/app/tasks?task=${os.id}`)
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao abrir OS')),
  })
  const canOpen = !!osModelId && !!clientId && (!model?.requiresCompetence || !!competence)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova OS</DialogTitle></DialogHeader>
        <form className="space-y-4 mt-2" onSubmit={(e) => { e.preventDefault(); if (canOpen) create.mutate() }}>
          <div className="space-y-1.5">
            <Label htmlFor="new-os-model">Modelo de OS</Label>
            <select id="new-os-model" className={cn(selectCls, 'w-full')} value={osModelId} onChange={(e) => setOsModelId(e.target.value)}>
              <option value="">Selecione</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-os-client">Cliente</Label>
            <select id="new-os-client" className={cn(selectCls, 'w-full')} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Selecione</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
            </select>
          </div>
          {model?.requiresCompetence && (
            <div className="space-y-1.5">
              <Label htmlFor="new-os-competence">Competência</Label>
              <Input id="new-os-competence" type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!canOpen || create.isPending}>Abrir OS</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
