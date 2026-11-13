import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { staffScope, param, assertStaffSees } from '@/middlewares/staffScope'
import { getStaffScope } from '@/modules/staff-scope/staff-scope'
import { AppError } from '@/errors/AppError'
import { createCommentSchema } from './comments.schema'
import { listComments, createComment, deleteComment, getCommentTaskId } from './comments.service'

export async function commentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', staffScope((r) => ({ taskIds: param(r, 'taskId') }), 'read'))

  app.get('/tasks/:taskId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const clientId = request.user.role === 'CLIENT' ? request.user.sub : undefined
    return reply.send(
      await listComments(taskId, request.user.organizationId!, request.user.role, clientId)
    )
  })

  app.post('/tasks/:taskId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createCommentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createComment(taskId, result.data, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      })
    )
  })

  app.delete('/comments/:id', {
    preHandler: [
      requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT'),
      // Moderating comments stays within the staff scope of the comment's task
      async (request) => {
        if (request.user.role !== 'ORG_MANAGER' && request.user.role !== 'ORG_MEMBER') return
        const { id } = request.params as { id: string }
        const taskId = await getCommentTaskId(id)
        if (!taskId) return
        await assertStaffSees(await getStaffScope(request), request.user.organizationId ?? '', { taskIds: [taskId] }, 'read')
      },
    ],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(
      await deleteComment(id, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      })
    )
  })
}
