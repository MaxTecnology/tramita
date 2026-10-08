import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { getDashboardMetrics, getTeamMembers } from './dashboard.service'

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/metrics', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await getDashboardMetrics(request.user.organizationId!))
  })

  // Lista leve (só id+name) pro seletor de pessoa da tela de Produtividade — deliberadamente mais
  // estreita que GET /users (restrito a ORG_ADMIN, gestão completa de usuário) e aberta também a
  // ORG_MANAGER, que precisa filtrar por pessoa sem herdar acesso de administração de usuários.
  app.get('/team-members', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    return reply.send(await getTeamMembers(request.user.organizationId!))
  })
}
