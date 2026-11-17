import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { staffScope, bodyIds, param } from '@/middlewares/staffScope'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createTaskSchema, updateTaskSchema, moveTaskSchema, listTasksQuerySchema, assumeTaskSchema, assumeBulkSchema } from './tasks.schema'
import { assumeTask, assumeTasksBulk } from './task-assume.service'
import { createTask, moveTask, updateTask, deleteTask, getTaskHistory, listTasks } from './tasks.service'
import { regenerateTask } from '@/modules/recurring-templates/recurring-templates.service'

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', checkSubscription)

  app.post('/columns/:columnId/tasks', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), staffScope((r) => ({ columnIds: param(r, 'columnId') }), 'write')],
  }, async (request, reply) => {
    const { columnId } = request.params as { columnId: string }
    const result = createTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.status(201).send(
      await createTask(columnId, request.user.organizationId!, result.data, actor),
    )
  })

  // /tasks (listagem flat) ANTES de qualquer /tasks/:id-shaped
  app.get('/tasks', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = listTasksQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await listTasks(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data),
    )
  })

  // Assumir em lote: all open tasks of a colleague in my departments
  app.post('/tasks/assume-bulk', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = assumeBulkSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await assumeTasksBulk(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data))
  })

  app.post('/tasks/:id/assume', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = assumeTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await assumeTask(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data.expectedAssigneeId))
  })

  // /tasks/:id/move ANTES de /tasks/:id
  app.patch('/tasks/:id/move', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), staffScope((r) => ({ taskIds: param(r, 'id'), columnIds: bodyIds(r.body, 'columnId') }), 'write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = moveTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.send(await moveTask(id, request.user.organizationId!, result.data, actor))
  })

  app.patch('/tasks/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), staffScope((r) => ({ taskIds: param(r, 'id') }), 'write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    // Anyone who may change the task hands it to anyone active of the team, also of another department
    // (the task stays in its department; updateTask checks the person belongs to this office)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.send(await updateTask(id, request.user.organizationId!, result.data, actor))
  })

  app.get('/tasks/:id/history', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), staffScope((r) => ({ taskIds: param(r, 'id') }), 'read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getTaskHistory(id, request.user.organizationId!))
  })

  app.delete('/tasks/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), staffScope((r) => ({ taskIds: param(r, 'id') }), 'write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.status(204).send(await deleteTask(id, request.user.organizationId!))
  })

  app.post('/tasks/:id/regenerate', {
    preHandler: [requireRole('ORG_ADMIN')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await regenerateTask(id, request.user.organizationId!))
  })
}
