import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment,
  createTestBoard, createTestColumn, createTestTask, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined) })

// ACME is served only by Fiscal. Bruna (Fiscal) sends one task of the process to Edu (Contábil).
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const contabil = await createTestDepartment(org.id, { name: 'Contábil' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna', departmentIds: [fiscal.id] })
  const edu = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Edu', departmentIds: [contabil.id] })
  const gerenteContabil = await createTestUser(org.id, { role: 'ORG_MANAGER', departmentIds: [contabil.id] })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(acme.id, fiscal.id, bruna.id)
  const board = await createTestBoard(org.id, acme.id)
  const col = await createTestColumn(board.id, { position: 0 })
  const mine = await createTestTask(col.id, admin.id, { departmentId: fiscal.id, title: 'Conferir apuração' })
  const other = await createTestTask(col.id, admin.id, { departmentId: fiscal.id, title: 'Outra etapa' })
  await prisma.task.updateMany({ where: { id: { in: [mine.id, other.id] } }, data: { assigneeId: bruna.id } })
  return {
    fiscal, board, mine, other, edu,
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    eduAuth: await getAuthHeader(edu.email, 'Test@1234'),
    gerenteContabilAuth: await getAuthHeader(gerenteContabil.email, 'Test@1234'),
  }
}
type Ctx = Awaited<ReturnType<typeof setup>>
const send = (c: Ctx) => app.inject({ method: 'PATCH', url: `/tasks/${c.mine.id}`, headers: { authorization: c.brunaAuth }, payload: { assigneeId: c.edu.id } })
const listIds = async (auth: string) => (JSON.parse((await app.inject({ method: 'GET', url: '/tasks', headers: { authorization: auth } })).body) as { items: { id: string }[] }).items.map((t) => t.id)

describe('tarefa enviada para alguém de outro departamento', () => {
  it('the person who received it sees it and the process, and works on it; the task stays in Fiscal', async () => {
    const c = await setup()
    expect((await send(c)).statusCode).toBe(200)
    expect(await listIds(c.eduAuth)).toContain(c.mine.id)
    expect((await app.inject({ method: 'GET', url: `/boards/${c.board.id}`, headers: { authorization: c.eduAuth } })).statusCode).toBe(200)
    const start = await app.inject({ method: 'PATCH', url: `/tasks/${c.mine.id}`, headers: { authorization: c.eduAuth }, payload: { status: 'STARTED' } })
    expect(start.statusCode).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.mine.id } })).departmentId).toBe(c.fiscal.id)
  })

  it('the rest of the process is only for context: the other tasks stay read-only for them', async () => {
    const c = await setup()
    await send(c)
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${c.other.id}`, headers: { authorization: c.eduAuth }, payload: { status: 'STARTED' } })
    expect([403, 404]).toContain(res.statusCode)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.other.id } })).status).toBe('OPEN')
  })

  it('the manager of the other department does not start seeing it', async () => {
    const c = await setup()
    await send(c)
    expect(await listIds(c.gerenteContabilAuth)).not.toContain(c.mine.id)
  })
})
