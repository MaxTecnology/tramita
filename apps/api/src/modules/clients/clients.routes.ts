import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { checkPlanLimit } from '@/middlewares/checkPlanLimit'
import { AppError } from '@/errors/AppError'
import { createClientSchema, updateClientSchema, listClientsQuerySchema } from './clients.schema'
import { listClients, createClient, updateClient, deleteClient } from './clients.service'

export async function clientsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // ORG_MEMBER pode ler clientes (para usar no modal de criação de board)
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { includeInactive } = listClientsQuerySchema.parse(request.query)
    return reply.send(await listClients(request.user.organizationId!, includeInactive))
  })

  // Apenas Admin e Gerente criam, editam e excluem clientes
  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription, checkPlanLimit],
  }, async (request, reply) => {
    const result = createClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createClient(request.user.organizationId!, result.data))
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClient(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteClient(id, request.user.organizationId!))
  })
}
