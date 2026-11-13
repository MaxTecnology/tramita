import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { staffScope, byMethod, param } from '@/middlewares/staffScope'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { readUpload, DEFAULT_MAX_UPLOAD_BYTES } from '@/lib/read-upload'
import { createAttachment, listAttachments, deleteAttachment } from './attachments.service'

const MAX_FILE_SIZE = DEFAULT_MAX_UPLOAD_BYTES

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', staffScope((r) => ({ taskIds: param(r, 'id') }), byMethod))

  app.post('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }

    const { upload } = await readUpload(request)

    const attachment = await createAttachment(
      taskId,
      request.user.organizationId!,
      { id: request.user.sub, role: request.user.role },
      upload,
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
