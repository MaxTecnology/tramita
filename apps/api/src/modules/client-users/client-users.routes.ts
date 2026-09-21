import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createClientUserSchema, updateClientUserSchema } from './client-users.schema'
import { listClientUsers, getClientUserById, createClientUser, updateClientUser, deleteClientUser } from './client-users.service'

export async function clientUsersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN', 'ORG_MANAGER'))

  app.get('/', async (request, reply) => {
    return reply.send(await listClientUsers(request.user.organizationId!))
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getClientUserById(id, request.user.organizationId!))
  })

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createClientUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createClientUser(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateClientUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClientUser(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteClientUser(id, request.user.organizationId!))
  })
}
