import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createTaskSchema, updateTaskSchema, moveTaskSchema, reorderTasksSchema } from './tasks.schema'
import { createTask, moveTask, updateTask, reorderTasks, deleteTask, getTaskHistory } from './tasks.service'

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', checkSubscription)

  app.post('/columns/:columnId/tasks', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { columnId } = request.params as { columnId: string }
    const result = createTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.status(201).send(
      await createTask(columnId, request.user.organizationId!, result.data, actor),
    )
  })

  // reorder ANTES de /:id
  app.patch('/tasks/reorder', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = reorderTasksSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await reorderTasks(result.data, request.user.organizationId!))
  })

  // /tasks/:id/move ANTES de /tasks/:id
  app.patch('/tasks/:id/move', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = moveTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.send(await moveTask(id, request.user.organizationId!, result.data, actor))
  })

  app.patch('/tasks/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.send(await updateTask(id, request.user.organizationId!, result.data, actor))
  })

  app.get('/tasks/:id/history', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getTaskHistory(id, request.user.organizationId!))
  })

  app.delete('/tasks/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.status(204).send(await deleteTask(id, request.user.organizationId!))
  })
}
