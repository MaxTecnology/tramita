import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'
import { getClientAccessScope } from '@/modules/client-users/client-access'
import { getTaskHistory, listAccessibleClients, listPortalTasks } from './portal.service'
import { listDepartments } from '@/modules/departments/departments.service'
import { createRequestSchema } from '@/modules/requests/requests.schema'
import {
  createRequest,
  listRequestsForClient,
  getRequestById,
  cancelRequest,
} from '@/modules/requests/requests.service'
import { createRequestAttachment } from '@/modules/requests/request-attachments.service'
import { listTaskDocuments, uploadForRequirement } from '@/modules/task-documents/task-documents.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

// request.user.sub is a ClientUser id (a person, not a company) — every route below that
// touches company-scoped data (requests, tasks, documents) must resolve the actual Client id
// through the access scope instead of using sub directly. A ClientUser can access more than
// one company; routes below take an explicit clientId (body/query) and validate it against
// the caller's access scope, or resolve it from the stored resource for single-resource routes.
export async function portalRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('CLIENT'))

  app.get('/clients', async (request, reply) => {
    return reply.send(await listAccessibleClients(request.user.sub))
  })

  // Listagem flat de tarefas do cliente — inclui tarefas recorrentes (board de sistema
  // RECURRING_SYSTEM, nunca listado por /boards) que sejam visibleToClient.
  app.get('/tasks', async (request, reply) => {
    const { clientId } = request.query as { clientId?: string }
    return reply.send(await listPortalTasks(request.user.organizationId!, request.user.sub, { clientId }))
  })

  app.get('/tasks/:taskId/history', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!, request.user.sub))
  })

  app.get('/tasks/:taskId/documents', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    // task-documents.service.ts now resolves the ClientUser's full access scope (multiple
    // companies/departments) itself — pass the raw clientUserId, not a pre-resolved Client.id.
    return reply.send(await listTaskDocuments(taskId, request.user.organizationId!, request.user.sub))
  })

  app.post('/tasks/:taskId/documents/requests/:reqId/upload', async (request, reply) => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string }

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

    // task-documents.service.ts resolves the real Client.id itself from the task's board —
    // actor.id here no longer needs to be a company id, just an identifier for the actor type.
    return reply.status(201).send(
      await uploadForRequirement(
        taskId, reqId, request.user.organizationId!, { id: request.user.sub, type: 'client' }, request.user.sub,
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })

  app.get('/departments', async (request, reply) => {
    return reply.send(await listDepartments(request.user.organizationId!))
  })

  app.get('/os-templates', async (request, reply) => {
    return reply.send(
      await prisma.oSTemplate.findMany({
        where: { organizationId: request.user.organizationId!, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    )
  })

  app.post('/requests', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const scope = await getClientAccessScope(request.user.sub)
    if (!scope.clientIds.includes(result.data.clientId)) throw new AppError(404, 'Empresa não encontrada')
    return reply.status(201).send(
      await createRequest(request.user.organizationId!, result.data.clientId, result.data),
    )
  })

  app.get('/requests', async (request, reply) => {
    const { clientId } = request.query as { clientId?: string }
    if (!clientId) throw new AppError(400, 'clientId é obrigatório')
    const scope = await getClientAccessScope(request.user.sub)
    if (!scope.clientIds.includes(clientId)) throw new AppError(404, 'Empresa não encontrada')
    return reply.send(await listRequestsForClient(request.user.organizationId!, clientId))
  })

  app.get('/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const scope = await getClientAccessScope(request.user.sub)
    const found = await getRequestById(id, request.user.organizationId!)
    if (!scope.clientIds.includes(found.clientId)) throw new AppError(404, 'Solicitação não encontrada')
    return reply.send(found)
  })

  app.patch('/requests/:id/cancel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const scope = await getClientAccessScope(request.user.sub)
    const found = await getRequestById(id, request.user.organizationId!)
    if (!scope.clientIds.includes(found.clientId)) throw new AppError(404, 'Solicitação não encontrada')
    return reply.send(await cancelRequest(id, request.user.organizationId!, found.clientId))
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

    const scope = await getClientAccessScope(request.user.sub)
    const found = await getRequestById(requestId, request.user.organizationId!)
    if (!scope.clientIds.includes(found.clientId)) throw new AppError(404, 'Solicitação não encontrada')
    const attachment = await createRequestAttachment(
      requestId,
      request.user.organizationId!,
      found.clientId,
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })
}
