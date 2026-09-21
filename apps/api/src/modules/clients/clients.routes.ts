import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { checkPlanLimit } from '@/middlewares/checkPlanLimit'
import { AppError } from '@/errors/AppError'
import { createClientSchema, updateClientSchema, listClientsQuerySchema, setAssignmentSchema } from './clients.schema'
import {
  listClients,
  createClient,
  updateClient,
  deleteClient,
  listAssignments,
  setAssignment,
  lookupClientByCnpj,
  searchClientUsers,
  listClientUserLinks,
} from './clients.service'

export async function clientsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // ORG_MEMBER pode ler clientes (para usar no modal de criação de board)
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { includeInactive } = listClientsQuerySchema.parse(request.query)
    return reply.send(await listClients(request.user.organizationId!, includeInactive))
  })

  // Rotas fixas antes de "/:id" — evita colisão com o parâmetro de rota
  app.get('/lookup-cnpj/:cnpj', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { cnpj } = request.params as { cnpj: string }
    return reply.send(await lookupClientByCnpj(cnpj))
  })

  app.get('/search-users', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { q } = request.query as { q?: string }
    return reply.send(await searchClientUsers(request.user.organizationId!, q ?? ''))
  })

  // Apenas Admin e Gerente criam, editam e excluem clientes
  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription, checkPlanLimit],
  }, async (request, reply) => {
    const result = createClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createClient(request.user.organizationId!, result.data))
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClient(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteClient(id, request.user.organizationId!))
  })

  app.get('/:id/users', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listClientUserLinks(id, request.user.organizationId!))
  })

  app.get('/:id/assignments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listAssignments(id, request.user.organizationId!))
  })

  app.put('/:id/assignments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = setAssignmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await setAssignment(id, request.user.organizationId!, result.data.departmentId, result.data.userId),
    )
  })
}
