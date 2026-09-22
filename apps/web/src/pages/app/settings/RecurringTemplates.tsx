import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Repeat, Users, History } from 'lucide-react'
import { toast } from 'sonner'
import type { RecurringTaskTemplate, RecurringTaskAssignment, RecurringGenerationLog, Client } from '@/types'

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  ANNUAL: 'Anual',
}

export default function RecurringTemplates() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [managing, setManaging] = useState<RecurringTaskTemplate | null>(null)

  const { data: templates = [], isLoading } = useQuery<RecurringTaskTemplate[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
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

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Tarefas Recorrentes</h1>
        <Button onClick={() => navigate('/app/settings/recurring-templates/new')} className="gap-2">
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
                <Link to={`/app/settings/recurring-templates/${t.id}/edit`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </Link>
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

      {managing && <ManageTemplateDialog template={managing} onClose={() => setManaging(null)} />}
    </div>
  )
}

function ManageTemplateDialog({ template, onClose }: { template: RecurringTaskTemplate; onClose: () => void }) {
  const qc = useQueryClient()
  const [clientId, setClientId] = useState('')

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

  const addMutation = useMutation({
    mutationFn: () => api.post(`/recurring-templates/${template.id}/assignments`, { clientId }),
    onSuccess: () => {
      toast.success('Cliente vinculado')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', template.id] })
      setClientId('')
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

          <div className="grid grid-cols-2 gap-2">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
              <option value="">Cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" onClick={() => addMutation.mutate()} disabled={!clientId || addMutation.isPending}>
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
                    {new Date(l.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — {l.status === 'FAILED' ? l.errorMessage : 'Gerado com sucesso'}
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
