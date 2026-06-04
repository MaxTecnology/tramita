import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, MessageSquare, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Comments } from '@/components/shared/Comments'
import type { Task, Attachment, TaskHistory, DrawerRole } from '@/types'

interface Props {
  task: Task
  currentUserId: string
  role: DrawerRole
  onClose: () => void
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

type Tab = 'comments' | 'attachments' | 'history'

const isOrgRole = (role: DrawerRole): role is Exclude<DrawerRole, 'CLIENT'> => role !== 'CLIENT'

const historyEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/history`
    : `/tasks/${taskId}/history`

export function TaskDrawer({ task, currentUserId, role, onClose }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.title)
  const [descValue, setDescValue] = useState(task.description ?? '')

  const canEdit = isOrgRole(role)

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'description' | 'dueDate'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board'] }),
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

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/tasks/${task.id}/attachments`, form)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
  })

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete(`/tasks/${task.id}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
  })

  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate) < new Date()

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'comments', label: 'Comentários', icon: <MessageSquare size={14} /> },
    { id: 'attachments', label: 'Anexos', icon: <Paperclip size={14} /> },
    { id: 'history', label: 'Histórico', icon: <Clock size={14} /> },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl w-full max-w-[560px]">

        {/* Header fixo */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-200 flex-shrink-0">
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
                className="flex-1 text-base font-semibold text-gray-900 border-b border-blue-500 focus:outline-none bg-transparent mr-4"
              />
            ) : (
              <h2
                className={cn(
                  'flex-1 text-base font-semibold text-gray-900 leading-tight mr-4',
                  canEdit && 'cursor-pointer hover:text-blue-600',
                )}
                onClick={() => canEdit && setEditingTitle(true)}
              >
                {task.title}
              </h2>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
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

            {task.dueDate && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full bg-gray-100', isOverdue && 'bg-red-100 text-red-600 font-medium')}>
                {isOverdue ? '⚠ ' : ''}Prazo: {new Date(task.dueDate).toLocaleDateString('pt-BR')}
              </span>
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
              className="w-full text-sm text-gray-700 border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-gray-400"
            />
          ) : (
            task.description && (
              <p className="text-sm text-gray-700">{task.description}</p>
            )
          )}
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-200 flex-shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
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

          {tab === 'attachments' && (
            <div className="space-y-3">
              {attachments.length === 0 && (
                <p className="text-sm text-gray-400">Nenhum anexo ainda.</p>
              )}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <a
                        href={a.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline block truncate"
                      >
                        {a.filename}
                      </a>
                      <p className="text-xs text-gray-400">
                        {(a.size / 1024).toFixed(0)} KB · {a.uploaderName}
                      </p>
                    </div>
                  </div>
                  {(isOrgRole(role) || a.uploadedByClient === currentUserId) && (
                    <button
                      type="button"
                      onClick={() => deleteAttachmentMutation.mutate(a.id)}
                      className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0"
                    >
                      Remover
                    </button>
                  )}
                </div>
              ))}
              <label className="flex items-center gap-2 cursor-pointer mt-2">
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
            </div>
          )}

          {tab === 'history' && (
            <div className="relative pl-4">
              {history.length === 0 && (
                <p className="text-sm text-gray-400">Sem histórico ainda.</p>
              )}
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200" />
              {history.map((h) => (
                <div key={h.id} className="relative mb-4 last:mb-0">
                  <div className="absolute -left-[11px] top-1.5 w-2 h-2 rounded-full bg-blue-400" />
                  <p className="text-xs text-gray-600">
                    <span className="font-medium">{h.actorName}</span>
                    {' — '}
                    {h.action}
                    {h.toValue && <span className="text-gray-500"> → {h.toValue}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
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
