import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { updateSlaPreferenceSchema } from './sla.schema'
import {
  getPublicSlaConfig,
  getCustomSoundUrl,
  getSlaPreference,
  updateSlaPreference,
} from './sla.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function slaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole(...ORG_ROLES))

  app.get('/config', async (request, reply) => {
    return reply.send(await getPublicSlaConfig(request.user.organizationId!))
  })

  app.get('/custom-sound-url', async (request, reply) => {
    return reply.send({ url: await getCustomSoundUrl(request.user.organizationId!) })
  })

  app.get('/preferences', async (request, reply) => {
    return reply.send(await getSlaPreference(request.user.sub))
  })

  app.patch('/preferences', async (request, reply) => {
    const result = updateSlaPreferenceSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateSlaPreference(request.user.sub, result.data))
  })
}
