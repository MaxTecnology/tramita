import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'
import { createDelayReasonSchema, updateDelayReasonSchema, setDelayReasonSchema } from './delay-reasons.schema'
import { listDelayReasons, createDelayReason, updateDelayReason, deleteDelayReason, setTaskDelayReason, setBoardDelayReason } from './delay-reasons.service'

export async function delayReasonsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  const staff = [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')]
  const adminOnly = [requireRole('ORG_ADMIN'), checkSubscription]
  const actorOf = async (userId: string) => ({ id: userId, name: (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'Escritório' })

  app.get('/delay-reasons', { preHandler: staff }, async (request) => listDelayReasons(request.user.organizationId!))

  app.post('/delay-reasons', { preHandler: adminOnly }, async (request, reply) => {
    const body = createDelayReasonSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await createDelayReason(request.user.organizationId!, body.data))
  })

  app.patch('/delay-reasons/:id', { preHandler: adminOnly }, async (request) => {
    const { id } = request.params as { id: string }
    const body = updateDelayReasonSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return updateDelayReason(id, request.user.organizationId!, body.data)
  })

  app.delete('/delay-reasons/:id', { preHandler: adminOnly }, async (request) => {
    const { id } = request.params as { id: string }
    return deleteDelayReason(id, request.user.organizationId!)
  })

  app.patch('/tasks/:id/delay-reason', { preHandler: [...staff, checkSubscription] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = setDelayReasonSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return setTaskDelayReason(id, request.user.organizationId!, body.data, await actorOf(request.user.sub))
  })

  app.patch('/boards/:id/delay-reason', { preHandler: [...staff, checkSubscription] }, async (request) => {
    const { id } = request.params as { id: string }
    const body = setDelayReasonSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return setBoardDelayReason(id, request.user.organizationId!, body.data, await actorOf(request.user.sub))
  })
}
