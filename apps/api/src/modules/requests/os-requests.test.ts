import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, createTestClientUser, grantClientAccess, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const legal = await createTestDepartment(org.id, { name: 'Legalização' })
  const client = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(client.id, fiscal.id, admin.id)
  await serveClientDepartment(client.id, legal.id, admin.id)
  const { clientUser, password } = await createTestClientUser(org.id)
  await grantClientAccess(clientUser.id, client.id, fiscal.id)
  await grantClientAccess(clientUser.id, client.id, legal.id)
  const recalculo = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: fiscal.id, name: 'Recálculo DAS', requiresCompetence: true, usableStandalone: true } })
  const junta = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: legal.id, name: 'Registro na Junta', usableStandalone: false, usableInProcess: true } })
  await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: fiscal.id, name: 'Inativa', usableStandalone: true, isActive: false } })
  const abertura = await prisma.processTemplate.create({
    data: {
      organizationId: org.id, name: 'Abertura de empresa', departmentId: legal.id, clientCanRequest: true,
      columns: { create: [{ title: 'Registro', position: 0 }, { title: 'Concluído', position: 1, statusEffect: 'DONE' }] },
      items: { create: [{ osModelId: junta.id, columnPosition: 0, position: 0 }] },
    },
  })
  await prisma.processTemplate.create({ data: { organizationId: org.id, name: 'Interno', columns: { create: [{ title: 'A', position: 0 }] } } })
  return {
    org, client, fiscal, legal, recalculo, junta, abertura,
    staff: await getAuthHeader(admin.email, 'Test@1234'), portal: await getAuthHeader(clientUser.email, password),
  }
}
type Ctx = Awaited<ReturnType<typeof setup>>
const json = (r: { body: string }) => JSON.parse(r.body)
const ask = (c: Ctx, payload: object) => app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: c.portal }, payload: { clientId: c.client.id, title: 'Pedido', ...payload } })
const approve = (c: Ctx, id: string, payload: object) => app.inject({ method: 'POST', url: `/requests/${id}/approve`, headers: { authorization: c.staff }, payload })

describe('solicitar serviço', () => {
  it('the catalog lists standalone OS and requestable processes, never process-only or inactive ones', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'GET', url: `/portal/services?clientId=${c.client.id}`, headers: { authorization: c.portal } })
    expect(json(res).map((s: { kind: string; name: string; requiresCompetence: boolean }) => [s.kind, s.name, s.requiresCompetence])).toEqual([
      ['PROCESS', 'Abertura de empresa', false],
      ['OS', 'Recálculo DAS', true],
    ])
  })

  it('an OS request takes the model department and, approved, opens the OS with the competence', async () => {
    const c = await setup()
    const req = json(await ask(c, { osModelId: c.recalculo.id, competence: '2025-03' }))
    expect(req.departmentId).toBe(c.fiscal.id)
    const res = await approve(c, req.id, { mode: 'OS' })
    expect(res.statusCode).toBe(200)
    const after = await prisma.request.findUniqueOrThrow({ where: { id: req.id }, include: { task: true } })
    expect([after.status, after.task?.osModelId, after.task?.title, after.task?.sourceRequestId]).toEqual(['APPROVED', c.recalculo.id, 'Recálculo DAS — 03/2025', req.id])
  })

  it('an OS that asks for the competence is refused without it', async () => {
    const c = await setup()
    const res = await ask(c, { osModelId: c.recalculo.id })
    expect([res.statusCode, json(res).message]).toEqual([422, 'Informe a competência'])
  })

  it('a process-only OS or an inactive model cannot be requested', async () => {
    const c = await setup()
    const res = await ask(c, { osModelId: c.junta.id })
    expect([res.statusCode, json(res).message]).toEqual([422, 'Serviço indisponível'])
  })

  it('a process request, approved, opens the process with its OS and points to it', async () => {
    const c = await setup()
    const req = json(await ask(c, { processTemplateId: c.abertura.id }))
    expect(req.departmentId).toBe(c.legal.id)
    expect((await approve(c, req.id, { mode: 'NEW_BOARD' })).statusCode).toBe(200)
    const after = await prisma.request.findUniqueOrThrow({ where: { id: req.id } })
    expect(after.boardId).not.toBeNull()
    const tasks = await prisma.task.findMany({ where: { column: { boardId: after.boardId! } } })
    expect(tasks.map((t) => t.title)).toEqual(['Registro na Junta'])
    expect(after.taskId).toBe(tasks[0].id)
  })

  it('approving into an existing process adds an OS that waits for another one', async () => {
    const c = await setup()
    const first = json(await ask(c, { processTemplateId: c.abertura.id }))
    await approve(c, first.id, { mode: 'NEW_BOARD' })
    const boardId = (await prisma.request.findUniqueOrThrow({ where: { id: first.id } })).boardId!
    const junta = await prisma.task.findFirstOrThrow({ where: { column: { boardId } } })
    const column = await prisma.column.findFirstOrThrow({ where: { boardId, position: 1 } })
    const free = json(await ask(c, { departmentId: c.legal.id, title: 'Alvará' }))
    const res = await approve(c, free.id, { mode: 'EXISTING_BOARD', boardId, columnId: column.id, osModelId: c.junta.id, dependsOnTaskIds: [junta.id] })
    expect(res.statusCode).toBe(200)
    const task = (await prisma.request.findUniqueOrThrow({ where: { id: free.id }, include: { task: true } })).task!
    expect([task.osModelId, task.releasedAt]).toEqual([c.junta.id, null])
  })
})
