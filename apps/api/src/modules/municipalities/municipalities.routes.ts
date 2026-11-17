import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { listMunicipalitiesQuerySchema } from './municipalities.schema'
import { listMunicipalities } from './municipalities.service'

export async function municipalitiesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // Cities of a state, for the client form and the recurring due rules
  app.get('/', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request) => {
    const q = listMunicipalitiesQuerySchema.safeParse(request.query)
    if (!q.success) throw new AppError(400, q.error.errors[0].message)
    return listMunicipalities(q.data.uf)
  })
}
