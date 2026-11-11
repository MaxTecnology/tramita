import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishOrgEvent, publishBoardEvent } from '@/lib/sse'
import { createBoard } from '@/modules/boards/boards.service'
import { createTask } from '@/modules/tasks/tasks.service'
import { assertDepartmentServesClient } from '@/modules/clients/client-coverage'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import type { CreateRequestBody, ApproveRequestBody, RejectRequestBody } from './requests.schema'
import type { RequestStatus } from '@prisma/client'

const CANCELLABLE_BY_CLIENT: RequestStatus[] = ['PENDING', 'NEEDS_INFO']
const REVIEWABLE: RequestStatus[] = ['PENDING', 'NEEDS_INFO']

function withBoardId<T extends { task: { column: { boardId: string } } | null }>(
  row: T,
): Omit<T, 'task'> & { boardId: string | null } {
  const { task, ...rest } = row
  return { ...rest, boardId: task?.column.boardId ?? null }
}

export async function createRequest(
  organizationId: string,
  clientId: string,
  clientUserId: string,
  data: Omit<CreateRequestBody, 'clientId'>,
) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')
  await assertDepartmentBelongsToOrg(data.departmentId, organizationId)

  // I6: solicitação só em departamento ao qual o usuário do cliente tem acesso naquela empresa
  // (acesso só existe em departamento atendido — I3 —, então o departamento também atende o cliente).
  const access = await prisma.clientUserAccess.findFirst({
    where: { clientUserId, clientId, departmentId: data.departmentId, clientUser: { isActive: true } },
    select: { id: true },
  })
  if (!access) throw new AppError(403, 'Você não tem acesso a este departamento')

  const request = await prisma.request.create({
    data: {
      organizationId,
      clientId,
      title: data.title,
      description: data.description,
      departmentId: data.departmentId,
      osTemplateId: data.osTemplateId,
    },
  })

  // Notifica o responsável do departamento da solicitação (ClientAssignment). Sem fallback pra
  // admins/gerentes: todo departamento que atende o cliente tem responsável (I2).
  const recipientIds = (await prisma.clientAssignment.findMany({
    where: { clientId, departmentId: request.departmentId },
    select: { userId: true },
  })).map((a) => a.userId)

  await Promise.all(
    recipientIds.map((userId) =>
      enqueueNotification({
        event: 'REQUEST_CREATED',
        organizationId,
        recipientType: 'USER',
        userId,
        requestId: request.id,
        metadata: { clientName: client.name, requestTitle: request.title },
      }),
    ),
  )

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

  return request
}

