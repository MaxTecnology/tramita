import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createOSModelSchema, updateOSModelSchema, listOSModelsQuerySchema } from './os-models.schema'
import { listOSModels, getOSModelForOrg, createOSModel, updateOSModel, deleteOSModel } from './os-models.service'

export async function osModelsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  const staff = [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')]
  const adminOnly = [requireRole('ORG_ADMIN'), checkSubscription]

  app.get('/', { preHandler: staff }, async (request) => {
    const q = listOSModelsQuerySchema.safeParse(request.query)
    if (!q.success) throw new AppError(400, q.error.errors[0].message)
    return listOSModels(request.user.organizationId!, q.data.usage)
  })

  app.get('/:id', { preHandler: staff }, async (request) => {
    const { id } = request.params as { id: string }
    return getOSModelForOrg(id, request.user.organizationId!)
  })

  app.post('/', { preHandler: adminOnly }, async (request, reply) => {
    const body = createOSModelSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return reply.status(201).send(await createOSModel(request.user.organizationId!, body.data))
  })

  app.patch('/:id', { preHandler: adminOnly }, async (request) => {
    const { id } = request.params as { id: string }
    const body = updateOSModelSchema.safeParse(request.body)
    if (!body.success) throw new AppError(400, body.error.errors[0].message)
    return updateOSModel(id, request.user.organizationId!, body.data)
  })

  app.delete('/:id', { preHandler: adminOnly }, async (request) => {
    const { id } = request.params as { id: string }
    return deleteOSModel(id, request.user.organizationId!)
  })
}
