import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { readUpload, DEFAULT_MAX_UPLOAD_BYTES, type UploadedFile } from '@/lib/read-upload'
import { readMultipartField } from '@/lib/multipart-fields'
import { approveSchema, closeApprovalSchema, requestApprovalSchema, requestChangesSchema } from './approvals.schema'
import {
  requestApproval, listApprovalsForStaff, closeApproval, listApprovalsForClient, decideAsClient,
} from './approvals.service'

const STAFF = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { errors: { message: string }[] } } }, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, result.error.errors[0].message)
  return result.data
}

const staff = (request: FastifyRequest) => ({ id: request.user.sub, role: request.user.role })

export async function approvalsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: DEFAULT_MAX_UPLOAD_BYTES } })
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole(...STAFF))

  app.get('/tasks/:id/approvals', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listApprovalsForStaff(id, request.user.organizationId!, staff(request)))
  })

  // multipart: title, message (fields before the file), file
  app.post('/tasks/:id/approvals', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { file, upload } = await readUpload(request)
    const body = parse(requestApprovalSchema, { title: readMultipartField(file, 'title') ?? '', message: readMultipartField(file, 'message') })
    return reply.status(201).send(await requestApproval(id, request.user.organizationId!, staff(request), body, upload))
  })

  // JSON { reason, note } or multipart with the same fields before an optional proof (print)
  app.post('/approvals/:id/close', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    let fields: unknown = request.body
    let proof: UploadedFile | undefined
    if (request.isMultipart()) {
      const read = await readUpload(request, { optional: true })
      fields = read ? { reason: readMultipartField(read.file, 'reason'), note: readMultipartField(read.file, 'note') ?? '' } : {}
      proof = read?.upload
    }
    const body = parse(closeApprovalSchema, fields)
    return reply.send(await closeApproval(id, request.user.organizationId!, staff(request), body, proof))
  })
}

// Registered under /portal
export async function portalApprovalsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('CLIENT'))

  app.get('/tasks/:taskId/approvals', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listApprovalsForClient(taskId, request.user.organizationId!, request.user.sub))
  })

  app.post('/approvals/:id/approve', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { note } = parse(approveSchema, request.body ?? {})
    return reply.send(await decideAsClient(id, request.user.organizationId!, request.user.sub, 'APPROVED', note))
  })

  app.post('/approvals/:id/request-changes', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { note } = parse(requestChangesSchema, request.body ?? {})
    return reply.send(await decideAsClient(id, request.user.organizationId!, request.user.sub, 'CHANGES_REQUESTED', note))
  })
}
