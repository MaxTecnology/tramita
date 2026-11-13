import { storageSafeName } from '@/lib/upload-policy'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { uploadFile, getSignedDownloadUrl } from '@/lib/b2'
import { enqueueNotification } from '@/lib/queue'
import { onDocumentUploaded, onDocumentRejected, staffActor, clientActor } from '@/modules/inbox/inbox-events'
import { resolveCompletedAt } from '@/lib/task-completion'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import type { TaskStatus } from '@prisma/client'
import { parseMoney } from '@/lib/money'
import { assertProtocolEditable, upsertProtocolForDeliverable, replaceProtocolFileCore, discardUploadedAttachment } from '@/modules/protocols/protocol-from-deliverable'

// "YYYY-MM-DD" → midnight UTC (date-only label, same convention as Task.dueDate)
function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, 'Data de vencimento inválida')
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Data de vencimento inválida')
  return d
}

export interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
  return org?.slug ?? organizationId
}

export async function verifyTaskAccess(taskId: string, organizationId: string, clientUserId?: string) {
  const scope = clientUserId ? await getClientAccessScope(clientUserId) : undefined
  const boardWhere = scope ? { organizationId, clientId: { in: scope.clientIds } } : { organizationId }
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  // clientUserId presente = chamada vindo do portal — tarefa marcada como não-visível pro
  // cliente (ex: SPED, controle interno), ou fora do departamento a que o ClientUser tem
  // acesso, responde 404 igual "não existe", nunca 403 (não revela que a tarefa existe).
  // Chamada do lado do escritório (clientUserId ausente) nunca é filtrada por isso.
  if (scope && (!task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId))) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task
}

export async function listTaskDocuments(taskId: string, organizationId: string, clientUserId?: string) {
  await verifyTaskAccess(taskId, organizationId, clientUserId)

  const [requirements, deliverables] = await Promise.all([
    prisma.taskDocumentRequirement.findMany({ where: { taskId }, orderBy: { position: 'asc' }, include: { attachment: true } }),
    prisma.taskDeliverable.findMany({ where: { taskId }, orderBy: { position: 'asc' }, include: { attachment: true } }),
  ])

  return {
    requirements: await Promise.all(requirements.map(async (r) => ({
      ...r,
      signedUrl: r.attachment ? await getSignedDownloadUrl(r.attachment.storageKey) : null,
    }))),
    deliverables: await Promise.all(deliverables.map(async (d) => ({
      ...d,
      signedUrl: d.attachment ? await getSignedDownloadUrl(d.attachment.storageKey) : null,
    }))),
  }
}

export async function addDocumentRequirement(taskId: string, organizationId: string, name: string) {
  await verifyTaskAccess(taskId, organizationId)
  const position = await prisma.taskDocumentRequirement.count({ where: { taskId } })
  const requirement = await prisma.taskDocumentRequirement.create({ data: { taskId, name, position } })

  await recalculateTaskStatus(taskId)

  return requirement
}

export async function addDeliverable(taskId: string, organizationId: string, name: string, requiresPayment = false) {
  await verifyTaskAccess(taskId, organizationId)
  const position = await prisma.taskDeliverable.count({ where: { taskId } })
  return prisma.taskDeliverable.create({ data: { taskId, name, position, requiresPayment } })
}

export async function uploadForRequirement(
  taskId: string,
  requirementId: string,
  organizationId: string,
  actor: { id: string; type: 'user' | 'client' },
  clientUserId: string | undefined,
  payload: UploadPayload,
) {
  const task = await verifyTaskAccess(taskId, organizationId, clientUserId)
  const requirement = await prisma.taskDocumentRequirement.findFirst({ where: { id: requirementId, taskId } })
  if (!requirement) throw new AppError(404, 'Documento não encontrado')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${storageSafeName(payload.filename)}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const attachment = await prisma.attachment.create({
    data: {
      taskId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: actor.type === 'user' ? actor.id : undefined,
      uploadedByClient: actor.type === 'client' ? task.column.board.clientId : undefined,
    },
  })

  await prisma.taskDocumentRequirement.update({
    where: { id: requirementId },
    data: { status: 'UPLOADED', attachmentId: attachment.id, rejectionReason: null },
  })

  await recalculateTaskStatus(taskId)
  if (actor.type === 'client' && clientUserId) {
    await onDocumentUploaded(taskId, await clientActor(clientUserId), requirement.name)
  }

  return prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId }, include: { attachment: true } })
}

