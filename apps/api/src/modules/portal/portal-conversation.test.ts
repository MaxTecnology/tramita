import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as sse from '@/lib/sse'
import * as mailer from '@/lib/mailer'
import { prisma } from '@/lib/prisma'
import { processNotificationJob } from '@/workers/notification.worker'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment,
  createTestTask, createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
})

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

// ACME, Fiscal. November: "Apuração" (1 document request), "Folha" (no request), "Conferência" (nothing)
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const carla = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carla' })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(acme.id, fiscal.id, carla.id)
  const { clientUser: fin, password } = await createTestClientUser(org.id, { name: 'Financeiro' })
  await grantClientAccess(fin.id, acme.id, fiscal.id)
  const { clientUser: socio, password: socioPass } = await createTestClientUser(org.id, { name: 'Sócio' })
  await grantClientAccess(socio.id, acme.id, fiscal.id)
  const rec = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: acme.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
  const mk = async (title: string) => {
    const t = await createTestTask(rec.columns[0].id, carla.id, { departmentId: fiscal.id, title })
    return prisma.task.update({ where: { id: t.id }, data: { visibleToClient: true, competence: new Date('2026-11-01') } })
  }
  const apuracao = await mk('Apuração')
  await prisma.taskDocumentRequirement.create({ data: { taskId: apuracao.id, name: 'Extrato', position: 0 } })
  const folha = await mk('Folha de novembro')
  const conferencia = await mk('Conferência')
  return {
    org, acme, fiscal, carla, fin, socio, apuracao, folha, conferencia,
    carlaAuth: await getAuthHeader(carla.email, 'Test@1234'),
    finAuth: await clientLogin(fin.email, password),
    socioAuth: await clientLogin(socio.email, socioPass),
  }
}

const getMonth = (c: { acme: { id: string } }, auth: string) =>
  app.inject({ method: 'GET', url: `/portal/document-requests?clientId=${c.acme.id}&competence=2026-11`, headers: { authorization: auth } })

describe('Enviar documentos agrupado por tarefa', () => {
  it('groups requests by task; a task with only a conversation shows up, one with nothing does not', async () => {
    const c = await setup()
    await app.inject({ method: 'POST', url: `/tasks/${c.folha.id}/comments`, headers: { authorization: c.carlaAuth }, payload: { content: 'Confere a prévia?' } })

    const body = JSON.parse((await getMonth(c, c.finAuth)).body)
    expect(body.competence).toBe('2026-11')
    const titles = body.tasks.map((t: { title: string }) => t.title)
    expect(titles).toEqual(['Apuração', 'Folha de novembro'])
    const apuracao = body.tasks[0]
    expect(apuracao).toMatchObject({ taskId: c.apuracao.id, departmentName: 'Fiscal', approvals: [], unreadMessages: 0 })
    expect(apuracao.requests.map((r: { name: string }) => r.name)).toEqual(['Extrato'])
    expect(body.tasks[1]).toMatchObject({ taskId: c.folha.id, requests: [], unreadMessages: 1 })
  })

  it('the month list includes a month that only has a conversation', async () => {
    const c = await setup()
    await prisma.taskDocumentRequirement.deleteMany({ where: { taskId: c.apuracao.id } })
    await app.inject({ method: 'POST', url: `/tasks/${c.folha.id}/comments`, headers: { authorization: c.carlaAuth }, payload: { content: 'Oi' } })
    const res = await app.inject({ method: 'GET', url: `/portal/document-requests/months?clientId=${c.acme.id}`, headers: { authorization: c.finAuth } })
    expect(JSON.parse(res.body)).toEqual([{ competence: '2026-11', pending: 0, total: 0 }])
  })

  it('read-by-task clears unread only for that user and that task; Início counts unread conversations', async () => {
    const c = await setup()
    for (const t of [c.folha, c.apuracao]) {
      await app.inject({ method: 'POST', url: `/tasks/${t.id}/comments`, headers: { authorization: c.carlaAuth }, payload: { content: 'Mensagem' } })
    }
    const home = async (auth: string) => JSON.parse((await app.inject({ method: 'GET', url: `/portal/home?clientId=${c.acme.id}`, headers: { authorization: auth } })).body)
    expect((await home(c.finAuth)).unreadMessages).toMatchObject({ count: 2 })
    expect((await home(c.finAuth)).pendingApprovals).toBe(0)

    await app.inject({ method: 'POST', url: '/notifications/read-by-task', headers: { authorization: c.finAuth }, payload: { taskId: c.folha.id } })

    const fin = JSON.parse((await getMonth(c, c.finAuth)).body).tasks
    expect(fin.find((t: { taskId: string }) => t.taskId === c.folha.id).unreadMessages).toBe(0)
    expect(fin.find((t: { taskId: string }) => t.taskId === c.apuracao.id).unreadMessages).toBe(1)
    const socio = JSON.parse((await getMonth(c, c.socioAuth)).body).tasks
    expect(socio.find((t: { taskId: string }) => t.taskId === c.folha.id).unreadMessages).toBe(1)
    const h = await home(c.finAuth)
    expect(h.unreadMessages).toEqual({ count: 1, link: `/portal/send?competence=2026-11&task=${c.apuracao.id}` })
  })
})

describe('link do aviso de comentário', () => {
  it('the e-mail to the client opens the conversation of the recurring task', async () => {
    const c = await setup()
    const send = vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined)
    await prisma.notificationConfig.create({ data: { organizationId: c.org.id, emailEnabled: true, commentAdded: true } })
    await processNotificationJob({
      data: { event: 'TASK_COMMENT_ADDED', organizationId: c.org.id, clientId: c.acme.id, taskId: c.folha.id, metadata: { commentText: 'Oi', commentAuthorName: 'Carla' } },
    })
    const html = send.mock.calls[0][3]
    expect(html).toContain(`/portal/send?competence=2026-11&task=${c.folha.id}`)
  })
})
