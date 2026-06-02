import type { FastifyInstance } from 'fastify'
import { getRevenue } from '@/modules/master/revenue.service'

export async function revenueRoutes(app: FastifyInstance) {
  app.get('/revenue', async (_req, reply) => {
    return reply.send(await getRevenue())
  })
}
