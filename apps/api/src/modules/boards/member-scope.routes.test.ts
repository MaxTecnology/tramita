import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { insertProtocol } from '@/modules/protocols/protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  serveClientDepartment, createTestBoard, createTestColumn, createTestTask, getAuthHeader,
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
  const outsiderAuth = await getAuthHeader(outsider.email, 'Test@1234')
  return {
    board, column, other, task, requirement, protocol,
    outsiderAuth,
    insiderAuth: await getAuthHeader(insider.email, 'Test@1234'),
    outsiderToken: outsiderAuth.replace('Bearer ', ''),
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>
type Call = { method: 'GET' | 'POST' | 'PATCH'; url: (c: Ctx) => string; payload?: (c: Ctx) => unknown }

const ROUTES: Record<string, Call> = {
  'search tasks of the process': { method: 'GET', url: (c) => `/boards/${c.board.id}/tasks/search?q=x` },
  'create column': { method: 'POST', url: (c) => `/boards/${c.board.id}/columns`, payload: () => ({ title: 'Nova', position: 2 }) },
  'rename column': { method: 'PATCH', url: (c) => `/columns/${c.column.id}`, payload: () => ({ title: 'Outra' }) },
  'reorder columns': { method: 'PATCH', url: () => '/columns/reorder', payload: (c) => [{ id: c.column.id, position: 1 }, { id: c.other.id, position: 0 }] },
  'create task': { method: 'POST', url: (c) => `/columns/${c.column.id}/tasks`, payload: () => ({ title: 'Invasora' }) },
  'reorder tasks': { method: 'PATCH', url: () => '/tasks/reorder', payload: (c) => [{ id: c.task.id, position: 0, columnId: c.other.id }] },
  'move task': { method: 'PATCH', url: (c) => `/tasks/${c.task.id}/move`, payload: (c) => ({ columnId: c.other.id, position: 0 }) },
  'edit task': { method: 'PATCH', url: (c) => `/tasks/${c.task.id}`, payload: () => ({ title: 'Mudada' }) },
  'task history': { method: 'GET', url: (c) => `/tasks/${c.task.id}/history` },
  'list comments': { method: 'GET', url: (c) => `/tasks/${c.task.id}/comments` },
  'add comment': { method: 'POST', url: (c) => `/tasks/${c.task.id}/comments`, payload: () => ({ content: 'oi' }) },
  'list attachments': { method: 'GET', url: (c) => `/tasks/${c.task.id}/attachments` },
  'list task documents': { method: 'GET', url: (c) => `/tasks/${c.task.id}/documents` },
  'add document request': { method: 'POST', url: (c) => `/tasks/${c.task.id}/documents/requests`, payload: () => ({ name: 'Contrato' }) },
  'add deliverable': { method: 'POST', url: (c) => `/tasks/${c.task.id}/documents/deliveries`, payload: () => ({ name: 'Guia' }) },
  'review document request': { method: 'PATCH', url: (c) => `/tasks/${c.task.id}/documents/requests/${c.requirement.id}`, payload: () => ({ decision: 'APPROVED' }) },
  'list task protocols': { method: 'GET', url: (c) => `/tasks/${c.task.id}/protocols` },
  'create manual protocol': { method: 'POST', url: (c) => `/tasks/${c.task.id}/protocols`, payload: () => ({ title: 'Avulso', content: 'x' }) },
  'protocol detail': { method: 'GET', url: (c) => `/protocols/${c.protocol.id}` },
  'protocol receipt': { method: 'GET', url: (c) => `/protocols/${c.protocol.id}/receipt` },
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
    const res = await app.inject({ method: 'GET', url: `/boards/${c.board.id}/stream?token=${c.outsiderToken}` })
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
