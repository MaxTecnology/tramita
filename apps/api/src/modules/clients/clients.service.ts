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
      departmentId: true,
      userId: true,
      department: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  })
}

export async function setAssignment(
  clientId: string,
  organizationId: string,
  departmentId: string,
  userId: string | null,
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId } })
  if (!department) throw new AppError(404, 'Departamento não encontrado')

  if (userId === null) {
    await prisma.clientAssignment.deleteMany({ where: { clientId, departmentId } })
    return listAssignments(clientId, organizationId)
  }

  const validUser = await prisma.user.findFirst({
    where: { id: userId, organizationId, isActive: true },
    select: { id: true },
  })
  if (!validUser) throw new AppError(400, 'Usuário inválido')

  await prisma.clientAssignment.upsert({
    where: { clientId_departmentId: { clientId, departmentId } },
    update: { userId },
    create: { clientId, departmentId, userId },
  })

  return listAssignments(clientId, organizationId)
}
