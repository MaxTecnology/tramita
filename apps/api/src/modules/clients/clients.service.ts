import axios from 'axios'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { lookupCnpj, type CnpjLookupResult } from '@/lib/cnpjws'
import type { CreateClientBody, UpdateClientBody } from './clients.schema'

const SELECT = {
  id: true, name: true, clientType: true, cnpj: true, cpf: true,
  whatsapp: true, phone: true, notes: true,
  cep: true, estado: true, cidade: true, bairro: true, logradouro: true, numero: true, complemento: true,
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
  return prisma.client.create({
    data: {
      name: data.name,
      clientType: data.clientType ?? 'PJ',
      cnpj: data.cnpj,
      cpf: data.cpf,
      whatsapp: data.whatsapp,
      phone: data.phone,
      notes: data.notes,
      cep: data.cep,
      estado: data.estado,
      cidade: data.cidade,
      bairro: data.bairro,
      logradouro: data.logradouro,
      numero: data.numero,
      complemento: data.complemento,
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

export async function lookupClientByCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) throw new AppError(400, 'CNPJ inválido')

  try {
    return await lookupCnpj(digits)
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 429) throw new AppError(429, 'Limite de consultas de CNPJ atingido, tente novamente em instantes')
      if (err.response?.status === 404) throw new AppError(404, 'CNPJ não encontrado')
    }
    throw new AppError(502, 'Erro ao consultar CNPJ')
  }
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
