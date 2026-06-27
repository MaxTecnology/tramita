import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { verifyAccessToken } from '@/lib/jwt'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import { approveRequestSchema, rejectRequestSchema, listRequestsQuerySchema } from './requests.schema'
import {
  listRequestsForOrg,
  getRequestById,
  approveRequest,
  rejectRequest,
  countPendingRequests,
} from './requests.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function requestsRoutes(app: FastifyInstance) {
  // /stream fica fora do hook global de verifyJWT — autentica via query param,
  // igual ao padrão de /boards/:id/stream (EventSource não manda headers customizados)
  app.get('/stream', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) throw new AppError(401, 'Token não fornecido')

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      throw new AppError(401, 'Token inválido ou expirado')
    }

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
      return reply.send(await listRequestsForOrg(request.user.organizationId!, query.status))
    })

    authed.get('/pending-count', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const count = await countPendingRequests(request.user.organizationId!)
      return reply.send({ count })
    })

    authed.get('/:id', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      return reply.send(await getRequestById(id, request.user.organizationId!))
    })

    authed.post('/:id/approve', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = approveRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
      )
    })

    authed.post('/:id/reject', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = rejectRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
    })
  })
}
