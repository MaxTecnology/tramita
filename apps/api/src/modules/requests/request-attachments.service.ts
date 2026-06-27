import { prisma } from '@/lib/prisma'
import { uploadFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  })
  return org?.slug ?? organizationId
}

export async function createRequestAttachment(
  requestId: string,
  organizationId: string,
  clientId: string,
  payload: UploadPayload,
) {
  const request = await prisma.request.findFirst({
    where: { id: requestId, organizationId, clientId },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  if (request.status !== 'PENDING') {
    throw new AppError(422, 'Só é possível enviar anexos enquanto a solicitação está pendente')
  }

  const orgSlug = await getOrgSlug(organizationId)
  const safeFilename = payload.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storageKey = `request-attachments/${orgSlug}/${requestId}/${Date.now()}-${safeFilename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  return prisma.requestAttachment.create({
    data: {
      requestId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: clientId,
    },
  })
}
