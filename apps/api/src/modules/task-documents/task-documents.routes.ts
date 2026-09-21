import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { addDocumentItemSchema, reviewDocumentRequirementSchema } from './task-documents.schema'
import {
  listTaskDocuments,
  addDocumentRequirement,
  addDeliverable,
  uploadForRequirement,
  reviewDocumentRequirement,
  deliverDocument,
} from './task-documents.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function taskDocumentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)

  app.get('/tasks/:id/documents', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listTaskDocuments(id, request.user.organizationId!))
  })

  app.post('/tasks/:id/documents/requests', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = addDocumentItemSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await addDocumentRequirement(id, request.user.organizationId!, result.data.name))
  })

  app.post('/tasks/:id/documents/deliveries', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = addDocumentItemSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await addDeliverable(id, request.user.organizationId!, result.data.name))
  })

  app.patch('/tasks/:id/documents/requests/:reqId', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }
    const result = reviewDocumentRequirementSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await reviewDocumentRequirement(
        id, reqId, request.user.organizationId!, request.user.sub,
        result.data.decision, result.data.rejectionReason,
      ),
    )
  })

  app.post('/tasks/:id/documents/deliveries/:reqId/upload', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }

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

    return reply.status(201).send(
      await deliverDocument(
        id, reqId, request.user.organizationId!, { id: request.user.sub },
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })

  app.post('/tasks/:id/documents/requests/:reqId/upload', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }

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

    return reply.status(201).send(
      await uploadForRequirement(
        id, reqId, request.user.organizationId!, { id: request.user.sub, type: 'user' }, undefined,
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })
}
