import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, FileStack, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { formatDateOnlyUTC } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeadlineChip } from '@/components/shared/DeadlineChip'
import { PageHeader } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { ListTable, ROW_OPENER } from '@/components/ui/list-table'
import type { DeadlineInfo, DeadlineState } from '@/types'
import { ChoiceGroup } from '@/components/ui/choice-group'

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

const selectCls = 'h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

// Ordens de Serviço: every OS (standalone or inside a process) with the situation of its internal
// deadline. A row opens the OS where it lives (Tarefas for standalone, the process board otherwise).
export default function OSList() {
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
    <div className="p-4 md:p-6">
      <PageHeader
        title="Ordens de Serviço"
        description="Serviços avulsos e etapas de processos, com o prazo interno de cada um."
        actions={<Button onClick={() => setCreating(true)} className="gap-1.5"><Plus size={16} aria-hidden />Nova OS</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField label="Buscar ordens de serviço" placeholder="OS ou cliente" value={search} onChange={setSearch} className="w-full sm:w-64" />
        <select aria-label="Filtrar por cliente" className={selectCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
        </select>
        <select aria-label="Filtrar por modelo" className={selectCls} value={osModelId} onChange={(e) => setOsModelId(e.target.value)}>
          <option value="">Todos os modelos</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {hasFilter && (
          <button type="button" onClick={() => { setSearch(''); setClientId(''); setOsModelId(''); setSituation('') }} className="inline-flex h-9 items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
            <X size={14} aria-hidden />Limpar filtros
          </button>
        )}
      </div>

      <ChoiceGroup label="Situação" variant="chips" className="mb-4" value={situation} onChange={setSituation} options={SITUATIONS} />

      <ListTable<OSItem>
        label="Ordens de serviço"
        loading={isLoading}
        rows={items}
        rowKey={(o) => o.id}
        interactive
        empty={
          <div className="flex flex-col items-center text-muted-foreground">
            <FileStack size={40} aria-hidden className="mb-3 opacity-40" />
            <p className="text-sm font-medium">Nenhuma OS {hasFilter ? 'com esses filtros' : 'ainda'}</p>
            {!hasFilter && <p className="mt-1 text-xs">Abra uma OS pelo botão "Nova OS", ou aprove uma solicitação de serviço.</p>}
          </div>
        }
        columns={[
          {
            header: 'OS', width: 'minmax(0,2fr)',
            cell: (o) => (
              <div className="min-w-0">
                <Link to={o.link} className={cn(ROW_OPENER, 'block text-sm')}>{o.title}</Link>
                {o.process && <p className="text-xs text-muted-foreground">{o.process.title}</p>}
                {o.delayReasonPending && <p className="text-xs font-medium text-danger-text">Motivo do atraso pendente</p>}
              </div>
            ),
          },
          {
            header: 'Cliente', width: 'minmax(0,1.3fr)',
            cell: (o) => (
              <p className="text-sm text-foreground">
                <span>{o.client.name}</span>
                {o.client.codigo && <span className="ml-1 text-xs text-muted-foreground">#{o.client.codigo}</span>}
              </p>
            ),
          },
          {
            header: 'Responsável', width: 'minmax(0,1.1fr)',
            cell: (o) => (
              <div className="min-w-0 text-sm">
                <p className={cn('truncate', o.assignee ? 'text-foreground' : 'text-muted-foreground')}>{o.assignee?.name ?? 'Sem responsável'}</p>
                <p className="truncate text-xs text-muted-foreground">{o.department.name}</p>
              </div>
            ),
          },
          {
            header: 'Prazo', width: '11rem',
            cell: (o) => (
              <div className="flex flex-col items-start gap-0.5">
                <DeadlineChip deadline={o.deadline} />
                {o.targetDate && <span className="text-xs text-muted-foreground">Meta {formatDateOnlyUTC(o.targetDate)}</span>}
              </div>
            ),
          },
        ]}
      />

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
