import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import {
  listOrganizations,
  getOrganization,
  updateOrganization,
} from '@/modules/organizations/organizations.service'
import { updateOrgSchema } from '@/modules/organizations/organizations.schema'

export async function masterOrgRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send(await listOrganizations())
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getOrganization(id))
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateOrgSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateOrganization(id, result.data))
  })
}
