import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createBoardSchema, updateBoardSchema, searchQuerySchema, listBoardsQuerySchema } from './boards.schema'
import { listBoards, getBoardById, createBoard, updateBoard, searchTasks } from './boards.service'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'

export async function boardsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { organizationId, role, sub } = request.user

    const rawQuery = listBoardsQuerySchema.safeParse(request.query)
    const query = rawQuery.success ? rawQuery.data : {}

    // CLIENT sees boards from every client company they have access to
    if (role === 'CLIENT') {
      const scope = await getClientAccessScope(sub)
      return reply.send(await listBoards(organizationId!, { clientId: scope.clientIds }))
    }

    // ORG_MEMBER always sees only boards they are responsible for
    if (role === 'ORG_MEMBER') {
      return reply.send(await listBoards(organizationId!, { ...query, responsibleUserId: sub }))
    }

    return reply.send(await listBoards(organizationId!, query))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const isClient = request.user.role === 'CLIENT'

    if (!isClient) {
      return reply.send(await getBoardById(id, request.user.organizationId!, false))
    }

    const scope = await getClientAccessScope(request.user.sub)
    const board = await getBoardById(id, request.user.organizationId!, true, scope.clientIds)
    const allowedDepartmentIds = scope.departmentIdsByClient.get(board.clientId) ?? new Set<string>()

    return reply.send({
      ...board,
      columns: board.columns.map((column) => ({
        ...column,
        tasks: column.tasks.filter((task) => allowedDepartmentIds.has(task.departmentId)),
      })),
    })
  })

  app.get('/:id/tasks/search', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = searchQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await searchTasks(id, request.user.organizationId!, result.data))
  })

  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const result = createBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createBoard(
        request.user.organizationId!,
        request.user.sub,
        request.user.role,
        result.data,
      ),
    )
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateBoard(id, request.user.organizationId!, result.data))
  })
}