// Client's "Nada a enviar" (value=true) and its undo (false). Undo is refused once the task is done.
export async function setNotApplicable(
  taskId: string,
  requirementId: string,
  organizationId: string,
  clientUserId: string,
  value: boolean,
) {
  const task = await verifyTaskAccess(taskId, organizationId, clientUserId)
  const requirement = await prisma.taskDocumentRequirement.findFirst({ where: { id: requirementId, taskId } })
  if (!requirement) throw new AppError(404, 'Documento não encontrado')

  if (value) {
    if (requirement.status !== 'PENDING' && requirement.status !== 'REJECTED') {
      throw new AppError(409, 'Esse documento já foi enviado ou resolvido')
    }
    await prisma.taskDocumentRequirement.update({
      where: { id: requirementId },
      data: { status: 'NOT_APPLICABLE', rejectionReason: null, reviewedById: null, reviewedAt: null },
    })
  } else {
    if (requirement.status !== 'NOT_APPLICABLE') throw new AppError(409, 'Esse documento não está marcado como "Nada a enviar"')
    if (task.status === 'DONE') throw new AppError(409, 'A tarefa já foi concluída')
    await prisma.taskDocumentRequirement.update({ where: { id: requirementId }, data: { status: 'PENDING' } })
  }

  await recalculateTaskStatus(taskId)
  return prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId } })
}

export async function reviewDocumentRequirement(
  taskId: string,
  requirementId: string,
  organizationId: string,
  reviewerId: string,
  decision: 'APPROVED' | 'REJECTED',
  rejectionReason: string | undefined,
) {
  await verifyTaskAccess(taskId, organizationId)
  const requirement = await prisma.taskDocumentRequirement.findFirst({ where: { id: requirementId, taskId } })
  if (!requirement) throw new AppError(404, 'Documento não encontrado')
  // A client's "Nada a enviar" can be contested (rejected with a reason), never approved again
  const contestingNotApplicable = requirement.status === 'NOT_APPLICABLE' && decision === 'REJECTED'
  if (requirement.status !== 'UPLOADED' && !contestingNotApplicable) {
    throw new AppError(422, 'Só é possível avaliar um documento que já foi enviado')
  }
  if (decision === 'REJECTED' && !rejectionReason) {
    throw new AppError(422, 'Motivo da rejeição é obrigatório')
  }

  const updated = await prisma.taskDocumentRequirement.update({
    where: { id: requirementId },
    data: {
      status: decision,
      rejectionReason: decision === 'REJECTED' ? rejectionReason : null,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  })

  await recalculateTaskStatus(taskId)

  if (decision === 'REJECTED') {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { column: { include: { board: { select: { clientId: true } } } } },
    })
    await enqueueNotification({
      event: 'DOCUMENT_REJECTED',
      organizationId,
      clientId: task.column.board.clientId,
      taskId,
      metadata: { taskTitle: task.title, documentName: requirement.name, rejectionReason: rejectionReason! },
    })
    await onDocumentRejected(taskId, await staffActor(reviewerId), requirement.name, rejectionReason!)
  }

  return updated
}

export async function deliverDocument(
  taskId: string,
  deliverableId: string,
  organizationId: string,
  actor: { id: string },
  payload: UploadPayload,
  payment: { amount?: string; paymentDueDate?: string } = {},
) {
  await verifyTaskAccess(taskId, organizationId)
  const deliverable = await prisma.taskDeliverable.findFirst({ where: { id: deliverableId, taskId }, include: { protocol: true } })
  if (!deliverable) throw new AppError(404, 'Entregável não encontrado')

  // Validate everything before uploading: a refused delivery leaves no orphan file behind
  if (deliverable.protocol) assertProtocolEditable(deliverable.protocol)
  let amount: string | undefined
  if (deliverable.requiresPayment) {
    if (!payment.amount?.trim()) throw new AppError(400, 'Informe o valor da guia')
    amount = parseMoney(payment.amount)
  }
  const paymentDueDate = deliverable.requiresPayment && payment.paymentDueDate ? parseDateOnly(payment.paymentDueDate) : undefined

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${storageSafeName(payload.filename)}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const attachment = await prisma.attachment.create({
    data: {
      taskId, filename: payload.filename, mimeType: payload.mimeType, size: payload.size, storageKey,
      uploadedBy: actor.id,
    },
  })

  // Re-delivery of a document the client already has: swap it first (guarded write). If a payment
  // or cancellation landed since the check above, nothing of the delivery changes and the new file
  // is discarded — no checklist pointing at one file while the client sees another.
  if (deliverable.protocol) {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { dueDate: true } })
    try {
      await replaceProtocolFileCore(deliverable.protocol.id, attachment.id, actor, {
        amount: amount ?? deliverable.amount?.toString() ?? null,
        dueDate: paymentDueDate ?? deliverable.paymentDueDate ?? task.dueDate,
      })
    } catch (err) {
      await discardUploadedAttachment(attachment.id)
      throw err
    }
  }

  const updated = await prisma.taskDeliverable.update({
    where: { id: deliverableId },
    data: {
      attachmentId: attachment.id, deliveredById: actor.id, deliveredAt: new Date(),
      ...(amount !== undefined ? { amount } : {}),
      ...(paymentDueDate !== undefined ? { paymentDueDate } : {}),
    },
  })

  await upsertProtocolForDeliverable(deliverableId, actor)
  await recalculateTaskStatus(taskId)

  return updated
}

