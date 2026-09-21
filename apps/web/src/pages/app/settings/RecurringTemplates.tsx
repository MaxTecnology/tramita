import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Repeat, Users, History } from 'lucide-react'
import { toast } from 'sonner'
import type { RecurringTaskTemplate, RecurringTaskAssignment, RecurringGenerationLog, Department, Client, Board } from '@/types'

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  ANNUAL: 'Anual',
}

const MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
const WEEKDAY_LABEL: Record<number, string> = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo' }

interface FormState {
  departmentId: string
  title: string
  description: string
  periodicity: RecurringTaskTemplate['periodicity']
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueRollToBusinessDay: boolean
  targetOffsetDays: number
  targetRollToBusinessDay: boolean
  generationMonthOffset: number
  generationDayOfPeriod: number
  autoCompleteOnAllActivitiesDone: boolean
  notifyViaWhatsapp: boolean
  notifyViaEmail: boolean
  visibleToClient: boolean
  isActive: boolean
  documentRequests: { name: string }[]
  documentDeliveries: { name: string }[]
}

const EMPTY_FORM: FormState = {
  departmentId: '', title: '', description: '', periodicity: 'MONTHLY',
  dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
  targetOffsetDays: 0, targetRollToBusinessDay: false,
  generationMonthOffset: 1, generationDayOfPeriod: 20,
  autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
}

