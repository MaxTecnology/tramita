import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { getClientAccessScope } from '@/modules/client-users/client-access'
import { updateProfileSchema } from './portal.schema'
import { getClientProfile, updateClientProfile, getTaskHistory } from './portal.service'
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
// through the access scope instead of using sub directly.
//
// A ClientUser can in principle access more than one company; picking the first one is an
// interim simplification until the portal gets a company selector (see design doc — later
// task). All routes here behave correctly for the common single-company case.
async function resolveClientId(clientUserId: string): Promise<string> {
  const scope = await getClientAccessScope(clientUserId)
  const clientId = scope.clientIds[0]
  if (!clientId) throw new AppError(404, 'Nenhuma empresa vinculada a este usuário')
  return clientId
}

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
    const clientId = await resolveClientId(request.user.sub)
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!, clientId))
  })

  app.get('/tasks/:taskId/documents', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const clientId = await resolveClientId(request.user.sub)
    return reply.send(await listTaskDocuments(taskId, request.user.organizationId!, clientId))
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

    const clientId = await resolveClientId(request.user.sub)
    return reply.status(201).send(
      await uploadForRequirement(
        taskId, reqId, request.user.organizationId!, { id: clientId, type: 'client' }, clientId,
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })

  app.get('/departments', async (request, reply) => {
    return reply.send(await listDepartments(request.user.organizationId!))
  })

  app.post('/requests', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const clientId = await resolveClientId(request.user.sub)
    return reply.status(201).send(
      await createRequest(request.user.organizationId!, clientId, result.data),
    )
  })

  app.get('/requests', async (request, reply) => {
    const clientId = await resolveClientId(request.user.sub)
    return reply.send(await listRequestsForClient(request.user.organizationId!, clientId))
  })

  app.get('/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const clientId = await resolveClientId(request.user.sub)
    return reply.send(await getRequestById(id, request.user.organizationId!, clientId))
  })

  app.patch('/requests/:id/cancel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const clientId = await resolveClientId(request.user.sub)
    return reply.send(await cancelRequest(id, request.user.organizationId!, clientId))
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

    const clientId = await resolveClientId(request.user.sub)
    const attachment = await createRequestAttachment(
      requestId,
      request.user.organizationId!,
      clientId,
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })
}
