import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateClientBody, UpdateClientBody } from './clients.schema'

const SELECT = {
  id: true, name: true, clientType: true, cnpj: true, cpf: true,
  email: true, whatsapp: true, phone: true, notes: true,
  isActive: true, createdAt: true,
}

export async function listClients(organizationId: string, includeInactive = false) {
  return prisma.client.findMany({
    where: {
      organizationId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

export async function createClient(organizationId: string, data: CreateClientBody) {
  const existing = await prisma.client.findFirst({
    where: { email: data.email, organizationId },
  })
  if (existing) throw new AppError(409, 'E-mail já cadastrado nesta organização')

  return prisma.client.create({
    data: {
      name: data.name,
      clientType: data.clientType ?? 'PJ',
      cnpj: data.cnpj,
      cpf: data.cpf,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      whatsapp: data.whatsapp,
      phone: data.phone,
      notes: data.notes,
      organizationId,
    },
    select: SELECT,
  })
}

export async function updateClient(id: string, organizationId: string, data: UpdateClientBody) {
  const client = await prisma.client.findFirst({ where: { id, organizationId, isActive: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.client.update({ where: { id }, data, select: SELECT })
}

export async function deleteClient(id: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id, organizationId, isActive: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.client.update({ where: { id }, data: { isActive: false }, select: SELECT })
}

export async function listAssignments(clientId: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.clientAssignment.findMany({
    where: { clientId },
    select: {
      id: true,
      userId: true,
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  })
}

export async function setAssignments(clientId: string, organizationId: string, userIds: string[]) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  if (userIds.length > 0) {
    const validUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, organizationId, isActive: true },
      select: { id: true },
    })
    if (validUsers.length !== userIds.length) throw new AppError(400, 'Um ou mais usuários inválidos')
  }

  await prisma.$transaction([
    prisma.clientAssignment.deleteMany({ where: { clientId } }),
    ...(userIds.length > 0
      ? [prisma.clientAssignment.createMany({
          data: userIds.map((userId) => ({ clientId, userId })),
          skipDuplicates: true,
        })]
      : []),
  ])

  return listAssignments(clientId, organizationId)
}
