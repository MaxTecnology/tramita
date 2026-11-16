import type { FastifyInstance } from 'fastify'
import { readMultipartField } from '@/lib/multipart-fields'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { staffScope, byMethod, param } from '@/middlewares/staffScope'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { readUpload, DEFAULT_MAX_UPLOAD_BYTES } from '@/lib/read-upload'
import { checkDeliveryFile } from '@/modules/document-reader/delivery-check'
import { addDocumentItemSchema, addDeliverableSchema, reviewDocumentRequirementSchema } from './task-documents.schema'
import {
  listTaskDocuments,
  addDocumentRequirement,
  addDeliverable,
  uploadForRequirement,
  reviewDocumentRequirement,
  deliverDocument,
} from './task-documents.service'

const MAX_FILE_SIZE = DEFAULT_MAX_UPLOAD_BYTES

export async function taskDocumentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', staffScope((r) => ({ taskIds: param(r, 'id') }), byMethod))

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
    return reply.status(201).send(await addDocumentRequirement(id, request.user.organizationId!, result.data.name, request.user.sub))
  })

  app.post('/tasks/:id/documents/deliveries', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = addDeliverableSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await addDeliverable(id, request.user.organizationId!, result.data.name, request.user.sub, result.data.requiresPayment))
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

    const { file, upload } = await readUpload(request)
    const organizationId = request.user.organizationId!

    // The robot checks deliveries marked with an obligation: another client's document never goes in;
    // warnings only go in when the person confirms ("Entregar mesmo assim"), and are kept in the history.
    const check = await checkDeliveryFile(id, reqId, organizationId, upload)
    if (check.blocked) throw new AppError(422, check.blocked)
    const acceptWarnings = readMultipartField(file, 'acceptWarnings') === 'true'
    if (check.warnings.length > 0 && !acceptWarnings) {
      throw new AppError(409, `O robô encontrou divergências: ${check.warnings.join('; ')}`)
    }

    return reply.status(201).send(
      await deliverDocument(
        id, reqId, organizationId, { id: request.user.sub },
        upload,
        {
          amount: readMultipartField(file, 'amount') ?? check.read.amount,
          paymentDueDate: readMultipartField(file, 'paymentDueDate') ?? check.read.dueDate,
        },
        { warnings: check.warnings },
      ),
    )
  })

  app.post('/tasks/:id/documents/deliveries/:reqId/check', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request) => {
    const { id, reqId } = request.params as { id: string; reqId: string }
    const { upload } = await readUpload(request)
    return checkDeliveryFile(id, reqId, request.user.organizationId!, upload)
  })

  app.post('/tasks/:id/documents/requests/:reqId/upload', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }

    const { file, upload } = await readUpload(request)

    return reply.status(201).send(
      await uploadForRequirement(
        id, reqId, request.user.organizationId!, { id: request.user.sub, type: 'user' }, undefined,
        upload,
      ),
    )
  })
}
