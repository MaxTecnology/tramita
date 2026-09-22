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

  // Leitura liberada pra qualquer role da org — é o "Tipo de tarefa" da tela de Tarefas
  // (Tasks.tsx), lista só nome/config, nunca dado de cliente. Mutação continua ORG_ADMIN-only
  // (ver nota abaixo sobre o addHook).
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
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

  // Nota: `requireRole('ORG_ADMIN')` é passado explicitamente no preHandler de cada rota de
  // mutação abaixo (em vez de um `app.addHook` global após as rotas de leitura acima) porque
  // hooks registrados via `addHook` no Fastify se aplicam a TODAS as rotas do mesmo contexto de
  // encapsulamento, inclusive as declaradas antes do addHook — confirmado empiricamente. Um
  // `addHook('preHandler', requireRole('ORG_ADMIN'))` aqui bloquearia também os GETs acima pra
  // ORG_MANAGER/ORG_MEMBER, quebrando a leitura liberada pretendida. Ver mesmo padrão em
  // os-templates.routes.ts.
  const adminOnly = [requireRole('ORG_ADMIN')]

  app.post('/', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const result = createTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createTemplate(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateTemplate(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteTemplate(id, request.user.organizationId!))
  })

  app.post('/:id/assignments', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = createAssignmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createAssignment(id, request.user.organizationId!, result.data))
  })

  app.patch('/:id/assignments/:assignmentId', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string }
    const result = updateAssignmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateAssignment(id, assignmentId, request.user.organizationId!, result.data))
  })

  app.delete('/:id/assignments/:assignmentId', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string }
    return reply.send(await deleteAssignment(id, assignmentId, request.user.organizationId!))
  })

  app.post('/:id/assignments/:assignmentId/generate', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string }
    const result = manualGenerateSchema.safeParse(request.body ?? {})
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await generateManually(id, assignmentId, request.user.organizationId!, result.data.competence),
    )
  })
}
