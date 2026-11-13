import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as sse from '@/lib/sse'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { multipartBody } from '@/test/multipart'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment,
  createTestTask, createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

let enqueued: { event: string; userId?: string; clientId?: string }[] = []
beforeEach(() => {
  vi.restoreAllMocks()
  enqueued = []
  vi.spyOn(queue, 'enqueueNotification').mockImplementation(async (job) => { enqueued.push(job) })
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishOrgEvent').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed.example/file')
})

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

// ACME served by Pessoal (Dani) and Fiscal (Carla). "Folha" is Dani's recurring task.
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const pessoal = await createTestDepartment(org.id, { name: 'Pessoal' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani' })
  const carla = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carla' })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(acme.id, pessoal.id, dani.id)
  await serveClientDepartment(acme.id, fiscal.id, carla.id)
  const { clientUser: rh, password } = await createTestClientUser(org.id, { name: 'RH' })
  await grantClientAccess(rh.id, acme.id, pessoal.id)
  const { clientUser: fin, password: finPass } = await createTestClientUser(org.id, { name: 'Financeiro' })
  await grantClientAccess(fin.id, acme.id, fiscal.id)
  const rec = await prisma.board.create({
    data: { title: 'Rec', organizationId: org.id, clientId: acme.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'A fazer', position: 0 }, { title: 'Feito', position: 1, statusEffect: 'DONE' }] } },
    include: { columns: { orderBy: { position: 'asc' } } },
  })
  const t = await createTestTask(rec.columns[0].id, dani.id, { departmentId: pessoal.id, title: 'Folha de novembro' })
  const task = await prisma.task.update({ where: { id: t.id }, data: { assigneeId: dani.id, visibleToClient: true, competence: new Date('2026-11-01') } })
  return {
    org, acme, dani, carla, rh, fin, task, doneColumn: rec.columns[1],
    daniAuth: await getAuthHeader(dani.email, 'Test@1234'),
    carlaAuth: await getAuthHeader(carla.email, 'Test@1234'),
    rhAuth: await clientLogin(rh.email, password),
    finAuth: await clientLogin(fin.email, finPass),
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function requestApproval(c: Ctx, taskId = c.task.id) {
  const mp = multipartBody({ title: 'Prévia da folha de novembro', message: 'Confere os valores?' }, { filename: 'previa.pdf' })
  return app.inject({ method: 'POST', url: `/tasks/${taskId}/approvals`, headers: { authorization: c.daniAuth, ...mp.headers }, body: mp.body })
}

const post = (url: string, auth: string, payload?: object) => app.inject({ method: 'POST', url, headers: { authorization: auth }, payload })

describe('pedir aprovação', () => {
  it('stores the file, warns the client (channels + bell) and writes the history', async () => {
    const c = await setup()
    const res = await requestApproval(c)
    expect(res.statusCode).toBe(201)
    const approval = JSON.parse(res.body)
    expect(approval).toMatchObject({ status: 'PENDING', title: 'Prévia da folha de novembro', message: 'Confere os valores?' })

    expect(enqueued).toContainEqual(expect.objectContaining({ event: 'APPROVAL_REQUESTED', clientId: c.acme.id }))
    const bell = await prisma.inAppNotification.findMany({ where: { recipientClientUserId: c.rh.id } })
    expect(bell.map((n) => n.type)).toEqual(['APPROVAL_REQUESTED'])
    expect(await prisma.inAppNotification.count({ where: { recipientClientUserId: c.fin.id } })).toBe(0)
    const history = await prisma.taskHistory.findMany({ where: { taskId: c.task.id, action: { startsWith: 'approval_' } } })
    expect(history.map((h) => h.action)).toEqual(['approval_requested'])
  })

  it('refuses an internal task', async () => {
    const c = await setup()
    await prisma.task.update({ where: { id: c.task.id }, data: { visibleToClient: false } })
    const res = await requestApproval(c)
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).message).toBe('Só tarefas visíveis ao cliente podem pedir aprovação')
  })
})

describe('cliente decide', () => {
  it('approves: who and when are recorded, the office is told in the bell', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    const list = await app.inject({ method: 'GET', url: `/portal/tasks/${c.task.id}/approvals`, headers: { authorization: c.rhAuth } })
    expect(JSON.parse(list.body)[0]).toMatchObject({ id, status: 'PENDING', fileUrl: 'https://signed.example/file' })

    const res = await post(`/portal/approvals/${id}/approve`, c.rhAuth, {})
    expect(res.statusCode).toBe(200)
    const saved = await prisma.taskApproval.findUniqueOrThrow({ where: { id } })
    expect(saved).toMatchObject({ status: 'APPROVED', decidedByClientUserId: c.rh.id })
    expect(saved.decidedAt).not.toBeNull()
    expect((await prisma.inAppNotification.findMany({ where: { recipientUserId: c.dani.id } })).map((n) => n.type)).toEqual(['APPROVAL_DECIDED'])
  })

  it('asking for changes needs a note and warns the requester', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    expect((await post(`/portal/approvals/${id}/request-changes`, c.rhAuth, { note: '' })).statusCode).toBe(400)
    const res = await post(`/portal/approvals/${id}/request-changes`, c.rhAuth, { note: 'Faltou o adicional noturno' })
    expect(res.statusCode).toBe(200)
    expect(await prisma.taskApproval.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CHANGES_REQUESTED', decisionNote: 'Faltou o adicional noturno' })
    expect(enqueued).toContainEqual(expect.objectContaining({ event: 'APPROVAL_CHANGES_REQUESTED', userId: c.dani.id }))
  })

  it('a client user without the department never sees nor decides it (404)', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    expect((await app.inject({ method: 'GET', url: `/portal/tasks/${c.task.id}/approvals`, headers: { authorization: c.finAuth } })).statusCode).toBe(404)
    expect((await post(`/portal/approvals/${id}/approve`, c.finAuth, {})).statusCode).toBe(404)
  })
})

