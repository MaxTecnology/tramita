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

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `request-attachments/${orgSlug}/${requestId}/${Date.now()}-${payload.filename}`
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
