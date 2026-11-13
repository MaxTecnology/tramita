// apps/api/src/modules/request-comments/request-comments.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { createRequestCommentSchema } from './request-comments.schema'
import { listRequestComments, createRequestComment, deleteRequestComment } from './request-comments.service'
import { assertRequestInStaffScope } from '@/modules/requests/requests.service'
import { getStaffScope } from '@/modules/staff-scope/staff-scope'

export async function requestCommentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  // Office staff only reads and comments on requests within their scope (clients: own check)
  app.addHook('preHandler', async (request) => {
    const { requestId } = request.params as { requestId?: string }
    if (!requestId || (request.user.role !== 'ORG_MEMBER' && request.user.role !== 'ORG_MANAGER')) return
    await assertRequestInStaffScope(requestId, request.user.organizationId!, await getStaffScope(request))
  })

  app.get('/requests/:requestId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string }
    const clientId = request.user.role === 'CLIENT' ? request.user.sub : undefined
    return reply.send(
      await listRequestComments(requestId, request.user.organizationId!, request.user.role, clientId),
    )
  })

  app.post('/requests/:requestId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string }
    const result = createRequestCommentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createRequestComment(requestId, result.data, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      }),
    )
  })

  app.delete('/request-comments/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(
      await deleteRequestComment(id, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      }),
    )
  })
}
