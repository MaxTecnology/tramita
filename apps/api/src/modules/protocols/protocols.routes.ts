// apps/api/src/modules/protocols/protocols.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createProtocolSchema, listProtocolsQuerySchema } from './protocols.schema'
import {
  createProtocol, listProtocolsForOrg, listProtocolsForTask, getProtocolById,
  getProtocolsSummary, buildProtocolReceiptHtml,
} from './protocols.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function protocolsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.post('/tasks/:taskId/protocols', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createProtocolSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const { dueDate, ...rest } = result.data
    return reply.status(201).send(
      await createProtocol(taskId, request.user.organizationId!, request.user.sub, {
        ...rest,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      }),
    )
  })

  app.get('/tasks/:taskId/protocols', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listProtocolsForTask(taskId, request.user.organizationId!))
  })

  app.get('/protocols/summary', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    return reply.send(await getProtocolsSummary(request.user.organizationId!))
  })

  app.get('/protocols', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const result = listProtocolsQuerySchema.safeParse(request.query)
    const query = result.success ? result.data : {}
    return reply.send(await listProtocolsForOrg(request.user.organizationId!, {
      status: query.status,
      clientId: query.clientId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }))
  })

  app.get('/protocols/:id', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getProtocolById(id, request.user.organizationId!))
  })

  app.get('/protocols/:id/receipt', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const protocol = await getProtocolById(id, request.user.organizationId!)
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(buildProtocolReceiptHtml(protocol))
  })
}
