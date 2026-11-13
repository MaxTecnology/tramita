import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishBoardEvent } from '@/lib/sse'
import { actorScope, taskWhere, type StaffScope } from '@/modules/staff-scope/staff-scope'

type Actor = { id: string; role: string }

const CLOSED = ['DONE', 'DISREGARDED'] as const

// "Assumir" covers an absent colleague: the task changes hands, the client portfolio
// (ClientAssignment) does not. Members need "see colleagues"; everyone needs to belong to the
// department of the task (admins excepted).
function assertCanAssume(scope: StaffScope, departmentId: string | null): void {
  if (scope.kind === 'ALL') return
  if (scope.role === 'ORG_MEMBER' && !scope.seesDepartment) throw new AppError(404, 'Tarefa não encontrada')
  if (!departmentId || !scope.departmentIds.includes(departmentId)) {
    throw new AppError(403, 'Você não pertence ao departamento desta tarefa')
  }
}

async function actorName(userId: string): Promise<string> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? ''
}

export async function assumeTask(taskId: string, organizationId: string, actor: Actor, expectedAssigneeId: string | null) {
  const scope = await actorScope(actor, organizationId)
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } }, ...taskWhere(scope) },
    include: { column: { select: { board: { select: { id: true, client: { select: { name: true } } } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  assertCanAssume(scope, task.departmentId)
  if ((CLOSED as readonly string[]).includes(task.status)) throw new AppError(409, 'Tarefa concluída não pode ser assumida')
  if (task.assigneeId === actor.id) throw new AppError(409, 'A tarefa já é sua')

  const name = await actorName(actor.id)
  await prisma.$transaction(async (tx) => {
    // Guarded write: only if the assignee is still the one the screen showed
    const { count } = await tx.task.updateMany({ where: { id: taskId, assigneeId: expectedAssigneeId }, data: { assigneeId: actor.id } })
    if (count === 0) throw new AppError(409, 'Essa tarefa já foi assumida por outra pessoa')
    await tx.taskHistory.create({
      data: { taskId, action: 'assumed', fromValue: expectedAssigneeId, toValue: actor.id, actorType: 'user', actorId: actor.id, actorName: name },
    })
  })

  await publishBoardEvent(task.column.board.id, { event: 'task:updated', data: { taskId } })
  if (expectedAssigneeId && expectedAssigneeId !== actor.id) {
    await enqueueNotification({
      event: 'TASK_ASSUMED', organizationId, recipientType: 'USER', userId: expectedAssigneeId, taskId,
      metadata: { taskTitle: task.title, clientName: task.column.board.client.name, assumedByName: name },
    })
  }
  return prisma.task.findUniqueOrThrow({ where: { id: taskId } })
}

export async function assumeTasksBulk(
  organizationId: string,
  actor: Actor,
  input: { fromUserId: string; departmentId?: string },
): Promise<{ count: number }> {
  const scope = await actorScope(actor, organizationId)
  if (input.fromUserId === actor.id) throw new AppError(400, 'Escolha um colaborador diferente de você')
  if (scope.kind === 'LIMITED' && scope.role === 'ORG_MEMBER' && !scope.seesDepartment) {
    throw new AppError(403, 'Você não pode assumir tarefas de colegas')
  }
  const departments = scope.kind === 'ALL'
    ? (input.departmentId ? [input.departmentId] : null)
    : scope.departmentIds.filter((d) => !input.departmentId || d === input.departmentId)
  if (departments && departments.length === 0) return { count: 0 }

  const candidates = await prisma.task.findMany({
    where: {
      assigneeId: input.fromUserId,
      status: { notIn: [...CLOSED] },
      column: { board: { organizationId } },
      ...(departments ? { departmentId: { in: departments } } : {}),
    },
    select: { id: true, column: { select: { board: { select: { id: true, client: { select: { name: true } } } } } } },
  })
  if (candidates.length === 0) return { count: 0 }

  const name = await actorName(actor.id)
  const ids = candidates.map((t) => t.id)
  const moved = await prisma.$transaction(async (tx) => {
    // Guarded: tasks someone else took in the meantime are left alone
    const still = await tx.task.findMany({ where: { id: { in: ids }, assigneeId: input.fromUserId }, select: { id: true } })
    const stillIds = still.map((t) => t.id)
    await tx.task.updateMany({ where: { id: { in: stillIds }, assigneeId: input.fromUserId }, data: { assigneeId: actor.id } })
    await tx.taskHistory.createMany({
      data: stillIds.map((taskId) => ({ taskId, action: 'assumed', fromValue: input.fromUserId, toValue: actor.id, actorType: 'user', actorId: actor.id, actorName: name })),
    })
    return new Set(stillIds)
  })

  const movedTasks = candidates.filter((t) => moved.has(t.id))
  for (const boardId of new Set(movedTasks.map((t) => t.column.board.id))) {
    await publishBoardEvent(boardId, { event: 'task:updated', data: {} })
  }
  if (movedTasks.length > 0) {
    const clients = [...new Set(movedTasks.map((t) => t.column.board.client.name))]
    await enqueueNotification({
      event: 'TASK_ASSUMED', organizationId, recipientType: 'USER', userId: input.fromUserId,
      metadata: {
        taskTitle: `${movedTasks.length} tarefa${movedTasks.length > 1 ? 's' : ''}`,
        clientName: clients.length === 1 ? clients[0] : `${clients.length} clientes`,
        assumedByName: name,
      },
    })
  }
  return { count: movedTasks.length }
}

// A member hands their own task to a colleague: only to someone of the task's department.
export async function assertMemberCanPassTask(taskId: string, newAssigneeId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { departmentId: true, assigneeId: true } })
  if (!task || task.assigneeId === newAssigneeId) return
  const belongs = task.departmentId
    ? await prisma.userDepartment.count({ where: { userId: newAssigneeId, departmentId: task.departmentId } })
    : 0
  if (!belongs) throw new AppError(400, 'Só é possível passar a tarefa para alguém do departamento dela')
}
