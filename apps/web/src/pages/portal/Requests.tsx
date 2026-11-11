import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Comments } from '@/components/shared/Comments'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Plus, Inbox, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { ClientRequest } from '@/types'
import { toast } from 'sonner'
import { usePortalClient } from './Layout'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
  CANCELLED: 'Cancelada',
  NEEDS_INFO: 'Aguardando resposta',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  NEEDS_INFO: 'bg-blue-100 text-blue-700',
}

export default function PortalRequests() {
  const qc = useQueryClient()
  const { clientId } = usePortalClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', departmentId: '', osTemplateId: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['portal-requests', clientId],
    queryFn: () => api.get('/portal/requests', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  // Só os departamentos a que este usuário tem acesso na empresa selecionada.
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-departments', clientId],
    queryFn: () => api.get('/portal/departments', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  const { data: osTemplates = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-os-templates'],
    queryFn: () => api.get('/portal/os-templates').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/portal/requests', {
      clientId,
      title: form.title,
      description: form.description,
      departmentId: form.departmentId,
      osTemplateId: form.osTemplateId || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Solicitação enviada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
      setOpen(false)
      setForm({ title: '', description: '', departmentId: '', osTemplateId: '' })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao enviar solicitação')),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/portal/requests/${id}/cancel`),
    onSuccess: () => {
      toast.success('Solicitação cancelada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
    },
    onError: () => toast.error('Erro ao cancelar'),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Minhas Solicitações</h1>
        <Button onClick={() => setOpen(true)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2">
          <Plus size={16} />
          Nova solicitação
        </Button>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma solicitação ainda</p>
          <p className="text-xs mt-1">Use o botão acima para pedir algo ao seu escritório.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} className="bg-surface rounded-lg border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <p className="text-xs text-red-500 mt-1 italic">Motivo: {r.rejectionReason}</p>
                    )}
                    {r.status === 'CANCELLED' && r.cancelledByType === 'USER' && r.cancellationReason && (
                      <p className="text-xs text-gray-500 mt-1 italic">Cancelada pelo escritório — motivo: {r.cancellationReason}</p>
                    )}
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <div className="flex gap-2 mt-2 items-center flex-wrap">
                  {(r.status === 'PENDING' || r.status === 'NEEDS_INFO') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { if (window.confirm('Cancelar esta solicitação?')) cancelMutation.mutate(r.id) }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 -ml-2"
                    >
                      Cancelar
                    </Button>
                  )}
                  {/* CANCELLED pode ter boardId (foi aprovada antes de cancelar) — a tarefa virou
                      DISREGARDED, não é mais um processo ativo pra "ver". */}
                  {r.boardId && r.status !== 'CANCELLED' && (
                    <Link
                      to={`/portal/board/${r.boardId}`}
                      className="text-xs text-[#185FA5] hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} />
                      Ver processo
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-auto"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Comentários
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <Comments entityType="request" entityId={r.id} currentUserId={clientId} role="CLIENT" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nova solicitação</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) createMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="req-os-template">Tipo de solicitação</Label>
              <select
                id="req-os-template"
                value={form.osTemplateId}
                onChange={(e) => setForm({ ...form, osTemplateId: e.target.value })}
                className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Outro</option>
                {osTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Título</Label>
              <Input
                id="req-title"
                placeholder="Ex: Preciso de uma certidão atualizada"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-desc">Descrição</Label>
              <textarea
                id="req-desc"
                rows={4}
                placeholder="Detalhe o que você precisa..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-department">Departamento</Label>
              <select
                id="req-department"
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="" disabled>Selecione o departamento</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            {createMutation.isError && <p className="text-sm text-red-600">Erro ao enviar. Tente novamente.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || !form.title.trim() || !form.departmentId} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                {createMutation.isPending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
