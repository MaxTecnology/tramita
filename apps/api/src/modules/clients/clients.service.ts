import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { lookupCnpj, CnpjNotFoundError, CnpjUnavailableError, type CnpjLookupResult } from '@/lib/cnpj-lookup'
import { isUf } from '@/lib/uf'
import { z } from 'zod'
import { redis } from '@/lib/redis'
import { logger } from '@/lib/logger'
import { findMunicipality, findMunicipalityByName } from '@/modules/municipalities/municipalities.service'
import { hashPassword } from '@/modules/auth/auth.service'
import { normalizarTelefoneBr } from '@/lib/phone'
import type { ClientBody } from './clients.schema'
import { assertCanUnserveDepartments, assertPayloadCoverage, lockClients, lockUsersForShare } from './client-coverage'

const SELECT = {
  id: true, name: true, codigo: true, clientType: true, cnpj: true, cpf: true,
  cei: true, caepf: true, inscricaoEstadual: true,
  whatsapp: true, phone: true, notes: true,
  cep: true, estado: true, cidade: true, ibgeCityCode: true, bairro: true, logradouro: true, numero: true, complemento: true,
  isActive: true, createdAt: true,
}

export async function listClients(organizationId: string, includeInactive = false) {
  const clients = await prisma.client.findMany({
    where: {
      organizationId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: { ...SELECT, clientAssignments: { select: { departmentId: true } } },
    orderBy: { name: 'asc' },
  })
  // servedDepartmentIds: departamentos que atendem o cliente — as telas usam pra só oferecer
  // vínculos/acessos válidos (ex.: vincular cliente a template recorrente).
  return clients.map(({ clientAssignments, ...client }) => ({
    ...client,
    servedDepartmentIds: clientAssignments.map((a) => a.departmentId),
  }))
}

interface ClientUserAccessPair {
  clientUserId: string
  departmentId: string
}

async function upsertClientUserLinks(
  tx: Prisma.TransactionClient,
  clientId: string,
  organizationId: string,
  links: ClientBody['clientUsers'],
): Promise<ClientUserAccessPair[]> {
  const resolvedPairs: ClientUserAccessPair[] = []

  for (const link of links) {
    let clientUserId: string
    if ('existingId' in link) {
      const existing = await tx.clientUser.findFirst({ where: { id: link.existingId, organizationId } })
      if (!existing) throw new AppError(404, 'Usuário de cliente não encontrado')
      clientUserId = existing.id
    } else {
      const dup = await tx.clientUser.findFirst({ where: { email: link.email, organizationId } })
      if (dup) throw new AppError(409, `E-mail ${link.email} já cadastrado nesta organização`)
      const created = await tx.clientUser.create({
        data: {
          name: link.name,
          email: link.email,
          phone: link.phone ? normalizarTelefoneBr(link.phone) : null,
          passwordHash: await hashPassword(link.password),
          organizationId,
        },
      })
      clientUserId = created.id
    }

    const departments = await tx.department.findMany({ where: { id: { in: link.departmentIds }, organizationId } })
    if (departments.length !== link.departmentIds.length) throw new AppError(404, 'Departamento não encontrado')

    for (const departmentId of link.departmentIds) {
      await tx.clientUserAccess.upsert({
        where: { clientUserId_clientId_departmentId: { clientUserId, clientId, departmentId } },
        update: {},
        create: { clientUserId, clientId, departmentId },
      })
      resolvedPairs.push({ clientUserId, departmentId })
    }
  }

  return resolvedPairs
}

const ORG_STAFF_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

// Índices únicos parciais entre clientes ativos (migration 20261111120000_client_required_fields).
// Colisão é esperada (duplo cadastro, typo) — nunca pode virar 500.
const DUPLICATE_MESSAGES: Record<string, string> = {
  clients_codigo_active_key: 'Já existe um cliente com este código nesta organização',
  clients_cnpj_active_key: 'Já existe um cliente ativo com este CNPJ nesta organização',
  clients_cpf_active_key: 'Já existe um cliente ativo com este CPF nesta organização',
}

function duplicateMessage(err: unknown): string | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null
  const target = err.meta?.target
  const names = Array.isArray(target) ? (target as string[]) : [String(target ?? '')]
  const text = `${names.join(',')} ${err.message}`
  for (const [index, message] of Object.entries(DUPLICATE_MESSAGES)) {
    if (text.includes(index)) return message
  }
  if (names.includes('codigo')) return DUPLICATE_MESSAGES.clients_codigo_active_key
  if (names.includes('cnpj')) return DUPLICATE_MESSAGES.clients_cnpj_active_key
  if (names.includes('cpf')) return DUPLICATE_MESSAGES.clients_cpf_active_key
  return null
}

async function resolveDepartmentNames(
  tx: Prisma.TransactionClient,
  organizationId: string,
  data: ClientBody,
): Promise<Map<string, string>> {
  const ids = [...new Set([
    ...data.departments.map((d) => d.departmentId),
    ...data.clientUsers.flatMap((u) => u.departmentIds),
  ])]
  const departments = await tx.department.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true } })
  if (departments.length !== ids.length) throw new AppError(404, 'Departamento não encontrado')
  return new Map(departments.map((d) => [d.id, d.name]))
}

