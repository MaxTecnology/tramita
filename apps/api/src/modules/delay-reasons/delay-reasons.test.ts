import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { deliverDocument } from '@/modules/task-documents/task-documents.service'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, dept.id, admin.id)
  const model = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: dept.id, name: 'Recálculo', deadlineBusinessDays: 3, usableStandalone: true, usableInProcess: true } })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  const reasons = async () => JSON.parse((await app.inject({ method: 'GET', url: '/delay-reasons', headers: { authorization: auth } })).body) as { id: string; name: string; requiresNote: boolean }[]
  return { org, admin, dept, client, model, auth, reasons }
}
type Ctx = Awaited<ReturnType<typeof setup>>

// An OS whose internal deadline passed long ago (released 01/01, target 06/01)
async function lateOS(c: Ctx) {
  const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
  await prisma.task.update({ where: { id: os.id }, data: { releasedAt: new Date('2026-01-02T12:00:00Z'), targetDate: new Date('2026-01-07T00:00:00Z') } })
  return os as { id: string }
}
const patch = (c: Ctx, id: string, payload: object) => app.inject({ method: 'PATCH', url: `/tasks/${id}`, headers: { authorization: c.auth }, payload })

describe('motivo de atraso', () => {
  it('the office gets the default reasons on first read', async () => {
    const c = await setup()
    expect((await c.reasons()).map((r) => [r.name, r.requiresNote])).toEqual([
      ['Aguardando órgão público', false], ['Retrabalho interno', false], ['Volume de trabalho', false], ['Outro', true],
    ])
  })

  it('finishing a late OS needs a reason; with it the reason goes to the history', async () => {
    const c = await setup()
    const os = await lateOS(c)
    const without = await patch(c, os.id, { status: 'DONE' })
    expect([without.statusCode, JSON.parse(without.body).message]).toEqual([422, 'Informe o motivo do atraso'])
    const retrabalho = (await c.reasons()).find((r) => r.name === 'Retrabalho interno')!
    expect((await patch(c, os.id, { status: 'DONE', delayReasonId: retrabalho.id, delayNote: 'Guia refeita' })).statusCode).toBe(200)
    const task = await prisma.task.findUniqueOrThrow({ where: { id: os.id } })
    expect([task.status, task.delayReasonId, task.delayNote]).toEqual(['DONE', retrabalho.id, 'Guia refeita'])
    const h = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: os.id, action: 'delay_reason_set' } })
    expect([h.fromValue, h.toValue]).toEqual(['Retrabalho interno', 'Guia refeita'])
  })

  it('"Outro" needs a note', async () => {
    const c = await setup()
    const os = await lateOS(c)
    const outro = (await c.reasons()).find((r) => r.name === 'Outro')!
    const res = await patch(c, os.id, { status: 'DONE', delayReasonId: outro.id })
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([422, 'Descreva o motivo'])
  })

  it('moving to the done column follows the same rule', async () => {
    const c = await setup()
    const os = await lateOS(c)
    const task = await prisma.task.findUniqueOrThrow({ where: { id: os.id }, include: { column: true } })
    const done = await prisma.column.findFirstOrThrow({ where: { boardId: task.column.boardId, statusEffect: 'DONE' } })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}/move`, headers: { authorization: c.auth }, payload: { columnId: done.id, position: 0 } })
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([422, 'Informe o motivo do atraso'])
  })

  it('a reason registered before finishing is enough', async () => {
    const c = await setup()
    const os = await lateOS(c)
    const orgao = (await c.reasons())[0]
    expect((await app.inject({ method: 'PATCH', url: `/tasks/${os.id}/delay-reason`, headers: { authorization: c.auth }, payload: { delayReasonId: orgao.id } })).statusCode).toBe(200)
    expect((await patch(c, os.id, { status: 'DONE' })).statusCode).toBe(200)
  })

  it('an OS on time never asks', async () => {
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    expect((await patch(c, os.id, { status: 'DONE' })).statusCode).toBe(200)
  })

  it('automatic completion of a late OS completes it and leaves the reason pending', async () => {
    const c = await setup()
    await prisma.oSModel.update({ where: { id: c.model.id }, data: { autoCompleteOnAllDelivered: true, documentDeliveries: { create: [{ name: 'Guia', position: 0 }] } } })
    const os = await lateOS(c)
    const guia = await prisma.taskDeliverable.findFirstOrThrow({ where: { taskId: os.id } })
    await deliverDocument(os.id, guia.id, c.org.id, { id: c.admin.id }, { filename: 'g.pdf', mimeType: 'application/pdf', size: 4, buffer: Buffer.from('%PDF') })
    const task = await prisma.task.findUniqueOrThrow({ where: { id: os.id } })
    expect([task.status, task.delayReasonPending]).toEqual(['DONE', true])
    const orgao = (await c.reasons())[0]
    await app.inject({ method: 'PATCH', url: `/tasks/${os.id}/delay-reason`, headers: { authorization: c.auth }, payload: { delayReasonId: orgao.id } })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).delayReasonPending).toBe(false)
  })

  it('the OS that closes a late process asks for the process reason too', async () => {
    const c = await setup()
    const t = JSON.parse((await app.inject({
      method: 'POST', url: '/process-templates', headers: { authorization: c.auth },
      payload: { name: 'P', deadlineBusinessDays: 5, columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }, { title: 'F', statusEffect: 'DONE', documents: [] }], items: [{ osModelId: c.model.id, columnIndex: 0, dependsOn: [] }] },
    })).body)
    const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })).body)
    await prisma.board.update({ where: { id: board.id }, data: { targetDate: new Date('2026-01-07T00:00:00Z') } })
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const res = await patch(c, os.id, { status: 'DONE' })
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([422, 'Informe o motivo do atraso do processo'])
    const orgao = (await c.reasons())[0]
    expect((await patch(c, os.id, { status: 'DONE', processDelayReasonId: orgao.id })).statusCode).toBe(200)
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).delayReasonId).toBe(orgao.id)
  })

  it('a reason of another office is not found', async () => {
    const c = await setup()
    const other = await setup()
    const foreign = (await other.reasons())[0]
    const os = await lateOS(c)
    expect((await patch(c, os.id, { status: 'DONE', delayReasonId: foreign.id })).statusCode).toBe(404)
  })
})
