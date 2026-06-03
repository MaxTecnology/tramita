import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishBoardEvent } from '@/lib/sse'
import type { CreateCommentBody } from './comments.schema'

interface CommentActor {
  id: string
  role: string
  organizationId: string
}

export async function listComments(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })
}

export async function createComment(
  taskId: string,
  data: CreateCommentBody,
  actor: CommentActor,
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId: actor.organizationId } } },
    include: { column: { include: { board: { select: { id: true } } } } },
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

  await prisma.comment.delete({ where: { id } })
  return { ok: true }
}
