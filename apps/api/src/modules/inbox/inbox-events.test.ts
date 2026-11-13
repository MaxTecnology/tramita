import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as sse from '@/lib/sse'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { multipartBody } from '@/test/multipart'
import { insertProtocol } from '@/modules/protocols/protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, createTestTask, createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishOrgEvent').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
})

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

// ACME served by Fiscal (Carla) and Folha (Dani). Client users: Financeiro (Fiscal), RH (Folha).
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Admin' })
  const carla = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carla' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna', departmentIds: [fiscal.id] })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(acme.id, fiscal.id, carla.id)
  await serveClientDepartment(acme.id, folha.id, dani.id)
  const { clientUser: fin, password: finPass } = await createTestClientUser(org.id, { name: 'Financeiro' })
  await grantClientAccess(fin.id, acme.id, fiscal.id)
  const { clientUser: rh } = await createTestClientUser(org.id, { name: 'RH' })
  await grantClientAccess(rh.id, acme.id, folha.id)
  const rec = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: acme.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
  const mk = async (title: string, visibleToClient: boolean) => {
    const t = await createTestTask(rec.columns[0].id, admin.id, { departmentId: fiscal.id, title })
    return prisma.task.update({ where: { id: t.id }, data: { assigneeId: carla.id, visibleToClient, competence: new Date('2026-11-01') } })
  }
  const task = await mk('Apuração', true)
  const internal = await mk('Conferência interna', false)
  return {
    org, fiscal, admin, carla, bruna, acme, fin, rh, task, internal,
    adminAuth: await getAuthHeader(admin.email, 'Test@1234'),
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    carlaAuth: await getAuthHeader(carla.email, 'Test@1234'),
    finAuth: await clientLogin(fin.email, finPass),
  }
}

const inbox = (where: { recipientUserId?: string; recipientClientUserId?: string }) =>
  prisma.inAppNotification.findMany({ where, orderBy: { createdAt: 'asc' } })
const types = async (where: { recipientUserId?: string; recipientClientUserId?: string }) => (await inbox(where)).map((n) => n.type)
const post = (url: string, auth: string, payload?: object) => app.inject({ method: 'POST', url, headers: { authorization: auth }, payload })

describe('comentários', () => {
  it('client comment notifies the task owner, not the client who wrote it', async () => {
    const c = await setup()
    await post(`/tasks/${c.task.id}/comments`, c.finAuth, { content: 'Segue amanhã' })
    const [n] = await inbox({ recipientUserId: c.carla.id })
    expect(n).toMatchObject({ type: 'TASK_COMMENT', taskId: c.task.id, link: `/app/tasks?task=${c.task.id}` })
    expect(await types({ recipientClientUserId: c.fin.id })).toEqual([])
  })

  it('office comment notifies the owner and only the client users of that department', async () => {
    const c = await setup()
    await post(`/tasks/${c.task.id}/comments`, c.brunaAuth, { content: 'Falta o extrato' })
    expect(await types({ recipientUserId: c.carla.id })).toEqual(['TASK_COMMENT'])
    expect(await types({ recipientUserId: c.bruna.id })).toEqual([])
    const [toClient] = await inbox({ recipientClientUserId: c.fin.id })
    expect(toClient.link).toBe(`/portal/send?competence=2026-11&task=${c.task.id}`)
    expect(await types({ recipientClientUserId: c.rh.id })).toEqual([])
  })

  it('a comment on an internal task never reaches the client', async () => {
    const c = await setup()
    await post(`/tasks/${c.internal.id}/comments`, c.brunaAuth, { content: 'Só para a equipe' })
    expect(await types({ recipientClientUserId: c.fin.id })).toEqual([])
    expect(await types({ recipientUserId: c.carla.id })).toEqual(['TASK_COMMENT'])
  })
})

describe('solicitações', () => {
  it('created by the client → responsible; comment and decision by the office → client', async () => {
    const c = await setup()
    const created = await post('/portal/requests', c.finAuth, { clientId: c.acme.id, departmentId: c.fiscal.id, title: 'Alterar endereço' })
    const requestId = JSON.parse(created.body).id
    expect(await types({ recipientUserId: c.carla.id })).toEqual(['REQUEST_CREATED'])

    await post(`/requests/${requestId}/comments`, c.carlaAuth, { content: 'Mande o comprovante' })
    await post(`/requests/${requestId}/reject`, c.adminAuth, { reason: 'Sem documento' })
    expect(await types({ recipientClientUserId: c.fin.id })).toEqual(['REQUEST_COMMENT', 'REQUEST_STATUS'])
    expect(await types({ recipientClientUserId: c.rh.id })).toEqual([])
  })
})

describe('documentos', () => {
  it('client upload notifies the owner; office refusal and a new document notify the client', async () => {
    const c = await setup()
    const req = await prisma.taskDocumentRequirement.create({ data: { taskId: c.task.id, name: 'Extrato', position: 0 } })
    const mp = multipartBody({}, { filename: 'extrato.pdf' })
    await app.inject({ method: 'POST', url: `/portal/tasks/${c.task.id}/documents/requests/${req.id}/upload`, headers: { authorization: c.finAuth, ...mp.headers }, body: mp.body })
    expect(await types({ recipientUserId: c.carla.id })).toEqual(['DOCUMENT_UPLOADED'])

    await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}/documents/requests/${req.id}`, headers: { authorization: c.carlaAuth }, payload: { decision: 'REJECTED', rejectionReason: 'Ilegível' } })
    await insertProtocol({ organizationId: c.org.id, clientId: c.acme.id, taskId: c.task.id, title: 'Guia DAS', content: 'x', createdById: c.carla.id })
    expect(await types({ recipientClientUserId: c.fin.id })).toEqual(['DOCUMENT_REJECTED', 'DOCUMENT_RECEIVED'])
  })
})

describe('responsabilidade', () => {
  it('assigning, assuming and a process with a responsible notify the new owner', async () => {
    const c = await setup()
    await app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}`, headers: { authorization: c.adminAuth }, payload: { assigneeId: c.bruna.id } })
    expect(await types({ recipientUserId: c.bruna.id })).toEqual(['TASK_ASSIGNED'])

    await post(`/tasks/${c.internal.id}/assume`, c.brunaAuth, { expectedAssigneeId: c.carla.id })
    expect(await types({ recipientUserId: c.carla.id })).toEqual(['TASK_ASSUMED'])

    await post('/boards', c.adminAuth, { title: 'Abertura', clientId: c.acme.id, responsibleUserId: c.carla.id })
    expect(await types({ recipientUserId: c.carla.id })).toEqual(['TASK_ASSUMED', 'BOARD_ASSIGNED'])
  })
})
