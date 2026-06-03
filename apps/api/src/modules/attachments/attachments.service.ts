import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl, deleteFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
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
  uploadedBy: string,
  payload: UploadPayload,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const storageKey = `attachments/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  return prisma.attachment.create({
    data: {
      taskId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy,
    },
  })
}

export async function listAttachments(taskId: string, organizationId: string) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachments = await prisma.attachment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })

  return Promise.all(
    attachments.map(async (a) => ({
      ...a,
      signedUrl: await getSignedDownloadUrl(a.storageKey),
    })),
  )
}

export async function deleteAttachment(
  attachmentId: string,
  taskId: string,
  organizationId: string,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId },
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

  await deleteFile(attachment.storageKey)
  await prisma.attachment.delete({ where: { id: attachmentId } })
  return { ok: true }
}
