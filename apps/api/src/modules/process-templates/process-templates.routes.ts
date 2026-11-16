import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createProcessTemplateSchema, updateProcessTemplateSchema } from './process-templates.schema'
import { listProcessTemplates, getProcessTemplateById, createProcessTemplate, updateProcessTemplate, deleteProcessTemplate } from './process-templates.service'

export async function processTemplatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
    return reply.send(await listProcessTemplates(request.user.organizationId!))
  })

  app.get('/:id', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getProcessTemplateById(id, request.user.organizationId!))
  })

  // Nota: `requireRole('ORG_ADMIN')` é passado explicitamente no preHandler de cada rota de
  // mutação abaixo (em vez de um `app.addHook` global após as rotas de leitura) porque hooks
  // registrados via `addHook` no Fastify se aplicam a TODAS as rotas do mesmo contexto de
  // encapsulamento, inclusive as declaradas antes do addHook — confirmado empiricamente. Um
  // `addHook('preHandler', requireRole('ORG_ADMIN'))` aqui bloquearia também os GETs acima para
  // ORG_MANAGER/ORG_MEMBER, quebrando a leitura liberada pretendida.
  const adminOnly = [requireRole('ORG_ADMIN')]

  app.post('/', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const result = createProcessTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createProcessTemplate(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateProcessTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateProcessTemplate(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteProcessTemplate(id, request.user.organizationId!))
  })
}
