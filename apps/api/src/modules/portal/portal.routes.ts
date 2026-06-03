import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { updateProfileSchema } from './portal.schema'
import { updateClientProfile, getTaskHistory } from './portal.service'

export async function portalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('CLIENT'))

  app.patch('/profile', async (request, reply) => {
    const result = updateProfileSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClientProfile(request.user.sub, result.data))
  })

  app.get('/tasks/:taskId/history', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!))
  })
}
