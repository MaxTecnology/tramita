import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as sse from '@/lib/sse'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, createTestTask, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
})

// Recurring tasks of client ACME: carlos has 3 open Fiscal + 1 open Folha + 1 done Fiscal.
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carlos', departmentIds: [fiscal.id, folha.id] })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani', departmentIds: [folha.id] })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna', departmentIds: [fiscal.id] })
  const brunaSem = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id], seesDepartmentWork: false })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(acme.id, fiscal.id, carlos.id)
  await serveClientDepartment(acme.id, folha.id, dani.id)
  const rec = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: acme.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
  const mk = async (title: string, departmentId: string, status: 'OPEN' | 'DONE' = 'OPEN') => {
    const t = await createTestTask(rec.columns[0].id, admin.id, { departmentId, title })
    return prisma.task.update({ where: { id: t.id }, data: { assigneeId: carlos.id, status } })
  }
  const f1 = await mk('F1', fiscal.id)
  const f2 = await mk('F2', fiscal.id)
  const f3 = await mk('F3', fiscal.id)
  const p1 = await mk('P1', folha.id)
  const done = await mk('Feita', fiscal.id, 'DONE')
  return {
    org, fiscal, folha, carlos, dani, bruna, f1, f2, f3, p1, done,
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    brunaSemAuth: await getAuthHeader(brunaSem.email, 'Test@1234'),
    carlosAuth: await getAuthHeader(carlos.email, 'Test@1234'),
  }
}

const assume = (taskId: string, auth: string, expectedAssigneeId: string | null) =>
  app.inject({ method: 'POST', url: `/tasks/${taskId}/assume`, headers: { authorization: auth }, payload: { expectedAssigneeId } })

describe('assumir uma tarefa', () => {
  it('a colleague assumes: assignee, history and a notice to the previous one', async () => {
    const c = await setup()
    const res = await assume(c.f1.id, c.brunaAuth, c.carlos.id)
    expect(res.statusCode).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.f1.id } })).assigneeId).toBe(c.bruna.id)
    const history = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: c.f1.id, action: 'assumed' } })
    expect([history.fromValue, history.toValue]).toEqual([c.carlos.id, c.bruna.id])
    expect(queue.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      event: 'TASK_ASSUMED', recipientType: 'USER', userId: c.carlos.id,
      metadata: expect.objectContaining({ taskTitle: 'F1', clientName: 'ACME', assumedByName: 'Bruna' }),
    }))
  })

  it('two colleagues at once: one wins, the other gets 409', async () => {
    const c = await setup()
    const other = await createTestUser(c.org.id, { role: 'ORG_MEMBER', departmentIds: [c.fiscal.id] })
    const otherAuth = await getAuthHeader(other.email, 'Test@1234')
    const results = await Promise.all([assume(c.f1.id, c.brunaAuth, c.carlos.id), assume(c.f1.id, otherAuth, c.carlos.id)])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409])
    expect(JSON.parse(results.find((r) => r.statusCode === 409)!.body).message).toBe('Essa tarefa já foi assumida por outra pessoa')
  })

  it('refuses a done task, a task of another department, my own task, and a member without "see colleagues"', async () => {
    const c = await setup()
    expect((await assume(c.done.id, c.brunaAuth, c.carlos.id)).statusCode).toBe(409)
    const folha = await assume(c.p1.id, c.brunaAuth, c.carlos.id)
    expect(folha.statusCode).toBe(404) // not visible to a Fiscal member
    expect((await assume(c.f1.id, c.carlosAuth, c.carlos.id)).statusCode).toBe(409)
    expect((await assume(c.f1.id, c.brunaSemAuth, c.carlos.id)).statusCode).toBe(404)
  })
})

describe('assumir em lote', () => {
  it('takes only the open tasks of my departments and sends one notice', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'POST', url: '/tasks/assume-bulk', headers: { authorization: c.brunaAuth }, payload: { fromUserId: c.carlos.id } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ count: 3 })
    const mine = await prisma.task.findMany({ where: { assigneeId: c.bruna.id }, select: { title: true } })
    expect(mine.map((t) => t.title).sort()).toEqual(['F1', 'F2', 'F3'])
    expect(vi.mocked(queue.enqueueNotification).mock.calls.filter(([n]) => n.event === 'TASK_ASSUMED')).toHaveLength(1)
  })
})

describe('passar tarefa para colega', () => {
  it('a member passes their task to someone of its department, not outside it', async () => {
    const c = await setup()
    await prisma.task.update({ where: { id: c.f1.id }, data: { assigneeId: c.bruna.id } })
    const patch = (assigneeId: string) => app.inject({ method: 'PATCH', url: `/tasks/${c.f1.id}`, headers: { authorization: c.brunaAuth }, payload: { assigneeId } })

    const outside = await patch(c.dani.id)
    expect(outside.statusCode).toBe(400)
    expect(JSON.parse(outside.body).message).toBe('Só é possível passar a tarefa para alguém do departamento dela')
    expect((await patch(c.carlos.id)).statusCode).toBe(200)
  })
})
