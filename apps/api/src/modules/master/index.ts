import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { planRoutes } from '@/modules/plans/plans.routes'
import { masterOrgRoutes } from '@/modules/organizations/organizations.routes'
import { revenueRoutes } from '@/modules/master/revenue.routes'

export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('MASTER'))

  app.register(planRoutes, { prefix: '/plans' })
  app.register(masterOrgRoutes, { prefix: '/organizations' })
  app.register(revenueRoutes)
}
