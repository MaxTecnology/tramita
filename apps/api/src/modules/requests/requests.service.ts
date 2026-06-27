import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishOrgEvent } from '@/lib/sse'
import { createBoard } from '@/modules/boards/boards.service'
import { createTask } from '@/modules/tasks/tasks.service'
import type { CreateRequestBody, ApproveRequestBody, RejectRequestBody } from './requests.schema'
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

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

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
  const updated = await prisma.request.update({ where: { id }, data: { status: 'CANCELLED' } })
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}

export async function approveRequest(
  id: string,
  organizationId: string,
  reviewerId: string,
  reviewerRole: string,
  data: ApproveRequestBody,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') throw new AppError(422, 'Solicitação já foi avaliada')

  let columnId: string

  if (data.mode === 'NEW_BOARD') {
    const board = await createBoard(organizationId, reviewerId, reviewerRole, {
      title: request.title,
      clientId: request.clientId,
    })
    columnId = board.columns[0].id
  } else {
    const board = await prisma.board.findFirst({
      where: { id: data.boardId, organizationId, clientId: request.clientId, isActive: true },
    })
    if (!board) throw new AppError(404, 'Processo não encontrado para este cliente')
    const column = await prisma.column.findFirst({ where: { id: data.columnId, boardId: board.id } })
    if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
    columnId = column.id
  }

  const task = await createTask(
    columnId,
    organizationId,
    { title: request.title, description: request.description ?? undefined, priority: 'MEDIUM', tags: [] },
    { id: reviewerId, type: 'user' },
  )

  const [, updatedRequest] = await prisma.$transaction([
    prisma.task.update({ where: { id: task.id }, data: { sourceRequestId: id } }),
    prisma.request.update({
      where: { id },
      data: { status: 'APPROVED', taskId: task.id, reviewedById: reviewerId, reviewedAt: new Date() },
    }),
  ])

  await enqueueNotification({
    event: 'REQUEST_APPROVED',
    organizationId,
    clientId: request.clientId,
    taskId: task.id,
    requestId: id,
    metadata: { requestTitle: request.title },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

  return updatedRequest
}

export async function rejectRequest(
  id: string,
  organizationId: string,
  reviewerId: string,
  data: RejectRequestBody,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') throw new AppError(422, 'Solicitação já foi avaliada')

  const updated = await prisma.request.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectionReason: data.reason,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  })

  await enqueueNotification({
    event: 'REQUEST_REJECTED',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    metadata: { requestTitle: request.title, rejectionReason: data.reason },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

  return updated
}

export async function countPendingRequests(organizationId: string): Promise<number> {
  return prisma.request.count({ where: { organizationId, status: 'PENDING' } })
}
