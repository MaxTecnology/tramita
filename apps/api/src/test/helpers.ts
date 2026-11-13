import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import type { LoginResponse } from '@/modules/auth/auth.types'
import { createRequest } from '@/modules/requests/requests.service'
import { createAssignment } from '@/modules/recurring-templates/recurring-templates.service'

export async function createTestPlan(overrides?: Partial<{ name: string; maxClients: number }>) {
  return prisma.plan.create({
    data: {
      name: overrides?.name ?? 'Test Plan',
      maxClients: overrides?.maxClients ?? 50,
      priceMonthly: 197.0,
      features: { pdf: true, sse: true, attachments: true },
      isActive: true,
    },
  })
}

let testOrgCounter = 0

export async function createTestOrg(
  planId: string,
  overrides?: Partial<{ slug: string; isActive: boolean; subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' | 'CANCELLED' }>,
) {
  const unique = `${Date.now()}-${++testOrgCounter}`
  return prisma.organization.create({
    data: {
      name: 'Test Org',
      slug: overrides?.slug ?? `test-org-${unique}`,
      email: `org-${unique}@test.com`,
      planId,
      isActive: overrides?.isActive ?? true,
      subscriptionStatus: overrides?.subscriptionStatus ?? 'ACTIVE',
    },
  })
}

let testUserCounter = 0

export async function createTestUser(
  organizationId: string,
  overrides?: Partial<{
    role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
    email: string
    password: string
    phone: string
    isActive: boolean
    name: string
    departmentIds: string[]
    seesDepartmentWork: boolean
  }>,
) {
  const password = overrides?.password ?? 'Test@1234'
  return prisma.user.create({
    data: {
      name: overrides?.name ?? 'Test User',
      email: overrides?.email ?? `user-${Date.now()}-${++testUserCounter}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      role: overrides?.role ?? 'ORG_ADMIN',
      phone: overrides?.phone,
      isActive: overrides?.isActive ?? true,
      seesDepartmentWork: overrides?.seesDepartmentWork ?? true,
      organizationId,
      ...(overrides?.departmentIds?.length
        ? { departments: { create: overrides.departmentIds.map((departmentId) => ({ departmentId })) } }
        : {}),
    },
  })
}

export async function addUserToDepartment(userId: string, departmentId: string) {
  return prisma.userDepartment.upsert({
    where: { userId_departmentId: { userId, departmentId } },
    update: {},
    create: { userId, departmentId },
  })
}

// CNPJ com dígitos verificadores válidos derivado de um seed — cada seed gera um CNPJ diferente,
// pra que clientes de teste não colidam no índice único de CNPJ entre ativos.
export function generateValidCnpj(seed: number): string {
  const base = String(seed % 1e12).padStart(12, '0').replace(/^0/, '1')
  const dv = (digits: string) => {
    const weights = digits.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(base)
  const d2 = dv(base + d1)
  return `${base}${d1}${d2}`
}

let testClientCounter = 0

export async function createTestClient(
  organizationId: string,
  overrides: Partial<{ isActive: boolean; name: string; codigo: string; cnpj: string }> = {},
) {
  const n = ++testClientCounter
  return prisma.client.create({
    data: {
      name: overrides.name ?? 'Test Client',
      organizationId,
      isActive: overrides.isActive ?? true,
      clientType: 'PJ',
      codigo: overrides.codigo ?? `C-${Date.now()}-${n}`,
      cnpj: overrides.cnpj ?? generateValidCnpj(Date.now() * 1000 + n),
    },
  })
}

let testClientUserCounter = 0

export async function createTestClientUser(
  organizationId: string,
  overrides?: Partial<{ name: string; email: string; password: string; isActive: boolean }>,
) {
  const password = overrides?.password ?? 'ClientUser@1234'
  const clientUser = await prisma.clientUser.create({
    data: {
      name: overrides?.name ?? 'Test Client User',
      email: overrides?.email ?? `client-user-${Date.now()}-${++testClientUserCounter}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      isActive: overrides?.isActive ?? true,
      organizationId,
    },
  })
  return { clientUser, password }
}

// Declara que o departamento atende o cliente, com o responsável do escritório (ClientAssignment).
export async function serveClientDepartment(clientId: string, departmentId: string, responsibleUserId: string) {
  // The responsible of a department must belong to it (admins are exempt)
  const responsible = await prisma.user.findUniqueOrThrow({ where: { id: responsibleUserId }, select: { role: true } })
  if (responsible.role !== 'ORG_ADMIN') await addUserToDepartment(responsibleUserId, departmentId)
  return prisma.clientAssignment.create({ data: { clientId, departmentId, userId: responsibleUserId } })
}

export async function grantClientAccess(clientUserId: string, clientId: string, departmentId: string) {
  return prisma.clientUserAccess.create({ data: { clientUserId, clientId, departmentId } })
}

// Returns { user, password } so the test can call loginAs(user.email, password)
export async function createMasterUser() {
  const plan = await createTestPlan({ name: 'Master Plan' })
  const org = await prisma.organization.create({
    data: {
      name: 'AutoHubs Test',
      slug: `autohubs-${Date.now()}`,
      email: `autohubs-${Date.now()}@test.com`,
      planId: plan.id,
      subscriptionStatus: 'ACTIVE',
    },
  })
  const password = 'Master@Test123'
  const user = await prisma.user.create({
    data: {
      name: 'Master Test',
      email: `master-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'MASTER',
      organizationId: org.id,
    },
  })
  return { user, password }
}

export async function createTestBoard(organizationId: string, clientId: string) {
  return prisma.board.create({
    data: {
      title: 'Test Board',
      organizationId,
      clientId,
    },
  })
}

export async function createTestColumn(
  boardId: string,
  overrides?: Partial<{ title: string; statusEffect: 'NONE' | 'OPEN' | 'STARTED' | 'BLOCKED' | 'DISREGARDED' | 'DONE'; position: number }>,
) {
  return prisma.column.create({
    data: {
      title: overrides?.title ?? (overrides?.statusEffect === 'DONE' ? 'Concluído' : 'Em Andamento'),
      position: overrides?.position ?? 0,
      statusEffect: overrides?.statusEffect ?? 'NONE',
      boardId,
    },
  })
}

export async function createTestTask(
  columnId: string,
  creatorId: string,
  overrides?: Partial<{ title: string; position: number; priority: string; departmentId: string }>,
) {
  const departmentId = overrides?.departmentId ?? (await defaultDepartmentForColumn(columnId))
  return prisma.task.create({
    data: {
      title: overrides?.title ?? 'Test Task',
      priority: (overrides?.priority as any) ?? 'MEDIUM',
      position: overrides?.position ?? 0,
      columnId,
      creatorId,
      departmentId,
    },
  })
}

async function defaultDepartmentForColumn(columnId: string): Promise<string> {
  const column = await prisma.column.findUniqueOrThrow({
    where: { id: columnId },
    select: { board: { select: { organizationId: true } } },
  })
  const organizationId = column.board.organizationId
  const existing = await prisma.department.findFirst({ where: { organizationId, name: 'Test Department (default)' } })
  if (existing) return existing.id
  const created = await prisma.department.create({ data: { organizationId, name: 'Test Department (default)' } })
  return created.id
}

let testDepartmentCounter = 0

export async function createTestDepartment(
  organizationId: string,
  overrides?: Partial<{ name: string }>,
) {
  return prisma.department.create({
    data: {
      // Date.now() sozinho colide quando dois departamentos são criados na mesma organização no
      // mesmo milissegundo (comum sob cobertura de testes no CI) — mesmo padrão de
      // Date.now()+contador já usado em createTestOrg acima.
      name: overrides?.name ?? `Test Department ${Date.now()}-${++testDepartmentCounter}`,
      organizationId,
    },
  })
}

// Convenience: returns "Bearer <accessToken>"
export async function getAuthHeader(email: string, password: string): Promise<string> {
  const res = await loginAs(email, password)
  return `Bearer ${res.accessToken}`
}

// One-time ticket for the SSE routes (EventSource can't send the Authorization header).
export async function getStreamTicket(authHeader: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/stream/ticket', headers: { authorization: authHeader } })
  return (JSON.parse(res.body) as { ticket: string }).ticket
}

export async function loginAs(email: string, password: string): Promise<LoginResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  })
  return JSON.parse(response.body) as LoginResponse
}

// Garante que o departamento atenda o cliente (ClientAssignment), usando o primeiro colaborador
// ativo da organização como responsável (ou criando um ORG_MEMBER, que não recebe notificações de
// fallback de admin).
export async function ensureServed(organizationId: string, clientId: string, departmentId: string) {
  const served = await prisma.clientAssignment.findUnique({
    where: { clientId_departmentId: { clientId, departmentId } },
  })
  if (served) return served
  const staff = await prisma.user.findFirst({
    where: { organizationId, isActive: true, role: { in: ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] } },
    orderBy: { createdAt: 'asc' },
  })
  const responsible = staff ?? (await createTestUser(organizationId, { role: 'ORG_MEMBER' }))
  return serveClientDepartment(clientId, departmentId, responsible.id)
}

export async function createTestRecurringAssignment(templateId: string, organizationId: string, data: { clientId: string }) {
  const template = await prisma.recurringTaskTemplate.findUniqueOrThrow({ where: { id: templateId } })
  await ensureServed(organizationId, data.clientId, template.departmentId)
  return createAssignment(templateId, organizationId, data)
}

// Garante que o cliente tenha um departamento atendido (com responsável) e um usuário do portal com
// acesso a ele — pré-requisito de toda solicitação (I6). Reaproveita o que já existir.
export async function ensurePortalAccess(organizationId: string, clientId: string, departmentId?: string) {
  let resolvedDepartmentId = departmentId
  if (!resolvedDepartmentId) {
    const existing = await prisma.clientAssignment.findFirst({ where: { clientId }, orderBy: { createdAt: 'asc' } })
    resolvedDepartmentId = existing?.departmentId ?? (await createTestDepartment(organizationId)).id
  }

  await ensureServed(organizationId, clientId, resolvedDepartmentId)

  let access = await prisma.clientUserAccess.findFirst({
    where: { clientId, departmentId: resolvedDepartmentId, clientUser: { isActive: true } },
  })
  if (!access) {
    const { clientUser } = await createTestClientUser(organizationId)
    access = await grantClientAccess(clientUser.id, clientId, resolvedDepartmentId)
  }

  return { departmentId: resolvedDepartmentId, clientUserId: access.clientUserId }
}

export async function createTestRequest(
  organizationId: string,
  clientId: string,
  data: { title: string; description?: string; departmentId?: string; osTemplateId?: string },
) {
  const { departmentId, clientUserId } = await ensurePortalAccess(organizationId, clientId, data.departmentId)
  return createRequest(organizationId, clientId, clientUserId, { ...data, departmentId })
}

// Usuário do portal com acesso ao departamento (e telefone, se informado) — destinatário das
// notificações ao cliente, que vão por departamento.
export async function createTestPortalRecipient(organizationId: string, clientId: string, departmentId: string, phone?: string) {
  const { clientUser } = await createTestClientUser(organizationId)
  if (phone) await prisma.clientUser.update({ where: { id: clientUser.id }, data: { phone } })
  await grantClientAccess(clientUser.id, clientId, departmentId)
  return clientUser
}
