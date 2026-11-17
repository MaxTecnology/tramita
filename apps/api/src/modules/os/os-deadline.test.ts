import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { nationalHolidays } from '@/lib/business-days'
import { syncPause, deadlineInfo, onOSFinished, scheduleDeadline } from './os-deadline.service'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

const day = (s: string) => new Date(`${s}T12:00:00.000Z`)
const iso = (d: Date | null | undefined) => d?.toISOString().slice(0, 10)
const holidays = new Set([...nationalHolidays(2026), ...nationalHolidays(2027)])

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Caio' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(client.id, dept.id, admin.id)
  const model = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: dept.id, name: 'Etapa', deadlineBusinessDays: 3, usableStandalone: true, usableInProcess: true } })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  const memberAuth = await getAuthHeader(member.email, 'Test@1234')
  return { org, admin, member, dept, client, model, auth, memberAuth }
}
type Ctx = Awaited<ReturnType<typeof setup>>

async function process(c: Ctx, items: { dependsOn: number[] }[]) {
  const t = await app.inject({
    method: 'POST', url: '/process-templates', headers: { authorization: c.auth },
    payload: {
      name: 'P', columns: [{ title: 'A fazer', statusEffect: 'OPEN', documents: [] }, { title: 'Feito', statusEffect: 'DONE', documents: [] }],
      items: items.map((it) => ({ osModelId: c.model.id, columnIndex: 0, dependsOn: it.dependsOn })),
    },
  })
  const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: JSON.parse(t.body).id } })).body)
  const tasks = await prisma.task.findMany({ where: { column: { boardId: board.id } }, orderBy: { createdAt: 'asc' } })
  return { board, tasks }
}

describe('prazo interno com pausa aguardando o cliente', () => {
  it('meta = liberação + prazo + dias úteis pausados (feriado no meio)', async () => {
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    await prisma.task.update({ where: { id: os.id }, data: { releasedAt: day('2026-11-13') } })
    await scheduleDeadline(os.id)
    expect(iso((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).targetDate)).toBe('2026-11-18')

    const req = await prisma.taskDocumentRequirement.create({ data: { taskId: os.id, name: 'Extrato', position: 0 } })
    await syncPause(os.id, day('2026-11-16'))
    const paused = await prisma.taskPause.findMany({ where: { taskId: os.id } })
    expect(paused).toHaveLength(1)
    expect(paused[0].endedAt).toBeNull()

    await prisma.taskDocumentRequirement.update({ where: { id: req.id }, data: { status: 'APPROVED' } })
    await syncPause(os.id, day('2026-11-18'))
    const task = await prisma.task.findUniqueOrThrow({ where: { id: os.id } })
    expect(iso(task.targetDate)).toBe('2026-11-23')
    expect(await prisma.taskHistory.count({ where: { taskId: os.id, action: { in: ['os_paused', 'os_resumed'] } } })).toBe(2)
  })

  it('a file the client sent and the office did not review yet does not pause', async () => {
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    await prisma.taskDocumentRequirement.create({ data: { taskId: os.id, name: 'Extrato', position: 0, status: 'UPLOADED' } })
    await syncPause(os.id, day('2026-11-16'))
    expect(await prisma.taskPause.count({ where: { taskId: os.id } })).toBe(0)
  })

  it('a pending client approval pauses without changing the status', async () => {
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    const file = await prisma.attachment.create({ data: { taskId: os.id, filename: 'p.pdf', mimeType: 'application/pdf', size: 1, storageKey: 'k', uploadedBy: c.admin.id } })
    await prisma.taskApproval.create({ data: { taskId: os.id, organizationId: c.org.id, title: 'Prévia', attachmentId: file.id, requestedById: c.admin.id } })
    await syncPause(os.id, day('2026-11-16'))
    expect(await prisma.taskPause.count({ where: { taskId: os.id, endedAt: null } })).toBe(1)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).status).toBe('OPEN')
  })

  it('deadlineInfo tells the state of the clock', () => {
    const base = { status: 'OPEN' as const, osModelId: 'm', releasedAt: day('2026-11-13'), deadlineBusinessDays: 3, targetDate: day('2026-11-18'), pauses: [] }
    expect(deadlineInfo(base, day('2026-11-16'), holidays, 1)).toMatchObject({ state: 'ON_TIME', businessDaysLeft: 2 })
    expect(deadlineInfo(base, day('2026-11-17'), holidays, 1)).toMatchObject({ state: 'DUE_SOON', businessDaysLeft: 1 })
    expect(deadlineInfo(base, day('2026-11-23'), holidays, 1)).toMatchObject({ state: 'LATE', businessDaysLate: 2 })
    expect(deadlineInfo({ ...base, pauses: [{ startedAt: day('2026-11-16'), endedAt: null }] }, day('2026-11-18'), holidays, 1))
      .toMatchObject({ state: 'PAUSED', pausedSinceDays: 2, clientBusinessDays: 2, officeBusinessDays: 1 })
    expect(deadlineInfo({ ...base, releasedAt: null }, day('2026-11-16'), holidays, 1).state).toBe('WAITING_DEPENDENCY')
    expect(deadlineInfo({ ...base, status: 'DONE' }, day('2026-11-16'), holidays, 1).state).toBe('DONE')
    expect(deadlineInfo({ ...base, osModelId: null, deadlineBusinessDays: null, targetDate: null }, day('2026-11-16'), holidays, 1).state).toBe('NONE')
  })
})

