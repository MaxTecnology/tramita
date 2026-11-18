import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { resolveDepartmentSelection } from './requestDepartment'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Comments } from '@/components/shared/Comments'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Plus, Inbox, ExternalLink, ChevronDown, ChevronUp, Paperclip } from 'lucide-react'
import type { ClientRequest, PortalService } from '@/types'
import { toast } from 'sonner'
import { usePortalClient } from './Layout'
import { useLinkedItem } from '@/hooks/useLinkedItem'
import { askConfirm } from '@/components/ui/app-dialogs'
import { RequestAttachments, uploadRequestAttachment } from '@/components/requests/RequestAttachments'
import { UPLOAD_ACCEPT } from '@/lib/upload'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
  CANCELLED: 'Cancelada',
  NEEDS_INFO: 'Aguardando resposta',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-warning-bg text-warning-text',
  APPROVED: 'bg-success-bg text-success-text',
  REJECTED: 'bg-danger-bg text-danger-text',
  CANCELLED: 'bg-neutral-bg text-muted-foreground',
  NEEDS_INFO: 'bg-info-bg text-info-text',
}

export default function PortalRequests() {
  const qc = useQueryClient()
  const { clientId } = usePortalClient()
  const [open, setOpen] = useState(false)
const EMPTY = { title: '', description: '', departmentId: '', service: '', competence: '' }
  const [form, setForm] = useState(EMPTY)
  const [files, setFiles] = useState<File[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  useLinkedItem('request', setExpandedId)

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['portal-requests', clientId],
    queryFn: () => api.get('/portal/requests', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  // Scroll once to the request opened from a notification, after the list has it
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!expandedId || scrolledTo.current === expandedId || !requests.some((r) => r.id === expandedId)) return
    scrolledTo.current = expandedId
    document.getElementById(`request-${expandedId}`)?.scrollIntoView?.({ block: 'center' })
  }, [expandedId, requests])

  // Só os departamentos a que este usuário tem acesso na empresa selecionada.
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-departments', clientId],
    queryFn: () => api.get('/portal/departments', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  // Troca de empresa com o formulário aberto não pode carregar o departamento da empresa anterior.
  useEffect(() => {
    setForm((f) => {
      const departmentId = resolveDepartmentSelection(f.departmentId, departments)
      return departmentId === f.departmentId ? f : { ...f, departmentId }
    })
  }, [departments])

  // "Solicitar serviço": standalone OS and processes the office lets the client ask for
  const { data: services = [] } = useQuery<PortalService[]>({
    queryKey: ['portal-services', clientId],
    queryFn: () => api.get('/portal/services', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })
  const service = services.find((s) => `${s.kind}:${s.id}` === form.service) ?? null

  const createMutation = useMutation({
    mutationFn: () => api.post('/portal/requests', {
      clientId,
      title: form.title,
      description: form.description,
      // A service brings its own department; a free request names one
      ...(service
        ? { [service.kind === 'OS' ? 'osModelId' : 'processTemplateId']: service.id, ...(service.requiresCompetence ? { competence: form.competence } : {}) }
        : { departmentId: form.departmentId }),
    }).then((r) => r.data as { id: string }),
    onSuccess: async (created) => {
      // The files go right after the request exists; one failing does not undo the request
      let failed = 0
      for (const file of files) {
        try { await uploadRequestAttachment(created.id, file) } catch { failed++ }
      }
      if (failed > 0) toast.error(`Solicitação enviada, mas ${failed === 1 ? '1 arquivo não foi anexado' : `${failed} arquivos não foram anexados`} — anexe de novo no card`)
      else toast.success('Solicitação enviada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
      setOpen(false)
      setForm(EMPTY)
      setFiles([])
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
        <Button onClick={() => setOpen(true)} className="bg-accent hover:bg-accent-hover text-accent-foreground gap-2">
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
              <div key={r.id} id={`request-${r.id}`} className="bg-surface rounded-lg border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <p className="text-xs text-danger-text mt-1 italic">Motivo: {r.rejectionReason}</p>
                    )}
                    {r.status === 'CANCELLED' && r.cancelledByType === 'USER' && r.cancellationReason && (
                      <p className="text-xs text-muted-foreground mt-1 italic">Cancelada pelo escritório — motivo: {r.cancellationReason}</p>
                    )}
                    <RequestAttachments requestId={r.id} attachments={r.attachments ?? []} canUpload={r.status === 'PENDING' || r.status === 'NEEDS_INFO'} />
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
                      onClick={async () => { if (await askConfirm({ title: 'Cancelar esta solicitação?', confirmLabel: 'Cancelar solicitação', danger: true })) cancelMutation.mutate(r.id) }}
                      className="text-danger-text hover:text-danger-hover hover:bg-danger-bg -ml-2"
                    >
                      Cancelar
                    </Button>
                  )}
                  {/* CANCELLED pode ter boardId (foi aprovada antes de cancelar) — a tarefa virou
                      DISREGARDED, não é mais um processo ativo pra "ver". */}
                  {r.boardId && r.status !== 'CANCELLED' && (
                    <Link
                      to={`/portal/board/${r.boardId}`}
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1"
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
              <Label htmlFor="req-service">Serviço</Label>
              <select
                id="req-service"
                value={form.service}
                onChange={(e) => {
                  const next = services.find((s) => `${s.kind}:${s.id}` === e.target.value)
                  // The service name becomes the title when none was typed yet
                  setForm((f) => ({ ...f, service: e.target.value, title: next && (!f.title.trim() || services.some((s) => s.name === f.title)) ? next.name : f.title }))
                }}
                className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Outro (descrever o pedido)</option>
                {services.map((s) => (
                  <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>{s.name}{s.kind === 'PROCESS' ? ' (processo)' : ''}</option>
                ))}
              </select>
              {service?.description && <p className="text-xs text-muted-foreground">{service.description}</p>}
            </div>
            {service?.requiresCompetence && (
              <div className="space-y-1.5">
                <Label htmlFor="req-competence">Competência</Label>
                <Input id="req-competence" type="month" value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} required />
              </div>
            )}
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
            {!service && (
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
            )}
            <div className="space-y-1.5">
              <Label htmlFor="req-files">Arquivos (opcional)</Label>
              {/* The browser's own picker shows its language ("Choose Files"): a button of ours instead */}
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground hover:bg-neutral-bg">
                  <Paperclip size={14} /> Escolher arquivos
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {files.length === 0 ? 'Nenhum arquivo' : files.map((f) => f.name).join(', ')}
                </span>
                <input id="req-files" type="file" multiple accept={UPLOAD_ACCEPT} className="sr-only"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
              </label>
            </div>
            {createMutation.isError && <p className="text-sm text-danger-text">Erro ao enviar. Tente novamente.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || !form.title.trim() || (!service && !form.departmentId) || (!!service?.requiresCompetence && !form.competence)} className="bg-accent hover:bg-accent-hover text-accent-foreground">
                {createMutation.isPending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
