import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Client, OSModel, ProcessTemplate } from '@/types'

const selectCls = 'flex h-9 w-full rounded-md border border-border bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const EMPTY = { templateId: '', title: '', clientId: '', competence: '', dueDate: '' }

// New process: from a Process Model (its columns and OS, dependencies included) or blank (3 default columns)
export function NewProcessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)

  const { data: clients = [] } = useQuery<Client[]>({ queryKey: ['clients'], queryFn: () => api.get('/clients').then((r) => r.data), enabled: open })
  const { data: templates = [] } = useQuery<ProcessTemplate[]>({
    queryKey: ['process-templates'], queryFn: () => api.get('/process-templates').then((r) => r.data), enabled: open,
  })
  const { data: osModels = [], isPending: modelsPending, isError: modelsError } = useQuery<Pick<OSModel, 'id' | 'requiresCompetence'>[]>({
    queryKey: ['os-models', 'all'], queryFn: () => api.get('/os-models').then((r) => r.data), enabled: open,
  })

  const active = useMemo(() => templates.filter((t) => t.isActive), [templates])
  const template = active.find((t) => t.id === form.templateId)
  // The OS of the model that are of a period need the month (the API answers 422 without it)
  const needsCompetence = !!template?.items.some((it) => osModels.find((m) => m.id === it.osModelId)?.requiresCompetence)
  // Until the OS models are known, a model with OS can't be sent: the month could be missing
  const modelsUnknown = !!template && template.items.length > 0 && (modelsPending || modelsError)

  const close = () => { setForm(EMPTY); create.reset(); onClose() }

  const create = useMutation({
    mutationFn: () => api.post('/boards', {
      title: form.title.trim(),
      clientId: form.clientId,
      ...(template ? { processTemplateId: template.id } : {}),
      ...(needsCompetence ? { competence: form.competence } : {}),
      // "YYYY-MM-DD" is parsed as UTC midnight (date-only convention, see lib/dates.ts)
      ...(form.dueDate ? { dueDate: new Date(form.dueDate).toISOString() } : {}),
    }).then((r) => r.data as { id: string }),
    onSuccess: (board) => {
      toast.success('Processo criado com sucesso')
      qc.invalidateQueries({ queryKey: ['boards'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['os'] })
      close()
      navigate(`/app/board/${board.id}`)
    },
  })

  const chooseTemplate = (templateId: string) => {
    const next = active.find((t) => t.id === templateId)
    const previous = template?.name ?? ''
    // The model name fills the title unless the person already wrote their own
    setForm({ ...form, templateId, title: !form.title.trim() || form.title === previous ? (next?.name ?? '') : form.title })
  }

  const canCreate = !!form.title.trim() && !!form.clientId && !modelsUnknown && (!needsCompetence || !!form.competence)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Novo Processo</DialogTitle></DialogHeader>
        <form className="space-y-4 mt-2" onSubmit={(e) => { e.preventDefault(); if (canCreate) create.mutate() }}>
          <div className="space-y-1.5">
            <Label htmlFor="proc-template">Modelo de processo</Label>
            <select id="proc-template" className={selectCls} value={form.templateId} onChange={(e) => chooseTemplate(e.target.value)}>
              <option value="">Sem modelo (3 colunas padrão)</option>
              {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proc-title">Título do processo</Label>
            <Input id="proc-title" placeholder="Ex: Abertura de empresa LTDA" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proc-client">Cliente</Label>
            <select id="proc-client" className={selectCls} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required>
              <option value="">Selecione um cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
            </select>
          </div>
          {needsCompetence && (
            <div className="space-y-1.5">
              <Label htmlFor="proc-competence">Competência</Label>
              <Input id="proc-competence" type="month" value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} />
              <p className="text-xs text-muted-foreground">Vai para as OS do modelo que são de um período.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="proc-due">Prazo estimado de conclusão</Label>
            <Input id="proc-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              Opcional — você poderá alterar depois{template?.deadlineBusinessDays ? ` (o prazo interno do modelo é de ${template.deadlineBusinessDays} dias úteis)` : ''}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {template
              ? `O processo nasce com as ${template.columns.length} colunas e ${template.items.length} OS do modelo.`
              : '3 colunas padrão serão criadas automaticamente: Pendente → Em andamento → Concluído'}
          </p>
          {template && template.items.length > 0 && modelsError && (
            <p className="text-sm text-danger-text">Não foi possível carregar os modelos de OS. Feche e abra de novo.</p>
          )}
          {create.isError && <p className="text-sm text-danger-text">{mensagemDeErro(create.error, 'Erro ao criar processo. Tente novamente.')}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending || !canCreate} className={cn('bg-accent hover:bg-accent-hover text-accent-foreground')}>
              {create.isPending ? 'Criando...' : 'Criar processo'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
