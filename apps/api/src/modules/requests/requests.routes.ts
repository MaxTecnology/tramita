import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { consumeStreamTicket } from '@/modules/stream/stream-ticket'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import {
  approveRequestSchema, rejectRequestSchema, listRequestsQuerySchema,
  needsInfoRequestSchema, cancelApprovedRequestSchema,
} from './requests.schema'
import {
  listRequestsForOrg,
  getRequestById,
  approveRequest,
  rejectRequest,
  markNeedsInfo,
  cancelApprovedRequest,
  countPendingRequests,
  assertRequestInStaffScope,
} from './requests.service'
import { getStaffScope } from '@/modules/staff-scope/staff-scope'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function requestsRoutes(app: FastifyInstance) {
  // /stream fica fora do hook global de verifyJWT — autentica via ticket de uso único
  // (POST /stream/ticket), igual a /boards/:id/stream (EventSource não manda headers)
  app.get('/stream', async (request, reply) => {
    const { ticket } = request.query as { ticket?: string }
    const user = await consumeStreamTicket(ticket)

    if (!ORG_ROLES.includes(user.role as typeof ORG_ROLES[number]) || !user.organizationId) {
      throw new AppError(403, 'Acesso negado')
    }

    attachSSESubscriber(request, reply, `org:${user.organizationId}:requests`)
  })

  app.register(async (authed) => {
    authed.addHook('preHandler', verifyJWT)

    authed.get('/', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const result = listRequestsQuerySchema.safeParse(request.query)
      const query = result.success ? result.data : {}
      const scope = await getStaffScope(request)
      return reply.send(await listRequestsForOrg(request.user.organizationId!, {
        status: query.status, scope, userId: request.user.sub, view: query.scope,
      }))
    })

    authed.get('/pending-count', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const count = await countPendingRequests(request.user.organizationId!, await getStaffScope(request))
      return reply.send({ count })
    })

    authed.get('/:id', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      await assertRequestInStaffScope(id, request.user.organizationId!, await getStaffScope(request))
      return reply.send(await getRequestById(id, request.user.organizationId!))
    })

    authed.post('/:id/approve', {
      preHandler: [requireRole(...ORG_ROLES), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      await assertRequestInStaffScope(id, request.user.organizationId!, await getStaffScope(request))
      const result = approveRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
      )
    })

    authed.post('/:id/reject', {
      preHandler: [requireRole(...ORG_ROLES), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      await assertRequestInStaffScope(id, request.user.organizationId!, await getStaffScope(request))
      const result = rejectRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
    })

    authed.post('/:id/needs-info', {
      preHandler: [requireRole(...ORG_ROLES), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      await assertRequestInStaffScope(id, request.user.organizationId!, await getStaffScope(request))
      const result = needsInfoRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await markNeedsInfo(id, request.user.organizationId!, request.user.sub, result.data.comment),
      )
    })

    authed.post('/:id/cancel', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      await assertRequestInStaffScope(id, request.user.organizationId!, await getStaffScope(request))
      const result = cancelApprovedRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await cancelApprovedRequest(id, request.user.organizationId!, request.user.sub, result.data.reason),
      )
    })
  })
}
