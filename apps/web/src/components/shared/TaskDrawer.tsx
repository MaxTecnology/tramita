import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, MessageSquare, Clock, Trash2, FileCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { Comments } from '@/components/shared/Comments'
import type { Task, Attachment, TaskHistory, DrawerRole, TaskDocumentRequirement, TaskDeliverable } from '@/types'
import { toast } from 'sonner'

interface Props {
  task: Task
  currentUserId: string
  role: DrawerRole
  boardDueDate?: string | null
  onClose: () => void
}

const ACTION_LABELS: Record<string, string> = {
  moved_to: 'moveu para',
  created: 'criou a tarefa',
  updated_priority: 'alterou prioridade para',
  updated_title: 'alterou título para',
  updated_assignee: 'alterou responsável para',
  updated_due_date: 'alterou vencimento para',
  attachment_added: 'adicionou o anexo',
  attachment_deleted: 'removeu o anexo',
  status_changed: 'alterou status para',
  priority_changed: 'alterou prioridade para',
  assigned_to: 'alterou responsável para',
}

function formatHistoryAction(h: TaskHistory): string {
  const label = ACTION_LABELS[h.action] ?? h.action
  if (h.action === 'attachment_deleted' && h.fromValue) return `${label} "${h.fromValue}"`
  if (h.action === 'attachment_added' && h.toValue) return `${label} "${h.toValue}"`
  if (h.toValue) return `${label} ${h.toValue}`
  return label
}

export const PRIORITY_LABEL: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const PRIORITY_COLOR: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

export const STATUS_LABEL: Record<Task['status'], string> = {
  OPEN: 'Aberto',
  STARTED: 'Iniciado',
  DONE: 'Concluído',
  DISREGARDED: 'Desconsiderado',
  BLOCKED: 'Com Impedimento',
}

export const STATUS_COLOR: Record<Task['status'], string> = {
  OPEN: 'bg-gray-100 text-gray-600',
  STARTED: 'bg-blue-100 text-blue-600',
  DONE: 'bg-green-100 text-green-600',
  DISREGARDED: 'bg-gray-200 text-gray-500',
  BLOCKED: 'bg-red-100 text-red-600',
}

type Tab = 'comments' | 'documents' | 'attachments' | 'history'

const isOrgRole = (role: DrawerRole): role is Exclude<DrawerRole, 'CLIENT'> => role !== 'CLIENT'

const historyEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/history`
    : `/tasks/${taskId}/history`

const documentsEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/documents`
    : `/tasks/${taskId}/documents`

