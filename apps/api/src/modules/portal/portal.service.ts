import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
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
  if (data.whatsapp !== undefined) updateData.phone = data.whatsapp
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10)

  return prisma.clientUser.update({
    where: { id: clientUserId },
    data: updateData,
    select: { id: true, name: true, email: true, phone: true },
  })
}

export async function getTaskHistory(taskId: string, organizationId: string, clientId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId, clientId } } },
  })
  if (!task || !task.visibleToClient) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })
}
