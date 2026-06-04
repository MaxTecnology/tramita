import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishBoardEvent } from '@/lib/sse'
import { enqueueNotification } from '@/lib/queue'
import type { CreateCommentBody } from './comments.schema'

interface CommentActor {
  id: string
  role: string
  organizationId: string
}

const CAN_SEE_DELETED_CONTENT = new Set(['ORG_ADMIN', 'ORG_MANAGER'])

export async function listComments(taskId: string, organizationId: string, role: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  const comments = await prisma.comment.findMany({
    where: { taskId },
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

export async function createComment(
  taskId: string,
  data: CreateCommentBody,
  actor: CommentActor,
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId: actor.organizationId } } },
    include: { column: { include: { board: { select: { id: true, clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  const isClient = actor.role === 'CLIENT'
  const comment = await prisma.comment.create({
    data: {
      content: data.content,
      taskId,
      authorType: isClient ? 'CLIENT' : 'USER',
      userId: isClient ? undefined : actor.id,
      clientId: isClient ? actor.id : undefined,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  await publishBoardEvent(task.column.board.id, {
    event: 'comment:added',
    data: { taskId, commentId: comment.id },
  })

  const authorName = isClient
    ? (comment.client?.name ?? 'Cliente')
    : (comment.user?.name ?? 'Colaborador')

  await enqueueNotification({
    event: 'TASK_COMMENT_ADDED',
    taskId,
    organizationId: actor.organizationId,
    clientId: task.column.board.clientId,
    metadata: {
      taskTitle: task.title,
      commentText: data.content,
      commentAuthorName: authorName,
    },
  })

  return comment
}

export async function deleteComment(id: string, actor: CommentActor) {
  const comment = await prisma.comment.findFirst({
    where: { id },
    include: {
      task: {
        include: {
          column: { include: { board: { select: { organizationId: true } } } },
        },
      },
    },
  })
  if (!comment) throw new AppError(404, 'Comentário não encontrado')
  if (comment.task.column.board.organizationId !== actor.organizationId) {
    throw new AppError(403, 'Acesso negado')
  }

  const isAuthor =
    (actor.role === 'CLIENT' && comment.clientId === actor.id) ||
    (actor.role !== 'CLIENT' && comment.userId === actor.id)
  const isAdmin = actor.role === 'ORG_ADMIN'

  if (!isAuthor && !isAdmin) throw new AppError(403, 'Sem permissão')

  await prisma.comment.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: actor.id,
      deletedByType: actor.role === 'CLIENT' ? 'CLIENT' : 'USER',
    },
  })

  return { ok: true }
}
