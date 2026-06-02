// apps/api/src/modules/notifications/notifications.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  updateConfigSchema,
  upsertTemplateSchema,
  previewSchema,
  testWhatsappSchema,
  testEmailSchema,
  logsQuerySchema,
  eventParamSchema,
  channelParamSchema,
} from './notifications.schema'
import {
  getConfig,
  updateConfig,
  listTemplates,
  getTemplateForOrg,
  upsertTemplate,
  deleteTemplate,
  previewTemplate,
  testWhatsApp,
  testEmail,
  listLogs,
} from './notifications.service'

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  // Config
  app.get('/config', async (request, reply) => {
    return reply.send(await getConfig(request.user.organizationId!))
  })

  app.patch('/config', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = updateConfigSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateConfig(request.user.organizationId!, result.data))
  })

  app.post('/config/test-whatsapp', async (request, reply) => {
    const result = testWhatsappSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await testWhatsApp(request.user.organizationId!, result.data.number))
  })

  app.post('/config/test-email', async (request, reply) => {
    const result = testEmailSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await testEmail(request.user.organizationId!, result.data.to))
  })

  // Templates — preview ANTES de /:event/:channel
  app.get('/templates', async (request, reply) => {
    return reply.send(await listTemplates(request.user.organizationId!))
  })

  app.post('/templates/preview', async (request, reply) => {
    const result = previewSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await previewTemplate(
        request.user.organizationId!,
        result.data.event,
        result.data.channel,
        result.data.body,
      ),
    )
  })

  app.get('/templates/:event/:channel', async (request, reply) => {
    const { event, channel } = request.params as { event: string; channel: string }
    const ev = eventParamSchema.safeParse(event)
    const ch = channelParamSchema.safeParse(channel)
    if (!ev.success || !ch.success) throw new AppError(400, 'Evento ou canal inválido')
    return reply.send(await getTemplateForOrg(request.user.organizationId!, ev.data, ch.data))
  })

  app.put('/templates/:event/:channel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { event, channel } = request.params as { event: string; channel: string }
    const ev = eventParamSchema.safeParse(event)
    const ch = channelParamSchema.safeParse(channel)
    if (!ev.success || !ch.success) throw new AppError(400, 'Evento ou canal inválido')
    const result = upsertTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await upsertTemplate(request.user.organizationId!, ev.data, ch.data, result.data))
  })

  app.delete('/templates/:event/:channel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { event, channel } = request.params as { event: string; channel: string }
    const ev = eventParamSchema.safeParse(event)
    const ch = channelParamSchema.safeParse(channel)
    if (!ev.success || !ch.success) throw new AppError(400, 'Evento ou canal inválido')
    return reply.send(await deleteTemplate(request.user.organizationId!, ev.data, ch.data))
  })

  // Logs
  app.get('/logs', async (request, reply) => {
    const result = logsQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await listLogs(request.user.organizationId!, result.data))
  })
}
