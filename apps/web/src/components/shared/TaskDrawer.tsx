import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, MessageSquare, Clock, Trash2, FileCheck, Stamp, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { UPLOAD_ACCEPT } from '@/lib/upload'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { Comments } from '@/components/shared/Comments'
import { useServedDepartments } from '@/hooks/useServedDepartments'
import { useMyScope } from '@/hooks/useMyScope'
import { hasUnseenClientReply } from '@/lib/request-comments'
import type { Task, Attachment, AttachmentPurpose, TaskHistory, DrawerRole, TaskDocumentRequirement, TaskDeliverable, DeliveryCheck, Protocol, Comment } from '@/types'
import { toast } from 'sonner'
import { formatBRL, toApiAmount } from '@/lib/money'
import { PaymentFields, type PaymentValues } from './task-documents/PaymentFields'
import { ProtocolOfficeCard } from './task-documents/ProtocolOfficeCard'
import { AddDeliverableForm } from './task-documents/AddDeliverableForm'
import { ApprovalsSection, useTaskApprovals } from './task-documents/ApprovalsSection'
import { askConfirm, askText } from '@/components/ui/app-dialogs'

function isValidAmount(value: string): boolean {
  try { toApiAmount(value); return true } catch { return false }
}

interface Props {
  task: Task
  currentUserId: string
  role: DrawerRole
  boardDueDate?: string | null
  /** cliente do processo — o seletor de departamento só oferece os que atendem esse cliente */
  clientId?: string
  onClose: () => void
}

const ACTION_LABELS: Record<string, string> = {
  assumed: 'assumiu a tarefa',
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
  department_changed: 'alterou departamento para',
  approval_requested: 'pediu aprovação do cliente:',
  approval_approved: 'aprovou',
  approval_changes_requested: 'pediu ajuste:',
  approval_closed_by_office: 'fechou a aprovação sem o portal',
}

const CLOSE_REASON_HISTORY: Record<string, string> = {
  APPROVED_OUTSIDE: 'cliente aprovou fora da plataforma',
  NO_RESPONSE: 'sem resposta do cliente',
}

// History values are stored raw (status enum, user ids): shown with the screen's words and names
function formatHistoryAction(h: TaskHistory, userName: (id: string) => string): string {
  const label = ACTION_LABELS[h.action] ?? h.action
  if (h.action === 'status_changed' && h.toValue) return `${label} ${STATUS_LABEL[h.toValue as Task['status']] ?? h.toValue}`
  if ((h.action === 'assigned_to' || h.action === 'updated_assignee') && h.toValue) return `${label} ${userName(h.toValue)}`
  if (h.action === 'assumed') return h.fromValue ? `${label} (era de ${userName(h.fromValue)})` : label
  if (h.action === 'attachment_deleted' && h.fromValue) return `${label} "${h.fromValue}"`
  if (h.action === 'attachment_added' && h.toValue) return `${label} "${h.toValue}"`
  if (h.action === 'approval_approved' && h.fromValue) return `${label} "${h.fromValue}"`
  // Document trail
  switch (h.action) {
    case 'document_requested': return `adicionou documento a cobrar "${h.toValue ?? ''}"`
    case 'document_uploaded': return `enviou "${h.fromValue ?? ''}" (${h.toValue ?? ''})`
    case 'document_approved': return `aprovou "${h.fromValue ?? ''}"${h.toValue ? ` (${h.toValue})` : ''}`
    case 'document_rejected': return `recusou "${h.fromValue ?? ''}" — motivo: ${h.toValue ?? ''}`
    case 'document_contested': return `contestou "Nada a enviar" em "${h.fromValue ?? ''}" — motivo: ${h.toValue ?? ''}`
    case 'document_not_applicable': return `marcou "Nada a enviar" em "${h.toValue ?? ''}"`
    case 'document_not_applicable_undone': return `desfez "Nada a enviar" em "${h.toValue ?? ''}"`
    case 'deliverable_requested': return `adicionou documento a entregar "${h.toValue ?? ''}"`
    case 'deliverable_delivered': return `entregou "${h.fromValue ?? ''}" (${h.toValue ?? ''})`
    case 'deliverable_delivered_robot': return `entregou "${h.fromValue ?? ''}" (${h.toValue ?? ''}) — conferido pelo robô`
    case 'deliverable_delivered_with_warnings': return `entregou "${h.fromValue ?? ''}" apesar do aviso do robô: ${h.toValue ?? ''}`
  }
  if (h.action === 'approval_closed_by_office') return `${label} (${CLOSE_REASON_HISTORY[h.toValue ?? ''] ?? h.toValue ?? ''})`
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
  LOW: 'bg-neutral-bg text-muted-foreground',
  MEDIUM: 'bg-info-bg text-info-text',
  HIGH: 'bg-warning-bg text-warning-text',
  URGENT: 'bg-danger-bg text-danger-text',
}

