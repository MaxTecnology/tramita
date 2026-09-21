import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateClientUserBody, UpdateClientUserBody } from './client-users.schema'

const SELECT = {
  id: true, name: true, email: true, phone: true, isActive: true, createdAt: true,
  accesses: {
    select: {
      id: true,
      clientId: true,
      departmentId: true,
      client: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
}

async function assertAccessesBelongToOrg(accesses: { clientId: string; departmentId: string }[], organizationId: string) {
  const clientIds = [...new Set(accesses.map((a) => a.clientId))]
  const departmentIds = [...new Set(accesses.map((a) => a.departmentId))]

  const [clients, departments] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, organizationId }, select: { id: true } }),
    prisma.department.findMany({ where: { id: { in: departmentIds }, organizationId }, select: { id: true } }),
  ])

  if (clients.length !== clientIds.length) throw new AppError(404, 'Cliente não encontrado')
  if (departments.length !== departmentIds.length) throw new AppError(404, 'Departamento não encontrado')
}

export async function listClientUsers(organizationId: string) {
  return prisma.clientUser.findMany({
    where: { organizationId },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

export async function getClientUserById(id: string, organizationId: string) {
  const clientUser = await prisma.clientUser.findFirst({ where: { id, organizationId }, select: SELECT })
  if (!clientUser) throw new AppError(404, 'Usuário de cliente não encontrado')
  return clientUser
}

export async function createClientUser(organizationId: string, data: CreateClientUserBody) {
  const existing = await prisma.clientUser.findFirst({ where: { email: data.email, organizationId } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado nesta organização')

  await assertAccessesBelongToOrg(data.accesses, organizationId)

  return prisma.clientUser.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      phone: data.phone,
      isActive: data.isActive,
      organizationId,
      accesses: { create: data.accesses },
    },
    select: SELECT,
  })
}

export async function updateClientUser(id: string, organizationId: string, data: UpdateClientUserBody) {
  const clientUser = await prisma.clientUser.findFirst({ where: { id, organizationId } })
  if (!clientUser) throw new AppError(404, 'Usuário de cliente não encontrado')

  if (data.email && data.email !== clientUser.email) {
    const existing = await prisma.clientUser.findFirst({ where: { email: data.email, organizationId } })
    if (existing) throw new AppError(409, 'E-mail já cadastrado nesta organização')
  }

  if (data.accesses) await assertAccessesBelongToOrg(data.accesses, organizationId)

  return prisma.$transaction(async (tx) => {
    await tx.clientUser.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        isActive: data.isActive,
        ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
      },
    })

    if (data.accesses) {
      await tx.clientUserAccess.deleteMany({ where: { clientUserId: id } })
      await tx.clientUserAccess.createMany({ data: data.accesses.map((a) => ({ clientUserId: id, ...a })) })
    }

    return tx.clientUser.findUniqueOrThrow({ where: { id }, select: SELECT })
  })
}

export async function deleteClientUser(id: string, organizationId: string) {
  const clientUser = await prisma.clientUser.findFirst({ where: { id, organizationId } })
  if (!clientUser) throw new AppError(404, 'Usuário de cliente não encontrado')

  return prisma.clientUser.update({ where: { id }, data: { isActive: false }, select: SELECT })
}
