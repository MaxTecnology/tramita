import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { notifyInApp, clientUsersFor, type NotifyInput } from './inbox.service'

// Bell (in-app) side of every event. Callers fire these after their own write; a failure here is
// logged and swallowed — the bell is never a reason to fail the action that caused it.

type TaskCtx = {
  id: string
  title: string
  organizationId: string
  departmentId: string | null
  assigneeId: string | null
  visibleToClient: boolean
  competence: Date | null
  boardId: string
  boardType: 'OS' | 'RECURRING_SYSTEM'
  clientId: string
  clientName: string
}

async function taskContext(taskId: string): Promise<TaskCtx | null> {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, departmentId: true, assigneeId: true, visibleToClient: true, competence: true,
      column: { select: { board: { select: { id: true, type: true, organizationId: true, clientId: true, client: { select: { name: true } } } } } },
    },
  })
  if (!t) return null
  const b = t.column.board
  return {
    id: t.id, title: t.title, organizationId: b.organizationId, departmentId: t.departmentId, assigneeId: t.assigneeId,
    visibleToClient: t.visibleToClient, competence: t.competence, boardId: b.id, boardType: b.type, clientId: b.clientId,
    clientName: b.client.name,
  }
}

const competenceParam = (d: Date | null) => (d ? `competence=${d.toISOString().slice(0, 7)}&` : '')

export const staffTaskLink = (t: Pick<TaskCtx, 'id' | 'boardId' | 'boardType'>) =>
  t.boardType === 'RECURRING_SYSTEM' ? `/app/tasks?task=${t.id}` : `/app/board/${t.boardId}?task=${t.id}`

export const clientTaskLink = (t: Pick<TaskCtx, 'id' | 'boardId' | 'boardType' | 'competence'>) =>
  t.boardType === 'RECURRING_SYSTEM' ? `/portal/send?${competenceParam(t.competence)}task=${t.id}` : `/portal/board/${t.boardId}?task=${t.id}`

const staffRequestLink = (id: string) => `/app/requests?request=${id}`
const clientRequestLink = (id: string) => `/portal/requests?request=${id}`

// Who answers for the task on the office side: its assignee, else the department responsible
async function taskOwners(t: TaskCtx): Promise<string[]> {
  if (t.assigneeId) return [t.assigneeId]
  return departmentResponsibles(t.clientId, t.departmentId)
}

async function departmentResponsibles(clientId: string, departmentId: string | null): Promise<string[]> {
  if (!departmentId) return []
  const rows = await prisma.clientAssignment.findMany({ where: { clientId, departmentId }, select: { userId: true } })
  return rows.map((r) => r.userId)
}

// Client side never hears about an internal task
const clientRecipientsForTask = (t: TaskCtx) => (t.visibleToClient ? clientUsersFor(t.clientId, t.departmentId) : Promise.resolve([]))

async function safe(event: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    logger.warn({ event, reason: err instanceof Error ? err.message : String(err) }, 'Falha ao gravar notificação no sino')
  }
}

const excerpt = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export type Actor = { userId?: string; clientUserId?: string; name: string }

export function onTaskComment(taskId: string, actor: Actor, content: string) {
  return safe('TASK_COMMENT', async () => {
    const t = await taskContext(taskId)
    if (!t) return
    const refs = { taskId: t.id, boardId: t.boardId, clientId: t.clientId }
    const base = { organizationId: t.organizationId, type: 'TASK_COMMENT' as const, body: excerpt(content), actorName: actor.name, refs }
    await notifyInApp({
      ...base, title: `${actor.name} comentou em "${t.title}" — ${t.clientName}`, link: staffTaskLink(t),
      to: { userIds: await taskOwners(t) }, exclude: { userId: actor.userId },
    })
    if (actor.userId) {
      await notifyInApp({
        ...base, title: `Novo comentário do escritório em "${t.title}"`, link: clientTaskLink(t),
        to: { clientUserIds: await clientRecipientsForTask(t) },
      })
    }
  })
}

type RequestCtx = { id: string; title: string; organizationId: string; clientId: string; departmentId: string; clientName: string }

async function requestContext(requestId: string): Promise<RequestCtx | null> {
  const r = await prisma.request.findUnique({
    where: { id: requestId },
    select: { id: true, title: true, organizationId: true, clientId: true, departmentId: true, client: { select: { name: true } } },
  })
  return r ? { ...r, clientName: r.client.name } : null
}

