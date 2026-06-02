import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { AppError } from '@/errors/AppError'

export async function verifyJWT(request: FastifyRequest, _reply: FastifyReply) {
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    throw new AppError(401, 'Token não fornecido')
  }
  try {
    request.user = verifyAccessToken(auth.slice(7))
  } catch {
    throw new AppError(401, 'Token inválido ou expirado')
  }
}
