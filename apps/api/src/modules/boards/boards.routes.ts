import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { getStaffScope, actableTaskIds } from '@/modules/staff-scope/staff-scope'
import { staffScope, param } from '@/middlewares/staffScope'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createBoardSchema, updateBoardSchema, searchQuerySchema, listBoardsQuerySchema } from './boards.schema'
import { listBoards, getBoardById, updateBoard, searchTasks } from './boards.service'
import { openProcess } from '@/modules/os/os.service'
import { getClientAccessScope, canSeeTask, type ClientAccessScope } from '@/modules/client-users/client-access'

// Office-only data never reaches the portal: delay reasons, the internal clock (business days,
// office x client time) and the OS a task waits for (they may be internal tasks)
const INTERNAL_KEYS = ['delayReasonId', 'delayNote', 'delayReasonPending', 'deadlineBusinessDays', 'deadline', 'waitingFor', 'targetDate'] as const

function withoutInternal<T extends Record<string, unknown>>(row: T): Omit<T, (typeof INTERNAL_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...row }
  for (const key of INTERNAL_KEYS) delete copy[key]
  return copy as Omit<T, (typeof INTERNAL_KEYS)[number]>
}

function filterBoardTasksForClient<
  T extends Record<string, unknown> & { clientId: string; columns: { tasks: (Record<string, unknown> & { departmentId: string; visibleToClient: boolean })[] }[] },
>(board: T, scope: ClientAccessScope) {
  return {
    ...withoutInternal(board),
    columns: board.columns.map((column) => ({
      ...column,
      tasks: column.tasks
        .filter((task) => task.visibleToClient && canSeeTask(scope, board.clientId, task.departmentId))
        .map((task) => withoutInternal(task)),
    })),
  }
}

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
      const boards = await listBoards(organizationId!, { clientId: scope.clientIds })
      return reply.send(boards.map((board) => filterBoardTasksForClient(board, scope)))
    }

    // Office staff: scope by role and department (staff-scope)
    return reply.send(await listBoards(organizationId!, { ...query, staffScope: await getStaffScope(request) }))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const isClient = request.user.role === 'CLIENT'

    if (!isClient) {
      const staffScope = await getStaffScope(request)
      const board = await getBoardById(id, request.user.organizationId!, false, undefined, staffScope)
      // Each task says whether this viewer may change it (else: read and comment, "Assumir")
      const editable = await actableTaskIds(staffScope, board.columns.flatMap((c) => c.tasks.map((t) => t.id)))
      return reply.send({
        ...board,
        columns: board.columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => ({ ...t, viewerCanEdit: editable.has(t.id) })) })),
      })
    }

    const scope = await getClientAccessScope(request.user.sub)
    const board = await getBoardById(id, request.user.organizationId!, true, scope.clientIds)

    return reply.send(filterBoardTasksForClient(board, scope))
  })

  app.get('/:id/tasks/search', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), staffScope((r) => ({ boardIds: param(r, 'id') }), 'read')],
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
    // With a process template: the board plus its OS (os.service); without: a plain board
    return reply.status(201).send(
      await openProcess(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data),
    )
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription, staffScope((r) => ({ boardIds: param(r, 'id') }), 'write')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateBoard(id, request.user.organizationId!, result.data))
  })
}