async function findInactiveExistingUserIds(
  tx: Prisma.TransactionClient,
  organizationId: string,
  clientUsers: ClientBody['clientUsers'],
): Promise<Set<string>> {
  const ids = clientUsers.flatMap((u) => ('existingId' in u ? [u.existingId] : []))
  if (ids.length === 0) return new Set()
  const inactive = await tx.clientUser.findMany({
    where: { id: { in: ids }, organizationId, isActive: false },
    select: { id: true },
  })
  return new Set(inactive.map((u) => u.id))
}

async function assertResponsiblesValid(
  tx: Prisma.TransactionClient,
  organizationId: string,
  departments: ClientBody['departments'],
  departmentNames: Map<string, string>,
) {
  const userIds = [...new Set(departments.map((d) => d.responsibleUserId))]
  await lockUsersForShare(tx, userIds) // nobody deactivates them until this client is saved
  const valid = await tx.user.findMany({
    where: { id: { in: userIds }, organizationId, isActive: true, role: { in: [...ORG_STAFF_ROLES] } },
    select: { id: true, name: true, role: true, departments: { select: { departmentId: true } } },
  })
  const byId = new Map(valid.map((u) => [u.id, u]))
  for (const d of departments) {
    const user = byId.get(d.responsibleUserId)
    if (!user) {
      throw new AppError(400, `Responsável inválido para o departamento ${departmentNames.get(d.departmentId) ?? ''}`)
    }
    // The responsible must belong to the department (admins are exempt)
    if (user.role !== 'ORG_ADMIN' && !user.departments.some((m) => m.departmentId === d.departmentId)) {
      throw new AppError(400, `${user.name} não pertence ao departamento ${departmentNames.get(d.departmentId) ?? ''}`)
    }
  }
}

async function syncServedDepartments(tx: Prisma.TransactionClient, clientId: string, departments: ClientBody['departments']) {
  await tx.clientAssignment.deleteMany({
    where: { clientId, departmentId: { notIn: departments.map((d) => d.departmentId) } },
  })
  for (const d of departments) {
    await tx.clientAssignment.upsert({
      where: { clientId_departmentId: { clientId, departmentId: d.departmentId } },
      update: { userId: d.responsibleUserId },
      create: { clientId, departmentId: d.departmentId, userId: d.responsibleUserId },
    })
  }
}

function companyData(data: ClientBody, cidade: string) {
  const { departments: _departments, clientUsers: _clientUsers, ...company } = data
  return { ...company, cidade }
}

// The client's city must exist and belong to the informed state; its name comes from the table
async function resolveClientCity(estado: string, ibgeCityCode: number): Promise<string> {
  const city = await findMunicipality(ibgeCityCode)
  if (!city) throw new AppError(400, 'Cidade não encontrada')
  if (city.uf !== estado) throw new AppError(400, 'A cidade não pertence ao estado informado')
  return city.name
}

export async function createClient(organizationId: string, data: ClientBody) {
  const cidade = await resolveClientCity(data.estado, data.ibgeCityCode)
  try {
    return await prisma.$transaction(async (tx) => {
      const departmentNames = await resolveDepartmentNames(tx, organizationId, data)
      await assertResponsiblesValid(tx, organizationId, data.departments, departmentNames)
      assertPayloadCoverage(
        data.departments, data.clientUsers, departmentNames,
        await findInactiveExistingUserIds(tx, organizationId, data.clientUsers),
      )

      const client = await tx.client.create({ data: { ...companyData(data, cidade), organizationId } })
      await syncServedDepartments(tx, client.id, data.departments)
      await upsertClientUserLinks(tx, client.id, organizationId, data.clientUsers)

      return tx.client.findUniqueOrThrow({ where: { id: client.id }, select: SELECT })
    })
  } catch (err) {
    const message = duplicateMessage(err)
    if (message) throw new AppError(409, message)
    throw err
  }
}

export async function updateClient(id: string, organizationId: string, data: ClientBody) {
  const cidade = await resolveClientCity(data.estado, data.ibgeCityCode)
  try {
    return await prisma.$transaction(async (tx) => {
      await lockClients(tx, [id]) // serializes with task creation and client-user changes of this client
      const client = await tx.client.findFirst({ where: { id, organizationId, isActive: true } })
      if (!client) throw new AppError(404, 'Cliente não encontrado')

      const departmentNames = await resolveDepartmentNames(tx, organizationId, data)
      await assertResponsiblesValid(tx, organizationId, data.departments, departmentNames)
      assertPayloadCoverage(
        data.departments, data.clientUsers, departmentNames,
        await findInactiveExistingUserIds(tx, organizationId, data.clientUsers),
      )

      const keep = new Set(data.departments.map((d) => d.departmentId))
      const current = await tx.clientAssignment.findMany({ where: { clientId: id }, select: { departmentId: true } })
      const removed = current.map((a) => a.departmentId).filter((departmentId) => !keep.has(departmentId))
      await assertCanUnserveDepartments(tx, id, removed)

      const updated = await tx.client.update({ where: { id }, data: companyData(data, cidade), select: SELECT })
      await syncServedDepartments(tx, id, data.departments)

      const resolvedPairs = await upsertClientUserLinks(tx, id, organizationId, data.clientUsers)
      await tx.clientUserAccess.deleteMany({
        where: {
          clientId: id,
          NOT: { OR: resolvedPairs.map((p) => ({ clientUserId: p.clientUserId, departmentId: p.departmentId })) },
        },
      })

      return updated
    })
  } catch (err) {
    const message = duplicateMessage(err)
    if (message) throw new AppError(409, message)
    throw err
  }
}

