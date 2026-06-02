import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'

export async function verifyOrg(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId, role } = request.user
  if (role === 'MASTER') return

  const params = request.params as Record<string, string>
  const requestedOrgId = params.organizationId

  if (requestedOrgId && requestedOrgId !== organizationId) {
    throw new AppError(403, 'Acesso negado')
  }
}
