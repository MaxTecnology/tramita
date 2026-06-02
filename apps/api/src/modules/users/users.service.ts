import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateUserBody, UpdateUserBody } from './users.schema'

const SELECT = {
  id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true,
}

export async function listUsers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: SELECT,
    orderBy: { createdAt: 'asc' },
  })
}

export async function createUser(organizationId: string, data: CreateUserBody) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')

  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      role: data.role,
      phone: data.phone,
      organizationId,
    },
    select: SELECT,
  })
}

export async function updateUser(id: string, organizationId: string, data: UpdateUserBody) {
  const user = await prisma.user.findFirst({ where: { id, organizationId, isActive: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  return prisma.user.update({ where: { id }, data, select: SELECT })
}

export async function deleteUser(id: string, organizationId: string) {
  const user = await prisma.user.findFirst({ where: { id, organizationId, isActive: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  return prisma.user.update({ where: { id }, data: { isActive: false }, select: SELECT })
}
