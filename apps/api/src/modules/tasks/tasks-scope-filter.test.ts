import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import { insertProtocol } from '@/modules/protocols/protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, createTestTask, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// Recurring tasks of client A: Fiscal (bruna), Fiscal (carlos), Folha (dani); one unpaid guide on each.
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const contabil = await createTestDepartment(org.id, { name: 'Contábil' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
  const brunaSem = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id], seesDepartmentWork: false })
  const gerente = await createTestUser(org.id, { role: 'ORG_MANAGER', departmentIds: [fiscal.id, folha.id] })
  const a = await createTestClient(org.id)
  await serveClientDepartment(a.id, fiscal.id, carlos.id)
  await serveClientDepartment(a.id, folha.id, dani.id)
  const rec = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: a.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
  const mk = async (title: string, departmentId: string, assigneeId: string) => {
    const t = await createTestTask(rec.columns[0].id, admin.id, { departmentId, title })
    await prisma.task.update({ where: { id: t.id }, data: { assigneeId } })
    await insertProtocol({ organizationId: org.id, clientId: a.id, taskId: t.id, title: `Guia ${title}`, content: 'x', createdById: admin.id, requiresPayment: true, amount: '10.00' })
    return t
  }
  await mk('Fiscal Bruna', fiscal.id, bruna.id)
  await mk('Fiscal Carlos', fiscal.id, carlos.id)
  await mk('Folha Dani', folha.id, dani.id)
  return {
    fiscal, folha, contabil,
    auth: {
      admin: await getAuthHeader(admin.email, 'Test@1234'),
      bruna: await getAuthHeader(bruna.email, 'Test@1234'),
      brunaSem: await getAuthHeader(brunaSem.email, 'Test@1234'),
      gerente: await getAuthHeader(gerente.email, 'Test@1234'),
    },
  }
}

const tasks = async (auth: string, qs = '') =>
  (JSON.parse((await app.inject({ method: 'GET', url: `/tasks?boardType=RECURRING_SYSTEM${qs}`, headers: { authorization: auth } })).body).items as { title: string }[])
    .map((t) => t.title).sort()
const guides = async (auth: string, qs = '') =>
  (JSON.parse((await app.inject({ method: 'GET', url: `/protocols/unpaid?x=1${qs}`, headers: { authorization: auth } })).body) as { title: string }[])
    .map((g) => g.title).sort()

describe('filtro Minhas / Meu departamento / Todas', () => {
  it('member: mine shows only my tasks, department shows the colleagues of my department', async () => {
    const c = await setup()
    expect(await tasks(c.auth.bruna, '&scope=mine')).toEqual(['Fiscal Bruna'])
    expect(await tasks(c.auth.bruna, '&scope=department')).toEqual(['Fiscal Bruna', 'Fiscal Carlos'])
    expect(await tasks(c.auth.bruna)).toEqual(['Fiscal Bruna', 'Fiscal Carlos']) // default: department reach
  })

  it('member with "see colleagues" off: department is the same as mine', async () => {
    const c = await setup()
    expect(await tasks(c.auth.brunaSem, '&scope=department')).toEqual([])
  })

  it('manager of two departments: both, one, or none when the department is not theirs', async () => {
    const c = await setup()
    expect(await tasks(c.auth.gerente, '&scope=department')).toEqual(['Fiscal Bruna', 'Fiscal Carlos', 'Folha Dani'])
    expect(await tasks(c.auth.gerente, `&scope=department&departmentId=${c.fiscal.id}`)).toEqual(['Fiscal Bruna', 'Fiscal Carlos'])
    expect(await tasks(c.auth.gerente, `&scope=department&departmentId=${c.contabil.id}`)).toEqual([])
  })

  it('"all" is only for admins (others get their department)', async () => {
    const c = await setup()
    expect(await tasks(c.auth.admin, '&scope=all')).toEqual(['Fiscal Bruna', 'Fiscal Carlos', 'Folha Dani'])
    expect(await tasks(c.auth.bruna, '&scope=all')).toEqual(['Fiscal Bruna', 'Fiscal Carlos'])
  })

  it('unpaid guides follow the same filter', async () => {
    const c = await setup()
    expect(await guides(c.auth.bruna, '&scope=mine')).toEqual(['Guia Fiscal Bruna'])
    expect(await guides(c.auth.bruna, '&scope=department')).toEqual(['Guia Fiscal Bruna', 'Guia Fiscal Carlos'])
    expect(await guides(c.auth.gerente, `&scope=department&departmentId=${c.contabil.id}`)).toEqual([])
    expect(await guides(c.auth.admin)).toEqual(['Guia Fiscal Bruna', 'Guia Fiscal Carlos', 'Guia Folha Dani'])
  })
})
