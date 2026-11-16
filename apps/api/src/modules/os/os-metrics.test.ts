import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

const at = (s: string) => new Date(`${s}T13:00:00.000Z`)

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Caio' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, dept.id, admin.id)
  const model = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: dept.id, name: 'Recálculo', deadlineBusinessDays: 3, usableStandalone: true, usableInProcess: true } })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  return { org, admin, member, client, model, auth, memberAuth: await getAuthHeader(member.email, 'Test@1234') }
}

describe('tempo por etapa', () => {
  it('counts business days of each OS in each column (holiday in the middle)', async () => {
    const c = await setup()
    const t = JSON.parse((await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'P', columns: [{ title: 'Análise', statusEffect: 'OPEN', documents: [] }, { title: 'Prefeitura', statusEffect: 'NONE', documents: [] }, { title: 'Feito', statusEffect: 'DONE', documents: [] }], items: [{ osModelId: c.model.id, columnIndex: 0, dependsOn: [] }] } })).body)
    const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })).body)
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const done = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, title: 'Feito' } })
    await prisma.task.update({ where: { id: os.id }, data: { createdAt: at('2026-11-16'), releasedAt: at('2026-11-16'), status: 'DONE', completedAt: at('2026-11-23'), columnId: done.id } })
    await prisma.taskHistory.deleteMany({ where: { taskId: os.id } })
    await prisma.taskHistory.createMany({ data: [
      { taskId: os.id, action: 'moved_to', fromValue: 'Análise', toValue: 'Prefeitura', actorType: 'user', actorId: c.admin.id, actorName: 'Bruna', createdAt: at('2026-11-18') },
      { taskId: os.id, action: 'moved_to', fromValue: 'Prefeitura', toValue: 'Feito', actorType: 'user', actorId: c.admin.id, actorName: 'Bruna', createdAt: at('2026-11-23') },
    ] })
    const res = JSON.parse((await app.inject({ method: 'GET', url: `/boards/${board.id}/stage-times`, headers: { authorization: c.auth } })).body)
    expect(res.columns.map((col: { title: string; totalBusinessDays: number }) => [col.title, col.totalBusinessDays])).toEqual([['Análise', 2], ['Prefeitura', 2], ['Feito', 0]])
    expect(res.os[0]).toMatchObject({ taskId: os.id, officeBusinessDays: 4, clientBusinessDays: 0, state: 'DONE' })
  })
})

describe('indicadores de OS no Dashboard', () => {
  it('counts delays by reason, pending reasons and average days per model', async () => {
    const c = await setup()
    const reasons = JSON.parse((await app.inject({ method: 'GET', url: '/delay-reasons', headers: { authorization: c.auth } })).body) as { id: string; name: string }[]
    const open = async () => JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body) as { id: string }
    const a = await open()
    const b = await open()
    const p = await open()
    await prisma.task.update({ where: { id: a.id }, data: { status: 'DONE', releasedAt: at('2026-11-02'), completedAt: at('2026-11-10'), delayReasonId: reasons[0].id } })
    await prisma.task.update({ where: { id: b.id }, data: { status: 'DONE', releasedAt: at('2026-11-09'), completedAt: at('2026-11-11') } })
    await prisma.task.update({ where: { id: p.id }, data: { status: 'DONE', releasedAt: at('2026-11-02'), completedAt: at('2026-11-12'), delayReasonPending: true } })
    const res = JSON.parse((await app.inject({ method: 'GET', url: '/dashboard/os?from=2026-11-01&to=2026-11-30', headers: { authorization: c.auth } })).body)
    expect(res.delaysByReason).toEqual([{ reasonId: reasons[0].id, name: reasons[0].name, count: 1 }])
    expect(res.pendingReasons).toBe(1)
    const model = res.byModel.find((m: { kind: string; id: string }) => m.kind === 'OS' && m.id === c.model.id)
    expect(model).toMatchObject({ name: 'Recálculo', count: 3, lateCount: 2 })
    expect(model.avgOfficeBusinessDays).toBeGreaterThan(0)
  })

  it('a member only counts the OS of their scope', async () => {
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    await prisma.task.update({ where: { id: os.id }, data: { status: 'DONE', completedAt: at('2026-11-10'), delayReasonPending: true } })
    const res = JSON.parse((await app.inject({ method: 'GET', url: '/dashboard/os?from=2026-11-01&to=2026-11-30', headers: { authorization: c.memberAuth } })).body)
    expect(res.pendingReasons).toBe(0)
    expect(res.byModel).toEqual([])
  })
})