export async function listRequestsForOrg(organizationId: string, status?: RequestStatus) {
  const requests = await prisma.request.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    include: {
      client: { select: { id: true, name: true } },
      task: { select: { column: { select: { boardId: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return requests.map(withBoardId)
}

export async function listRequestsForClient(organizationId: string, clientId: string, departmentIds?: string[]) {
  const requests = await prisma.request.findMany({
    where: { organizationId, clientId, ...(departmentIds ? { departmentId: { in: departmentIds } } : {}) },
    include: { task: { select: { column: { select: { boardId: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  return requests.map(withBoardId)
}

async function getRequestOrThrow(id: string, organizationId: string, clientId?: string) {
  const request = await prisma.request.findFirst({
    where: { id, organizationId, ...(clientId ? { clientId } : {}) },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  return request
}

export async function getRequestById(id: string, organizationId: string, clientId?: string) {
  const request = await prisma.request.findFirst({
    where: { id, organizationId, ...(clientId ? { clientId } : {}) },
    include: { task: { select: { column: { select: { boardId: true } } } } },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  const attachments = await prisma.requestAttachment.findMany({
    where: { requestId: id },
    orderBy: { createdAt: 'asc' },
  })
  return { ...withBoardId(request), attachments }
}

export async function cancelRequest(id: string, organizationId: string, clientId: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  if (!CANCELLABLE_BY_CLIENT.includes(request.status)) {
    throw new AppError(422, 'Essa solicitação não pode mais ser cancelada por aqui — fale com o escritório')
  }
  const updated = await prisma.request.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledByType: 'CLIENT', cancelledById: clientId },
  })
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}

export async function markNeedsInfo(id: string, organizationId: string, staffId: string, comment: string) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') {
    throw new AppError(422, 'Só solicitações pendentes podem ser marcadas como "precisa de mais informação"')
  }

  const [updated] = await prisma.$transaction([
    prisma.request.update({ where: { id }, data: { status: 'NEEDS_INFO' } }),
    prisma.requestComment.create({
      data: { content: comment, requestId: id, authorType: 'USER', userId: staffId },
    }),
  ])

  await enqueueNotification({
    event: 'REQUEST_NEEDS_INFO',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    metadata: { requestTitle: request.title, commentText: comment },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}

export async function cancelApprovedRequest(
  id: string,
  organizationId: string,
  staffId: string,
  reason: string,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'APPROVED') throw new AppError(422, 'Só solicitações aprovadas podem ser canceladas por este caminho')
  if (!request.taskId) throw new AppError(422, 'Solicitação aprovada sem tarefa associada — estado inconsistente')

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: request.taskId },
    include: { column: { select: { boardId: true } } },
  })

  const [historyCount, commentCount, attachmentCount, requirementCount, deliverableCount] = await Promise.all([
    prisma.taskHistory.count({ where: { taskId: request.taskId, action: { not: 'created' } } }),
    prisma.comment.count({ where: { taskId: request.taskId } }),
    prisma.attachment.count({ where: { taskId: request.taskId } }),
    // Mesmo furo do gate em regenerateTask (recurring-templates.service.ts): checklist de
    // documentos a cobrar/entregáveis configurados via Template de OS também conta como
    // "a tarefa já foi preparada", não só histórico/comentário/anexo.
    prisma.taskDocumentRequirement.count({ where: { taskId: request.taskId } }),
    prisma.taskDeliverable.count({ where: { taskId: request.taskId } }),
  ])
  if (historyCount > 0 || commentCount > 0 || attachmentCount > 0 || requirementCount > 0 || deliverableCount > 0) {
    throw new AppError(409, 'Essa tarefa já teve movimentação — não pode ser cancelada por este caminho')
  }

  const staffUser = await prisma.user.findUnique({ where: { id: staffId }, select: { name: true } })

  const [, , updated] = await prisma.$transaction([
    prisma.task.update({ where: { id: request.taskId }, data: { status: 'DISREGARDED' } }),
    // Mesma regra de updateTask/moveTask em tasks.service.ts: toda mudança real de status grava
    // status_changed — sem isso, Métricas de Produtividade (que lê esse histórico) nunca saberia
    // quando essa tarefa saiu do fluxo.
    prisma.taskHistory.create({
      data: {
        taskId: request.taskId,
        action: 'status_changed',
        fromValue: task.status,
        toValue: 'DISREGARDED',
        actorType: 'user',
        actorId: staffId,
        actorName: staffUser?.name ?? 'Unknown',
      },
    }),
    prisma.request.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledByType: 'USER',
        cancelledById: staffId,
        cancellationReason: reason,
      },
    }),
  ])

  // Board com essa tarefa pode estar aberto em outra aba — sem isso, quem está olhando o board
  // só veria a tarefa sair do status ao recarregar a página.
  await publishBoardEvent(task.column.boardId, {
    event: 'task:updated',
    data: { taskId: request.taskId },
  })

  await enqueueNotification({
    event: 'REQUEST_CANCELLED',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    // rejectionReason é o nome de variável genérico de template.ts pra "motivo exibido ao
    // cliente" — reaproveitado aqui (não é uma rejeição, é o motivo do cancelamento) em vez de
    // criar uma TemplateVar nova só pra este evento.
    metadata: { requestTitle: request.title, rejectionReason: reason },
  })

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
  if (!REVIEWABLE.includes(request.status)) throw new AppError(422, 'Solicitação já foi avaliada')

  let columnId: string

  if (data.mode === 'NEW_BOARD') {
    const client = await prisma.client.findFirst({ where: { id: request.clientId, organizationId } })
    const titlePrefix = client?.codigo ? `${client.codigo} - ${client.name}` : client?.name
    const osTemplate = request.osTemplateId
      ? await prisma.oSTemplate.findFirst({ where: { id: request.osTemplateId, organizationId } })
      : null

    const board = await createBoard(organizationId, reviewerId, reviewerRole, {
      title: osTemplate ? `${titlePrefix} — ${osTemplate.name}` : request.title,
      clientId: request.clientId,
      osTemplateId: request.osTemplateId ?? undefined,
    })
    columnId = board.columns[0].id
  } else {
    const board = await prisma.board.findFirst({
      where: { id: data.boardId, organizationId, clientId: request.clientId, isActive: true, type: 'OS' },
    })
    if (!board) throw new AppError(404, 'Processo não encontrado para este cliente')
    const column = await prisma.column.findFirst({ where: { id: data.columnId, boardId: board.id } })
    if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
    columnId = column.id
  }

  const departmentId = request.departmentId
  try {
    await assertDepartmentServesClient(prisma, request.clientId, departmentId)
  } catch (err) {
    if (!(err instanceof AppError)) throw err
    const [department, client] = await Promise.all([
      prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } }),
      prisma.client.findUnique({ where: { id: request.clientId }, select: { name: true } }),
    ])
    throw new AppError(
      409,
      `O departamento ${department?.name ?? ''} não atende mais o cliente ${client?.name ?? ''}. Ajuste o cadastro do cliente antes de aprovar.`,
    )
  }

  const task = await createTask(
    columnId,
    organizationId,
    {
      title: request.title,
      description: request.description ?? undefined,
      priority: 'MEDIUM',
      tags: [],
      departmentId,
    },
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
  if (!REVIEWABLE.includes(request.status)) throw new AppError(422, 'Solicitação já foi avaliada')

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
