import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl, deleteFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

interface UploaderActor {
  id: string
  role: string
}

async function verifyTaskBelongsToOrg(
  taskId: string,
  organizationId: string,
  clientId?: string,
) {
  // For CLIENT role, also restrict to tasks whose board belongs to this client
  const boardWhere = clientId ? { organizationId, clientId } : { organizationId }
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  return task
}

export async function createAttachment(
  taskId: string,
  organizationId: string,
  actor: UploaderActor,
  payload: UploadPayload,
) {
  const isClient = actor.role === 'CLIENT'
  await verifyTaskBelongsToOrg(taskId, organizationId, isClient ? actor.id : undefined)

  const storageKey = `attachments/${organizationId}/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  return prisma.attachment.create({
    data: {
      taskId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: isClient ? undefined : actor.id,
      uploadedByClient: isClient ? actor.id : undefined,
    },
  })
}

export async function listAttachments(
  taskId: string,
  organizationId: string,
  clientId?: string,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId, clientId)

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
      uploadedBy: a.uploadedBy,
      uploadedByClient: a.uploadedByClient,
      uploaderName: a.uploader?.name ?? a.uploaderClient?.name ?? 'Desconhecido',
      signedUrl: await getSignedDownloadUrl(a.storageKey),
      createdAt: a.createdAt,
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
  await verifyTaskBelongsToOrg(taskId, organizationId, isClient ? actor.id : undefined)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId },
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

  // Cliente só pode deletar o próprio anexo
  if (isClient && attachment.uploadedByClient !== actor.id) {
    throw new AppError(403, 'Sem permissão para remover este anexo')
  }

  const actorName = isClient
    ? (await prisma.client.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Cliente'
    : (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Colaborador'

  await deleteFile(attachment.storageKey)

  await prisma.$transaction([
    prisma.attachment.delete({ where: { id: attachmentId } }),
    prisma.taskHistory.create({
      data: {
        taskId,
        action: 'attachment_deleted',
        fromValue: attachment.filename,
        toValue: null,
        actorType: isClient ? 'client' : 'user',
        actorId: actor.id,
        actorName,
      },
    }),
  ])

  return { ok: true }
}
