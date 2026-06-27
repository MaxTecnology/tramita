import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { updateProfileSchema } from './portal.schema'
import { getClientProfile, updateClientProfile, getTaskHistory } from './portal.service'
import { createRequestSchema } from '@/modules/requests/requests.schema'
import {
  createRequest,
  listRequestsForClient,
  getRequestById,
  cancelRequest,
} from '@/modules/requests/requests.service'
import { createRequestAttachment } from '@/modules/requests/request-attachments.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function portalRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('CLIENT'))

  app.get('/profile', async (request, reply) => {
    return reply.send(await getClientProfile(request.user.sub))
  })

  app.patch('/profile', async (request, reply) => {
    const result = updateProfileSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClientProfile(request.user.sub, result.data))
  })

  app.get('/tasks/:taskId/history', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!))
  })

  app.post('/requests', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createRequest(request.user.organizationId!, request.user.sub, result.data),
    )
  })

  app.get('/requests', async (request, reply) => {
    return reply.send(await listRequestsForClient(request.user.organizationId!, request.user.sub))
  })

  app.get('/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getRequestById(id, request.user.organizationId!, request.user.sub))
  })

  app.patch('/requests/:id/cancel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await cancelRequest(id, request.user.organizationId!, request.user.sub))
  })

  app.post('/requests/:id/attachments', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id: requestId } = request.params as { id: string }

    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    const attachment = await createRequestAttachment(
      requestId,
      request.user.organizationId!,
      request.user.sub,
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })
}
