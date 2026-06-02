import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createColumnSchema, updateColumnSchema, reorderColumnsSchema } from './columns.schema'
import { createColumn, updateColumn, reorderColumns, deleteColumn } from './columns.service'

export async function columnsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', checkSubscription)

  app.post('/boards/:boardId/columns', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { boardId } = request.params as { boardId: string }
    const result = createColumnSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createColumn(boardId, request.user.organizationId!, result.data))
  })

  // reorder ANTES de /:id para evitar conflito de rota
  app.patch('/columns/reorder', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const result = reorderColumnsSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await reorderColumns(result.data, request.user.organizationId!))
  })

  app.patch('/columns/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateColumnSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateColumn(id, request.user.organizationId!, result.data))
  })

  app.delete('/columns/:id', {
    preHandler: [requireRole('ORG_ADMIN')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.status(204).send(await deleteColumn(id, request.user.organizationId!))
  })
}
