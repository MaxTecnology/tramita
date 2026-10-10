// apps/api/src/modules/request-comments/request-comments.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishOrgEvent } from '@/lib/sse'
import { enqueueNotification } from '@/lib/queue'
import { getClientAccessScope } from '@/modules/client-users/client-access'
import type { CreateRequestCommentBody } from './request-comments.schema'

interface CommentActor {
  // For role === 'CLIENT' this is a ClientUser id, not a Client id — resolving the actual
  // company always goes through getClientAccessScope, same convention as comments.service.ts.
  id: string
  role: string
  organizationId: string
}

const CAN_SEE_DELETED_CONTENT = new Set(['ORG_ADMIN', 'ORG_MANAGER'])

export async function listRequestComments(
  requestId: string,
  organizationId: string,
  role: string,
  clientUserId?: string,
) {
  const scope = role === 'CLIENT' && clientUserId ? await getClientAccessScope(clientUserId) : null

  const request = await prisma.request.findFirst({ where: { id: requestId, organizationId } })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  if (scope && !scope.clientIds.includes(request.clientId)) {
    throw new AppError(404, 'Solicitação não encontrada')
  }

  const comments = await prisma.requestComment.findMany({
    where: { requestId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  const canSeeDeleted = CAN_SEE_DELETED_CONTENT.has(role)

  return comments.map((c) => {
    if (!c.deletedAt) return c
    return {
      ...c,
      content: null,
      ...(canSeeDeleted ? { deletedContent: c.content } : {}),
    }
  })
}

export async function createRequestComment(
  requestId: string,
  data: CreateRequestCommentBody,
  actor: CommentActor,
) {
  const isClient = actor.role === 'CLIENT'
  const scope = isClient ? await getClientAccessScope(actor.id) : null

  const request = await prisma.request.findFirst({ where: { id: requestId, organizationId: actor.organizationId } })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  if (isClient && !scope!.clientIds.includes(request.clientId)) {
    throw new AppError(404, 'Solicitação não encontrada')
  }

  const comment = await prisma.requestComment.create({
    data: {
      content: data.content,
      requestId,
      authorType: isClient ? 'CLIENT' : 'USER',
      userId: isClient ? undefined : actor.id,
      clientId: isClient ? request.clientId : undefined,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  // Comentário do CLIENTE enquanto a solicitação está em NEEDS_INFO reabre a fila de triagem
  // automaticamente — comentário da equipe nunca reverte (ela pode responder livremente sem
  // tirar a request do estado de espera). updateMany com status no WHERE (em vez de update
  // incondicional guiado pela leitura em `request.status` acima) evita a corrida em que um
  // approve/reject concorrente já mudou o status real entre essa leitura e esta escrita —
  // o WHERE só casa se a request ainda estiver NEEDS_INFO no momento exato da escrita.
  if (isClient) {
    await prisma.request.updateMany({ where: { id: requestId, status: 'NEEDS_INFO' }, data: { status: 'PENDING' } })
  }

  await publishOrgEvent(actor.organizationId, { event: 'request:changed', data: {} })

  const authorName = isClient
    ? (comment.client?.name ?? 'Cliente')
    : (comment.user?.name ?? 'Colaborador')

  if (isClient) {
    const assignments = await prisma.clientAssignment.findMany({
      where: request.departmentId
        ? { clientId: request.clientId, departmentId: request.departmentId }
        : { clientId: request.clientId },
      select: { userId: true },
    })
    const recipientIds = assignments.length > 0
      ? assignments.map((a) => a.userId)
      : await prisma.user.findMany({
          where: { organizationId: actor.organizationId, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
          select: { id: true },
        }).then((users) => users.map((u) => u.id))

    await Promise.all(
      recipientIds.map((userId) =>
        enqueueNotification({
          event: 'REQUEST_COMMENT_ADDED',
          organizationId: actor.organizationId,
          recipientType: 'USER',
          userId,
          requestId,
          metadata: {
            requestTitle: request.title,
            commentText: data.content,
            commentAuthorName: authorName,
          },
        }),
      ),
    )
  } else {
    await enqueueNotification({
      event: 'REQUEST_COMMENT_ADDED',
      organizationId: actor.organizationId,
      clientId: request.clientId,
      requestId,
      metadata: {
        requestTitle: request.title,
        commentText: data.content,
        commentAuthorName: authorName,
      },
    })
  }

  return comment
}

export async function deleteRequestComment(id: string, actor: CommentActor) {
  const comment = await prisma.requestComment.findFirst({
    where: { id },
    include: { request: { select: { organizationId: true, clientId: true } } },
  })
  if (!comment) throw new AppError(404, 'Comentário não encontrado')
  if (comment.deletedAt) throw new AppError(410, 'Comentário já foi removido')
  if (comment.request.organizationId !== actor.organizationId) throw new AppError(403, 'Acesso negado')

  if (actor.role === 'CLIENT') {
    const scope = await getClientAccessScope(actor.id)
    if (!scope.clientIds.includes(comment.request.clientId)) {
      throw new AppError(404, 'Comentário não encontrado')
    }
  }

  const isAuthor =
    (actor.role === 'CLIENT' && comment.clientId === comment.request.clientId) ||
    (actor.role !== 'CLIENT' && comment.userId === actor.id)
  const isAdmin = actor.role === 'ORG_ADMIN' || actor.role === 'ORG_MANAGER'

  if (!isAuthor && !isAdmin) throw new AppError(403, 'Sem permissão')

  await prisma.requestComment.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: actor.role === 'CLIENT' ? comment.request.clientId : actor.id,
      deletedByType: actor.role === 'CLIENT' ? 'CLIENT' : 'USER',
    },
  })

  return { ok: true }
}