// Ponto único de disparo da notificação TASK_BLOCKED — chamado por recalculateTaskStatus (abaixo,
// quando um documento pendente/rejeitado bloqueia a tarefa), por tasks.service.ts's moveTask/
// updateTask, e por recurring-templates.service.ts's generateTaskForAssignment (uma tarefa
// recorrente pode nascer já BLOCKED quando o template exige documentos). A varredura original só
// buscava `task.update(` e por isso perdeu esse quarto ponto, que escreve o status via
// `task.create(` — não há garantia de que esses sejam os únicos; qualquer novo escritor de
// Task.status precisa chamar este helper. Só dispara na transição DE ENTRADA em BLOCKED, nunca em
// edições subsequentes enquanto já está bloqueada, nunca ao sair de BLOCKED, e nunca para uma
// tarefa que o cliente não pode ver no portal (visibleToClient=false) — esse check aqui barra
// ANTES de enfileirar (nunca chega a entrar na fila pra TASK_BLOCKED); notification.worker.ts
// tem o mesmo filtro pro branch de WhatsApp como segunda camada, cobrindo os demais eventos.
export async function notifyIfBlocked(
  taskId: string,
  previousStatus: TaskStatus,
  newStatus: TaskStatus,
  clientId: string,
  organizationId: string,
  visibleToClient: boolean,
): Promise<void> {
  if (newStatus !== 'BLOCKED' || previousStatus === 'BLOCKED') return
  if (!visibleToClient) return
  await enqueueNotification({
    event: 'TASK_BLOCKED',
    organizationId,
    clientId,
    taskId,
    metadata: {},
  })
}

export async function recalculateTaskStatus(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      documentRequirements: true,
      deliverables: true,
      approvals: { where: { status: 'PENDING' }, select: { id: true } },
      recurringTemplate: { select: { autoCompleteOnAllActivitiesDone: true } },
      column: { select: { board: { select: { clientId: true, organizationId: true } } } },
    },
  })

  const hasPendingOrRejected = task.documentRequirements.some((d) => d.status === 'PENDING' || d.status === 'REJECTED')
  // "Nada a enviar" counts as resolved, like an approval
  const allRequirementsApproved = task.documentRequirements.every((d) => d.status === 'APPROVED' || d.status === 'NOT_APPLICABLE')
  const allDeliverablesDone = task.deliverables.every((d) => d.deliveredAt !== null)
  const autoComplete = task.recurringTemplate?.autoCompleteOnAllActivitiesDone ?? false

  let nextStatus: TaskStatus | undefined

  if (hasPendingOrRejected) {
    if (task.status !== 'BLOCKED') nextStatus = 'BLOCKED'
  } else if (autoComplete && allRequirementsApproved && allDeliverablesDone && task.approvals.length === 0 && task.status !== 'DONE') {
    nextStatus = 'DONE'
  } else if (task.status === 'BLOCKED') {
    // Impedimento resolvido (nada mais pendente/rejeitado) — mesmo sem conclusão automática
    // ligada, ou com entregáveis ainda faltando, o status "Com Impedimento" deixou de ser
    // verdade, então volta pra Aberto.
    nextStatus = 'OPEN'
  }

  if (nextStatus && nextStatus !== task.status) {
    const completedAt = resolveCompletedAt(task.status, nextStatus, new Date())
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: nextStatus, completedAt } }),
      prisma.taskHistory.create({
        data: {
          taskId,
          action: 'status_changed',
          fromValue: task.status,
          toValue: nextStatus,
          actorType: 'system',
          actorId: 'system',
          actorName: 'Sistema (checklist)',
        },
      }),
    ])

    await notifyIfBlocked(
      taskId, task.status, nextStatus, task.column.board.clientId, task.column.board.organizationId,
      task.visibleToClient,
    )
  }
}