describe('fechar sem o portal', () => {
  it('records reason, note, proof and how many days the office waited', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    await prisma.taskApproval.update({ where: { id }, data: { requestedAt: new Date(Date.now() - 3 * 86_400_000 - 60_000) } })

    const noNote = await post(`/approvals/${id}/close`, c.daniAuth, { reason: 'NO_RESPONSE', note: '' })
    expect(noNote.statusCode).toBe(400)

    const mp = multipartBody({ reason: 'APPROVED_OUTSIDE', note: 'Aprovado por WhatsApp em 12/11 às 15h' }, { filename: 'print.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: `/approvals/${id}/close`, headers: { authorization: c.daniAuth, ...mp.headers }, body: mp.body })
    expect(res.statusCode).toBe(200)
    const saved = await prisma.taskApproval.findUniqueOrThrow({ where: { id } })
    expect(saved).toMatchObject({ status: 'CLOSED_BY_OFFICE', closeReason: 'APPROVED_OUTSIDE', decisionNote: 'Aprovado por WhatsApp em 12/11 às 15h', decidedByUserId: c.dani.id, waitedDays: 3 })
    expect(saved.proofAttachmentId).not.toBeNull()
    const history = await prisma.taskHistory.findMany({ where: { taskId: c.task.id, action: { startsWith: 'approval_' } }, orderBy: { createdAt: 'asc' } })
    expect(history.map((h) => h.action)).toEqual(['approval_requested', 'approval_closed_by_office'])
  })

  it('a colleague who cannot act on the task cannot close it', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    expect((await post(`/approvals/${id}/close`, c.carlaAuth, { reason: 'NO_RESPONSE', note: 'Sem resposta' })).statusCode).toBe(404)
  })
})

describe('conclusão bloqueada e corridas', () => {
  it('a pending approval blocks completion by PATCH and by moving to a DONE column', async () => {
    const c = await setup()
    await requestApproval(c)
    const patch = await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.daniAuth }, payload: { status: 'DONE' } })
    expect(patch.statusCode).toBe(409)
    expect(JSON.parse(patch.body).message).toBe('Há aprovação do cliente pendente')
    const move = await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}/move`, headers: { authorization: c.daniAuth }, payload: { columnId: c.doneColumn.id, position: 0 } })
    expect(move.statusCode).toBe(409)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })).status).not.toBe('DONE')
  })

  it('after the decision the task can be completed', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    await post(`/portal/approvals/${id}/approve`, c.rhAuth, {})
    const patch = await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.daniAuth }, payload: { status: 'DONE' } })
    expect(patch.statusCode).toBe(200)
  })

  it('decision × office close at the same time: one wins, the other gets 409 and nothing is overwritten', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    const [approve, close] = await Promise.all([
      post(`/portal/approvals/${id}/approve`, c.rhAuth, {}),
      post(`/approvals/${id}/close`, c.daniAuth, { reason: 'NO_RESPONSE', note: 'Sem resposta' }),
    ])
    expect([approve.statusCode, close.statusCode].sort()).toEqual([200, 409])
    const saved = await prisma.taskApproval.findUniqueOrThrow({ where: { id } })
    expect(saved.status).toBe(approve.statusCode === 200 ? 'APPROVED' : 'CLOSED_BY_OFFICE')

    const late = await post(`/portal/approvals/${id}/request-changes`, c.rhAuth, { note: 'Ajuste' })
    expect(late.statusCode).toBe(409)
    expect(JSON.parse(late.body).message).toMatch(/^Essa aprovação já foi/)
  })
})

describe('no portal', () => {
  it('the approval shows up in the task group of "Enviar documentos" and in the Início count', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    const month = JSON.parse((await app.inject({ method: 'GET', url: `/portal/document-requests?clientId=${c.acme.id}&competence=2026-11`, headers: { authorization: c.rhAuth } })).body)
    expect(month.tasks).toHaveLength(1)
    expect(month.tasks[0].approvals).toEqual([expect.objectContaining({ id, status: 'PENDING', title: 'Prévia da folha de novembro', fileUrl: 'https://signed.example/file' })])
    const home = JSON.parse((await app.inject({ method: 'GET', url: `/portal/home?clientId=${c.acme.id}`, headers: { authorization: c.rhAuth } })).body)
    expect(home.pendingApprovals).toBe(1)
  })
})
