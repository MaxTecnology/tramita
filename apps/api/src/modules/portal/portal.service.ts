import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { UpdateProfileBody } from './portal.schema'

export async function updateClientProfile(clientId: string, data: UpdateProfileBody) {
  const updateData: { whatsapp?: string; passwordHash?: string } = {}
  if (data.whatsapp !== undefined) updateData.whatsapp = data.whatsapp
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10)

  return prisma.client.update({
    where: { id: clientId },
    data: updateData,
    select: { id: true, name: true, email: true, whatsapp: true },
  })
}

export async function getTaskHistory(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })
}
