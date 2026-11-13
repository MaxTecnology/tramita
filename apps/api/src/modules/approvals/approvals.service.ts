import type { ApprovalStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishBoardEvent } from '@/lib/sse'
import { uploadFile, getSignedDownloadUrl } from '@/lib/b2'
import { getOrgSlug } from '@/lib/org-slug'
import { storageSafeName } from '@/lib/upload-policy'
import type { UploadedFile } from '@/lib/read-upload'
import { actorScope, taskWhere, canActOnTask } from '@/modules/staff-scope/staff-scope'
import { MUST_ASSUME } from '@/middlewares/staffScope'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import { recalculateTaskStatus } from '@/modules/task-documents/task-documents.service'
import { onApprovalRequested, onApprovalDecided } from '@/modules/inbox/inbox-events'
import type { CloseApprovalBody, RequestApprovalBody } from './approvals.schema'

type Staff = { id: string; role: string }
const DAY_MS = 86_400_000

const WINNER: Record<Exclude<ApprovalStatus, 'PENDING'>, string> = {
  APPROVED: 'aprovada pelo cliente',
  CHANGES_REQUESTED: 'respondida com pedido de ajuste',
  CLOSED_BY_OFFICE: 'fechada pelo escritório',
}

// Guarded write: only while still PENDING. Whoever arrives second gets the decision that won.
async function decide(tx: Prisma.TransactionClient, id: string, data: Prisma.TaskApprovalUncheckedUpdateManyInput): Promise<void> {
  const { count } = await tx.taskApproval.updateMany({ where: { id, status: 'PENDING' }, data })
  if (count === 1) return
  const current = await tx.taskApproval.findUnique({ where: { id }, select: { status: true } })
  const status = current?.status ?? 'PENDING'
  throw new AppError(409, status === 'PENDING' ? 'Essa aprovação não pôde ser atualizada' : `Essa aprovação já foi ${WINNER[status]}`)
}

export const approvalInclude = {
  attachment: { select: { filename: true, storageKey: true } },
  proof: { select: { filename: true, storageKey: true } },
  requestedBy: { select: { name: true } },
  decidedByUser: { select: { name: true } },
  decidedByClientUser: { select: { name: true } },
} satisfies Prisma.TaskApprovalInclude

type ApprovalRow = Prisma.TaskApprovalGetPayload<{ include: typeof approvalInclude }>

export async function presentApproval(a: ApprovalRow) {
  return {
    id: a.id, taskId: a.taskId, title: a.title, message: a.message, status: a.status,
    requestedAt: a.requestedAt, requestedByName: a.requestedBy.name,
    decidedAt: a.decidedAt, decisionNote: a.decisionNote, closeReason: a.closeReason, waitedDays: a.waitedDays,
    decidedByName: a.decidedByClientUser?.name ?? a.decidedByUser?.name ?? null,
    decidedByClient: !!a.decidedByClientUserId,
    fileName: a.attachment.filename,
    fileUrl: await getSignedDownloadUrl(a.attachment.storageKey),
    proofName: a.proof?.filename ?? null,
    proofUrl: a.proof ? await getSignedDownloadUrl(a.proof.storageKey) : null,
  }
}

async function storeFile(organizationId: string, taskId: string, file: UploadedFile, folder: string, uploadedBy: string) {
  const storageKey = `${folder}/${await getOrgSlug(organizationId)}/${taskId}/${Date.now()}-${storageSafeName(file.filename)}`
  await uploadFile(storageKey, file.buffer, file.mimeType)
  return prisma.attachment.create({
    data: { taskId, filename: file.filename, mimeType: file.mimeType, size: file.size, storageKey, uploadedBy },
  })
}

async function actorName(userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'Escritório'
}

// --- Office ---------------------------------------------------------------------------------