export async function deleteClient(id: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id, organizationId, isActive: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.client.update({ where: { id }, data: { isActive: false }, select: SELECT })
}

export async function lookupClientByCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) throw new AppError(400, 'CNPJ inválido')

  const cacheKey = `cnpj-lookup:${digits}`
  const cached = await readLookupCache(cacheKey)
  if (cached === 'NOT_FOUND') throw new AppError(404, 'CNPJ não encontrado')
  if (cached) return cached

  let found: CnpjLookupResult
  try {
    found = await lookupCnpj(digits)
  } catch (err) {
    if (err instanceof CnpjNotFoundError) {
      await writeLookupCache(cacheKey, 'NOT_FOUND', LOOKUP_NOT_FOUND_TTL_SECONDS)
      throw new AppError(404, 'CNPJ não encontrado')
    }
    if (err instanceof CnpjUnavailableError) {
      throw new AppError(502, 'Serviço de consulta de CNPJ indisponível no momento. Tente de novo ou preencha os dados à mão.')
    }
    throw err
  }
  const result = { ...found, ...(await resolveLookupCity(found)) }
  await writeLookupCache(cacheKey, result, LOOKUP_TTL_SECONDS)
  return result
}

// Company data barely changes: a CNPJ is asked outside once every few hours, which also keeps the
// shared quota of the outside services (one server IP) out of reach of repeated lookups. Redis
// down → no cache, never an error.
const LOOKUP_TTL_SECONDS = 6 * 3600
const LOOKUP_NOT_FOUND_TTL_SECONDS = 10 * 60
const cachedLookupSchema = z.union([
  z.literal('NOT_FOUND'),
  z.object({
    razaoSocial: z.string(), nomeFantasia: z.string().nullable(), cep: z.string().nullable(), estado: z.string().nullable(),
    cidade: z.string().nullable(), ibgeCityCode: z.number().int().nullable(), bairro: z.string().nullable(),
    logradouro: z.string().nullable(), numero: z.string().nullable(), complemento: z.string().nullable(),
  }),
])

async function readLookupCache(key: string): Promise<CnpjLookupResult | 'NOT_FOUND' | null> {
  try {
    const raw = await redis.get(key)
    if (!raw) return null
    const parsed = cachedLookupSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch (err) {
    logger.warn({ reason: err instanceof Error ? err.message : String(err) }, 'Cache da consulta de CNPJ indisponível')
    return null
  }
}

async function writeLookupCache(key: string, value: CnpjLookupResult | 'NOT_FOUND', ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch (err) {
    logger.warn({ reason: err instanceof Error ? err.message : String(err) }, 'Cache da consulta de CNPJ indisponível')
  }
}

// The city as the form will save it: the IBGE table's name and code, or no code (chosen by hand)
async function resolveLookupCity(found: CnpjLookupResult): Promise<{ cidade: string | null; ibgeCityCode: number | null }> {
  if (!isUf(found.estado)) return { cidade: found.cidade, ibgeCityCode: null }
  // By code first; a code the table does not know (or no code, reserve service) → by name + state
  const byCode = found.ibgeCityCode !== null ? await findMunicipality(found.ibgeCityCode) : null
  const city = byCode ?? (found.cidade ? await findMunicipalityByName(found.cidade, found.estado) : null)
  if (!city || city.uf !== found.estado) return { cidade: found.cidade, ibgeCityCode: null }
  return { cidade: city.name, ibgeCityCode: city.ibgeCode }
}

export async function searchClientUsers(organizationId: string, q: string) {
  return prisma.clientUser.findMany({
    where: {
      organizationId,
      isActive: true,
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
    take: 20,
  })
}

export async function listClientUserLinks(clientId: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const rows = await prisma.clientUserAccess.findMany({
    where: { clientId },
    select: {
      departmentId: true,
      clientUser: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
    },
  })

  const byClientUserId = new Map<string, { existingId: string; name: string; email: string; phone: string | null; isActive: boolean; departmentIds: string[] }>()
  for (const row of rows) {
    const existing = byClientUserId.get(row.clientUser.id)
    if (existing) {
      existing.departmentIds.push(row.departmentId)
    } else {
      byClientUserId.set(row.clientUser.id, {
        existingId: row.clientUser.id,
        name: row.clientUser.name,
        email: row.clientUser.email,
        phone: row.clientUser.phone,
        isActive: row.clientUser.isActive,
        departmentIds: [row.departmentId],
      })
    }
  }

  return Array.from(byClientUserId.values())
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
