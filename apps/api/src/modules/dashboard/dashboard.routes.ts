import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { productivityQuerySchema } from './dashboard.schema'
import { getDashboardMetrics, getTeamMembers, getProductivityMetrics } from './dashboard.service'

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

  app.get('/productivity', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = productivityQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)

    const query = result.data
    // ORG_MEMBER nunca vê produtividade de outra pessoa — nem via userId de outro usuário, nem
    // indiretamente filtrando por um departamento com vários membros (a trava é aqui, não só na
    // UI escondendo o seletor).
    const forcedUserId = request.user.role === 'ORG_MEMBER' ? request.user.sub : query.userId

    return reply.send(await getProductivityMetrics(request.user.organizationId!, {
      from: new Date(query.from),
      to: new Date(query.to),
      departmentId: query.departmentId,
      userId: forcedUserId,
      boardType: query.boardType,
    }))
  })
}