describe('uma OS libera a próxima', () => {
  it('an OS waiting for another cannot start, move or finish', async () => {
    const c = await setup()
    const { board, tasks: [a, b] } = await process(c, [{ dependsOn: [] }, { dependsOn: [0] }])
    const started = await app.inject({ method: 'PATCH', url: `/tasks/${b.id}`, headers: { authorization: c.auth }, payload: { status: 'STARTED' } })
    expect([started.statusCode, JSON.parse(started.body).message]).toEqual([409, `Esta OS aguarda: ${a.title}`])
    const done = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, statusEffect: 'DONE' } })
    const moved = await app.inject({ method: 'PATCH', url: `/tasks/${b.id}/move`, headers: { authorization: c.auth }, payload: { columnId: done.id, position: 0 } })
    expect(moved.statusCode).toBe(409)
  })

  it('finishing A releases B once and tells its owner; C waits for A and B', async () => {
    const c = await setup()
    const { tasks: [a, b, cc] } = await process(c, [{ dependsOn: [] }, { dependsOn: [0] }, { dependsOn: [0, 1] }])
    // B belongs to Caio: whoever finished A (Bruna) is never notified of her own action
    await prisma.task.update({ where: { id: b.id }, data: { assigneeId: c.member.id } })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${a.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect(res.statusCode).toBe(200)
    const [bb, c2] = await Promise.all([prisma.task.findUniqueOrThrow({ where: { id: b.id } }), prisma.task.findUniqueOrThrow({ where: { id: cc.id } })])
    expect(bb.releasedAt).not.toBeNull()
    expect(bb.targetDate).not.toBeNull()
    expect(c2.releasedAt).toBeNull()
    expect(await prisma.inAppNotification.count({ where: { taskId: b.id, type: 'OS_RELEASED', recipientUserId: c.member.id } })).toBe(1)
    await app.inject({ method: 'PATCH', url: `/tasks/${b.id}`, headers: { authorization: c.auth }, payload: { status: 'DISREGARDED' } })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: cc.id } })).releasedAt).not.toBeNull()
  })

  it('two dependencies finished at the same time release the waiting OS only once', async () => {
    const c = await setup()
    const { tasks: [a, b, cc] } = await process(c, [{ dependsOn: [] }, { dependsOn: [] }, { dependsOn: [0, 1] }])
    await prisma.task.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: 'DONE' } })
    const actor = { id: c.admin.id, name: 'Bruna' }
    await Promise.all([onOSFinished(a.id, actor), onOSFinished(b.id, actor)])
    expect(await prisma.taskHistory.count({ where: { taskId: cc.id, action: 'os_released' } })).toBe(1)
  })

  it('the manager can release early with a reason; a member cannot', async () => {
    const c = await setup()
    const { tasks: [, b] } = await process(c, [{ dependsOn: [] }, { dependsOn: [0] }])
    // A member who sees the process (same department) still cannot release: it is the manager's call
    await prisma.userDepartment.create({ data: { userId: c.member.id, departmentId: c.dept.id } })
    const byMember = await app.inject({ method: 'POST', url: `/tasks/${b.id}/release`, headers: { authorization: c.memberAuth }, payload: { reason: 'Junta liberou antes' } })
    expect(byMember.statusCode).toBe(403)
    const ok = await app.inject({ method: 'POST', url: `/tasks/${b.id}/release`, headers: { authorization: c.auth }, payload: { reason: 'Junta liberou antes' } })
    expect(ok.statusCode).toBe(200)
    const h = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: b.id, action: 'os_released_early' } })
    expect([h.actorName, h.toValue]).toEqual(['Bruna', 'Junta liberou antes'])
    expect((await app.inject({ method: 'POST', url: `/tasks/${b.id}/release`, headers: { authorization: c.auth }, payload: { reason: 'de novo' } })).statusCode).toBe(409)
  })

  it('the process completes when every OS finishes and reopens when an OS is added', async () => {
    const c = await setup()
    const { board, tasks: [a, b] } = await process(c, [{ dependsOn: [] }, { dependsOn: [] }])
    for (const t of [a, b]) await app.inject({ method: 'PATCH', url: `/tasks/${t.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).completedAt).not.toBeNull()
    const col = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, position: 0 } })
    await app.inject({ method: 'POST', url: `/boards/${board.id}/os`, headers: { authorization: c.auth }, payload: { osModelId: c.model.id, columnId: col.id } })
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).completedAt).toBeNull()
  })
})

describe('revisão final', () => {
  it('finishing an OS that was waiting for the client counts the last pause (no false delay)', async () => {
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    // released long ago, deadline 3 days, but waiting for the client since then: not late
    const released = new Date(Date.now() - 30 * 86_400_000)
    await prisma.task.update({ where: { id: os.id }, data: { releasedAt: released, targetDate: new Date(released.getTime() + 5 * 86_400_000) } })
    await prisma.taskPause.create({ data: { taskId: os.id, startedAt: new Date(released.getTime() + 3600_000) } })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).delayReasonPending).toBe(false)
  })
})

describe('OS aguardando outra não conclui sozinha', () => {
  it('is born open, is never completed automatically and gets its real status when released', async () => {
    const c = await setup()
    await prisma.oSModel.update({ where: { id: c.model.id }, data: { autoCompleteOnAllDelivered: true, documentRequests: { create: [{ name: 'Contrato', position: 0 }] } } })
    const { tasks: [a, b] } = await process(c, [{ dependsOn: [] }, { dependsOn: [0] }])
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('OPEN')
    const { recalculateTaskStatus } = await import('@/modules/task-documents/task-documents.service')
    await prisma.taskDocumentRequirement.updateMany({ where: { taskId: b.id }, data: { status: 'APPROVED' } })
    await recalculateTaskStatus(b.id)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('OPEN')
    await prisma.taskDocumentRequirement.updateMany({ where: { taskId: b.id }, data: { status: 'PENDING' } })
    await prisma.taskDocumentRequirement.updateMany({ where: { taskId: a.id }, data: { status: 'APPROVED' } })
    await app.inject({ method: 'PATCH', url: `/tasks/${a.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('BLOCKED')
  })
})

describe('relógio no fuso de Brasília', () => {
  it('the target day is not late in the evening, and a release at 22h counts that same day', async () => {
    const base = { status: 'OPEN', osModelId: 'm', releasedAt: new Date('2026-11-16T12:00:00Z'), deadlineBusinessDays: 2, targetDate: new Date('2026-11-18T00:00:00Z'), pauses: [] }
    // 18/11 22:00 in Brasília = 19/11 01:00 UTC: still the target day
    expect(deadlineInfo(base, new Date('2026-11-19T01:00:00Z'), holidays, 0).state).not.toBe('LATE')
    const c = await setup()
    const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })).body)
    // released Thursday 12/11 at 22:00 in Brasília (13/11 01:00 UTC), 3 business days → Tuesday 17/11
    await prisma.task.update({ where: { id: os.id }, data: { releasedAt: new Date('2026-11-13T01:00:00Z') } })
    await scheduleDeadline(os.id)
    expect(iso((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).targetDate)).toBe('2026-11-17')
  })
})

describe('caminhos que tiram uma OS do processo liberam as que esperavam', () => {
  it('cancelling the approved request of an OS disregards it and releases the waiting one', async () => {
    const c = await setup()
    const { tasks: [a, b] } = await process(c, [{ dependsOn: [] }, { dependsOn: [0] }])
    const req = await prisma.request.create({ data: { organizationId: c.org.id, clientId: c.client.id, title: 'Pedido', departmentId: c.dept.id, status: 'APPROVED', taskId: a.id } })
    const { cancelApprovedRequest } = await import('@/modules/requests/requests.service')
    await cancelApprovedRequest(req.id, c.org.id, c.admin.id, 'Cliente desistiu')
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).releasedAt).not.toBeNull()
  })

  it('deleting the OS another one waits for releases it', async () => {
    const c = await setup()
    const { tasks: [a, b] } = await process(c, [{ dependsOn: [] }, { dependsOn: [0] }])
    expect((await app.inject({ method: 'DELETE', url: `/tasks/${a.id}`, headers: { authorization: c.auth } })).statusCode).toBeLessThan(300)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).releasedAt).not.toBeNull()
  })
})
