import { onTasksMoved } from '@/modules/inbox/inbox-events'
import { lockUsersForShare } from '@/modules/clients/client-coverage'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishBoardEvent } from '@/lib/sse'
import type { TransferBody } from './responsibility-transfer.schema'

// Uma pessoa "é dona" de três coisas na carteira de um cliente: responsável por departamento
// (ClientAssignment), responsável por processo (Board.responsibleUserId) e tarefas abertas
// atribuídas (Task.assigneeId). A transferência move as três juntas.

const STAFF_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const
const CLOSED_TASK_STATUSES = ['DONE', 'DISREGARDED'] as const

export interface PortfolioEntry {
  clientId: string
  clientName: string
  codigo: string
  departments: { id: string; name: string }[]
  boardsCount: number
  openTasksCount: number
}

async function assertUserInOrg(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')
}

export async function getPortfolio(userId: string, organizationId: string, departmentId?: string): Promise<PortfolioEntry[]> {
  await assertUserInOrg(userId, organizationId)
  const activeClient = { isActive: true, organizationId }

  const [assignments, boards, tasks] = await Promise.all([
    prisma.clientAssignment.findMany({
      where: { userId, client: activeClient, ...(departmentId ? { departmentId } : {}) },
      select: { clientId: true, department: { select: { id: true, name: true } } },
    }),
    departmentId
      ? Promise.resolve([] as { clientId: string }[])
      : prisma.board.findMany({ where: { responsibleUserId: userId, isActive: true, client: activeClient }, select: { clientId: true } }),
    prisma.task.findMany({
      where: {
        assigneeId: userId,
        status: { notIn: [...CLOSED_TASK_STATUSES] },
        column: { board: { client: activeClient } },
        ...(departmentId ? { departmentId } : {}),
      },
      select: { column: { select: { board: { select: { clientId: true } } } } },
    }),
  ])

  const clientIds = [...new Set([
    ...assignments.map((a) => a.clientId),
    ...boards.map((b) => b.clientId),
    ...tasks.map((t) => t.column.board.clientId),
  ])]
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, name: true, codigo: true },
    orderBy: { name: 'asc' },
  })

  return clients.map((c) => ({
    clientId: c.id,
    clientName: c.name,
    codigo: c.codigo,
    departments: assignments.filter((a) => a.clientId === c.id).map((a) => a.department),
    boardsCount: boards.filter((b) => b.clientId === c.id).length,
    openTasksCount: tasks.filter((t) => t.column.board.clientId === c.id).length,
  }))
}

export async function transferResponsibilities(
  fromUserId: string,
  organizationId: string,
  body: TransferBody,
  actorId: string,
): Promise<{ assignments: number; boards: number; tasks: number }> {
  await assertUserInOrg(fromUserId, organizationId)
  if (body.toUserId === fromUserId) throw new AppError(400, 'Escolha um colaborador diferente do atual')

  const target = await prisma.user.findFirst({ where: { id: body.toUserId, organizationId } })
  if (!target) throw new AppError(404, 'Colaborador de destino não encontrado')
  if (!target.isActive || !(STAFF_ROLES as readonly string[]).includes(target.role)) {
    throw new AppError(400, 'Colaborador de destino inválido')
  }

  const portfolio = await getPortfolio(fromUserId, organizationId, body.departmentId)
  const inPortfolio = new Set(portfolio.map((p) => p.clientId))
  if (body.clientIds.some((id) => !inPortfolio.has(id))) {
    throw new AppError(400, 'Cliente fora da carteira deste colaborador')
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
  const departmentFilter = body.departmentId ? { departmentId: body.departmentId } : {}

  const moved: { taskId: string; boardId: string; clientName: string }[] = []

  const result = await prisma.$transaction(async (tx) => {
    await lockUsersForShare(tx, [body.toUserId])
    const stillActive = await tx.user.count({ where: { id: body.toUserId, isActive: true } })
    if (!stillActive) throw new AppError(400, 'Colaborador de destino inválido')
    if (target.role !== 'ORG_ADMIN') {
      // The new responsible must belong to every department being handed over
      const moving = await tx.clientAssignment.findMany({
        where: { userId: fromUserId, clientId: { in: body.clientIds }, ...departmentFilter },
        select: { departmentId: true, department: { select: { name: true } } },
        distinct: ['departmentId'],
      })
      const memberOf = new Set((await tx.userDepartment.findMany({ where: { userId: body.toUserId }, select: { departmentId: true } })).map((m) => m.departmentId))
      const missing = moving.find((m) => !memberOf.has(m.departmentId))
      if (missing) throw new AppError(400, `${target.name} não pertence ao departamento ${missing.department.name}`)
    }
    const assignments = await tx.clientAssignment.updateMany({
      where: { userId: fromUserId, clientId: { in: body.clientIds }, ...departmentFilter },
      data: { userId: body.toUserId },
    })

    // Processo não tem departamento: só muda de dono quando a transferência é do cliente inteiro.
    const boards = body.includeBoards && !body.departmentId
      ? await tx.board.updateMany({
          where: { responsibleUserId: fromUserId, isActive: true, clientId: { in: body.clientIds } },
          data: { responsibleUserId: body.toUserId },
        })
      : { count: 0 }

    let tasksMoved = 0
    if (body.includeTasks) {
      const tasks = await tx.task.findMany({
        where: {
          assigneeId: fromUserId,
          status: { notIn: [...CLOSED_TASK_STATUSES] },
          column: { board: { clientId: { in: body.clientIds } } },
          ...departmentFilter,
        },
        select: { id: true, column: { select: { boardId: true, board: { select: { client: { select: { name: true } } } } } } },
      })
      const taskIds = tasks.map((t) => t.id)
      moved.push(...tasks.map((t) => ({ taskId: t.id, boardId: t.column.boardId, clientName: t.column.board.client.name })))
      if (taskIds.length > 0) {
        await tx.task.updateMany({ where: { id: { in: taskIds } }, data: { assigneeId: body.toUserId } })
        await tx.taskHistory.createMany({
          data: taskIds.map((taskId) => ({
            taskId,
            action: 'assigned_to',
            fromValue: fromUserId,
            toValue: body.toUserId,
            actorType: 'user',
            actorId,
            actorName: actor?.name ?? 'Unknown',
          })),
        })
      }
      tasksMoved = taskIds.length
    }

    return { assignments: assignments.count, boards: boards.count, tasks: tasksMoved }
  })

  // Boards abertos refletem o novo responsável na hora (mesmo evento da edição de tarefa).
  await Promise.all(moved.map(({ taskId, boardId }) => publishBoardEvent(boardId, { event: 'task:updated', data: { taskId } })))
  await onTasksMoved({
    organizationId, type: 'TASK_ASSIGNED', recipientUserId: body.toUserId, count: moved.length,
    clientNames: moved.map((m) => m.clientName), actor: { userId: actorId, name: actor?.name ?? 'Escritório' },
  })

  return result
}
