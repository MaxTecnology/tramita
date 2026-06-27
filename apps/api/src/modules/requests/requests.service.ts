import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import type { CreateRequestBody } from './requests.schema'
import type { RequestStatus } from '@prisma/client'

export async function createRequest(
  organizationId: string,
  clientId: string,
  data: CreateRequestBody,
) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const request = await prisma.request.create({
    data: { organizationId, clientId, title: data.title, description: data.description },
  })

  const admins = await prisma.user.findMany({
    where: { organizationId, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
  })

  await Promise.all(
    admins.map((admin) =>
      enqueueNotification({
        event: 'REQUEST_CREATED',
        organizationId,
        recipientType: 'USER',
        userId: admin.id,
        requestId: request.id,
        metadata: { clientName: client.name, requestTitle: request.title },
      }),
    ),
  )

  return request
}

export async function listRequestsForOrg(organizationId: string, status?: RequestStatus) {
  return prisma.request.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function listRequestsForClient(organizationId: string, clientId: string) {
  return prisma.request.findMany({
    where: { organizationId, clientId },
    orderBy: { createdAt: 'desc' },
  })
}

async function getRequestOrThrow(id: string, organizationId: string, clientId?: string) {
  const request = await prisma.request.findFirst({
    where: { id, organizationId, ...(clientId ? { clientId } : {}) },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  return request
}

export async function getRequestById(id: string, organizationId: string, clientId?: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  const attachments = await prisma.requestAttachment.findMany({
    where: { requestId: id },
    orderBy: { createdAt: 'asc' },
  })
  return { ...request, attachments }
}

export async function cancelRequest(id: string, organizationId: string, clientId: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  if (request.status !== 'PENDING') {
    throw new AppError(422, 'Apenas solicitações pendentes podem ser canceladas')
  }
  return prisma.request.update({ where: { id }, data: { status: 'CANCELLED' } })
}
