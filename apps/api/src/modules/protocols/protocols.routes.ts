// apps/api/src/modules/protocols/protocols.routes.ts
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createProtocolSchema, listProtocolsQuerySchema, updateProtocolPaymentSchema, cancelProtocolSchema } from './protocols.schema'
import { replaceProtocolFile, updateProtocolPayment, cancelProtocol } from './protocol-office-actions'
import { readMultipartField } from '@/lib/multipart-fields'
import {
  createProtocol, listProtocolsForOrg, listProtocolsForTask, getProtocolById,
  getProtocolsSummary, buildProtocolReceiptHtml,
} from './protocols.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function protocolsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.addHook('preHandler', verifyJWT)

  app.post('/tasks/:taskId/protocols', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createProtocolSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const { dueDate, ...rest } = result.data
    return reply.status(201).send(
      await createProtocol(taskId, request.user.organizationId!, request.user.sub, {
        ...rest,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      }),
    )
  })

  app.get('/tasks/:taskId/protocols', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listProtocolsForTask(taskId, request.user.organizationId!))
  })

  app.get('/protocols/summary', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    return reply.send(await getProtocolsSummary(request.user.organizationId!, { id: request.user.sub, role: request.user.role }))
  })

  app.get('/protocols', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const result = listProtocolsQuerySchema.safeParse(request.query)
    const query = result.success ? result.data : {}
    return reply.send(await listProtocolsForOrg(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, {
      status: query.status,
      clientId: query.clientId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }))
  })

  app.get('/protocols/:id', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getProtocolById(id, request.user.organizationId!))
  })

  app.post('/protocols/:id/replace', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
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
    return reply.send(await replaceProtocolFile(
      id, request.user.organizationId!, { id: request.user.sub, role: request.user.role },
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      { amount: readMultipartField(file, 'amount'), paymentDueDate: readMultipartField(file, 'paymentDueDate') },
    ))
  })

  app.patch('/protocols/:id/payment', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateProtocolPaymentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateProtocolPayment(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data))
  })

  app.post('/protocols/:id/cancel', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = cancelProtocolSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await cancelProtocol(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data.reason))
  })

  app.get('/protocols/:id/receipt', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const protocol = await getProtocolById(id, request.user.organizationId!)
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(buildProtocolReceiptHtml(protocol))
  })
}
