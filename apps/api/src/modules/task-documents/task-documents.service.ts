import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { uploadFile, getSignedDownloadUrl } from '@/lib/b2'
import { enqueueNotification } from '@/lib/queue'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import type { TaskStatus } from '@prisma/client'

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

export async function addDeliverable(taskId: string, organizationId: string, name: string) {
  await verifyTaskAccess(taskId, organizationId)
  const position = await prisma.taskDeliverable.count({ where: { taskId } })
  return prisma.taskDeliverable.create({ data: { taskId, name, position } })
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
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
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

  return prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId }, include: { attachment: true } })
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
  if (requirement.status !== 'UPLOADED') {
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
  }

  return updated
}

export async function deliverDocument(
  taskId: string,
  deliverableId: string,
  organizationId: string,
  actor: { id: string },
  payload: UploadPayload,
) {
  await verifyTaskAccess(taskId, organizationId)
  const deliverable = await prisma.taskDeliverable.findFirst({ where: { id: deliverableId, taskId } })
  if (!deliverable) throw new AppError(404, 'Entregável não encontrado')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const attachment = await prisma.attachment.create({
    data: {
      taskId, filename: payload.filename, mimeType: payload.mimeType, size: payload.size, storageKey,
      uploadedBy: actor.id,
    },
  })

  const updated = await prisma.taskDeliverable.update({
    where: { id: deliverableId },
    data: { attachmentId: attachment.id, deliveredById: actor.id, deliveredAt: new Date() },
  })

  await recalculateTaskStatus(taskId)

  return updated
}

export async function recalculateTaskStatus(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      documentRequirements: true,
      deliverables: true,
      recurringTemplate: { select: { autoCompleteOnAllActivitiesDone: true } },
    },
  })

  const hasPendingOrRejected = task.documentRequirements.some((d) => d.status === 'PENDING' || d.status === 'REJECTED')
  const allRequirementsApproved = task.documentRequirements.every((d) => d.status === 'APPROVED')
  const allDeliverablesDone = task.deliverables.every((d) => d.deliveredAt !== null)
  const autoComplete = task.recurringTemplate?.autoCompleteOnAllActivitiesDone ?? false

  let nextStatus: TaskStatus | undefined

  if (hasPendingOrRejected) {
    if (task.status !== 'BLOCKED') nextStatus = 'BLOCKED'
  } else if (autoComplete && allRequirementsApproved && allDeliverablesDone && task.status !== 'DONE') {
    nextStatus = 'DONE'
  } else if (task.status === 'BLOCKED') {
    // Impedimento resolvido (nada mais pendente/rejeitado) — mesmo sem conclusão automática
    // ligada, ou com entregáveis ainda faltando, o status "Com Impedimento" deixou de ser
    // verdade, então volta pra Aberto.
    nextStatus = 'OPEN'
  }

  if (nextStatus && nextStatus !== task.status) {
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: nextStatus } }),
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
  }
}
