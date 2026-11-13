import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { insertProtocol } from '@/modules/protocols/protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  serveClientDepartment, createTestBoard, createTestColumn, createTestTask, getAuthHeader, getStreamTicket,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed')
})

// A process of client ACME (Fiscal served by `owner`), plus two members: `outsider` has no link to
// ACME; `insider` is the Folha responsible for ACME (ClientAssignment), so the process is theirs too.
async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const owner = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const outsider = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const insider = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, fiscal.id, owner.id)
  await serveClientDepartment(client.id, folha.id, insider.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const other = await createTestColumn(board.id)
  const task = await createTestTask(column.id, owner.id, { departmentId: fiscal.id })
  const requirement = await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Extrato', position: 0 } })
  const protocol = await insertProtocol({ organizationId: org.id, clientId: client.id, taskId: task.id, title: 'Recibo', content: 'x', createdById: owner.id })
  const gerenteFiscal = await createTestUser(org.id, { role: 'ORG_MANAGER', departmentIds: [fiscal.id] })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
  const brunaSem = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id], seesDepartmentWork: false })
  const outsiderAuth = await getAuthHeader(outsider.email, 'Test@1234')
  return {
    board, column, other, task, requirement, protocol, bruna,
    outsiderAuth,
    gerenteAuth: await getAuthHeader(gerenteFiscal.email, 'Test@1234'),
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    brunaSemAuth: await getAuthHeader(brunaSem.email, 'Test@1234'),
    insiderAuth: await getAuthHeader(insider.email, 'Test@1234'),
    outsiderTicket: () => getStreamTicket(outsiderAuth),
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>
type Call = { method: 'GET' | 'POST' | 'PATCH'; url: (c: Ctx) => string; payload?: (c: Ctx) => unknown; kind?: 'read' }

const ROUTES: Record<string, Call> = {
  'search tasks of the process': { kind: 'read', method: 'GET', url: (c) => `/boards/${c.board.id}/tasks/search?q=x` },
  'create column': { method: 'POST', url: (c) => `/boards/${c.board.id}/columns`, payload: () => ({ title: 'Nova', position: 2 }) },
  'rename column': { method: 'PATCH', url: (c) => `/columns/${c.column.id}`, payload: () => ({ title: 'Outra' }) },
  'reorder columns': { method: 'PATCH', url: () => '/columns/reorder', payload: (c) => [{ id: c.column.id, position: 1 }, { id: c.other.id, position: 0 }] },
  'create task': { method: 'POST', url: (c) => `/columns/${c.column.id}/tasks`, payload: () => ({ title: 'Invasora' }) },
  'reorder tasks': { method: 'PATCH', url: () => '/tasks/reorder', payload: (c) => [{ id: c.task.id, position: 0, columnId: c.other.id }] },
  'move task': { method: 'PATCH', url: (c) => `/tasks/${c.task.id}/move`, payload: (c) => ({ columnId: c.other.id, position: 0 }) },
  'edit task': { method: 'PATCH', url: (c) => `/tasks/${c.task.id}`, payload: () => ({ title: 'Mudada' }) },
  'task history': { kind: 'read', method: 'GET', url: (c) => `/tasks/${c.task.id}/history` },
  'list comments': { kind: 'read', method: 'GET', url: (c) => `/tasks/${c.task.id}/comments` },
  'add comment': { kind: 'read', method: 'POST', url: (c) => `/tasks/${c.task.id}/comments`, payload: () => ({ content: 'oi' }) },
  'list attachments': { kind: 'read', method: 'GET', url: (c) => `/tasks/${c.task.id}/attachments` },
  'list task documents': { kind: 'read', method: 'GET', url: (c) => `/tasks/${c.task.id}/documents` },
  'add document request': { method: 'POST', url: (c) => `/tasks/${c.task.id}/documents/requests`, payload: () => ({ name: 'Contrato' }) },
  'add deliverable': { method: 'POST', url: (c) => `/tasks/${c.task.id}/documents/deliveries`, payload: () => ({ name: 'Guia' }) },
  'review document request': { method: 'PATCH', url: (c) => `/tasks/${c.task.id}/documents/requests/${c.requirement.id}`, payload: () => ({ decision: 'APPROVED' }) },
  'list task protocols': { kind: 'read', method: 'GET', url: (c) => `/tasks/${c.task.id}/protocols` },
  'create manual protocol': { method: 'POST', url: (c) => `/tasks/${c.task.id}/protocols`, payload: () => ({ title: 'Avulso', content: 'x' }) },
  'protocol detail': { kind: 'read', method: 'GET', url: (c) => `/protocols/${c.protocol.id}` },
  'protocol receipt': { kind: 'read', method: 'GET', url: (c) => `/protocols/${c.protocol.id}/receipt` },
}

describe('Membro só age em processo que enxerga', () => {
  it.each(Object.keys(ROUTES))('%s answers 404 to a member outside the process', async (name) => {
    const c = await setup()
    const r = ROUTES[name]

    const res = await app.inject({ method: r.method, url: r.url(c), headers: { authorization: c.outsiderAuth }, payload: r.payload?.(c) as object })

    expect(res.statusCode).toBe(404)
  })

  it('nothing changes in the process after the refused calls', async () => {
    const c = await setup()
    for (const r of Object.values(ROUTES)) {
      await app.inject({ method: r.method, url: r.url(c), headers: { authorization: c.outsiderAuth }, payload: r.payload?.(c) as object })
    }

    const task = await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })
    expect([task.title, task.columnId]).toEqual([c.task.title, c.column.id])
    expect(await prisma.column.count({ where: { boardId: c.board.id } })).toBe(2)
    expect(await prisma.comment.count({ where: { taskId: c.task.id } })).toBe(0)
  })

  it('board stream refuses a member outside the process', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'GET', url: `/boards/${c.board.id}/stream?ticket=${await c.outsiderTicket()}` })
    expect(res.statusCode).toBe(404)
  })

  it('member responsible for a department of the client keeps acting on the process', async () => {
    const c = await setup()

    const edit = await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.insiderAuth }, payload: { title: 'Ajustada' } })
    const comment = await app.inject({ method: 'POST', url: `/tasks/${c.task.id}/comments`, headers: { authorization: c.insiderAuth }, payload: { content: 'ok' } })
    const column = await app.inject({ method: 'POST', url: `/boards/${c.board.id}/columns`, headers: { authorization: c.insiderAuth }, payload: { title: 'Nova', position: 2 } })

    expect([edit.statusCode, comment.statusCode, column.statusCode]).toEqual([200, 201, 201])
  })
})

