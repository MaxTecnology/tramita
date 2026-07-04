import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import { login, refreshSession, logout, changePassword } from '@/modules/auth/auth.service'
import { verifyJWT } from '@/middlewares/verifyJWT'
import {
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  changePasswordSchema,
} from '@/modules/auth/auth.schema'

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const result = loginBodySchema.safeParse(request.body)
    if (!result.success) {
      throw new AppError(400, result.error.errors[0].message)
    }
    const data = await login(result.data.email, result.data.password)
    return reply.status(200).send(data)
  })

  app.post('/refresh', async (request, reply) => {
    const result = refreshBodySchema.safeParse(request.body)
    if (!result.success) {
      throw new AppError(400, result.error.errors[0].message)
    }
    const data = await refreshSession(result.data.refreshToken)
    return reply.status(200).send(data)
  })

  app.post('/logout', async (request, reply) => {
    const result = logoutBodySchema.safeParse(request.body)
    if (!result.success) {
      throw new AppError(400, result.error.errors[0].message)
    }
    await logout(result.data.refreshToken)
    return reply.status(204).send()
  })

  app.post('/change-password', { preHandler: verifyJWT }, async (request, reply) => {
    const result = changePasswordSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    await changePassword(request.user.sub, request.user.role, result.data.currentPassword, result.data.newPassword)
    return reply.status(204).send()
  })
}
