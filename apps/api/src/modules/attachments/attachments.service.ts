import { storageSafeName } from '@/lib/upload-policy'
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl, deleteFile } from '@/lib/b2'
import { getOrgSlug } from '@/lib/org-slug'
import { AppError } from '@/errors/AppError'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

interface UploaderActor {
  // For role === 'CLIENT' this is a ClientUser id, not a Client id — a ClientUser may have
  // access to more than one company, so resolving the actual company always goes through
  // `getClientAccessScope`.
  id: string
  role: string
}

async function verifyTaskBelongsToOrg(
  taskId: string,
  organizationId: string,
  clientUserId?: string,
) {
  const scope = clientUserId ? await getClientAccessScope(clientUserId) : undefined
  const boardWhere = scope ? { organizationId, clientId: { in: scope.clientIds } } : { organizationId }
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  // Cliente não pode ver/anexar/apagar anexos de uma tarefa não-visível ou fora do
  // departamento a que tem acesso, mesmo já sabendo o id dela — mesmo gate usado em
  // task-documents.service.ts::verifyTaskAccess e comments.service.ts.
  if (scope && (!task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId))) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task // task.column.board.clientId is the resolved company id
}

async function resolveActorName(actor: UploaderActor): Promise<string> {
  if (actor.role === 'CLIENT') {
    return (await prisma.clientUser.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Cliente'
  }
  return (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Colaborador'
}

export async function createAttachment(
  taskId: string,
  organizationId: string,
  actor: UploaderActor,
  payload: UploadPayload,
) {
  const isClient = actor.role === 'CLIENT'
  const task = await verifyTaskBelongsToOrg(taskId, organizationId, isClient ? actor.id : undefined)
  const resolvedClientId = task.column.board.clientId

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `attachments/${orgSlug}/${taskId}/${Date.now()}-${storageSafeName(payload.filename)}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const actorName = await resolveActorName(actor)

  const [attachment] = await prisma.$transaction([
    prisma.attachment.create({
      data: {
        taskId,
        filename: payload.filename,
        mimeType: payload.mimeType,
        size: payload.size,
        storageKey,
        uploadedBy: isClient ? undefined : actor.id,
        uploadedByClient: isClient ? resolvedClientId : undefined,
      },
    }),
    prisma.taskHistory.create({
      data: {
        taskId,
        action: 'attachment_added',
        toValue: payload.filename,
        actorType: isClient ? 'client' : 'user',
        actorId: actor.id,
        actorName,
      },
    }),
  ])

  return attachment
}

// What a file was for and how it ended — the "Anexos" tab tells the document trail at a glance
type PurposeSource = {
  id: string
  reviewStatus: string | null
  rejectionReason: string | null
  reviewedAt: Date | null
  reviewedBy: { name: string } | null
  requirement: { name: string; attachmentId: string | null } | null
  deliverable: { name: string } | null
  approvalFileOf: { title: string; status: string } | null
  approvalProofOf: { title: string } | null
  protocol: { title: string } | null
}

function attachmentPurpose(a: PurposeSource) {
  if (a.requirement) {
    return {
      kind: 'REQUIREMENT' as const, name: a.requirement.name, review: a.reviewStatus, rejectionReason: a.rejectionReason,
      reviewedByName: a.reviewedBy?.name ?? null, reviewedAt: a.reviewedAt, current: a.requirement.attachmentId === a.id,
    }
  }
  if (a.deliverable) return { kind: 'DELIVERABLE' as const, name: a.deliverable.name }
  if (a.approvalFileOf) return { kind: 'APPROVAL_FILE' as const, name: a.approvalFileOf.title, review: a.approvalFileOf.status }
  if (a.approvalProofOf) return { kind: 'APPROVAL_PROOF' as const, name: a.approvalProofOf.title }
  if (a.protocol) return { kind: 'PROTOCOL' as const, name: a.protocol.title }
  return null
}

export async function listAttachments(
  taskId: string,
  organizationId: string,
  clientUserId?: string,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId, clientUserId)

  const attachments = await prisma.attachment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: {
      uploader: { select: { name: true } },
      uploaderClient: { select: { name: true } },
      uploaderClientUser: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      requirement: { select: { name: true, attachmentId: true } },
      deliverable: { select: { name: true } },
      approvalFileOf: { select: { title: true, status: true } },
      approvalProofOf: { select: { title: true } },
      protocol: { select: { title: true } },
    },
  })

  return Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      // The person who sent it; for the client, the person and the company ("RH (ACME)")
      uploaderName: a.uploader?.name
        ?? (a.uploaderClientUser ? `${a.uploaderClientUser.name}${a.uploaderClient ? ` (${a.uploaderClient.name})` : ''}` : a.uploaderClient?.name)
        ?? 'Desconhecido',
      purpose: attachmentPurpose(a),
      createdAt: a.createdAt,
      deletedAt: a.deletedAt,
      deletedByName: a.deletedByName,
      // Signed URL only for active attachments — file is removed from B2 on delete
      signedUrl: a.deletedAt ? null : await getSignedDownloadUrl(a.storageKey),
    })),
  )
}

export async function deleteAttachment(
  attachmentId: string,
  taskId: string,
  organizationId: string,
  actor: UploaderActor,
) {
  const isClient = actor.role === 'CLIENT'
  const task = await verifyTaskBelongsToOrg(taskId, organizationId, isClient ? actor.id : undefined)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId, deletedAt: null },
    include: { approvalFileOf: { select: { id: true } }, approvalProofOf: { select: { id: true } } },
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')
  // It is the record of a client approval (file sent or proof of the outside approval)
  if (attachment.approvalFileOf || attachment.approvalProofOf) {
    throw new AppError(409, 'Esse arquivo faz parte de uma aprovação do cliente e não pode ser removido')
  }

  // An attachment uploaded by "the client" is attributed to the company, not to a single
  // ClientUser — any ClientUser with access to that company (and department, enforced above
  // by verifyTaskBelongsToOrg) counts as the author for permission purposes (matches the
  // pre-existing single-shared-login behavior — see comments.service.ts::deleteComment).
  if (isClient && attachment.uploadedByClient !== task.column.board.clientId) {
    throw new AppError(403, 'Sem permissão para remover este anexo')
  }

  const actorName = await resolveActorName(actor)

  await deleteFile(attachment.storageKey)

  await prisma.$transaction([
    prisma.attachment.update({
      where: { id: attachmentId },
      data: {
        deletedAt: new Date(),
        deletedBy: isClient ? undefined : actor.id,
        // Same rule as uploadedByClient: authorship for a CLIENT actor is attributed to the
        // company (Client.id), not the individual ClientUser.id.
        deletedByClient: isClient ? task.column.board.clientId : undefined,
        deletedByName: actorName,
      },
    }),
    prisma.taskHistory.create({
      data: {
        taskId,
        action: 'attachment_deleted',
        fromValue: attachment.filename,
        actorType: isClient ? 'client' : 'user',
        actorId: actor.id,
        actorName,
      },
    }),
  ])

  return { ok: true }
}
