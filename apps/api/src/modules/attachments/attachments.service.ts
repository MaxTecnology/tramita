import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl, deleteFile } from '@/lib/b2'
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

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  })
  return org?.slug ?? organizationId
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
  const storageKey = `attachments/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
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
    },
  })

  return Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      uploaderName: a.uploader?.name ?? a.uploaderClient?.name ?? 'Desconhecido',
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
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

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
        deletedByClient: isClient ? actor.id : undefined,
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
