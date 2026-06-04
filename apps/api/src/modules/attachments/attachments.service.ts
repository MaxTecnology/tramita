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

async function verifyTaskBelongsToOrg(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
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
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const storageKey = `attachments/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const isClient = actor.role === 'CLIENT'

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

export async function listAttachments(taskId: string, organizationId: string) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

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
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId },
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

  // Cliente só pode deletar o próprio anexo
  if (actor.role === 'CLIENT' && attachment.uploadedByClient !== actor.id) {
    throw new AppError(403, 'Sem permissão para remover este anexo')
  }

  await deleteFile(attachment.storageKey)
  await prisma.attachment.delete({ where: { id: attachmentId } })
  return { ok: true }
}
