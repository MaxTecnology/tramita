import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { AppError } from '@/errors/AppError'
import { createCommentSchema } from './comments.schema'
import { listComments, createComment, deleteComment } from './comments.service'

export async function commentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/tasks/:taskId/comments', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listComments(taskId, request.user.organizationId!))
  })

  app.post('/tasks/:taskId/comments', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createCommentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = {
      id: request.user.sub,
      role: request.user.role,
      organizationId: request.user.organizationId!,
    }
    return reply.status(201).send(await createComment(taskId, result.data, actor))
  })

  app.delete('/comments/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const actor = {
      id: request.user.sub,
      role: request.user.role,
      organizationId: request.user.organizationId!,
    }
    return reply.status(204).send(await deleteComment(id, actor))
  })
}
