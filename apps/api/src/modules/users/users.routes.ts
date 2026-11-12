import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createUserSchema, updateUserSchema, updateMyProfileSchema } from './users.schema'
import { listUsers, listUserOptions, createUser, updateUser, deleteUser, resetUserPassword, getMyProfile, updateMyProfile } from './users.service'
import { getPortfolio, transferResponsibilities } from './responsibility-transfer.service'
import { portfolioQuerySchema, transferSchema } from './responsibility-transfer.schema'

export async function usersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // Qualquer usuário autenticado pode ver e editar o próprio perfil
  app.get('/me', async (request, reply) => {
    return reply.send(await getMyProfile(request.user.sub))
  })

  app.patch('/me', async (request, reply) => {
    const result = updateMyProfileSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateMyProfile(request.user.sub, result.data))
  })

  // Nota: `requireRole('ORG_ADMIN')` é passado explicitamente no preHandler de cada rota de
  // mutação abaixo (em vez de um `app.addHook` global após as rotas de leitura acima) porque
  // hooks registrados via `addHook` no Fastify se aplicam a TODAS as rotas do mesmo contexto de
  // encapsulamento, inclusive as declaradas antes do addHook — confirmado empiricamente. Um
  // `addHook('preHandler', requireRole('ORG_ADMIN'))` aqui bloquearia também GET/PATCH /me pra
  // qualquer usuário não-admin, quebrando o acesso ao próprio perfil. Ver mesmo padrão em
  // os-templates.routes.ts.
  const adminOnly = [requireRole('ORG_ADMIN')]

  // Light id+name list for filters (Tasks "Colaborador"), open to the whole office team.
  // The full list (/users: e-mail, role, status) stays admin-only.
  app.get('/options', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await listUserOptions(request.user.organizationId!))
  })

  app.get('/', { preHandler: adminOnly }, async (request, reply) => {
    return reply.send(await listUsers(request.user.organizationId!))
  })

  app.post('/', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const result = createUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createUser(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateUser(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteUser(id, request.user.organizationId!))
  })

  app.post('/:id/reset-password', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await resetUserPassword(id, request.user.organizationId!))
  })

  app.get('/:id/portfolio', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = portfolioQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await getPortfolio(id, request.user.organizationId!, result.data.departmentId))
  })

  app.post('/:id/transfer', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = transferSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await transferResponsibilities(id, request.user.organizationId!, result.data, request.user.sub))
  })
}
