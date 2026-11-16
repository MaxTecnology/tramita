import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl } from '@/lib/b2'
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
  // Open = still under evaluation; "needs info" is exactly when the office waits for a file
  if (request.status !== 'PENDING' && request.status !== 'NEEDS_INFO') {
    throw new AppError(422, 'Só é possível enviar anexos enquanto a solicitação está em análise')
  }

  const orgSlug = await getOrgSlug(organizationId)
  const safeFilename = payload.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storageKey = `request-attachments/${orgSlug}/${requestId}/${Date.now()}-${safeFilename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const created = await prisma.requestAttachment.create({
    data: {
      requestId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: clientId,
    },
  })
  return (await presentRequestAttachments([created]))[0]
}

type AttachmentRow = { id: string; filename: string; mimeType: string; size: number; storageKey: string; uploadedBy: string; createdAt: Date }

// What a screen may show of a request file: a temporary download link, never the storage key
export async function presentRequestAttachments(rows: AttachmentRow[]) {
  return Promise.all(rows.map(async ({ storageKey, ...a }) => ({ ...a, url: await getSignedDownloadUrl(storageKey) })))
}
