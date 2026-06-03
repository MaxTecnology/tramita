import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { generateReport } from './reports.service'

export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/clients/:clientId/report', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'CLIENT')],
  }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { month } = request.query as { month?: string }

    if (!month) throw new AppError(400, 'Parâmetro month é obrigatório (formato: YYYY-MM)')

    const { role, sub, organizationId } = request.user
    if (role === 'CLIENT' && sub !== clientId) throw new AppError(403, 'Acesso negado')

    const pdfBuffer = await generateReport(clientId, organizationId!, month)

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="relatorio-${month}.pdf"`)
      .send(pdfBuffer)
  })
}
