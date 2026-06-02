import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateClientBody, UpdateClientBody } from './clients.schema'

const SELECT = {
  id: true, name: true, cnpj: true, email: true, whatsapp: true, isActive: true, createdAt: true,
}

export async function listClients(organizationId: string) {
  return prisma.client.findMany({
    where: { organizationId, isActive: true },
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
      cnpj: data.cnpj,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      whatsapp: data.whatsapp,
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
