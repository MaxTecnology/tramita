import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import type { UpdateProfileBody } from './portal.schema'

// clientId here is really request.user.sub — for role CLIENT that's now a
// ClientUser.id (the portal login is per-person, not per-company).
export async function getClientProfile(clientUserId: string) {
  const clientUser = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: { id: true, name: true, email: true, phone: true },
  })
  if (!clientUser) throw new AppError(404, 'Cliente não encontrado')
  return clientUser
}

export async function updateClientProfile(clientUserId: string, data: UpdateProfileBody) {
  const updateData: { phone?: string; passwordHash?: string } = {}
  if (data.phone !== undefined) updateData.phone = data.phone
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10)

  return prisma.clientUser.update({
    where: { id: clientUserId },
    data: updateData,
    select: { id: true, name: true, email: true, phone: true },
  })
}

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
