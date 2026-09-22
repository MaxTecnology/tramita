import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createOSTemplateSchema, updateOSTemplateSchema } from './os-templates.schema'
import { listOSTemplates, getOSTemplateById, createOSTemplate, updateOSTemplate, deleteOSTemplate } from './os-templates.service'

export async function osTemplatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
    return reply.send(await listOSTemplates(request.user.organizationId!))
  })

  app.get('/:id', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getOSTemplateById(id, request.user.organizationId!))
  })

  // Nota: `requireRole('ORG_ADMIN')` é passado explicitamente no preHandler de cada rota de
  // mutação abaixo (em vez de um `app.addHook` global após as rotas de leitura) porque hooks
  // registrados via `addHook` no Fastify se aplicam a TODAS as rotas do mesmo contexto de
  // encapsulamento, inclusive as declaradas antes do addHook — confirmado empiricamente. Um
  // `addHook('preHandler', requireRole('ORG_ADMIN'))` aqui bloquearia também os GETs acima para
  // ORG_MANAGER/ORG_MEMBER, quebrando a leitura liberada pretendida.
  const adminOnly = [requireRole('ORG_ADMIN')]

  app.post('/', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const result = createOSTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createOSTemplate(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateOSTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateOSTemplate(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteOSTemplate(id, request.user.organizationId!))
  })
}