export const STATUS_LABEL: Record<Task['status'], string> = {
  OPEN: 'Aberto',
  STARTED: 'Iniciado',
  DONE: 'Concluído',
  DISREGARDED: 'Desconsiderado',
  BLOCKED: 'Com Impedimento',
}

export const STATUS_COLOR: Record<Task['status'], string> = {
  OPEN: 'bg-neutral-bg text-muted-foreground',
  STARTED: 'bg-info-bg text-info-text',
  DONE: 'bg-success-bg text-success-text',
  DISREGARDED: 'bg-neutral-bg text-muted-foreground',
  BLOCKED: 'bg-danger-bg text-danger-text',
}

type Tab = 'comments' | 'documents' | 'attachments' | 'history' | 'protocols'

const isOrgRole = (role: DrawerRole): role is Exclude<DrawerRole, 'CLIENT'> => role !== 'CLIENT'

const historyEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/history`
    : `/tasks/${taskId}/history`

const documentsEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/documents`
    : `/tasks/${taskId}/documents`

export function TaskDrawer({ task, currentUserId, role, boardDueDate, clientId, onClose }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.title)
  const [descValue, setDescValue] = useState(task.description ?? '')

  const isStaff = isOrgRole(role)
  // Same list the Tasks screen uses (id, name, departments): who can receive the task and names in the history
  const { data: userOptions = [] } = useQuery<{ id: string; name: string; departmentIds?: string[] }[]>({
    queryKey: ['user-options'],
    queryFn: () => api.get('/users/options').then((r) => r.data),
    enabled: isStaff,
  })
  const userName = (id: string) => userOptions.find((u) => u.id === id)?.name ?? 'outro colaborador'
  // The task goes to someone of its department (the API refuses anyone else for a member)
  const assigneeChoices = userOptions.filter((u) => u.id === task.assigneeId || (!!task.departmentId && u.departmentIds?.includes(task.departmentId)))
  const { data: approvals = [] } = useTaskApprovals(task.id, isStaff)
  const awaitingApproval = approvals.some((a) => a.status === 'PENDING')
  // Office staff sees everything in the drawer; changing it needs the task to be theirs (or their
  // portfolio / manager scope). A colleague's task seen through the department must be assumed first.
  const canEdit = isStaff && task.viewerCanEdit !== false
  const me = useMyScope()
  const isOpen = task.status !== 'DONE' && task.status !== 'DISREGARDED'
  const canAssume = isStaff && !!me && isOpen && task.assigneeId !== currentUserId
    && (me.role === 'ORG_ADMIN' || (!!task.departmentId && me.departments.some((d) => d.id === task.departmentId)))
    && (me.role !== 'ORG_MEMBER' || me.seesDepartmentWork)
  const [assumeError, setAssumeError] = useState<string | null>(null)

  const { departments } = useServedDepartments(isStaff ? clientId : undefined)

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'status' | 'description' | 'dueDate' | 'departmentId' | 'visibleToClient' | 'targetDate' | 'competence' | 'assigneeId'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => {
      toast.success('Tarefa atualizada')
      // TaskDrawer é usado tanto no Kanban por board (Board.tsx, query ['board', boardId]) quanto
      // na tela flat de Tarefas (Tasks.tsx, query ['tasks', filters]) — precisa invalidar os dois,
      // senão a edição fica invisível em um dos dois lugares até um refresh manual.
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao salvar tarefa')),
  })

  const regenerateMutation = useMutation({
    mutationFn: () => api.post<{ taskId: string }>(`/tasks/${task.id}/regenerate`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Tarefa regenerada com a configuração atual do template')
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
      onClose()
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao regenerar tarefa')
    },
  })

  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['attachments', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
    enabled: tab === 'attachments' || tab === 'protocols',
  })

  const { data: protocols = [] } = useQuery<Protocol[]>({
    queryKey: ['protocols', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/protocols`).then((r) => r.data),
    enabled: tab === 'protocols',
  })

  const [creatingProtocol, setCreatingProtocol] = useState(false)
  const [protocolMode, setProtocolMode] = useState<'attachment' | 'text'>('attachment')
  const [protocolTitle, setProtocolTitle] = useState('')
  const [protocolDueDate, setProtocolDueDate] = useState('')
  const [protocolAttachmentId, setProtocolAttachmentId] = useState('')
  const [protocolContent, setProtocolContent] = useState('')
  const [protocolRequiresPayment, setProtocolRequiresPayment] = useState(false)
  const [protocolAmount, setProtocolAmount] = useState('')

  const createProtocolMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${task.id}/protocols`, {
      title: protocolTitle,
      dueDate: protocolDueDate ? new Date(protocolDueDate).toISOString() : undefined,
      attachmentId: protocolMode === 'attachment' ? protocolAttachmentId : undefined,
      content: protocolMode === 'text' ? protocolContent : undefined,
      requiresPayment: protocolRequiresPayment,
      amount: protocolRequiresPayment ? toApiAmount(protocolAmount) : undefined,
    }),
    onSuccess: () => {
      toast.success('Protocolo criado')
      queryClient.invalidateQueries({ queryKey: ['protocols', task.id] })
      setCreatingProtocol(false)
      setProtocolTitle('')
      setProtocolDueDate('')
      setProtocolAttachmentId('')
      setProtocolContent('')
      setProtocolRequiresPayment(false)
      setProtocolAmount('')
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao criar protocolo')),
  })

  async function openProtocolReceipt(protocolId: string) {
    // Abre a aba em branco de forma síncrona com o clique (senão navegadores bloqueiam o popup
    // quando window.open roda só depois da resposta assíncrona do fetch).
    const win = window.open('', '_blank')
    try {
      const { data: html } = await api.get<string>(`/protocols/${protocolId}/receipt`)
      if (win) {
        win.document.write(html)
        win.document.close()
      }
    } catch {
      win?.close()
      toast.error('Erro ao abrir comprovante')
    }
  }

  const [sourceRequestOpen, setSourceRequestOpen] = useState(true)

  const { data: sourceRequestComments = [] } = useQuery<Comment[]>({
    queryKey: ['request-comments', task.sourceRequestId],
    queryFn: () => api.get(`/requests/${task.sourceRequestId}/comments`).then((r) => r.data),
    enabled: tab === 'comments' && !!task.sourceRequestId && isOrgRole(role),
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
    mutationFn: ({ name, requiresPayment }: { name: string; requiresPayment: boolean }) =>
      api.post(`/tasks/${task.id}/documents/deliveries`, { name, requiresPayment }),
    onSuccess: () => { setAddingDeliverable(false); queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] }) },
  })
  const [addingDeliverable, setAddingDeliverable] = useState(false)
  // Payment guide delivery waits for amount/due date before uploading
  const [pendingDelivery, setPendingDelivery] = useState<{ reqId: string; file: File; acceptWarnings?: boolean; read?: DeliveryCheck['read'] } | null>(null)

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

  const notApplicableMutation = useMutation({
    mutationFn: ({ reqId, value }: { reqId: string; value: boolean }) => {
      const url = `/portal/tasks/${task.id}/documents/requests/${reqId}/not-applicable`
      return value ? api.post(url) : api.delete(url)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] }),
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao atualizar documento')),
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
    mutationFn: ({ reqId, file, payment, acceptWarnings }: { reqId: string; file: File; payment?: Partial<PaymentValues>; acceptWarnings?: boolean }) => {
      const form = new FormData()
      // Text fields BEFORE the file: the API reads them from the same multipart stream
      if (acceptWarnings) form.append('acceptWarnings', 'true')
      if (payment?.amount) form.append('amount', payment.amount)
      if (payment?.paymentDueDate) form.append('paymentDueDate', payment.paymentDueDate)
      form.append('file', file)
      return api.post(`/tasks/${task.id}/documents/deliveries/${reqId}/upload`, form)
    },
    onSuccess: async (res) => {
      setPendingDelivery(null)
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
      queryClient.invalidateQueries({ queryKey: ['protocols', task.id] })
      // The delivery may have finished the task: the template completes it, or the office is asked
      const completion = (res.data as { completion?: 'AUTO_COMPLETED' | 'READY' | 'PENDING' }).completion
      if (completion === 'AUTO_COMPLETED') {
        toast.success('Tudo entregue — tarefa concluída automaticamente')
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['board'] })
        return
      }
      toast.success('Documento entregue')
      if (completion === 'READY' && await askConfirm({
        title: 'Tudo entregue. Concluir a tarefa agora?',
        description: 'Os documentos do cliente estão resolvidos e todas as entregas foram feitas.',
        confirmLabel: 'Concluir', cancelLabel: 'Agora não',
      })) updateMutation.mutate({ status: 'DONE' })
    },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao entregar documento')),
  })

  // A delivery marked for the robot is checked before it goes in: another client's document is
  // blocked; divergences ask "Entregar mesmo assim" (the API records them in the history).
  async function startDelivery(d: TaskDeliverable, file: File) {
    let acceptWarnings = false
    let read: DeliveryCheck['read'] = {}
    if (d.obligationTypeId) {
      const form = new FormData()
      form.append('file', file)
      let check: DeliveryCheck
      try {
        check = (await api.post(`/tasks/${task.id}/documents/deliveries/${d.id}/check`, form)).data as DeliveryCheck
      } catch (err) {
        toast.error(mensagemDeErro(err, 'O robô não conseguiu conferir o arquivo'))
        return
      }
      if (check.blocked) {
        await askConfirm({ title: 'O robô bloqueou esta entrega', description: check.blocked, confirmLabel: 'Entendi', cancelLabel: 'Fechar' })
        return
      }
      if (check.warnings.length > 0) {
        const ok = await askConfirm({
          title: `O robô encontrou divergências em ${file.name}`,
          description: `${check.warnings.join(' • ')}. Se entregar, isso fica registrado no histórico.`,
          confirmLabel: 'Entregar mesmo assim', cancelLabel: 'Escolher outro arquivo', danger: true,
        })
        if (!ok) return
        acceptWarnings = true
      }
      read = check.read
    }
    if (d.requiresPayment) setPendingDelivery({ reqId: d.id, file, acceptWarnings, read })
    else deliverMutation.mutate({ reqId: d.id, file, acceptWarnings })
  }

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

  // Vencimento e meta de uma tarefa recorrente vêm do motor de recorrência (template) — travados
  // pra todo mundo, sem exceção, mesmo quem pode editar os outros campos da tarefa. Corrigir
  // significa ajustar o template e gerar de novo, não editar a tarefa já criada.
  const isRecurring = task.recurringTemplateId !== null
  const canEditDates = canEdit && !isRecurring

  const assumeMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${task.id}/assume`, { expectedAssigneeId: task.assigneeId ?? null }),
    onSuccess: () => {
      setAssumeError(null)
      toast.success('Tarefa assumida')
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => {
      const message = mensagemDeErro(err, 'Erro ao assumir a tarefa')
      setAssumeError(message)
      toast.error(message)
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'comments', label: 'Comentários', icon: <MessageSquare size={14} /> },
    { id: 'documents', label: 'Documentos', icon: <FileCheck size={14} /> },
    { id: 'attachments', label: 'Anexos', icon: <Paperclip size={14} /> },
    ...(isStaff ? [{ id: 'protocols' as Tab, label: 'Protocolos', icon: <Stamp size={14} /> }] : []),
    { id: 'history', label: 'Histórico', icon: <Clock size={14} /> },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex flex-col bg-surface shadow-2xl w-full max-w-[560px]">

        {/* Header fixo */}
        <div className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          {(canAssume || (isStaff && !canEdit)) && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-text/40 bg-warning-bg px-3 py-2">
              <div className="text-xs text-warning-text">
                {!canEdit ? <p>Assuma a tarefa para alterá-la</p> : <p>Esta tarefa está com outro colaborador.</p>}
                {assumeError && <p className="font-medium text-danger-text">{assumeError}</p>}
              </div>
              {canAssume && (
                <Button size="sm" onClick={() => assumeMutation.mutate()} disabled={assumeMutation.isPending}>
                  {assumeMutation.isPending ? 'Assumindo...' : 'Assumir'}
                </Button>
              )}
            </div>
          )}
          {awaitingApproval && (
            <p className="mb-3 inline-flex rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-medium text-warning-text">
              Aguardando aprovação do cliente
            </p>
          )}
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

            {isStaff && (canEdit ? (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="sr-only">Responsável</span>
                <select
                  aria-label="Responsável"
                  value={task.assigneeId ?? ''}
                  onChange={(e) => e.target.value && e.target.value !== task.assigneeId && updateMutation.mutate({ assigneeId: e.target.value })}
                  className="text-xs font-medium px-2 py-0.5 rounded-full border border-border text-foreground cursor-pointer bg-surface"
                >
                  {!task.assigneeId && <option value="">Sem responsável</option>}
                  {assigneeChoices.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
            ) : task.assigneeId && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                {userName(task.assigneeId)}
              </span>
            ))}

            {canEditDates ? (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Prazo:
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
                </label>
                {/* Aviso quando prazo da tarefa ultrapassa prazo do processo */}
                {task.dueDate && boardDueDate && new Date(task.dueDate) > new Date(boardDueDate) && (
                  <p className="text-xs text-warning-text">
                    ⚠ Prazo além do processo ({formatDateOnlyUTC(boardDueDate)})
                  </p>
                )}
              </div>
            ) : (
              task.dueDate && (
                <span
                  className={cn('text-xs px-2 py-0.5 rounded-full bg-neutral-bg text-foreground', isOverdue && 'bg-danger-bg text-danger-text font-medium')}
                  title={isRecurring ? 'Tarefa recorrente — vencimento fixado pelo template' : undefined}
                >
                  {isOverdue ? '⚠ ' : ''}Prazo: {formatDateOnlyUTC(task.dueDate)}{isRecurring ? ' 🔒' : ''}
                </span>
              )
            )}

            {canEditDates ? (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Meta interna">
                Meta:
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
                  className="text-xs border border-border rounded px-2 py-0.5 text-foreground bg-surface"
                />
              </label>
            ) : (
              task.targetDate && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-bg text-foreground" title={isRecurring ? 'Tarefa recorrente — meta fixada pelo template' : 'Meta interna'}>
                  Meta: {formatDateOnlyUTC(task.targetDate)}{isRecurring ? ' 🔒' : ''}
                </span>
              )
            )}
            {task.competence && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-bg text-foreground" title="Competência">
                Competência: {new Date(task.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </span>
            )}
            {isRecurring && role === 'ORG_ADMIN' && (
              <button
                type="button"
                disabled={regenerateMutation.isPending}
                onClick={async () => {
                  if (await askConfirm({
                    title: 'Gerar a tarefa de novo?',
                    description: 'Isso apaga essa tarefa e gera uma nova pra mesma competência, usando a configuração atual do template. Só funciona se a tarefa ainda não teve nenhuma movimentação (sem comentário, anexo ou mudança de coluna).',
                    confirmLabel: 'Gerar de novo',
                  })) regenerateMutation.mutate()
                }}
                className="text-xs px-2 py-0.5 rounded-full border border-accent text-accent hover:bg-accent/10 disabled:opacity-50"
                title="Apaga e gera de novo com a config atual do template — só funciona se a tarefa não teve movimentação"
              >
                {regenerateMutation.isPending ? 'Regenerando...' : 'Regenerar'}
              </button>
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

        {/* Abas em grade fechada: 5 (equipe) = 3 em cima (1/3 cada) + 2 embaixo (1/2 cada), sem célula vazia;
            4 (cliente) = uma linha */}
        <div
          role="tablist"
          className={cn('grid gap-px bg-border border-b border-border flex-shrink-0', TABS.length > 4 ? 'grid-cols-6' : 'grid-cols-4')}
        >
          {TABS.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                TABS.length > 4 && (i < 3 ? 'col-span-2' : 'col-span-3'),
                tab === t.id
                  ? 'border-accent text-accent bg-neutral-bg'
                  : 'border-transparent text-muted-foreground bg-surface hover:text-foreground hover:bg-neutral-bg/60',
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
            <div className="space-y-4">
              {task.sourceRequestId && isOrgRole(role) && (
                <div className="rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setSourceRequestOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {sourceRequestOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Solicitação de origem
                      {hasUnseenClientReply(sourceRequestComments) && (
                        <span className="flex items-center gap-1 text-xs font-medium text-warning-text bg-warning-bg rounded-full px-2 py-0.5 ml-1">
                          <AlertCircle size={12} />
                          Resposta não vista
                        </span>
                      )}
                    </span>
                  </button>
                  {sourceRequestOpen && (
                    <div className="px-3 pb-3">
                      <Comments entityType="request" entityId={task.sourceRequestId} currentUserId={currentUserId} role={role} />
                    </div>
                  )}
                </div>
              )}
              <Comments entityType="task" entityId={task.id} currentUserId={currentUserId} role={role} />
            </div>
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
                          r.status === 'PENDING' && 'bg-neutral-bg text-neutral-text border border-border',
                          r.status === 'UPLOADED' && 'bg-blue-500/10 text-accent-hover',
                          (r.status === 'APPROVED' || r.status === 'NOT_APPLICABLE') && 'bg-success-bg text-success-text',
                          r.status === 'REJECTED' && 'bg-danger-bg text-danger-text',
                        )}>
                          {{ PENDING: 'Pendente', UPLOADED: 'Enviado', APPROVED: 'Aprovado', REJECTED: 'Rejeitado', NOT_APPLICABLE: 'Nada a enviar' }[r.status]}
                        </span>
                      </div>
                      {r.rejectionReason && <p className="text-xs text-danger-text mt-1">Motivo: {r.rejectionReason}</p>}
                      {r.signedUrl && (
                        <a href={r.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-info-text hover:underline mt-1 block">
                          Ver arquivo enviado
                        </a>
                      )}
                      {canEdit && r.status === 'UPLOADED' && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => reviewRequirementMutation.mutate({ reqId: r.id, decision: 'APPROVED' })} className="text-xs text-success-text hover:underline">
                            Aprovar
                          </button>
                          <button
                            onClick={async () => {
                              const reason = await askText({
                                title: `Rejeitar "${r.name}"`, label: 'Motivo da rejeição',
                                description: 'O cliente vê o motivo e envia o documento de novo.',
                                placeholder: 'Ex.: arquivo ilegível, falta a página 2', confirmLabel: 'Rejeitar documento', danger: true,
                              })
                              if (reason) reviewRequirementMutation.mutate({ reqId: r.id, decision: 'REJECTED', rejectionReason: reason })
                            }}
                            className="text-xs text-danger-text hover:underline"
                          >
                            Rejeitar
                          </button>
                        </div>
                      )}
                      {canEdit && r.status === 'NOT_APPLICABLE' && (
                        <button
                          onClick={async () => {
                            const reason = await askText({
                              title: `Contestar "Nada a enviar" — ${r.name}`, label: 'Por que o cliente precisa enviar este documento?',
                              confirmLabel: 'Contestar', danger: true,
                            })
                            if (reason) reviewRequirementMutation.mutate({ reqId: r.id, decision: 'REJECTED', rejectionReason: reason })
                          }}
                          className="text-xs text-danger-text hover:underline mt-2"
                        >
                          Contestar "Nada a enviar"
                        </button>
                      )}
                      {role === 'CLIENT' && r.status === 'NOT_APPLICABLE' && (
                        <button onClick={() => notApplicableMutation.mutate({ reqId: r.id, value: false })} className="text-xs text-accent-hover hover:underline mt-2">
                          Desfazer "Nada a enviar"
                        </button>
                      )}
                      {role === 'CLIENT' && (r.status === 'PENDING' || r.status === 'REJECTED') && (
                        <button onClick={() => notApplicableMutation.mutate({ reqId: r.id, value: true })} className="text-xs text-muted-foreground hover:underline mt-2 mr-3">
                          Nada a enviar
                        </button>
                      )}
                      {(r.status === 'PENDING' || r.status === 'REJECTED') && (
                        <label className="inline-block mt-2 cursor-pointer">
                          <input type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) uploadRequirementMutation.mutate({ reqId: r.id, file })
                            e.target.value = ''
                          }} />
                          <span className="text-xs text-info-text hover:underline">Enviar arquivo</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    onClick={async () => {
                      const name = await askText({ title: 'Documento a cobrar do cliente', label: 'Nome do documento', placeholder: 'Ex.: Extrato bancário de outubro', confirmLabel: 'Adicionar' })
                      if (name) addRequirementMutation.mutate(name)
                    }}
                    className="text-xs text-info-text hover:underline mt-2"
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
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">
                          {d.name}
                          {d.requiresPayment && <span className="ml-2 text-xs text-muted-foreground">guia de pagamento</span>}
                        </span>
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', d.deliveredAt ? 'bg-success-bg text-success-text' : 'bg-neutral-bg text-neutral-text')}>
                          {d.deliveredAt ? 'Entregue' : 'Pendente'}
                        </span>
                      </div>
                      {d.requiresPayment && d.amount && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatBRL(d.amount)}{d.paymentDueDate && ` · vence ${formatDateOnlyUTC(d.paymentDueDate)}`}
                        </p>
                      )}
                      {d.signedUrl && (
                        <a href={d.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-info-text hover:underline mt-1 block">
                          Ver arquivo entregue
                        </a>
                      )}
                      {canEdit && (
                        <label className="inline-block mt-2 cursor-pointer">
                          <input type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void startDelivery(d, file)
                            e.target.value = ''
                          }} />
                          <span className="text-xs text-accent-hover hover:underline">{d.deliveredAt ? 'Substituir arquivo' : 'Enviar arquivo'}</span>
                        </label>
                      )}
                      {pendingDelivery?.reqId === d.id && (
                        <PaymentFields
                          initialAmount={d.amount ?? pendingDelivery.read?.amount ?? null}
                          initialDueDate={d.paymentDueDate ?? pendingDelivery.read?.dueDate ?? task.dueDate}
                          submitLabel={`Enviar ${pendingDelivery.file.name}`}
                          pending={deliverMutation.isPending}
                          onSubmit={(payment) => deliverMutation.mutate({ reqId: d.id, file: pendingDelivery.file, payment, acceptWarnings: pendingDelivery.acceptWarnings })}
                          onCancel={() => setPendingDelivery(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (addingDeliverable ? (
                  <AddDeliverableForm
                    pending={addDeliverableMutation.isPending}
                    onSubmit={(v) => addDeliverableMutation.mutate(v)}
                    onCancel={() => setAddingDeliverable(false)}
                  />
                ) : (
                  <button onClick={() => setAddingDeliverable(true)} className="text-xs text-accent-hover hover:underline mt-2">
                    + Adicionar documento a entregar
                  </button>
                ))}
              </div>

              {isStaff && <ApprovalsSection taskId={task.id} canEdit={canEdit} visibleToClient={task.visibleToClient} />}
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
                      isDeleted ? 'bg-danger-bg border border-danger-text/30' : 'bg-neutral-bg',
                    )}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {isDeleted
                        ? <Trash2 size={14} className="text-danger-text flex-shrink-0 mt-0.5" />
                        : <Paperclip size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                      }
                      <div className="min-w-0">
                        {isDeleted ? (
                          <span className="text-sm text-danger-text line-through block truncate">{a.filename}</span>
                        ) : (
                          <a
                            href={a.signedUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-info-text hover:underline block truncate"
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
                        <AttachmentPurposeLine purpose={a.purpose ?? null} />
                        {isDeleted && (
                          <p className="text-xs text-danger-text mt-0.5">
                            Removido por {a.deletedByName} · {new Date(a.deletedAt!).toLocaleString('pt-BR')}
                          </p>
                        )}
                      </div>
                    </div>
                    {!isDeleted && canEdit && (
                      <button
                        type="button"
                        onClick={() => deleteAttachmentMutation.mutate(a.id)}
                        className="text-xs text-danger-text hover:text-danger-hover flex-shrink-0 mt-0.5"
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
              {canEdit && (
                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadMutation.mutate(file)
                      e.target.value = ''
                    }}
                  />
                  <span className="text-sm text-info-text hover:underline">
                    {uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo'}
                  </span>
                </label>
              )}
            </div>
          )}

          {tab === 'protocols' && (
            <div className="space-y-4">
              <Button size="sm" onClick={() => setCreatingProtocol(true)} className="gap-2">
                <Stamp size={14} />
                Criar protocolo
              </Button>

              {protocols.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum protocolo criado pra esta tarefa.</p>
              ) : (
                <div className="space-y-2">
                  {protocols.map((p) => (
                    <ProtocolOfficeCard key={p.id} protocol={p} taskId={task.id} onReceipt={openProtocolReceipt} />
                  ))}
                </div>
              )}

              {creatingProtocol && (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex rounded-md border border-border overflow-hidden w-fit">
                    <button
                      type="button"
                      onClick={() => setProtocolMode('attachment')}
                      className={cn('px-3 py-1.5 text-sm font-medium', protocolMode === 'attachment' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
                    >
                      Anexo existente
                    </button>
                    <button
                      type="button"
                      onClick={() => setProtocolMode('text')}
                      className={cn('px-3 py-1.5 text-sm font-medium', protocolMode === 'text' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
                    >
                      Só texto
                    </button>
                  </div>

                  <input
                    placeholder="Título do protocolo"
                    value={protocolTitle}
                    onChange={(e) => setProtocolTitle(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                  />

                  <input
                    type="date"
                    value={protocolDueDate}
                    onChange={(e) => setProtocolDueDate(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                  />

                  {protocolMode === 'attachment' ? (
                    <select
                      value={protocolAttachmentId}
                      onChange={(e) => setProtocolAttachmentId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                    >
                      <option value="">Selecione um anexo já enviado nesta tarefa</option>
                      {attachments.filter((a) => !a.deletedAt).map((a) => (
                        <option key={a.id} value={a.id}>{a.filename}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      rows={3}
                      placeholder="Texto do aviso formal"
                      value={protocolContent}
                      onChange={(e) => setProtocolContent(e.target.value)}
                      className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
                    />
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={protocolRequiresPayment} onChange={(e) => setProtocolRequiresPayment(e.target.checked)} />
                      Guia de pagamento
                    </label>
                    {protocolRequiresPayment && (
                      <input
                        placeholder="Valor (1.234,56)"
                        inputMode="decimal"
                        value={protocolAmount}
                        onChange={(e) => setProtocolAmount(e.target.value)}
                        className="flex h-9 w-40 rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                      />
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreatingProtocol(false)}>Cancelar</Button>
                    <Button
                      onClick={() => createProtocolMutation.mutate()}
                      disabled={
                        createProtocolMutation.isPending || !protocolTitle.trim() ||
                        (protocolRequiresPayment && !isValidAmount(protocolAmount)) ||
                        (protocolMode === 'attachment' ? !protocolAttachmentId : !protocolContent.trim())
                      }
                      className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
                    >
                      {createProtocolMutation.isPending ? 'Criando...' : 'Criar'}
                    </Button>
                  </div>
                </div>
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
                  <div className="absolute -left-[11px] top-1.5 w-2 h-2 rounded-full bg-accent" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{h.actorName}</span>
                    {' — '}
                    {formatHistoryAction(h, userName)}
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

const REVIEW_LABEL: Record<string, { text: string; className: string }> = {
  PENDING_REVIEW: { text: 'Em conferência', className: 'text-warning-text' },
  APPROVED: { text: 'Aprovado', className: 'text-success-text' },
  REJECTED: { text: 'Recusado', className: 'text-danger-text' },
  REPLACED: { text: 'Substituído antes da conferência', className: 'text-muted-foreground' },
}

// "Ponto do mês · Recusado" / "Holerites · Entregue ao cliente" under each attachment
function AttachmentPurposeLine({ purpose }: { purpose: AttachmentPurpose | null }) {
  if (!purpose) return null
  if (purpose.kind === 'REQUIREMENT') {
    const review = purpose.review ? REVIEW_LABEL[purpose.review] : null
    return (
      <div className="mt-0.5 text-xs">
        <p className={cn('font-medium', review?.className)}>
          {purpose.name}{review && ` · ${review.text}`}{purpose.current && ' · versão atual'}
        </p>
        {purpose.review === 'REJECTED' && purpose.rejectionReason && (
          <p className="text-muted-foreground">
            {purpose.rejectionReason}{purpose.reviewedByName && ` — por ${purpose.reviewedByName}`}
            {purpose.reviewedAt && ` em ${new Date(purpose.reviewedAt).toLocaleDateString('pt-BR')}`}
          </p>
        )}
        {purpose.review === 'APPROVED' && purpose.reviewedByName && (
          <p className="text-muted-foreground">por {purpose.reviewedByName}{purpose.reviewedAt && ` em ${new Date(purpose.reviewedAt).toLocaleDateString('pt-BR')}`}</p>
        )}
      </div>
    )
  }
  const text = {
    DELIVERABLE: `${purpose.name} · Entregue ao cliente`,
    APPROVAL_FILE: `Aprovação do cliente: ${purpose.name}`,
    APPROVAL_PROOF: `Comprovante da aprovação fora da plataforma: ${purpose.name}`,
    PROTOCOL: `Documento enviado ao cliente: ${purpose.name}`,
  }[purpose.kind]
  return <p className="mt-0.5 text-xs font-medium text-info-text">{text}</p>
}
