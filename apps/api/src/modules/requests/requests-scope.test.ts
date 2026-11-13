import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as sse from '@/lib/sse'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishOrgEvent').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carlos' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna', departmentIds: [fiscal.id] })
  const a = await createTestClient(org.id)
  const b = await createTestClient(org.id)
  await serveClientDepartment(a.id, fiscal.id, carlos.id)
  await serveClientDepartment(b.id, folha.id, dani.id)
  const reqFiscal = await prisma.request.create({ data: { organizationId: org.id, clientId: a.id, departmentId: fiscal.id, title: 'Pedido Fiscal' } })
  const reqFolha = await prisma.request.create({ data: { organizationId: org.id, clientId: b.id, departmentId: folha.id, title: 'Pedido Folha' } })
  return {
    org, carlos, bruna, reqFiscal, reqFolha,
    adminAuth: await getAuthHeader(admin.email, 'Test@1234'),
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    carlosAuth: await getAuthHeader(carlos.email, 'Test@1234'),
  }
}

const get = (url: string, auth: string) => app.inject({ method: 'GET', url, headers: { authorization: auth } })
const titles = (body: string) => (JSON.parse(body) as { title: string }[]).map((r) => r.title).sort()

describe('solicitações no escopo do colaborador', () => {
  it('member sees the requests of their department, not of others', async () => {
    const c = await setup()
    expect(titles((await get('/requests', c.brunaAuth)).body)).toEqual(['Pedido Fiscal'])
    expect(titles((await get('/requests', c.adminAuth)).body)).toEqual(['Pedido Fiscal', 'Pedido Folha'])
  })

  it('"mine" lists the requests of (client, department) pairs I am responsible for', async () => {
    const c = await setup()
    expect(titles((await get('/requests?scope=mine', c.carlosAuth)).body)).toEqual(['Pedido Fiscal'])
    expect(titles((await get('/requests?scope=mine', c.brunaAuth)).body)).toEqual([])
  })

  it('detail, comments and actions on a request out of scope answer 404', async () => {
    const c = await setup()
    const id = c.reqFolha.id
    expect((await get(`/requests/${id}`, c.brunaAuth)).statusCode).toBe(404)
    expect((await get(`/requests/${id}/comments`, c.brunaAuth)).statusCode).toBe(404)
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: { authorization: c.brunaAuth }, payload })
    expect((await post(`/requests/${id}/comments`, { content: 'oi' })).statusCode).toBe(404)
    expect((await post(`/requests/${id}/approve`, { mode: 'NEW_BOARD' })).statusCode).toBe(404)
    expect((await post(`/requests/${id}/reject`, { reason: 'não' })).statusCode).toBe(404)
    expect((await post(`/requests/${id}/needs-info`, { comment: 'falta' })).statusCode).toBe(404)
  })

  it('pending count follows the scope', async () => {
    const c = await setup()
    expect(JSON.parse((await get('/requests/pending-count', c.brunaAuth)).body)).toEqual({ count: 1 })
    expect(JSON.parse((await get('/requests/pending-count', c.adminAuth)).body)).toEqual({ count: 2 })
  })

  it('a colleague of the department approves and the task goes to them', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'POST', url: `/requests/${c.reqFiscal.id}/approve`, headers: { authorization: c.brunaAuth }, payload: { mode: 'NEW_BOARD' } })
    expect(res.statusCode).toBe(200)
    const task = await prisma.task.findFirstOrThrow({ where: { sourceRequestId: c.reqFiscal.id } })
    expect(task.assigneeId).toBe(c.bruna.id)
  })

  it('an admin outside the department approves and the task goes to the client responsible', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'POST', url: `/requests/${c.reqFiscal.id}/approve`, headers: { authorization: c.adminAuth }, payload: { mode: 'NEW_BOARD' } })
    expect(res.statusCode).toBe(200)
    const task = await prisma.task.findFirstOrThrow({ where: { sourceRequestId: c.reqFiscal.id } })
    expect(task.assigneeId).toBe(c.carlos.id)
  })
})
