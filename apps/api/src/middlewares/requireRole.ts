import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import type { Role } from '@/modules/auth/auth.types'

export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    if (!roles.includes(request.user.role)) {
      throw new AppError(403, 'Acesso negado')
    }
  }
}
