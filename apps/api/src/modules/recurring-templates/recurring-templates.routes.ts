import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  createTemplateSchema,
  updateTemplateSchema,
  createAssignmentSchema,
  updateAssignmentSchema,
  manualGenerateSchema,
} from './recurring-templates.schema'
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  generateManually,
  listGenerationLog,
} from './recurring-templates.service'

export async function recurringTemplatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    return reply.send(await listTemplates(request.user.organizationId!))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getTemplateById(id, request.user.organizationId!))
  })

  app.get('/:id/assignments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listAssignments(id, request.user.organizationId!))
  })

  app.get('/:id/generation-log', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listGenerationLog(id, request.user.organizationId!))
  })

  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createTemplate(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateTemplate(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteTemplate(id, request.user.organizationId!))
  })

  app.post('/:id/assignments', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = createAssignmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createAssignment(id, request.user.organizationId!, result.data))
  })

  app.patch('/:id/assignments/:assignmentId', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string }
    const result = updateAssignmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateAssignment(id, assignmentId, request.user.organizationId!, result.data))
  })

  app.delete('/:id/assignments/:assignmentId', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string }
    return reply.send(await deleteAssignment(id, assignmentId, request.user.organizationId!))
  })

  app.post('/:id/assignments/:assignmentId/generate', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string }
    const result = manualGenerateSchema.safeParse(request.body ?? {})
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await generateManually(id, assignmentId, request.user.organizationId!, result.data.competence),
    )
  })
}
