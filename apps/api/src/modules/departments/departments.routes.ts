import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createDepartmentSchema, updateDepartmentSchema } from './departments.schema'
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from './departments.service'

export async function departmentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // Leitura liberada pra qualquer role da org (colaboradores precisam ver a lista
  // pra marcar departamento em tarefa) — só mutação é restrita a ORG_ADMIN
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await listDepartments(request.user.organizationId!))
  })

  // Nota: `requireRole('ORG_ADMIN')` é passado explicitamente no preHandler de cada rota de
  // mutação abaixo (em vez de um `app.addHook` global após a rota de leitura) porque hooks
  // registrados via `addHook` no Fastify se aplicam a TODAS as rotas do mesmo contexto de
  // encapsulamento, inclusive as declaradas antes do addHook — confirmado empiricamente. Um
  // `addHook('preHandler', requireRole('ORG_ADMIN'))` aqui bloquearia também o GET acima para
  // ORG_MANAGER/ORG_MEMBER, quebrando a leitura liberada pretendida. Ver mesmo padrão em
  // os-templates.routes.ts.
  const adminOnly = [requireRole('ORG_ADMIN')]

  app.post('/', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const result = createDepartmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createDepartment(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateDepartmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateDepartment(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteDepartment(id, request.user.organizationId!))
  })
}
