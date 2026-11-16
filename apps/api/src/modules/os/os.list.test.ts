import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, addUserToDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Caio' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const legal = await createTestDepartment(org.id, { name: 'Legal' })
  await addUserToDepartment(member.id, fiscal.id)
  await prisma.user.update({ where: { id: member.id }, data: { seesDepartmentWork: false } })
  const client = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(client.id, fiscal.id, admin.id)
  await serveClientDepartment(client.id, legal.id, admin.id)
  const model = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: fiscal.id, name: 'Recálculo', deadlineBusinessDays: 3, usableStandalone: true, usableInProcess: true } })
  const legalModel = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: legal.id, name: 'Junta', usableStandalone: true, usableInProcess: true } })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  const open = async (osModelId: string) => JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: auth }, payload: { osModelId, clientId: client.id } })).body) as { id: string }
  return { org, admin, member, client, model, legalModel, auth, memberAuth: await getAuthHeader(member.email, 'Test@1234'), open }
}
const list = async (auth: string, q = '') => JSON.parse((await app.inject({ method: 'GET', url: `/os${q}`, headers: { authorization: auth } })).body) as { id: string; title: string; deadline: { state: string }; osModel: { name: string }; process: { title: string } | null; client: { name: string } }[]

describe('lista de Ordens de Serviço', () => {
  it('lists the OS with the deadline state, late first, and filters by situation', async () => {
    const c = await setup()
    const onTime = await c.open(c.model.id)
    const late = await c.open(c.model.id)
    await prisma.task.update({ where: { id: late.id }, data: { releasedAt: new Date('2026-01-02T12:00:00Z'), targetDate: new Date('2026-01-07T00:00:00Z') } })
    const done = await c.open(c.model.id)
    await prisma.task.update({ where: { id: done.id }, data: { status: 'DONE' } })
    const all = await list(c.auth)
    expect(all[0].id).toBe(late.id)
    expect(all.find((o) => o.id === late.id)?.deadline.state).toBe('LATE')
    expect(all.find((o) => o.id === onTime.id)?.deadline.state).toMatch(/ON_TIME|DUE_SOON/)
    expect(all.find((o) => o.id === done.id)?.deadline.state).toBe('DONE')
    expect((await list(c.auth, '?situation=LATE')).map((o) => o.id)).toEqual([late.id])
    expect((await list(c.auth, '?situation=DONE')).map((o) => o.id)).toEqual([done.id])
  })

  it('an OS of a process brings the process; a plain task is never listed', async () => {
    const c = await setup()
    const t = JSON.parse((await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'Abertura', columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }], items: [{ osModelId: c.model.id, columnIndex: 0, dependsOn: [] }] } })).body)
    const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'Abertura ACME', clientId: c.client.id, processTemplateId: t.id } })).body)
    const col = await prisma.column.findFirstOrThrow({ where: { boardId: board.id } })
    await app.inject({ method: 'POST', url: `/columns/${col.id}/tasks`, headers: { authorization: c.auth }, payload: { title: 'Tarefa livre', priority: 'MEDIUM', tags: [], departmentId: (await prisma.oSModel.findUniqueOrThrow({ where: { id: c.model.id } })).departmentId } })
    const items = await list(c.auth, `?boardId=${board.id}`)
    expect(items.map((o) => [o.title, o.process?.title, o.osModel.name, o.client.name])).toEqual([['Recálculo', 'Abertura ACME', 'Recálculo', 'ACME']])
  })

  it('a member only sees the OS of their scope', async () => {
    const c = await setup()
    const mine = await c.open(c.model.id)
    await prisma.task.update({ where: { id: mine.id }, data: { assigneeId: c.member.id } })
    await c.open(c.legalModel.id)
    expect((await list(c.memberAuth)).map((o) => o.id)).toEqual([mine.id])
  })

  it('filters by model and client', async () => {
    const c = await setup()
    await c.open(c.model.id)
    const junta = await c.open(c.legalModel.id)
    expect((await list(c.auth, `?osModelId=${c.legalModel.id}&clientId=${c.client.id}`)).map((o) => o.id)).toEqual([junta.id])
  })
})

describe('Tarefas e Processos mostram a OS e o prazo', () => {
  it('the Tarefas list marks an OS with its model, process and deadline', async () => {
    const c = await setup()
    const os = await c.open(c.model.id)
    const res = JSON.parse((await app.inject({ method: 'GET', url: `/tasks?taskId=${os.id}`, headers: { authorization: c.auth } })).body)
    const item = (res.items ?? res)[0]
    expect(item.osModel).toEqual({ id: c.model.id, name: 'Recálculo' })
    expect(item.deadline.state).toMatch(/ON_TIME|DUE_SOON/)
    expect(item.column.board.type).toBe('SERVICE_SYSTEM')
  })

  it('the Processos list brings the process deadline', async () => {
    const c = await setup()
    const t = JSON.parse((await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'Abertura', deadlineBusinessDays: 30, columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }] } })).body)
    const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'Abertura ACME', clientId: c.client.id, processTemplateId: t.id } })).body)
    await prisma.board.update({ where: { id: board.id }, data: { targetDate: new Date('2026-01-07T00:00:00Z') } })
    const boards = JSON.parse((await app.inject({ method: 'GET', url: '/boards', headers: { authorization: c.auth } })).body) as { id: string; deadline: { state: string } }[]
    expect(boards.find((b) => b.id === board.id)?.deadline.state).toBe('LATE')
  })
})

describe('OS aguardando outra na lista de Tarefas', () => {
  it('names the OS it waits for', async () => {
    const c = await setup()
    const t = JSON.parse((await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'P', columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }], items: [{ osModelId: c.model.id, columnIndex: 0, dependsOn: [] }, { osModelId: c.legalModel.id, columnIndex: 0, dependsOn: [0] }] } })).body)
    const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })).body)
    const waiting = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id }, releasedAt: null } })
    const res = JSON.parse((await app.inject({ method: 'GET', url: `/tasks?taskId=${waiting.id}`, headers: { authorization: c.auth } })).body)
    expect((res.items ?? res)[0].waitingFor).toEqual(['Recálculo'])
  })
})
