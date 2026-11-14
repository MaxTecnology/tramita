import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import type { NotificationJob } from '@/lib/queue'
import * as sse from '@/lib/sse'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import * as mailer from '@/lib/mailer'
import { processNotificationJob } from '@/workers/notification.worker'
import { purgeReadNotifications } from '@/workers/inbox-purge.cron'
import { multipartBody } from '@/test/multipart'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment,
  createTestTask, createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

let enqueued: NotificationJob[] = []
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


const bell = (where: { recipientUserId?: string; recipientClientUserId?: string }) => prisma.inAppNotification.findMany({ where })

describe('débitos — notificações', () => {
  it('opening the conversation marks only the comment notifications as read', async () => {
    const c = await setup()
    await requestApproval(c)
    await post(`/tasks/${c.task.id}/comments`, c.daniAuth, { content: 'Viu a prévia?' })
    await post('/notifications/read-by-task', c.rhAuth, { taskId: c.task.id })
    const rows = await bell({ recipientClientUserId: c.rh.id })
    expect(rows.find((n) => n.type === 'TASK_COMMENT')?.readAt).not.toBeNull()
    expect(rows.find((n) => n.type === 'APPROVAL_REQUESTED')?.readAt).toBeNull()
  })

  it('an inactive office user is never a bell recipient', async () => {
    const c = await setup()
    await prisma.user.update({ where: { id: c.dani.id }, data: { isActive: false } })
    await post(`/tasks/${c.task.id}/comments`, c.rhAuth, { content: 'Oi' })
    expect(await bell({ recipientUserId: c.dani.id })).toEqual([])
  })

  it('"Mensagens do escritório" ignores a task the client can no longer see', async () => {
    const c = await setup()
    await post(`/tasks/${c.task.id}/comments`, c.daniAuth, { content: 'Mensagem' })
    await prisma.task.update({ where: { id: c.task.id }, data: { visibleToClient: false } })
    const home = JSON.parse((await app.inject({ method: 'GET', url: `/portal/home?clientId=${c.acme.id}`, headers: { authorization: c.rhAuth } })).body)
    expect(home.unreadMessages).toEqual({ count: 0, link: null })
  })

  it('deleting a task removes its notifications (no dead links)', async () => {
    const c = await setup()
    await post(`/tasks/${c.task.id}/comments`, c.daniAuth, { content: 'Mensagem' })
    await prisma.task.delete({ where: { id: c.task.id } })
    expect(await bell({ recipientClientUserId: c.rh.id })).toEqual([])
  })

  it('purges read notifications older than 180 days, keeps unread and recent ones', async () => {
    const c = await setup()
    const base = { organizationId: c.org.id, type: 'TASK_COMMENT' as const, title: 't', body: '', link: '/x', recipientUserId: c.dani.id }
    const old = new Date(Date.now() - 200 * 86_400_000)
    await prisma.inAppNotification.createMany({
      data: [
        { ...base, title: 'velha lida', createdAt: old, readAt: old },
        { ...base, title: 'velha não lida', createdAt: old },
        { ...base, title: 'recente lida', readAt: new Date() },
      ],
    })
    expect(await purgeReadNotifications()).toBe(1)
    expect((await bell({ recipientUserId: c.dani.id })).map((n) => n.title).sort()).toEqual(['recente lida', 'velha não lida'])
  })
})

describe('débitos — aprovação', () => {
  it('a second approval cannot be requested while one is pending', async () => {
    const c = await setup()
    await requestApproval(c)
    const res = await requestApproval(c)
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).message).toBe('Já existe uma aprovação aguardando o cliente nesta tarefa')
  })

  it('a refused close (client already decided) leaves no orphan proof attachment', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    await post(`/portal/approvals/${id}/approve`, c.rhAuth, {})
    const before = await prisma.attachment.count({ where: { taskId: c.task.id } })
    const mp = multipartBody({ reason: 'APPROVED_OUTSIDE', note: 'WhatsApp' }, { filename: 'print.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: `/approvals/${id}/close`, headers: { authorization: c.daniAuth, ...mp.headers }, body: mp.body })
    expect(res.statusCode).toBe(409)
    expect(await prisma.attachment.count({ where: { taskId: c.task.id } })).toBe(before)
  })

  it('the approval file cannot be deleted from the attachments tab', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    const { attachmentId } = await prisma.taskApproval.findUniqueOrThrow({ where: { id } })
    const res = await app.inject({ method: 'DELETE', url: `/tasks/${c.task.id}/attachments/${attachmentId}`, headers: { authorization: c.daniAuth } })
    expect(res.statusCode).toBe(409)
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } })).deletedAt).toBeNull()
  })

  it('a discarded task: the client can no longer decide and Início does not count it', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    await prisma.task.update({ where: { id: c.task.id }, data: { status: 'DISREGARDED' } })
    expect((await post(`/portal/approvals/${id}/approve`, c.rhAuth, {})).statusCode).toBe(409)
    const home = JSON.parse((await app.inject({ method: 'GET', url: `/portal/home?clientId=${c.acme.id}`, headers: { authorization: c.rhAuth } })).body)
    expect(home.pendingApprovals).toBe(0)
  })

  it('a change request is also e-mailed to the current owner, with a link to the task', async () => {
    const c = await setup()
    const { id } = JSON.parse((await requestApproval(c)).body)
    await prisma.task.update({ where: { id: c.task.id }, data: { assigneeId: c.carla.id } })
    await post(`/portal/approvals/${id}/request-changes`, c.rhAuth, { note: 'Ajuste' })
    const jobs = enqueued.filter((j) => j.event === 'APPROVAL_CHANGES_REQUESTED')
    expect(jobs.map((j) => j.userId).sort()).toEqual([c.carla.id, c.dani.id].sort())

    const send = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined)
    await prisma.notificationConfig.create({ data: { organizationId: c.org.id, emailEnabled: true, approvalChangesRequested: true } })
    await processNotificationJob({ data: jobs[0] })
    expect(send.mock.calls[0][3]).toContain(`/app/tasks?task=${c.task.id}`)
  })

  it('asking for approval and completing the task at the same time never leaves a pending approval on a done task', async () => {
    const c = await setup()
    await Promise.all([
      requestApproval(c),
      app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.daniAuth }, payload: { status: 'DONE' } }),
    ])
    const task = await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })
    const pending = await prisma.taskApproval.count({ where: { taskId: c.task.id, status: 'PENDING' } })
    expect(task.status === 'DONE' && pending > 0).toBe(false)
  })
})
