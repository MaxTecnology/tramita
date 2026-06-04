import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createAttachment, listAttachments, deleteAttachment } from './attachments.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
])

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)

  app.post('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }

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

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      await file.toBuffer().catch(() => {})
      throw new AppError(422, 'Tipo de arquivo não permitido')
    }

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    const attachment = await createAttachment(
      taskId,
      request.user.organizationId!,
      { id: request.user.sub, role: request.user.role },
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })

  app.get('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }
    const clientId = request.user.role === 'CLIENT' ? request.user.sub : undefined
    return reply.send(await listAttachments(taskId, request.user.organizationId!, clientId))
  })

  app.delete('/tasks/:id/attachments/:attachmentId', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId, attachmentId } = request.params as { id: string; attachmentId: string }
    return reply.status(204).send(
      await deleteAttachment(
        attachmentId,
        taskId,
        request.user.organizationId!,
        { id: request.user.sub, role: request.user.role },
      )
    )
  })
}