export function onRequestCreated(requestId: string, actor: Actor) {
  return safe('REQUEST_CREATED', async () => {
    const r = await requestContext(requestId)
    if (!r) return
    await notifyInApp({
      organizationId: r.organizationId, type: 'REQUEST_CREATED', title: `Nova solicitação de ${r.clientName}`, body: r.title,
      link: staffRequestLink(r.id), refs: { requestId: r.id, clientId: r.clientId }, actorName: actor.name,
      to: { userIds: await departmentResponsibles(r.clientId, r.departmentId) },
    })
  })
}

export function onRequestComment(requestId: string, actor: Actor, content: string) {
  return safe('REQUEST_COMMENT', async () => {
    const r = await requestContext(requestId)
    if (!r) return
    const common = { organizationId: r.organizationId, type: 'REQUEST_COMMENT' as const, body: excerpt(content), actorName: actor.name, refs: { requestId: r.id, clientId: r.clientId } }
    if (actor.clientUserId) {
      await notifyInApp({
        ...common, title: `${actor.name} comentou na solicitação "${r.title}" — ${r.clientName}`, link: staffRequestLink(r.id),
        to: { userIds: await departmentResponsibles(r.clientId, r.departmentId) },
      })
    } else {
      await notifyInApp({
        ...common, title: `Novo comentário do escritório na solicitação "${r.title}"`, link: clientRequestLink(r.id),
        to: { clientUserIds: await clientUsersFor(r.clientId, r.departmentId) }, exclude: { userId: actor.userId },
      })
    }
  })
}

const REQUEST_STATUS_TEXT = {
  APPROVED: 'foi aprovada',
  REJECTED: 'foi recusada',
  NEEDS_INFO: 'precisa de mais informação',
  CANCELLED: 'foi cancelada pelo escritório',
} as const

export function onRequestStatus(requestId: string, status: keyof typeof REQUEST_STATUS_TEXT, actor: Actor, detail?: string) {
  return safe('REQUEST_STATUS', async () => {
    const r = await requestContext(requestId)
    if (!r) return
    await notifyInApp({
      organizationId: r.organizationId, type: 'REQUEST_STATUS', title: `Sua solicitação "${r.title}" ${REQUEST_STATUS_TEXT[status]}`,
      body: detail ? excerpt(detail) : '', link: clientRequestLink(r.id), refs: { requestId: r.id, clientId: r.clientId },
      actorName: actor.name, to: { clientUserIds: await clientUsersFor(r.clientId, r.departmentId) },
    })
  })
}

export function onDocumentUploaded(taskId: string, actor: Actor, documentName: string) {
  return safe('DOCUMENT_UPLOADED', async () => {
    const t = await taskContext(taskId)
    if (!t) return
    await notifyInApp({
      organizationId: t.organizationId, type: 'DOCUMENT_UPLOADED', title: `${t.clientName} enviou "${documentName}"`,
      body: t.title, link: staffTaskLink(t), refs: { taskId: t.id, boardId: t.boardId, clientId: t.clientId }, actorName: actor.name,
      to: { userIds: await taskOwners(t) },
    })
  })
}

export function onDocumentRejected(taskId: string, actor: Actor, documentName: string, reason: string) {
  return safe('DOCUMENT_REJECTED', async () => {
    const t = await taskContext(taskId)
    if (!t) return
    await notifyInApp({
      organizationId: t.organizationId, type: 'DOCUMENT_REJECTED', title: `O escritório recusou "${documentName}"`,
      body: excerpt(reason), link: clientTaskLink(t), refs: { taskId: t.id, boardId: t.boardId, clientId: t.clientId },
      actorName: actor.name, to: { clientUserIds: await clientRecipientsForTask(t) },
    })
  })
}

export function onProtocolCreated(protocolId: string, taskId: string, title: string, actor: Actor) {
  return safe('DOCUMENT_RECEIVED', async () => {
    const t = await taskContext(taskId)
    if (!t) return
    await notifyInApp({
      organizationId: t.organizationId, type: 'DOCUMENT_RECEIVED', title: `Novo documento: ${title}`, body: t.title,
      link: `/portal/documents/${protocolId}`, refs: { protocolId, taskId: t.id, clientId: t.clientId }, actorName: actor.name,
      to: { clientUserIds: await clientRecipientsForTask(t) },
    })
  })
}

export function onTaskAssumed(taskId: string, previousAssigneeId: string, actor: Actor) {
  return safe('TASK_ASSUMED', async () => {
    const t = await taskContext(taskId)
    if (!t) return
    await notifyInApp({
      organizationId: t.organizationId, type: 'TASK_ASSUMED', title: `${actor.name} assumiu "${t.title}"`, body: t.clientName,
      link: staffTaskLink(t), refs: { taskId: t.id, boardId: t.boardId, clientId: t.clientId }, actorName: actor.name,
      to: { userIds: [previousAssigneeId] }, exclude: { userId: actor.userId },
    })
  })
}

