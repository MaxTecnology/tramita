import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createUserSchema, updateUserSchema } from './users.schema'
import { listUsers, createUser, updateUser, deleteUser } from './users.service'

export async function usersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.get('/', async (request, reply) => {
    return reply.send(await listUsers(request.user.organizationId!))
  })

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createUser(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateUser(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteUser(id, request.user.organizationId!))
  })
}
