// apps/api/src/modules/notifications/notifications.routes.ts
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
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
  uploadSlaSound,
  deleteSlaSound,
  isAllowedSlaSoundType,
  hasValidAudioSignature,
  SLA_SOUND_MAX_SIZE_BYTES,
} from './notifications.service'

export async function notificationsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: SLA_SOUND_MAX_SIZE_BYTES } })
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

  app.post('/config/sla-sound', { preHandler: [checkSubscription] }, async (request, reply) => {
    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 500KB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')
    if (!isAllowedSlaSoundType(file.mimetype)) {
      await file.toBuffer().catch(() => {})
      throw new AppError(422, 'Tipo de arquivo não permitido — use MP3 ou WAV')
    }

    let buffer: Buffer
    try {
      buffer = await file.toBuffer()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 500KB')
      }
      throw err
    }

    if (!hasValidAudioSignature(buffer, file.mimetype)) {
      throw new AppError(422, 'Arquivo não é um áudio válido (assinatura não corresponde ao tipo declarado)')
    }

    // Campo "label" só aparece aqui se tiver sido enviado ANTES do arquivo no multipart — o
    // fastify/multipart só acumula em `file.fields` o que já passou no stream até este ponto.
    const labelField = file.fields.label
    const label = (!Array.isArray(labelField) && labelField?.type === 'field' ? String(labelField.value) : null) ?? file.filename

    await uploadSlaSound(request.user.organizationId!, { buffer, mimeType: file.mimetype, label })
    return reply.status(201).send({ ok: true })
  })

  app.delete('/config/sla-sound', { preHandler: [checkSubscription] }, async (request, reply) => {
    await deleteSlaSound(request.user.organizationId!)
    return reply.status(204).send()
  })

  // Logs
  app.get('/logs', async (request, reply) => {
    const result = logsQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await listLogs(request.user.organizationId!, result.data))
  })
}
