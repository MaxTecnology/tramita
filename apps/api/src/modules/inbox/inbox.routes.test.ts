import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { notifyInApp, clientUsersFor } from './inbox.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna' })
  const carla = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carla' })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  const beta = await createTestClient(org.id, { name: 'Beta' })
  const { clientUser: financeiro, password } = await createTestClientUser(org.id)
  await grantClientAccess(financeiro.id, acme.id, fiscal.id)
  const { clientUser: rh } = await createTestClientUser(org.id)
  await grantClientAccess(rh.id, acme.id, folha.id)
  return {
    org, fiscal, folha, bruna, carla, acme, beta, financeiro, rh,
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    carlaAuth: await getAuthHeader(carla.email, 'Test@1234'),
    financeiroAuth: await clientLogin(financeiro.email, password),
  }
}

const note = (orgId: string, extra: Partial<Parameters<typeof notifyInApp>[0]>) =>
  notifyInApp({ organizationId: orgId, type: 'TASK_COMMENT', title: 'Novo comentário', body: 'Fulano comentou', link: '/app/tasks', to: {}, ...extra })

const get = (url: string, auth: string) => app.inject({ method: 'GET', url, headers: { authorization: auth } })
const post = (url: string, auth: string, payload?: object) => app.inject({ method: 'POST', url, headers: { authorization: auth }, payload })

describe('notifyInApp', () => {
  it('writes one row per recipient, skipping who caused it and duplicates', async () => {
    const c = await setup()
    const n = await note(c.org.id, { to: { userIds: [c.bruna.id, c.carla.id, c.bruna.id] }, exclude: { userId: c.carla.id } })
    expect(n).toBe(1)
    expect(await prisma.inAppNotification.count({ where: { recipientUserId: c.bruna.id } })).toBe(1)
    expect(await prisma.inAppNotification.count({ where: { recipientUserId: c.carla.id } })).toBe(0)
  })

  it('clientUsersFor returns active users with access to the company AND the department', async () => {
    const c = await setup()
    expect(await clientUsersFor(c.acme.id, c.fiscal.id)).toEqual([c.financeiro.id])
    expect(await clientUsersFor(c.acme.id, c.folha.id)).toEqual([c.rh.id])
    expect(await clientUsersFor(c.beta.id, c.fiscal.id)).toEqual([])
    await prisma.clientUser.update({ where: { id: c.financeiro.id }, data: { isActive: false } })
    expect(await clientUsersFor(c.acme.id, c.fiscal.id)).toEqual([])
  })
})

describe('/notifications', () => {
  it('each one lists and counts only their own (staff and client)', async () => {
    const c = await setup()
    await note(c.org.id, { to: { userIds: [c.bruna.id] }, title: 'Para Bruna' })
    await note(c.org.id, { to: { userIds: [c.carla.id] }, title: 'Para Carla' })
    await note(c.org.id, { to: { clientUserIds: [c.financeiro.id] }, title: 'Para o cliente' })

    const bruna = JSON.parse((await get('/notifications', c.brunaAuth)).body)
    expect(bruna.items.map((n: { title: string }) => n.title)).toEqual(['Para Bruna'])
    expect(JSON.parse((await get('/notifications/unread-count', c.brunaAuth)).body)).toEqual({ count: 1 })
    expect(JSON.parse((await get('/notifications', c.financeiroAuth)).body).items.map((n: { title: string }) => n.title)).toEqual(['Para o cliente'])
  })

  it('filters by status, type, client and text', async () => {
    const c = await setup()
    await note(c.org.id, { to: { userIds: [c.bruna.id] }, title: 'Comentário ACME', refs: { clientId: c.acme.id } })
    await note(c.org.id, { to: { userIds: [c.bruna.id] }, type: 'REQUEST_CREATED', title: 'Solicitação Beta', body: 'Abertura', refs: { clientId: c.beta.id } })
    const first = await prisma.inAppNotification.findFirstOrThrow({ where: { title: 'Comentário ACME' } })
    await post(`/notifications/${first.id}/read`, c.brunaAuth)
    const titles = async (qs: string) => (JSON.parse((await get(`/notifications?${qs}`, c.brunaAuth)).body).items as { title: string }[]).map((n) => n.title)

    expect(await titles('status=unread')).toEqual(['Solicitação Beta'])
    expect(await titles('status=read')).toEqual(['Comentário ACME'])
    expect(await titles('type=REQUEST_CREATED')).toEqual(['Solicitação Beta'])
    expect(await titles(`clientId=${c.acme.id}`)).toEqual(['Comentário ACME'])
    expect(await titles('q=abertura')).toEqual(['Solicitação Beta'])
  })

  it('read, unread, read-all and read-by-task change only my notifications', async () => {
    const c = await setup()
    await note(c.org.id, { to: { userIds: [c.bruna.id, c.carla.id] }, refs: { taskId: 't1' } })
    await note(c.org.id, { to: { userIds: [c.bruna.id] }, refs: { taskId: 't2' } })
    const mine = await prisma.inAppNotification.findFirstOrThrow({ where: { recipientUserId: c.bruna.id, taskId: 't1' } })

    expect((await post(`/notifications/${mine.id}/read`, c.brunaAuth)).statusCode).toBe(200)
    expect((await post(`/notifications/${mine.id}/unread`, c.brunaAuth)).statusCode).toBe(200)
    expect((await post('/notifications/read-by-task', c.brunaAuth, { taskId: 't1' })).statusCode).toBe(200)
    expect(JSON.parse((await get('/notifications/unread-count', c.brunaAuth)).body)).toEqual({ count: 1 })
    expect(JSON.parse((await get('/notifications/unread-count', c.carlaAuth)).body)).toEqual({ count: 1 })
    await post('/notifications/read-all', c.brunaAuth)
    expect(JSON.parse((await get('/notifications/unread-count', c.brunaAuth)).body)).toEqual({ count: 0 })
  })

  it("someone else's notification answers 404", async () => {
    const c = await setup()
    await note(c.org.id, { to: { userIds: [c.carla.id] } })
    const carlas = await prisma.inAppNotification.findFirstOrThrow({ where: { recipientUserId: c.carla.id } })
    expect((await post(`/notifications/${carlas.id}/read`, c.brunaAuth)).statusCode).toBe(404)
    expect((await prisma.inAppNotification.findUniqueOrThrow({ where: { id: carlas.id } })).readAt).toBeNull()
  })
})