const call = (c: Ctx, r: Call, auth: string) =>
  app.inject({ method: r.method, url: r.url(c), headers: { authorization: auth }, payload: r.payload?.(c) as object })
const READS = Object.keys(ROUTES).filter((k) => ROUTES[k].kind === 'read')
const WRITES = Object.keys(ROUTES).filter((k) => ROUTES[k].kind !== 'read')

describe('escopo do colaborador por departamento', () => {
  it.each(Object.keys(ROUTES))('%s: manager of the department passes the scope check', async (name) => {
    const c = await setup()
    const res = await call(c, ROUTES[name], c.gerenteAuth)
    expect([403, 404]).not.toContain(res.statusCode)
  })

  it.each(READS)('%s: member who sees colleagues can read a process of the department', async (name) => {
    const c = await setup()
    const res = await call(c, ROUTES[name], c.brunaAuth)
    expect([403, 404]).not.toContain(res.statusCode)
  })

  it.each(WRITES)('%s: member must assume before changing a colleague\'s work (403)', async (name) => {
    const c = await setup()
    const res = await call(c, ROUTES[name], c.brunaAuth)
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).message).toBe('Assuma a tarefa para alterá-la')
  })

  it.each(Object.keys(ROUTES))('%s: member with "see colleagues" off gets 404', async (name) => {
    const c = await setup()
    const res = await call(c, ROUTES[name], c.brunaSemAuth)
    expect(res.statusCode).toBe(404)
  })

  it('turning the option off cuts access on the next request', async () => {
    const c = await setup()
    const read = ROUTES['task history']
    expect((await call(c, read, c.brunaAuth)).statusCode).toBe(200)
    await prisma.user.update({ where: { id: c.bruna.id }, data: { seesDepartmentWork: false } })
    expect((await call(c, read, c.brunaAuth)).statusCode).toBe(404)
  })

  it('assigned task: the member changes their own task', async () => {
    const c = await setup()
    await prisma.task.update({ where: { id: c.task.id }, data: { assigneeId: c.bruna.id } })
    const res = await call(c, ROUTES['edit task'], c.brunaAuth)
    expect(res.statusCode).toBe(200)
  })

  it('dashboard counts the processes of the department for the member', async () => {
    const c = await setup()
    const bruna = JSON.parse((await app.inject({ method: 'GET', url: '/dashboard/metrics', headers: { authorization: c.brunaAuth } })).body)
    const sem = JSON.parse((await app.inject({ method: 'GET', url: '/dashboard/metrics', headers: { authorization: c.brunaSemAuth } })).body)
    expect(bruna.kpis.activeBoards).toBe(1)
    expect(sem.kpis.activeBoards).toBe(0)
  })

  it('board list follows the scope', async () => {
    const c = await setup()
    const list = async (auth: string) => (JSON.parse((await app.inject({ method: 'GET', url: '/boards', headers: { authorization: auth } })).body) as { id: string }[]).map((b) => b.id)
    expect(await list(c.gerenteAuth)).toContain(c.board.id)
    expect(await list(c.brunaAuth)).toContain(c.board.id)
    expect(await list(c.brunaSemAuth)).not.toContain(c.board.id)
  })
})