function DocumentListEditor({ label, items, onChange }: {
  label: string
  items: { name: string }[]
  onChange: (items: { name: string }[]) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nome do documento"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }
          }}
        />
        <Button type="button" variant="outline" onClick={() => { if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }}>
          Adicionar
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1">
              {item.name}
              <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-danger-text">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RecurringTemplates() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringTaskTemplate | null>(null)
  const [managing, setManaging] = useState<RecurringTaskTemplate | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: templates = [], isLoading } = useQuery<RecurringTaskTemplate[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`/recurring-templates/${editing.id}`, form).then((r) => r.data)
        : api.post('/recurring-templates', form).then((r) => r.data),
    onSuccess: () => {
      toast.success(editing ? 'Template atualizado' : 'Template criado')
      qc.invalidateQueries({ queryKey: ['recurring-templates'] })
      closeDialog()
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar template')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/recurring-templates/${id}`),
    onSuccess: () => {
      toast.success('Template removido')
      qc.invalidateQueries({ queryKey: ['recurring-templates'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao remover template')
    },
  })

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(t: RecurringTaskTemplate) {
    setEditing(t)
    setForm({
      departmentId: t.departmentId, title: t.title, description: t.description ?? '',
      periodicity: t.periodicity, dueMonthOffset: t.dueMonthOffset, dueDayOfPeriod: t.dueDayOfPeriod,
      dueRollToBusinessDay: t.dueRollToBusinessDay, targetOffsetDays: t.targetOffsetDays,
      targetRollToBusinessDay: t.targetRollToBusinessDay, generationMonthOffset: t.generationMonthOffset,
      generationDayOfPeriod: t.generationDayOfPeriod, autoCompleteOnAllActivitiesDone: t.autoCompleteOnAllActivitiesDone,
      notifyViaWhatsapp: t.notifyViaWhatsapp, notifyViaEmail: t.notifyViaEmail, visibleToClient: t.visibleToClient,
      isActive: t.isActive,
      documentRequests: t.documentRequests.map((d) => ({ name: d.name })),
      documentDeliveries: t.documentDeliveries.map((d) => ({ name: d.name })),
    })
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  const isWeekly = form.periodicity === 'WEEKLY'
  const dayOptions = isWeekly ? [1, 2, 3, 4, 5, 6, 7] : Array.from({ length: 31 }, (_, i) => i + 1)

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Tarefas Recorrentes</h1>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} />
          Novo template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Repeat size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum template de recorrência cadastrado</p>
          <p className="text-xs mt-1">Crie um pra gerar tarefas automaticamente (ex: Folha de pagamento, mensal).</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{t.title}</span>
                  {!t.isActive && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">Inativo</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{PERIODICITY_LABEL[t.periodicity]} · {t.department.name}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setManaging(t)} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Vínculos e log">
                  <Users size={14} />
                </button>
                <button onClick={() => openEdit(t)} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { if (window.confirm(`Excluir o template "${t.title}"?`)) deleteMutation.mutate(t.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog() }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar template' : 'Novo template'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Folha de pagamento" required />
            </div>

            <div className="space-y-1.5">
              <Label>Departamento</Label>
              <select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                required
              >
                <option value="">Selecione</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Periodicidade</Label>
              <select
                value={form.periodicity}
                onChange={(e) => setForm({ ...form, periodicity: e.target.value as FormState['periodicity'] })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              >
                {Object.entries(PERIODICITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vencimento — meses após competência</Label>
                <select
                  value={form.dueMonthOffset}
                  onChange={(e) => setForm({ ...form, dueMonthOffset: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  disabled={isWeekly}
                >
                  {MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês' : `${o} ${o === 1 ? 'mês' : 'meses'} depois`}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{isWeekly ? 'Dia da semana do vencimento' : 'Dia do vencimento'}</Label>
                <select
                  value={form.dueDayOfPeriod}
                  onChange={(e) => setForm({ ...form, dueDayOfPeriod: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {dayOptions.map((d) => <option key={d} value={d}>{isWeekly ? WEEKDAY_LABEL[d] : d}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.dueRollToBusinessDay} onChange={(e) => setForm({ ...form, dueRollToBusinessDay: e.target.checked })} />
              Empurrar vencimento pro próximo dia útil se cair em fim de semana
            </label>

            <div className="space-y-1.5">
              <Label>Meta interna — dias em relação ao vencimento (negativo = antes)</Label>
              <Input
                type="number"
                value={form.targetOffsetDays}
                onChange={(e) => setForm({ ...form, targetOffsetDays: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.targetRollToBusinessDay} onChange={(e) => setForm({ ...form, targetRollToBusinessDay: e.target.checked })} />
              Empurrar meta pro próximo dia útil se cair em fim de semana
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Geração — meses antes da competência</Label>
                <select
                  value={form.generationMonthOffset}
                  onChange={(e) => setForm({ ...form, generationMonthOffset: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês' : `${o} ${o === 1 ? 'mês' : 'meses'} antes`}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Dia da geração</Label>
                <select
                  value={form.generationDayOfPeriod}
                  onChange={(e) => setForm({ ...form, generationDayOfPeriod: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            <DocumentListEditor
              label="Documentos a cobrar do cliente"
              items={form.documentRequests}
              onChange={(items) => setForm({ ...form, documentRequests: items })}
            />
            <DocumentListEditor
              label="Documentos a entregar ao cliente"
              items={form.documentDeliveries}
              onChange={(items) => setForm({ ...form, documentDeliveries: items })}
            />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.autoCompleteOnAllActivitiesDone} onChange={(e) => setForm({ ...form, autoCompleteOnAllActivitiesDone: e.target.checked })} />
              Concluir automaticamente quando todas as atividades forem resolvidas
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.notifyViaWhatsapp} onChange={(e) => setForm({ ...form, notifyViaWhatsapp: e.target.checked })} />
                Notificar via WhatsApp
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.notifyViaEmail} onChange={(e) => setForm({ ...form, notifyViaEmail: e.target.checked })} />
                Notificar via e-mail
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visibleToClient} onChange={(e) => setForm({ ...form, visibleToClient: e.target.checked })} />
              O cliente pode ver esta tarefa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Ativo
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending || !form.title.trim() || !form.departmentId}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {managing && <ManageTemplateDialog template={managing} onClose={() => setManaging(null)} />}
    </div>
  )
}

function ManageTemplateDialog({ template, onClose }: { template: RecurringTaskTemplate; onClose: () => void }) {
  const qc = useQueryClient()
  const [clientId, setClientId] = useState('')
  const [boardId, setBoardId] = useState('')
  const [columnId, setColumnId] = useState('')

  const { data: assignments = [] } = useQuery<RecurringTaskAssignment[]>({
    queryKey: ['recurring-assignments', template.id],
    queryFn: () => api.get(`/recurring-templates/${template.id}/assignments`).then((r) => r.data),
  })

  const { data: logs = [] } = useQuery<RecurringGenerationLog[]>({
    queryKey: ['recurring-generation-log', template.id],
    queryFn: () => api.get(`/recurring-templates/${template.id}/generation-log`).then((r) => r.data),
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: boards = [] } = useQuery<Board[]>({
    queryKey: ['boards', clientId],
    queryFn: () => api.get('/boards', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  const board = boards.find((b) => b.id === boardId)

  const addMutation = useMutation({
    mutationFn: () => api.post(`/recurring-templates/${template.id}/assignments`, { clientId, boardId, columnId }),
    onSuccess: () => {
      toast.success('Cliente vinculado')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', template.id] })
      setClientId(''); setBoardId(''); setColumnId('')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao vincular cliente')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/recurring-templates/${template.id}/assignments/${assignmentId}`),
    onSuccess: () => {
      toast.success('Vínculo removido')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', template.id] })
    },
  })

  const generateMutation = useMutation({
    mutationFn: (assignmentId: string) => api.post(`/recurring-templates/${template.id}/assignments/${assignmentId}/generate`, {}),
    onSuccess: () => {
      toast.success('Tarefa gerada')
      qc.invalidateQueries({ queryKey: ['recurring-generation-log', template.id] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao gerar tarefa')
    },
  })

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.title} — vínculos e geração</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Clientes vinculados</Label>
            {assignments.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">Nenhum cliente vinculado ainda.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {assignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
                    <span>{a.client.name} — {a.board.title}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => generateMutation.mutate(a.id)} className="text-xs text-accent hover:underline">Gerar agora</button>
                      <button onClick={() => removeMutation.mutate(a.id)} className="text-muted-foreground hover:text-danger-text">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setBoardId(''); setColumnId('') }} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">Cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={boardId} onChange={(e) => { setBoardId(e.target.value); setColumnId('') }} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" disabled={!clientId}>
              <option value="">Processo</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <select value={columnId} onChange={(e) => setColumnId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" disabled={!boardId}>
              <option value="">Coluna</option>
              {board?.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" onClick={() => addMutation.mutate()} disabled={!clientId || !boardId || !columnId || addMutation.isPending}>
            Vincular cliente
          </Button>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <History size={12} /> Log de geração
            </Label>
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">Nenhuma geração registrada ainda.</p>
            ) : (
              <div className="space-y-1 mt-2 max-h-40 overflow-y-auto">
                {logs.map((l) => (
                  <div key={l.id} className={`text-xs rounded px-2 py-1 ${l.status === 'FAILED' ? 'bg-danger-bg text-danger-text' : 'bg-success-bg text-success-text'}`}>
                    {new Date(l.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} — {l.status === 'FAILED' ? l.errorMessage : 'Gerado com sucesso'}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