async function staffTask(taskId: string, organizationId: string, actor: Staff) {
  const scope = await actorScope(actor, organizationId)
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } }, AND: [taskWhere(scope)] },
    include: { column: { select: { board: { select: { id: true, clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  return { task, scope }
}

export async function requestApproval(taskId: string, organizationId: string, actor: Staff, body: RequestApprovalBody, file: UploadedFile) {
  const { task, scope } = await staffTask(taskId, organizationId, actor)
  if (!(await canActOnTask(scope, task))) throw new AppError(403, MUST_ASSUME)
  if (!task.visibleToClient) throw new AppError(422, 'Só tarefas visíveis ao cliente podem pedir aprovação')
  if (task.status === 'DONE' || task.status === 'DISREGARDED') throw new AppError(409, 'A tarefa já foi encerrada')

  const attachment = await storeFile(organizationId, taskId, file, 'approvals', actor.id)
  const name = await actorName(actor.id)
  const approval = await prisma.$transaction(async (tx) => {
    const created = await tx.taskApproval.create({
      data: { taskId, organizationId, title: body.title, message: body.message, attachmentId: attachment.id, requestedById: actor.id },
      include: approvalInclude,
    })
    await tx.taskHistory.create({
      data: { taskId, action: 'approval_requested', toValue: body.title, actorType: 'user', actorId: actor.id, actorName: name },
    })
    return created
  })

  await enqueueNotification({
    event: 'APPROVAL_REQUESTED', organizationId, clientId: task.column.board.clientId, taskId,
    metadata: { taskTitle: task.title, approvalTitle: body.title, commentText: body.message },
  })
  await onApprovalRequested(approval.id, { userId: actor.id, name })
  await publishBoardEvent(task.column.board.id, { event: 'task:updated', data: { taskId } })
  return presentApproval(approval)
}

export async function listApprovalsForStaff(taskId: string, organizationId: string, actor: Staff) {
  await staffTask(taskId, organizationId, actor)
  const rows = await prisma.taskApproval.findMany({ where: { taskId }, include: approvalInclude, orderBy: { requestedAt: 'desc' } })
  return Promise.all(rows.map(presentApproval))
}

export async function closeApproval(id: string, organizationId: string, actor: Staff, body: CloseApprovalBody, proof?: UploadedFile) {
  const approval = await prisma.taskApproval.findFirst({ where: { id, organizationId }, select: { taskId: true, requestedAt: true, title: true } })
  if (!approval) throw new AppError(404, 'Aprovação não encontrada')
  const { task, scope } = await staffTask(approval.taskId, organizationId, actor)
  if (!(await canActOnTask(scope, task))) throw new AppError(403, MUST_ASSUME)

  const proofAttachment = proof ? await storeFile(organizationId, task.id, proof, 'approval-proofs', actor.id) : null
  const name = await actorName(actor.id)
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await decide(tx, id, {
      status: 'CLOSED_BY_OFFICE', closeReason: body.reason, decisionNote: body.note, decidedAt: now, decidedByUserId: actor.id,
      proofAttachmentId: proofAttachment?.id ?? null,
      waitedDays: Math.floor((now.getTime() - approval.requestedAt.getTime()) / DAY_MS),
    })
    await tx.taskHistory.create({
      data: { taskId: task.id, action: 'approval_closed_by_office', fromValue: approval.title, toValue: body.reason, actorType: 'user', actorId: actor.id, actorName: name },
    })
  })
  await recalculateTaskStatus(task.id)
  await publishBoardEvent(task.column.board.id, { event: 'task:updated', data: { taskId: task.id } })
  return presentApproval(await prisma.taskApproval.findUniqueOrThrow({ where: { id }, include: approvalInclude }))
}

// --- Client (portal) -------------------------------------------------------------------------

async function clientTask(taskId: string, organizationId: string, clientUserId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
    include: { column: { select: { board: { select: { id: true, clientId: true } } } } },
  })
  const scope = await getClientAccessScope(clientUserId)
  if (!task || !task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId)) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task
}

export async function listApprovalsForClient(taskId: string, organizationId: string, clientUserId: string) {
  await clientTask(taskId, organizationId, clientUserId)
  const rows = await prisma.taskApproval.findMany({ where: { taskId }, include: approvalInclude, orderBy: { requestedAt: 'desc' } })
  return Promise.all(rows.map(presentApproval))
}

export async function decideAsClient(id: string, organizationId: string, clientUserId: string, decision: 'APPROVED' | 'CHANGES_REQUESTED', note?: string) {
  const approval = await prisma.taskApproval.findFirst({ where: { id, organizationId }, select: { taskId: true, title: true, requestedById: true } })
  if (!approval) throw new AppError(404, 'Aprovação não encontrada')
  const task = await clientTask(approval.taskId, organizationId, clientUserId).catch(() => {
    throw new AppError(404, 'Aprovação não encontrada')
  })
  const clientUser = await prisma.clientUser.findUniqueOrThrow({ where: { id: clientUserId }, select: { name: true } })

  await prisma.$transaction(async (tx) => {
    await decide(tx, id, { status: decision, decisionNote: note ?? null, decidedAt: new Date(), decidedByClientUserId: clientUserId })
    await tx.taskHistory.create({
      data: {
        taskId: task.id, action: decision === 'APPROVED' ? 'approval_approved' : 'approval_changes_requested',
        fromValue: approval.title, toValue: note, actorType: 'client', actorId: clientUserId, actorName: clientUser.name,
      },
    })
  })

  if (decision === 'CHANGES_REQUESTED') {
    await enqueueNotification({
      event: 'APPROVAL_CHANGES_REQUESTED', organizationId, recipientType: 'USER', userId: approval.requestedById, taskId: task.id,
      metadata: { taskTitle: task.title, approvalTitle: approval.title, commentText: note, commentAuthorName: clientUser.name },
    })
  }
  await onApprovalDecided(id, { clientUserId, name: clientUser.name })
  // A change request means work is still to be done: never let the checklist auto-complete it
  if (decision === 'APPROVED') await recalculateTaskStatus(task.id)
  await publishBoardEvent(task.column.board.id, { event: 'task:updated', data: { taskId: task.id } })
  return presentApproval(await prisma.taskApproval.findUniqueOrThrow({ where: { id }, include: approvalInclude }))
}
