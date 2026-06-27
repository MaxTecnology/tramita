import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { approveRequestSchema, rejectRequestSchema, listRequestsQuerySchema } from './requests.schema'
import { listRequestsForOrg, getRequestById, approveRequest, rejectRequest } from './requests.service'

export async function requestsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = listRequestsQuerySchema.safeParse(request.query)
    const query = result.success ? result.data : {}
    return reply.send(await listRequestsForOrg(request.user.organizationId!, query.status))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getRequestById(id, request.user.organizationId!))
  })

  app.post('/:id/approve', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = approveRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
    )
  })

  app.post('/:id/reject', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = rejectRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
  })
}