export function TaskDrawer({ task, currentUserId, role, boardDueDate, onClose }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.title)
  const [descValue, setDescValue] = useState(task.description ?? '')

  const canEdit = isOrgRole(role)

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
    enabled: canEdit,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'status' | 'description' | 'dueDate' | 'departmentId' | 'visibleToClient' | 'targetDate' | 'competence'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => {
      toast.success('Tarefa atualizada')
      queryClient.invalidateQueries({ queryKey: ['board'] })
    },
    onError: () => toast.error('Erro ao salvar tarefa'),
  })

  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['attachments', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
    enabled: tab === 'attachments',
  })

  const { data: history = [] } = useQuery<TaskHistory[]>({
    queryKey: ['task-history', task.id],
    queryFn: () => api.get(historyEndpoint(task.id, role)).then((r) => r.data),
    enabled: tab === 'history',
  })

  const { data: documents } = useQuery<{ requirements: TaskDocumentRequirement[]; deliverables: TaskDeliverable[] }>({
    queryKey: ['task-documents', task.id],
    queryFn: () => api.get(documentsEndpoint(task.id, role)).then((r) => r.data),
    enabled: tab === 'documents',
  })

  const addRequirementMutation = useMutation({
    mutationFn: (name: string) => api.post(`/tasks/${task.id}/documents/requests`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] }),
  })

  const addDeliverableMutation = useMutation({
    mutationFn: (name: string) => api.post(`/tasks/${task.id}/documents/deliveries`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] }),
  })

  const uploadRequirementMutation = useMutation({
    mutationFn: ({ reqId, file }: { reqId: string; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      const url = role === 'CLIENT'
        ? `/portal/tasks/${task.id}/documents/requests/${reqId}/upload`
        : `/tasks/${task.id}/documents/requests/${reqId}/upload`
      return api.post(url, form)
    },
    onSuccess: () => {
      toast.success('Arquivo enviado')
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
    },
    onError: () => toast.error('Erro ao enviar arquivo'),
  })

  const reviewRequirementMutation = useMutation({
    mutationFn: ({ reqId, decision, rejectionReason }: { reqId: string; decision: 'APPROVED' | 'REJECTED'; rejectionReason?: string }) =>
      api.patch(`/tasks/${task.id}/documents/requests/${reqId}`, { decision, rejectionReason }),
    onSuccess: () => {
      toast.success('Documento avaliado')
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
    },
    onError: () => toast.error('Erro ao avaliar documento'),
  })

  const deliverMutation = useMutation({
    mutationFn: ({ reqId, file }: { reqId: string; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/tasks/${task.id}/documents/deliveries/${reqId}/upload`, form)
    },
    onSuccess: () => {
      toast.success('Documento entregue')
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
    },
    onError: () => toast.error('Erro ao entregar documento'),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/tasks/${task.id}/attachments`, form)
    },
    onSuccess: () => {
      toast.success('Arquivo anexado')
      queryClient.invalidateQueries({ queryKey: ['attachments', task.id] })
    },
    onError: () => toast.error('Erro ao anexar arquivo'),
  })

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete(`/tasks/${task.id}/attachments/${attachmentId}`),
    onSuccess: () => {
      toast.success('Anexo removido')
      queryClient.invalidateQueries({ queryKey: ['attachments', task.id] })
    },
    onError: () => toast.error('Erro ao remover anexo'),
  })

  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    isPastDateOnlyUTC(task.dueDate)

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'comments', label: 'Comentários', icon: <MessageSquare size={14} /> },
    { id: 'documents', label: 'Documentos', icon: <FileCheck size={14} /> },
    { id: 'attachments', label: 'Anexos', icon: <Paperclip size={14} /> },
    { id: 'history', label: 'Histórico', icon: <Clock size={14} /> },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex flex-col bg-surface shadow-2xl w-full max-w-[560px]">

        {/* Header fixo */}
        <div className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-start justify-between mb-3">
            {canEdit && editingTitle ? (
              <input
                autoFocus
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false)
                  if (titleValue.trim() && titleValue !== task.title) {
                    updateMutation.mutate({ title: titleValue.trim() })
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setTitleValue(task.title); setEditingTitle(false) }
                }}
                className="flex-1 text-base font-semibold text-foreground border-b border-accent focus:outline-none bg-transparent mr-4"
              />
            ) : (
              <h2
                className={cn(
                  'flex-1 text-base font-semibold text-foreground leading-tight mr-4',
                  canEdit && 'cursor-pointer hover:text-accent',
                )}
                onClick={() => canEdit && setEditingTitle(true)}
              >
                {task.title}
              </h2>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0">
              <X size={20} />
            </button>
          </div>

          {/* Badges de metadados */}
          <div className="flex flex-wrap gap-2 mb-3">
            {canEdit ? (
              <select
                value={task.priority}
                onChange={(e) => updateMutation.mutate({ priority: e.target.value as Task['priority'] })}
                className={cn('text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer', PRIORITY_COLOR[task.priority])}
              >
                {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as Task['priority'][]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            ) : (
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLOR[task.priority])}>
                {PRIORITY_LABEL[task.priority]}
              </span>
            )}

            {canEdit ? (
              <select
                value={task.status}
                onChange={(e) => updateMutation.mutate({ status: e.target.value as Task['status'] })}
                className={cn('text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer', STATUS_COLOR[task.status])}
              >
                {(['OPEN', 'STARTED', 'DONE', 'DISREGARDED', 'BLOCKED'] as Task['status'][]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            ) : (
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_COLOR[task.status])}>
                {STATUS_LABEL[task.status]}
              </span>
            )}

            {canEdit && (
              <select
                value={task.departmentId ?? ''}
                onChange={(e) => updateMutation.mutate({ departmentId: e.target.value })}
                className="text-xs font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground cursor-pointer bg-surface"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}

            {canEdit ? (
              <div className="flex flex-col gap-1">
                <input
                  type="date"
                  defaultValue={task.dueDate ? task.dueDate.slice(0, 10) : ''}
                  onChange={(e) => {
                    const val = e.target.value
                    updateMutation.mutate({
                      dueDate: val
                        ? (() => {
                            const [y, m, d] = val.split('-').map(Number)
                            return new Date(Date.UTC(y, m - 1, d)).toISOString()
                          })()
                        : null,
                    })
                  }}
                  className="text-xs border border-border rounded px-2 py-0.5 text-foreground bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
                />
                {/* Aviso quando prazo da tarefa ultrapassa prazo do processo */}
                {task.dueDate && boardDueDate && new Date(task.dueDate) > new Date(boardDueDate) && (
                  <p className="text-xs text-amber-600">
                    ⚠ Prazo além do processo ({formatDateOnlyUTC(boardDueDate)})
                  </p>
                )}
              </div>
            ) : (
              task.dueDate && (
                <span className={cn('text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700', isOverdue && 'bg-red-100 text-red-600 font-medium')}>
                  {isOverdue ? '⚠ ' : ''}Prazo: {formatDateOnlyUTC(task.dueDate)}
                </span>
              )
            )}

            {canEdit ? (
              <input
                type="date"
                defaultValue={task.targetDate ? task.targetDate.slice(0, 10) : ''}
                onChange={(e) => {
                  const val = e.target.value
                  updateMutation.mutate({
                    targetDate: val
                      ? (() => {
                          const [y, m, d] = val.split('-').map(Number)
                          return new Date(Date.UTC(y, m - 1, d)).toISOString()
                        })()
                      : null,
                  })
                }}
                title="Meta interna"
                className="text-xs border border-border rounded px-2 py-0.5 text-foreground bg-surface"
              />
            ) : (
              task.targetDate && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700" title="Meta interna">
                  Meta: {formatDateOnlyUTC(task.targetDate)}
                </span>
              )
            )}
            {task.competence && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700" title="Competência">
                Competência: {new Date(task.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </span>
            )}

            {canEdit && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={task.visibleToClient}
                  onChange={(e) => updateMutation.mutate({ visibleToClient: e.target.checked })}
                />
                Cliente pode ver
              </label>
            )}
          </div>

          {/* Descrição */}
          {canEdit ? (
            <textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={() => {
                if (descValue !== (task.description ?? '')) {
                  updateMutation.mutate({ description: descValue || null })
                }
              }}
              placeholder="Adicionar descrição..."
              rows={2}
              className="w-full text-sm text-foreground border border-border bg-surface rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent resize-none placeholder:text-muted-foreground"
            />
          ) : (
            task.description && (
              <p className="text-sm text-foreground">{task.description}</p>
            )
          )}
        </div>

        {/* Abas */}
        <div className="flex border-b border-border flex-shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        <div className="flex-1 overflow-y-auto p-5">

          {tab === 'comments' && (
            <Comments taskId={task.id} currentUserId={currentUserId} role={role} />
          )}

          {tab === 'documents' && documents && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">A cobrar do cliente</p>
                {documents.requirements.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento a cobrar.</p>}
                <div className="space-y-2">
                  {documents.requirements.map((r) => (
                    <div key={r.id} className="bg-neutral-bg rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{r.name}</span>
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          r.status === 'PENDING' && 'bg-gray-100 text-gray-500',
                          r.status === 'UPLOADED' && 'bg-blue-100 text-blue-600',
                          r.status === 'APPROVED' && 'bg-green-100 text-green-600',
                          r.status === 'REJECTED' && 'bg-red-100 text-red-600',
                        )}>
                          {{ PENDING: 'Pendente', UPLOADED: 'Enviado', APPROVED: 'Aprovado', REJECTED: 'Rejeitado' }[r.status]}
                        </span>
                      </div>
                      {r.rejectionReason && <p className="text-xs text-red-500 mt-1">Motivo: {r.rejectionReason}</p>}
                      {r.signedUrl && (
                        <a href={r.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                          Ver arquivo enviado
                        </a>
                      )}
                      {canEdit && r.status === 'UPLOADED' && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => reviewRequirementMutation.mutate({ reqId: r.id, decision: 'APPROVED' })} className="text-xs text-green-600 hover:underline">
                            Aprovar
                          </button>
                          <button
                            onClick={() => {
                              const reason = window.prompt('Motivo da rejeição:')
                              if (reason?.trim()) reviewRequirementMutation.mutate({ reqId: r.id, decision: 'REJECTED', rejectionReason: reason.trim() })
                            }}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Rejeitar
                          </button>
                        </div>
                      )}
                      {(r.status === 'PENDING' || r.status === 'REJECTED') && (
                        <label className="inline-block mt-2 cursor-pointer">
                          <input type="file" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) uploadRequirementMutation.mutate({ reqId: r.id, file })
                            e.target.value = ''
                          }} />
                          <span className="text-xs text-blue-600 hover:underline">Enviar arquivo</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    onClick={() => { const name = window.prompt('Nome do documento a cobrar:'); if (name?.trim()) addRequirementMutation.mutate(name.trim()) }}
                    className="text-xs text-blue-600 hover:underline mt-2"
                  >
                    + Adicionar documento a cobrar
                  </button>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">A entregar ao cliente</p>
                {documents.deliverables.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento a entregar.</p>}
                <div className="space-y-2">
                  {documents.deliverables.map((d) => (
                    <div key={d.id} className="bg-neutral-bg rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{d.name}</span>
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', d.deliveredAt ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500')}>
                          {d.deliveredAt ? 'Entregue' : 'Pendente'}
                        </span>
                      </div>
                      {d.signedUrl && (
                        <a href={d.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                          Ver arquivo entregue
                        </a>
                      )}
                      {canEdit && (
                        <label className="inline-block mt-2 cursor-pointer">
                          <input type="file" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) deliverMutation.mutate({ reqId: d.id, file })
                            e.target.value = ''
                          }} />
                          <span className="text-xs text-blue-600 hover:underline">{d.deliveredAt ? 'Substituir arquivo' : 'Enviar arquivo'}</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    onClick={() => { const name = window.prompt('Nome do documento a entregar:'); if (name?.trim()) addDeliverableMutation.mutate(name.trim()) }}
                    className="text-xs text-blue-600 hover:underline mt-2"
                  >
                    + Adicionar documento a entregar
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'attachments' && (
            <div className="space-y-2">
              {attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum anexo ainda.</p>
              )}
              {attachments.map((a) => {
                const isDeleted = !!a.deletedAt
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'flex items-start justify-between rounded-lg px-3 py-2.5 gap-2',
                      isDeleted ? 'bg-red-50 border border-red-100' : 'bg-neutral-bg',
                    )}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {isDeleted
                        ? <Trash2 size={14} className="text-red-300 flex-shrink-0 mt-0.5" />
                        : <Paperclip size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                      }
                      <div className="min-w-0">
                        {isDeleted ? (
                          <span className="text-sm text-red-400 line-through block truncate">{a.filename}</span>
                        ) : (
                          <a
                            href={a.signedUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline block truncate"
                          >
                            {a.filename}
                          </a>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(a.size / 1024).toFixed(0)} KB
                          {' · '}
                          <span>Adicionado por {a.uploaderName}</span>
                          {' · '}
                          {new Date(a.createdAt).toLocaleString('pt-BR')}
                        </p>
                        {isDeleted && (
                          <p className="text-xs text-red-400 mt-0.5">
                            Removido por {a.deletedByName} · {new Date(a.deletedAt!).toLocaleString('pt-BR')}
                          </p>
                        )}
                      </div>
                    </div>
                    {!isDeleted && isOrgRole(role) && (
                      <button
                        type="button"
                        onClick={() => deleteAttachmentMutation.mutate(a.id)}
                        className="text-xs text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                )
              })}
              {!attachments.some((a) => !a.deletedAt) && attachments.length > 0 && (
                <p className="text-xs text-muted-foreground pt-1">Todos os anexos foram removidos.</p>
              )}
              {isOrgRole(role) && (
                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadMutation.mutate(file)
                      e.target.value = ''
                    }}
                  />
                  <span className="text-sm text-blue-600 hover:underline">
                    {uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo'}
                  </span>
                </label>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="relative pl-4">
              {history.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>
              )}
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-border" />
              {history.map((h) => (
                <div key={h.id} className="relative mb-4 last:mb-0">
                  <div className="absolute -left-[11px] top-1.5 w-2 h-2 rounded-full bg-blue-400" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{h.actorName}</span>
                    {' — '}
                    {formatHistoryAction(h)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(h.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))}
            </div>
          )}

        </div>
      </aside>
    </>
  )
}
