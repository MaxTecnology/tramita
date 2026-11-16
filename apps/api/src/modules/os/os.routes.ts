import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { openOSSchema, addOSToProcessSchema } from './os.schema'
import { openOS, addOSToProcess } from './os.service'

export async function osRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  const staffWrite = [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription]

  // Standalone OS (client's services board); scope: clients the user reaches, like opening a process
  app.post('/os', { preHandler: staffWrite }, async (request, reply) => {
    const body = openOSSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await openOS(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, body.data))
  })

  app.post('/boards/:id/os', { preHandler: staffWrite }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = addOSToProcessSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await addOSToProcess(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, id, body.data))
  })
}
