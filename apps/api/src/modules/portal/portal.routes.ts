import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'
import { canSeeTask, getClientAccessScope } from '@/modules/client-users/client-access'
import { getTaskHistory, listAccessibleClients, listPortalTasks } from './portal.service'
import { createRequestSchema } from '@/modules/requests/requests.schema'
import {
  createRequest,
  listRequestsForClient,
  getRequestById,
  cancelRequest,
} from '@/modules/requests/requests.service'
import { createRequestAttachment } from '@/modules/requests/request-attachments.service'
import { listProtocolsForClient, registerView, registerDownload } from '@/modules/protocols/protocols.service'
import { listTaskDocuments, uploadForRequirement, setNotApplicable } from '@/modules/task-documents/task-documents.service'
import { getPortalHome, listDocumentRequestMonths, listDocumentRequestsByMonth } from './portal-overview.service'
import { markProtocolPaid, unmarkProtocolPaid } from '@/modules/protocols/protocol-payment.service'
import { readMultipartField } from '@/lib/multipart-fields'
import { portalProtocolsQuerySchema, markPaidSchema, portalClientQuerySchema, documentRequestsQuerySchema } from './portal.schema'

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

  // Só os departamentos aos quais o usuário logado tem acesso na empresa escolhida — é a lista do
  // formulário de nova solicitação (I6 da spec de cobertura de departamentos).
  app.get('/departments', async (request, reply) => {
    const { clientId } = request.query as { clientId?: string }
    if (!clientId) throw new AppError(400, 'clientId é obrigatório')
    const scope = await getClientAccessScope(request.user.sub)
    const departmentIds = scope.departmentIdsByClient.get(clientId)
    if (!departmentIds) throw new AppError(404, 'Empresa não encontrada')
    return reply.send(
      await prisma.department.findMany({
        where: { id: { in: [...departmentIds] }, organizationId: request.user.organizationId! },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    )
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
      await createRequest(request.user.organizationId!, result.data.clientId, request.user.sub, result.data),
    )
  })

  app.get('/requests', async (request, reply) => {
    const { clientId } = request.query as { clientId?: string }
    if (!clientId) throw new AppError(400, 'clientId é obrigatório')
    const scope = await getClientAccessScope(request.user.sub)
    if (!scope.clientIds.includes(clientId)) throw new AppError(404, 'Empresa não encontrada')
    // Só solicitações dos departamentos a que este usuário tem acesso nesta empresa.
    const departmentIds = [...(scope.departmentIdsByClient.get(clientId) ?? [])]
    return reply.send(await listRequestsForClient(request.user.organizationId!, clientId, departmentIds))
  })

  app.get('/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const scope = await getClientAccessScope(request.user.sub)
    const found = await getRequestById(id, request.user.organizationId!)
    if (!canSeeTask(scope, found.clientId, found.departmentId)) throw new AppError(404, 'Solicitação não encontrada')
    return reply.send(found)
  })

  app.patch('/requests/:id/cancel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const scope = await getClientAccessScope(request.user.sub)
    const found = await getRequestById(id, request.user.organizationId!)
    if (!canSeeTask(scope, found.clientId, found.departmentId)) throw new AppError(404, 'Solicitação não encontrada')
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
    if (!canSeeTask(scope, found.clientId, found.departmentId)) throw new AppError(404, 'Solicitação não encontrada')
    const attachment = await createRequestAttachment(
      requestId,
      request.user.organizationId!,
      found.clientId,
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })

  async function assertClientInScope(clientUserId: string, clientId: string) {
    const scope = await getClientAccessScope(clientUserId)
    if (!scope.clientIds.includes(clientId)) throw new AppError(404, 'Empresa não encontrada')
  }

  app.get('/home', async (request, reply) => {
    const result = portalClientQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    await assertClientInScope(request.user.sub, result.data.clientId)
    return reply.send(await getPortalHome(request.user.organizationId!, result.data.clientId, request.user.sub))
  })

  app.get('/document-requests/months', async (request, reply) => {
    const result = portalClientQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    await assertClientInScope(request.user.sub, result.data.clientId)
    return reply.send(await listDocumentRequestMonths(request.user.organizationId!, result.data.clientId, request.user.sub))
  })

  app.get('/document-requests', async (request, reply) => {
    const result = documentRequestsQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    await assertClientInScope(request.user.sub, result.data.clientId)
    return reply.send(await listDocumentRequestsByMonth(request.user.organizationId!, result.data.clientId, request.user.sub, result.data.competence))
  })

  app.post('/tasks/:taskId/documents/requests/:reqId/not-applicable', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string }
    return reply.send(await setNotApplicable(taskId, reqId, request.user.organizationId!, request.user.sub, true))
  })

  app.delete('/tasks/:taskId/documents/requests/:reqId/not-applicable', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string }
    return reply.send(await setNotApplicable(taskId, reqId, request.user.organizationId!, request.user.sub, false))
  })

  app.get('/protocols', async (request, reply) => {
    const result = portalProtocolsQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const { clientId, dueFrom, dueTo, ...filters } = result.data
    const scope = await getClientAccessScope(request.user.sub)
    if (!scope.clientIds.includes(clientId)) throw new AppError(404, 'Empresa não encontrada')
    return reply.send(
      await listProtocolsForClient(request.user.organizationId!, clientId, request.user.sub, {
        ...filters,
        dueFrom: dueFrom ? new Date(`${dueFrom}T00:00:00.000Z`) : undefined,
        dueTo: dueTo ? new Date(`${dueTo}T00:00:00.000Z`) : undefined,
      }),
    )
  })

  app.post('/protocols/:id/pay', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    let amount: string | undefined
    let proof: { filename: string; mimeType: string; size: number; buffer: Buffer } | undefined
    if (request.isMultipart()) {
      const file = await request.file()
      if (file) {
        amount = readMultipartField(file, 'amount')
        const buffer = await file.toBuffer()
        proof = { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer }
      }
    } else {
      const body = markPaidSchema.safeParse(request.body)
      if (!body.success) throw new AppError(400, body.error.errors[0].message)
      amount = body.data.amount
    }
    if (!amount) throw new AppError(400, 'Informe o valor pago')
    return reply.send(await markProtocolPaid(id, request.user.organizationId!, request.user.sub, { amount, proof }))
  })

  app.delete('/protocols/:id/pay', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await unmarkProtocolPaid(id, request.user.organizationId!, request.user.sub))
  })

  app.get('/protocols/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(
      await registerView(id, request.user.organizationId!, request.user.sub, request.ip, request.headers['user-agent'] as string | undefined),
    )
  })

  app.get('/protocols/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string }
    const url = await registerDownload(id, request.user.organizationId!, request.user.sub, request.ip, request.headers['user-agent'] as string | undefined)
    return reply.send({ url })
  })
}