export function onTaskAssigned(taskId: string, actor: Actor) {
  return safe('TASK_ASSIGNED', async () => {
    const t = await taskContext(taskId)
    if (!t?.assigneeId) return
    await notifyInApp({
      organizationId: t.organizationId, type: 'TASK_ASSIGNED', title: `Tarefa atribuída a você: "${t.title}"`, body: t.clientName,
      link: staffTaskLink(t), refs: { taskId: t.id, boardId: t.boardId, clientId: t.clientId }, actorName: actor.name,
      to: { userIds: [t.assigneeId] }, exclude: { userId: actor.userId },
    })
  })
}

// Batch moves (bulk assume, responsibility transfer): one row summarising them, not one per task
export function onTasksMoved(input: {
  organizationId: string
  type: 'TASK_ASSUMED' | 'TASK_ASSIGNED'
  recipientUserId: string
  count: number
  clientNames: string[]
  actor: Actor
}) {
  return safe(input.type, async () => {
    if (input.count === 0) return
    const n = `${input.count} tarefa${input.count > 1 ? 's' : ''}`
    const clients = [...new Set(input.clientNames)]
    const body = clients.length === 1 ? clients[0] : `${clients.length} clientes`
    const title = input.type === 'TASK_ASSUMED' ? `${input.actor.name} assumiu ${n} suas` : `${n} passada${input.count > 1 ? 's' : ''} para você`
    const payload: NotifyInput = {
      organizationId: input.organizationId, type: input.type, title, body, link: '/app/tasks', actorName: input.actor.name,
      to: { userIds: [input.recipientUserId] }, exclude: { userId: input.actor.userId },
    }
    await notifyInApp(payload)
  })
}

export function onBoardAssigned(boardId: string, actor: Actor) {
  return safe('BOARD_ASSIGNED', async () => {
    const b = await prisma.board.findUnique({
      where: { id: boardId },
      select: { id: true, title: true, organizationId: true, clientId: true, responsibleUserId: true, client: { select: { name: true } } },
    })
    if (!b?.responsibleUserId) return
    await notifyInApp({
      organizationId: b.organizationId, type: 'BOARD_ASSIGNED', title: `Processo novo sob sua responsabilidade: ${b.title}`,
      body: b.client.name, link: `/app/board/${b.id}`, refs: { boardId: b.id, clientId: b.clientId }, actorName: actor.name,
      to: { userIds: [b.responsibleUserId] }, exclude: { userId: actor.userId },
    })
  })
}

export async function staffActor(userId: string): Promise<Actor> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  return { userId, name: u?.name ?? 'Escritório' }
}

export async function clientActor(clientUserId: string): Promise<Actor> {
  const u = await prisma.clientUser.findUnique({ where: { id: clientUserId }, select: { name: true } })
  return { clientUserId, name: u?.name ?? 'Cliente' }
}

async function approvalContext(approvalId: string) {
  return prisma.taskApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, title: true, status: true, decisionNote: true, requestedById: true, taskId: true },
  })
}

export function onApprovalRequested(approvalId: string, actor: Actor) {
  return safe('APPROVAL_REQUESTED', async () => {
    const a = await approvalContext(approvalId)
    const t = a && (await taskContext(a.taskId))
    if (!a || !t) return
    await notifyInApp({
      organizationId: t.organizationId, type: 'APPROVAL_REQUESTED', title: `Aguardando sua aprovação: ${a.title}`, body: t.title,
      link: clientTaskLink(t), refs: { taskId: t.id, boardId: t.boardId, clientId: t.clientId, approvalId: a.id }, actorName: actor.name,
      to: { clientUserIds: await clientRecipientsForTask(t) },
    })
  })
}

// The client answered: whoever asked and whoever holds the task hear about it
export function onApprovalDecided(approvalId: string, actor: Actor) {
  return safe('APPROVAL_DECIDED', async () => {
    const a = await approvalContext(approvalId)
    const t = a && (await taskContext(a.taskId))
    if (!a || !t) return
    const verdict = a.status === 'APPROVED' ? 'aprovou' : 'pediu ajuste em'
    await notifyInApp({
      organizationId: t.organizationId, type: 'APPROVAL_DECIDED', title: `${actor.name} ${verdict} "${a.title}" — ${t.clientName}`,
      body: a.decisionNote ? excerpt(a.decisionNote) : t.title, link: staffTaskLink(t),
      refs: { taskId: t.id, boardId: t.boardId, clientId: t.clientId, approvalId: a.id }, actorName: actor.name,
      to: { userIds: [a.requestedById, ...(t.assigneeId ? [t.assigneeId] : [])] },
    })
  })
}
