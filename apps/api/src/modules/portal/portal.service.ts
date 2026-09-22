import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'

export async function getTaskHistory(taskId: string, organizationId: string, clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId, clientId: { in: scope.clientIds } } } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task || !task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId)) {
    throw new AppError(404, 'Tarefa não encontrada')
  }

  return prisma.taskHistory.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } })
}

export async function listAccessibleClients(clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  if (scope.clientIds.length === 0) return []
  return prisma.client.findMany({
    where: { id: { in: scope.clientIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}
